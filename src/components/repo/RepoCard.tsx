import { Card, Badge } from "@/components/ui";
import { Repo } from "@prisma/client";

const statusColors: Record<string, "default" | "indigo" | "green" | "red"> = {
  pending: "default",
  cloning: "yellow",
  ready: "green",
  error: "red",
};

export function RepoCard({ repo }: { repo: Repo }) {
  return (
    <Card hover className="p-4 cursor-pointer">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {repo.name}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 truncate">
            {repo.remoteUrl}
          </p>
        </div>
        <Badge color={statusColors[repo.cloneStatus] ?? "default"}>
          {repo.cloneStatus}
        </Badge>
      </div>
    </Card>
  );
}
