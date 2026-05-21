"use client";

import { useCallback, useRef, useState, useEffect } from "react";

interface PanelDef {
  id: string;
  minWidth: number;
  defaultWidth: number;
  visible: boolean;
}

interface ResizablePanelsProps {
  panels: PanelDef[];
  children: React.ReactNode[];
  onChange?: (sizes: number[]) => void;
}

export function ResizablePanels({ panels, children, onChange }: ResizablePanelsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<number[]>(() => panels.map((p) => p.defaultWidth));
  const dragInfo = useRef<{ idx: number; startX: number; startSizes: number[] } | null>(null);

  const visible = panels.map((p, i) => ({ ...p, idx: i })).filter((p) => p.visible);

  const handleMouseDown = useCallback(
    (idx: number, e: React.MouseEvent) => {
      e.preventDefault();
      dragInfo.current = { idx, startX: e.clientX, startSizes: [...sizes] };
    },
    [sizes]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const d = dragInfo.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const newSizes = [...d.startSizes];
      // Resize the panel before the handle and the panel after
      const leftIdx = d.idx;
      const rightIdx = d.idx + 1;
      const leftMin = panels[leftIdx]?.minWidth ?? 100;
      const rightMin = panels[rightIdx]?.minWidth ?? 100;
      const newLeft = Math.max(leftMin, (d.startSizes[leftIdx] ?? 300) + dx);
      const newRight = Math.max(rightMin, (d.startSizes[rightIdx] ?? 300) - dx);
      newSizes[leftIdx] = newLeft;
      newSizes[rightIdx] = newRight;
      setSizes(newSizes);
      onChange?.(newSizes);
    };

    const onMouseUp = () => {
      dragInfo.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [panels, onChange]);

  if (visible.length === 0) {
    return <div className="flex-1">{children[0]}</div>;
  }

  return (
    <div ref={containerRef} className="flex-1 flex overflow-hidden h-full w-full">
      {visible.map((panel, vi) => {
        const isLast = vi === visible.length - 1;
        return (
          <div key={panel.id} className="flex" style={{ width: isLast ? undefined : sizes[panel.idx], flex: isLast ? 1 : undefined, flexShrink: 0, minWidth: panel.minWidth }}>
            <div className="flex-1 overflow-hidden border-r border-zinc-200 dark:border-zinc-800">
              {children[panel.idx]}
            </div>
            {!isLast && (
              <div
                className="w-1 -mr-0.5 cursor-col-resize hover:bg-indigo-500 active:bg-indigo-500 transition-colors z-10 flex-shrink-0"
                onMouseDown={(e) => {
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                  handleMouseDown(panel.idx, e);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
