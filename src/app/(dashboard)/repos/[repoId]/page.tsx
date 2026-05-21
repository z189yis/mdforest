"use client";

import { useParams } from "next/navigation";
import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { useGitTree } from "@/lib/hooks/useGitTree";
import { useWindowManager } from "@/lib/hooks/useWindowManager";
import { GitTreeCanvas } from "@/components/git-tree/GitTreeCanvas";
import { CommitDetailPanel } from "@/components/commit-detail/CommitDetailPanel";
import { MDWindow } from "@/components/editor/MDWindow";
import { useYjsProvider } from "@/lib/hooks/useYjsProvider";
import { useCollaborativeLeaves } from "@/lib/hooks/useCollaborativeLeaves";
import { ViewportIndicator } from "@/components/collaboration/ViewportIndicator";
import { SearchBar } from "@/components/search/SearchBar";
import { ResizablePanels } from "@/components/layout/ResizablePanels";
import { Spinner } from "@/components/ui";
import { toast } from "sonner";

export default function RepoTreePage() {
  const { repoId } = useParams<{ repoId: string }>();
  const { data: repo, isLoading, error } = trpc.repo.get.useQuery({ repoId });
  const { data: branches } = trpc.git.branches.useQuery({ repoId });
  const { data: docLeaves } = trpc.git.docLeaves.useQuery({ repoId });

  const [branch, setBranch] = useState<string | undefined>(undefined);
  const { tree, isLoading: treeLoading, error: treeError, refetch: refetchTree, fetchMore, hasMore, isFetchingMore, totalCount } = useGitTree(repoId, branch);

  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);

  // Window manager for MD documents
  const {
    windows,
    open: openWindow,
    close: closeWindow,
    focus: focusWindow,
    minimize: minimizeWindow,
    updatePosition,
    updateSize,
    restore: restoreWindow,
  } = useWindowManager();

  // Collaborative editing (active window's doc)
  const collabEnabled = process.env.NEXT_PUBLIC_COLLAB_ENABLED === "true";

  // Find the focused (topmost) non-minimized window for collaboration
  const focusedWindow = useMemo(() => {
    const visible = windows.filter((w) => !w.minimized);
    if (visible.length === 0) return null;
    return visible.reduce((a, b) => (a.zIndex > b.zIndex ? a : b));
  }, [windows]);

  const {
    ydoc,
    awareness,
    connectionStatus,
  } = useYjsProvider(collabEnabled ? (focusedWindow?.id ?? null) : null);

  const utils = trpc.useUtils();
  const updateLeafPosition = trpc.document.updateLeafPosition.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const handleRemoteLeafChange = useCallback(
    (leafId: string, x: number, y: number) => {
      updateLeafPosition.mutate({ docId: leafId, leafX: x, leafY: y });
      utils.git.docLeaves.invalidate({ repoId });
    },
    [repoId, utils, updateLeafPosition]
  );
  const { setLeafPosition } = useCollaborativeLeaves(
    collabEnabled ? ydoc : null,
    collabEnabled ? handleRemoteLeafChange : undefined,
  );

  const bindByHash = trpc.binding.createAndBindByHash.useMutation({
    onSuccess: () => {
      toast.success("Document linked");
      utils.git.docLeaves.invalidate({ repoId });
      refetchTree();
    },
    onError: (err) => toast.error(err.message),
  });

  const createIsolated = trpc.binding.createIsolated.useMutation({
    onSuccess: (data) => {
      toast.success("Isolated leaf created");
      utils.git.docLeaves.invalidate({ repoId });
      // Open the newly created doc
      openWindow(data.id, data.title);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCommitClick = useCallback((hash: string) => setSelectedCommitHash(hash), []);

  // Open doc in a floating window
  const handleDocClick = useCallback(
    (docId: string) => {
      // Find doc title from leaves data
      const leaf = docLeaves?.leafMap?.[docId];
      openWindow(docId, leaf?.title ?? "Document");
    },
    [docLeaves, openWindow]
  );

  const handleFileDrop = useCallback(
    (hash: string | null, fileName: string, content: string, leafX: number, leafY: number) => {
      const title = fileName.replace(/\.md$/i, "");
      if (hash) {
        bindByHash.mutate({ repoId, commitHash: hash, title, content });
      } else {
        createIsolated.mutate({ repoId, title, content, leafX, leafY });
      }
    },
    [repoId, bindByHash, createIsolated]
  );

  const handleLeafPositionChange = useCallback(
    (docId: string, leafX: number, leafY: number) => {
      updateLeafPosition.mutate({ docId, leafX, leafY });
      if (collabEnabled) {
        setLeafPosition(docId, leafX, leafY);
      }
    },
    [updateLeafPosition, collabEnabled, setLeafPosition]
  );

  // Panel config: tree + detail only
  const panels = useMemo(() => [
    { id: "tree", minWidth: 280, defaultWidth: 420, visible: true },
    { id: "detail", minWidth: 300, defaultWidth: 380, visible: !!selectedCommitHash },
  ], [selectedCommitHash]);

  // Minimized window tabs at bottom
  const minimizedWindows = windows.filter((w) => w.minimized);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Spinner /></div>;
  }

  if (error || !repo) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-red-500">
          <p className="text-lg font-semibold">Failed to load repository</p>
          {error && <p className="text-xs mt-2 text-red-400">{error.message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3 flex-shrink-0">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{repo.name}</h2>

        {repo.cloneStatus === "ready" && branches && branches.length > 0 && (
          <select value={branch ?? ""} onChange={(e) => setBranch(e.target.value || undefined)}
            className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
        )}

        {repo.cloneStatus !== "ready" && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">{repo.cloneStatus}</span>
        )}
        {totalCount > 0 && <span className="text-xs text-zinc-400">{tree ? tree.nodes.length : 0}/{totalCount} commits</span>}

        <div className="ml-auto flex items-center gap-2">
          <SearchBar repoId={repoId} />
        </div>
      </div>

      {/* Panels: Tree + Detail */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0">
          <ResizablePanels panels={panels}>
          {/* Left: Git Tree */}
          <div className="relative h-full">
            {repo.cloneStatus === "ready" ? (
              <>
                <GitTreeCanvas
                  tree={tree} isLoading={treeLoading} error={treeError}
                  docLeaves={docLeaves}
                  onCommitClick={handleCommitClick}
                  onDocClick={handleDocClick}
                  onFileDrop={handleFileDrop}
                  onLeafPositionChange={handleLeafPositionChange}
                  onNeedMore={fetchMore}
                  hasMore={hasMore}
                  isFetchingMore={isFetchingMore}
                />
                {collabEnabled && awareness && (
                  <ViewportIndicator
                    awareness={awareness}
                    canvasWidth={800}
                    canvasHeight={600}
                  />
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-zinc-500">
                  <Spinner className="mx-auto mb-3" />
                  <p className="text-sm">{repo.cloneStatus === "error" ? `Clone failed: ${repo.cloneError ?? "?"}` : "Cloning..."}</p>
                </div>
              </div>
            )}
          </div>

          {/* Right: Commit Detail */}
          <div className="h-full overflow-auto bg-white dark:bg-zinc-950">
            {selectedCommitHash ? (
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Commit Detail</h4>
                  <button onClick={() => setSelectedCommitHash(null)}
                    className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">✕</button>
                </div>
                <CommitDetailPanel
                  repoId={repoId}
                  commitHash={selectedCommitHash}
                  onClose={() => setSelectedCommitHash(null)}
                  embedded
                  onDocClick={(docId) => {
                    const leaf = docLeaves?.leafMap?.[docId];
                    openWindow(docId, leaf?.title ?? "Document");
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
                Click a commit node to see details
              </div>
            )}
          </div>
        </ResizablePanels>
        </div>
      </div>

      {/* Floating MD Windows — render as fixed overlay outside flex layout */}
      {windows.map((w) => (
        <MDWindow
          key={w.id}
          window={w}
          onMove={(x, y) => updatePosition(w.id, x, y)}
          onResize={(width, height) => updateSize(w.id, width, height)}
          onFocus={() => focusWindow(w.id)}
          onClose={() => closeWindow(w.id)}
          onMinimize={() => minimizeWindow(w.id)}
          collabEnabled={collabEnabled}
          ydoc={collabEnabled && w.id === focusedWindow?.id ? ydoc : undefined}
          awareness={collabEnabled && w.id === focusedWindow?.id ? awareness : undefined}
          connectionStatus={collabEnabled && w.id === focusedWindow?.id ? connectionStatus : undefined}
        />
      ))}

      {/* Minimized window tabs */}
      {minimizedWindows.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 flex gap-1 px-2 py-1 bg-zinc-100 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-700 z-50">
          {minimizedWindows.map((w) => (
            <button
              key={w.id}
              onClick={() => restoreWindow(w.id)}
              className="text-xs px-2 py-0.5 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700 truncate max-w-[160px]"
            >
              <svg className="h-3 w-3 text-green-500 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
              </svg>
              {w.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
