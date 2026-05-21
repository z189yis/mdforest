"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import { vanillaClient } from "@/lib/trpc/client";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "syncing"
  | "connected";

interface UseYjsProviderResult {
  ydoc: Y.Doc | null;
  provider: WebsocketProvider | null;
  awareness: WebsocketProvider["awareness"] | null;
  isConnected: boolean;
  isSynced: boolean;
  connectionStatus: ConnectionStatus;
}

const USER_COLORS = [
  "#30bced", "#6eeb83", "#ffbc42", "#ecd444",
  "#ee6352", "#9ac2c9", "#8acb88", "#1be7ff",
];

/**
 * Creates and manages a Yjs document with WebSocket + IndexedDB providers
 * for a given document ID. Handles lifecycle: connect, sync, reconnect,
 * and teardown when docId changes or component unmounts.
 */
export function useYjsProvider(docId: string | null): UseYjsProviderResult {
  const { data: session } = useSession();
  const ydocRef = useRef<Y.Doc | null>(null);
  const wsProviderRef = useRef<WebsocketProvider | null>(null);
  const idxdbRef = useRef<IndexeddbPersistence | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");

  // Fetch ticket for WebSocket connection
  const fetchTicket = useCallback(async (): Promise<string | null> => {
    try {
      const result = await vanillaClient.ws.wsTicket.query({ docId: docId ?? undefined });
      return result.ticket;
    } catch {
      return null;
    }
  }, [docId]);

  useEffect(() => {
    if (!docId) {
      setIsConnected(false);
      setIsSynced(false);
      setConnectionStatus("disconnected");
      return;
    }

    setConnectionStatus("connecting");

    // Create Y.Doc
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    // IndexedDB provider for offline persistence
    const idxdb = new IndexeddbPersistence(`mdforest-${docId}`, ydoc);
    idxdbRef.current = idxdb;

    idxdb.on("synced", () => {
      // Offline data loaded, but we still need WS sync
    });

    // Fetch ticket and connect WebSocket
    let wsProvider: WebsocketProvider | null = null;
    let cancelled = false;

    fetchTicket().then((ticket) => {
      if (cancelled) {
        ydoc.destroy();
        return;
      }

      if (!ticket) {
        setConnectionStatus("disconnected");
        console.warn("[useYjsProvider] Failed to get WS ticket");
        // Still mark as synced so user can edit offline
        setIsSynced(true);
        return;
      }

      const wsUrl = `ws://${window.location.hostname}:3001`;
      wsProvider = new WebsocketProvider(wsUrl, `doc-${docId}`, ydoc, {
        params: { ticket, docId },
      });
      wsProviderRef.current = wsProvider;

      // Configure awareness — only expose minimal safe data (no userId, email, role)
      wsProvider.awareness.setLocalState({
        user: {
          name: session?.user?.name ?? "Anonymous",
          color: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
          avatar: session?.user?.image ?? undefined,
        },
      });

      wsProvider.on("status", (event: { status: string }) => {
        if (cancelled) return;
        switch (event.status) {
          case "connected":
            setIsConnected(true);
            setConnectionStatus("syncing");
            break;
          case "disconnected":
            setIsConnected(false);
            setConnectionStatus("disconnected");
            // Auto-reconnect is handled by y-websocket
            break;
        }
      });

      wsProvider.on("sync", (synced: boolean) => {
        if (cancelled) return;
        setIsSynced(synced);
        if (synced) {
          setConnectionStatus("connected");
        }
      });

      wsProvider.on("connection-error", () => {
        if (cancelled) return;
        setConnectionStatus("disconnected");
      });
    });

    return () => {
      cancelled = true;
      wsProvider?.destroy();
      wsProviderRef.current = null;
      idxdb.destroy();
      idxdbRef.current = null;
      ydoc.destroy();
      ydocRef.current = null;
      setIsConnected(false);
      setIsSynced(false);
      setConnectionStatus("disconnected");
    };
  }, [docId, fetchTicket]);

  return {
    ydoc: ydocRef.current,
    provider: wsProviderRef.current,
    awareness: wsProviderRef.current?.awareness ?? null,
    isConnected,
    isSynced,
    connectionStatus,
  };
}
