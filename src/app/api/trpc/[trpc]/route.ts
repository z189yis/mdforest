import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/api/routers/root";
import { createTRPCContext } from "@/server/api/trpc";

const handler = async (req: Request) => {
  try {
    return await fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router: appRouter,
      createContext: createTRPCContext,
      onError(opts) {
        console.error("[tRPC error]", opts.path, opts.error.message);
      },
    });
  } catch (err) {
    console.error("[tRPC fatal]", err);
    return new Response(
      JSON.stringify({ message: "Internal server error" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
};

export { handler as GET, handler as POST };
