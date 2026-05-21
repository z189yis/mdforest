"use client";

import { useEffect, useState } from "react";

interface RemoteUser {
  name: string;
  color: string;
  avatar?: string;
}

interface AvatarListProps {
  awareness: any;
  maxVisible?: number;
}

export function AvatarList({ awareness, maxVisible = 5 }: AvatarListProps) {
  const [users, setUsers] = useState<RemoteUser[]>([]);

  useEffect(() => {
    if (!awareness) return;

    const updateUsers = () => {
      const states: RemoteUser[] = [];
      awareness.getStates().forEach((state: any) => {
        if (state.user) {
          states.push(state.user);
        }
      });
      setUsers(states);
    };

    awareness.on("change", updateUsers);
    updateUsers();

    return () => {
      awareness.off("change", updateUsers);
    };
  }, [awareness]);

  if (users.length === 0) return null;

  const visible = users.slice(0, maxVisible);
  const overflow = users.length - maxVisible;

  return (
    <div className="flex items-center -space-x-2">
      {visible.map((user, i) => (
        <div
          key={i}
          className="w-6 h-6 rounded-full border-2 border-white dark:border-zinc-900 flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
          style={{ backgroundColor: user.color }}
          title={user.name}
        >
          {user.avatar ? (
            <img src={user.avatar} alt={user.name} className="w-full h-full rounded-full" />
          ) : (
            user.name.charAt(0).toUpperCase()
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div className="w-6 h-6 rounded-full border-2 border-white dark:border-zinc-900 bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[9px] text-zinc-500 dark:text-zinc-400 shadow-sm">
          +{overflow}
        </div>
      )}
    </div>
  );
}
