"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GitTree, ROW_HEIGHT } from "@/server/git/tree-builder";
import { useViewportController, ViewportTransform } from "@/lib/hooks/useViewportController";
import { Spinner } from "@/components/ui";

const BRANCH_COLORS = [
  "#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6",
  "#06b6d4", "#ef4444", "#22c55e", "#f97316", "#3b82f6",
  "#a855f7", "#10b981",
];

const DATE_X_OFFSET = -110;
const LEAF_START_X = 290;
const LEAF_SPACING = 30;
const LEAF_HIT_RADIUS = 10;

type LeafInfo = {
  id: string;
  title: string;
  leafX: number | null;
  leafY: number | null;
  connectedHashes: string[];
};

type DocLeavesData = {
  byCommit: Record<string, LeafInfo[]>;
  isolated: LeafInfo[];
  leafMap: Record<string, LeafInfo>;
};

type LeafPosition = { x: number; y: number };

interface GitTreeCanvasProps {
  tree?: GitTree;
  isLoading: boolean;
  error?: unknown;
  docLeaves?: DocLeavesData;
  onCommitClick: (hash: string) => void;
  onDocClick?: (docId: string) => void;
  onFileDrop?: (hash: string | null, fileName: string, content: string, leafX: number, leafY: number) => void;
  onLeafPositionChange?: (docId: string, leafX: number, leafY: number) => void;
}

