import { describe, it, expect, beforeEach } from "vitest";
import { RoomManager } from "../room-manager";
import { InMemoryPersistence } from "../persistence";

describe("RoomManager", () => {
  let manager: RoomManager;
  let persistence: InMemoryPersistence;

  beforeEach(() => {
    persistence = new InMemoryPersistence();
    manager = new RoomManager(persistence, 10);
  });

  it("should create a new room on first join", async () => {
    const ydoc = await manager.join("doc-1", "user-1");
    expect(ydoc).toBeDefined();
    expect(manager.getOnlineCount("doc-1")).toBe(1);
  });

  it("should return existing room on second join", async () => {
    const ydoc1 = await manager.join("doc-1", "user-1");
    const ydoc2 = await manager.join("doc-1", "user-2");
    expect(ydoc1).toBe(ydoc2); // Same Y.Doc instance
    expect(manager.getOnlineCount("doc-1")).toBe(2);
  });

  it("should track online users", async () => {
    await manager.join("doc-1", "user-1");
    await manager.join("doc-1", "user-2");
    await manager.join("doc-1", "user-3");

    const users = manager.getOnlineUsers("doc-1");
    expect(users).toHaveLength(3);
    expect(users).toContain("user-1");
    expect(users).toContain("user-2");
    expect(users).toContain("user-3");
  });

  it("should remove user on leave", async () => {
    await manager.join("doc-1", "user-1");
    await manager.join("doc-1", "user-2");
    manager.leave("doc-1", "user-1");

    expect(manager.getOnlineCount("doc-1")).toBe(1);
    expect(manager.getOnlineUsers("doc-1")).toEqual(["user-2"]);
  });

  it("should evict user", async () => {
    await manager.join("doc-1", "user-1");
    await manager.join("doc-1", "user-2");
    manager.evictUser("doc-1", "user-1");

    expect(manager.getOnlineCount("doc-1")).toBe(1);
  });

  it("should persist and close a room", async () => {
    const ydoc = await manager.join("doc-1", "user-1");
    const yText = ydoc.getText("content");
    yText.insert(0, "Hello World");

    await manager.closeRoom("doc-1");

    // Room should be released from memory
    expect(manager.getOnlineCount("doc-1")).toBe(0);

    // Snapshot should be saved
    const snapshot = await persistence.loadSnapshot("doc-1");
    expect(snapshot).toBeDefined();
    expect(snapshot!.length).toBeGreaterThan(0);
  });

  it("should restore from snapshot on re-join", async () => {
    // First session
    const ydoc1 = await manager.join("doc-1", "user-1");
    const yText1 = ydoc1.getText("content");
    yText1.insert(0, "Hello World");
    await manager.closeRoom("doc-1");

    // Second session - should restore from snapshot
    const ydoc2 = await manager.join("doc-1", "user-1");
    const yText2 = ydoc2.getText("content");
    expect(yText2.toString()).toBe("Hello World");
  });

  it("should track stats", () => {
    const stats = manager.getStats();
    expect(stats.rooms).toBe(0);
    expect(stats.memoryMB).toBeGreaterThanOrEqual(0);
  });

  it("should evict LRU room when at capacity", async () => {
    const smallManager = new RoomManager(persistence, 2);

    await smallManager.join("doc-1", "user-1");
    await smallManager.join("doc-2", "user-1");
    // Leave both rooms so they're eligible for eviction
    smallManager.leave("doc-1", "user-1");
    smallManager.leave("doc-2", "user-1");

    // Room 1 was accessed earlier, should be evicted first
    await smallManager.join("doc-3", "user-1");
    expect(smallManager.getOnlineUsers("doc-3")).toHaveLength(1);
  });
});
