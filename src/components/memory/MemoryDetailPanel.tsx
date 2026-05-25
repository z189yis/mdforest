"use client";

import { trpc } from "@/lib/trpc/client";
import { MEMORY_GLYPHS, type MemoryMarkerType } from "@/lib/hooks/useMemoryMarkers";
import { Spinner } from "@/components/ui";

const TYPE_COLORS: Record<string, string> = {
  fact:        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  preference:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  event:       "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  procedure:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  decision:    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

const SOURCE_LABELS: Record<string, string> = {
  user: "User stated",
  agent: "Agent inferred",
  tool: "Tool output",
  inferred: "System inferred",
};

interface Props {
  memoryId: string;
  repoId: string;
  onClose: () => void;
}

export function MemoryDetailPanel({ memoryId, repoId, onClose }: Props) {
  const { data: memory, isLoading } = trpc.memory.detail.useQuery({
    repoId,
    memoryId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (!memory) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-zinc-500">Memory not found</p>
      </div>
    );
  }

  const glyph = MEMORY_GLYPHS[memory.type as MemoryMarkerType] ?? MEMORY_GLYPHS.fact;
  const typeColor = TYPE_COLORS[memory.type] ?? TYPE_COLORS.fact;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span style={{ color: glyph.color }} className="text-lg">{glyph.glyph}</span>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor}`}>
          {memory.type}
        </span>
      </div>

      {/* Body */}
      <div>
        {/* Summary */}
        {memory.summary && (
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-2">
            {memory.summary}
          </p>
        )}

        {/* Content */}
        <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed">
          {memory.content}
        </p>

        {/* Metadata */}
        <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700 space-y-1.5">
          {/* Confidence */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Confidence</span>
            <span className="text-zinc-700 dark:text-zinc-300">
              {(memory.confidence * 100).toFixed(0)}%
            </span>
          </div>

          {/* Source */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Source</span>
            <span className="text-zinc-700 dark:text-zinc-300">
              {SOURCE_LABELS[memory.source] ?? memory.source}
            </span>
          </div>

          {/* Linked commit */}
          {memory.commitHash && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Commit</span>
              <code className="text-indigo-500 font-mono">{memory.commitHash.substring(0, 7)}</code>
            </div>
          )}

          {/* Created date */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Created</span>
            <span className="text-zinc-700 dark:text-zinc-300">
              {new Date(memory.createdAt).toLocaleString()}
            </span>
          </div>

          {/* Provenance */}
          {memory.provenance && (
            <div className="text-xs text-zinc-400 italic mt-1 pt-1 border-t border-zinc-100 dark:border-zinc-800">
              {memory.provenance}
            </div>
          )}

          {/* Access count */}
          {memory.accessCount > 0 && (
            <div className="text-xs text-zinc-400">
              Accessed {memory.accessCount} time{memory.accessCount > 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
