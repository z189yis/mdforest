"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface ViewportTransform {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

interface ViewportControllerProps {
  minZoom?: number;
  maxZoom?: number;
  initialOffsetX?: number;
  initialOffsetY?: number;
  initialZoom?: number;
}

export function useViewportController(props: ViewportControllerProps = {}) {
  const {
    minZoom = 0.1,
    maxZoom = 5.0,
    initialOffsetX = 0,
    initialOffsetY = 0,
    initialZoom = 1.0,
  } = props;

  const [transform, setTransform] = useState<ViewportTransform>({
    offsetX: initialOffsetX,
    offsetY: initialOffsetY,
    zoom: initialZoom,
  });

  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setTransform((t) => ({ ...t, offsetX: t.offsetX + dx, offsetY: t.offsetY + dy }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setTransform((t) => ({
        ...t,
        zoom: Math.min(maxZoom, Math.max(minZoom, t.zoom * delta)),
      }));
    },
    [minZoom, maxZoom]
  );

  // Clean up listeners on unmount
  useEffect(() => {
    const onMouseUp = () => (isDragging.current = false);
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  const resetView = useCallback(() => {
    setTransform({ offsetX: initialOffsetX, offsetY: initialOffsetY, zoom: initialZoom });
  }, [initialOffsetX, initialOffsetY, initialZoom]);

  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => ({
      x: (screenX - transform.offsetX) / transform.zoom,
      y: (screenY - transform.offsetY) / transform.zoom,
    }),
    [transform]
  );

  return {
    transform,
    setTransform,
    containerRef,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    resetView,
    screenToWorld,
  };
}
