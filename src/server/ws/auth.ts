import type { IncomingMessage } from "http";
import { ticketManager } from "./ticket";

export interface AuthenticatedUser {
  userId: string;
  userName: string;
}

/**
 * Authenticate a WebSocket upgrade request by validating the ticket query parameter.
 * Returns user info on success, null on failure.
 */
export async function authenticateWs(
  req: IncomingMessage
): Promise<AuthenticatedUser | null> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const ticket = url.searchParams.get("ticket");
  if (!ticket) return null;

  const result = ticketManager.validate(ticket);
  if (!result) return null;

  return { userId: result.userId, userName: result.userName };
}

/**
 * Close code constants for WebSocket auth failures.
 */
export const CloseCodes = {
  UNAUTHORIZED: 4001,
  FORBIDDEN: 4003,
  UPDATE_TOO_LARGE: 4009,
} as const;
