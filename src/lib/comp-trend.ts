// Shared comp-trend key derivation — used by the comp-trend API (server side)
// and the listing-detail dialog (client side) so the lookup keys can never
// drift between the two.
//
// A "comp key" identifies the SAME marketplace item across scans:
//  - `u:<origin+pathname>` when the comp has a stable marketplace URL
//    (query/hash stripped — OLX appends volatile search-context params);
//  - `f:platform|title|condition|location` otherwise (conservative exact
//    match, so a fuzzy guess can never shadow a URL match).

import type { EuMarketComp } from "@/lib/engine/types";

export type CompTrendSource = "url" | "fallback";

export function compTrendKey(c: EuMarketComp): { key: string; source: CompTrendSource } | null {
  if (!c || typeof c.priceEur !== "number" || !Number.isFinite(c.priceEur)) return null;
  if (c.url) {
    let u = c.url;
    try {
      const parsed = new URL(c.url);
      parsed.hash = "";
      u = parsed.origin + parsed.pathname;
    } catch {
      // relative/malformed — use as-is
    }
    return { key: `u:${u}`, source: "url" };
  }
  const t = (c.title ?? "").trim().toLowerCase();
  if (!t) return null;
  return {
    key: `f:${c.platform}|${t}|${c.condition}|${(c.location ?? "").trim().toLowerCase()}`,
    source: "fallback",
  };
}

export interface CompTrendDelta {
  prevPriceEur: number;
  deltaEur: number;
  source: CompTrendSource;
}

export interface CompTrendResponse {
  comparedAgainst: { taskId: string; at: string } | null;
  scansCompared: number;
  currentComps: number;
  matched: number;
  deltas: Record<string, CompTrendDelta>;
}
