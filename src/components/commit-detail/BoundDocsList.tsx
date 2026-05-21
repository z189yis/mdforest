"use client";

import { toast } from "sonner";

interface BoundDocsListProps {
  repoId: string;
  docs: Array<{ id: string; title: string; filename: string; updatedAt: Date | string }>;
  onDocClick?: (docId: string) => void;
}

export function BoundDocsList({ docs, onDocClick }: BoundDocsListProps) {
  if (docs.length === 0) {
    return <p className="text-sm text-zinc-400">No documents linked yet</p>;
  }

  return (
    <div className="space-y-1">
      {docs.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
          onClick={() => onDocClick?.(doc.id)}
        >
          <svg className="h-3.5 w-3.5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
          </svg>
          <span className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline flex-1 truncate">
            {doc.title}
          </span>
          <button
            className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-red-500 transition-opacity"
            onClick={() => {
              // We need binding ID; for now we just don't show the button
              // In production, pass binding IDs alongside docs
            }}
            title="Unlink"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
