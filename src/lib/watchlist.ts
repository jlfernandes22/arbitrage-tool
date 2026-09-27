"use client";
// watchlist.ts — persistent "shortlist" of Goofish listings the user wants
// to keep an eye on across scans.
//
// KEY DESIGN POINTS
// - Keyed by the STABLE Goofish item id (listing.id — the exact same key the
//   listing-trend feature uses), so entries survive re-scans and re-runs.
// - Persisted in localStorage (`arbitrage_watchlist_v1`) so the watchlist is
//   a cross-scan, cross-session memory — it renders even with no scan loaded.
// - Shared state via useSyncExternalStore + a module-level store: the star
//   buttons inside the results table and the WatchlistPanel always agree,
//   no prop drilling, no context provider needed.
// - Each entry remembers `profitAtStarEur` so the panel can show "Δ since
//   starred" — the "is my shortlisted deal getting better or worse" signal.
import { useSyncExternalStore, useCallback } from "react";

export interface WatchlistEntry {
  id: string; // stable Goofish item id
  title: string; // display title (normalized key when available)
  rawTitle: string; // original Goofish title
  query: string; // scan query it was starred from
  url: string | null; // listing href (when the scraper captured one)
  priceCny: number; // latest known asking price (refreshed on re-sight)
  netProfitEur: number; // latest known net profit (refreshed on re-sight)
  marginPct: number; // latest known margin %
  riskScore: number; // latest known risk score
  note: string; // persistent user note
  starredAt: string; // ISO — when first starred
  profitAtStarEur: number; // net profit at star time (Δ-since-star baseline)
  lastSeenAt: string; // ISO — last time this id appeared in a loaded scan
  sightings: number; // how many distinct scan loads re-confirmed it
}

const STORAGE_KEY = "arbitrage_watchlist_v1";
const MAX_ENTRIES = 200; // keep localStorage lean — oldest starred drop off

// ── Module-level store (canonical state + pub/sub) ────────────────────────
const EMPTY: Record<string, WatchlistEntry> = {};
let cache: Record<string, WatchlistEntry> | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function loadFromStorage(): Record<string, WatchlistEntry> {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Record<string, WatchlistEntry>;
    // Defensive shape check — ignore corrupted/older-schema payloads.
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const clean: Record<string, WatchlistEntry> = {};
    for (const [id, e] of Object.entries(parsed)) {
      if (e && typeof e.id === "string" && typeof e.title === "string") {
        clean[id] = {
          ...e,
          note: typeof e.note === "string" ? e.note : "",
          sightings: typeof e.sightings === "number" ? e.sightings : 1,
        };
      }
    }
    return clean;
  } catch {
    return EMPTY;
  }
}

function persist(next: Record<string, WatchlistEntry>) {
  cache = next;
  hydrated = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be full/blocked (private mode) — state stays in-memory
    // for the session, which is the graceful degradation path.
  }
  listeners.forEach((l) => l());
}

function getSnapshot(): Record<string, WatchlistEntry> {
  if (!hydrated) {
    cache = loadFromStorage();
    hydrated = true;
  }
  return cache ?? EMPTY;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ── Mutations ─────────────────────────────────────────────────────────────
export interface WatchInput {
  id: string;
  title: string;
  rawTitle: string;
  query: string;
  url: string | null;
  priceCny: number;
  netProfitEur: number;
  marginPct: number;
  riskScore: number;
  synthetic?: boolean;
}

export function toggleWatch(input: WatchInput): "added" | "removed" {
  const cur = getSnapshot();
  if (cur[input.id]) {
    const next = { ...cur };
    delete next[input.id];
    persist(next);
    return "removed";
  }
  const now = new Date().toISOString();
  const next: Record<string, WatchlistEntry> = {
    [input.id]: {
      id: input.id,
      title: input.title,
      rawTitle: input.rawTitle,
      query: input.query,
      url: input.url ?? null,
      priceCny: input.priceCny,
      netProfitEur: input.netProfitEur,
      marginPct: input.marginPct,
      riskScore: input.riskScore,
      note: "",
      starredAt: now,
      profitAtStarEur: input.netProfitEur,
      lastSeenAt: now,
      sightings: 1,
    },
    ...cur,
  };
  // Enforce the cap — drop the OLDEST starred entries beyond the limit.
  if (Object.keys(next).length > MAX_ENTRIES) {
    const sorted = Object.values(next).sort(
      (a, b) => b.starredAt.localeCompare(a.starredAt),
    );
    const trimmed: Record<string, WatchlistEntry> = {};
    for (const e of sorted.slice(0, MAX_ENTRIES)) trimmed[e.id] = e;
    persist(trimmed);
  } else {
    persist(next);
  }
  return "added";
}

export function removeWatch(id: string) {
  const cur = getSnapshot();
  if (!cur[id]) return;
  const next = { ...cur };
  delete next[id];
  persist(next);
}

export function setWatchNote(id: string, note: string) {
  const cur = getSnapshot();
  if (!cur[id] || cur[id].note === note) return;
  persist({ ...cur, [id]: { ...cur[id], note } });
}

export function clearWatchlist() {
  persist({});
}

/**
 * Re-confirm watchlist entries against a freshly loaded scan:
 * refreshes live price/profit/margin/risk, bumps `lastSeenAt` and
 * `sightings`, and persists when anything changed (which notifies all
 * subscribers). Returns true when a change was written.
 */
export function syncWatchlistWithListings(
  listings: Array<{
    id: string;
    title: string;
    priceCny: number;
    profitNetEur: number;
    marginPct: number;
    riskScore: number;
  }>,
  query?: string,
): boolean {
  const cur = getSnapshot();
  const now = new Date().toISOString();
  let changed = false;
  const next = { ...cur };
  for (const l of listings) {
    const e = next[l.id];
    if (!e) continue;
    const drifted =
      e.priceCny !== l.priceCny ||
      Math.abs(e.netProfitEur - l.profitNetEur) > 0.005 ||
      Math.abs(e.marginPct - l.marginPct) > 0.05 ||
      e.riskScore !== l.riskScore;
    // Only bump lastSeenAt when >60s since the previous sighting — loading
    // the same scan twice in a minute shouldn't inflate the timestamp.
    const stale =
      now.localeCompare(e.lastSeenAt) > 0 &&
      Date.now() - new Date(e.lastSeenAt).getTime() > 60_000;
    if (!drifted && !stale) continue;
    next[l.id] = {
      ...e,
      title: l.title || e.title,
      // Re-sighting updates the origin label to where it was last seen —
      // the "seen in query X" chip in the panel stays truthful.
      query: query?.trim() ? query : e.query,
      priceCny: l.priceCny,
      netProfitEur: l.profitNetEur,
      marginPct: l.marginPct,
      riskScore: l.riskScore,
      lastSeenAt: stale ? now : e.lastSeenAt,
      sightings: stale ? e.sightings + 1 : e.sightings,
    };
    changed = true;
  }
  if (changed) persist(next);
  return changed;
}

// ── React binding ─────────────────────────────────────────────────────────
export function useWatchlist() {
  const entries = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY, // SSR snapshot — stable reference, never a fresh {}
  );
  const isWatched = useCallback((id: string) => id in entries, [entries]);
  return {
    entries,
    count: Object.keys(entries).length,
    isWatched,
    toggleWatch,
    removeWatch,
    setWatchNote,
    clearWatchlist,
  };
}
