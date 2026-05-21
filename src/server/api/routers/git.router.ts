import { z } from "zod";
import { protectedProcedure, router } from "@/server/api/trpc";
import { gitLogAll, gitLogBranch, gitShow, gitBranches, parseDiff } from "@/server/git/cli";
import { buildGitTree } from "@/server/git/tree-builder";
import { getRepoPath } from "@/server/git/clone";

function arrToJson(arr: string[]): string {
  return JSON.stringify(arr);
}

function jsonToArr(json: string | string[]): string[] {
  if (Array.isArray(json)) return json;
  try { return JSON.parse(json); } catch { return []; }
}

export const gitRouter = router({
  tree: protectedProcedure
    .input(z.object({ repoId: z.string(), branch: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const repo = await ctx.prisma.repo.findFirst({
        where: { id: input.repoId, ownerId: ctx.user.id },
      });
      if (!repo) throw new Error("Repository not found");

      const entries = input.branch
        ? await gitLogBranch(repo.localPath, input.branch, 0, 500)
        : await gitLogAll(repo.localPath);
      const tree = buildGitTree(entries);

      // Cache commits in database
      for (const entry of entries) {
        const branches: string[] = [];
        const tags: string[] = [];
        for (const ref of entry.refs) {
          if (ref.startsWith("tag: ")) tags.push(ref.replace("tag: ", ""));
          else branches.push(ref.replace("HEAD -> ", "").replace("origin/", "").trim());
        }

        const uniqueBranches = [...new Set(branches)].filter(Boolean);
        const uniqueTags = [...new Set(tags)].filter(Boolean);

        try {
          await ctx.prisma.commitCache.upsert({
            where: { repoId_commitHash: { repoId: repo.id, commitHash: entry.hash } },
            update: {
              shortHash: entry.shortHash,
              parentHashes: arrToJson(entry.parentHashes),
              authorName: entry.authorName,
              authorEmail: entry.authorEmail,
              authorDate: entry.authorDate,
              message: entry.message,
              branches: arrToJson(uniqueBranches),
              tags: arrToJson(uniqueTags),
              isMerge: entry.isMerge,
            },
            create: {
              repoId: repo.id,
              commitHash: entry.hash,
              shortHash: entry.shortHash,
              parentHashes: arrToJson(entry.parentHashes),
              authorName: entry.authorName,
              authorEmail: entry.authorEmail,
              authorDate: entry.authorDate,
              message: entry.message,
              branches: arrToJson(uniqueBranches),
              tags: arrToJson(uniqueTags),
              isMerge: entry.isMerge,
            },
          });
        } catch {
          // Ignore duplicate key errors
        }
      }

      return tree;
    }),

  /** Leaves with positions, connections, and isolated documents */
  docLeaves: protectedProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      type LeafData = { id: string; title: string; leafX: number | null; leafY: number | null; connectedHashes: string[] };

      const [docs, bindings] = await Promise.all([
        ctx.prisma.document.findMany({
          where: { repoId: input.repoId, ownerId: ctx.user.id },
          select: { id: true, title: true, leafX: true, leafY: true },
          take: 5000,
        }),
        ctx.prisma.commitDocumentBinding.findMany({
          where: { document: { repoId: input.repoId } },
          include: { document: { select: { id: true } }, commit: { select: { commitHash: true } } },
          take: 5000,
        }),
      ]);

      // Build connection map: docId → connected commit hashes
      const docConnections = new Map<string, string[]>();
      for (const b of bindings) {
        const arr = docConnections.get(b.document.id);
        if (arr) arr.push(b.commit.commitHash);
        else docConnections.set(b.document.id, [b.commit.commitHash]);
      }

      const leafMap: Record<string, LeafData> = {};
      const byCommit: Record<string, LeafData[]> = {};
      const isolated: LeafData[] = [];

      for (const d of docs) {
        const hashes = docConnections.get(d.id) ?? [];
        const leaf: LeafData = { id: d.id, title: d.title, leafX: d.leafX, leafY: d.leafY, connectedHashes: hashes };
        leafMap[d.id] = leaf;

        if (hashes.length === 0) {
          isolated.push(leaf);
        } else {
          for (const h of hashes) {
            if (!byCommit[h]) byCommit[h] = [];
            byCommit[h]!.push(leaf);
          }
        }
      }

      return { byCommit, isolated, leafMap };
    }),

  commitDetail: protectedProcedure
    .input(z.object({ repoId: z.string(), hash: z.string() }))
    .query(async ({ ctx, input }) => {
      const repo = await ctx.prisma.repo.findFirst({
        where: { id: input.repoId, ownerId: ctx.user.id },
      });
      if (!repo) throw new Error("Repository not found");

      const { commit, diff } = await gitShow(repo.localPath, input.hash);
      const diffResult = parseDiff(diff);

      const cached = await ctx.prisma.commitCache.findUnique({
        where: { repoId_commitHash: { repoId: repo.id, commitHash: input.hash } },
      });

      const bindings = cached
        ? await ctx.prisma.commitDocumentBinding.findMany({
            where: { commitId: cached.id },
            include: { document: true },
          })
        : [];

      return {
        commit: {
          hash: commit.hash,
          shortHash: commit.shortHash,
          authorName: commit.authorName,
          authorEmail: commit.authorEmail,
          authorDate: commit.authorDate,
          message: commit.message,
          messageBody: commit.messageBody,
          parentHashes: commit.parentHashes,
          branches: cached ? jsonToArr(cached.branches) : [],
          tags: cached ? jsonToArr(cached.tags) : [],
          isMerge: commit.isMerge,
        },
        diff: diffResult,
        boundDocuments: bindings.map((b) => b.document),
        cacheId: cached?.id,
      };
    }),

  branches: protectedProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      const repo = await ctx.prisma.repo.findFirst({
        where: { id: input.repoId, ownerId: ctx.user.id },
      });
      if (!repo) throw new Error("Repository not found");

      return gitBranches(repo.localPath);
    }),
});
