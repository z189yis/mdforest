import { InMemoryPersistence } from "./persistence";

/** Global persistence singleton for the WebSocket server. */
export const persistence = new InMemoryPersistence();
