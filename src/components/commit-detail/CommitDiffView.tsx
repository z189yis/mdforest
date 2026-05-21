"use client";

import { useState } from "react";
import { DiffResult, DiffFile } from "@/server/git/types";

export function CommitDiffView({ diff }: { diff: DiffResult }) {
  if (diff.files.length === 0) {
    return <p className="text-sm text-zinc-400">No changes</p>;
  }

  return (
    <div className="space-y-2">
      {diff.files.map((file, i) => (
        <DiffFileView key={i} file={file} />
      ))}
    </div>
  );
}

function DiffFileView({ file }: { file: DiffFile }) {
  const [expanded, setExpanded] = useState(false);

  const statusColors = {
    added: "text-green-600 dark:text-green-400",
    modified: "text-yellow-600 dark:text-yellow-400",
    deleted: "text-red-600 dark:text-red-400",
    renamed: "text-blue-600 dark:text-blue-400",
  };

  const totalLines = file.hunks.reduce((sum, h) => sum + h.lines.length, 0);

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className={statusColors[file.status]}>{file.status}</span>
        <span className="font-mono text-zinc-700 dark:text-zinc-300">
          {file.path}
        </span>
        <span className="text-zinc-400 ml-auto">{totalLines} lines</span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 font-mono text-xs leading-relaxed overflow-x-auto">
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              <div className="px-3 py-0.5 bg-indigo-50/50 dark:bg-indigo-900/10 text-indigo-600 dark:text-indigo-400">
                {hunk.header}
              </div>
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  className={`px-3 py-0 whitespace-pre ${
                    line.type === "addition"
                      ? "bg-green-50 dark:bg-green-900/10 text-green-700 dark:text-green-400"
                      : line.type === "deletion"
                      ? "bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-400"
                      : "text-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  <span className="select-none inline-block w-4 mr-2 text-zinc-300 dark:text-zinc-600">
                    {line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " "}
                  </span>
                  {line.content}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
