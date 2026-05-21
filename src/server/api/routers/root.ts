import { router, publicProcedure } from "@/server/api/trpc";
import { repoRouter } from "./repo.router";
import { gitRouter } from "./git.router";
import { documentRouter } from "./document.router";
import { bindingRouter } from "./binding.router";
import { searchRouter } from "./search.router";

export const appRouter = router({
  repo: repoRouter,
  git: gitRouter,
  document: documentRouter,
  binding: bindingRouter,
  search: searchRouter,
  health: publicProcedure.query(() => "ok"),
});

export type AppRouter = typeof appRouter;
