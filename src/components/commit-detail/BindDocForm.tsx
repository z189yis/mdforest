"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui";
import { toast } from "sonner";

interface BindDocFormProps {
  repoId: string;
  cacheId?: string;
  onBound: () => void;
}

export function BindDocForm({ repoId, cacheId, onBound }: BindDocFormProps) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedDocId, setSelectedDocId] = useState("");

  const { data: existingDocs } = trpc.document.list.useQuery({ repoId });

  const createAndBind = trpc.binding.createAndBind.useMutation({
    onSuccess: () => {
      toast.success("Document linked to commit");
      setTitle("");
      setContent("");
      onBound();
    },
    onError: (err) => toast.error(err.message),
  });

  const bind = trpc.binding.bind.useMutation({
    onSuccess: () => {
      toast.success("Document linked");
      setSelectedDocId("");
      onBound();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!cacheId) {
      toast.error("Commit not yet cached. Try refreshing.");
      return;
    }

    if (mode === "new") {
      if (!title) { toast.error("Title is required"); return; }
      createAndBind.mutate({ commitId: cacheId, repoId, title, content });
    } else {
      if (!selectedDocId) { toast.error("Select a document"); return; }
      bind.mutate({ commitId: cacheId, documentId: selectedDocId });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          className={`text-xs px-3 py-1 rounded-md ${mode === "new" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}
          onClick={() => setMode("new")}
        >
          New
        </button>
        <button
          className={`text-xs px-3 py-1 rounded-md ${mode === "existing" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}
          onClick={() => setMode("existing")}
        >
          Existing
        </button>
      </div>

      {mode === "new" ? (
        <div className="space-y-2">
          <input
            className="w-full text-xs px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
            placeholder="Document title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="w-full text-xs px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 resize-none h-20"
            placeholder="Initial content (markdown)..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
      ) : (
        <select
          className="w-full text-xs px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
          value={selectedDocId}
          onChange={(e) => setSelectedDocId(e.target.value)}
        >
          <option value="">Select a document...</option>
          {existingDocs?.map((d) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
      )}

      <Button
        size="sm"
        variant="primary"
        onClick={handleSubmit}
        disabled={createAndBind.isPending || bind.isPending}
      >
        {createAndBind.isPending || bind.isPending ? "Linking..." : "Link Document"}
      </Button>
    </div>
  );
}
