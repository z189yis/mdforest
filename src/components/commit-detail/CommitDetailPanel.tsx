"use client";

import { trpc } from "@/lib/trpc/client";
import { CommitDiffView } from "./CommitDiffView";
import { BoundDocsList } from "./BoundDocsList";
import { BindDocForm } from "./BindDocForm";
import { Badge, Spinner } from "@/components/ui";

interface CommitDetailPanelProps {
  repoId: string;
  commitHash: string;
  onClose: () => void;
  embedded?: boolean;
  onDocClick?: (docId: string) => void;
}

export function CommitDetailPanel({ repoId, commitHash, onClose, embedded, onDocClick }: CommitDetailPanelProps) {
  const { data, isLoading, error } = trpc.git.commitDetail.useQuery({ repoId, hash: commitHash });
  const utils = trpc.useUtils();

  const handleBindingChange = () => {
    utils.git.commitDetail.invalidate({ repoId, hash: commitHash });
    utils.git.docLeaves.invalidate({ repoId });
  };

  const content = (
    <>
      {isLoading && <div className="flex justify-center py-16"><Spinner /></div>}

      {error && <div className="p-4 text-red-500 text-sm">Failed to load commit details</div>}

      {data && (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <code className="text-xs font-mono text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 rounded">
                {data.commit.shortHash}
              </code>
              {data.commit.branches.map((b) => <Badge key={b} color="indigo">{b}</Badge>)}
              {data.commit.tags.map((t) => <Badge key={t} color="green">{t}</Badge>)}
            </div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{data.commit.message}</p>
            {data.commit.messageBody && (
              <pre className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap">{data.commit.messageBody}</pre>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-zinc-400">
              <span>{data.commit.authorName}</span><span>·</span>
              <span>{new Date(data.commit.authorDate).toLocaleString()}</span>
            </div>
          </div>

          <hr className="border-zinc-200 dark:border-zinc-800" />

          <div>
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Linked Documents</h4>
            <BoundDocsList repoId={repoId} docs={data.boundDocuments} onDocClick={onDocClick} />
          </div>

          <div>
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Link a Document</h4>
            <BindDocForm repoId={repoId} cacheId={data.cacheId} onBound={handleBindingChange} />
          </div>

          <hr className="border-zinc-200 dark:border-zinc-800" />

          <div>
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Changes ({data.diff.files.length} files)</h4>
            <CommitDiffView diff={data.diff} />
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div className="p-1">{content}</div>;
  }

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-xl z-30 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Commit Detail</h3>
        <button onClick={onClose} className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">{content}</div>
    </div>
  );
}
