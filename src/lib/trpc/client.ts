import { httpBatchLink, createTRPCReact } from "@trpc/react-query";
import { createTRPCClient } from "@trpc/client";
import type { AppRouter } from "@/server/api/routers/root";

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
    }),
  ],
});

// Vanilla client for imperative calls (e.g. lazy loading)
export const vanillaClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
    }),
  ],
});
