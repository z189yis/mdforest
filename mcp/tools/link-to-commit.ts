import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getUserId, getRepoId } from "../auth";

export function registerLinkToCommit(server: McpServer) {
  server.registerTool(
    "link_to_commit",
    {
      description: `Link an existing memory to a specific git commit.

Use this tool when:
- A memory is related to a particular code change
- You realize a stored decision was implemented in a specific commit
- You want to associate a procedure with the commit that introduced it`,
      inputSchema: {
        memoryId: z
          .string()
          .describe("ID of the memory to update (from search_memory or add_memory result)"),
        commitHash: z
          .string()
          .describe("Full or short git commit hash to link to"),
      },
    },
    async (input) => {
      const userId = getUserId();
      const repoId = getRepoId();

      // Verify memory belongs to this user/repo
      const memory = await prisma.memoryEntry.findFirst({
        where: {
          id: input.memoryId,
          repoId,
          userId,
        },
      });

      if (!memory) {
        return {
          content: [
            {
              type: "text",
              text: `Memory [${input.memoryId}] not found or access denied.`,
            },
          ],
        };
      }

      await prisma.memoryEntry.update({
        where: { id: input.memoryId },
        data: { commitHash: input.commitHash },
      });

      return {
        content: [
          {
            type: "text",
            text: `Memory [${input.memoryId}] linked to commit ${input.commitHash}.`,
          },
        ],
      };
    }
  );
}
