import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMemory } from "@/server/memory/store";
import { embed } from "@/server/memory/embed";
import { getUserId, getRepoId } from "../auth";

export function registerAddMemory(server: McpServer) {
  server.registerTool(
    "add_memory",
    {
      description: `Store a piece of knowledge, decision, or preference for future retrieval.

Use this tool when you:
- Learn a new fact about the project (API ports, dependencies, architecture)
- Make a design decision and want to record the rationale
- Discover a user preference or convention
- Encounter a pitfall or error whose solution should be remembered
- Figure out a procedure or workflow that works

Choose the most specific type:
- fact: Verifiable information (port numbers, versions, dependencies, file paths)
- preference: User taste or coding convention (style choices, tool preferences)
- event: Things that happened (deployments, milestones, breaking changes)
- procedure: How-to steps (build commands, test workflows, release processes)
- decision: Design choices with rationale (why X over Y, architecture decisions)

You SHOULD call this whenever you make a design decision or learn something important about this project.`,
      inputSchema: {
        type: z
          .enum(["fact", "preference", "event", "procedure", "decision"])
          .describe("Category of this memory"),
        content: z
          .string()
          .min(1)
          .max(5000)
          .describe(
            "The memory content. Be specific and include rationale for decisions."
          ),
        summary: z
          .string()
          .max(200)
          .optional()
          .describe("Optional short summary for display purposes"),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Confidence level (0.0-1.0). Default: 1.0"),
        source: z
          .enum(["user", "agent", "tool", "inferred"])
          .optional()
          .describe("Source of this memory. Default: 'agent'"),
        provenance: z
          .string()
          .max(500)
          .optional()
          .describe("How this memory was obtained (e.g., 'user explicitly stated')"),
        commitHash: z
          .string()
          .optional()
          .describe("Associated git commit hash if applicable"),
      },
    },
    async (input) => {
      const userId = getUserId();
      const repoId = getRepoId();

      const [embedding] = await embed([
        input.summary ?? input.content,
      ]);

      const entry = await createMemory(
        {
          type: input.type,
          content: input.content,
          summary: input.summary,
          confidence: input.confidence,
          source: input.source as string | undefined,
          provenance: input.provenance,
          repoId,
          userId,
          commitHash: input.commitHash,
        },
        embedding!
      );

      return {
        content: [
          {
            type: "text",
            text: `Memory stored [${entry.id}]: [${input.type}] ${input.summary ?? input.content.substring(0, 80)}`,
          },
        ],
      };
    }
  );
}
