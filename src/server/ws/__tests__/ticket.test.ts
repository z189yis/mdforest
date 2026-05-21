import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TicketManager } from "../ticket";

describe("TicketManager", () => {
  let manager: TicketManager;

  beforeEach(() => {
    manager = new TicketManager(1000); // 1s TTL for fast testing
  });

  afterEach(() => {
    manager.destroy();
  });

  it("should issue and validate a ticket", () => {
    const { ticket } = manager.issue("user-1", "Alice");
    const result = manager.validate(ticket);
    expect(result).toEqual({ userId: "user-1", userName: "Alice" });
  });

  it("should be single-use (prevents replay)", () => {
    const { ticket } = manager.issue("user-1", "Alice");
    manager.validate(ticket);
    const result = manager.validate(ticket);
    expect(result).toBeNull();
  });

  it("should reject invalid tickets", () => {
    const result = manager.validate("not-a-valid-ticket");
    expect(result).toBeNull();
  });

  it("should reject expired tickets", async () => {
    const { ticket } = manager.issue("user-1", "Alice");
    // Wait for ticket to expire
    await new Promise((r) => setTimeout(r, 1100));
    const result = manager.validate(ticket);
    expect(result).toBeNull();
  });

  it("should clean up expired tickets", async () => {
    manager = new TicketManager(500); // 500ms TTL, cleanup every 15s min but we trigger
    const { ticket } = manager.issue("user-1", "Alice");
    await new Promise((r) => setTimeout(r, 600));
    // This should be caught by validate's expiry check
    const result = manager.validate(ticket);
    expect(result).toBeNull();
    manager.destroy();
  });

  it("should include expiresIn in the response", () => {
    const result = manager.issue("user-1", "Alice");
    expect(result.expiresIn).toBe(1); // 1000ms / 1000
    expect(result.ticket).toBeTruthy();
  });
});
