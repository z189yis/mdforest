import { prisma } from "@/server/db/prisma";

export type Permission = "read" | "write" | "admin" | "none";

/**
 * Permission priority (highest to lowest):
 * 1. Repo owner → admin
 * 2. RepoCollaborator → by role
 * 3. DocumentCollaborator → by role
 * 4. Document.isPublic → read (authenticated users only)
 * 5. none (denied)
 */

function roleToPermission(role: string): Permission {
  switch (role) {
    case "admin": return "admin";
    case "editor": return "write";
    case "viewer": return "read";
    default: return "none";
  }
}

function permissionLevel(p: Permission): number {
  switch (p) {
    case "admin": return 3;
    case "write": return 2;
    case "read": return 1;
    default: return 0;
  }
}

function max(a: Permission, b: Permission): Permission {
  return permissionLevel(a) >= permissionLevel(b) ? a : b;
}

/**
 * Get the highest permission a user has on a repository.
 */
export async function canAccessRepo(
  userId: string,
  repoId: string,
): Promise<Permission> {
  // Check if user is the owner
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    select: { ownerId: true },
  });
  if (repo?.ownerId === userId) return "admin";

  // Check collaborator role
  const collab = await prisma.repoCollaborator.findUnique({
    where: { repoId_userId: { repoId, userId } },
    select: { role: true },
  });
  if (collab) return roleToPermission(collab.role);

  return "none";
}

/**
 * Get the highest permission a user has on a document.
 */
export async function canAccessDocument(
  userId: string,
  docId: string,
): Promise<Permission> {
  // Check document owner first
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    select: { ownerId: true, repoId: true, isPublic: true },
  });
  if (!doc) return "none";
  if (doc.ownerId === userId) return "admin";

  // Check repo-level permission (inherits to document)
  const repoPerm = await canAccessRepo(userId, doc.repoId);
  if (repoPerm !== "none") return repoPerm;

  // Check document-level collaborator
  const docCollab = await prisma.documentCollaborator.findUnique({
    where: { documentId_userId: { documentId: docId, userId } },
    select: { role: true },
  });
  if (docCollab) return roleToPermission(docCollab.role);

  // Public documents are readable by authenticated users
  if (doc.isPublic) return "read";

  return "none";
}

/**
 * Check if user can join a WebSocket room for a document.
 * Requires at least "read" permission.
 */
export async function canJoinRoom(
  userId: string,
  docId: string,
): Promise<boolean> {
  const perm = await canAccessDocument(userId, docId);
  return permissionLevel(perm) >= 1; // at least read
}
