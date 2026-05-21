"use client";

import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import type { ConnectionStatus } from "@/lib/hooks/useYjsProvider";

interface CollaborativeEditorProps {
  ydoc: Y.Doc;
  awareness: any;
  connectionStatus: ConnectionStatus;
}

const statusLabels: Record<ConnectionStatus, { text: string; color: string; pulse: boolean }> = {
  disconnected: { text: "Disconnected", color: "bg-red-500", pulse: false },
  connecting: { text: "Connecting...", color: "bg-yellow-500", pulse: true },
  syncing: { text: "Syncing...", color: "bg-yellow-500", pulse: true },
  connected: { text: "Connected", color: "bg-green-500", pulse: false },
};

export function CollaborativeEditor({
  ydoc,
  awareness,
  connectionStatus,
}: CollaborativeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const yText = ydoc.getText("content");

    // yCollab handles: sync, remote selections (cursors), undo manager
    const extensions = [
      basicSetup,
      markdown(),
      ...(yCollab(yText, awareness) as unknown as readonly any[]),
    ];

    const state = EditorState.create({
      doc: yText.toString(),
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [ydoc, awareness]);

  const status = statusLabels[connectionStatus];

  return (
    <div className="h-full flex flex-col">
      {/* Connection status indicator */}
      <div className="flex items-center gap-2 px-3 py-1 text-xs text-gray-400 border-b border-gray-200 dark:border-gray-800">
        <span
          className={`inline-block w-2 h-2 rounded-full ${status.color} ${
            status.pulse ? "animate-pulse" : ""
          }`}
        />
        <span>{status.text}</span>
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
