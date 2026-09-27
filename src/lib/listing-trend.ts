// Shared listing-trend types — used by the listing-trend API (server side),
// the results table (sparkline + Δ chips) and the scan-completion alert
// wiring in page.tsx, so the shapes can never drift.
//
// Tracks each GOOFISH listing's estimated net profit / asking price across
// prior scans of the same query (keyed by the stable Goofish item id).
// The EU-comp equivalent lives in comp-trend.ts.

export interface ListingTrendSeries {
  profits: number[]; // chronological oldest → newest (ends at the current scan)
  pricesCny: number[];
  at: string[];
}

export interface ListingTrendDelta {
  prevProfitEur: number;
  deltaProfitEur: number; // current − previous (positive = profit improved)
  prevPriceCny: number;
  deltaPriceCny: number;
  at: string; // when the previous sighting was recorded
}

export interface ListingTrendResponse {
  comparedAgainst: { taskId: string; at: string } | null;
  scansCompared: number;
  series: Record<string, ListingTrendSeries>;
  deltas: Record<string, ListingTrendDelta>;
}
