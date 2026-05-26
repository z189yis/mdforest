#!/usr/bin/env npx tsx
/**
 * Phase 0 MCP Memory Server — 纯内存实现
 *
 * 验证目标：Agent 是否愿意主动使用记忆工具
 * 运行方式：npx tsx mcp/phase0-server.ts
 *
 * 不依赖数据库，不依赖 embedding，纯内存 Map 存储。
 * Phase 0 通过后，此文件将被 Phase 1 生产版替换。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ============================================================================
// 内存存储
// ============================================================================

interface Memory {
  id: string;
  type: "fact" | "preference" | "event" | "procedure" | "decision";
  content: string;
  createdAt: string;
}

const store = new Map<string, Memory>();
let nextId = 1;

// ============================================================================
// MCP Server
// ============================================================================

const server = new McpServer({
  name: "mdforest-memory-phase0",
  version: "0.1.0",
});

// ---- add_memory ----

server.registerTool(
  "add_memory",
  {
    description: `Store a piece of knowledge for future retrieval.

Use this tool when you learn something important that should be remembered across conversations:
- A design decision with rationale
- A user preference or convention
- A fact about the codebase (port numbers, dependencies, architecture)
- A procedure or workflow that works
- An event or milestone

Use these types:
- "decision": A design choice with rationale (e.g., "chose SQLite over Postgres because single-user")
- "fact": Verifiable information (e.g., "the API listens on port 3000")
- "preference": User taste or convention (e.g., "prefers functional components over classes")
- "procedure": How-to steps (e.g., "to run tests: npm test -- --coverage")
- "event": Something that happened (e.g., "deployed v2.3 to production on May 21")

You SHOULD call this whenever you make a design decision or learn something important about this project.`,
    inputSchema: {
      type: z.enum(["fact", "preference", "event", "procedure", "decision"]).describe(
        "Category of this memory"
      ),
      content: z.string().min(1).max(5000).describe(
        "The memory content. Be specific and include rationale for decisions."
      ),
    },
  },
  async ({ type, content }) => {
    const id = String(nextId++);
    const now = new Date().toISOString();

    store.set(id, {
      id,
      type: type as Memory["type"],
      content,
      createdAt: now,
    });

    return {
      content: [
        {
          type: "text",
          text: `Memory stored [${id}]: [${type}] ${content.substring(0, 80)}${content.length > 80 ? "..." : ""}`,
        },
      ],
    };
  }
);

// ---- search_memory ----

server.registerTool(
  "search_memory",
  {
    description: `Search stored memories by keyword matching.

Use this tool BEFORE answering questions about:
- Past design decisions or project architecture
- User preferences or coding conventions
- Previously encountered issues and solutions
- Project configuration or setup details

Provide space-separated keywords to match against all stored memory content.
You SHOULD call this at the start of each new conversation to recall project context.`,
    inputSchema: {
      query: z.string().min(1).describe(
        "Space-separated keywords to search. E.g., 'SQLite database decision'"
      ),
    },
  },
  async ({ query }) => {
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: Memory[] = [];

    for (const mem of store.values()) {
      const text = `${mem.type} ${mem.content}`.toLowerCase();
      if (keywords.some((kw) => text.includes(kw))) {
        results.push(mem);
      }
    }

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No memories found matching: "${query}"`,
          },
        ],
      };
    }

    // Show most recent first
    results.reverse();

    const output = results
      .map((m) => `[${m.id}] [${m.type}] ${m.content}`)
      .join("\n\n---\n\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${results.length} memories:\n\n${output}`,
        },
      ],
    };
  }
);

// ---- list_memories (bonus tool for debugging) ----

server.registerTool(
  "list_memories",
  {
    description: `List all stored memories, optionally filtered by type.

Useful for getting an overview of what has been stored. Returns memory IDs, types, and content previews.`,
    inputSchema: {
      type: z
        .enum(["fact", "preference", "event", "procedure", "decision"])
        .optional()
        .describe("Optional: filter by memory type"),
    },
  },
  async ({ type }) => {
    let memories = [...store.values()];

    if (type) {
      memories = memories.filter((m) => m.type === type);
    }

    if (memories.length === 0) {
      return {
        content: [{ type: "text", text: "No memories stored yet." }],
      };
    }

    const output = memories
      .map(
        (m) =>
          `[${m.id}] [${m.type}] ${m.content.substring(0, 100)}${m.content.length > 100 ? "..." : ""}`
      )
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `${memories.length} memories:\n\n${output}`,
        },
      ],
    };
  }
);

// ============================================================================
// 启动
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[phase0] mdforest memory server started (stdio)");
  console.error(`[phase0] Tools: add_memory, search_memory, list_memories`);
}

main().catch((err) => {
  console.error("[phase0] Fatal error:", err);
  process.exit(1);
});
