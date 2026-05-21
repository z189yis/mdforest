import { getServerSession } from "next-auth";
import { initTRPC, TRPCError } from "@trpc/server";
import { authOptions } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const createTRPCContext = async () => {
  const session = await getServerSession(authOptions);
  return { session, prisma };
};

const t = initTRPC.context<typeof createTRPCContext>().create({});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

const isAuthed = middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const userId = ctx.session.user.id;

  // Ensure user exists in database (needed for FK constraints)
  await ctx.prisma.user.upsert({
    where: { id: userId },
    update: {
      name: ctx.session.user.name ?? "Unknown",
      email: ctx.session.user.email ?? `${userId}@dev.local`,
      image: ctx.session.user.image ?? null,
    },
    create: {
      id: userId,
      name: ctx.session.user.name ?? "Unknown",
      email: ctx.session.user.email ?? `${userId}@dev.local`,
      image: ctx.session.user.image ?? null,
    },
  });

  return next({ ctx: { ...ctx, user: ctx.session.user } });
});

export const protectedProcedure = t.procedure.use(isAuthed);
