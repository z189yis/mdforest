/**
 * Persistence interface for Yjs document snapshots and update logs.
 *
 * Phase 0: In-memory implementation for development/testing.
 * Phase 1: Replaced with Prisma-backed WAL persistence.
 */

export interface Persistence {
  loadSnapshot(docId: string): Promise<Uint8Array | null>;
  saveSnapshot(docId: string, snapshot: Uint8Array, version: number): Promise<void>;
  saveUpdate(docId: string, update: Uint8Array, version: number): Promise<void>;
  getUpdatesSince(docId: string, version: number): Promise<Uint8Array[]>;
  deleteUpdatesBefore(docId: string, version: number): Promise<void>;
  getNextVersion(docId: string): Promise<number>;
}

interface DocState {
  snapshot: Uint8Array | null;
  snapshotVersion: number;
  updates: { version: number; data: Uint8Array }[];
  nextVersion: number;
}

/**
 * In-memory persistence. Data is lost on server restart.
 * Phase 1 replaces this with a Prisma/DB-backed implementation.
 */
export class InMemoryPersistence implements Persistence {
  private docs = new Map<string, DocState>();

  private ensure(docId: string): DocState {
    let state = this.docs.get(docId);
    if (!state) {
      state = {
        snapshot: null,
        snapshotVersion: 0,
        updates: [],
        nextVersion: 1,
      };
      this.docs.set(docId, state);
    }
    return state;
  }

  async loadSnapshot(docId: string): Promise<Uint8Array | null> {
    return this.docs.get(docId)?.snapshot ?? null;
  }

  async saveSnapshot(docId: string, snapshot: Uint8Array, version: number): Promise<void> {
    const state = this.ensure(docId);
    state.snapshot = snapshot;
    state.snapshotVersion = version;
    // Clean up old updates that are now covered by the snapshot
    state.updates = state.updates.filter((u) => u.version > version);
  }

  async saveUpdate(docId: string, update: Uint8Array, version: number): Promise<void> {
    const state = this.ensure(docId);
    state.updates.push({ version, data: update });
    if (version >= state.nextVersion) {
      state.nextVersion = version + 1;
    }
  }

  async getUpdatesSince(docId: string, version: number): Promise<Uint8Array[]> {
    const state = this.docs.get(docId);
    if (!state) return [];
    return state.updates
      .filter((u) => u.version > version)
      .sort((a, b) => a.version - b.version)
      .map((u) => u.data);
  }

  async deleteUpdatesBefore(docId: string, version: number): Promise<void> {
    const state = this.docs.get(docId);
    if (!state) return;
    state.updates = state.updates.filter((u) => u.version > version);
  }

  async getNextVersion(docId: string): Promise<number> {
    return this.ensure(docId).nextVersion;
  }
}
