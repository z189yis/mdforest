import { z } from "zod";
import { router, protectedProcedure } from "@/server/api/trpc";
import { ticketManager } from "@/server/ws/ticket";

export const wsRouter = router({
  /**
   * Issue a short-lived ticket for WebSocket authentication.
   * Client calls this before opening a WebSocket connection.
   * Ticket is valid for 30s and single-use.
   */
  wsTicket: protectedProcedure
    .input(z.object({ docId: z.string() }).optional())
    .query(({ ctx }) => {
      const { ticket, expiresIn } = ticketManager.issue(
        ctx.user.id,
        ctx.user.name ?? "Unknown"
      );
      return { ticket, expiresIn };
    }),
});