export function GitTreeCanvas({ tree, isLoading, error, docLeaves, onCommitClick, onDocClick, onFileDrop, onLeafPositionChange }: GitTreeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [dragHash, setDragHash] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragHashRef = useRef<string | null>(null);

  // Hover state
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const [hoveredLeafId, setHoveredLeafId] = useState<string | null>(null);
  const hoveredHashRef = useRef<string | null>(null);
  const hoveredLeafIdRef = useRef<string | null>(null);

  // Leaf drag state
  const [draggingLeafId, setDraggingLeafId] = useState<string | null>(null);
  const draggingLeafRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const dirtyLeafPositionsRef = useRef<Map<string, LeafPosition>>(new Map());

  // Expand animation
  const targetExpandRef = useRef(0);
  const currentExpandRef = useRef(0);

  // Refs for data accessed in callbacks (avoid stale closures)
  const docLeavesRef = useRef<DocLeavesData | undefined>(docLeaves);
  docLeavesRef.current = docLeaves;
  const treeRef = useRef<GitTree | undefined>(tree);
  treeRef.current = tree;

  const { transform, handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, screenToWorld } =
    useViewportController({ initialOffsetX: 160, initialOffsetY: 40 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize({ width: Math.max(width, 100), height: Math.max(height, 100) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tree) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.scale(dpr, dpr);

    const render = () => {
      const target = targetExpandRef.current;
      const current = currentExpandRef.current;
      const diff = target - current;
      if (Math.abs(diff) > 0.5) {
        currentExpandRef.current = current + diff * 0.18;
      } else {
        currentExpandRef.current = target;
      }

      drawFrame(
        ctx, tree, transform, canvasSize.width, canvasSize.height,
        dragHash, docLeaves,
        hoveredHashRef.current, hoveredLeafIdRef.current,
        currentExpandRef.current,
        dirtyLeafPositionsRef.current
      );
      rafRef.current = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(rafRef.current);
  }, [tree, transform, canvasSize, dragHash, docLeaves]);

  // ---- Interaction handlers ----

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!tree || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

      // Check if clicking on a leaf (for drag)
      const leafPositions = computeLeafPositions(tree, docLeavesRef.current, dirtyLeafPositionsRef.current);
      for (const [leafId, pos] of leafPositions) {
        if (Math.abs(world.x - pos.x) < LEAF_HIT_RADIUS && Math.abs(world.y - pos.y) < LEAF_HIT_RADIUS) {
          e.stopPropagation(); // prevent panning
          draggingLeafRef.current = leafId;
          setDraggingLeafId(leafId);
          dragOffsetRef.current = { x: world.x - pos.x, y: world.y - pos.y };
          return;
        }
      }
    },
    [tree, screenToWorld]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !tree) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

      // Leaf dragging
      if (draggingLeafRef.current) {
        e.stopPropagation();
        const leafId = draggingLeafRef.current;
        const newX = world.x - dragOffsetRef.current.x;
        const newY = world.y - dragOffsetRef.current.y;
        const dirty = new Map(dirtyLeafPositionsRef.current);
        dirty.set(leafId, { x: newX, y: newY });
        dirtyLeafPositionsRef.current = dirty;
        return;
      }

      // Normal hover
      const hit = leafAndNodeHitTest(world.x, world.y, tree, docLeavesRef.current, dirtyLeafPositionsRef.current);
      if (hit?.type === "leaf") {
        hoveredLeafIdRef.current = hit.leafId;
        hoveredHashRef.current = hit.hash;
        setHoveredLeafId(hit.leafId);
        setHoveredHash(hit.hash);
        targetExpandRef.current = 0;
      } else if (hit?.type === "node") {
        hoveredHashRef.current = hit.hash;
        hoveredLeafIdRef.current = null;
        setHoveredHash(hit.hash);
        setHoveredLeafId(null);
        targetExpandRef.current = 24;
      } else {
        hoveredHashRef.current = null;
        hoveredLeafIdRef.current = null;
        setHoveredHash(null);
        setHoveredLeafId(null);
        targetExpandRef.current = 0;
      }
    },
    [tree, screenToWorld]
  );

  const handleCanvasMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (draggingLeafRef.current && onLeafPositionChange) {
        const leafId = draggingLeafRef.current;
        const pos = dirtyLeafPositionsRef.current.get(leafId);
        if (pos) {
          onLeafPositionChange(leafId, pos.x, pos.y);
        }
      }
      draggingLeafRef.current = null;
      setDraggingLeafId(null);
    },
    [onLeafPositionChange]
  );

  const handleCanvasMouseLeave = useCallback(() => {
    // End drag on leave
    if (draggingLeafRef.current && onLeafPositionChange) {
      const leafId = draggingLeafRef.current;
      const pos = dirtyLeafPositionsRef.current.get(leafId);
      if (pos) {
        onLeafPositionChange(leafId, pos.x, pos.y);
      }
    }
    draggingLeafRef.current = null;
    setDraggingLeafId(null);
    hoveredHashRef.current = null;
    hoveredLeafIdRef.current = null;
    setHoveredHash(null);
    setHoveredLeafId(null);
    targetExpandRef.current = 0;
  }, [onLeafPositionChange]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!tree || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

      // Check leaf click first
      const leafPositions = computeLeafPositions(tree, docLeavesRef.current, dirtyLeafPositionsRef.current);
      for (const [leafId, pos] of leafPositions) {
        if (Math.abs(world.x - pos.x) < LEAF_HIT_RADIUS && Math.abs(world.y - pos.y) < LEAF_HIT_RADIUS) {
          onDocClick?.(leafId);
          return;
        }
      }

      // Check node click
      const row = Math.floor(world.y / ROW_HEIGHT);
      if (row >= 0 && row < tree.nodes.length) {
        const node = tree.nodes[row]!;
        if (world.x >= node.x - 10 && world.x <= node.x + 400) {
          onCommitClick(node.hash);
        }
      }
    },
    [tree, screenToWorld, onCommitClick, onDocClick]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!canvasRef.current || !tree) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

      const hit = leafAndNodeHitTest(world.x, world.y, tree, docLeavesRef.current, dirtyLeafPositionsRef.current);
      const hash = hit?.type === "node" ? hit.hash : null;
      dragHashRef.current = hash;
      setDragHash(hash);
      setDragOver(true);
    },
    [tree, screenToWorld]
  );

  const handleDragLeave = useCallback(() => {
    dragHashRef.current = null;
    setDragHash(null);
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragHash(null);
      setDragOver(false);
      if (!onFileDrop || !canvasRef.current || !tree) return;
      const files = e.dataTransfer.files;
      if (files.length === 0) return;
      const file = files[0]!;

      const rect = canvasRef.current.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

      const hash = dragHashRef.current; // set during dragOver if over a node
      const reader = new FileReader();
      reader.onload = () => onFileDrop(hash, file.name, reader.result as string, world.x, world.y);
      reader.readAsText(file);
    },
    [onFileDrop, tree, screenToWorld]
  );

  if (isLoading) return <div className="flex items-center justify-center h-full"><Spinner /></div>;
  if (error) return <div className="flex items-center justify-center h-full"><div className="text-center text-red-500">Failed to load Git tree</div></div>;
  if (!tree || tree.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-zinc-500"><p className="text-lg font-medium">No commits yet</p><p className="text-sm mt-1">Push to this repository to get started</p></div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950 cursor-grab active:cursor-grabbing"
      onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onWheel={handleWheel}
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-indigo-500 text-white text-xs font-medium z-10 pointer-events-none">
          Drop .md file {dragHash ? "to link to commit" : "as isolated leaf"}
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{ width: canvasSize.width, height: canvasSize.height }}
        className="block"
        onClick={handleClick}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseLeave}
      />
    </div>
  );
}

