#!/usr/bin/env npx tsx
/**
 * 记忆导出脚本
 *
 * 将 MemoryEntry 导出为 JSON 或 Markdown 格式。
 *
 * 用法:
 *   npx tsx scripts/export-memories.ts                    # JSON 输出到 stdout
 *   npx tsx scripts/export-memories.ts --format markdown  # Markdown 输出到 stdout
 *   npx tsx scripts/export-memories.ts --output out.json  # 输出到文件
 *   npx tsx scripts/export-memories.ts --type decision    # 按类型过滤
 *   npx tsx scripts/export-memories.ts --repo-id my-repo  # 按仓库过滤
 *
 * 环境变量:
 *   DATABASE_URL     — Prisma 数据库连接（默认: file:./dev.db）
 *   MD_FOREST_USER_ID — 按用户过滤（可选）
 */

import { prisma } from "@/server/db/prisma";

interface ExportEntry {
  id: string;
  type: string;
  content: string;
  summary: string | null;
  confidence: number;
  source: string;
  provenance: string | null;
  commitHash: string | null;
  repoId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

interface ExportManifest {
  exportedAt: string;
  format: "json";
  version: 1;
  totalEntries: number;
  filters: {
    type?: string;
    repoId?: string;
    userId?: string;
  };
  entries: ExportEntry[];
}

function parseArgs(): {
  format: "json" | "markdown";
  outputFile: string | null;
  typeFilter: string | null;
  repoId: string | null;
} {
  const args = process.argv.slice(2);
  let format: "json" | "markdown" = "json";
  let outputFile: string | null = null;
  let typeFilter: string | null = null;
  let repoId: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--format" || arg === "-f") {
      format = args[++i] as "json" | "markdown";
    } else if (arg === "--output" || arg === "-o") {
      outputFile = args[++i]!;
    } else if (arg === "--type" || arg === "-t") {
      typeFilter = args[++i]!;
    } else if (arg === "--repo-id" || arg === "-r") {
      repoId = args[++i]!;
    }
  }

  return { format, outputFile, typeFilter, repoId };
}

/**
 * JSON 格式导出
 */
async function exportJSON(
  entries: ExportEntry[],
  { typeFilter, repoId }: { typeFilter: string | null; repoId: string | null },
): Promise<string> {
  const manifest: ExportManifest = {
    exportedAt: new Date().toISOString(),
    format: "json",
    version: 1,
    totalEntries: entries.length,
    filters: {
      type: typeFilter ?? undefined,
      repoId: repoId ?? undefined,
      userId: process.env.MD_FOREST_USER_ID ?? undefined,
    },
    entries,
  };

  return JSON.stringify(manifest, null, 2);
}

/**
 * Markdown 格式导出
 */
function exportMarkdown(entries: ExportEntry[]): string {
  const lines: string[] = [
    `# mdforest Memory Export`,
    ``,
    `Exported: ${new Date().toISOString()}`,
    `Total entries: ${entries.length}`,
    ``,
    `---`,
    ``,
  ];

  // 按类型分组
  const byType = new Map<string, ExportEntry[]>();
  for (const entry of entries) {
    const list = byType.get(entry.type) ?? [];
    list.push(entry);
    byType.set(entry.type, list);
  }

  for (const [type, items] of byType) {
    const emoji = {
      fact: "🔵",
      preference: "⭐",
      event: "🔴",
      procedure: "🟢",
      decision: "🟣",
    }[type] ?? "📝";

    lines.push(`## ${emoji} ${type}s (${items.length})`);
    lines.push(``);

    for (const item of items) {
      lines.push(`### ${item.summary ?? item.content.substring(0, 80)}`);
      lines.push(``);
      lines.push(`- **Type**: ${item.type}`);
      lines.push(`- **Source**: ${item.source}`);
      lines.push(`- **Confidence**: ${(item.confidence * 100).toFixed(0)}%`);
      if (item.commitHash) {
        lines.push(`- **Commit**: \`${item.commitHash}\``);
      }
      lines.push(`- **Created**: ${item.createdAt}`);
      if (item.provenance) {
        lines.push(`- **Provenance**: ${item.provenance}`);
      }
      lines.push(``);
      lines.push(`> ${item.content.replace(/\n/g, "\n> ")}`);
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }
  }

  return lines.join("\n");
}

async function main() {
  const { format, outputFile, typeFilter, repoId } = parseArgs();

  // 构建查询条件
  const where: Record<string, unknown> = {};
  if (typeFilter) where.type = typeFilter;
  if (repoId) where.repoId = repoId;
  if (process.env.MD_FOREST_USER_ID) where.userId = process.env.MD_FOREST_USER_ID;

  console.error(`[export] Fetching memories...`);
  const raw = await prisma.memoryEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  const entries: ExportEntry[] = raw.map((e) => ({
    id: e.id,
    type: e.type,
    content: e.content,
    summary: e.summary,
    confidence: e.confidence,
    source: e.source,
    provenance: e.provenance,
    commitHash: e.commitHash,
    repoId: e.repoId,
    userId: e.userId,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }));

  console.error(`[export] Found ${entries.length} entries`);

  const output =
    format === "markdown"
      ? exportMarkdown(entries)
      : await exportJSON(entries, { typeFilter, repoId });

  if (outputFile) {
    const fs = await import("fs");
    fs.writeFileSync(outputFile, output, "utf-8");
    console.error(`[export] Written to ${outputFile}`);
  } else {
    process.stdout.write(output);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[export] Failed:", err);
  process.exit(1);
});
