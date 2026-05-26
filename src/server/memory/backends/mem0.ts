/**
 * Mem0 桥接 — 可选的向量后端
 *
 * 当用户已有 Mem0 时，作为备选语义搜索后端。
 * 不替换本地 Prisma + 余弦相似度方案，仅在配置了 MEM0_API_KEY 时激活。
 *
 * 使用场景：
 *   1. 已部署 Mem0 的团队，希望复用其向量基础设施
 *   2. 跨项目记忆共享（Mem0 的 user-level 存储）
 *
 * 激活方式：
 *   MEM0_API_KEY=sk-xxx npx tsx mcp/index.ts
 */

import type { SearchResult } from "../search";

interface Mem0SearchOptions {
  query: string;
  userId: string;
  limit?: number;
}

interface Mem0Client {
  search(options: Mem0SearchOptions): Promise<Array<{
    id: string;
    memory: string;
    metadata?: Record<string, unknown>;
    score: number;
  }>>;
}

let mem0Client: Mem0Client | null = null;

/**
 * 懒加载 Mem0 客户端。
 * 仅在环境变量 MEM0_API_KEY 存在时初始化。
 * 使用动态 import 避免对未安装用户的硬依赖。
 */
async function getMem0Client(): Promise<Mem0Client | null> {
  if (mem0Client !== null) return mem0Client;

  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) {
    mem0Client = undefined as unknown as null; // 标记为已检查
    return null;
  }

  try {
    // 动态 import — Mem0 SDK 不在 package.json 中声明
    // 用户如要使用此功能，需手动安装: npm install mem0ai
    const mem0Module = await import("mem0ai");
    const Mem0Client = mem0Module.default ?? mem0Module.Mem0;
    mem0Client = new Mem0Client({ apiKey }) as Mem0Client;
    console.error("[mem0-bridge] Mem0 client initialized (apiKey present)");
    return mem0Client;
  } catch (err) {
    console.error(
      "[mem0-bridge] Failed to initialize Mem0 client. " +
      "Install mem0ai SDK: npm install mem0ai"
    );
    console.error("[mem0-bridge]", err);
    mem0Client = undefined as unknown as null;
    return null;
  }
}

/**
 * 检查 Mem0 桥接是否可用
 */
export async function isMem0Available(): Promise<boolean> {
  const client = await getMem0Client();
  return client !== null && client !== (undefined as unknown as null);
}

/**
 * 通过 Mem0 进行语义搜索
 *
 * 注意：此方法返回的 SearchResult 格式与本地 hybridSearch 一致，
 * 确保上游调用者无需区分后端。
 */
export async function searchWithMem0(
  query: string,
  repoId: string,
  userId: string,
  limit = 10,
): Promise<SearchResult[]> {
  const client = await getMem0Client();
  if (!client) {
    console.error("[mem0-bridge] Mem0 not available, returning empty results");
    return [];
  }

  try {
    const results = await client.search({
      query,
      userId,
      limit,
    });

    return results.map((r) => ({
      id: r.id,
      type: extractTypeFromMetadata(r.metadata) ?? "fact",
      content: r.memory,
      summary: null,
      confidence: r.score,
      source: "tool",
      commitHash: r.metadata?.commitHash as string | null ?? null,
      createdAt: new Date(),
      score: r.score,
    }));
  } catch (err) {
    console.error("[mem0-bridge] Search failed, falling back to local:", err);
    return [];
  }
}

/**
 * 从 Mem0 metadata 中提取记忆类型
 */
function extractTypeFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (!metadata) return null;
  const validTypes = ["fact", "preference", "event", "procedure", "decision"];
  const type = metadata.type as string | undefined;
  return type && validTypes.includes(type) ? type : null;
}

/**
 * 检查是否应该使用 Mem0 而非本地搜索
 *
 * 优先级：
 *   1. 如果 MEM0_ENABLED=true，优先 Mem0
 *   2. 如果 MEM0_FALLBACK=false 且 Mem0 可用，使用 Mem0
 *   3. 默认使用本地搜索
 */
export async function shouldUseMem0(): Promise<boolean> {
  if (process.env.MEM0_ENABLED === "true") return isMem0Available();
  if (process.env.MEM0_FALLBACK === "false") return isMem0Available();
  return false;
}
