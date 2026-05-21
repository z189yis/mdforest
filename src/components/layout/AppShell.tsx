"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { Sidebar } from "./Sidebar";
import { Button } from "@/components/ui";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  return (
    <div className="flex h-screen bg-white dark:bg-zinc-950">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-4 flex-shrink-0">
          <div />
          <div className="flex items-center gap-3">
            {session?.user && (
              <>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {session.user.name}
                </span>
                <Button variant="ghost" size="sm" onClick={() => signOut()}>
                  Sign out
                </Button>
              </>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