// ============================================================================
//  Render functions
// ============================================================================

function drawFrame(
  ctx: CanvasRenderingContext2D, tree: GitTree, t: ViewportTransform,
  canvasW: number, canvasH: number, highlightHash: string | null,
  docLeaves?: DocLeavesData,
  hoveredHash?: string | null,
  hoveredLeafId?: string | null,
  expandOffset?: number,
  dirtyLeafPositions?: Map<string, LeafPosition>
) {
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.save();
  ctx.translate(t.offsetX, t.offsetY);
  ctx.scale(t.zoom, t.zoom);

  const invZoom = 1 / t.zoom;
  const startRow = Math.max(0, Math.floor(-t.offsetY * invZoom / ROW_HEIGHT) - 2);
  const endRow = Math.min(tree.nodes.length - 1, Math.ceil((canvasH - t.offsetY) * invZoom / ROW_HEIGHT) + 2);
  const worldWidth = canvasW * invZoom;

  // Find hovered row
  const hoveredRow = hoveredHash ? tree.nodes.findIndex(n => n.hash === hoveredHash) : -1;
  const effectiveExpand = hoveredRow >= 0 ? (expandOffset ?? 0) : 0;

  // Pre-compute connected commit edges for highlighting
  const connectedEdges = new Set<number>();
  const connectedHashes = new Set<string>();
  if (hoveredHash) {
    connectedHashes.add(hoveredHash);
    for (let i = 0; i < tree.edges.length; i++) {
      const edge = tree.edges[i]!;
      if (edge.fromHash === hoveredHash || edge.toHash === hoveredHash) {
        connectedEdges.add(i);
        const other = edge.fromHash === hoveredHash ? edge.toHash : edge.fromHash;
        connectedHashes.add(other);
      }
    }
    for (const ch of connectedHashes) {
      for (let j = 0; j < tree.edges.length; j++) {
        const e2 = tree.edges[j]!;
        if (e2.fromHash === ch || e2.toHash === ch) {
          connectedEdges.add(j);
        }
      }
    }
  }

  // Compute leaf positions (for connections and icons)
  const leafPositions = computeLeafPositions(tree, docLeaves, dirtyLeafPositions ?? new Map());

  // Build set of leaf IDs connected to the hovered node
  const hoveredNodeLeafIds = new Set<string>();
  if (hoveredHash && docLeaves?.byCommit[hoveredHash]) {
    for (const l of docLeaves.byCommit[hoveredHash]) {
      hoveredNodeLeafIds.add(l.id);
    }
  }

  // 1. Commit-to-commit edges
  for (let i = 0; i < tree.edges.length; i++) {
    const edge = tree.edges[i]!;
    if ((edge.fromRow < startRow || edge.fromRow > endRow) && (edge.toRow < startRow || edge.toRow > endRow)) continue;
    if (edge.fromRow >= tree.nodes.length || edge.toRow >= tree.nodes.length) continue;
    const from = tree.nodes[edge.fromRow], to = tree.nodes[edge.toRow];
    if (!from || !to) continue;

    const fromY = from.y + (edge.fromRow > hoveredRow ? effectiveExpand : 0) + (edge.fromRow === hoveredRow ? effectiveExpand * 0.5 : 0);
    const toY = to.y + (edge.toRow > hoveredRow ? effectiveExpand : 0) + (edge.toRow === hoveredRow ? effectiveExpand * 0.5 : 0);

    const c = BRANCH_COLORS[edge.fromColumn % BRANCH_COLORS.length]!;
    const isConnected = connectedEdges.has(i);
    drawCurve(ctx, from.x + 4, fromY + ROW_HEIGHT / 2, to.x + 4, toY + ROW_HEIGHT / 2, c, isConnected);
  }

  // 2. Commit nodes (no leaves, no square borders)
  for (let i = startRow; i <= endRow; i++) {
    const node = tree.nodes[i];
    if (!node) continue;

    let effectiveY = node.y;
    if (i > hoveredRow) effectiveY += effectiveExpand;

    const isHovered = i === hoveredRow;
    drawCommitNode(ctx, node, effectiveY, highlightHash === node.hash, isHovered, worldWidth, isHovered ? effectiveExpand : 0);
  }

  // 3. Leaf-to-commit connection lines
  if (docLeaves) {
    for (const [leafId, pos] of leafPositions) {
      const leaf = docLeaves.leafMap[leafId];
      if (!leaf || leaf.connectedHashes.length === 0) continue;

      const isLeafHovered = hoveredLeafId === leafId;
      const isConnectedToHoveredNode = hoveredHash ? leaf.connectedHashes.includes(hoveredHash) : false;
      const highlightConn = isLeafHovered || isConnectedToHoveredNode;

      for (const hash of leaf.connectedHashes) {
        const node = tree.nodes.find(n => n.hash === hash);
        if (!node) continue;

        const ny = node.y + (node.row > hoveredRow ? effectiveExpand : 0) + ROW_HEIGHT / 2 + (node.row === hoveredRow ? effectiveExpand * 0.5 : 0);
        drawLeafConnection(ctx, node.x + 5, ny, pos.x, pos.y, highlightConn);
      }
    }
  }

  // 4. Leaf icons and names
  if (docLeaves) {
    for (const [leafId, pos] of leafPositions) {
      const leaf = docLeaves.leafMap[leafId];
      if (!leaf) continue;
      const isLeafHovered = hoveredLeafId === leafId;
      const isConnectedToHoveredNode = hoveredHash ? leaf.connectedHashes.includes(hoveredHash) : false;
      const highlight = isLeafHovered || isConnectedToHoveredNode;
      drawLeafIcon(ctx, pos.x, pos.y, leaf.title, highlight, worldWidth > 400 || highlight);
    }
  }

  ctx.restore();
}

