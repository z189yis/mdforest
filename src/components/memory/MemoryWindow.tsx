"use client";

import { trpc } from "@/lib/trpc/client";
import { FloatingWindow } from "@/components/layout/FloatingWindow";
import { MEMORY_GLYPHS, type MemoryMarkerType } from "@/lib/hooks/useMemoryMarkers";
import { Spinner } from "@/components/ui";
import type { WindowState } from "@/lib/hooks/useWindowManager";

const TYPE_COLORS: Record<string, string> = {
  fact:        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  preference:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  event:       "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  procedure:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  decision:    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

const SOURCE_LABELS: Record<string, string> = {
  user: "User",
  agent: "Agent",
  tool: "Tool",
  inferred: "Inferred",
};

interface MemoryWindowProps {
  window: WindowState;
  repoId: string;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
}

export function MemoryWindow({
  window: win,
  repoId,
  onMove,
  onResize,
  onFocus,
  onClose,
  onMinimize,
}: MemoryWindowProps) {
  const { data: memory, isLoading } = trpc.memory.detail.useQuery({
    repoId,
    memoryId: win.id,
  });

  return (
    <FloatingWindow
      x={win.x}
      y={win.y}
      width={win.width}
      height={win.height}
      zIndex={win.zIndex}
      minimized={win.minimized}
      title={win.title}
      onMove={onMove}
      onResize={onResize}
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
    >
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Spinner />
        </div>
      ) : !memory ? (
        <div className="flex items-center justify-center h-32 text-sm text-zinc-500">
          Memory not found
        </div>
      ) : (
        (() => {
          const glyph = MEMORY_GLYPHS[memory.type as MemoryMarkerType] ?? MEMORY_GLYPHS.fact;
          const typeColor = TYPE_COLORS[memory.type] ?? TYPE_COLORS.fact;
          return (
            <div className="flex flex-col h-full overflow-auto">
              {/* Header */}
              <div className="flex items-center gap-2 mb-3">
                <span style={{ color: glyph.color }} className="text-lg">{glyph.glyph}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor}`}>
                  {memory.type}
                </span>
                <span className="text-xs text-zinc-400">
                  {(memory.confidence * 100).toFixed(0)}% confidence
                </span>
                <span className="text-xs text-zinc-400">|</span>
                <span className="text-xs text-zinc-400">
                  {SOURCE_LABELS[memory.source] ?? memory.source}
                </span>
              </div>

              {/* Content */}
              <div className="flex-1">
                {memory.summary && (
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-2">
                    {memory.summary}
                  </p>
                )}
                <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed">
                  {memory.content}
                </p>
              </div>

              {/* Footer metadata */}
              <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center gap-4 text-xs text-zinc-400">
                {memory.commitHash && (
                  <span>
                    Commit: <code className="text-indigo-500 font-mono">{memory.commitHash.substring(0, 7)}</code>
                  </span>
                )}
                <span>{new Date(memory.createdAt).toLocaleString()}</span>
                {memory.accessCount > 0 && (
                  <span>Viewed {memory.accessCount}x</span>
                )}
              </div>
            </div>
          );
        })()
      )}
    </FloatingWindow>
  );
}
