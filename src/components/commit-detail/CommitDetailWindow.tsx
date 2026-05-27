"use client";

import { trpc } from "@/lib/trpc/client";
import { FloatingWindow } from "@/components/layout/FloatingWindow";
import { CommitDiffView } from "./CommitDiffView";
import { BoundDocsList } from "./BoundDocsList";
import { BindDocForm } from "./BindDocForm";
import { Badge, Spinner } from "@/components/ui";
import type { WindowState } from "@/lib/hooks/useWindowManager";

interface CommitDetailWindowProps {
  window: WindowState;
  repoId: string;
  onDocClick?: (docId: string) => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
}

export function CommitDetailWindow({
  window: win,
  repoId,
  onDocClick,
  onMove,
  onResize,
  onFocus,
  onClose,
  onMinimize,
}: CommitDetailWindowProps) {
  const { data, isLoading, error } = trpc.git.commitDetail.useQuery({
    repoId,
    hash: win.id,
  });
  const utils = trpc.useUtils();

  const handleBindingChange = () => {
    utils.git.commitDetail.invalidate({ repoId, hash: win.id });
    utils.git.docLeaves.invalidate({ repoId });
  };

  return (
    <FloatingWindow
      x={win.x}
      y={win.y}
      width={win.width}
      height={win.height}
      zIndex={win.zIndex}
      minimized={win.minimized}
      title={win.title}
      windowKind="commit"
      onMove={onMove}
      onResize={onResize}
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
    >
      <div className="flex flex-col h-full overflow-auto p-4">
        {isLoading && (
          <div className="flex items-center justify-center h-32">
            <Spinner />
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-32 text-sm text-red-500">
            Failed to load commit details
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Commit header */}
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <code className="text-xs font-mono text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded">
                  {data.commit.shortHash}
                </code>
                {data.commit.branches.map((b) => (
                  <Badge key={b} color="indigo">{b}</Badge>
                ))}
                {data.commit.tags.map((t) => (
                  <Badge key={t} color="green">{t}</Badge>
                ))}
              </div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {data.commit.message}
              </p>
              {data.commit.messageBody && (
                <pre className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap">
                  {data.commit.messageBody}
                </pre>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs text-zinc-400">
                <span>{data.commit.authorName}</span>
                <span>·</span>
                <span>{new Date(data.commit.authorDate).toLocaleString()}</span>
              </div>
            </div>

            <hr className="border-zinc-200 dark:border-zinc-800" />

            {/* Linked documents */}
            <div>
              <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Linked Documents
              </h4>
              <BoundDocsList
                repoId={repoId}
                docs={data.boundDocuments}
                onDocClick={onDocClick}
              />
            </div>

            {/* Link a document */}
            <div>
              <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Link a Document
              </h4>
              <BindDocForm
                repoId={repoId}
                cacheId={data.cacheId}
                onBound={handleBindingChange}
              />
            </div>

            <hr className="border-zinc-200 dark:border-zinc-800" />

            {/* Diff */}
            <div>
              <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Changes ({data.diff.files.length} files)
              </h4>
              <CommitDiffView diff={data.diff} />
            </div>
          </div>
        )}
      </div>
    </FloatingWindow>
  );
}
