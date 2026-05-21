import { z } from "zod";
import { protectedProcedure, repoWriteProcedure, docReadProcedure, docWriteProcedure, router } from "@/server/api/trpc";

export const documentRouter = router({
  /** List docs in a repo (owned + collaborated) */
  list: protectedProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Include docs the user owns or has access to via collaboration
      return ctx.prisma.document.findMany({
        where: {
          repoId: input.repoId,
          OR: [
            { ownerId: ctx.user.id },
            { collaborators: { some: { userId: ctx.user.id } } },
            { isPublic: true },
          ],
        },
        orderBy: { updatedAt: "desc" },
      });
    }),

  get: docReadProcedure
    .input(z.object({ docId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.document.findUnique({
        where: { id: input.docId },
      });
    }),

  create: repoWriteProcedure
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

  update: docWriteProcedure
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

  updateLeafPosition: docWriteProcedure
    .input(z.object({ docId: z.string(), leafX: z.number(), leafY: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.document.update({
        where: { id: input.docId },
        data: { leafX: input.leafX, leafY: input.leafY },
      });
      return { success: true };
    }),

  delete: docWriteProcedure
    .input(z.object({ docId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.document.delete({ where: { id: input.docId } });
      return { success: true };
    }),
});
