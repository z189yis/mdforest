"use client";

import Link from "next/link";

interface SearchResultsProps {
  results: {
    commits: Array<{
      id: string;
      commitHash: string;
      shortHash: string;
      message: string;
      authorName: string;
      authorDate: Date;
    }>;
    documents: Array<{
      id: string;
      title: string;
      content: string;
      updatedAt: Date;
    }>;
  };
  repoId: string;
  onSelect: () => void;
}

export function SearchResults({ results, repoId, onSelect }: SearchResultsProps) {
  const hasCommits = results.commits.length > 0;
  const hasDocs = results.documents.length > 0;

  if (!hasCommits && !hasDocs) return null;

  return (
    <div>
      {hasCommits && (
        <div>
          <div className="px-4 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-zinc-50 dark:bg-zinc-950">
            Commits
          </div>
          {results.commits.map((c) => (
            <Link
              key={c.id}
              href={`/repos/${repoId}?hash=${c.commitHash}`}
              onClick={onSelect}
              className="flex items-center gap-3 px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-sm"
            >
              <code className="text-xs text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 px-1.5 py-0.5 rounded flex-shrink-0">
                {c.shortHash}
              </code>
              <span className="text-zinc-700 dark:text-zinc-300 truncate">
                {c.message.length > 60 ? c.message.substring(0, 60) + "..." : c.message}
              </span>
            </Link>
          ))}
        </div>
      )}

      {hasDocs && (
        <div>
          <div className="px-4 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-zinc-50 dark:bg-zinc-950">
            Documents
          </div>
          {results.documents.map((d) => (
            <Link
              key={d.id}
              href={`/repos/${repoId}/docs/${d.id}`}
              onClick={onSelect}
              className="flex flex-col px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            >
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {d.title}
              </span>
              <span className="text-xs text-zinc-400 truncate mt-0.5">
                {d.content.substring(0, 100)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
