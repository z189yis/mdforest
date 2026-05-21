"use client";

import { trpc } from "@/lib/trpc/client";

export function useGitTree(repoId: string, branch?: string) {
  const { data, isLoading, error, refetch } = trpc.git.tree.useQuery(
    { repoId, branch },
    { enabled: !!repoId }
  );

  return {
    tree: data,
    isLoading,
    error,
    refetch,
  };
}
