import { RoomManager } from "./room-manager";
import { persistence } from "./persistence-global";

/** Global RoomManager singleton for the WebSocket server. */
export const roomManager = new RoomManager(persistence);
