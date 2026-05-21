"use client";

import { useCallback, useRef, useEffect } from "react";

interface FloatingWindowProps {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  title: string;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  children: React.ReactNode;
}

type DragType = "title" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const RESIZE_HANDLE_SIZE = 6;

export function FloatingWindow({
  x,
  y,
  width,
  height,
  zIndex,
  minimized,
  title,
  onMove,
  onResize,
  onFocus,
  onClose,
  onMinimize,
  children,
}: FloatingWindowProps) {
  const dragRef = useRef<{
    type: DragType;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);

  const rafRef = useRef<number | null>(null);

  const handlePointerDown = useCallback(
    (type: DragType, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onFocus();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        type,
        startX: e.clientX,
        startY: e.clientY,
        startW: width,
        startH: height,
        startPosX: x,
        startPosY: y,
      };
    },
    [onFocus, width, height, x, y]
  );

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;

      // Use rAF for smooth updates
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (!dragRef.current) return;
        const dd = dragRef.current;
        const dx = e.clientX - dd.startX;
        const dy = e.clientY - dd.startY;

        switch (dd.type) {
          case "title": {
            onMove(dd.startPosX + dx, Math.max(0, dd.startPosY + dy));
            break;
          }
          case "e":
            onResize(dd.startW + dx, dd.startH);
            break;
          case "w":
            onResize(dd.startW - dx, dd.startH);
            onMove(dd.startPosX + dx, dd.startPosY);
            break;
          case "s":
            onResize(dd.startW, dd.startH + dy);
            break;
          case "n":
            onResize(dd.startW, dd.startH - dy);
            onMove(dd.startPosX, dd.startPosY + dy);
            break;
          case "se":
            onResize(dd.startW + dx, dd.startH + dy);
            break;
          case "sw":
            onResize(dd.startW - dx, dd.startH + dy);
            onMove(dd.startPosX + dx, dd.startPosY);
            break;
          case "ne":
            onResize(dd.startW + dx, dd.startH - dy);
            onMove(dd.startPosX, dd.startPosY + dy);
            break;
          case "nw":
            onResize(dd.startW - dx, dd.startH - dy);
            onMove(dd.startPosX + dx, dd.startPosY + dy);
            break;
        }
      });
    };

    const onPointerUp = () => {
      dragRef.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onMove, onResize]);

  return (
    <div
      className={`fixed bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-2xl flex flex-col overflow-hidden ${
        minimized ? "!h-10" : ""
      }`}
      style={{
        left: x,
        top: y,
        width,
        height,
        zIndex,
        minWidth: 300,
        minHeight: minimized ? undefined : 200,
        transition: "box-shadow 0.15s",
      }}
      onPointerDown={onFocus}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700 cursor-grab active:cursor-grabbing select-none flex-shrink-0"
        onPointerDown={(e) => handlePointerDown("title", e)}
        onDoubleClick={onMinimize}
      >
        <svg className="h-3.5 w-3.5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
        </svg>
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate flex-1">
          {title}
        </span>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs"
          onClick={(e) => { e.stopPropagation(); onMinimize(); }}
          title="Minimize"
        >
          ─
        </button>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 text-xs"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      {!minimized && (
        <div className="flex-1 overflow-hidden">{children}</div>
      )}

      {/* Resize handles */}
      {!minimized && (
        <>
          {/* Edges */}
          <div
            className="absolute top-0 left-0 right-0 cursor-n-resize"
            style={{ height: RESIZE_HANDLE_SIZE, top: -RESIZE_HANDLE_SIZE / 2 }}
            onPointerDown={(e) => handlePointerDown("n", e)}
          />
          <div
            className="absolute bottom-0 left-0 right-0 cursor-s-resize"
            style={{ height: RESIZE_HANDLE_SIZE, bottom: -RESIZE_HANDLE_SIZE / 2 }}
            onPointerDown={(e) => handlePointerDown("s", e)}
          />
          <div
            className="absolute top-0 bottom-0 left-0 cursor-w-resize"
            style={{ width: RESIZE_HANDLE_SIZE, left: -RESIZE_HANDLE_SIZE / 2 }}
            onPointerDown={(e) => handlePointerDown("w", e)}
          />
          <div
            className="absolute top-0 bottom-0 right-0 cursor-e-resize"
            style={{ width: RESIZE_HANDLE_SIZE, right: -RESIZE_HANDLE_SIZE / 2 }}
            onPointerDown={(e) => handlePointerDown("e", e)}
          />
          {/* Corners */}
          <div
            className="absolute top-0 left-0 cursor-nw-resize"
            style={{ width: RESIZE_HANDLE_SIZE * 2, height: RESIZE_HANDLE_SIZE * 2, top: -RESIZE_HANDLE_SIZE / 2, left: -RESIZE_HANDLE_SIZE / 2 }}
            onPointerDown={(e) => handlePointerDown("nw", e)}
          />
          <div
            className="absolute top-0 right-0 cursor-ne-resize"
            style={{ width: RESIZE_HANDLE_SIZE * 2, height: RESIZE_HANDLE_SIZE * 2, top: -RESIZE_HANDLE_SIZE / 2, right: -RESIZE_HANDLE_SIZE / 2 }}
            onPointerDown={(e) => handlePointerDown("ne", e)}
          />
          <div
            className="absolute bottom-0 left-0 cursor-sw-resize"
            style={{ width: RESIZE_HANDLE_SIZE * 2, height: RESIZE_HANDLE_SIZE * 2, bottom: -RESIZE_HANDLE_SIZE / 2, left: -RESIZE_HANDLE_SIZE / 2 }}
            onPointerDown={(e) => handlePointerDown("sw", e)}
          />
          <div
            className="absolute bottom-0 right-0 cursor-se-resize"
            style={{ width: RESIZE_HANDLE_SIZE * 2, height: RESIZE_HANDLE_SIZE * 2, bottom: -RESIZE_HANDLE_SIZE / 2, right: -RESIZE_HANDLE_SIZE / 2 }}
            onPointerDown={(e) => handlePointerDown("se", e)}
          />
        </>
      )}
    </div>
  );
}
