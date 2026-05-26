import { prisma } from "@/server/db/prisma";
import { initMemoryDb, isMemoryDbReady } from "./init";
import { decodeEmbedding } from "./store";

export interface SearchResult {
  id: string;
  type: string;
  content: string;
  summary: string | null;
  confidence: number;
  source: string;
  commitHash: string | null;
  createdAt: Date;
  score: number;
}

/**
 * 计算两个向量的余弦相似度
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 混合搜索：FTS5 (BM25) + 余弦相似度 → RRF 融合
 */
export async function hybridSearch(
  queryVector: Float32Array,
  queryText: string,
  repoId: string,
  userId: string,
  typeFilter?: string,
  limit = 20
): Promise<SearchResult[]> {
  await initMemoryDb();

  const candidateIds = new Set<string>();
  const ftsRanks = new Map<string, number>();
  const vecScores = new Map<string, number>();

  // Step 1: FTS5 关键词搜索
  const keywords = queryText.split(/\s+/).filter((w) => w.length > 0);
  if (keywords.length > 0) {
    try {
      const ftsQuery = keywords.map((w) => `"${w}"`).join(" OR ");

      const ftsRows = await prisma.$queryRawUnsafe<
        Array<{ id: string; score: number }>
      >(
        `SELECT me.id, f.rank as score
         FROM memory_fts f
         JOIN MemoryEntry me ON me.rowid = f.rowid
         WHERE memory_fts MATCH ?
           AND me.repoId = ?
           AND me.userId = ?
         ORDER BY f.rank
         LIMIT ?`,
        ftsQuery,
        repoId,
        userId,
        limit * 2
      );

      ftsRows.forEach((r, idx) => {
        candidateIds.add(r.id);
        ftsRanks.set(r.id, idx);
      });
    } catch {
      // FTS5 查询语法错误时降级
    }
  }

  // Step 2: 向量相似度搜索
  // 获取所有候选的 embedding + fallback 用最近记忆
  const vecCandidates = await prisma.memoryEntry.findMany({
    where: {
      repoId,
      userId,
      ...(typeFilter ? { type: typeFilter } : {}),
      embedding: { not: null },
    },
    select: {
      id: true,
      embedding: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500, // 限制内存计算规模
  });

  // 计算余弦相似度
  for (const candidate of vecCandidates) {
    if (!candidate.embedding) continue;
    const vec = decodeEmbedding(candidate.embedding);
    const sim = cosineSimilarity(queryVector, vec);
    candidateIds.add(candidate.id);
    vecScores.set(candidate.id, sim);
  }

  if (candidateIds.size === 0) return [];

  // Step 3: RRF 融合 (k=60)
  // 分别排序
  const ftsSorted = [...ftsRanks.entries()].sort((a, b) => a[1] - b[1]);
  const vecSorted = [...vecScores.entries()].sort((a, b) => b[1] - a[1]); // 越大越好

  const ftsRrfRanks = new Map<string, number>();
  ftsSorted.forEach(([id], idx) => ftsRrfRanks.set(id, idx));

  const vecRrfRanks = new Map<string, number>();
  vecSorted.forEach(([id], idx) => vecRrfRanks.set(id, idx));

  const mergedScores = new Map<string, number>();
  for (const id of candidateIds) {
    let rrf = 0;
    const ftsR = ftsRrfRanks.get(id);
    if (ftsR !== undefined) rrf += 1.0 / (60 + ftsR + 1);
    const vecR = vecRrfRanks.get(id);
    if (vecR !== undefined) rrf += 1.0 / (60 + vecR + 1);
    mergedScores.set(id, rrf);
  }

  // Step 4: 取 top-N，加载完整记录
  const topIds = [...mergedScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  if (topIds.length === 0) return [];

  const entries = await prisma.memoryEntry.findMany({
    where: {
      id: { in: topIds },
    },
    select: {
      id: true,
      type: true,
      content: true,
      summary: true,
      confidence: true,
      source: true,
      commitHash: true,
      createdAt: true,
    },
  });

  // 按 RRF 分数排序
  return entries
    .map((e) => ({
      ...e,
      score: mergedScores.get(e.id) ?? 0,
    }))
    .sort((a, b) => b.score - a.score);
}
