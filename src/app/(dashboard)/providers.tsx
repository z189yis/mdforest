"use client";

import { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { TRPCProvider } from "@/lib/trpc/Provider";
import { Toaster } from "sonner";

export function DashboardProviders({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <SessionProvider session={session}>
      <TRPCProvider>
        {children}
        <Toaster position="bottom-right" richColors />
      </TRPCProvider>
    </SessionProvider>
  );
}
