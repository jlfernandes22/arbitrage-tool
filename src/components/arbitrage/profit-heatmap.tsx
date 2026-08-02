"use client";
import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Grid3x3 } from "lucide-react";
import type { EvaluatedListing, Condition } from "./types";
import { eur } from "./types";

interface ProfitHeatmapProps {
  listings: EvaluatedListing[];
  // Active cell filter: "family__condition" or null. When set, the cell is
  // highlighted and the parent filters the results table to that model+condition.
  activeCell?: string | null;
  onCellClick?: (cellKey: string | null) => void;
}

// Condition display order (best → worst)
const CONDITIONS: Condition[] = ["new", "open_box", "excellent", "very_good", "good", "fair", "unknown"];
const CONDITION_SHORT: Record<Condition, string> = {
  new: "New",
  open_box: "OpenBox",
  excellent: "Exc.",
  very_good: "V.Good",
  good: "Good",
  fair: "Fair",
  unknown: "Used",
};

// Extract a model family from the standardKey (e.g. "iPhone 15 Pro 256GB" → "iPhone 15 Pro").
// Exported so page.tsx can apply the same family extraction for cell-click filtering.
export function extractFamily(standardKey: string | undefined): string {
  if (!standardKey) return "Unknown";
  // iPhone: "iPhone 15 Pro 256GB" → "iPhone 15 Pro"
  const iphoneMatch = standardKey.match(/^(iPhone\s*\d+\s*(?:Pro Max|Pro|Plus|e)?)/i);
  if (iphoneMatch) return iphoneMatch[1].trim();
  // MacBook: "MacBook Air M2 13 256GB" → "MacBook Air M2"
  const macMatch = standardKey.match(/^(MacBook\s+(?:Air|Pro)\s+M\d)/i);
  if (macMatch) return macMatch[1].trim();
  // iPad: "iPad Air 5 64GB" → "iPad Air 5"
  const ipadMatch = standardKey.match(/^(iPad\s+(?:Air|Pro|mini)?\s*\d*)/i);
  if (ipadMatch) return ipadMatch[1].trim();
  // PS5: "PlayStation 5 Slim Disc" → "PS5 Slim"
  const ps5Match = standardKey.match(/^(?:PlayStation\s*5|PS5)\s+(Slim|Standard)/i);
  if (ps5Match) return `PS5 ${ps5Match[1]}`;
  if (/PlayStation|PS5/i.test(standardKey)) return "PS5";
  // Fallback: first 2 words
  return standardKey.split(/\s+/).slice(0, 2).join(" ");
}

interface HeatmapCell {
  family: string;
  condition: Condition;
  medianProfit: number;
  count: number;
  avgMargin: number;
}

