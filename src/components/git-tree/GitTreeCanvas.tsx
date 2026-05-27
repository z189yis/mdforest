"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GitTree, ROW_HEIGHT } from "@/server/git/tree-builder";
import { useViewportController, ViewportTransform } from "@/lib/hooks/useViewportController";
import { Spinner } from "@/components/ui";
import type { MemoryMarker } from "@/lib/hooks/useMemoryMarkers";
import { MEMORY_GLYPHS } from "@/lib/hooks/useMemoryMarkers";
import type { MemoryMarkerType } from "@/lib/hooks/useMemoryMarkers";

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

const MARKER_X_OFFSET = 200;  // X offset from commit for the first memory marker
const MARKER_SPACING = 14;   // vertical spacing between markers on the same row

interface GitTreeCanvasProps {
  tree?: GitTree;
  isLoading: boolean;
  error?: unknown;
  docLeaves?: DocLeavesData;
  memoryMarkers?: MemoryMarker[];
  onCommitClick: (hash: string) => void;
  onDocClick?: (docId: string) => void;
  onMemoryClick?: (memoryId: string) => void;
  onMemoryPositionChange?: (memoryId: string, markerX: number, markerY: number) => void;
  onFileDrop?: (hash: string | null, fileName: string, content: string, leafX: number, leafY: number) => void;
  onLeafPositionChange?: (docId: string, leafX: number, leafY: number) => void;
  onGroupToggle?: (commitHash: string) => void;
  onNeedMore?: () => void;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  showTimeAlways?: boolean;
}

