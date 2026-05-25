import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { hybridSearch } from "@/server/memory/search";
import { embed } from "@/server/memory/embed";
import { getUserId, getRepoId } from "../auth";

export function registerSearchMemory(server: McpServer) {
  server.registerTool(
    "search_memory",
    {
      description: `Search stored memories using semantic + keyword hybrid search.

Use this tool when you need to recall:
- Past decisions and their rationale
- User preferences and conventions
- Project-specific facts and configurations
- Previous pitfalls and their solutions
- Procedures and workflows that worked before

You SHOULD call this at the start of each new conversation to recall project context,
and before making design decisions that might have prior context stored.`,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "Search query. Can be a natural language question or keywords. E.g., 'database choice' or 'what port does the API use?'"
          ),
        type: z
          .enum(["fact", "preference", "event", "procedure", "decision"])
          .optional()
          .describe("Optional: filter by memory type"),
        limit: z
          .number()
          .min(1)
          .max(20)
          .optional()
          .describe("Max results to return. Default: 5"),
      },
    },
    async (input) => {
      const userId = getUserId();
      const repoId = getRepoId();

      const [queryVec] = await embed([input.query]);

      const results = await hybridSearch(
        queryVec!,
        input.query,
        repoId,
        userId,
        input.type,
        input.limit ?? 5
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No memories found matching: "${input.query}"`,
            },
          ],
        };
      }

      const output = results
        .map(
          (r) =>
            `[${r.id}] [${r.type}] ${r.summary ?? r.content.substring(0, 120)} (score: ${r.score.toFixed(4)}, confidence: ${(r.confidence * 100).toFixed(0)}%)`
        )
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
}
