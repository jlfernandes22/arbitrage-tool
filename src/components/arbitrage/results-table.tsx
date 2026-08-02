"use client";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { extractFamily } from "./profit-heatmap";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Columns3 } from "lucide-react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  ImageIcon,
  FileText,
} from "lucide-react";
import {
  type EvaluatedListing,
  CONDITION_LABELS,
  CONDITION_COLORS,
  eur,
  eurPrecise,
  cny,
} from "./types";
import { displayTitle } from "@/lib/engine/normalizer";
import { ListingDetailDialog } from "./listing-detail";
import { toast } from "sonner";
type SortKey =
  | "product"
  | "costBaseEur"
  | "euBaseline"
  | "netProfit"
  | "margin"
  | "risk";
interface ResultsTableProps {
  listings: EvaluatedListing[];
  showHidden: boolean;
  onToggleHidden: () => void;
  // External filter from clicking summary cards. null = no filter.
  cardFilter?: "all" | "viable" | "scam" | "profit" | null;
  // External filter from clicking a heatmap cell: {family, condition}.
  // Applied on top of cardFilter. null = no heatmap filter.
  heatmapFilter?: { family: string; condition: string } | null;
}
// Imperative API exposed via ref so the parent (page.tsx) can drive row
// navigation from keyboard shortcuts (j/k/o/b/m).
export interface ResultsTableHandle {
  nextRow: () => void;
  prevRow: () => void;
  openActive: () => void;
  copyActiveBlueprint: () => void;
  copyActiveMarkdown: () => void;
}
export const ResultsTable = forwardRef<ResultsTableHandle, ResultsTableProps>(function ResultsTable({
  listings: rawListings,
  showHidden,
  onToggleHidden,
  cardFilter = null,
  heatmapFilter = null,
}, ref) {
  const listings = Array.isArray(rawListings) ? rawListings : [];
  const [sortKey, setSortKey] = useState<SortKey>("netProfit");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<EvaluatedListing | null>(null);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  // Column visibility toggle — users can hide columns they don't need.
  // "product" and "action" are always visible (essential).
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const toggleColumn = (col: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };
  const isColVisible = (col: string) => !hiddenColumns.has(col);
  // Apply the card filter on top of the showHidden toggle.
  // - "all": show everything (forces showHidden behavior for this filter)
  // - "viable": only non-hidden listings
  // - "scam": only listings hidden due to scam (dropped or risk > threshold)
  // - "profit": only listings hidden due to profit/margin filters
  // - null: respect showHidden toggle (default behavior)
  // Then apply the heatmap cell filter (family + condition) on top.
  const cardFiltered = useMemo(() => {
    let base: EvaluatedListing[];
    if (!cardFilter) base = showHidden ? listings : listings.filter((l) => !l.hidden);
    else if (cardFilter === "all") base = listings;
    else if (cardFilter === "viable") base = listings.filter((l) => !l.hidden);
    else if (cardFilter === "scam") base = listings.filter((l) => l.hidden && (l.scam.dropped || l.scam.riskScore >= 60));
    else if (cardFilter === "profit") base = listings.filter((l) => l.hidden && !(l.scam.dropped || l.scam.riskScore >= 60));
    else base = listings;
    // Apply heatmap cell filter on top
    if (heatmapFilter) {
      base = base.filter((l) => {
        const fam = extractFamily(l.listing.normalized?.standardKey);
        const cond = l.listing.normalized?.condition ?? "unknown";
        return fam === heatmapFilter.family && cond === heatmapFilter.condition;
      });
    }
    return base;
  }, [listings, cardFilter, showHidden, heatmapFilter]);
  const visible = cardFiltered;
  const sorted = useMemo(() => {
    const arr = [...visible];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "product":
          cmp = (a.listing.normalized?.standardKey ?? a.listing.title).localeCompare(
            b.listing.normalized?.standardKey ?? b.listing.title,
          );
          break;
        case "costBaseEur":
          cmp = a.profit.landed.acquisitionCostEur - b.profit.landed.acquisitionCostEur;
          break;
        case "euBaseline":
          cmp = a.profit.expectedResaleEur - b.profit.expectedResaleEur;
          break;
        case "netProfit":
          cmp = a.profit.netProfitEur - b.profit.netProfitEur;
          break;
        case "margin":
          cmp = a.profit.marginPct - b.profit.marginPct;
          break;
        case "risk":
          cmp = a.scam.riskScore - b.scam.riskScore;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [visible, sortKey, sortDir]);
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };
  // ── Pagination ──────────────────────────────────────────────
  // Renders only PAGE_SIZE rows at a time so the DOM stays light even
  // when the user toggles "Show filtered-out" or clicks the scam/profit
  // summary cards (which can surface dozens of hidden listings at once).
  const PAGE_SIZE = 15;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Reset to page 1 when filter inputs change. This is the React-recommended
  // "adjusting state during render" pattern (avoids setState-in-effect):
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const filterSig = `${cardFilter ?? ""}|${showHidden ? "1" : "0"}|${heatmapFilter?.family ?? ""}|${heatmapFilter?.condition ?? ""}|${listings.length}`;
  const [prevFilterSig, setPrevFilterSig] = useState(filterSig);
  if (prevFilterSig !== filterSig) {
    setPrevFilterSig(filterSig);
    setPage(1);
  }
  // Clamp page when the sorted set shrinks (e.g. after re-evaluate).
  const effectivePage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (effectivePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, sorted.length);
  const paged = sorted.slice(pageStart, pageEnd);
  // Expose imperative navigation + copy API for keyboard shortcuts.
  // (Declared after copyBlueprint/copyMarkdown below — see second block.)
  const copyBlueprint = (l: EvaluatedListing) => {
    const listing = l?.listing;
    if (!listing) return;
    const n = listing.normalized;
    const lines = [
      `=== ARBITRAGE LISTING BLUEPRINT ===`,
      `Product: ${n?.standardKey ?? listing.title}`,
      `Condition: ${n ? CONDITION_LABELS[n.condition] : "Used"}`,
      ``,
      `-- Source (Goofish / 闲鱼) --`,
      `Title: ${listing.title}`,
      `Price: ${cny(listing.priceCny)} (¥${listing.priceCny})`,
      `Location: ${listing.sellerLocation}`,
      `Seller: ${listing.sellerVerified ? "Verified" : "Unverified"} · ${listing.sellerVerifiedTransactions} txns`,
      `URL: https://www.goofish.com/search?q=${encodeURIComponent(listing.title)}`,
      ``,
      `-- Landed Cost (Portugal) --`,
      `Acquisition: ${eurPrecise(l?.profit?.landed?.acquisitionCostEur ?? 0)}`,
      `Agent + inspection + CN ship + insurance: ${eurPrecise((l?.profit?.landed?.agentServiceFeeEur ?? 0) + (l?.profit?.landed?.inspectionFeeEur ?? 0) + (l?.profit?.landed?.domesticShippingCnEur ?? 0) + (l?.profit?.landed?.insuranceFeeEur ?? 0))}`,
      `Intl shipping + customs: ${eur((l?.profit?.landed?.internationalShippingEur ?? 0) + (l?.profit?.landed?.customsClearanceEur ?? 0))}`,
      `Import duty: ${eurPrecise(l?.profit?.landed?.importDutyEur ?? 0)}`,
      `Import VAT (23%): ${eurPrecise(l?.profit?.landed?.importVatEur ?? 0)}`,
      `Domestic CTT: ${eur(l?.profit?.landed?.domesticShippingEur ?? 0)}`,
      `TOTAL LANDED: ${eurPrecise(l?.profit?.landed?.totalLandedCostEur ?? 0)}`,
      ``,
      `-- EU Resale --`,
      `Expected resale: ${eur(l?.profit?.expectedResaleEur ?? 0)} (${l?.profit?.resaleSource ?? "median"})`,
      `Platform fee: ${eurPrecise(l?.profit?.resaleFeeEur ?? 0)}`,
      `Net resale: ${eurPrecise(l?.profit?.netResaleEur ?? 0)}`,
      ``,
      `-- Profitability --`,
      `NET PROFIT: ${eurPrecise(l?.profit?.netProfitEur ?? 0)}`,
      `MARGIN: ${(l?.profit?.marginPct ?? 0).toFixed(1)}%`,
      `RISK SCORE: ${l?.scam?.riskScore ?? 0}/100`,
      ``,
      `Generated by Arbitrage Intelligence Engine`,
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Blueprint copied to clipboard");
  };
  // Copy as Markdown — formats the listing as a MD table for pasting into
  // Notion / Obsidian / GitHub issues. Includes a header, a single data row,
  // and a nested landed-cost breakdown.
  const copyMarkdown = (l: EvaluatedListing) => {
    const listing = l?.listing;
    if (!listing) return;
    const n = listing.normalized;
    const p = l.profit;
    const lc = p.landed;
    const md = [
      `## ${n?.standardKey ?? listing.title}`,
      ``,
      `> **Goofish listing** · ${listing.id} · ${n ? CONDITION_LABELS[n.condition] : "Used"}`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| **Source title** | ${listing.title.replace(/\|/g, "\\|")} |`,
      `| **Source price** | ${cny(listing.priceCny)} (¥${listing.priceCny}) |`,
      `| **Acquisition (EUR)** | ${eurPrecise(lc.acquisitionCostEur)} |`,
      `| **Agent service fee** | ${eurPrecise(lc.agentServiceFeeEur)} |`,
      `| **Inspection fee** | ${eur(lc.inspectionFeeEur)} |`,
      `| **CN domestic shipping** | ${eur(lc.domesticShippingCnEur)} |`,
      `| **Insurance** | ${eurPrecise(lc.insuranceFeeEur)} |`,
      `| **International shipping** | ${eur(lc.internationalShippingEur)} |`,
      `| **Customs clearance** | ${eur(lc.customsClearanceEur)} |`,
      `| **Import duty** | ${eurPrecise(lc.importDutyEur)} |`,
      `| **Import VAT (23%)** | ${eurPrecise(lc.importVatEur)} |`,
      `| **Domestic CTT** | ${eur(lc.domesticShippingEur)} |`,
      `| **Total landed cost** | **${eurPrecise(lc.totalLandedCostEur)}** |`,
      `| **Expected resale (EU)** | ${eur(p.expectedResaleEur)} (${p.resaleSource ?? "median"}) |`,
      `| **Resale platform fee** | ${eurPrecise(p.resaleFeeEur)} |`,
      `| **Net resale** | ${eurPrecise(p.netResaleEur)} |`,
      `| **Net profit** | **${eurPrecise(p.netProfitEur)}** |`,
      `| **Margin** | **${p.marginPct.toFixed(1)}%** |`,
      `| **Risk score** | ${l.scam.riskScore}/100 ${l.scam.dropped ? "· ⚠️ auto-dropped" : ""} |`,
      `| **Seller** | ${listing.sellerVerified ? "✅ verified" : "⚠️ unverified"} · ${listing.sellerVerifiedTransactions} txns · ${listing.sellerLocation} |`,
      `| **EU comps** | ${l.euComps.length} listings |`,
      ``,
      listing.href
        ? `**[View on Goofish →](${listing.href})**`
        : `**[Search on Goofish →](https://www.goofish.com/search?q=${encodeURIComponent(n?.standardKey ?? listing.title)}&spm=a21ybx.search.searchInput.0)**`,
      ``,
      `_Generated by Arbitrage Intelligence Engine · ${new Date().toISOString().slice(0, 10)}_`,
    ].join("\n");
    navigator.clipboard.writeText(md);
    toast.success("Markdown copied to clipboard");
  };
  // Expose imperative navigation + copy API for keyboard shortcuts.
  // Placed AFTER copyBlueprint/copyMarkdown so the closures can reference them.
  useImperativeHandle(ref, () => ({
    nextRow: () => {
      const next = Math.min(activeIdx + 1, sorted.length - 1);
      if (next !== activeIdx) {
        setActiveIdx(next);
        // Follow the active row to its page so keyboard nav crosses pages.
        const targetPage = Math.floor(next / PAGE_SIZE) + 1;
        if (targetPage !== effectivePage) setPage(targetPage);
      }
    },
    prevRow: () => {
      const prev = Math.max(activeIdx - 1, 0);
      if (prev !== activeIdx) {
        setActiveIdx(prev);
        const targetPage = Math.floor(prev / PAGE_SIZE) + 1;
        if (targetPage !== effectivePage) setPage(targetPage);
      }
    },
    openActive: () => {
      if (activeIdx >= 0 && activeIdx < sorted.length) {
        setSelected(sorted[activeIdx]);
      } else if (sorted.length > 0) {
        setSelected(sorted[0]);
        setActiveIdx(0);
      }
    },
    copyActiveBlueprint: () => {
      if (activeIdx >= 0 && activeIdx < sorted.length) {
        copyBlueprint(sorted[activeIdx]);
      }
    },
    copyActiveMarkdown: () => {
      if (activeIdx >= 0 && activeIdx < sorted.length) {
        copyMarkdown(sorted[activeIdx]);
      }
    },
  }), [sorted, activeIdx, effectivePage]);
  if (listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          No listings yet
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Run an arbitrage scan to see evaluated leads here.
        </p>
      </div>
    );
  }
  return (
    <TooltipProvider delayDuration={200}>
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{sorted.length}</span>{" "}
          of {listings.length} listings
          {showHidden && (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              (including filtered)
            </span>
          )}
        </p>
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" title="Toggle column visibility">
                <Columns3 className="h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {[
                { key: "costBaseEur", label: "CNY → EUR Landed" },
                { key: "euBaseline", label: "EU Baseline" },
                { key: "netProfit", label: "Net Profit" },
                { key: "margin", label: "Margin" },
                { key: "risk", label: "Risk" },
              ].map((col) => (
                <DropdownMenuItem
                  key={col.key}
                  onClick={() => toggleColumn(col.key)}
                  className="cursor-pointer text-xs"
                >
                  <Checkbox checked={isColVisible(col.key)} className="mr-2" />
                  {col.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox checked={showHidden} onCheckedChange={onToggleHidden} />
            <span className="text-muted-foreground">Show filtered-out</span>
          </label>
        </div>
      </div>
      <div className="rounded-lg border">
        <ScrollArea className="max-h-[640px] overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <SortHead label="Product" k="product" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <TableHead className="text-xs">Condition</TableHead>
                {isColVisible("costBaseEur") && <SortHead label="CNY → EUR Landed" k="costBaseEur" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />}
                {isColVisible("euBaseline") && <SortHead label="EU Baseline" k="euBaseline" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />}
                {isColVisible("netProfit") && <SortHead label="Net Profit" k="netProfit" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />}
                {isColVisible("margin") && <SortHead label="Margin" k="margin" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />}
                {isColVisible("risk") && <SortHead label="Risk" k="risk" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />}
                <TableHead className="text-right text-xs">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((l, idx) => {
                // Defensive: guard against undefined listing (data shape
                // mismatch after re-evaluate or cache deserialization).
                const listing = l?.listing;
                if (!listing) return null;
                const n = listing.normalized;
                const profitGreen = (l?.profit?.netProfitEur ?? 0) > 50;
                const marginGreen = (l?.profit?.marginPct ?? 0) > 30;
                const riskScore = l?.scam?.riskScore ?? 0;
                const riskDropped = l?.scam?.dropped ?? false;
                const riskTone =
                  riskDropped || riskScore >= 60
                    ? "text-rose-600 dark:text-rose-400"
                    : riskScore >= 40
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400";
                const riskBg =
                  riskDropped || riskScore >= 60
                    ? "bg-rose-500"
                    : riskScore >= 40
                      ? "bg-amber-500"
                      : "bg-emerald-500";
                const isActive = pageStart + idx === activeIdx;
                return (
                  <TableRow
                    key={listing.id}
                    className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                      l?.hidden ? "opacity-50" : ""
                    } ${isActive ? "bg-primary/5 ring-1 ring-inset ring-primary/30" : ""}`}
                    onClick={() => setSelected(l)}
                  >
                    <TableCell className="max-w-[300px]">
                      <HoverCard openDelay={400} closeDelay={150}>
                        <HoverCardTrigger asChild>
                          <div className="flex items-start gap-2.5 cursor-pointer">
                            {/* Image thumbnail — uses the first extracted imageUrl.
                                Falls back to a neutral placeholder icon when no
                                image is available or the URL fails to load. */}
                            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md border bg-muted/40">
                              {listing.imageUrls[0] && !imgErrors[listing.id] ? (
                                <img
                                  src={listing.imageUrls[0]}
                                  alt=""
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  onError={() =>
                                    setImgErrors((p) => ({ ...p, [listing.id]: true }))
                                  }
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  <ImageIcon className="h-4 w-4 text-muted-foreground/50" />
                                </div>
                              )}
                              {l?.hidden && (
                                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="truncate text-xs font-semibold cursor-help">
                                    {n?.standardKey ?? displayTitle(listing.title)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <p className="text-xs">{displayTitle(listing.title)}</p>
                                </TooltipContent>
                              </Tooltip>
                              <div className="flex flex-wrap items-center gap-1">
                                {n && n.condition !== "unknown" && (
                                  <Badge
                                    variant="outline"
                                    className={`h-4 px-1.5 text-[10px] leading-none ${CONDITION_COLORS[n.condition]}`}
                                  >
                                    {CONDITION_LABELS[n.condition]}
                                  </Badge>
                                )}
                                {riskDropped && (
                                  <Badge variant="destructive" className="h-4 px-1.5 text-[10px] leading-none">
                                    DROPPED
                                  </Badge>
                                )}
                                {l?.hidden && !riskDropped && (
                                  <Badge variant="outline" className="h-4 px-1.5 text-[10px] leading-none">
                                    FILTERED
                                  </Badge>
                                )}
                                {/* Region version badge — compact in table row */}
                                {n?.regionVersion && n.regionVersion !== "unknown" && (
                                  <Badge
                                    variant="outline"
                                    className={`h-4 px-1.5 text-[10px] leading-none ${
                                      n.regionVersion === "china"
                                        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                        : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    }`}
                                  >
                                    {n.regionVersion === "china" ? "CN" :
                                     n.regionVersion === "international" ? "INT" :
                                     n.regionVersion === "us" ? "US" :
                                     n.regionVersion === "japan" ? "JP" :
                                     n.regionVersion === "korea" ? "KR" : n.regionVersion}
                                  </Badge>
                                )}
                                {/* Lock status badge — compact in table row */}
                                {n?.lockStatus && n.lockStatus !== "unknown" && (
                                  <Badge
                                    variant="outline"
                                    className={`h-4 px-1.5 text-[10px] leading-none ${
                                      n.lockStatus === "unlocked"
                                        ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                        : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                                    }`}
                                    title={
                                      n.lockStatus === "unlocked" ? "Unlocked — safe for PT" :
                                      n.lockStatus === "carrier_locked" ? "Carrier-locked — worthless for PT" :
                                      n.lockStatus === "icloud_locked" ? "iCloud locked — bricked" :
                                      n.lockStatus === "mdm_locked" ? "MDM locked — enterprise-managed" : ""
                                    }
                                  >
                                    {n.lockStatus === "unlocked" ? "Unlocked" :
                                     n.lockStatus === "carrier_locked" ? "Locked" :
                                     n.lockStatus === "icloud_locked" ? "iCloud" :
                                     n.lockStatus === "mdm_locked" ? "MDM" : n.lockStatus}
                                  </Badge>
                                )}
                                {/* Storage badge — show detected storage size */}
                                {n?.storageGB && (
                                  <Badge
                                    variant="outline"
                                    className="h-4 px-1.5 text-[10px] leading-none border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                                  >
                                    {n.storageGB >= 1024 ? `${n.storageGB / 1024}TB` : `${n.storageGB}GB`}
                                  </Badge>
                                )}
                                {listing.imageUrls.length > 0 && (
                                  <span className="text-[9px] text-muted-foreground">
                                    {listing.imageUrls.length} img
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </HoverCardTrigger>
                        <HoverCardContent side="right" align="start" className="w-72 p-3 text-xs shadow-lg">
                          {/* Landed cost breakdown preview */}
                          <div className="mb-2 flex items-center gap-1.5 border-b pb-1.5">
                            <span className="font-semibold text-foreground">
                              {n?.standardKey ?? displayTitle(listing.title)}
                            </span>
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Source price</span>
                              <span className="font-medium tabular-nums">{cny(listing.priceCny)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Acquisition (EUR)</span>
                              <span className="font-medium tabular-nums">{eurPrecise(l?.profit?.landed?.acquisitionCostEur ?? 0)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Freight + customs</span>
                              <span className="font-medium tabular-nums">{eur((l?.profit?.landed?.internationalShippingEur ?? 0) + (l?.profit?.landed?.customsClearanceEur ?? 0))}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Import VAT</span>
                              <span className="font-medium tabular-nums">{eurPrecise(l?.profit?.landed?.importVatEur ?? 0)}</span>
                            </div>
                            <div className="flex justify-between border-t pt-1">
                              <span className="font-semibold">Total landed</span>
                              <span className="font-bold tabular-nums">{eurPrecise(l?.profit?.landed?.totalLandedCostEur ?? 0)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">EU resale (median)</span>
                              <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{eur(l?.profit?.expectedResaleEur ?? 0)}</span>
                            </div>
                            <div className="flex justify-between border-t pt-1">
                              <span className="font-semibold">Net profit</span>
                              <span className={`font-bold tabular-nums ${(l?.profit?.netProfitEur ?? 0) > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                {eurPrecise(l?.profit?.netProfitEur ?? 0)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Risk score</span>
                              <span className={`font-bold tabular-nums ${riskTone}`}>{riskScore}/100</span>
                            </div>
                          </div>
                          <p className="mt-2 text-[10px] text-muted-foreground">Click row for full breakdown →</p>
                        </HoverCardContent>
                      </HoverCard>
                    </TableCell>
                    {/* Condition column — shows condition flags + seller rating */}
                    <TableCell className="max-w-[140px]">
                      <div className="flex flex-wrap gap-1">
                        {n && n.condition !== "unknown" && (
                          <Badge
                            variant="outline"
                            className={`h-4 px-1.5 text-[10px] leading-none ${CONDITION_COLORS[n.condition]}`}
                          >
                            {CONDITION_LABELS[n.condition]}
                          </Badge>
                        )}
                        {listing.conditionFlags?.map((flag) => (
                          <Badge
                            key={flag}
                            variant="outline"
                            className={`h-4 px-1.5 text-[10px] leading-none ${
                              flag === "All Original" || flag === "Original" || flag === "Never Opened"
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                            }`}
                          >
                            {flag}
                          </Badge>
                        ))}
                        {listing.sellerRating !== undefined && (
                          <Badge
                            variant="outline"
                            className={`h-4 px-1.5 text-[10px] leading-none ${
                              listing.sellerRating >= 95
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : listing.sellerRating >= 85
                                  ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                  : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                            }`}
                            title={`Seller positive feedback rate: ${listing.sellerRating}%`}
                          >
                            {listing.sellerRating}%
                          </Badge>
                        )}
                        {listing.imageCount !== undefined && listing.imageCount > 0 && (
                          <span className="text-[9px] text-muted-foreground">
                            {listing.imageCount} photos
                          </span>
                        )}
                      </div>
                    </TableCell>
                    {isColVisible("costBaseEur") && (
                    <TableCell className="text-right">
                      <div className="text-xs font-medium tabular-nums">
                        {cny(listing.priceCny)}
                      </div>
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400 tabular-nums">
                        → {eur(l?.profit?.landed?.acquisitionCostEur ?? 0)} acq
                      </div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        + {eur((l?.profit?.landed?.totalLandedCostEur ?? 0) - (l?.profit?.landed?.acquisitionCostEur ?? 0))} fees
                      </div>
                      <div className="text-[10px] font-semibold tabular-nums">
                        = {eur(l?.profit?.landed?.totalLandedCostEur ?? 0)} landed
                      </div>
                    </TableCell>
                    )}
                    {isColVisible("euBaseline") && (
                    <TableCell className="text-right">
                      <div className="text-xs font-medium tabular-nums">
                        {eur(l?.profit?.expectedResaleEur ?? 0)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {(l?.euComps?.length ?? 0)} comps
                      </div>
                    </TableCell>
                    )}
                    {isColVisible("netProfit") && (
                    <TableCell className="text-right">
                      <div
                        className={`text-sm font-bold tabular-nums ${
                          profitGreen
                            ? "text-emerald-600 dark:text-emerald-400"
                            : (l?.profit?.netProfitEur ?? 0) > 0
                              ? "text-foreground"
                              : "text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {eurPrecise(l?.profit?.netProfitEur ?? 0)}
                      </div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        landed {eur(l?.profit?.landed?.totalLandedCostEur ?? 0)}
                      </div>
                    </TableCell>
                    )}
                    {isColVisible("margin") && (
                    <TableCell className="text-right">
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          marginGreen
                            ? "text-emerald-600 dark:text-emerald-400"
                            : (l?.profit?.marginPct ?? 0) >= 15
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {(l?.profit?.marginPct ?? 0).toFixed(1)}%
                      </span>
                    </TableCell>
                    )}
                    {isColVisible("risk") && (
                    <TableCell className="text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex cursor-help items-center justify-end gap-2">
                            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full ${riskBg}`}
                                style={{ width: `${riskScore}%` }}
                              />
                            </div>
                            <span className={`text-xs font-bold tabular-nums ${riskTone}`}>
                              {riskScore}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs p-3">
                          <div className="space-y-1">
                            <p className="text-[11px] font-semibold">
                              Risk Score: {riskScore}/100
                              {riskDropped ? " (DROPPED)" : riskScore >= 60 ? " — High risk" : riskScore >= 40 ? " — Moderate risk" : " — Low risk"}
                            </p>
                            {l?.scam?.reasons && Array.isArray(l.scam.reasons) && l.scam.reasons.length > 0 ? (
                              <ul className="space-y-0.5">
                                {l.scam.reasons.map((reason, ri) => (
                                  <li key={ri} className="flex gap-1.5 text-[10px] text-muted-foreground">
                                    <span>•</span>
                                    <span>{reason}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-[10px] text-muted-foreground">No risk signals detected.</p>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    )}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(l);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyBlueprint(l);
                          }}
                        >
                          <Copy className="mr-1 h-3.5 w-3.5" />
                          Blueprint
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyMarkdown(l);
                          }}
                          title="Copy as Markdown table"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
        {/* Pagination footer — keeps the table light by showing only PAGE_SIZE
            rows at a time. Prev/Next + page indicator + row count. */}
        {sorted.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              Showing <span className="font-medium text-foreground">{pageStart + 1}–{pageEnd}</span> of{" "}
              <span className="font-medium text-foreground">{sorted.length}</span> listings
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5 text-xs"
                disabled={effectivePage <= 1}
                onClick={() => setPage(1)}
                title="First page"
              >
                «
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5 text-xs"
                disabled={effectivePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹ Prev
              </Button>
              <span className="px-2 text-xs font-medium tabular-nums">
                {effectivePage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5 text-xs"
                disabled={effectivePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next ›
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5 text-xs"
                disabled={effectivePage >= totalPages}
                onClick={() => setPage(totalPages)}
                title="Last page"
              >
                »
              </Button>
            </div>
          </div>
        )}
        {sorted.length > 0 && sorted.length <= PAGE_SIZE && (
          <div className="border-t px-3 py-1.5 text-center text-[11px] text-muted-foreground tabular-nums">
            {sorted.length} {sorted.length === 1 ? "listing" : "listings"}
          </div>
        )}
      </div>
      <ListingDetailDialog
        listing={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </>
    </TooltipProvider>
  );
});
function SortHead({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  align?: "right";
}) {
  const active = sortKey === k;
  return (
    <TableHead className={align === "right" ? "text-right text-xs" : "text-xs"}>
      <button
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-foreground" : "text-muted-foreground"}`}
        onClick={() => onSort(k)}
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        )}
      </button>
    </TableHead>
  );
}
export { ExternalLink };