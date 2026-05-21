import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { authenticateWs, CloseCodes, type AuthenticatedUser } from "./auth";
import { roomManager } from "./room-manager-global";
import { canJoinRoom } from "@/server/auth/permissions";

const MAX_UPDATE_SIZE = parseInt(
  process.env.UPDATE_MAX_SIZE ?? `${5 * 1024 * 1024}`,
  10,
);

const PORT = parseInt(process.env.WS_PORT ?? "3001", 10);
const HOST = process.env.WS_HOST ?? "0.0.0.0";

const messageSync = 0;
const messageAwareness = 1;

function readSyncMessage(
  decoder: decoding.Decoder,
  encoder: encoding.Encoder,
  doc: Y.Doc,
): boolean {
  const messageType = decoding.readVarUint(decoder);
  switch (messageType) {
    case 0: {
      const sv = decoding.readVarUint8Array(decoder);
      const update = Y.encodeStateAsUpdate(doc, sv);
      encoding.writeVarUint(encoder, messageSync);
      encoding.writeVarUint(encoder, 1); // Sync Step 2
      encoding.writeVarUint8Array(encoder, update);
      return false;
    }
    case 1: {
      const update = decoding.readVarUint8Array(decoder);
      Y.applyUpdate(doc, update);
      return true;
    }
  }
  return false;
}

function readAwarenessMessage(
  decoder: decoding.Decoder,
  awarenessStates: Map<number, Uint8Array>,
): Uint8Array | null {
  const messageType = decoding.readVarUint(decoder);
  switch (messageType) {
    case 0: {
      const clock = decoding.readVarUint(decoder);
      const state = decoding.readVarUint8Array(decoder);
      awarenessStates.set(clock, state);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint(encoder, 0);
      encoding.writeVarUint(encoder, clock);
      encoding.writeVarUint8Array(encoder, state);
      return encoding.toUint8Array(encoder);
    }
    case 1: {
      const clock = decoding.readVarUint(decoder);
      awarenessStates.delete(clock);
      return null;
    }
  }
  return null;
}

const awarenessStates = new Map<string, Map<number, Uint8Array>>();

function getAwarenessStates(docId: string): Map<number, Uint8Array> {
  let states = awarenessStates.get(docId);
  if (!states) {
    states = new Map();
    awarenessStates.set(docId, states);
  }
  return states;
}

// Store connection metadata on the WebSocket via a WeakMap
const wsMeta = new WeakMap<WebSocket, { userId: string; docId: string }>();

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(roomManager.getStats()));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", async (req, socket, head) => {
  const auth = await authenticateWs(req);
  if (!auth) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const docId = url.searchParams.get("docId");
  if (!docId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  // Check permission before accepting the connection
  const allowed = await canJoinRoom(auth.userId, docId);
  if (!allowed) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wsMeta.set(ws, { userId: auth.userId, docId });
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, _req) => {
  const meta = wsMeta.get(ws);
  if (!meta) {
    ws.close(4000, "Internal error");
    return;
  }
  const { userId, docId } = meta;

  roomManager
    .join(docId, userId)
    .then((ydoc) => {
      const docAwarenessStates = getAwarenessStates(docId);
      const awarenessClock = Date.now();

      // Send initial sync (State Vector)
      {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        encoding.writeVarUint(encoder, 0); // Sync Step 1
        encoding.writeVarUint8Array(encoder, Y.encodeStateVector(ydoc));
        ws.send(encoding.toUint8Array(encoder));
      }

      ws.on("message", (data) => {
        try {
          const buffer = data as ArrayBuffer;
          if (buffer.byteLength > MAX_UPDATE_SIZE) {
            ws.close(CloseCodes.UPDATE_TOO_LARGE, "Update too large");
            return;
          }

          const decoder = decoding.createDecoder(new Uint8Array(buffer));
          const encoder = encoding.createEncoder();
          const messageType = decoding.readVarUint(decoder);

          switch (messageType) {
            case messageSync: {
              const hadUpdate = readSyncMessage(decoder, encoder, ydoc);
              if (hadUpdate) {
                roomManager.onUpdate(docId, ydoc);
              }
              broadcastToRoom(docId, encoding.toUint8Array(encoder), ws);
              break;
            }
            case messageAwareness: {
              const broadcastMsg = readAwarenessMessage(decoder, docAwarenessStates);
              if (broadcastMsg) {
                broadcastToRoom(docId, broadcastMsg, ws);
              }
              break;
            }
          }
        } catch (err) {
          console.error(`[ws] Error processing message for doc=${docId}:`, err);
        }
      });

      ws.on("close", () => {
        roomManager.leave(docId, userId);
        docAwarenessStates.delete(awarenessClock);
        wsMeta.delete(ws);
      });

      ws.on("error", (err) => {
        console.error(
          `[ws] WebSocket error for user=${userId} doc=${docId}:`,
          err.message,
        );
      });
    })
    .catch((err) => {
      console.error(`[ws] Failed to join room doc=${docId}:`, err);
      ws.close(CloseCodes.FORBIDDEN, "Cannot join room");
    });
});

function broadcastToRoom(
  docId: string,
  message: Uint8Array,
  exclude?: WebSocket,
): void {
  wss.clients.forEach((client) => {
    if (client === exclude) return;
    if (client.readyState !== WebSocket.OPEN) return;
    // Only broadcast to clients in the same room
    const clientMeta = wsMeta.get(client);
    if (clientMeta?.docId !== docId) return;
    client.send(message);
  });
}

httpServer.listen(PORT, HOST, () => {
  console.log(`[ws] WebSocket server listening on ${HOST}:${PORT}`);
});

// Periodic snapshot
const snapshotInterval = setInterval(() => {
  roomManager.persistAll().catch((err) => {
    console.error("[ws] Snapshot error:", err);
  });
}, parseInt(process.env.SNAPSHOT_INTERVAL_MS ?? "30000", 10));

// Graceful shutdown
function shutdown() {
  clearInterval(snapshotInterval);
  roomManager.persistAll().then(() => {
    wss.close();
    httpServer.close();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { httpServer, wss };
