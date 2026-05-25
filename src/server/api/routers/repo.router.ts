import { z } from "zod";
import { protectedProcedure, repoReadProcedure, repoWriteProcedure, router } from "@/server/api/trpc";
import { cloneRepo, deleteRepoDir, getRepoPath } from "@/server/git/clone";
import { prisma } from "@/server/db/prisma";

function startClone(repoId: string, remoteUrl: string) {
  cloneRepo(repoId, remoteUrl, async (status, error) => {
    try {
      await prisma.repo.update({
        where: { id: repoId },
        data: {
          cloneStatus: status,
          ...(error ? { cloneError: error } : {}),
        },
      });
    } catch (dbErr) {
      console.error(`[repo] Failed to update cloneStatus for ${repoId}:`, dbErr);
    }
  }).catch((cloneErr) => {
    console.error(`[repo] cloneRepo promise rejected for ${repoId}:`, cloneErr);
    // Final fallback — mark as error in DB
    prisma.repo.update({
      where: { id: repoId },
      data: {
        cloneStatus: "error",
        cloneError: cloneErr instanceof Error ? cloneErr.message : "Unknown clone failure",
      },
    }).catch(() => {});
  });
}

export const repoRouter = router({
  /** List repos owned by or collaborated with the user */
  list: protectedProcedure.query(async ({ ctx }) => {
    const collaboratorRepoIds = await ctx.prisma.repoCollaborator.findMany({
      where: { userId: ctx.user.id },
      select: { repoId: true },
    });
    const collabIds = collaboratorRepoIds.map((c) => c.repoId);

    // Opportunistic recovery: repos stuck in "cloning" after a server restart
    // can't possibly still be cloning — reset them to pending so the user can retry.
    const stuckRepos = await ctx.prisma.repo.findMany({
      where: {
        cloneStatus: "cloning",
      },
      select: { id: true },
    });

    if (stuckRepos.length > 0) {
      await ctx.prisma.repo.updateMany({
        where: { id: { in: stuckRepos.map((r) => r.id) } },
        data: { cloneStatus: "pending", cloneError: null },
      });
      console.error(`[repo] Reset ${stuckRepos.length} stuck cloning repos to pending`);
    }

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
      const repo = await ctx.prisma.repo.create({
        data: {
          name: input.name,
          remoteUrl: input.remoteUrl,
          localPath: getRepoPath(""),
          ownerId: ctx.user.id,
          cloneStatus: "pending",
        },
      });

      const realPath = getRepoPath(repo.id);
      await ctx.prisma.repo.update({
        where: { id: repo.id },
        data: { localPath: realPath },
      });

      // Fire-and-forget clone (errors are logged + persisted to DB)
      startClone(repo.id, input.remoteUrl);

      return { id: repo.id, name: repo.name, remoteUrl: repo.remoteUrl };
    }),

  /** Retry a failed or stuck clone */
  retryClone: repoWriteProcedure
    .input(z.object({ repoId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const repo = await ctx.prisma.repo.findUnique({
        where: { id: input.repoId },
        select: { remoteUrl: true, cloneStatus: true },
      });

      if (!repo) {
        throw new Error("Repository not found");
      }

      if (repo.cloneStatus === "ready") {
        throw new Error("Repository is already cloned");
      }

      // Reset to pending and restart
      await ctx.prisma.repo.update({
        where: { id: input.repoId },
        data: { cloneStatus: "pending", cloneError: null },
      });

      startClone(input.repoId, repo.remoteUrl);

      return { cloneStatus: "pending" as const };
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
