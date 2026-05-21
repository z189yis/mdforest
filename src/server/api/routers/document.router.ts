import { z } from "zod";
import { protectedProcedure, router } from "@/server/api/trpc";

export const documentRouter = router({
  list: protectedProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.document.findMany({
        where: { repoId: input.repoId, ownerId: ctx.user.id },
        orderBy: { updatedAt: "desc" },
      });
    }),

  get: protectedProcedure
    .input(z.object({ docId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.document.findFirst({
        where: { id: input.docId, ownerId: ctx.user.id },
      });
    }),

  create: protectedProcedure
    .input(z.object({ repoId: z.string(), title: z.string().min(1), content: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const filename = input.title.endsWith(".md") ? input.title : `${input.title}.md`;
      return ctx.prisma.document.create({
        data: {
          title: input.title,
          filename,
          content: input.content ?? "",
          repoId: input.repoId,
          ownerId: ctx.user.id,
        },
      });
    }),

  update: protectedProcedure
    .input(z.object({ docId: z.string(), content: z.string().optional(), title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.document.update({
        where: { id: input.docId },
        data: {
          ...(input.content !== undefined && { content: input.content }),
          ...(input.title !== undefined && { title: input.title }),
        },
      });
    }),

  updateLeafPosition: protectedProcedure
    .input(z.object({ docId: z.string(), leafX: z.number(), leafY: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.document.update({
        where: { id: input.docId },
        data: { leafX: input.leafX, leafY: input.leafY },
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ docId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.document.delete({ where: { id: input.docId } });
      return { success: true };
    }),
});
