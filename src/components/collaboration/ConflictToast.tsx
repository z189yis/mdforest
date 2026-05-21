"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

interface ConflictToastProps {
  awareness: any;
  currentUserName?: string;
}

/**
 * Shows a toast when another user starts editing the same document.
 * Listens for awareness changes and shows a notification when
 * a new remote user appears.
 */
export function ConflictToast({
  awareness,
  currentUserName,
}: ConflictToastProps) {
  const seenUsers = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!awareness) return;

    const handler = () => {
      const states: any[] = [];
      awareness.getStates().forEach((state: any) => {
        if (state.user) states.push(state.user);
      });

      for (const state of states) {
        if (state.name === currentUserName) continue;
        if (seenUsers.current.has(state.name)) continue;

        seenUsers.current.add(state.name);
        toast(`${state.name} is also editing`, {
          description: "Changes sync in real time",
          duration: 3000,
        });
      }

      // Clean up disconnected users
      const currentNames = new Set(states.map((s: any) => s.name));
      for (const name of seenUsers.current) {
        if (!currentNames.has(name)) {
          seenUsers.current.delete(name);
        }
      }
    };

    awareness.on("change", handler);
    return () => awareness.off("change", handler);
  }, [awareness, currentUserName]);

  return null; // No visible UI, just side effects
}
