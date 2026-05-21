import { prisma } from "@/server/db/prisma";
import type { Persistence } from "./persistence";

/**
 * Prisma-backed persistence implementing Write-Ahead Log semantics.
 * Updates are persisted to the database before being applied to memory.
 *
 * Snapshot lifecycle:
 *   - Snapshot is saved periodically (every 30s or 100 updates)
 *   - Updates before the snapshot version are cleaned up
 *   - On load: snapshot is restored first, then pending updates applied
 */
export class PrismaPersistence implements Persistence {
  async loadSnapshot(docId: string): Promise<Uint8Array | null> {
    const doc = await prisma.document.findUnique({
      where: { id: docId },
      select: { lastSnapshot: true },
    });
    if (!doc?.lastSnapshot) return null;
    return new Uint8Array(doc.lastSnapshot);
  }

  async saveSnapshot(
    docId: string,
    snapshot: Uint8Array,
    version: number,
  ): Promise<void> {
    await prisma.document.update({
      where: { id: docId },
      data: {
        lastSnapshot: Buffer.from(snapshot),
        snapshotVersion: version,
      },
    });

    // Clean up old updates covered by this snapshot
    await prisma.documentUpdate.deleteMany({
      where: { documentId: docId, version: { lte: version } },
    });
  }

  async saveUpdate(
    docId: string,
    update: Uint8Array,
    version: number,
  ): Promise<void> {
    await prisma.documentUpdate.create({
      data: {
        documentId: docId,
        version,
        data: Buffer.from(update),
      },
    });
  }

  async getUpdatesSince(
    docId: string,
    version: number,
  ): Promise<Uint8Array[]> {
    const updates = await prisma.documentUpdate.findMany({
      where: { documentId: docId, version: { gt: version } },
      orderBy: { version: "asc" },
      select: { data: true },
    });
    return updates.map((u) => new Uint8Array(u.data));
  }

  async deleteUpdatesBefore(docId: string, version: number): Promise<void> {
    await prisma.documentUpdate.deleteMany({
      where: { documentId: docId, version: { lte: version } },
    });
  }

  async getNextVersion(docId: string): Promise<number> {
    const last = await prisma.documentUpdate.findFirst({
      where: { documentId: docId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return last ? last.version + 1 : 1;
  }

  /**
   * Daily cleanup: remove update logs older than 7 days.
   */
  async dailyCleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    await prisma.documentUpdate.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
  }
}
