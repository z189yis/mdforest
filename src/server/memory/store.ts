import { prisma } from "@/server/db/prisma";
import { sanitizeMemoryContent } from "./sanitize";
import { initMemoryDb } from "./init";

export interface CreateMemoryInput {
  type: string;
  content: string;
  summary?: string;
  confidence?: number;
  source?: string;
  provenance?: string;
  repoId: string;
  userId: string;
  commitHash?: string;
  documentId?: string;
}

/**
 * 将 Float32Array 编码为 JSON 字符串以便存储在 TEXT 字段中
 */
export function encodeEmbedding(embedding: Float32Array): string {
  return JSON.stringify(Array.from(embedding));
}

/**
 * 从 JSON 字符串解码回 Float32Array
 */
export function decodeEmbedding(json: string): Float32Array {
  return new Float32Array(JSON.parse(json) as number[]);
}

export async function createMemory(
  input: CreateMemoryInput,
  embedding: Float32Array
) {
  await initMemoryDb();
  const content = sanitizeMemoryContent(input.content);

  const entry = await prisma.$transaction(async (tx) => {
    // 1. 通过 Prisma 写 MemoryEntry（含 embedding）
    const created = await tx.memoryEntry.create({
      data: {
        type: input.type,
        content,
        summary: input.summary ?? null,
        confidence: input.confidence ?? 1.0,
        source: input.source ?? "agent",
        provenance: input.provenance ?? null,
        repoId: input.repoId,
        userId: input.userId,
        commitHash: input.commitHash ?? null,
        documentId: input.documentId ?? null,
        embedding: encodeEmbedding(embedding),
      },
    });

    // 2. 同步到 FTS5 虚拟表
    // 获取 Prisma 内部的 rowid（SQLite 隐式主键）
    const row = await tx.$queryRawUnsafe<Array<{ rowid: number }>>(
      "SELECT rowid FROM MemoryEntry WHERE id = ?",
      created.id
    );

    if (row.length > 0) {
      await tx.$executeRawUnsafe(
        "INSERT OR REPLACE INTO memory_fts(rowid, content, summary) VALUES (?, ?, ?)",
        row[0]!.rowid,
        content,
        input.summary ?? ""
      );
    }

    return created;
  });

  return entry;
}

export async function updateAccessCount(memoryId: string) {
  return prisma.memoryEntry.update({
    where: { id: memoryId },
    data: {
      accessCount: { increment: 1 },
      lastAccessedAt: new Date(),
    },
  });
}
