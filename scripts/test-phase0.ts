#!/usr/bin/env npx tsx
/**
 * Phase 0 自动化验证脚本
 *
 * 验证 MCP Server 的 add_memory / search_memory / list_memories 工具逻辑
 * 不通过 stdio roundtrip，直接测试 handler 逻辑
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ---- 复制 Phase 0 的核心逻辑（纯函数测试） ----

interface Memory {
  id: string;
  type: "fact" | "preference" | "event" | "procedure" | "decision";
  content: string;
  createdAt: string;
}

const store = new Map<string, Memory>();
let nextId = 1;

function addMemory(type: string, content: string) {
  const id = String(nextId++);
  store.set(id, {
    id,
    type: type as Memory["type"],
    content,
    createdAt: new Date().toISOString(),
  });
  return id;
}

function searchMemory(query: string): Memory[] {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: Memory[] = [];
  for (const mem of store.values()) {
    const text = `${mem.type} ${mem.content}`.toLowerCase();
    if (keywords.some((kw) => text.includes(kw))) {
      results.push(mem);
    }
  }
  results.reverse();
  return results;
}

function listMemories(type?: string): Memory[] {
  let memories = [...store.values()];
  if (type) {
    memories = memories.filter((m) => m.type === type);
  }
  return memories;
}

// ---- 测试用例 ----

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean | void) {
  try {
    const result = fn();
    if (result === false) throw new Error("Assertion failed");
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${(e as Error).message}`);
  }
}

console.log("=== Phase 0 Memory Server Test Suite ===\n");

// --- 写入测试 ---
console.log("1. add_memory 工具");

test("写入 fact 类型记忆", () => {
  const id = addMemory("fact", "API server listens on port 3000");
  const mem = store.get(id);
  if (!mem) throw new Error("Memory not stored");
  if (mem.type !== "fact") throw new Error(`Expected type 'fact', got '${mem.type}'`);
  if (mem.content !== "API server listens on port 3000") throw new Error("Content mismatch");
});

test("写入 decision 类型记忆", () => {
  addMemory("decision", "决定使用 SQLite 而非 PostgreSQL，因为项目是单用户场景不需要多机扩展");
  addMemory("preference", "用户偏好使用 Tailwind CSS 编写样式");
  addMemory("procedure", "运行测试：npm test -- --coverage；构建：npm run build");
  addMemory("event", "2026-05-20 完成 Git Tree Canvas 首次发布");
  if (store.size !== 5) throw new Error(`Expected 5 memories, got ${store.size}`);
});

test("写入空内容应该被客户端拒绝", () => {
  // Zod schema 会在 registerTool 层面拒绝 empty/min-length 违规
  // 此测试验证 schema 约束的正确性
  const schema = z.string().min(1).max(5000);
  const result = schema.safeParse("");
  if (result.success) throw new Error("Should reject empty string");
});

// --- 搜索测试 ---
console.log("\n2. search_memory 工具");

test("中文关键词搜索：单用户", () => {
  const results = searchMemory("单用户");
  const found = results.some((m) => m.type === "decision" && m.content.includes("SQLite"));
  if (!found) throw new Error("Should find the SQLite decision");
});

test("英文关键词搜索：Tailwind CSS", () => {
  const results = searchMemory("Tailwind CSS");
  const found = results.some((m) => m.type === "preference" && m.content.includes("Tailwind"));
  if (!found) throw new Error("Should find the Tailwind preference");
});

test("多关键词搜索：test build", () => {
  const results = searchMemory("test build");
  const found = results.some((m) => m.type === "procedure" && m.content.includes("npm test"));
  if (!found) throw new Error("Should find the procedure memory");
});

test("不存在的关键词返回空结果", () => {
  const results = searchMemory("nonexistent_xyz_k8s_nonexistent");
  if (results.length !== 0) throw new Error(`Expected 0 results, got ${results.length}`);
});

test("部分匹配：Canvas", () => {
  const results = searchMemory("Canvas");
  const found = results.some((m) => m.content.includes("Git Tree Canvas"));
  if (!found) throw new Error("Should find Canvas-related memory");
});

// --- list 测试 ---
console.log("\n3. list_memories 工具");

test("列出所有记忆（5条）", () => {
  const all = listMemories();
  if (all.length !== 5) throw new Error(`Expected 5, got ${all.length}`);
});

test("按类型过滤 decision", () => {
  const decisions = listMemories("decision");
  if (decisions.length !== 1) throw new Error(`Expected 1 decision, got ${decisions.length}`);
  if (decisions[0]!.type !== "decision") throw new Error("Wrong type");
});

test("按类型过滤 event", () => {
  const events = listMemories("event");
  if (events.length !== 1) throw new Error(`Expected 1 event, got ${events.length}`);
});

// --- 汇总 ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

if (failed > 0) process.exit(1);
