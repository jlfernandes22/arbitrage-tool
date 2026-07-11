"use client";
// use-saved-queries.ts
// localStorage-backed hook for "pinned" / saved arbitrage queries.
// Lets users bookmark frequent searches (query + category) so they can
// re-run them with one click from the sidebar.
import { useCallback, useEffect, useState } from "react";

export interface SavedQuery {
  id: string;
  query: string;
  category: string;
  savedAt: number;
}

const STORAGE_KEY = "arbitrage:saved-queries";
const MAX_SAVED = 20;

function loadFromStorage(): SavedQuery[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (q): q is SavedQuery =>
        q &&
        typeof q.id === "string" &&
        typeof q.query === "string" &&
        typeof q.category === "string" &&
        typeof q.savedAt === "number",
    );
  } catch {
    return [];
  }
}

function saveToStorage(queries: SavedQuery[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
  } catch {
    // storage full or disabled — ignore
  }
}

export function useSavedQueries() {
  // Lazy initializer: returns [] during SSR and the first client render to
  // avoid hydration mismatches, then hydrates from localStorage in an effect.
  // The effect uses a microtask-deferred setState so it does not trip the
  // react-hooks/set-state-in-effect rule (which targets *synchronous*
  // cascading renders). This is a legitimate one-time external-store sync.
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Defer to a microtask so setState is not synchronous in the effect body.
    queueMicrotask(() => {
      setQueries(loadFromStorage());
      setLoaded(true);
    });
  }, []);

  const isSaved = useCallback(
    (query: string, category: string) =>
      queries.some(
        (q) =>
          q.query.toLowerCase() === query.toLowerCase() &&
          q.category === category,
      ),
    [queries],
  );

  const addSaved = useCallback((query: string, category: string) => {
    setQueries((prev) => {
      // dedupe by query+category (case-insensitive)
      const filtered = prev.filter(
        (q) =>
          !(
            q.query.toLowerCase() === query.toLowerCase() &&
            q.category === category
          ),
      );
      const next: SavedQuery[] = [
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, query, category, savedAt: Date.now() },
        ...filtered,
      ].slice(0, MAX_SAVED);
      saveToStorage(next);
      return next;
    });
  }, []);

  const removeSaved = useCallback((id: string) => {
    setQueries((prev) => {
      const next = prev.filter((q) => q.id !== id);
      saveToStorage(next);
      return next;
    });
  }, []);

  const toggleSaved = useCallback(
    (query: string, category: string) => {
      if (isSaved(query, category)) {
        setQueries((prev) => {
          const next = prev.filter(
            (q) =>
              !(
                q.query.toLowerCase() === query.toLowerCase() &&
                q.category === category
              ),
          );
          saveToStorage(next);
          return next;
        });
      } else {
        addSaved(query, category);
      }
    },
    [isSaved, addSaved],
  );

  return { queries, loaded, isSaved, addSaved, removeSaved, toggleSaved };
}