// Color scale for profit cells. Rose (loss) → amber (low) → emerald (high).
function profitColor(profit: number, hasData: boolean): { bg: string; text: string } {
  if (!hasData) return { bg: "bg-muted/30", text: "text-muted-foreground/40" };
  if (profit < 0) return { bg: "bg-rose-500/70", text: "text-white" };
  if (profit < 30) return { bg: "bg-rose-400/50", text: "text-rose-950 dark:text-white" };
  if (profit < 60) return { bg: "bg-amber-400/60", text: "text-amber-950 dark:text-white" };
  if (profit < 100) return { bg: "bg-emerald-400/60", text: "text-emerald-950 dark:text-white" };
  return { bg: "bg-emerald-500/80", text: "text-white" };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function ProfitHeatmap({ listings, activeCell = null, onCellClick }: ProfitHeatmapProps) {
  // Defensive guard: ensure listings is always an array.
  const safe = Array.isArray(listings) ? listings : [];
  const { families, cells, maxProfit, minProfit } = useMemo(() => {
    // Group listings by family × condition
    const grid = new Map<string, EvaluatedListing[]>();
    const famSet = new Set<string>();
    for (const l of safe) {
      const family = extractFamily(l.listing.normalized?.standardKey);
      const cond = l.listing.normalized?.condition ?? "unknown";
      famSet.add(family);
      const key = `${family}__${cond}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(l);
    }
    const famArr = Array.from(famSet).sort();
    const cells: HeatmapCell[] = [];
    let maxP = -Infinity;
    let minP = Infinity;
    for (const family of famArr) {
      for (const cond of CONDITIONS) {
        const group = grid.get(`${family}__${cond}`) ?? [];
        if (group.length === 0) {
          cells.push({ family, condition: cond, medianProfit: 0, count: 0, avgMargin: 0 });
          continue;
        }
        const profits = group.map((g) => g.profit.netProfitEur);
        const med = median(profits);
        const avgMar = group.reduce((s, g) => s + g.profit.marginPct, 0) / group.length;
        cells.push({ family, condition: cond, medianProfit: med, count: group.length, avgMargin: avgMar });
        if (med > maxP) maxP = med;
        if (med < minP) minP = med;
      }
    }
    return { families: famArr, cells, maxProfit: maxP === -Infinity ? 0 : maxP, minProfit: minP === Infinity ? 0 : minP };
  }, [safe]);

  if (families.length === 0) return null;

  // Get cell by family + condition
  const getCell = (family: string, cond: Condition): HeatmapCell =>
    cells.find((c) => c.family === family && c.condition === cond)!;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Grid3x3 className="h-4 w-4" />
          Profitability Heatmap
          <span className="ml-auto flex items-center gap-3 text-xs font-normal text-muted-foreground">
            <span>range {eur(Math.round(minProfit))} – {eur(Math.round(maxProfit))}</span>
            <span>·</span>
            <span>{families.length} models × {CONDITIONS.length} conditions</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-background p-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Model
                </th>
                {CONDITIONS.map((c) => (
                  <th key={c} className="p-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {CONDITION_SHORT[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {families.map((family) => (
                <tr key={family}>
                  <td className="sticky left-0 z-10 bg-background p-1.5 text-xs font-medium">
                    {family}
                  </td>
                  {CONDITIONS.map((cond) => {
                    const cell = getCell(family, cond);
                    const { bg, text } = profitColor(cell.medianProfit, cell.count > 0);
                    const cellKey = `${family}__${cond}`;
                    const isActive = activeCell === cellKey;
                    const isClickable = !!onCellClick && cell.count > 0;
                    return (
                      <td key={cond} className="p-0.5">
                        <div
                          onClick={() => {
                            if (!onCellClick || cell.count === 0) return;
                            onCellClick(isActive ? null : cellKey);
                          }}
                          className={`group relative flex h-11 min-w-[64px] flex-col items-center justify-center rounded-md ${bg} ${text} transition-all ${
                            isClickable ? "cursor-pointer hover:scale-105 hover:shadow-md" : "cursor-default"
                          } ${isActive ? "ring-2 ring-inset ring-emerald-500 ring-offset-1 ring-offset-background scale-105 shadow-lg z-10" : ""}`}
                          title={cell.count > 0 ? `${family} · ${CONDITION_SHORT[cond]}\nMedian profit: ${eur(Math.round(cell.medianProfit))}\nAvg margin: ${cell.avgMargin.toFixed(0)}%\nListings: ${cell.count}${isClickable ? "\nClick to filter table" : ""}` : `${family} · ${CONDITION_SHORT[cond]}\nNo data`}
                        >
                          {cell.count > 0 ? (
                            <>
                              <span className="text-[11px] font-bold tabular-nums leading-none">
                                {eur(Math.round(cell.medianProfit))}
                              </span>
                              <span className="text-[9px] leading-none opacity-80">
                                {cell.count}× · {cell.avgMargin.toFixed(0)}%
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] opacity-40">—</span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-medium">Profit scale:</span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-rose-500/70" /> loss
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-amber-400/60" /> €0–60
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-emerald-400/60" /> €60–100
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-emerald-500/80" /> &gt;€100
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-muted/30 border" /> no data
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
