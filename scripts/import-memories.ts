#!/usr/bin/env npx tsx
/**
 * 记忆导入脚本
 *
 * 从 JSON 格式导入记忆（含重新 embedding）。
 *
 * 用法:
 *   npx tsx scripts/import-memories.ts memories.json           # 导入（生成新 embedding）
 *   npx tsx scripts/import-memories.ts memories.json --dry-run # 预览模式，不写入
 *   npx tsx scripts/import-memories.ts memories.json --skip-existing  # 跳过已存在的
 *
 * JSON 格式（与 export 输出兼容）:
 *   {
 *     "version": 1,
 *     "entries": [
 *       {
 *         "type": "decision",
 *         "content": "决定使用 SQLite...",
 *         "summary": "Database choice",
 *         "confidence": 0.9,
 *         "source": "agent",
 *         "commitHash": "abc123",
 *         ...
 *       }
 *     ]
 *   }
 *
 * 环境变量:
 *   DATABASE_URL      — Prisma 数据库连接
 *   MD_FOREST_USER_ID  — 导入目标用户（覆盖 JSON 中的 userId）
 *   MD_FOREST_REPO_ID  — 导入目标仓库（覆盖 JSON 中的 repoId）
 *   HF_MIRROR          — HuggingFace 镜像（用于 embedding 模型下载）
 */

import * as fs from "fs";
import * as path from "path";
import { prisma } from "@/server/db/prisma";

interface ImportEntry {
  type: string;
  content: string;
  summary?: string | null;
  confidence?: number;
  source?: string;
  provenance?: string | null;
  commitHash?: string | null;
  repoId?: string;
  userId?: string;
}

interface ImportManifest {
  version: number;
  entries: ImportEntry[];
}

/**
 * 验证导入条目的基本结构
 */
function validateEntry(entry: ImportEntry, index: number): string[] {
  const errors: string[] = [];
  const validTypes = ["fact", "preference", "event", "procedure", "decision"];

  if (!entry.content || typeof entry.content !== "string") {
    errors.push(`[${index}] missing or invalid "content"`);
  }
  if (!validTypes.includes(entry.type)) {
    errors.push(`[${index}] invalid type "${entry.type}" (must be one of: ${validTypes.join(", ")})`);
  }

  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  let inputFile: string | null = null;
  let dryRun = false;
  let skipExisting = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--skip-existing") {
      skipExisting = true;
    } else if (!arg.startsWith("--")) {
      inputFile = arg;
    }
  }

  if (!inputFile) {
    console.error("Usage: npx tsx scripts/import-memories.ts <file.json> [--dry-run] [--skip-existing]");
    process.exit(1);
  }

  const fullPath = path.resolve(inputFile);
  if (!fs.existsSync(fullPath)) {
    console.error(`[import] File not found: ${fullPath}`);
    process.exit(1);
  }

  console.error(`[import] Reading ${fullPath}...`);
  const raw = fs.readFileSync(fullPath, "utf-8");
  const manifest: ImportManifest = JSON.parse(raw);

  if (!manifest.version || !Array.isArray(manifest.entries)) {
    console.error("[import] Invalid format: expected { version, entries[] }");
    process.exit(1);
  }

  if (manifest.version !== 1) {
    console.error(`[import] Unsupported version: ${manifest.version}. Only version 1 is supported.`);
    process.exit(1);
  }

  // 验证
  console.error(`[import] Validating ${manifest.entries.length} entries...`);
  const errors: string[] = [];
  const valid: ImportEntry[] = [];

  for (let i = 0; i < manifest.entries.length; i++) {
    const entryErrors = validateEntry(manifest.entries[i]!, i);
    if (entryErrors.length > 0) {
      errors.push(...entryErrors);
    } else {
      valid.push(manifest.entries[i]!);
    }
  }

  if (errors.length > 0) {
    console.error("[import] Validation errors:");
    for (const e of errors) console.error(`  ${e}`);
    if (valid.length === 0) {
      console.error("[import] No valid entries to import, aborting.");
      process.exit(1);
    }
    console.error(`[import] Continuing with ${valid.length} valid entries (${errors.length} skipped).`);
  }

  if (dryRun) {
    console.error(`\n[import] DRY RUN — would import ${valid.length} entries:`);
    for (const entry of valid) {
      console.error(`  [${entry.type}] ${entry.summary ?? entry.content.substring(0, 60)}`);
    }
    await prisma.$disconnect();
    return;
  }

  // 获取当前用户/仓库上下文（覆盖 JSON 中的值）
  const targetUserId = process.env.MD_FOREST_USER_ID ?? "imported-user";
  const targetRepoId = process.env.MD_FOREST_REPO_ID ?? "imported-repo";

  console.error(`[import] Target user: ${targetUserId}, repo: ${targetRepoId}`);

  // 加载 embed 模块
  console.error(`[import] Loading embedding model...`);
  const { embed } = await import("@/server/memory/embed");

  // 检查已存在的 ID（如果 skipExisting）
  const existingIds = new Set<string>();
  if (skipExisting) {
    const existing = await prisma.memoryEntry.findMany({
      where: { userId: targetUserId },
      select: { id: true, content: true },
    });
    for (const e of existing) {
      // 简单判断：内容完全相同的视为已存在
      existingIds.add(e.content);
    }
    console.error(`[import] Found ${existingIds.size} existing memories (content-based dedup)`);
  }

  // 逐条导入
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of valid) {
    try {
      // 基于内容去重
      if (skipExisting && existingIds.has(entry.content)) {
        skipped++;
        continue;
      }

      // 生成新 embedding
      const [vec] = await embed([entry.content]);

      await prisma.memoryEntry.create({
        data: {
          type: entry.type,
          content: entry.content,
          summary: entry.summary ?? null,
          confidence: entry.confidence ?? 1.0,
          source: entry.source ?? "imported",
          provenance: entry.provenance ?? `Imported from ${path.basename(inputFile)}`,
          commitHash: entry.commitHash ?? null,
          repoId: entry.repoId ?? targetRepoId,
          userId: entry.userId ?? targetUserId,
          embedding: JSON.stringify(Array.from(vec!)),
        },
      });

      // 同步 FTS5
      const row = await prisma.$queryRawUnsafe<Array<{ rowid: number }>>(
        "SELECT rowid FROM MemoryEntry WHERE id = (SELECT id FROM MemoryEntry WHERE userId = ? ORDER BY createdAt DESC LIMIT 1)",
        entry.userId ?? targetUserId,
      );

      if (row.length > 0) {
        await prisma.$executeRawUnsafe(
          "INSERT INTO memory_fts(rowid, content, summary) VALUES (?, ?, ?)",
          row[0]!.rowid,
          entry.content,
          entry.summary ?? "",
        );
      }

      imported++;
    } catch (err) {
      console.error(`[import] Failed to import [${entry.type}] ${entry.content.substring(0, 40)}...:`, err);
      failed++;
    }
  }

  console.error(`\n[import] Done: ${imported} imported, ${skipped} skipped, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[import] Fatal error:", err);
  process.exit(1);
});
