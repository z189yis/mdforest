import { z } from "zod";
import { protectedProcedure, router } from "@/server/api/trpc";

export const bindingRouter = router({
  listForCommit: protectedProcedure
    .input(z.object({ commitId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.commitDocumentBinding.findMany({
        where: { commitId: input.commitId },
        include: { document: true },
      });
    }),

  bind: protectedProcedure
    .input(z.object({ commitId: z.string(), documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.commitDocumentBinding.create({
        data: { commitId: input.commitId, documentId: input.documentId },
        include: { document: true },
      });
    }),

  unbind: protectedProcedure
    .input(z.object({ bindingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.commitDocumentBinding.delete({ where: { id: input.bindingId } });
      return { success: true };
    }),

  createAndBind: protectedProcedure
    .input(z.object({ commitId: z.string(), repoId: z.string(), title: z.string().min(1), content: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const filename = input.title.endsWith(".md") ? input.title : `${input.title}.md`;
      const doc = await ctx.prisma.document.create({
        data: {
          title: input.title,
          filename,
          content: input.content ?? "",
          repoId: input.repoId,
          ownerId: ctx.user.id,
        },
      });
      const binding = await ctx.prisma.commitDocumentBinding.create({
        data: { commitId: input.commitId, documentId: doc.id },
        include: { document: true },
      });
      return binding;
    }),

  /** Create a document without binding (isolated leaf at a position) */
  createIsolated: protectedProcedure
    .input(z.object({ repoId: z.string(), title: z.string().min(1), content: z.string().optional(), leafX: z.number(), leafY: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const filename = input.title.endsWith(".md") ? input.title : `${input.title}.md`;
      const doc = await ctx.prisma.document.create({
        data: {
          title: input.title,
          filename,
          content: input.content ?? "",
          repoId: input.repoId,
          ownerId: ctx.user.id,
          leafX: input.leafX,
          leafY: input.leafY,
        },
      });
      return doc;
    }),

  /** Bind by commit hash instead of cache ID — used by drag-and-drop */
  createAndBindByHash: protectedProcedure
    .input(z.object({ repoId: z.string(), commitHash: z.string(), title: z.string().min(1), content: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const cache = await ctx.prisma.commitCache.findUnique({
        where: { repoId_commitHash: { repoId: input.repoId, commitHash: input.commitHash } },
      });
      if (!cache) throw new Error("Commit not found in cache. Load the tree first.");

      const filename = input.title.endsWith(".md") ? input.title : `${input.title}.md`;
      const doc = await ctx.prisma.document.create({
        data: {
          title: input.title,
          filename,
          content: input.content ?? "",
          repoId: input.repoId,
          ownerId: ctx.user.id,
        },
      });
      await ctx.prisma.commitDocumentBinding.create({
        data: { commitId: cache.id, documentId: doc.id },
      });
      return doc;
    }),
});
