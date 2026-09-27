"use client";
// watchlist-panel.tsx — persistent shortlist of starred Goofish listings.
//
// Renders ALWAYS (even with no scan loaded) — that's the point: it is the
// cross-scan memory of "deals I'm circling". Each entry shows the latest
// known profit/price (refreshed whenever a loaded scan re-confirms the
// listing), a Δ-since-starred chip, and a persistent per-item note.
import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Star,
  StarOff,
  Trash2,
  Pencil,
  Check,
  X,
  Download,
  ChevronDown,
  Radio,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import type { EvaluatedListing } from "./types";
import { cny, eurPrecise } from "./types";
import {
  useWatchlist,
  syncWatchlistWithListings,
  type WatchlistEntry,
} from "@/lib/watchlist";

interface WatchlistPanelProps {
  // Current scan's evaluated listings (already `safeListings`-guarded).
  // Used to (a) refresh live stats, (b) badge entries visible right now.
  listings: EvaluatedListing[];
  query?: string; // current scan query (labels "seen in" origin)
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function WatchlistPanel({ listings, query }: WatchlistPanelProps) {
  const { entries, count, isWatched, removeWatch, setWatchNote, clearWatchlist } =
    useWatchlist();
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  // Sync watchlist stats against the current scan (refresh profit/price,
  // bump sightings, update the origin label). Fire-and-forget — never
  // blocks rendering; persisting notifies subscribers which re-renders us.
  useEffect(() => {
    if (listings.length === 0) return;
    syncWatchlistWithListings(
      listings.map((l) => ({
        id: l.listing.id,
        title: l.listing.normalized?.standardKey ?? l.listing.title,
        priceCny: l.listing.priceCny,
        profitNetEur: l.profit.netProfitEur,
        marginPct: l.profit.marginPct,
        riskScore: l.scam.riskScore,
      })),
      query,
    );
  }, [listings, query]);

  // Clear the two-step confirm if the user walks away.
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3500);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const currentIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of listings) s.add(l.listing.id);
    return s;
  }, [listings]);

  const sortedEntries = useMemo(
    () =>
      Object.values(entries).sort((a, b) => {
        // Entries visible in the CURRENT scan float to the top, then most
        // recently starred first.
        const aNow = currentIds.has(a.id) ? 1 : 0;
        const bNow = currentIds.has(b.id) ? 1 : 0;
        if (aNow !== bNow) return bNow - aNow;
        return b.starredAt.localeCompare(a.starredAt);
      }),
    [entries, currentIds],
  );

  const startEdit = (e: WatchlistEntry) => {
    setEditingId(e.id);
    setNoteDraft(e.note);
  };
  const saveEdit = () => {
    if (editingId) setWatchNote(editingId, noteDraft.trim());
    setEditingId(null);
    setNoteDraft("");
  };

  const exportMarkdown = () => {
    const rows = Object.values(entries);
    if (rows.length === 0) return;
    const md = [
      `## Listing Watchlist (${rows.length} starred)`,
      ``,
      `| Product | Profit | Price | Since star | Note | Starred |`,
      `|---|---|---|---|---|---|`,
      ...rows.map((e) => {
        const delta = e.netProfitEur - e.profitAtStarEur;
        const dStr =
          Math.abs(delta) < 0.005
            ? "—"
            : `${delta > 0 ? "+" : "−"}€${Math.abs(delta).toFixed(0)}`;
        return `| ${e.title.replace(/\|/g, "\\|")} | ${eurPrecise(e.netProfitEur)} | ${cny(e.priceCny)} | ${dStr} | ${e.note.replace(/\|/g, "\\|") || "—"} | ${e.starredAt.slice(0, 10)} |`;
      }),
      ``,
      `_Exported from Arbitrage Intelligence Engine · ${new Date().toISOString().slice(0, 10)}_`,
    ].join("\n");
    navigator.clipboard.writeText(md);
    toast.success(`Watchlist copied (${rows.length} items)`);
  };

  const handleClearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    clearWatchlist();
    toast.success("Watchlist cleared");
  };

  if (count === 0) {
    return (
      <section aria-label="Listing watchlist">
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-amber-300/60 bg-gradient-to-b from-amber-50/40 to-transparent py-6 text-center dark:border-amber-800/50 dark:from-amber-950/10">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
            <Star className="h-4 w-4" />
          </div>
          <p className="text-xs font-semibold">Listing Watchlist</p>
          <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
            Star a row in the results table to shortlist it here — with a
            persistent note, live profit refresh on every scan, and a
            Δ-since-starred signal.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Listing watchlist">
      <Card className="overflow-hidden border-amber-200/70 dark:border-amber-900/60">
        {/* Amber gradient header strip — visually separates the watchlist
            (a curated shortlist) from the raw results around it. */}
        <CardHeader className="border-b border-amber-200/60 bg-gradient-to-r from-amber-50/80 via-card to-orange-50/50 pb-3 dark:border-amber-900/50 dark:from-amber-950/20 dark:via-card dark:to-orange-950/10">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
              <Star className="h-3.5 w-3.5 fill-white" />
            </span>
            Listing Watchlist
            <Badge
              variant="outline"
              className="h-4.5 border-amber-300 bg-amber-100/60 px-1.5 text-[10px] font-bold tabular-nums text-amber-700 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            >
              {count}
            </Badge>
            {sortedEntries.some((e) => currentIds.has(e.id)) && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Radio className="h-3 w-3 animate-pulse text-emerald-500" />
                {sortedEntries.filter((e) => currentIds.has(e.id)).length} in
                current scan
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={exportMarkdown}
                    title="Copy watchlist as Markdown table"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Export as Markdown
                </TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 gap-1 px-2 text-xs ${
                  confirmClear
                    ? "bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-950/60 dark:text-rose-300"
                    : "text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                }`}
                onClick={handleClearAll}
                title="Remove all starred listings"
              >
                {confirmClear ? (
                  <>
                    <X className="h-3 w-3" />
                    Confirm clear?
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3 w-3" />
                    Clear all
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setCollapsed((c) => !c)}
                title={collapsed ? "Expand watchlist" : "Collapse watchlist"}
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${
                    collapsed ? "-rotate-90" : ""
                  }`}
                />
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        {!collapsed && (
          <CardContent className="p-0">
            <div className="slim-scroll max-h-96 divide-y divide-border/60 overflow-y-auto">
              {sortedEntries.map((e) => {
                const delta = e.netProfitEur - e.profitAtStarEur;
                const hasDelta = Math.abs(delta) >= 0.005;
                const inCurrent = currentIds.has(e.id);
                const profitTone =
                  e.netProfitEur > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400";
                return (
                  <div
                    key={e.id}
                    className="group/item relative px-4 py-3 transition-colors hover:bg-amber-50/40 dark:hover:bg-amber-950/10"
                  >
                    {/* Left accent — solid for entries visible in the current
                        scan, translucent for dormant ones. */}
                    <span
                      aria-hidden
                      className={`absolute left-0 top-0 h-full w-0.5 ${
                        inCurrent
                          ? "bg-gradient-to-b from-amber-400 to-orange-500"
                          : "bg-border/50"
                      }`}
                    />
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-xs font-semibold">
                            {e.title}
                          </span>
                          {inCurrent && (
                            <Badge
                              variant="outline"
                              className="h-4 shrink-0 border-emerald-300 bg-emerald-50 px-1.5 text-[9px] font-semibold leading-none text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            >
                              IN SCAN
                            </Badge>
                          )}
                        </div>
                        {/* Live stats row */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                          <span
                            className={`font-bold tabular-nums ${profitTone}`}
                            title={`Latest net profit · margin ${e.marginPct.toFixed(1)}%`}
                          >
                            {eurPrecise(e.netProfitEur)} net
                          </span>
                          <span
                            className="tabular-nums text-muted-foreground"
                            title="Latest asking price"
                          >
                            {cny(e.priceCny)}
                          </span>
                          {hasDelta && (
                            <span
                              className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-semibold tabular-nums ${
                                delta > 0
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                              }`}
                              title={`Net profit was ${eurPrecise(e.profitAtStarEur)} when starred (${new Date(e.starredAt).toLocaleDateString()})`}
                            >
                              {delta > 0 ? "▲" : "▼"} €{Math.abs(delta).toFixed(0)} since star
                            </span>
                          )}
                          <span
                            className="text-muted-foreground/80"
                            title={`Seen in ${e.sightings} scan${e.sightings === 1 ? "" : "s"}`}
                          >
                            seen {relTime(e.lastSeenAt)}
                          </span>
                          {e.query && (
                            <Badge
                              variant="outline"
                              className="h-4 max-w-32 px-1.5 text-[9px] font-normal leading-none text-muted-foreground"
                            >
                              <span className="truncate">{e.query}</span>
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {editingId === e.id ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700"
                              onClick={saveEdit}
                              title="Save note"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                setEditingId(null);
                                setNoteDraft("");
                              }}
                              title="Discard"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-7 w-7 p-0 ${
                                e.note
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground/50 opacity-0 group-hover/item:opacity-100"
                              }`}
                              onClick={() => startEdit(e)}
                              title={e.note ? "Edit note" : "Add a note"}
                            >
                              {e.note ? (
                                <StickyNote className="h-3.5 w-3.5" />
                              ) : (
                                <Pencil className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-muted-foreground/50 opacity-0 transition-opacity hover:text-rose-600 group-hover/item:opacity-100 dark:hover:text-rose-400"
                                  onClick={() => removeWatch(e.id)}
                                  title="Remove from watchlist"
                                >
                                  <StarOff className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="text-xs">
                                Unstar (removes note too)
                              </TooltipContent>
                            </Tooltip>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Note area — inline edit, or rendered note */}
                    {editingId === e.id ? (
                      <div className="mt-2">
                        <Textarea
                          autoFocus
                          value={noteDraft}
                          onChange={(ev) => setNoteDraft(ev.target.value)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" && !ev.shiftKey) {
                              ev.preventDefault();
                              saveEdit();
                            }
                            if (ev.key === "Escape") {
                              ev.preventDefault();
                              setEditingId(null);
                              setNoteDraft("");
                            }
                          }}
                          placeholder="e.g. 'seller agreed to ¥850 — message again after payday' · Enter to save, Esc to discard"
                          className="min-h-16 resize-y border-amber-300/60 bg-background text-xs focus-visible:ring-amber-400/50 dark:border-amber-800/60"
                          rows={2}
                        />
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Saved locally on this device · {e.note.length}/500
                          {noteDraft.length > 500 && (
                            <span className="ml-1 font-semibold text-rose-500">
                              (trimming at save)
                            </span>
                          )}
                        </p>
                      </div>
                    ) : (
                      e.note && (
                        <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-200/60 bg-amber-50/50 px-2 py-1.5 text-[11px] leading-relaxed text-foreground/80 dark:border-amber-900/50 dark:bg-amber-950/20">
                          <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                          <span className="whitespace-pre-wrap">{e.note}</span>
                        </p>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>
    </section>
  );
}
