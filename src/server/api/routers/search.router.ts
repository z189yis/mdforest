import { z } from "zod";
import { protectedProcedure, router } from "@/server/api/trpc";

export const searchRouter = router({
  query: protectedProcedure
    .input(z.object({ query: z.string().min(1), repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      const like = `%${input.query}%`;

      const commits = await ctx.prisma.commitCache.findMany({
        where: {
          repoId: input.repoId,
          OR: [
            { message: { contains: input.query } },
            { messageBody: { contains: input.query } },
            { authorName: { contains: input.query } },
            { commitHash: { contains: input.query } },
          ],
        },
        select: {
          id: true,
          commitHash: true,
          shortHash: true,
          message: true,
          authorName: true,
          authorDate: true,
        },
        orderBy: { authorDate: "desc" },
        take: 50,
      });

      const documents = await ctx.prisma.document.findMany({
        where: {
          repoId: input.repoId,
          OR: [
            { title: { contains: input.query } },
            { content: { contains: input.query } },
          ],
        },
        select: {
          id: true,
          title: true,
          filename: true,
          content: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
      });

      return { commits, documents };
    }),
});
