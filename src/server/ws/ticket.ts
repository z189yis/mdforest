import crypto from "crypto";

interface TicketData {
  userId: string;
  userName: string;
}

interface TicketEntry extends TicketData {
  expiresAt: number;
}

/**
 * Short-lived ticket manager for WebSocket authentication.
 * Tickets are 30s TTL, single-use (destroyed on validation), stored in memory.
 */
export class TicketManager {
  private tickets = new Map<string, TicketEntry>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(private ttlMs: number = 30_000) {
    // Clean up expired tickets every 15s
    this.cleanupTimer = setInterval(() => this.cleanup(), 15_000);
  }

  issue(userId: string, userName: string): { ticket: string; expiresIn: number } {
    const ticket = crypto.randomBytes(32).toString("base64url");
    this.tickets.set(ticket, {
      userId,
      userName,
      expiresAt: Date.now() + this.ttlMs,
    });
    return { ticket, expiresIn: Math.floor(this.ttlMs / 1000) };
  }

  validate(ticket: string): TicketData | null {
    const entry = this.tickets.get(ticket);
    if (!entry) return null;

    // Remove immediately (single-use, prevents replay)
    this.tickets.delete(ticket);

    if (Date.now() > entry.expiresAt) return null;

    return { userId: entry.userId, userName: entry.userName };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.tickets) {
      if (now > entry.expiresAt) {
        this.tickets.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.tickets.clear();
  }
}

/** Singleton for the WS server process */
export const ticketManager = new TicketManager(
  parseInt(process.env.TICKET_TTL_MS ?? "30000", 10)
);
