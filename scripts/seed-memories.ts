#!/usr/bin/env npx tsx
/**
 * Seed script — 为 dev-user 创建真实的开发记忆
 * 这些记忆会出现在 Git Tree Canvas 上对应 commit 的右侧
 */
import { prisma } from "@/server/db/prisma";
import { createMemory } from "@/server/memory/store";
import { embed } from "@/server/memory/embed";

async function seed() {
  // 清掉测试数据（包括 FTS5）
  await prisma.$executeRawUnsafe("DELETE FROM memory_fts");
  await prisma.memoryEntry.deleteMany();
  console.log("[seed] Cleaned up all memories + FTS5");

  const memories = [
    {
      type: "decision" as const,
      content:
        "Phase 1 使用 Prisma + 内存余弦相似度实现向量搜索，放弃 sqlite-vec。原因：tsx 无法加载 better-sqlite3 原生模块。嵌入向量以 JSON 编码存储在 embedding 字段中。",
      summary: "Prisma-only 架构决定",
      commitHash: "757a670",
      confidence: 1.0,
      source: "agent" as const,
    },
    {
      type: "fact" as const,
      content:
        "API server 默认监听 3000 端口，WebSocket server 使用 3001 端口。开发时通过 concurrently 同时启动 Next.js 和 WebSocket。",
      summary: "服务端口配置",
      commitHash: "4a5e813",
      confidence: 0.9,
      source: "agent" as const,
    },
    {
      type: "decision" as const,
      content:
        "Canvas 使用单一 requestAnimationFrame 循环渲染所有元素（节点、叶子、记忆标记），不创建多个叠加 Canvas，避免性能开销。",
      summary: "Canvas 单层渲染决策",
      commitHash: "ea44281",
      confidence: 1.0,
      source: "agent" as const,
    },
    {
      type: "preference" as const,
      content:
        "UI 技术栈：Tailwind CSS v4 + zinc 色系 + dark mode，组件库 Radix UI primitives，编辑器 CodeMirror 6。",
      summary: "UI 技术栈偏好",
      commitHash: "0a6e20b",
      confidence: 0.9,
      source: "agent" as const,
    },
    {
      type: "event" as const,
      content:
        "2026-05-25: 完成记忆系统全栈实现 — Phase 1 (MCP Server + Prisma + embedding)，Phase 2 (Canvas 可视化标记渲染)，Phase 3 (Mem0 桥接 + 导出/导入脚本)。",
      summary: "记忆系统三阶段完成",
      commitHash: "ea44281",
      confidence: 1.0,
      source: "agent" as const,
    },
    {
      type: "procedure" as const,
      content:
        "开发命令：npm run dev 启动全部服务。npx vitest 运行测试。npx prisma migrate dev --name <name> 数据库迁移。npx tsx scripts/test-phase1.ts 测试记忆系统。",
      summary: "开发工作流",
      commitHash: "7fed77a",
      confidence: 0.95,
      source: "agent" as const,
    },
    {
      type: "fact" as const,
      content:
        "MCP Server 在 .claude/mcp.json 中配置，由 npx tsx mcp/index.ts 启动，使用 MD_FOREST_USER_ID=dev-user 和 MD_FOREST_REPO_ID=mdforest-dev 环境变量。",
      summary: "MCP 配置",
      commitHash: "757a670",
      confidence: 1.0,
      source: "agent" as const,
    },
    {
      type: "decision" as const,
      content:
        "记忆标记查询仅按 userId 过滤（不按 repoId），通过 CommitCache 交叉校验 commitHash 来隔离不同仓库的标记。Canvas 上无匹配 commit 的标记会被跳过不渲染。",
      summary: "标记可见性策略",
      commitHash: "ea44281",
      confidence: 0.9,
      source: "agent" as const,
    },
    {
      type: "fact" as const,
      content:
        "记忆系统五种类型各有独立字形和颜色：fact 蓝●、preference 黄★、event 红◆、procedure 绿▶、decision 紫■。来源透明度分层：user=1.0, agent=0.85, tool=0.7, inferred=0.5。",
      summary: "记忆标记视觉映射",
      commitHash: "ea44281",
      confidence: 1.0,
      source: "agent" as const,
    },
    {
      type: "decision" as const,
      content:
        "仓库 clone 状态修复：移除 clone 前的 mkdirSync（git clone 会自动创建目录），添加 GIT_TERMINAL_PROMPT=0 防止 git 等待交互式认证。新增 retryClone mutation 和前端轮询机制。",
      summary: "Clone 状态卡住修复",
      commitHash: "15649c5",
      confidence: 0.9,
      source: "agent" as const,
    },
  ];

  for (const mem of memories) {
    const [vec] = await embed([mem.summary ?? mem.content]);
    await createMemory(
      {
        ...mem,
        repoId: "mdforest-dev",
        userId: "dev-user",
      },
      vec!,
    );
    console.log(`  [${mem.type}] ${mem.summary}`);
  }

  const count = await prisma.memoryEntry.count({ where: { userId: "dev-user" } });
  console.log(`\n[seed] Done. ${count} memories for dev-user.`);
  await prisma.$disconnect();
}

seed().catch((e) => {
  console.error("[seed] Failed:", e);
  process.exit(1);
});
