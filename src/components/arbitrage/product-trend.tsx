"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { TrendingUp, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface TrendPoint {
  taskId: string;
  query: string;
  date: string;
  listingCount: number;
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
  dataPoints: number;
  trend: TrendPoint[];
}

interface Suggestion {
  query: string;
  lastScanned: string;
}

// Strip storage suffix (e.g. "256GB", "128GB", "1TB") from a query so that
// "iPhone 15 Pro 256GB" → "iPhone 15 Pro". This ensures the trend search
// matches ALL storage variants of the same product.
function stripStorage(q: string): string {
  return q.replace(/\s*\d+\s*(?:GB|TB)\s*$/i, "").trim();
}

export function ProductTrend({ defaultQuery }: { defaultQuery?: string }) {
  const initialQuery = defaultQuery ? stripStorage(defaultQuery) : "";
  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [data, setData] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Autocomplete suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const suggestionsCache = useRef<Map<string, Suggestion[]>>(new Map());

  const fetchTrend = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const cleanQ = stripStorage(q);
      const res = await fetch(`/api/tasks/trend?query=${encodeURIComponent(cleanQ)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "fetch failed" }));
        throw new Error(err.error ?? "fetch failed");
      }
      const json: TrendResponse = await res.json();
      setData(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch autocomplete suggestions as the user types
  const fetchSuggestions = useCallback(async (q: string) => {
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
      if (res.ok) {
        const json = await res.json();
        const sugs: Suggestion[] = json.suggestions || [];
        suggestionsCache.current.set(cacheKey, sugs);
        setSuggestions(sugs);
      }
    } catch {
      // ignore
    }
  }, []);

  // Auto-fetch trend when defaultQuery changes
  useEffect(() => {
    const cleaned = defaultQuery ? stripStorage(defaultQuery) : "";
    if (cleaned && cleaned !== activeQuery) {
      setQuery(cleaned);
      setActiveQuery(cleaned);
      fetchTrend(cleaned);
    }
  }, [defaultQuery, activeQuery, fetchTrend]);

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

  // Calculate min/max for chart scaling
  const points = Array.isArray(data?.trend) ? data.trend : [];
  const profits = points.map((p) => p.medianProfitEur).filter((v) => v !== 0);
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

      {/* Search bar with autocomplete */}
      <form onSubmit={handleSubmit} className="mb-1 flex gap-2">
        <div className="relative flex-1 max-w-md">
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
      </form>
      <p className="mb-3 text-[9px] text-muted-foreground">
        Storage variants are automatically included — searching &quot;iPhone 15 Pro&quot; matches all sizes (128GB, 256GB, etc.)
      </p>

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {data && data.dataPoints === 0 && !loading && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No past scans found for &quot;{activeQuery}&quot;. Run a scan with this product first.
        </p>
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
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Median net profit (€) over time
                </span>
                <span className="text-[9px] text-muted-foreground">
                  {points.length} data points
                </span>
              </div>
              <div className="relative h-40 w-full">
                <svg
                  viewBox={`0 0 ${Math.max(points.length * 60, 300)} 160`}
                  className="h-full w-full"
                  preserveAspectRatio="none"
                >
                  {/* Zero line */}
                  <line
                    x1="0"
                    y1={((maxProfit - 0) / range) * 140 + 10}
                    x2={Math.max(points.length * 60, 300)}
                    y2={((maxProfit - 0) / range) * 140 + 10}
                    stroke="currentColor"
                    strokeWidth="0.5"
                    strokeDasharray="4 4"
                    className="text-muted-foreground/30"
                  />
                  {/* Profit line */}
                  <polyline
                    points={points
                      .map((p, i) => {
                        const x = i * 60 + 30;
                        const y = ((maxProfit - r(p.medianProfitEur)) / range) * 140 + 10;
                        return `${x},${y}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-emerald-500"
                  />
                  {/* Data points */}
                  {points.map((p, i) => {
                    const x = i * 60 + 30;
                    const profit = r(p.medianProfitEur);
                    const y = ((maxProfit - profit) / range) * 140 + 10;
                    return (
                      <g key={p.taskId}>
                        <circle
                          cx={x}
                          cy={y}
                          r="4"
                          fill="currentColor"
                          className={profit >= 0 ? "text-emerald-500" : "text-rose-500"}
                        />
                        <text
                          x={x}
                          y={y - 8}
                          textAnchor="middle"
                          className="fill-foreground text-[8px]"
                        >
                          €{profit}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
              {/* X-axis labels */}
              <div className="mt-1 flex justify-between text-[8px] text-muted-foreground">
                <span>{new Date(points[0].date).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })}</span>
                <span>{new Date(points[points.length - 1].date).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })}</span>
              </div>
            </div>
          )}

          {/* Data table */}
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
                  <tr key={p.taskId} className="border-t">
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {new Date(p.date).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{p.listingCount}</td>
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
