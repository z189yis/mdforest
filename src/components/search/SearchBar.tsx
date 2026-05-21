"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc/client";
import { SearchResults } from "./SearchResults";

interface SearchBarProps {
  repoId: string;
}

export function SearchBar({ repoId }: SearchBarProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = trpc.search.query.useQuery(
    { query: debouncedQuery, repoId },
    { enabled: debouncedQuery.length > 0 }
  );

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Ctrl+K shortcut
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      {/* Trigger button */}
      <button
        className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        Search
        <kbd className="text-[10px] px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 ml-2">
          Ctrl+K
        </kbd>
      </button>

      {/* Search modal */}
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="fixed inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <svg className="h-4 w-4 text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400"
                placeholder="Search commits and documents..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
                Esc
              </kbd>
            </div>
            <div className="max-h-80 overflow-auto">
              {data && <SearchResults results={data} repoId={repoId} onSelect={() => setOpen(false)} />}
              {isLoading && (
                <div className="p-4 text-center text-sm text-zinc-400">Searching...</div>
              )}
              {debouncedQuery && !isLoading && !data && (
                <div className="p-4 text-center text-sm text-zinc-400">No results</div>
              )}
              {!debouncedQuery && (
                <div className="p-4 text-center text-sm text-zinc-400">
                  Type to search commits and markdown documents
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
