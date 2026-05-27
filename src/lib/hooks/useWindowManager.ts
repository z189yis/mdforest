"use client";

import { useState, useCallback } from "react";

export type WindowKind = "doc" | "memory" | "commit";

export interface WindowState {
  id: string;
  title: string;
  kind: WindowKind;
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
  openMemory: (memoryId: string, title: string) => void;
  openCommit: (commitHash: string, title: string) => void;
  close: (docId: string) => void;
  focus: (docId: string) => void;
  minimize: (docId: string) => void;
  updatePosition: (docId: string, x: number, y: number) => void;
  updateSize: (docId: string, width: number, height: number) => void;
  restore: (docId: string) => void;
}

const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 420;
const MEMORY_DEFAULT_WIDTH = 400;
const MEMORY_DEFAULT_HEIGHT = 320;
const COMMIT_DEFAULT_WIDTH = 480;
const COMMIT_DEFAULT_HEIGHT = 500;
const MIN_WIDTH = 260;
const MIN_HEIGHT = 180;

let nextZIndex = 100;

export function useWindowManager(): UseWindowManagerReturn {
  const [windows, setWindows] = useState<WindowState[]>([]);

  const open = useCallback((docId: string, title: string) => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === docId);
      if (existing) {
        const newZ = ++nextZIndex;
        return prev.map((w) =>
          w.id === docId
            ? { ...w, minimized: false, zIndex: newZ }
            : w
        );
      }
      const count = prev.length;
      const newZ = ++nextZIndex;
      const offset = (count % 8) * 28;
      return [
        ...prev,
        {
          id: docId,
          title,
          kind: "doc",
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

  const openMemory = useCallback((memoryId: string, title: string) => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === memoryId);
      if (existing) {
        const newZ = ++nextZIndex;
        return prev.map((w) =>
          w.id === memoryId
            ? { ...w, minimized: false, zIndex: newZ }
            : w
        );
      }
      const count = prev.length;
      const newZ = ++nextZIndex;
      const offset = (count % 8) * 28;
      return [
        ...prev,
        {
          id: memoryId,
          title,
          kind: "memory",
          x: 60 + offset,
          y: 60 + offset,
          width: MEMORY_DEFAULT_WIDTH,
          height: MEMORY_DEFAULT_HEIGHT,
          zIndex: newZ,
          minimized: false,
        },
      ];
    });
  }, []);

  const openCommit = useCallback((commitHash: string, title: string) => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === commitHash);
      if (existing) {
        const newZ = ++nextZIndex;
        return prev.map((w) =>
          w.id === commitHash
            ? { ...w, minimized: false, zIndex: newZ }
            : w
        );
      }
      const count = prev.length;
      const newZ = ++nextZIndex;
      const offset = (count % 8) * 28;
      return [
        ...prev,
        {
          id: commitHash,
          title,
          kind: "commit",
          x: 80 + offset,
          y: 80 + offset,
          width: COMMIT_DEFAULT_WIDTH,
          height: COMMIT_DEFAULT_HEIGHT,
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
    openMemory,
    openCommit,
    close,
    focus,
    minimize,
    updatePosition,
    updateSize,
    restore,
  };
}
