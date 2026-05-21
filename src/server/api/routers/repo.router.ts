import { z } from "zod";
import { protectedProcedure, router } from "@/server/api/trpc";
import { cloneRepo, deleteRepoDir, getRepoPath } from "@/server/git/clone";
import { prisma } from "@/server/db/prisma";

export const repoRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.repo.findMany({
      where: { ownerId: ctx.user.id },
      orderBy: { updatedAt: "desc" },
    });
  }),

  get: protectedProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.repo.findFirst({
        where: { id: input.repoId, ownerId: ctx.user.id },
      });
    }),

  add: protectedProcedure
    .input(z.object({ remoteUrl: z.string().min(1), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const localPath = getRepoPath(""); // placeholder

      const repo = await ctx.prisma.repo.create({
        data: {
          name: input.name,
          remoteUrl: input.remoteUrl,
          localPath,
          ownerId: ctx.user.id,
          cloneStatus: "pending",
        },
      });

      // Update with real path
      const realPath = getRepoPath(repo.id);
      await ctx.prisma.repo.update({
        where: { id: repo.id },
        data: { localPath: realPath },
      });

      // Clone in background (use global prisma, not ctx.prisma)
      const repoId = repo.id;
      cloneRepo(repoId, input.remoteUrl, async (status, error) => {
        try {
          await prisma.repo.update({
            where: { id: repoId },
            data: {
              cloneStatus: status,
              ...(error ? { cloneError: error } : {}),
            },
          });
        } catch {
          // ignore db update errors in background
        }
      }).catch(() => {});

      return { id: repo.id, name: repo.name, remoteUrl: repo.remoteUrl };
    }),

  cloneStatus: protectedProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      const repo = await ctx.prisma.repo.findFirst({
        where: { id: input.repoId, ownerId: ctx.user.id },
        select: { cloneStatus: true, cloneError: true },
      });
      return repo ?? { cloneStatus: "error", cloneError: "Not found" };
    }),

  delete: protectedProcedure
    .input(z.object({ repoId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const repo = await ctx.prisma.repo.findFirst({
        where: { id: input.repoId, ownerId: ctx.user.id },
      });
      if (!repo) throw new Error("Repository not found");

      await deleteRepoDir(input.repoId);
      await ctx.prisma.repo.delete({ where: { id: input.repoId } });
      return { success: true };
    }),
});