export function GitTreeCanvas({ tree, isLoading, error, docLeaves, memoryMarkers, onCommitClick, onDocClick, onMemoryClick, onMemoryPositionChange, onFileDrop, onLeafPositionChange, onGroupToggle, onNeedMore, hasMore, isFetchingMore, showTimeAlways }: GitTreeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragHash, setDragHash] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragHashRef = useRef<string | null>(null);

  // Hover state
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const [hoveredLeafId, setHoveredLeafId] = useState<string | null>(null);
  const [hoveredMemoryId, setHoveredMemoryId] = useState<string | null>(null);
  const hoveredHashRef = useRef<string | null>(null);
  const hoveredLeafIdRef = useRef<string | null>(null);
  const hoveredMemoryIdRef = useRef<string | null>(null);

  // Leaf drag state
  const [draggingLeafId, setDraggingLeafId] = useState<string | null>(null);
  const draggingLeafRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const dirtyLeafPositionsRef = useRef<Map<string, LeafPosition>>(new Map());
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);

  // Memory marker drag state
  const [draggingMemoryId, setDraggingMemoryId] = useState<string | null>(null);
  const draggingMemoryRef = useRef<string | null>(null);
  const dirtyMemoryPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Leaf group expand/collapse state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const expandedGroupsRef = useRef<Set<string>>(new Set());
  // Sync to ref so animation loop always reads latest (avoids stale closure)
  useEffect(() => { expandedGroupsRef.current = expandedGroups; }, [expandedGroups]);

  // Marker group expand/collapse state
  const [expandedMarkerGroups, setExpandedMarkerGroups] = useState<Set<string>>(new Set());
  const expandedMarkerGroupsRef = useRef<Set<string>>(new Set());
  useEffect(() => { expandedMarkerGroupsRef.current = expandedMarkerGroups; }, [expandedMarkerGroups]);

  // Expand animation
  const targetExpandRef = useRef(0);
  const currentExpandRef = useRef(0);

  // Refs for data accessed in callbacks (avoid stale closures)
  const docLeavesRef = useRef<DocLeavesData | undefined>(docLeaves);
  docLeavesRef.current = docLeaves;
  const treeRef = useRef<GitTree | undefined>(tree);
  treeRef.current = tree;
  const showTimeAlwaysRef = useRef(showTimeAlways);
  showTimeAlwaysRef.current = showTimeAlways;
  const memoryMarkersRef = useRef<MemoryMarker[] | undefined>(memoryMarkers);
  memoryMarkersRef.current = memoryMarkers;

  const { transform, handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, screenToWorld } =
    useViewportController({ initialOffsetX: 160, initialOffsetY: 40 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tree) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Lazy-load throttle
    let lastNeedMoreTime = 0;

    const render = () => {
      const target = targetExpandRef.current;
      const current = currentExpandRef.current;
      const diff = target - current;
      if (Math.abs(diff) > 0.5) {
        currentExpandRef.current = current + diff * 0.18;
      } else {
        currentExpandRef.current = target;
      }

      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        ctx.scale(dpr, dpr);
      }

      drawFrame(
        ctx, tree, transform, cw, ch,
        dragHash, docLeaves,
        hoveredHashRef.current, hoveredLeafIdRef.current,
        currentExpandRef.current,
        dirtyLeafPositionsRef.current,
        showTimeAlwaysRef.current,
        memoryMarkersRef.current,
        hoveredMemoryIdRef.current,
        dirtyMemoryPositionsRef.current,
        expandedMarkerGroupsRef.current,
      );

      // Detect scroll near bottom → trigger lazy load
      if (hasMore && onNeedMore && !isFetchingMore && tree.nodes.length > 0) {
        const invZoom = 1 / transform.zoom;
        const endRow = Math.min(
          tree.nodes.length - 1,
          Math.ceil((ch - transform.offsetY) * invZoom / ROW_HEIGHT) + 2
        );
        if (endRow >= tree.nodes.length - 10 && Date.now() - lastNeedMoreTime > 600) {
          lastNeedMoreTime = Date.now();
          onNeedMore();
        }
      }

      rafRef.current = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(rafRef.current);
  }, [tree, transform, dragHash, docLeaves, memoryMarkers, hasMore, onNeedMore, isFetchingMore]);

  // ---- Interaction handlers ----

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!tree || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

      // Check if clicking on a leaf (for drag)
      mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
      const leafPositions = computeLeafPositions(tree, docLeavesRef.current, dirtyLeafPositionsRef.current);
      for (const [leafId, pos] of leafPositions) {
        if (Math.abs(world.x - pos.x) < LEAF_HIT_RADIUS && Math.abs(world.y - pos.y) < LEAF_HIT_RADIUS) {
          e.stopPropagation();
          draggingLeafRef.current = leafId;
          setDraggingLeafId(leafId);
          dragOffsetRef.current = { x: world.x - pos.x, y: world.y - pos.y };
          return;
        }
      }

      // Check if clicking on a memory marker (for drag — same as leaves)
      if (memoryMarkersRef.current && memoryMarkersRef.current.length > 0) {
        const mPositions = computeMarkerPositions(tree, memoryMarkersRef.current, 0, -1, dirtyMemoryPositionsRef.current);
        for (const pos of mPositions) {
          const dx = (world.x - pos.x) / 7;
          const dy = (world.y - pos.y) / 5;
          if (dx * dx + dy * dy <= 1.5) {
            e.stopPropagation();
            draggingMemoryRef.current = pos.id;
            setDraggingMemoryId(pos.id);
            dragOffsetRef.current = { x: world.x - pos.x, y: world.y - pos.y };
            return;
          }
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

      // Memory marker dragging
      if (draggingMemoryRef.current) {
        e.stopPropagation();
        const memId = draggingMemoryRef.current;
        const newX = world.x - dragOffsetRef.current.x;
        const newY = world.y - dragOffsetRef.current.y;
        const dirty = new Map(dirtyMemoryPositionsRef.current);
        dirty.set(memId, { x: newX, y: newY });
        dirtyMemoryPositionsRef.current = dirty;
        return;
      }

      // Normal hover
      const hit = preciseHitTest(world.x, world.y, tree, docLeavesRef.current, dirtyLeafPositionsRef.current, memoryMarkersRef.current, expandedGroupsRef.current, expandedMarkerGroupsRef.current);
      if (hit?.type === "memory-marker") {
        hoveredMemoryIdRef.current = hit.memoryId;
        hoveredHashRef.current = null;
        hoveredLeafIdRef.current = null;
        setHoveredMemoryId(hit.memoryId);
        setHoveredHash(null);
        setHoveredLeafId(null);
        targetExpandRef.current = 0;
      } else if (hit?.type === "leaf" || hit?.type === "leaf-connection") {
        hoveredLeafIdRef.current = hit.leafId;
        hoveredHashRef.current = hit.type === "leaf-connection" ? hit.hash : (hit as any).hash;
        setHoveredLeafId(hit.leafId);
        setHoveredHash(hit.type === "leaf-connection" ? hit.hash : (hit as any).hash);
        targetExpandRef.current = 0;
      } else if (hit?.type === "node-dot" || hit?.type === "node-id") {
        hoveredHashRef.current = hit.hash;
        hoveredLeafIdRef.current = null;
        hoveredMemoryIdRef.current = null;
        setHoveredHash(hit.hash);
        setHoveredLeafId(null);
        setHoveredMemoryId(null);
        targetExpandRef.current = 24;
      } else if (hit?.type === "edge") {
        // Hovering an edge: no highlight
        hoveredHashRef.current = null;
        hoveredLeafIdRef.current = null;
        hoveredMemoryIdRef.current = null;
        setHoveredHash(null);
        setHoveredLeafId(null);
        setHoveredMemoryId(null);
        targetExpandRef.current = 0;
      } else {
        hoveredHashRef.current = null;
        hoveredLeafIdRef.current = null;
        hoveredMemoryIdRef.current = null;
        setHoveredHash(null);
        setHoveredLeafId(null);
        setHoveredMemoryId(null);
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
        // Clean up dirty position so leaf can re-enter grouping
        dirtyLeafPositionsRef.current.delete(leafId);
      }
      draggingLeafRef.current = null;
      setDraggingLeafId(null);

      if (draggingMemoryRef.current && onMemoryPositionChange) {
        const memId = draggingMemoryRef.current;
        const pos = dirtyMemoryPositionsRef.current.get(memId);
        if (pos) {
          onMemoryPositionChange(memId, pos.x, pos.y);
        }
        dirtyMemoryPositionsRef.current.delete(memId);
      }
      draggingMemoryRef.current = null;
      setDraggingMemoryId(null);
    },
    [onLeafPositionChange, onMemoryPositionChange]
  );

  const handleCanvasMouseLeave = useCallback(() => {
    // End drag on leave
    if (draggingLeafRef.current && onLeafPositionChange) {
      const leafId = draggingLeafRef.current;
      const pos = dirtyLeafPositionsRef.current.get(leafId);
      if (pos) {
        onLeafPositionChange(leafId, pos.x, pos.y);
      }
      dirtyLeafPositionsRef.current.delete(leafId);
    }
    draggingLeafRef.current = null;
    setDraggingLeafId(null);
    hoveredHashRef.current = null;
    hoveredLeafIdRef.current = null;
    hoveredMemoryIdRef.current = null;
    setHoveredHash(null);
    setHoveredLeafId(null);
    setHoveredMemoryId(null);
    targetExpandRef.current = 0;
  }, [onLeafPositionChange]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!tree || !canvasRef.current) return;
      // Ignore click if the mouse moved since mousedown (i.e. it was a drag, not a click)
      if (mouseDownPosRef.current) {
        const dx = e.clientX - mouseDownPosRef.current.x;
        const dy = e.clientY - mouseDownPosRef.current.y;
        mouseDownPosRef.current = null;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

      // Check group icon click first
      const hit = preciseHitTest(world.x, world.y, tree, docLeavesRef.current, dirtyLeafPositionsRef.current, memoryMarkersRef.current, expandedGroupsRef.current, expandedMarkerGroupsRef.current);
      if (hit?.type === "leaf-group") {
        setExpandedGroups(prev => {
          const next = new Set(prev);
          if (next.has(hit.commitHash)) next.delete(hit.commitHash);
          else next.add(hit.commitHash);
          return next;
        });
        return;
      }
      if (hit?.type === "marker-group") {
        setExpandedMarkerGroups(prev => {
          const next = new Set(prev);
          if (next.has(hit.commitHash)) next.delete(hit.commitHash);
          else next.add(hit.commitHash);
          return next;
        });
        return;
      }
      if (hit?.type === "memory-marker") {
        onMemoryClick?.(hit.memoryId);
        return;
      }

      // Check leaf click
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
    [tree, screenToWorld, onCommitClick, onDocClick, onGroupToggle]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!canvasRef.current || !tree) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

      const hit = preciseHitTest(world.x, world.y, tree, docLeavesRef.current, dirtyLeafPositionsRef.current, memoryMarkersRef.current, expandedGroupsRef.current);
      const hash = (hit?.type === "node-dot" || hit?.type === "node-id" || hit?.type === "edge")
        ? hit.hash : null;
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
      {isFetchingMore && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-zinc-800/80 text-zinc-300 text-xs z-10 pointer-events-none">
          Loading more commits...
        </div>
      )}
      {hasMore === false && tree && tree.nodes.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-zinc-200/60 dark:bg-zinc-800/40 text-zinc-500 text-xs z-10 pointer-events-none">
          All commits loaded
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
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
  dirtyLeafPositions?: Map<string, LeafPosition>,
  showTimeAlways?: boolean,
  memoryMarkers?: MemoryMarker[],
  hoveredMemoryId?: string | null,
  dirtyMemoryPositions?: Map<string, { x: number; y: number }>,
  expandedMarkerGroups?: Set<string>,
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

  // Compute groups: auto-positioned leaves sharing the same commit with ≥3 leaves get grouped
  const leafGroups = computeLeafGroups(docLeaves, tree, leafPositions, dirtyLeafPositions ?? new Map());

  // Compute marker positions and groups (once, shared by connections, icons, and hit testing)
  const markerPositions = memoryMarkers?.length
    ? computeMarkerPositions(tree, memoryMarkers, effectiveExpand, hoveredRow, dirtyMemoryPositions)
    : [];
  const markerGroups = memoryMarkers?.length
    ? computeMarkerGroups(markerPositions, memoryMarkers, dirtyMemoryPositions)
    : new Map<string, MarkerGroup>();

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

    const fromY = from.y + (edge.fromRow > hoveredRow ? effectiveExpand : 0);
    const toY = to.y + (edge.toRow > hoveredRow ? effectiveExpand : 0);

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
    drawCommitNode(ctx, node, effectiveY, highlightHash === node.hash, isHovered, worldWidth, isHovered ? effectiveExpand : 0, showTimeAlways);
  }

  // 3. Leaf-to-commit connection lines (group-aware)
  if (docLeaves) {
    const drawnLeaves = new Set<string>(); // track leaves already drawn as part of a collapsed group

    for (const [commitHash, group] of leafGroups) {
      const expanded = expandedGroupsRef.current.has(commitHash);
      const node = tree.nodes.find(n => n.hash === commitHash);
      if (!node) continue;
      const ny = node.y + (node.row > hoveredRow ? effectiveExpand : 0) + ROW_HEIGHT / 2;
      const highlight = hoveredHash === commitHash;

      if (expanded) {
        // Expanded → draw individual connections to fan-out positions
        const n = group.count;
        const FAN_SPACING = 24;
        for (let i = 0; i < group.leafIds.length; i++) {
          const fy = group.cy + (i - (n - 1) / 2) * FAN_SPACING;
          drawLeafConnection(ctx, node.x + 5, ny, group.cx, fy, highlight);
        }
      } else {
        // Collapsed → single connection to group center
        drawLeafConnection(ctx, node.x + 5, ny, group.cx, group.cy, highlight);
        for (const lid of group.leafIds) drawnLeaves.add(lid);
      }
    }

    // Individual leaf connections (skip leaves in collapsed groups)
    for (const [leafId, pos] of leafPositions) {
      if (drawnLeaves.has(leafId)) continue;
      const leaf = docLeaves.leafMap[leafId];
      if (!leaf || leaf.connectedHashes.length === 0) continue;

      const isLeafHovered = hoveredLeafId === leafId;
      const isConnectedToHoveredNode = hoveredHash ? leaf.connectedHashes.includes(hoveredHash) : false;
      const highlightConn = isLeafHovered || isConnectedToHoveredNode;

      for (const hash of leaf.connectedHashes) {
        const node = tree.nodes.find(n => n.hash === hash);
        if (!node) continue;
        const ny = node.y + (node.row > hoveredRow ? effectiveExpand : 0) + ROW_HEIGHT / 2;
        drawLeafConnection(ctx, node.x + 5, ny, pos.x, pos.y, highlightConn);
      }
    }
  }

  // 3.5 Memory-to-commit connection lines (group-aware)
  if (markerPositions.length > 0) {
    const drawnMarkers = new Set<string>();

    // Draw group connections (collapsed → single line, expanded → fan-out)
    for (const [commitHash, group] of markerGroups) {
      const expanded = expandedMarkerGroups?.has(commitHash) ?? false;
      const node = tree.nodes.find(n =>
        n.hash === commitHash || n.shortHash === commitHash || n.hash.startsWith(commitHash)
      );
      if (!node) continue;
      const ny = node.y + (node.row > hoveredRow ? effectiveExpand : 0) + ROW_HEIGHT / 2;

      if (expanded) {
        const n = group.count;
        const FAN_SPACING = 22;
        for (let i = 0; i < group.markerIds.length; i++) {
          const fy = group.cy + (i - (n - 1) / 2) * FAN_SPACING;
          drawLeafConnection(ctx, node.x + 5, ny, group.cx, fy, false);
          ctx.globalAlpha = 0.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else {
        for (const mid of group.markerIds) drawnMarkers.add(mid);
        drawLeafConnection(ctx, node.x + 5, ny, group.cx, group.cy, false);
        ctx.globalAlpha = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Individual marker connections
    for (const pos of markerPositions) {
      if (drawnMarkers.has(pos.id)) continue;
      const commitHash = memoryMarkers.find(m => m.id === pos.id)?.commitHash;
      if (!commitHash) continue;
      const node = tree.nodes.find(n =>
        n.hash === commitHash || n.shortHash === commitHash || n.hash.startsWith(commitHash)
      );
      if (!node) continue;
      const ny = node.y + (node.row > hoveredRow ? effectiveExpand : 0) + ROW_HEIGHT / 2;
      const color = MEMORY_GLYPHS[pos.type]?.color ?? "#a855f7";
      const isConnected = hoveredMemoryId === pos.id || hoveredHash === commitHash;
      drawLeafConnection(ctx, node.x + 5, ny, pos.x, pos.y, isConnected);
      ctx.strokeStyle = isConnected ? color + "d9" : color + "66";
      ctx.stroke();
    }
  }

  // 4. Leaf icons and names (group-aware)
  if (docLeaves) {
    const drawnLeaves = new Set<string>();

    // Draw group icons always (dimmed when expanded, acts as collapse toggle)
    for (const [commitHash, group] of leafGroups) {
      const expanded = expandedGroupsRef.current.has(commitHash);
      if (!expanded) {
        for (const lid of group.leafIds) drawnLeaves.add(lid);
      }
      const isGroupHovered = hoveredHash === commitHash;
      drawGroupLeafIcon(ctx, group.cx, group.cy, group.count, isGroupHovered, expanded);
      // When expanded, fan out individual leaves from the group center
      if (expanded) {
        const n = group.count;
        const FAN_SPACING = 24;
        for (let i = 0; i < group.leafIds.length; i++) {
          const lid = group.leafIds[i]!;
          const leaf = docLeaves.leafMap[lid];
          if (!leaf) continue;
          const fy = group.cy + (i - (n - 1) / 2) * FAN_SPACING;
          const isLeafHovered = hoveredLeafId === lid;
          const highlight = isLeafHovered;
          drawLeafIcon(ctx, group.cx, fy, leaf.title, highlight, true);
        }
      }
    }

    // Draw individual leaf icons (non-grouped leaves only)
    for (const [leafId, pos] of leafPositions) {
      if (drawnLeaves.has(leafId)) continue;
      const leaf = docLeaves.leafMap[leafId];
      if (!leaf) continue;
      const isLeafHovered = hoveredLeafId === leafId;
      const isConnectedToHoveredNode = hoveredHash ? leaf.connectedHashes.includes(hoveredHash) : false;
      const highlight = isLeafHovered || isConnectedToHoveredNode;
      drawLeafIcon(ctx, pos.x, pos.y, leaf.title, highlight, worldWidth > 400 || highlight);
    }
  }

  // 5. Memory marker icons (group-aware)
  if (markerPositions.length > 0) {
    const drawnMarkers = new Set<string>();

    // Draw group icons always (dimmed when expanded, acts as collapse toggle)
    for (const [commitHash, group] of markerGroups) {
      const expanded = expandedMarkerGroups?.has(commitHash) ?? false;
      if (!expanded) {
        for (const mid of group.markerIds) drawnMarkers.add(mid);
      }
      const isGroupHovered = hoveredHash === commitHash;
      drawGroupMarkerIcon(ctx, group.cx, group.cy, group.count, isGroupHovered, expanded);
      // When expanded, fan out individual markers from the group center
      if (expanded) {
        const n = group.count;
        const FAN_SPACING = 22;
        for (let i = 0; i < group.markerIds.length; i++) {
          const mid = group.markerIds[i]!;
          const mPos = markerPositions.find(p => p.id === mid);
          if (!mPos) continue;
          const fy = group.cy + (i - (n - 1) / 2) * FAN_SPACING;
          const isHovered = hoveredMemoryId === mid;
          const color = MEMORY_GLYPHS[mPos.type]?.color ?? "#a855f7";
          const label = mPos.summary ?? mPos.type;
          drawMemoryIcon(ctx, group.cx, fy, label, color, mPos.source, isHovered);
        }
      }
    }

    // Draw individual marker icons (non-grouped markers only)
    for (const pos of markerPositions) {
      if (drawnMarkers.has(pos.id)) continue;
      const isHovered = hoveredMemoryId === pos.id;
      const color = MEMORY_GLYPHS[pos.type]?.color ?? "#a855f7";
      const label = pos.summary ?? pos.type;
      drawMemoryIcon(ctx, pos.x, pos.y, label, color, pos.source, isHovered);
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
  expandOffset: number,
  showTimeAlways?: boolean
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

  // Date on the left — only when hovering or toggle enabled
  if (showTimeAlways || isHovered) {
    const dateStr = formatDate(node.authorDate);
    ctx.font = "10px 'Cascadia Code', monospace";
    ctx.fillStyle = isHovered ? "#a5b4fc" : "#666";
    ctx.fillText(dateStr, x + DATE_X_OFFSET, y + 18);
  }

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

// ============================================================================
//  Memory markers
// ============================================================================

interface MarkerPosition {
  id: string;
  type: MemoryMarkerType;
  x: number;
  y: number;
  confidence: number;
  source: string;
  summary: string | null;
}

function computeMarkerPositions(
  tree: GitTree,
  markers: MemoryMarker[],
  expandOffset: number,
  hoveredRow: number,
  dirtyPositions?: Map<string, { x: number; y: number }>
): MarkerPosition[] {
  const positions: MarkerPosition[] = [];
  const rowCounters = new Map<number, number>();

  // First pass: place markers with stored or dirty positions
  const autoPlace: Array<{ marker: MemoryMarker; node: typeof tree.nodes[0]; row: number }> = [];

  for (const marker of markers) {
    let row = -1;

    if (marker.commitHash) {
      const ch = marker.commitHash;
      const nodeIdx = tree.nodes.findIndex(
        (n) => n.hash === ch || n.shortHash === ch || n.hash.startsWith(ch)
      );
      if (nodeIdx >= 0) row = nodeIdx;
    }

    if (row < 0) continue;
    const node = tree.nodes[row];
    if (!node) continue;

    const effectiveY = node.y + (row > hoveredRow ? expandOffset : 0) + ROW_HEIGHT / 2;

    // Check dirty position (drag in progress)
    const dirtyPos = dirtyPositions?.get(marker.id);
    if (dirtyPos) {
      positions.push({
        id: marker.id,
        type: marker.type as MemoryMarkerType,
        x: dirtyPos.x,
        y: dirtyPos.y,
        confidence: marker.confidence,
        source: marker.source,
        summary: marker.summary,
      });
      continue;
    }

    // Check stored position from DB
    if (marker.markerX !== null && marker.markerY !== null) {
      positions.push({
        id: marker.id,
        type: marker.type as MemoryMarkerType,
        x: marker.markerX,
        y: marker.markerY,
        confidence: marker.confidence,
        source: marker.source,
        summary: marker.summary,
      });
      continue;
    }

    // Auto-placement needed
    autoPlace.push({ marker, node, row });
  }

  // Second pass: auto-place remaining markers with overlap avoidance
  // Group by commit row
  const byRow = new Map<number, typeof autoPlace>();
  for (const item of autoPlace) {
    const list = byRow.get(item.row) ?? [];
    list.push(item);
    byRow.set(item.row, list);
  }

  for (const [row, items] of byRow) {
    const node = items[0]!.node;
    const baseY = node.y + (row > hoveredRow ? expandOffset : 0) + ROW_HEIGHT / 2;
    const baseX = node.x + MARKER_X_OFFSET;

    // For items on the same row, stack them to avoid overlap
    // Each marker icon is ~14px tall + label, spacing = 20px vertical
    const VERTICAL_SPACING = 20;

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      // Offset vertically to avoid overlapping
      const y = baseY + i * VERTICAL_SPACING - ((items.length - 1) * VERTICAL_SPACING) / 2;

      positions.push({
        id: item.marker.id,
        type: item.marker.type as MemoryMarkerType,
        x: baseX,
        y,
        confidence: item.marker.confidence,
        source: item.marker.source,
        summary: item.marker.summary,
      });
    }
  }

  return positions;
}

// Memory marker icon — same structure as drawLeafIcon but with type-specific colors
function drawMemoryIcon(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  label: string,
  color: string,
  source: string,
  highlight: boolean,
) {
  // Source-based opacity
  let alpha: number;
  switch (source) {
    case "user": alpha = 1.0; break;
    case "agent": alpha = 0.85; break;
    case "tool": alpha = 0.7; break;
    case "inferred": alpha = 0.5; break;
    default: alpha = 0.85;
  }
  if (highlight) alpha = 1.0;

  ctx.globalAlpha = alpha;

  // Glow ellipse (like leaf glow)
  ctx.beginPath();
  ctx.ellipse(x, y, 9, 6, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = highlight ? color + "4d" : color + "1a";
  ctx.fill();

  // Icon ellipse (like leaf icon, but in type color)
  ctx.beginPath();
  ctx.ellipse(x, y, highlight ? 7 : 6, highlight ? 5 : 4, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = highlight ? color : color + "80";
  ctx.lineWidth = highlight ? 1.8 : 0.8;
  ctx.stroke();

  // Label text (like leaf title)
  if (highlight || true) { // always show name like leaves when worldWidth > 400
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = highlight ? color : color + "cc";
    const t = label.length > 14 ? label.substring(0, 14) + "\u2026" : label;
    ctx.fillText(t, x + 10, y + 4);
  }

  ctx.globalAlpha = 1;
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

// ============================================================================
//  Leaf grouping — collapse crowded leaves into a single group icon
// ============================================================================

interface LeafGroup {
  commitHash: string;
  leafIds: string[];
  count: number;
  cx: number;
  cy: number;
}

const GROUP_MIN_THRESHOLD = 3; // min leaves sharing a commit to trigger grouping

function computeLeafGroups(
  docLeaves: DocLeavesData | undefined,
  tree: GitTree,
  leafPositions: Map<string, LeafPosition>,
  dirtyPositions: Map<string, LeafPosition>,
): Map<string, LeafGroup> {
  const groups = new Map<string, LeafGroup>();
  if (!docLeaves) return groups;

  // Collect auto-positioned leaves (no explicit pos, no dirty pos) grouped by first connected hash
  const byCommit = new Map<string, Array<{ id: string; pos: LeafPosition }>>();
  for (const leaf of Object.values(docLeaves.leafMap)) {
    // Skip leaves with explicit or dirty positions — user intentionally placed them
    if (dirtyPositions.has(leaf.id)) continue;
    if (leaf.leafX !== null && leaf.leafY !== null) continue;
    // Only group leaves connected to a commit
    const hash = leaf.connectedHashes[0];
    if (!hash) continue;
    const pos = leafPositions.get(leaf.id);
    if (!pos) continue;
    if (!byCommit.has(hash)) byCommit.set(hash, []);
    byCommit.get(hash)!.push({ id: leaf.id, pos });
  }

  // Create groups for commits with ≥ threshold leaves
  for (const [hash, leaves] of byCommit) {
    if (leaves.length < GROUP_MIN_THRESHOLD) continue;
    // Compute group center: average of all leaf positions
    let sumX = 0, sumY = 0;
    for (const l of leaves) { sumX += l.pos.x; sumY += l.pos.y; }
    groups.set(hash, {
      commitHash: hash,
      leafIds: leaves.map(l => l.id),
      count: leaves.length,
      cx: sumX / leaves.length,
      cy: sumY / leaves.length,
    });
  }

  return groups;
}

/**
 * Group leaf icon — larger ellipse with count badge
 */
function drawGroupLeafIcon(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  count: number,
  highlight: boolean,
  expanded = false,
) {
  const alpha = expanded ? 0.55 : 1;
  const size = highlight ? 9 : 8;
  const sizeY = highlight ? 7 : 6;

  ctx.globalAlpha = alpha;

  // Glow
  ctx.beginPath();
  ctx.ellipse(x, y, size + 3, sizeY + 2, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = highlight ? "rgba(34,197,94,0.35)" : "rgba(34,197,94,0.12)";
  ctx.fill();

  // Outer ring
  ctx.beginPath();
  ctx.ellipse(x, y, size, sizeY, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = highlight ? "#4ade80" : "rgba(34,197,94,0.5)";
  ctx.fill();
  ctx.strokeStyle = highlight ? "#22c55e" : "rgba(34,197,94,0.6)";
  ctx.lineWidth = highlight ? 2 : 1;
  ctx.stroke();

  // Count badge
  const text = String(count);
  ctx.font = `bold ${highlight ? 10 : 9}px Inter, sans-serif`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);

  // Label
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = highlight ? "#86efac" : "#4ade80";
  ctx.textAlign = "start";
  ctx.textBaseline = "middle";
  ctx.fillText(count + " docs", x + size + 4, y);
  ctx.textAlign = "start";
  ctx.globalAlpha = 1;
}

// ============================================================================
//  Memory marker grouping — same pattern as leaf grouping
// ============================================================================

interface MarkerGroup {
  commitHash: string;
  markerIds: string[];
  count: number;
  cx: number;
  cy: number;
}

const MARKER_GROUP_MIN_THRESHOLD = 3;

function computeMarkerGroups(
  markerPositions: MarkerPosition[],
  markers: MemoryMarker[],
  dirtyMemoryPositions?: Map<string, { x: number; y: number }>,
): Map<string, MarkerGroup> {
  const groups = new Map<string, MarkerGroup>();
  if (!markers.length) return groups;

  const byCommit = new Map<string, Array<{ id: string; x: number; y: number }>>();
  const markerMap = new Map(markers.map(m => [m.id, m]));

  for (const pos of markerPositions) {
    const marker = markerMap.get(pos.id);
    if (!marker) continue;
    // Skip markers with explicit or dirty positions
    if (dirtyMemoryPositions?.has(marker.id)) continue;
    if (marker.markerX !== null && marker.markerY !== null) continue;
    const hash = marker.commitHash;
    if (!hash) continue;
    if (!byCommit.has(hash)) byCommit.set(hash, []);
    byCommit.get(hash)!.push({ id: marker.id, x: pos.x, y: pos.y });
  }

  for (const [hash, items] of byCommit) {
    if (items.length < MARKER_GROUP_MIN_THRESHOLD) continue;
    let sumX = 0, sumY = 0;
    for (const it of items) { sumX += it.x; sumY += it.y; }
    groups.set(hash, {
      commitHash: hash,
      markerIds: items.map(it => it.id),
      count: items.length,
      cx: sumX / items.length,
      cy: sumY / items.length,
    });
  }

  return groups;
}

function drawGroupMarkerIcon(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  count: number,
  highlight: boolean,
  expanded = false,
) {
  const alpha = expanded ? 0.55 : 1;
  const size = highlight ? 9 : 8;
  const sizeY = highlight ? 7 : 6;

  ctx.globalAlpha = alpha;

  // Glow
  ctx.beginPath();
  ctx.ellipse(x, y, size + 3, sizeY + 2, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = highlight ? "rgba(168,85,247,0.35)" : "rgba(168,85,247,0.12)";
  ctx.fill();

  // Outer ring (purple)
  ctx.beginPath();
  ctx.ellipse(x, y, size, sizeY, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = highlight ? "#c084fc" : "rgba(168,85,247,0.5)";
  ctx.fill();
  ctx.strokeStyle = highlight ? "#a855f7" : "rgba(168,85,247,0.6)";
  ctx.lineWidth = highlight ? 2 : 1;
  ctx.stroke();

  // Count badge
  const text = String(count);
  ctx.font = `bold ${highlight ? 10 : 9}px Inter, sans-serif`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);

  // Label
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = highlight ? "#d8b4fe" : "#a855f7";
  ctx.textAlign = "start";
  ctx.textBaseline = "middle";
  ctx.fillText(count + " memories", x + size + 4, y);
  ctx.textAlign = "start";
  ctx.globalAlpha = 1;
}

// ============================================================================
//  Precise hit testing — per-element (dot, id, leaf, edge, connection)
// ============================================================================

const EDGE_HIT_DIST = 6;     // px threshold for curve proximity
const HASH_CHAR_W = 6.6;     // approx width of 11px monospace char

type HitResult =
  | { type: "node-dot"; hash: string }
  | { type: "node-id"; hash: string }
  | { type: "leaf"; leafId: string; hash: string | null }
  | { type: "leaf-group"; commitHash: string }
  | { type: "edge"; edgeIdx: number }
  | { type: "leaf-connection"; leafId: string; hash: string }
  | { type: "memory-marker"; memoryId: string }
  | { type: "marker-group"; commitHash: string }
  | null;

function preciseHitTest(
  worldX: number, worldY: number,
  tree: GitTree,
  docLeaves: DocLeavesData | undefined,
  dirtyPositions: Map<string, LeafPosition>,
  memoryMarkers?: MemoryMarker[],
  expandedGroups?: Set<string>,
  expandedMarkerGroups?: Set<string>,
): HitResult {
  // 0. Group leaf icons (always hit-testable — collapse/expand toggle)
  const leafPositions = computeLeafPositions(tree, docLeaves, dirtyPositions);
  const leafGroups = computeLeafGroups(docLeaves, tree, leafPositions, dirtyPositions);
  for (const [commitHash, group] of leafGroups) {
    const dx = (worldX - group.cx) / 10;
    const dy = (worldY - group.cy) / 8;
    if (dx * dx + dy * dy <= 1) {
      return { type: "leaf-group", commitHash };
    }
  }

  // 1. Leaf icons (only hit-testable when group is expanded, or no group)
  for (const [leafId, pos] of leafPositions) {
    // Skip leaves in collapsed groups
    const leaf = docLeaves?.leafMap[leafId];
    const ch = leaf?.connectedHashes[0];
    if (ch) {
      const group = leafGroups.get(ch);
      if (group && group.leafIds.includes(leafId)) {
        if (!expandedGroups?.has(ch)) continue; // collapsed → skip
        // Expanded → use fan-out position from group center
        const idx = group.leafIds.indexOf(leafId);
        const FAN_SPACING = 24;
        const fx = group.cx;
        const fy = group.cy + (idx - (group.count - 1) / 2) * FAN_SPACING;
        const dx2 = (worldX - fx) / 7;
        const dy2 = (worldY - fy) / 5;
        if (dx2 * dx2 + dy2 * dy2 <= 1) {
          return { type: "leaf", leafId, hash: ch };
        }
        continue; // already checked at fan-out position
      }
    }
    const dx = (worldX - pos.x) / 7;  // rx=7 when highlighted
    const dy = (worldY - pos.y) / 5;  // ry=5 when highlighted
    if (dx * dx + dy * dy <= 1) {
      return { type: "leaf", leafId, hash: leaf?.connectedHashes[0] ?? null };
    }
  }

  // 2. Memory marker group icons (always hit-testable — collapse/expand toggle)
  if (memoryMarkers && memoryMarkers.length > 0) {
    const markerPositions = computeMarkerPositions(tree, memoryMarkers, 0, -1, undefined);
    const markerGroups = computeMarkerGroups(markerPositions, memoryMarkers, undefined);
    for (const [commitHash, group] of markerGroups) {
      const dx = (worldX - group.cx) / 10;
      const dy = (worldY - group.cy) / 8;
      if (dx * dx + dy * dy <= 1) {
        return { type: "marker-group", commitHash };
      }
    }

    // Individual markers (skip members of collapsed groups, use fan-out for expanded)
    for (const pos of markerPositions) {
      const marker = memoryMarkers.find(m => m.id === pos.id);
      const ch = marker?.commitHash;
      if (ch) {
        const group = markerGroups.get(ch);
        if (group && group.markerIds.includes(pos.id)) {
          if (!expandedMarkerGroups?.has(ch)) continue; // collapsed → skip
          // Expanded → use fan-out position from group center
          const idx = group.markerIds.indexOf(pos.id);
          const FAN_SPACING = 22;
          const fx = group.cx;
          const fy = group.cy + (idx - (group.count - 1) / 2) * FAN_SPACING;
          const dx2 = (worldX - fx) / 7;
          const dy2 = (worldY - fy) / 5;
          if (dx2 * dx2 + dy2 * dy2 <= 1.2) {
            return { type: "memory-marker", memoryId: pos.id };
          }
          continue; // already checked at fan-out position
        }
      }
      const dx = (worldX - pos.x) / 7;
      const dy = (worldY - pos.y) / 5;
      if (dx * dx + dy * dy <= 1.2) {
        return { type: "memory-marker", memoryId: pos.id };
      }
    }
  }

  // 3. Node dots (circle test)
  for (const node of tree.nodes) {
    const dotX = node.x + 5;
    const dotY = node.y + ROW_HEIGHT / 2;
    if (Math.hypot(worldX - dotX, worldY - dotY) <= 6) {
      return { type: "node-dot", hash: node.hash };
    }
  }

  // 4. Node IDs — shortHash text bounding box
  for (const node of tree.nodes) {
    const textX = node.x + 14;
    const textW = 7 * HASH_CHAR_W + 2; // ~48px
    const textTop = node.y + ROW_HEIGHT / 2 - 8;
    const textBottom = node.y + ROW_HEIGHT / 2 + 6;
    if (worldX >= textX && worldX <= textX + textW && worldY >= textTop && worldY <= textBottom) {
      return { type: "node-id", hash: node.hash };
    }
  }

  // 5. Commit-to-commit edges (bezier proximity)
  for (let i = 0; i < tree.edges.length; i++) {
    const edge = tree.edges[i]!;
    if (edge.fromRow >= tree.nodes.length || edge.toRow >= tree.nodes.length) continue;
    const from = tree.nodes[edge.fromRow]!;
    const to = tree.nodes[edge.toRow]!;
    const x1 = from.x + 4, y1 = from.y + ROW_HEIGHT / 2;
    const x2 = to.x + 4,   y2 = to.y + ROW_HEIGHT / 2;
    const midY = (y1 + y2) / 2;

    if (Math.abs(x1 - x2) < 4) {
      // Straight vertical line
      if (Math.abs(worldX - x1) < EDGE_HIT_DIST && worldY >= Math.min(y1, y2) && worldY <= Math.max(y1, y2)) {
        return { type: "edge", edgeIdx: i };
      }
    } else {
      // Bezier curve: (x1,y1) → (x1,midY) → (x2,midY) → (x2,y2)
      const d = pointToBezierDist(worldX, worldY, x1, y1, x1, midY, x2, midY, x2, y2);
      if (d < EDGE_HIT_DIST) return { type: "edge", edgeIdx: i };
    }
  }

  // 6. Leaf-to-commit connections (bezier from commit dot to leaf)
  if (docLeaves) {
    for (const [leafId, leafPos] of leafPositions) {
      const leaf = docLeaves.leafMap[leafId];
      if (!leaf || leaf.connectedHashes.length === 0) continue;
      for (const hash of leaf.connectedHashes) {
        const node = tree.nodes.find(n => n.hash === hash);
        if (!node) continue;
        const nx = node.x + 5, ny = node.y + ROW_HEIGHT / 2;
        const midX = (nx + leafPos.x) / 2;
        const midY = (ny + leafPos.y) / 2;
        const d = pointToBezierDist(worldX, worldY, nx, ny, midX, ny - 12, midX, leafPos.y + 12, leafPos.x, leafPos.y);
        if (d < EDGE_HIT_DIST) return { type: "leaf-connection", leafId, hash };
      }
    }
  }

  return null;
}

/** Sample 24 points along a cubic bezier, return minimum distance to (px,py) */
function pointToBezierDist(
  px: number, py: number,
  x1: number, y1: number, cx1: number, cy1: number, cx2: number, cy2: number, x2: number, y2: number
): number {
  let min = Infinity;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    const bx = u*u*u*x1 + 3*u*u*t*cx1 + 3*u*t*t*cx2 + t*t*t*x2;
    const by = u*u*u*y1 + 3*u*u*t*cy1 + 3*u*t*t*cy2 + t*t*t*y2;
    const d = Math.hypot(px - bx, py - by);
    if (d < min) min = d;
  }
  return min;
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