function drawCommitNode(
  ctx: CanvasRenderingContext2D,
  node: GitTree["nodes"][number],
  effectiveY: number,
  highlight: boolean,
  isHovered: boolean,
  worldWidth: number,
  expandOffset: number
) {
  const x = node.x;
  const y = effectiveY;
  const rowHeight = isHovered ? ROW_HEIGHT + expandOffset : ROW_HEIGHT;
  const midY = y + ROW_HEIGHT / 2;
  const colorIdx = node.column % BRANCH_COLORS.length;
  const color = BRANCH_COLORS[colorIdx] ?? BRANCH_COLORS[0]!;

  const showHash = worldWidth > 280;

  // Subtle background only on highlight (drag-over) — not for hover
  if (highlight) {
    ctx.fillStyle = "rgba(99,102,241,0.12)";
    ctx.beginPath(); roundRect(ctx, x - 4, y + 2, 400, rowHeight - 4, 6); ctx.fill();
  }

  // Date on the left
  const dateStr = formatDate(node.authorDate);
  ctx.font = "10px 'Cascadia Code', monospace";
  ctx.fillStyle = isHovered ? "#a5b4fc" : "#666";
  ctx.fillText(dateStr, x + DATE_X_OFFSET, y + 18);

  // Dot — larger on hover
  const dotR = isHovered ? 5 : 4;
  ctx.beginPath();
  ctx.arc(x + 5, midY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = node.isMerge ? "#f59e0b" : color;
  ctx.fill();
  if (isHovered) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Hash
  if (showHash || isHovered) {
    ctx.font = "11px 'Cascadia Code', monospace";
    ctx.fillStyle = isHovered ? "#c7d2fe" : "#888";
    ctx.fillText(node.shortHash, x + 14, midY + 4);
  }

  // Expanded content on hover
  if (isHovered) {
    ctx.font = "12px Inter, sans-serif";
    ctx.fillStyle = "#e4e4e7";
    const maxMsgWidth = worldWidth > 500 ? 200 : 140;
    const msg = truncateText(ctx, node.message, maxMsgWidth);
    ctx.fillText(msg, x + 80, midY + 4);

    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = "#888";
    ctx.fillText(`${node.authorName}`, x + 80, y + rowHeight - 8);

    let bx = x + 80 + ctx.measureText(msg).width + 8;
    for (const b of node.branches.slice(0, 3)) {
      ctx.font = "10px Inter, sans-serif";
      const tw = ctx.measureText(b).width;
      ctx.fillStyle = "rgba(99,102,241,0.25)";
      ctx.beginPath(); roundRect(ctx, bx, midY - 8, tw + 8, 16, 4); ctx.fill();
      ctx.fillStyle = "#a5b4fc";
      ctx.fillText(b, bx + 4, midY + 4);
      bx += tw + 14;
    }
  } else if (node.branches.length > 0 && showHash) {
    ctx.font = "10px Inter, sans-serif";
    const b = node.branches[0]!;
    const tw = ctx.measureText(b).width;
    const bx = x + 80;
    ctx.fillStyle = "rgba(99,102,241,0.2)";
    ctx.beginPath(); roundRect(ctx, bx, midY - 8, Math.min(tw + 8, 100), 16, 4); ctx.fill();
    ctx.fillStyle = "#a5b4fc";
    ctx.fillText(truncateText(ctx, b, 90), bx + 4, midY + 4);
  }
}

function drawLeafConnection(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  highlight: boolean
) {
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  ctx.bezierCurveTo(midX, fromY - 12, midX, toY + 12, toX, toY);
  ctx.strokeStyle = highlight ? "rgba(34,197,94,0.85)" : "rgba(34,197,94,0.4)";
  ctx.lineWidth = highlight ? 2.5 : 1.5;
  ctx.stroke();
}

function drawLeafIcon(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  title: string,
  highlight: boolean,
  showName: boolean
) {
  // Glow
  ctx.beginPath();
  ctx.ellipse(x, y, 9, 6, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = highlight ? "rgba(34,197,94,0.3)" : "rgba(34,197,94,0.1)";
  ctx.fill();

  // Leaf icon
  ctx.beginPath();
  ctx.ellipse(x, y, highlight ? 7 : 6, highlight ? 5 : 4, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = highlight ? "#4ade80" : "#22c55e";
  ctx.fill();
  ctx.strokeStyle = highlight ? "#4ade80" : "rgba(22,163,74,0.5)";
  ctx.lineWidth = highlight ? 1.8 : 0.8;
  ctx.stroke();

  // Name
  if (showName) {
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = highlight ? "#86efac" : "#4ade80";
    const t = title.length > 14 ? title.substring(0, 14) + "\u2026" : title;
    ctx.fillText(t, x + 10, y + 4);
  }
}

function drawCurve(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  color: string,
  highlight: boolean
) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  const midY = (y1 + y2) / 2;
  if (Math.abs(x1 - x2) < 4) {
    ctx.lineTo(x1, y2);
  } else {
    ctx.bezierCurveTo(x1, midY, x2, midY, x2, y2);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = highlight ? 2.5 : 1.5;
  ctx.globalAlpha = highlight ? 0.9 : 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ============================================================================
//  Helpers
// ============================================================================

function computeLeafPositions(
  tree: GitTree,
  docLeaves: DocLeavesData | undefined,
  dirtyPositions: Map<string, LeafPosition>
): Map<string, LeafPosition> {
  const positions = new Map<string, LeafPosition>();
  if (!docLeaves) return positions;

  const commitAutoIdx = new Map<string, number>();

  for (const leaf of Object.values(docLeaves.leafMap)) {
    // Dirty override (drag in progress)
    if (dirtyPositions.has(leaf.id)) {
      positions.set(leaf.id, dirtyPositions.get(leaf.id)!);
      continue;
    }
    // Stored explicit position
    if (leaf.leafX !== null && leaf.leafY !== null) {
      positions.set(leaf.id, { x: leaf.leafX, y: leaf.leafY });
      continue;
    }
    // Auto-position near first connected commit
    if (leaf.connectedHashes.length > 0) {
      const hash = leaf.connectedHashes[0]!;
      const node = tree.nodes.find(n => n.hash === hash);
      if (node) {
        const idx = commitAutoIdx.get(hash) ?? 0;
        commitAutoIdx.set(hash, idx + 1);
        positions.set(leaf.id, {
          x: node.x + LEAF_START_X + idx * LEAF_SPACING,
          y: node.y + ROW_HEIGHT / 2,
        });
      }
    }
  }

  return positions;
}

function leafAndNodeHitTest(
  worldX: number, worldY: number,
  tree: GitTree,
  docLeaves: DocLeavesData | undefined,
  dirtyPositions: Map<string, LeafPosition>
): { type: "leaf"; leafId: string; hash: string | null } | { type: "node"; hash: string } | null {
  // Check leaves first (they should take priority for click)
  const leafPositions = computeLeafPositions(tree, docLeaves, dirtyPositions);
  for (const [leafId, pos] of leafPositions) {
    if (Math.abs(worldX - pos.x) < LEAF_HIT_RADIUS && Math.abs(worldY - pos.y) < LEAF_HIT_RADIUS) {
      const leaf = docLeaves?.leafMap[leafId];
      return { type: "leaf", leafId, hash: leaf?.connectedHashes[0] ?? null };
    }
  }

  // Then check nodes — only dot + shortHash area, not the whole row
  const row = Math.floor(worldY / ROW_HEIGHT);
  if (row >= 0 && row < tree.nodes.length) {
    const node = tree.nodes[row]!;
    if (worldX >= node.x - 6 && worldX <= node.x + 78) {
      return { type: "node", hash: node.hash };
    }
  }

  return null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function formatDate(date: Date): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.substring(0, mid) + "\u2026").width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.substring(0, lo) + "\u2026";
}
