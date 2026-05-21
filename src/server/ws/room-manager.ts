import * as Y from "yjs";
import { InMemoryPersistence, type Persistence } from "./persistence";

interface RoomState {
  ydoc: Y.Doc;
  clients: Set<string>; // userId set
  lastActivity: number;
}

export interface RoomStats {
  rooms: number;
  docs: number;
  memoryMB: number;
}

/**
 * RoomManager handles Y.Doc lifecycle: creation, caching, LRU eviction,
 * snapshot loading/restoration, and client tracking.
 */
export class RoomManager {
  private rooms = new Map<string, RoomState>();
  private updateCounts = new Map<string, number>();
  private lastSnapshotTime = new Map<string, number>();
  private snapshotVersion = new Map<string, number>();

  private snapshotIntervalMs = parseInt(
    process.env.SNAPSHOT_INTERVAL_MS ?? "30000",
    10,
  );
  private snapshotUpdateThreshold = 100;

  constructor(
    private persistence: Persistence = new InMemoryPersistence(),
    private maxRooms: number = parseInt(process.env.DOC_LRU_MAX ?? "100", 10),
  ) {}

  /**
   * Get or load a Y.Doc for the given document ID.
   * Restores from snapshot + updates if available.
   */
  async getDoc(docId: string): Promise<Y.Doc> {
    let room = this.rooms.get(docId);

    if (room) {
      room.lastActivity = Date.now();
      return room.ydoc;
    }

    // Evict LRU rooms if at capacity
    if (this.rooms.size >= this.maxRooms) {
      await this.evictLRU();
    }

    // Create new Y.Doc and restore state
    const ydoc = new Y.Doc();
    const snapshot = await this.persistence.loadSnapshot(docId);

    if (snapshot) {
      Y.applyUpdate(ydoc, snapshot);
    }

    // Apply any pending updates since the snapshot
    const updates = await this.persistence.getUpdatesSince(docId, 0);
    for (const update of updates) {
      Y.applyUpdate(ydoc, update);
    }

    room = {
      ydoc,
      clients: new Set(),
      lastActivity: Date.now(),
    };
    this.rooms.set(docId, room);

    return ydoc;
  }

  /**
   * Join a user to a room. Creates the room if it doesn't exist.
   */
  async join(docId: string, userId: string): Promise<Y.Doc> {
    const ydoc = await this.getDoc(docId);
    const room = this.rooms.get(docId)!;
    room.clients.add(userId);
    room.lastActivity = Date.now();
    return ydoc;
  }

  /**
   * Remove a user from a room. If the room is empty, trigger persistence.
   */
  leave(docId: string, userId: string): void {
    const room = this.rooms.get(docId);
    if (!room) return;

    room.clients.delete(userId);

    // If no clients left, persist and optionally evict
    if (room.clients.size === 0) {
      // Keep the room in memory for a short time in case of reconnection
      room.lastActivity = Date.now();
    }
  }

  /**
   * Force-evict a user from a room (used for permission revocation).
   */
  evictUser(docId: string, userId: string): void {
    this.leave(docId, userId);
  }

  /**
   * Record an update for auto-snapshot tracking.
   * Called by the WS server after each client update is applied.
   * Triggers a snapshot every 100 updates or 30s (whichever comes first).
   */
  async onUpdate(docId: string, ydoc: Y.Doc): Promise<void> {
    const count = (this.updateCounts.get(docId) ?? 0) + 1;
    this.updateCounts.set(docId, count);

    const lastSnapshot = this.lastSnapshotTime.get(docId) ?? 0;
    const now = Date.now();

    if (
      count >= this.snapshotUpdateThreshold ||
      now - lastSnapshot >= this.snapshotIntervalMs
    ) {
      await this.takeSnapshot(docId, ydoc);
      this.updateCounts.set(docId, 0);
      this.lastSnapshotTime.set(docId, now);
    }
  }

  /**
   * Take a snapshot: persist state, clean old updates.
   */
  private async takeSnapshot(docId: string, ydoc: Y.Doc): Promise<void> {
    const snapshot = Y.encodeStateAsUpdate(ydoc);
    const version = (this.snapshotVersion.get(docId) ?? 0) + 1;
    this.snapshotVersion.set(docId, version);
    await this.persistence.saveSnapshot(docId, snapshot, version);
  }

  /**
   * Close a room: persist state and release memory.
   */
  async closeRoom(docId: string): Promise<void> {
    const room = this.rooms.get(docId);
    if (!room) return;

    const snapshot = Y.encodeStateAsUpdate(room.ydoc);
    const version = await this.persistence.getNextVersion(docId);
    await this.persistence.saveSnapshot(docId, snapshot, version);

    this.rooms.delete(docId);
    room.ydoc.destroy();
  }

  /**
   * Get online user IDs for a room.
   */
  getOnlineUsers(docId: string): string[] {
    const room = this.rooms.get(docId);
    return room ? Array.from(room.clients) : [];
  }

  /**
   * Get the number of online users in a room.
   */
  getOnlineCount(docId: string): number {
    return this.rooms.get(docId)?.clients.size ?? 0;
  }

  /**
   * Get server statistics.
   */
  getStats(): RoomStats {
    let totalMemory = 0;
    for (const room of this.rooms.values()) {
      // Rough estimate: Y.Doc memory + overhead
      totalMemory += 1024 * 100; // ~100KB per doc estimate
    }

    return {
      rooms: this.rooms.size,
      docs: this.rooms.size,
      memoryMB: Math.round(totalMemory / (1024 * 1024)),
    };
  }

  /**
   * Persist all active rooms (used for graceful shutdown).
   */
  async persistAll(): Promise<void> {
    for (const [docId, room] of this.rooms) {
      const snapshot = Y.encodeStateAsUpdate(room.ydoc);
      const version = await this.persistence.getNextVersion(docId);
      await this.persistence.saveSnapshot(docId, snapshot, version);
    }
  }

  private async evictLRU(): Promise<void> {
    let oldest: { docId: string; lastActivity: number } | null = null;

    for (const [docId, room] of this.rooms) {
      // Don't evict rooms with active clients
      if (room.clients.size > 0) continue;

      if (!oldest || room.lastActivity < oldest.lastActivity) {
        oldest = { docId, lastActivity: room.lastActivity };
      }
    }

    if (oldest) {
      await this.closeRoom(oldest.docId);
    }
  }
}
