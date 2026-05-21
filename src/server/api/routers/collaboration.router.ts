import { z } from "zod";
import crypto from "crypto";
import {
  protectedProcedure,
  repoWriteProcedure,
  docWriteProcedure,
  repoReadProcedure,
  docReadProcedure,
  router,
} from "@/server/api/trpc";

export const collaborationRouter = router({
  // ── Repo collaborators ──

  listRepoCollaborators: repoReadProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.repoCollaborator.findMany({
        where: { repoId: input.repoId },
        include: { user: { select: { id: true, name: true, image: true, email: true } } },
      });
    }),

  addRepoCollaborator: repoWriteProcedure
    .input(z.object({
      repoId: z.string(),
      userId: z.string(),
      role: z.enum(["admin", "editor", "viewer"]).default("editor"),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.repoCollaborator.upsert({
        where: { repoId_userId: { repoId: input.repoId, userId: input.userId } },
        update: { role: input.role },
        create: {
          repoId: input.repoId,
          userId: input.userId,
          role: input.role,
        },
      });
    }),

  removeRepoCollaborator: repoWriteProcedure
    .input(z.object({ repoId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const repo = await ctx.prisma.repo.findUnique({
        where: { id: input.repoId },
        select: { ownerId: true },
      });
      if (!repo) throw new Error("Repository not found");

      // Cannot remove the owner
      if (repo.ownerId === input.userId) {
        throw new Error("Cannot remove the repo owner");
      }

      await ctx.prisma.repoCollaborator.deleteMany({
        where: { repoId: input.repoId, userId: input.userId },
      });

      return { success: true };
    }),

  // ── Document collaborators ──

  listDocCollaborators: docReadProcedure
    .input(z.object({ docId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.documentCollaborator.findMany({
        where: { documentId: input.docId },
        include: { user: { select: { id: true, name: true, image: true, email: true } } },
      });
    }),

  addDocCollaborator: docWriteProcedure
    .input(z.object({
      docId: z.string(),
      userId: z.string(),
      role: z.enum(["editor", "viewer"]).default("editor"),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.documentCollaborator.upsert({
        where: { documentId_userId: { documentId: input.docId, userId: input.userId } },
        update: { role: input.role },
        create: {
          documentId: input.docId,
          userId: input.userId,
          role: input.role,
        },
      });
    }),

  removeDocCollaborator: docWriteProcedure
    .input(z.object({ docId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.prisma.document.findUnique({
        where: { id: input.docId },
        select: { ownerId: true },
      });
      if (!doc) throw new Error("Document not found");
      if (doc.ownerId === input.userId) {
        throw new Error("Cannot remove the document owner");
      }

      await ctx.prisma.documentCollaborator.deleteMany({
        where: { documentId: input.docId, userId: input.userId },
      });

      return { success: true };
    }),

  // ── Invite links ──

  generateInviteLink: repoWriteProcedure
    .input(z.object({
      repoId: z.string(),
      role: z.enum(["editor", "viewer"]).default("editor"),
      expiresInHours: z.number().min(1).max(168).default(48),
    }))
    .mutation(async ({ ctx, input }) => {
      const token = crypto.randomBytes(32).toString("base64url");
      await ctx.prisma.inviteToken.create({
        data: {
          repoId: input.repoId,
          token,
          role: input.role,
          expiresAt: new Date(Date.now() + input.expiresInHours * 3600_000),
        },
      });
      return {
        token,
        link: `${process.env.NEXTAUTH_URL}/invite/${token}`,
        expiresIn: input.expiresInHours * 3600,
      };
    }),

  joinByInviteLink: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await ctx.prisma.inviteToken.findUnique({
        where: { token: input.token },
      });

      if (!invite) throw new Error("Invalid or expired invite link");
      if (invite.usedBy) throw new Error("This invite link has already been used");
      if (new Date() > invite.expiresAt) throw new Error("This invite link has expired");

      // Atomic: mark as used
      await ctx.prisma.inviteToken.update({
        where: { id: invite.id },
        data: { usedBy: ctx.user.id },
      });

      // Add user as collaborator
      await ctx.prisma.repoCollaborator.upsert({
        where: { repoId_userId: { repoId: invite.repoId, userId: ctx.user.id } },
        update: { role: invite.role },
        create: {
          repoId: invite.repoId,
          userId: ctx.user.id,
          role: invite.role,
        },
      });

      return { repoId: invite.repoId, role: invite.role };
    }),
});
