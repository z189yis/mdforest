"use client";

import { useEffect, useState } from "react";

interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

interface RemoteViewport {
  name: string;
  color: string;
  viewport: ViewportState;
}

interface ViewportIndicatorProps {
  awareness: any;
  canvasWidth: number;
  canvasHeight: number;
  onJumpToViewport?: (viewport: ViewportState) => void;
}

/**
 * Renders colored rectangles on the canvas edge showing
 * where other users are currently viewing, with 200ms throttle.
 */
export function ViewportIndicator({
  awareness,
  canvasWidth,
  canvasHeight,
  onJumpToViewport,
}: ViewportIndicatorProps) {
  const [viewports, setViewports] = useState<RemoteViewport[]>([]);

  useEffect(() => {
    if (!awareness) return;

    let lastUpdate = 0;
    const THROTTLE_MS = 200;

    const handler = () => {
      const now = Date.now();
      if (now - lastUpdate < THROTTLE_MS) return;
      lastUpdate = now;

      const states: RemoteViewport[] = [];
      awareness.getStates().forEach((state: any) => {
        if (state.user && state.viewport) {
          states.push({
            name: state.user.name,
            color: state.user.color,
            viewport: state.viewport,
          });
        }
      });
      setViewports(states);
    };

    awareness.on("change", handler);
    return () => awareness.off("change", handler);
  }, [awareness]);

  if (viewports.length === 0) return null;

  return (
    <div className="absolute bottom-2 right-2 flex items-center gap-1">
      {viewports.map((vp, i) => (
        <button
          key={i}
          className="w-5 h-5 rounded-sm opacity-60 hover:opacity-100 transition-opacity cursor-pointer border border-white/20"
          style={{ backgroundColor: vp.color }}
          title={`${vp.name}'s view`}
          onClick={() => onJumpToViewport?.(vp.viewport)}
        />
      ))}
    </div>
  );
}

/**
 * Update awareness with current viewport position.
 * Call in the canvas render loop, already throttled to 200ms.
 */
export function updateViewportAwareness(
  awareness: any,
  x: number,
  y: number,
  zoom: number,
): void {
  if (!awareness) return;

  const current = awareness.getLocalState();
  awareness.setLocalStateField("viewport", { x, y, zoom });
}
