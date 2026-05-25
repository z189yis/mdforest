import { useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc/client";

export type MemoryMarkerType = "fact" | "preference" | "event" | "procedure" | "decision";

export interface MemoryMarker {
  id: string;
  type: MemoryMarkerType;
  summary: string | null;
  content: string;
  confidence: number;
  source: string;
  commitHash: string | null;
  markerX: number | null;
  markerY: number | null;
  createdAt: Date;
}

export const MEMORY_GLYPHS: Record<MemoryMarkerType, { glyph: string; color: string }> = {
  fact:        { glyph: "\u25CF", color: "#3b82f6" }, // ● blue
  preference:  { glyph: "\u2605", color: "#f59e0b" }, // ★ amber
  event:       { glyph: "\u25C6", color: "#ef4444" }, // ◆ red
  procedure:   { glyph: "\u25B6", color: "#22c55e" }, // ▶ green
  decision:    { glyph: "\u25A0", color: "#a855f7" }, // ■ purple
};

export function useMemoryMarkers(repoId: string) {
  const { data: markers = [], isLoading } = trpc.memory.markers.useQuery(
    { repoId },
    { enabled: !!repoId }
  );

  // Index markers by commit hash for quick lookup
  const markersByCommit = useMemo(() => {
    const map: Record<string, MemoryMarker[]> = {};
    for (const m of markers) {
      if (m.commitHash) {
        if (!map[m.commitHash]) map[m.commitHash] = [];
        map[m.commitHash]!.push(m);
      }
    }
    return map;
  }, [markers]);

  // Markers without a commit hash (unlinked)
  const unlinkedMarkers = useMemo(
    () => markers.filter((m) => !m.commitHash),
    [markers]
  );

  return {
    markers,
    markersByCommit,
    unlinkedMarkers,
    isLoading,
  };
}
