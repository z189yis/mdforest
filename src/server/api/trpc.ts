import { getServerSession } from "next-auth";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { authOptions } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { canAccessRepo, canAccessDocument } from "@/server/auth/permissions";
import { z } from "zod";

export const createTRPCContext = async () => {
  const session = await getServerSession(authOptions);
  return { session, prisma };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

const isAuthed = middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const userId = ctx.session.user.id;

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

/**
 * Require at least "read" access to a repo.
 * Extracts repoId from input via getRawInput().
 */
const requireRepoRead = middleware(async (opts) => {
  const { ctx, next, getRawInput } = opts;
  const rawInput = await getRawInput();
  const result = z.object({ repoId: z.string() }).passthrough().safeParse(rawInput);
  if (!result.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "repoId required" });
  }

  const perm = await canAccessRepo(ctx.user.id, result.data.repoId);
  if (perm === "none") {
    throw new TRPCError({ code: "FORBIDDEN", message: "No access to this repository" });
  }

  return next({ ctx: { ...ctx, repoPermission: perm } });
});

/**
 * Require at least "write" access to a repo.
 */
const requireRepoWrite = middleware(async (opts) => {
  const { ctx, next, getRawInput } = opts;
  const rawInput = await getRawInput();
  const result = z.object({ repoId: z.string() }).passthrough().safeParse(rawInput);
  if (!result.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "repoId required" });
  }

  const perm = await canAccessRepo(ctx.user.id, result.data.repoId);
  if (perm !== "admin" && perm !== "write") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Write access required" });
  }

  return next({ ctx: { ...ctx, repoPermission: perm } });
});

/**
 * Require at least "read" access to a document.
 * Extracts docId from input.
 */
const requireDocRead = middleware(async (opts) => {
  const { ctx, next, getRawInput } = opts;
  const rawInput = await getRawInput();
  const result = z.object({ docId: z.string() }).passthrough().safeParse(rawInput);
  if (!result.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "docId required" });
  }

  const perm = await canAccessDocument(ctx.user.id, result.data.docId);
  if (perm === "none") {
    throw new TRPCError({ code: "FORBIDDEN", message: "No access to this document" });
  }

  return next({ ctx: { ...ctx, docPermission: perm } });
});

/**
 * Require at least "write" access to a document.
 */
const requireDocWrite = middleware(async (opts) => {
  const { ctx, next, getRawInput } = opts;
  const rawInput = await getRawInput();
  const result = z.object({ docId: z.string() }).passthrough().safeParse(rawInput);
  if (!result.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "docId required" });
  }

  const perm = await canAccessDocument(ctx.user.id, result.data.docId);
  if (perm !== "admin" && perm !== "write") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Write access required" });
  }

  return next({ ctx: { ...ctx, docPermission: perm } });
});

export const repoReadProcedure = t.procedure.use(isAuthed).use(requireRepoRead);
export const repoWriteProcedure = t.procedure.use(isAuthed).use(requireRepoWrite);
export const docReadProcedure = t.procedure.use(isAuthed).use(requireDocRead);
export const docWriteProcedure = t.procedure.use(isAuthed).use(requireDocWrite);
