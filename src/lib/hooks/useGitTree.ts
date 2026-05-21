"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { trpc, vanillaClient } from "@/lib/trpc/client";
import type { GitTree } from "@/server/git/tree-builder";
import type { TreeState } from "@/server/git/tree-builder";

export function useGitTree(repoId: string, branch?: string) {
  const [accumulatedTree, setAccumulatedTree] = useState<GitTree | undefined>();
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const stateRef = useRef<TreeState | undefined>();
  const skipRef = useRef(0);
  const fetchingRef = useRef(false);

  // Initial page
  const initialQuery = trpc.git.tree.useQuery(
    { repoId, branch, skip: 0 },
    { enabled: !!repoId }
  );

  useEffect(() => {
    if (initialQuery.data && skipRef.current === 0) {
      setAccumulatedTree(initialQuery.data.tree);
      stateRef.current = initialQuery.data.state;
      skipRef.current = initialQuery.data.tree.nodes.length;
      setTotalCount(initialQuery.data.totalCount);
      setHasMore(initialQuery.data.hasMore);
    }
  }, [initialQuery.data]);

  const fetchMore = useCallback(async () => {
    if (fetchingRef.current || !hasMore || !stateRef.current) return;
    fetchingRef.current = true;
    setIsFetchingMore(true);

    try {
      const result = await vanillaClient.git.tree.query({
        repoId, branch, skip: skipRef.current, state: stateRef.current as any,
      });

      if (result.tree.nodes.length > 0) {
        setAccumulatedTree((prev) => {
          if (!prev) return result.tree;
          return {
            nodes: [...prev.nodes, ...result.tree.nodes],
            edges: [...prev.edges, ...result.tree.edges],
            totalHeight: result.tree.totalHeight,
            totalWidth: Math.max(prev.totalWidth, result.tree.totalWidth),
            maxColumn: Math.max(prev.maxColumn, result.tree.maxColumn),
          };
        });
        stateRef.current = result.state;
        skipRef.current += result.tree.nodes.length;
        setHasMore(result.hasMore);
      } else {
        setHasMore(false);
      }
    } finally {
      fetchingRef.current = false;
      setIsFetchingMore(false);
    }
  }, [hasMore, repoId, branch]);

  return {
    tree: accumulatedTree,
    isLoading: initialQuery.isLoading,
    error: initialQuery.error,
    refetch: initialQuery.refetch,
    fetchMore,
    hasMore,
    isFetchingMore,
    totalCount,
  };
}
