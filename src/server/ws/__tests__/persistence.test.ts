import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryPersistence } from "../persistence";

describe("InMemoryPersistence", () => {
  let persistence: InMemoryPersistence;

  beforeEach(() => {
    persistence = new InMemoryPersistence();
  });

  it("should return null for non-existent snapshots", async () => {
    const result = await persistence.loadSnapshot("doc-1");
    expect(result).toBeNull();
  });

  it("should save and load snapshots", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await persistence.saveSnapshot("doc-1", data, 1);
    const result = await persistence.loadSnapshot("doc-1");
    expect(result).toEqual(data);
  });

  it("should save and retrieve updates since a version", async () => {
    const update1 = new Uint8Array([1]);
    const update2 = new Uint8Array([2]);
    const update3 = new Uint8Array([3]);

    await persistence.saveUpdate("doc-1", update1, 1);
    await persistence.saveUpdate("doc-1", update2, 2);
    await persistence.saveUpdate("doc-1", update3, 3);

    const updates = await persistence.getUpdatesSince("doc-1", 1);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual(update2);
    expect(updates[1]).toEqual(update3);
  });

  it("should delete updates before a version", async () => {
    await persistence.saveUpdate("doc-1", new Uint8Array([1]), 1);
    await persistence.saveUpdate("doc-1", new Uint8Array([2]), 2);
    await persistence.saveUpdate("doc-1", new Uint8Array([3]), 3);

    await persistence.deleteUpdatesBefore("doc-1", 2);

    const updates = await persistence.getUpdatesSince("doc-1", 0);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual(new Uint8Array([3]));
  });

  it("should return empty array for non-existent docs", async () => {
    const updates = await persistence.getUpdatesSince("nonexistent", 0);
    expect(updates).toEqual([]);
  });

  it("should auto-increment versions", async () => {
    const v1 = await persistence.getNextVersion("doc-1");
    expect(v1).toBe(1);

    await persistence.saveUpdate("doc-1", new Uint8Array([1]), 1);
    const v2 = await persistence.getNextVersion("doc-1");
    expect(v2).toBe(2);
  });

  it("should clean updates covered by snapshot", async () => {
    await persistence.saveUpdate("doc-1", new Uint8Array([1]), 1);
    await persistence.saveUpdate("doc-1", new Uint8Array([2]), 2);
    await persistence.saveUpdate("doc-1", new Uint8Array([3]), 3);

    await persistence.saveSnapshot("doc-1", new Uint8Array([1, 2, 3]), 3);

    const updates = await persistence.getUpdatesSince("doc-1", 0);
    expect(updates).toHaveLength(0);
  });
});
