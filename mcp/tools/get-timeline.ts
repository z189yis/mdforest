import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getUserId, getRepoId } from "../auth";

export function registerGetTimeline(server: McpServer) {
  server.registerTool(
    "get_timeline_context",
    {
      description: `Get memories ordered chronologically, useful for understanding project history.

Use this tool when you need to understand:
- What decisions were made and when
- The sequence of events in the project
- Recent activity and context
- How preferences and conventions evolved over time`,
      inputSchema: {
        type: z
          .enum(["fact", "preference", "event", "procedure", "decision"])
          .optional()
          .describe("Optional: filter by memory type"),
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results to return. Default: 10"),
        daysBack: z
          .number()
          .min(1)
          .max(365)
          .optional()
          .describe("Only return memories from the last N days. Optional."),
      },
    },
    async (input) => {
      const userId = getUserId();
      const repoId = getRepoId();

      const dateFilter =
        input.daysBack != null
          ? {
              createdAt: {
                gte: new Date(
                  Date.now() - input.daysBack * 24 * 60 * 60 * 1000
                ),
              },
            }
          : {};

      const memories = await prisma.memoryEntry.findMany({
        where: {
          repoId,
          userId,
          ...(input.type ? { type: input.type } : {}),
          ...dateFilter,
        },
        select: {
          id: true,
          type: true,
          content: true,
          summary: true,
          confidence: true,
          source: true,
          commitHash: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: input.limit ?? 10,
      });

      if (memories.length === 0) {
        return {
          content: [
            { type: "text", text: "No memories found in the timeline." },
          ],
        };
      }

      const timeline = memories
        .map((m) => {
          const date = new Date(m.createdAt).toISOString().split("T")[0];
          return `[${date}] [${m.id}] [${m.type}] ${m.summary ?? m.content.substring(0, 100)}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Timeline (${memories.length} memories):\n\n${timeline}`,
          },
        ],
      };
    }
  );
}
