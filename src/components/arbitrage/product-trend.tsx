"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { TrendingUp, Loader2, Search, X, GitCompareArrows } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface TrendPoint {
  taskId: string;
  query: string;
  date: string;
  listingCount: number;
  filteredCount?: number; // listings excluded (scam / ¥0 placeholders)
  medianGoofishCny: number;
  medianProfitEur: number;
  medianResaleEur: number;
  medianMarginPct: number;
  bestProfitEur: number;
  bestMarginPct: number;
}

interface TrendResponse {
  query: string;
  baseQuery?: string;
  tasksMatched?: number; // scans whose query matched (may have no usable data)
  dataPoints: number;
  trend: TrendPoint[];
}

interface Suggestion {
  query: string;
  lastScanned: string;
}

/** A comparison series overlaid on the primary product's chart. */
interface CompareSeries {
  query: string;
  points: TrendPoint[];
}

// Strip storage suffix (e.g. "256GB", "128GB", "1TB") from a query so that
// "iPhone 15 Pro 256GB" → "iPhone 15 Pro". This ensures the trend search
// matches ALL storage variants of the same product.
function stripStorage(q: string): string {
  return q.replace(/\s*\d+\s*(?:GB|TB)\s*$/i, "").trim();
}

// Series palette — primary keeps emerald (the app's signal color); up to 3
// comparison series get visually distinct hues, all legible on light+dark.
const SERIES_COLORS = ["#10b981", "#0ea5e9", "#f59e0b", "#f43f5e"];
const MAX_COMPARE = 3;

