import { z } from "zod";
import { router, repoReadProcedure } from "@/server/api/trpc";

export const memoryRouter = router({
  /**
   * 获取 Canvas 渲染所需的 Memory Markers 数据
   */
  markers: repoReadProcedure
    .input(
      z.object({
        repoId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.memoryEntry.findMany({
        where: {
          repoId: input.repoId,
          userId: ctx.user.id,
        },
        select: {
          id: true,
          type: true,
          summary: true,
          content: true,
          confidence: true,
          source: true,
          commitHash: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
    }),

  /**
   * 获取单条记忆详情（点击 Marker 时）
   */
  detail: repoReadProcedure
    .input(
      z.object({
        repoId: z.string(),
        memoryId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const memory = await ctx.prisma.memoryEntry.findFirst({
        where: {
          id: input.memoryId,
          repoId: input.repoId,
        },
      });

      if (memory) {
        // 增加访问计数
        await ctx.prisma.memoryEntry.update({
          where: { id: input.memoryId },
          data: {
            accessCount: { increment: 1 },
            lastAccessedAt: new Date(),
          },
        });
      }

      return memory;
    }),
});
