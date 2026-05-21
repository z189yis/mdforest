"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { MarkdownPreview } from "@/components/editor/MarkdownPreview";
import { CollaborativeEditor } from "@/components/editor/CollaborativeEditor";
import { useYjsProvider } from "@/lib/hooks/useYjsProvider";
import { AvatarList } from "@/components/collaboration/AvatarList";
import { ConflictToast } from "@/components/collaboration/ConflictToast";
import { Button, Spinner } from "@/components/ui";
import { toast } from "sonner";

export default function DocEditorPage() {
  const { repoId, docId } = useParams<{ repoId: string; docId: string }>();
  const router = useRouter();
  const { data: doc, isLoading, error } = trpc.document.get.useQuery({ docId });

  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const collabEnabled = process.env.NEXT_PUBLIC_COLLAB_ENABLED === "true";
  const { ydoc, awareness, connectionStatus } = useYjsProvider(
    collabEnabled ? docId : null
  );

  const utils = trpc.useUtils();
  const updateDoc = trpc.document.update.useMutation({
    onSuccess: () => {
      toast.success("Document saved");
      setHasChanges(false);
      utils.document.get.invalidate({ docId });
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (doc) {
      setContent(doc.content);
      setTitle(doc.title);
    }
  }, [doc]);

  const handleSave = useCallback(() => {
    updateDoc.mutate({ docId, content, title });
  }, [docId, content, title, updateDoc]);

  // Ctrl+S to save (only when not in collab mode)
  useEffect(() => {
    if (collabEnabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (hasChanges) handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasChanges, handleSave, collabEnabled]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center text-red-500 dark:text-red-400">
          Failed to load document
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/repos/${repoId}`)}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <input
            className="text-sm font-semibold bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setHasChanges(true); }}
          />
          <span className="text-xs text-zinc-400">
            {collabEnabled
              ? connectionStatus === "connected"
                ? "Live"
                : connectionStatus
              : hasChanges
                ? "Unsaved changes"
                : "Saved"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {collabEnabled && awareness && (
            <>
              <AvatarList awareness={awareness} />
              <ConflictToast awareness={awareness} />
            </>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? "Edit" : "Preview"}
          </Button>
          {!collabEnabled && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || updateDoc.isPending}
            >
              {updateDoc.isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </div>

      {/* Editor / Preview */}
      <div className="flex-1 min-h-0">
        {showPreview ? (
          <MarkdownPreview content={content} />
        ) : collabEnabled && ydoc && awareness ? (
          <CollaborativeEditor
            ydoc={ydoc}
            awareness={awareness}
            connectionStatus={connectionStatus}
          />
        ) : (
          <MarkdownEditor
            value={content}
            onChange={(v) => { setContent(v); setHasChanges(true); }}
          />
        )}
      </div>
    </div>
  );
}
