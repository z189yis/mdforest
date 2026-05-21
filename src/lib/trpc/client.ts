import { httpBatchLink, createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/api/routers/root";

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
    }),
  ],
});
