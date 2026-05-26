#!/usr/bin/env npx tsx
/**
 * mdforest MCP Memory Server — 生产版 (Phase 1)
 *
 * 替换 Phase 0 的 phase0-server.ts
 * 使用 Prisma + FTS5 + 本地 embedding 实现持久化记忆存储
 *
 * 运行方式：
 *   npx tsx mcp/index.ts
 *
 * Transport: stdio（默认适用于 Claude Code / VS Code）
 *
 * 环境变量（MCP 配置中设置）：
 *   MD_FOREST_USER_ID  - 用户 ID（必需）
 *   MD_FOREST_REPO_ID  - 仓库 ID（默认 "default-repo"）
 *   DATABASE_URL        - SQLite 数据库路径（默认从 .env 读取）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAddMemory } from "./tools/add-memory";
import { registerSearchMemory } from "./tools/search-memory";
import { registerGetTimeline } from "./tools/get-timeline";
import { registerLinkToCommit } from "./tools/link-to-commit";
import { initMemoryDb } from "@/server/memory/init";

// ============================================================================
// MCP Server
// ============================================================================

const server = new McpServer({
  name: "mdforest-memory",
  version: "1.0.0",
  description:
    "mdforest memory server — persistent knowledge storage with semantic + keyword hybrid search",
});

// 注册工具
registerAddMemory(server);
registerSearchMemory(server);
registerGetTimeline(server);
registerLinkToCommit(server);

// ============================================================================
// 启动
// ============================================================================

async function main() {
  // 初始化数据库（FTS5 虚拟表等）
  await initMemoryDb();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[mdforest-memory] Phase 1 server started (stdio)");
  console.error(
    "[mdforest-memory] Tools: add_memory, search_memory, get_timeline_context, link_to_commit"
  );
}

main().catch((err) => {
  console.error("[mdforest-memory] Fatal error:", err);
  process.exit(1);
});
