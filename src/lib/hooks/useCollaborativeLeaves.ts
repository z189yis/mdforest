"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";

export interface LeafPosition {
  x: number;
  y: number;
}

interface LeafState {
  x: number;
  y: number;
  connectedHashes: string[];
}

/**
 * Syncs leaf positions through a Yjs Map for real-time canvas collaboration.
 * Uses dirty flag + requestAnimationFrame batch processing to avoid
 * disrupting the Canvas render pipeline.
 *
 * Only broadcasts on drag-end, ensuring fluid local dragging at 60fps.
 */
export function useCollaborativeLeaves(
  ydoc: Y.Doc | null,
  onRemoteLeafChange?: (leafId: string, x: number, y: number) => void,
) {
  const yLeafsRef = useRef<Y.Map<LeafState> | null>(null);
  const dirtyRef = useRef(false);
  const pendingUpdates = useRef<Map<string, LeafState>>(new Map());
  const rAFRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ydoc) return;

    const yLeafs = ydoc.getMap<LeafState>("leafs");
    yLeafsRef.current = yLeafs;

    // Batch remote changes via rAF
    const observer = () => {
      for (const [key, value] of yLeafs.entries()) {
        pendingUpdates.current.set(key, { ...value });
      }
      dirtyRef.current = true;

      if (!rAFRef.current) {
        rAFRef.current = requestAnimationFrame(() => {
          rAFRef.current = null;
          if (!dirtyRef.current) return;
          dirtyRef.current = false;

          pendingUpdates.current.forEach((state, leafId) => {
            onRemoteLeafChange?.(leafId, state.x, state.y);
          });
          pendingUpdates.current.clear();
        });
      }
    };

    yLeafs.observe(observer);

    return () => {
      if (rAFRef.current) {
        cancelAnimationFrame(rAFRef.current);
        rAFRef.current = null;
      }
    };
  }, [ydoc, onRemoteLeafChange]);

  /**
   * Set a leaf position locally and broadcast (call on drag-end).
   */
  const setLeafPosition = useCallback(
    (leafId: string, x: number, y: number, connectedHashes: string[] = []) => {
      yLeafsRef.current?.set(leafId, { x, y, connectedHashes });
    },
    [],
  );

  /**
   * Remove a leaf from the shared map.
   */
  const removeLeaf = useCallback((leafId: string) => {
    yLeafsRef.current?.delete(leafId);
  }, []);

  return { setLeafPosition, removeLeaf };
}
