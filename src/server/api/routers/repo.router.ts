import { z } from "zod";
import { protectedProcedure, repoReadProcedure, repoWriteProcedure, router } from "@/server/api/trpc";
import { cloneRepo, deleteRepoDir, getRepoPath } from "@/server/git/clone";
import { prisma } from "@/server/db/prisma";

export const repoRouter = router({
  /** List repos owned by or collaborated with the user */
  list: protectedProcedure.query(async ({ ctx }) => {
    const collaboratorRepoIds = await ctx.prisma.repoCollaborator.findMany({
      where: { userId: ctx.user.id },
      select: { repoId: true },
    });
    const collabIds = collaboratorRepoIds.map((c) => c.repoId);

    return ctx.prisma.repo.findMany({
      where: {
        OR: [
          { ownerId: ctx.user.id },
          { id: { in: collabIds } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
  }),

  get: repoReadProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.repo.findUnique({
        where: { id: input.repoId },
      });
    }),

  add: protectedProcedure
    .input(z.object({ remoteUrl: z.string().min(1), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const localPath = getRepoPath("");

      const repo = await ctx.prisma.repo.create({
        data: {
          name: input.name,
          remoteUrl: input.remoteUrl,
          localPath,
          ownerId: ctx.user.id,
          cloneStatus: "pending",
        },
      });

      const realPath = getRepoPath(repo.id);
      await ctx.prisma.repo.update({
        where: { id: repo.id },
        data: { localPath: realPath },
      });

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

  cloneStatus: repoReadProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.repo.findUnique({
        where: { id: input.repoId },
        select: { cloneStatus: true, cloneError: true },
      });
    }),

  delete: repoWriteProcedure
    .input(z.object({ repoId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await deleteRepoDir(input.repoId);
      await ctx.prisma.repo.delete({ where: { id: input.repoId } });
      return { success: true };
    }),
});
