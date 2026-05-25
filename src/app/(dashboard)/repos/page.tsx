"use client";

import { trpc } from "@/lib/trpc/client";
import Link from "next/link";
import { RepoCard } from "@/components/repo/RepoCard";
import { AddRepoForm } from "@/components/repo/AddRepoForm";
import { EmptyState, Spinner } from "@/components/ui";

export default function ReposPage() {
  const { data: repos, isLoading, error } = trpc.repo.list.useQuery(undefined, {
    // Poll while any repo is still cloning/pending
    refetchInterval: (query) => {
      const list = query.state.data;
      if (!list) return false;
      return list.some((r) => r.cloneStatus === "pending" || r.cloneStatus === "cloning") ? 5000 : false;
    },
  });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            Repositories
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Manage your Git repositories and explore commit history
          </p>
        </div>
        <AddRepoForm />
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-4 text-red-600 dark:text-red-400 text-sm">
          Failed to load repositories. Please try again.
        </div>
      )}

      {!isLoading && repos?.length === 0 && (
        <EmptyState
          title="No repositories yet"
          description="Add a Git repository to start exploring its commit history"
          action={<AddRepoForm />}
        />
      )}

      {!isLoading && repos && repos.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {repos.map((repo) => (
            <Link key={repo.id} href={`/repos/${repo.id}`}>
              <RepoCard repo={repo} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