export function ProductTrend({ defaultQuery, refreshKey }: { defaultQuery?: string; refreshKey?: number }) {
  const initialQuery = defaultQuery ? stripStorage(defaultQuery) : "";
  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [data, setData] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Comparison series overlaid on the chart (up to MAX_COMPARE).
  const [compare, setCompare] = useState<CompareSeries[]>([]);
  const [compareLoading, setCompareLoading] = useState<string | null>(null);
  // Autocomplete suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const suggestionsCache = useRef<Map<string, Suggestion[]>>(new Map());

  // Sequence counters: only the LATEST request may apply its response —
  // a slow earlier response must not overwrite a newer product's data.
  const trendSeqRef = useRef(0);
  const suggestSeqRef = useRef(0);
  const compareSeqRef = useRef(0);
  // Per-query trend cache — re-adding a removed series is instant.
  const compareCache = useRef<Map<string, TrendPoint[]>>(new Map());

  const fetchTrend = useCallback(async (q: string) => {
    if (!q.trim()) return;
    const seq = ++trendSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const cleanQ = stripStorage(q);
      const res = await fetch(`/api/tasks/trend?query=${encodeURIComponent(cleanQ)}`);
      if (seq !== trendSeqRef.current) return; // superseded by a newer request
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "fetch failed" }));
        throw new Error(err.error ?? "fetch failed");
      }
      const json: TrendResponse = await res.json();
      if (seq !== trendSeqRef.current) return;
      setData(json);
    } catch (e) {
      if (seq !== trendSeqRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setData(null);
    } finally {
      if (seq === trendSeqRef.current) setLoading(false);
    }
  }, []);

  // Fetch autocomplete suggestions as the user types
  const fetchSuggestions = useCallback(async (q: string) => {
    const seq = ++suggestSeqRef.current;
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    // Check cache first
    const cacheKey = q.trim().toLowerCase();
    if (suggestionsCache.current.has(cacheKey)) {
      setSuggestions(suggestionsCache.current.get(cacheKey)!);
      return;
    }
    try {
      const res = await fetch(`/api/tasks/suggestions?q=${encodeURIComponent(q.trim())}`);
      if (seq !== suggestSeqRef.current) return;
      if (res.ok) {
        const json = await res.json();
        const sugs: Suggestion[] = json.suggestions || [];
        suggestionsCache.current.set(cacheKey, sugs);
        if (seq === suggestSeqRef.current) setSuggestions(sugs);
      }
    } catch {
      // ignore
    }
  }, []);

  // Fetch one comparison series and append it (dedup + cap enforced here).
  const fetchCompare = useCallback(async (rawQ: string) => {
    const cleanQ = stripStorage(rawQ);
    if (!cleanQ) return;
    if (cleanQ === activeQuery) {
      toast.info("That's already the main chart series — search another product to compare.");
      return;
    }
    if (compare.some((c) => c.query === cleanQ)) {
      toast.info(`"${cleanQ}" is already on the chart.`);
      return;
    }
    if (compare.length >= MAX_COMPARE) {
      toast.warning(`Comparison is capped at ${MAX_COMPARE} extra products — remove one first.`);
      return;
    }
    const seq = ++compareSeqRef.current;
    setCompareLoading(cleanQ);
    try {
      let points = compareCache.current.get(cleanQ);
      if (!points) {
        const res = await fetch(`/api/tasks/trend?query=${encodeURIComponent(cleanQ)}`);
        if (seq !== compareSeqRef.current) return;
        if (!res.ok) throw new Error("fetch failed");
        const json: TrendResponse = await res.json();
        if (seq !== compareSeqRef.current) return;
        points = json.trend ?? [];
        compareCache.current.set(cleanQ, points);
      }
      if (points.length === 0) {
        toast.info(`No scan history for "${cleanQ}" — run a scan with this product first.`);
        return;
      }
      setCompare((prev) => {
        if (prev.some((c) => c.query === cleanQ)) return prev; // re-check under the lock
        if (prev.length >= MAX_COMPARE) return prev;
        return [...prev, { query: cleanQ, points }];
      });
    } catch {
      if (seq === compareSeqRef.current) toast.error(`Could not load trend for "${cleanQ}".`);
    } finally {
      if (seq === compareSeqRef.current) setCompareLoading(null);
    }
  }, [activeQuery, compare]);

  // Auto-fetch trend when defaultQuery or refreshKey changes; a NEW primary
  // product invalidates the comparison overlay (stale mixes mislead).
  useEffect(() => {
    const cleaned = defaultQuery ? stripStorage(defaultQuery) : "";
    if (cleaned) {
      setQuery(cleaned);
      setActiveQuery(cleaned);
      setCompare([]);
      compareSeqRef.current++; // cancel in-flight comparison fetches
      fetchTrend(cleaned);
    }
  }, [defaultQuery, refreshKey]);
  // note: intentionally omitting fetchTrend from deps to avoid double-fetch
  // when both defaultQuery and refreshKey change in the same tick

  // Debounce suggestion fetching
  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(() => {
      fetchSuggestions(query);
      setShowSuggestions(true);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, fetchSuggestions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    setActiveQuery(query);
    fetchTrend(query);
  };

  const selectSuggestion = (s: Suggestion) => {
    const cleaned = stripStorage(s.query);
    setQuery(cleaned);
    setActiveQuery(cleaned);
    setShowSuggestions(false);
    setSuggestionIndex(-1);
    fetchTrend(cleaned);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestionIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestionIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && suggestionIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[suggestionIndex]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setSuggestionIndex(-1);
    }
  };

  // Calculate min/max for chart scaling — ACROSS all visible series so the
  // overlay lines share one honest Y scale.
  const points = Array.isArray(data?.trend) ? data.trend : [];
  const allSeries: Array<{ query: string; points: TrendPoint[]; colorIdx: number }> = [
    { query: activeQuery, points, colorIdx: 0 },
    ...compare.map((c, ci) => ({ query: c.query, points: c.points, colorIdx: ci + 1 })),
  ];
  const profits = allSeries.flatMap((s) => s.points.map((p) => p.medianProfitEur)).filter((v) => v !== 0);
  const maxProfit = profits.length > 0 ? Math.max(...profits) : 0;
  const minProfit = profits.length > 0 ? Math.min(...profits, 0) : 0;
  const range = maxProfit - minProfit || 1;

  // Round helper — ensures clean integers everywhere
  const r = (n: number | undefined | null) => Math.round(n ?? 0);

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <h3 className="text-sm font-semibold">Product Profit Trend</h3>
        <span className="text-[10px] text-muted-foreground">
          Track profit margins for a specific product across all past scans
        </span>
      </div>

      {/* Search bar with autocomplete + compare action */}
      <form
        onSubmit={handleSubmit}
        className="mb-1 flex flex-wrap gap-2"
      >
        <div className="relative min-w-0 flex-1 max-w-md basis-52">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Enter a product name (e.g. iPhone 15 Pro)…"
            className="h-9 pl-8 text-xs focus-visible:ring-emerald-500/40 focus-visible:ring-2"
          />
          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border bg-popover shadow-lg">
              {suggestions.map((s, i) => (
                <button
                  key={s.query + s.lastScanned}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                    i === suggestionIndex ? "bg-emerald-50 dark:bg-emerald-950/40" : "hover:bg-muted/50"
                  }`}
                >
                  <span className="font-medium text-foreground">{stripStorage(s.query)}</span>
                  <span className="shrink-0 text-[9px] text-muted-foreground">
                    {new Date(s.lastScanned).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button type="submit" size="sm" disabled={loading || !query.trim()} className="h-9 gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
          {loading ? "Loading…" : "Show Trend"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 gap-1.5"
          disabled={!query.trim() || compareLoading != null}
          onClick={() => void fetchCompare(query)}
          title={`Overlay "${stripStorage(query) || "this product"}" on the chart to compare against the main series (up to ${MAX_COMPARE})`}
        >
          {compareLoading === stripStorage(query) ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <GitCompareArrows className="h-3.5 w-3.5" />
          )}
          Compare
        </Button>
      </form>
      <p className="mb-3 text-[9px] text-muted-foreground">
        Storage variants are automatically included — searching &quot;iPhone 15 Pro&quot; matches all sizes (128GB, 256GB, etc.).
        Use <span className="font-semibold">Compare</span> to overlay other products on the same chart.
      </p>

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {data && data.dataPoints === 0 && !loading && (
        <div className="py-6 text-center">
          {data.tasksMatched !== undefined && data.tasksMatched > 0 ? (
            <p className="text-xs text-muted-foreground">
              {data.tasksMatched} past scan{data.tasksMatched === 1 ? "" : "s"} matched
              &quot;{activeQuery}&quot;, but none contained usable price data (no listings with a
              real Goofish price + profit estimate).
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No past scans found for &quot;{activeQuery}&quot;. Run a scan with this product first.
            </p>
          )}
        </div>
      )}

      {data && data.dataPoints > 0 && !loading && (
        <div className="space-y-3">
          {/* Summary stats — all rounded to clean integers */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Scans" value={String(data.dataPoints)} />
            <StatCard
              label="Latest profit"
              value={`€${r(points[points.length - 1]?.medianProfitEur)}`}
              tone={r(points[points.length - 1]?.medianProfitEur) >= 0 ? "positive" : "negative"}
            />
            <StatCard
              label="Best profit"
              value={`€${r(Math.max(...points.map((p) => p.bestProfitEur)))}`}
              tone="positive"
            />
            <StatCard
              label="Avg margin"
              value={`${r(points.reduce((s, p) => s + p.medianMarginPct, 0) / points.length)}%`}
            />
          </div>

          {/* Trend chart */}
          {points.length >= 2 && (
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Median net profit (€) over time
                </span>
                <div className="flex items-center gap-2">
                  {/* Delta vs the previous scan — instant direction signal */}
                  <DeltaChip
                    delta={
                      r(points[points.length - 1]?.medianProfitEur) -
                      r(points[points.length - 2]?.medianProfitEur)
                    }
                  />
                  <span className="text-[9px] text-muted-foreground">
                    {points.length} data points
                  </span>
                </div>
              </div>
              {/* Series legend — color chip per product, removable */}
              {allSeries.length > 1 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {allSeries.map((s) => (
                    <span
                      key={s.query}
                      className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[10px] font-medium"
                      title={`Median profit series for "${s.query}"`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: SERIES_COLORS[s.colorIdx] }}
                        aria-hidden
                      />
                      <span className="max-w-[140px] truncate">{s.query}</span>
                      {s.colorIdx !== 0 && (
                        <button
                          type="button"
                          aria-label={`Remove ${s.query} from comparison`}
                          className="ml-0.5 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() =>
                            setCompare((prev) => prev.filter((c) => c.query !== s.query))
                          }
                        >
                          <X className="h-2.5 w-2.5" aria-hidden />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              <div className="relative h-40 w-full">
                <svg
                  viewBox={`0 0 ${Math.max(Math.max(...allSeries.map((s) => s.points.length)) * 60, 300)} 160`}
                  className="h-full w-full"
                  preserveAspectRatio="xMidYMid meet"
                >
                  {/* Zero line */}
                  <line
                    x1="0"
                    y1={((maxProfit - 0) / range) * 140 + 10}
                    x2={Math.max(Math.max(...allSeries.map((s) => s.points.length)) * 60, 300)}
                    y2={((maxProfit - 0) / range) * 140 + 10}
                    stroke="currentColor"
                    strokeWidth="0.5"
                    strokeDasharray="4 4"
                    className="text-muted-foreground/30"
                  />
                  {/* One polyline per series (primary first so comparisons draw on top) */}
                  {allSeries.map((s) => {
                    const color = SERIES_COLORS[s.colorIdx] ?? SERIES_COLORS[0];
                    const stepCount = Math.max(s.points.length - 1, 1);
                    const chartW = Math.max(Math.max(...allSeries.map((x) => x.points.length)) * 60, 300);
                    const step = (chartW - 60) / stepCount;
                    return (
                      <g key={s.query}>
                        {/* Gradient area fill under the PRIMARY series only —
                            comparisons stay as clean lines to avoid mud */}
                        {s.colorIdx === 0 && (
                          <polygon
                            points={[
                              `0,${((maxProfit - 0) / range) * 140 + 10}`,
                              ...s.points.map((p, i) => {
                                const x = 30 + i * step;
                                const y = ((maxProfit - r(p.medianProfitEur)) / range) * 140 + 10;
                                return `${x.toFixed(1)},${y.toFixed(1)}`;
                              }),
                              `${(30 + (s.points.length - 1) * step).toFixed(1)},${((maxProfit - 0) / range) * 140 + 10}`,
                            ].join(" ")}
                            fill={color}
                            opacity="0.07"
                          />
                        )}
                        <polyline
                          points={s.points
                            .map((p, i) => {
                              const x = 30 + i * step;
                              const y = ((maxProfit - r(p.medianProfitEur)) / range) * 140 + 10;
                              return `${x.toFixed(1)},${y.toFixed(1)}`;
                            })
                            .join(" ")}
                          fill="none"
                          stroke={color}
                          strokeWidth={s.colorIdx === 0 ? 2 : 1.5}
                          strokeDasharray={s.colorIdx === 0 ? undefined : "5 3"}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity={s.colorIdx === 0 ? 1 : 0.9}
                        />
                        {/* Data points + labels — primary only, so overlaid
                            series don't clutter the chart */}
                        {s.colorIdx === 0 &&
                          s.points.map((p, i) => {
                            const x = 30 + i * step;
                            const profit = r(p.medianProfitEur);
                            const y = ((maxProfit - profit) / range) * 140 + 10;
                            // Labels above a point clip at the chart's top edge when
                            // the point sits near the top (y < 20) — flip below it.
                            const labelY = y < 20 ? y + 16 : y - 8;
                            return (
                              <g key={p.taskId}>
                                <circle
                                  cx={x}
                                  cy={y}
                                  r="4"
                                  fill={profit >= 0 ? color : "#f43f5e"}
                                />
                                <text
                                  x={x}
                                  y={labelY}
                                  textAnchor="middle"
                                  className="fill-foreground text-[8px]"
                                >
                                  €{profit}
                                </text>
                              </g>
                            );
                          })}
                      </g>
                    );
                  })}
                </svg>
              </div>
              {/* X-axis labels — per visible series when comparing (each has
                  its own scan dates; a single axis would lie) */}
              {allSeries.length === 1 ? (
                <div className="mt-1 flex justify-between text-[8px] text-muted-foreground">
                  <span>{new Date(points[0].date).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })}</span>
                  <span>{new Date(points[points.length - 1].date).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })}</span>
                </div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {allSeries.map((s) => (
                    <div key={s.query} className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: SERIES_COLORS[s.colorIdx] }}
                        aria-hidden
                      />
                      <span className="max-w-[120px] truncate">{s.query}:</span>
                      <span>
                        {new Date(s.points[0].date).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })}
                        {" → "}
                        {new Date(s.points[s.points.length - 1].date).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })}
                        {" · "}
                        {s.points.length} scans
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Data table — primary series only (comparisons are chart-level) */}
          <div className="max-h-48 overflow-y-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-semibold text-muted-foreground">Date</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground">Listings</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground">Goofish ¥</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground">Resale €</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground">Profit €</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground">Margin</th>
                </tr>
              </thead>
              <tbody>
                {points.slice().reverse().map((p) => (
                  <tr key={p.taskId} className="border-t transition-colors hover:bg-muted/40">
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {new Date(p.date).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {p.listingCount}
                      {typeof p.filteredCount === "number" && p.filteredCount > 0 && (
                        <span className="ml-1 text-[9px] text-muted-foreground">(+{p.filteredCount} filtered)</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-rose-600 dark:text-rose-400">¥{r(p.medianGoofishCny)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-teal-600 dark:text-teal-400">€{r(p.medianResaleEur)}</td>
                    <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${r(p.medianProfitEur) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      €{r(p.medianProfitEur)}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${r(p.medianMarginPct) >= 0 ? "text-foreground" : "text-rose-600 dark:text-rose-400"}`}>
                      {r(p.medianMarginPct)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`text-sm font-bold tabular-nums ${
          tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : tone === "negative" ? "text-rose-600 dark:text-rose-400" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** ▲/▼ chip showing how the latest scan moved vs the previous one. */
function DeltaChip({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-muted-foreground">
        = unchanged
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${
        up
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
      }`}
      title="Latest scan median profit vs the previous scan"
    >
      {up ? "▲" : "▼"} €{Math.abs(delta)} vs prev
    </span>
  );
}
