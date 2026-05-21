"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button, Input } from "@/components/ui";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";

export function AddRepoForm() {
  const [open, setOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const utils = trpc.useUtils();
  const addRepo = trpc.repo.add.useMutation({
    onSuccess: () => {
      utils.repo.list.invalidate();
      toast.success("Repository added successfully");
      setOpen(false);
      setRemoteUrl("");
      setName("");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!remoteUrl || !name) {
      setError("Both fields are required");
      return;
    }

    addRepo.mutate({ remoteUrl, name });
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        Add Repository
      </Button>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Add Repository
          </Dialog.Title>
          <Dialog.Description className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Enter the Git repository URL to clone and explore.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <Input
              label="Git URL"
              placeholder="https://github.com/user/repo.git"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
            />
            <Input
              label="Display Name"
              placeholder="my-project"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={addRepo.isPending}>
                {addRepo.isPending ? "Cloning..." : "Clone Repository"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
