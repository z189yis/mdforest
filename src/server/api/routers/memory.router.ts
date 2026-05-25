import { z } from "zod";
import { router, repoReadProcedure, repoWriteProcedure } from "@/server/api/trpc";

export const memoryRouter = router({
  markers: repoReadProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      const repoCommits = await ctx.prisma.commitCache.findMany({
        where: { repoId: input.repoId },
        select: { commitHash: true, shortHash: true },
      });
      const validHashes = new Set<string>();
      for (const c of repoCommits) {
        validHashes.add(c.commitHash);
        validHashes.add(c.shortHash);
        validHashes.add(c.commitHash.substring(0, 8));
      }

      const allMarkers = await ctx.prisma.memoryEntry.findMany({
        where: { userId: ctx.user.id },
        select: {
          id: true, type: true, summary: true, content: true,
          confidence: true, source: true, commitHash: true,
          markerX: true, markerY: true, createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      });

      return allMarkers.filter(
        (m) => !m.commitHash || validHashes.has(m.commitHash)
      );
    }),

  detail: repoReadProcedure
    .input(z.object({ repoId: z.string(), memoryId: z.string() }))
    .query(async ({ ctx, input }) => {
      const memory = await ctx.prisma.memoryEntry.findFirst({
        where: { id: input.memoryId, userId: ctx.user.id },
      });
      if (memory) {
        await ctx.prisma.memoryEntry.update({
          where: { id: input.memoryId },
          data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
        });
      }
      return memory;
    }),

  /** 更新记忆标记的 Canvas 位置（拖拽后保存） */
  updateMarkerPosition: repoWriteProcedure
    .input(z.object({
      repoId: z.string(),
      memoryId: z.string(),
      markerX: z.number(),
      markerY: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.memoryEntry.update({
        where: { id: input.memoryId },
        data: { markerX: input.markerX, markerY: input.markerY },
      });
      return { success: true };
    }),
});
