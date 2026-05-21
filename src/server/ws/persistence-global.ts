import { PrismaPersistence } from "./prisma-persistence";

/** Global persistence singleton for the WebSocket server. */
export const persistence = new PrismaPersistence();
