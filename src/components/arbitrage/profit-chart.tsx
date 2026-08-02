"use client";
import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import type { EvaluatedListing } from "./types";
import { eur } from "./types";
import { useChartTheme } from "./use-chart-theme";
interface ProfitChartProps {
  listings: EvaluatedListing[];
}
interface ChartDatum {
  name: string;
  shortName: string;
  netProfit: number;
  margin: number;
  risk: number;
  hidden: boolean;
}
function shortLabel(n: EvaluatedListing, idx: number): string {
  const key = n.listing.normalized?.standardKey ?? n.listing.title;
  // Shorten: "iPhone 15 Pro 256GB" -> "i15P 256"
  const m = key.match(/iPhone\s*(\d+)\s*(Pro)?/i);
  if (m) {
    const num = m[1];
    const pro = m[2] ? "P" : "";
    const storage = n.listing.normalized?.storageGB ?? "";
    return `i${num}${pro} ${storage}`.trim();
  }
  if (/MacBook/i.test(key)) {
    const storage = n.listing.normalized?.storageGB ?? "";
    return `MB ${storage}`.trim();
  }
  if (/iPad/i.test(key)) {
    const storage = n.listing.normalized?.storageGB ?? "";
    return `iPad ${storage}`.trim();
  }
  if (/PlayStation|PS5/i.test(key)) {
    return `PS5 ${idx + 1}`;
  }
  return `#${idx + 1}`;
}
export function ProfitChart({ listings }: ProfitChartProps) {
  const theme = useChartTheme();
  const data: ChartDatum[] = useMemo(() => {
    return listings.map((l, idx) => ({
      name: l.listing.normalized?.standardKey ?? l.listing.title,
      shortName: shortLabel(l, idx),
      netProfit: Math.round(l.profit.netProfitEur),
      margin: Math.round(l.profit.marginPct),
      risk: l.scam.riskScore,
      hidden: l.hidden,
    }));
  }, [listings]);
  const viable = data.filter((d) => !d.hidden);
  const bestProfit = viable.length > 0 ? Math.max(...viable.map((d) => d.netProfit)) : 0;
  const barColor = (d: ChartDatum) => {
    if (d.hidden) return "#64748b"; // slate-500
    if (d.netProfit > 50) return "#10b981"; // emerald-500
    if (d.netProfit > 0) return "#f59e0b"; // amber-500
    return "#ef4444"; // red-500
  };
  if (listings.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4" />
          Profit Distribution
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {viable.length} viable · best {eur(bestProfit)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
            <XAxis
              dataKey="shortName"
              tick={{ fontSize: 10, fill: theme.axis }}
              tickLine={false}
              axisLine={false}
              angle={-30}
              textAnchor="end"
              height={50}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: theme.axis }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `€${v}`}
            />
            <Tooltip
              cursor={{ fill: theme.cursor, opacity: 0.5 }}
              contentStyle={{
                // Theme-aware: uses the resolved palette so the tooltip is
                // readable over both light cards and dark cards.
                backgroundColor: theme.tooltipBg,
                border: `1px solid ${theme.tooltipBorder}`,
                borderRadius: "8px",
                fontSize: "12px",
                padding: "8px 12px",
                boxShadow: "0 4px 12px -2px rgba(0,0,0,0.18)",
                zIndex: 9999,
              }}
              wrapperStyle={{ zIndex: 9999 }}
              labelStyle={{ color: theme.tooltipLabel, fontWeight: 600, marginBottom: "4px", display: "block" }}
              itemStyle={{ color: theme.tooltipItem }}
              formatter={(value: number, _name, props) => {
                const d = props.payload as ChartDatum;
                return [
                  `${eur(value)} · ${d.margin}% margin · risk ${d.risk}${d.hidden ? " · filtered" : ""}`,
                  "Net Profit",
                ];
              }}
              labelFormatter={(_, payload) => {
                const d = payload?.[0]?.payload as ChartDatum | undefined;
                return d?.name ?? "";
              }}
            />
            <ReferenceLine y={0} stroke={theme.referenceLine} strokeWidth={1} />
            <Bar dataKey="netProfit" radius={[3, 3, 0, 0]} maxBarSize={48}>
              {data.map((d, i) => (
                <Cell key={i} fill={barColor(d)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <Legend color="#10b981" label=">€50 profit" />
          <Legend color="#f59e0b" label="0–€50" />
          <Legend color="#ef4444" label="loss" />
          <Legend color="#64748b" label="filtered" />
        </div>
      </CardContent>
    </Card>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}