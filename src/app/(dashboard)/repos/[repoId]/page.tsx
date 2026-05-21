"use client";

import { useParams } from "next/navigation";
import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { useGitTree } from "@/lib/hooks/useGitTree";
import { GitTreeCanvas } from "@/components/git-tree/GitTreeCanvas";
import { CommitDetailPanel } from "@/components/commit-detail/CommitDetailPanel";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import { CollaborativeEditor } from "@/components/editor/CollaborativeEditor";
import { useYjsProvider } from "@/lib/hooks/useYjsProvider";
import { AvatarList } from "@/components/collaboration/AvatarList";
import { ConflictToast } from "@/components/collaboration/ConflictToast";
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
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Collaborative editing
  const collabEnabled = process.env.NEXT_PUBLIC_COLLAB_ENABLED === "true";
  const {
    ydoc,
    awareness,
    isSynced,
    connectionStatus,
  } = useYjsProvider(collabEnabled ? selectedDocId : null);

  // Fetch selected doc content
  const { data: selectedDoc } = trpc.document.get.useQuery(
    { docId: selectedDocId! },
    { enabled: !!selectedDocId }
  );
  const utils = trpc.useUtils();
  const saveDoc = trpc.document.update.useMutation({
    onSuccess: () => {
      toast.success("Saved");
      utils.document.get.invalidate({ docId: selectedDocId! });
      utils.git.docLeaves.invalidate({ repoId });
    },
    onError: (err) => toast.error(err.message),
  });

  const bindByHash = trpc.binding.createAndBindByHash.useMutation({
    onSuccess: () => {
      toast.success("Document linked");
      utils.git.docLeaves.invalidate({ repoId });
      refetchTree();
    },
    onError: (err) => toast.error(err.message),
  });

  const createIsolated = trpc.binding.createIsolated.useMutation({
    onSuccess: () => {
      toast.success("Isolated leaf created");
      utils.git.docLeaves.invalidate({ repoId });
    },
    onError: (err) => toast.error(err.message),
  });

  const updateLeafPosition = trpc.document.updateLeafPosition.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const handleCommitClick = useCallback((hash: string) => setSelectedCommitHash(hash), []);
  const handleDocClick = useCallback((docId: string) => setSelectedDocId(docId), []);

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
    },
    [updateLeafPosition]
  );

  // Panel config
  const panels = useMemo(() => [
    { id: "tree", minWidth: 280, defaultWidth: 400, visible: true },
    { id: "md", minWidth: 280, defaultWidth: 400, visible: !!selectedDocId },
    { id: "detail", minWidth: 300, defaultWidth: 380, visible: !!selectedCommitHash },
  ], [selectedDocId, selectedCommitHash]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Spinner /></div>;
  }

  if (error || !repo) {
    return <div className="flex items-center justify-center h-full"><div className="text-center text-red-500">Failed to load repository</div></div>;
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
          {selectedDocId && (
            <button onClick={() => setShowPreview(!showPreview)}
              className="text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700">
              {showPreview ? "Edit" : "Preview"}
            </button>
          )}
          <SearchBar repoId={repoId} />
        </div>
      </div>

      {/* Panels */}
      <ResizablePanels panels={panels}>
        {/* Left: Git Tree */}
        <div className="relative h-full">
          {repo.cloneStatus === "ready" ? (
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
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-zinc-500">
                <Spinner className="mx-auto mb-3" />
                <p className="text-sm">{repo.cloneStatus === "error" ? `Clone failed: ${repo.cloneError ?? "?"}` : "Cloning..."}</p>
              </div>
            </div>
          )}
        </div>

        {/* Center: MD Editor/Preview */}
        <div className="flex flex-col h-full bg-white dark:bg-zinc-950">
          {selectedDocId && selectedDoc ? (
            <>
              <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2 flex-shrink-0">
                <svg className="h-3.5 w-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                </svg>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">{selectedDoc.title}</span>
                {collabEnabled && awareness && (
                  <>
                    <AvatarList awareness={awareness} />
                    <ConflictToast awareness={awareness} currentUserName="You" />
                  </>
                )}
                {!collabEnabled && (
                  <button onClick={() => saveDoc.mutate({ docId: selectedDoc.id, content: selectedDoc.content })}
                    className="ml-auto text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-600 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50">
                    Save
                  </button>
                )}
                <button onClick={() => setSelectedDocId(null)}
                  className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">✕</button>
              </div>
              <div className="flex-1 overflow-hidden">
                {showPreview ? (
                  <MarkdownPreview content={selectedDoc.content || ""} />
                ) : collabEnabled && ydoc && awareness ? (
                  <CollaborativeEditor
                    ydoc={ydoc}
                    awareness={awareness}
                    connectionStatus={connectionStatus}
                  />
                ) : (
                  <MarkdownEditor
                    value={selectedDoc.content || ""}
                    onChange={(content) => {
                      selectedDoc.content = content;
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
              Click a leaf icon on the tree to open a document
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
                onDocClick={(docId) => setSelectedDocId(docId)}
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
  );
}
