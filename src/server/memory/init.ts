/**
 * 启动时初始化数据库结构
 * 使用 Prisma 的 raw SQL 创建 FTS5 虚拟表（内置于 SQLite）
 */
import { prisma } from "@/server/db/prisma";

let initialized = false;

export async function initMemoryDb(): Promise<void> {
  if (initialized) return;

  // 创建 FTS5 虚拟表（如果不存在）
  await prisma.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content,
      summary,
      tokenize='porter unicode61'
    );
  `);

  initialized = true;
  console.error("[memory] FTS5 initialized");
}

export function isMemoryDbReady(): boolean {
  return initialized;
}
