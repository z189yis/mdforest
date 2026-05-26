#!/usr/bin/env npx tsx
/**
 * Phase 1 端到端测试
 *
 * 测试流程：
 *   1. 初始化 FTS5 数据库 + 创建测试 User/Repo
 *   2. 写入 5 条不同类型记忆（含 embedding）
 *   3. 语义搜索验证
 *   4. 关键词搜索验证
 *   5. 时间线查询验证
 *   6. 链接 commit 验证
 *   7. 清理测试数据
 *
 * 注意：首次运行需要下载 all-MiniLM-L6-v2 模型 (~90MB)，
 * 如果网络受限，设置环境变量 HF_MIRROR=https://hf-mirror.com
 */

import { initMemoryDb } from "@/server/memory/init";
import { createMemory, decodeEmbedding } from "@/server/memory/store";
import { hybridSearch } from "@/server/memory/search";
import { embed } from "@/server/memory/embed";
import { prisma } from "@/server/db/prisma";

const TEST_REPO_ID = "test-repo-phase1";
const TEST_USER_ID = "test-user-phase1";

// ---- 工具函数 ----

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<boolean | void>) {
  return (async () => {
    try {
      const result = await fn();
      if (result === false) throw new Error("Assertion failed");
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ❌ ${name}: ${(e as Error).message}`);
    }
  })();
}

// ---- 测试流程 ----

async function run() {
  console.log("=== Phase 1 E2E Test Suite ===\n");

  // 初始化
  console.log("0. Setup");
  await initMemoryDb();

  // 创建测试 User 和 Repo（满足外键约束）
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    update: { name: "Test User", email: "test@phase1.local" },
    create: {
      id: TEST_USER_ID,
      name: "Test User",
      email: "test@phase1.local",
    },
  });

  await prisma.repo.upsert({
    where: { id: TEST_REPO_ID },
    update: { name: "test-repo", remoteUrl: "https://example.com/test.git" },
    create: {
      id: TEST_REPO_ID,
      name: "test-repo",
      remoteUrl: "https://example.com/test.git",
      ownerId: TEST_USER_ID,
    },
  });

  // Clean up any leftover test data
  await prisma.$executeRawUnsafe(
    "DELETE FROM memory_fts WHERE rowid IN (SELECT rowid FROM MemoryEntry WHERE repoId = ? AND userId = ?)",
    TEST_REPO_ID,
    TEST_USER_ID
  );
  await prisma.memoryEntry.deleteMany({
    where: { repoId: TEST_REPO_ID, userId: TEST_USER_ID },
  });
  console.log("  ✅ FTS5 + test records ready\n");

  // Test 1: Write memories with embeddings
  console.log("1. add_memory + embedding");

  const memories = [
    {
      type: "decision",
      content:
        "决定使用 SQLite 而非 PostgreSQL，因为项目是单用户桌面场景，不需要多机扩展能力。SQLite 的零配置和嵌入式特性更适合。",
      summary: "数据库选择：SQLite over PostgreSQL",
    },
    {
      type: "fact",
      content:
        "API server 默认监听 3000 端口，WebSocket server 监听 3001 端口。WebSocket 用于 Yjs 协同编辑同步。",
      summary: "API 端口：3000, WS 端口：3001",
    },
    {
      type: "procedure",
      content:
        "运行测试：npm test -- --coverage；构建项目：npm run build；开发模式：npm run dev 同时启动 Next.js 和 WebSocket server。",
      summary: "开发工作流命令",
    },
    {
      type: "preference",
      content:
        "用户偏好使用 Tailwind CSS 而非 CSS Modules 编写样式。代码风格偏好 functional components with hooks。",
      summary: "UI 技术栈偏好",
    },
    {
      type: "event",
      content:
        "2026-05-20 完成 Git Tree Canvas 的首次发布，支持节点拖拽、hover 高亮和全屏模式。",
      summary: "Git Tree Canvas 首次发布",
    },
  ];

  const createdIds: string[] = [];

  for (const mem of memories) {
    await test(`写入 ${mem.type}: ${mem.summary}`, async () => {
      const [vec] = await embed([mem.content]);
      if (!vec) throw new Error("embedding failed");
      if (vec.length !== 384) throw new Error(`Expected 384 dims, got ${vec.length}`);

      const entry = await createMemory(
        {
          ...mem,
          repoId: TEST_REPO_ID,
          userId: TEST_USER_ID,
          source: "agent",
        },
        vec
      );

      createdIds.push(entry.id);

      // Verify embedding was stored
      if (!entry.embedding) throw new Error("Embedding not stored");
      const decoded = decodeEmbedding(entry.embedding);
      if (decoded.length !== 384) throw new Error("Embedding corrupted");

      return true;
    });
  }

  console.log(`  Total: ${createdIds.length} memories created\n`);

  // Test 2: Semantic search
  console.log("2. Semantic search (cosine similarity)");

  await test("语义搜索：数据库相关", async () => {
    const [queryVec] = await embed(["数据库 存储 技术选择"]);
    const results = await hybridSearch(
      queryVec!,
      "数据库 存储 技术选择",
      TEST_REPO_ID,
      TEST_USER_ID
    );
    if (results.length === 0) throw new Error("No results found");
    const top = results[0]!;
    if (top.type !== "decision")
      throw new Error(`Expected decision as top result, got ${top.type}`);
    if (!top.content.includes("SQLite"))
      throw new Error("Expected SQLite mention in top result");
    return true;
  });

  await test("语义搜索：端口配置", async () => {
    const [queryVec] = await embed(["端口 服务器 监听地址"]);
    const results = await hybridSearch(
      queryVec!,
      "端口 服务器 监听地址",
      TEST_REPO_ID,
      TEST_USER_ID
    );
    if (results.length === 0) throw new Error("No results");
    const found = results.some((r) => r.content.includes("3000"));
    if (!found) throw new Error("Expected port 3000 reference");
    return true;
  });

  await test("语义搜索：无关查询", async () => {
    const [queryVec] = await embed(["Kubernetes cluster部署 Docker容器编排"]);
    const results = await hybridSearch(
      queryVec!,
      "Kubernetes cluster部署 Docker容器编排",
      TEST_REPO_ID,
      TEST_USER_ID
    );
    // Accept any result — the point is it doesn't crash
    return true;
  });

  console.log("");

  // Test 3: Keyword search via FTS5
  console.log("3. FTS5 keyword search");

  await test("关键词搜索：Tailwind CSS", async () => {
    const [queryVec] = await embed(["Tailwind CSS 样式"]);
    const results = await hybridSearch(
      queryVec!,
      "Tailwind CSS 样式",
      TEST_REPO_ID,
      TEST_USER_ID
    );
    const found = results.some(
      (r) => r.type === "preference" && r.content.includes("Tailwind")
    );
    if (!found) throw new Error("Expected Tailwind preference in results");
    return true;
  });

  await test("关键词搜索：Canvas 发布", async () => {
    const [queryVec] = await embed(["Canvas 发布 2026"]);
    const results = await hybridSearch(
      queryVec!,
      "Canvas 发布 2026",
      TEST_REPO_ID,
      TEST_USER_ID
    );
    const found = results.some(
      (r) => r.type === "event" && r.content.includes("Canvas")
    );
    if (!found) throw new Error("Expected Canvas event in results");
    return true;
  });

  console.log("");

  // Test 4: Type filtering
  console.log("4. Type filtering");

  await test("类型过滤：仅 decision", async () => {
    const [queryVec] = await embed(["技术选择"]);
    const results = await hybridSearch(
      queryVec!,
      "技术选择",
      TEST_REPO_ID,
      TEST_USER_ID,
      "decision"
    );
    if (results.length === 0) throw new Error("No decisions found");
    if (!results.every((r) => r.type === "decision"))
      throw new Error("Non-decision result in filtered search");
    return true;
  });

  console.log("");

  // Test 5: Timeline retrieval
  console.log("5. Timeline query");

  await test("时间线查询：最近 30 天", async () => {
    const memories = await prisma.memoryEntry.findMany({
      where: {
        repoId: TEST_REPO_ID,
        userId: TEST_USER_ID,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (memories.length < 5) throw new Error(`Expected >=5, got ${memories.length}`);
    return true;
  });

  await test("时间线查询：按类型过滤 event", async () => {
    const memories = await prisma.memoryEntry.findMany({
      where: { repoId: TEST_REPO_ID, userId: TEST_USER_ID, type: "event" },
    });
    if (memories.length !== 1) throw new Error(`Expected 1 event, got ${memories.length}`);
    return true;
  });

  console.log("");

  // Test 6: Link to commit
  console.log("6. Link to commit");

  await test("链接 commit hash", async () => {
    if (createdIds.length === 0) throw new Error("No memories created yet");
    const memoryId = createdIds[0]!;
    await prisma.memoryEntry.update({
      where: { id: memoryId },
      data: { commitHash: "abc123def456" },
    });

    const updated = await prisma.memoryEntry.findUnique({
      where: { id: memoryId },
    });
    if (updated?.commitHash !== "abc123def456")
      throw new Error("Commit hash not updated");
    return true;
  });

  await test("链接到不存在的 memory", async () => {
    try {
      await prisma.memoryEntry.update({
        where: { id: "nonexistent-id-99999" },
        data: { commitHash: "abc123" },
      });
      throw new Error("Should have thrown");
    } catch {
      // Expected — should fail
      return true;
    }
  });

  console.log("");

  // Test 7: Sanitization
  console.log("7. Content sanitization");

  await test("XSS 内容清理", async () => {
    const { sanitizeMemoryContent } = await import(
      "@/server/memory/sanitize"
    );
    const cleaned = sanitizeMemoryContent(
      '<script>alert("xss")</script><p>valid content</p>'
    );
    if (cleaned.includes("<script>")) throw new Error("Script tag not removed");
    if (cleaned.includes("<p>")) throw new Error("HTML tag not removed");
    if (!cleaned.includes("valid content"))
      throw new Error("Valid content removed");
    return true;
  });

  await test("javascript: 协议清理", async () => {
    const { sanitizeMemoryContent } = await import(
      "@/server/memory/sanitize"
    );
    const cleaned = sanitizeMemoryContent('click javascript:alert(1) here');
    if (cleaned.includes("javascript:")) throw new Error("javascript: not removed");
    return true;
  });

  console.log("");

  // Test 8: Embedding consistency
  console.log("8. Embedding consistency");

  await test("相同文本产生相同维度向量", async () => {
    const [vec1] = await embed(["hello world"]);
    if (!vec1 || vec1.length !== 384) throw new Error(`Expected 384 dims, got ${vec1?.length}`);
    return true;
  });

  await test("批量 embedding", async () => {
    const vecs = await embed(["text one", "text two", "text three"]);
    if (vecs.length !== 3) throw new Error(`Expected 3 vectors, got ${vecs.length}`);
    if (!vecs.every((v) => v.length === 384)) throw new Error("Not all vectors are 384 dims");
    return true;
  });

  console.log("");

  // Cleanup
  console.log("9. Cleanup");

  try {
    await prisma.$executeRawUnsafe(
      "DELETE FROM memory_fts WHERE rowid IN (SELECT rowid FROM MemoryEntry WHERE repoId = ? AND userId = ?)",
      TEST_REPO_ID,
      TEST_USER_ID
    );
    await prisma.memoryEntry.deleteMany({
      where: { repoId: TEST_REPO_ID, userId: TEST_USER_ID },
    });
    await prisma.repo.delete({ where: { id: TEST_REPO_ID } }).catch(() => {});
    await prisma.user.delete({ where: { id: TEST_USER_ID } }).catch(() => {});
    console.log("  ✅ Test data cleaned\n");
  } catch (e) {
    console.log(`  ⚠️ Cleanup issue (non-fatal): ${(e as Error).message}\n`);
  }

  // Summary
  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
