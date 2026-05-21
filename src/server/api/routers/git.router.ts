import { z } from "zod";
import { repoReadProcedure, router } from "@/server/api/trpc";
import { gitLogAll, gitLogBranch, gitCommitCount, gitShow, gitBranches, parseDiff } from "@/server/git/cli";
import { buildGitTree, createTreeState, type TreeState } from "@/server/git/tree-builder";
import { getRepoPath } from "@/server/git/clone";

const PAGE_SIZE = 200;

function arrToJson(arr: string[]): string {
  return JSON.stringify(arr);
}

function jsonToArr(json: string | string[]): string[] {
  if (Array.isArray(json)) return json;
  try { return JSON.parse(json); } catch { return []; }
}

export const gitRouter = router({
  tree: repoReadProcedure
    .input(z.object({
      repoId: z.string(),
      branch: z.string().optional(),
      skip: z.number().default(0),
      take: z.number().default(PAGE_SIZE),
      state: z.any().optional(), // TreeState from previous batch
    }))
    .query(async ({ ctx, input }) => {
      const repo = await ctx.prisma.repo.findUnique({
        where: { id: input.repoId },
      });
      if (!repo) throw new Error("Repository not found");

      const [entries, totalCount] = await Promise.all([
        input.branch
          ? gitLogBranch(repo.localPath, input.branch, input.skip, input.take)
          : gitLogAll(repo.localPath, input.skip, input.take),
        gitCommitCount(repo.localPath),
      ]);

      const prevState = (input.state as TreeState | undefined) ?? createTreeState();
      const { tree, state: nextState } = buildGitTree(entries, prevState);

      const hasMore = input.skip + entries.length < totalCount;

      // Cache commits in database (fire-and-forget)
      cacheCommits(ctx.prisma, repo.id, entries);

      return { tree, totalCount, hasMore, state: nextState as any, skip: input.skip };
    }),

  /** Leaves with positions, connections, and isolated documents */
  docLeaves: repoReadProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      type LeafData = { id: string; title: string; leafX: number | null; leafY: number | null; connectedHashes: string[] };

      const [docs, bindings] = await Promise.all([
        ctx.prisma.document.findMany({
          where: {
            repoId: input.repoId,
            OR: [
              { ownerId: ctx.user.id },
              { collaborators: { some: { userId: ctx.user.id } } },
              { isPublic: true },
            ],
          },
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

  commitDetail: repoReadProcedure
    .input(z.object({ repoId: z.string(), hash: z.string() }))
    .query(async ({ ctx, input }) => {
      const repo = await ctx.prisma.repo.findUnique({
        where: { id: input.repoId },
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

  branches: repoReadProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      const repo = await ctx.prisma.repo.findUnique({
        where: { id: input.repoId },
      });
      if (!repo) throw new Error("Repository not found");

      return gitBranches(repo.localPath);
    }),
});

// Fire-and-forget: cache commits in the database (errors are non-fatal)
async function cacheCommits(prisma: any, repoId: string, entries: any[]) {
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
      await prisma.commitCache.upsert({
        where: { repoId_commitHash: { repoId, commitHash: entry.hash } },
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
          repoId,
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
}
