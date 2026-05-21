"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { FloatingWindow } from "@/components/layout/FloatingWindow";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import { CollaborativeEditor } from "@/components/editor/CollaborativeEditor";
import { AvatarList } from "@/components/collaboration/AvatarList";
import { ConflictToast } from "@/components/collaboration/ConflictToast";
import { Spinner } from "@/components/ui";
import type { WindowState } from "@/lib/hooks/useWindowManager";

interface MDWindowProps {
  window: WindowState;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  // Collaboration props (passed from parent to avoid multiple providers)
  collabEnabled: boolean;
  ydoc?: any;
  awareness?: any;
  connectionStatus?: string;
}

export function MDWindow({
  window,
  onMove,
  onResize,
  onFocus,
  onClose,
  onMinimize,
  collabEnabled,
  ydoc,
  awareness,
  connectionStatus,
}: MDWindowProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [localContent, setLocalContent] = useState<string | null>(null);

  const { data: doc, isLoading } = trpc.document.get.useQuery(
    { docId: window.id },
    { enabled: !window.minimized }
  );

  const utils = trpc.useUtils();
  const saveDoc = trpc.document.update.useMutation({
    onSuccess: () => {
      utils.document.get.invalidate({ docId: window.id });
      utils.git.docLeaves.invalidate();
    },
  });

  return (
    <FloatingWindow
      x={window.x}
      y={window.y}
      width={window.width}
      height={window.height}
      zIndex={window.zIndex}
      minimized={window.minimized}
      title={window.title}
      onMove={onMove}
      onResize={onResize}
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
    >
      {window.minimized ? null : isLoading ? (
        <div className="flex items-center justify-center h-full">
          <Spinner />
        </div>
      ) : !doc ? (
        <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
          Document not found
        </div>
      ) : (
        <div className="flex flex-col h-full">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-2 py-1 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
            {collabEnabled && awareness && (
              <>
                <AvatarList awareness={awareness} />
                <ConflictToast awareness={awareness} />
              </>
            )}
            <span className="text-[10px] text-zinc-400 ml-auto">
              {collabEnabled && connectionStatus === "connected"
                ? "Live"
                : collabEnabled
                  ? connectionStatus
                  : ""}
            </span>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              {showPreview ? "Edit" : "Preview"}
            </button>
            {!collabEnabled && (
              <button
                onClick={() => {
                  const content = localContent ?? doc.content;
                  saveDoc.mutate({ docId: window.id, content });
                }}
                disabled={saveDoc.isPending}
                className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400"
              >
                {saveDoc.isPending ? "Saving..." : "Save"}
              </button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {showPreview ? (
              <MarkdownPreview content={localContent ?? doc.content ?? ""} />
            ) : collabEnabled && ydoc && awareness ? (
              <CollaborativeEditor
                ydoc={ydoc}
                awareness={awareness}
                connectionStatus={connectionStatus ?? "disconnected"}
              />
            ) : (
              <MarkdownEditor
                value={localContent ?? doc.content ?? ""}
                onChange={(v) => setLocalContent(v)}
              />
            )}
          </div>
        </div>
      )}
    </FloatingWindow>
  );
}
