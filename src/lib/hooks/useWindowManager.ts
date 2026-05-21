"use client";

import { useState, useCallback } from "react";

export interface WindowState {
  id: string; // docId
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
}

interface UseWindowManagerReturn {
  windows: WindowState[];
  open: (docId: string, title: string) => void;
  close: (docId: string) => void;
  focus: (docId: string) => void;
  minimize: (docId: string) => void;
  updatePosition: (docId: string, x: number, y: number) => void;
  updateSize: (docId: string, width: number, height: number) => void;
  restore: (docId: string) => void;
}

const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 420;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 200;

let nextZIndex = 100;

export function useWindowManager(): UseWindowManagerReturn {
  const [windows, setWindows] = useState<WindowState[]>([]);

  const open = useCallback((docId: string, title: string) => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === docId);
      if (existing) {
        // Already open: un-minimize and bring to front
        const newZ = ++nextZIndex;
        return prev.map((w) =>
          w.id === docId
            ? { ...w, minimized: false, zIndex: newZ }
            : w
        );
      }
      // New window: cascade offset from last window
      const count = prev.length;
      const newZ = ++nextZIndex;
      // Position with cascade, wrapping to avoid going off-screen
      const offset = (count % 8) * 28;
      return [
        ...prev,
        {
          id: docId,
          title,
          x: 40 + offset,
          y: 40 + offset,
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
          zIndex: newZ,
          minimized: false,
        },
      ];
    });
  }, []);

  const close = useCallback((docId: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== docId));
  }, []);

  const focus = useCallback((docId: string) => {
    const newZ = ++nextZIndex;
    setWindows((prev) =>
      prev.map((w) =>
        w.id === docId ? { ...w, zIndex: newZ, minimized: false } : w
      )
    );
  }, []);

  const minimize = useCallback((docId: string) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === docId ? { ...w, minimized: true } : w
      )
    );
  }, []);

  const restore = useCallback((docId: string) => {
    const newZ = ++nextZIndex;
    setWindows((prev) =>
      prev.map((w) =>
        w.id === docId ? { ...w, minimized: false, zIndex: newZ } : w
      )
    );
  }, []);

  const updatePosition = useCallback(
    (docId: string, x: number, y: number) => {
      setWindows((prev) =>
        prev.map((w) => (w.id === docId ? { ...w, x, y } : w))
      );
    },
    []
  );

  const updateSize = useCallback(
    (docId: string, width: number, height: number) => {
      setWindows((prev) =>
        prev.map((w) =>
          w.id === docId
            ? { ...w, width: Math.max(MIN_WIDTH, width), height: Math.max(MIN_HEIGHT, height) }
            : w
        )
      );
    },
    []
  );

  return {
    windows,
    open,
    close,
    focus,
    minimize,
    updatePosition,
    updateSize,
    restore,
  };
}
