"use client";
import { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { History, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { eur } from "./types";
import { useChartTheme } from "./use-chart-theme";

interface HistoryTaskSummary {
  bestProfitEur: number;
  bestMarginPct: number;
  total: number;
  shown: number;
}

interface HistoryTask {
  task_id: string;
  query: string;
  category: string;
  status: string;
  started_at: string;
  summary: HistoryTaskSummary | null;
}

interface TrendDatum {
  ts: number;
  label: string;
  shortLabel: string;
  bestProfit: number;
  bestMargin: number;
  viable: number;
  total: number;
  query: string;
}

interface ProfitTrendChartProps {
  // If omitted, the component fetches from /api/tasks/list itself.
  tasks?: HistoryTask[];
  refreshKey?: number;
}

function formatTimeLabel(iso: string): { label: string; shortLabel: string } {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const md = d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
  return { label: `${md} ${hm}`, shortLabel: hm };
}

export function ProfitTrendChart({ tasks, refreshKey }: ProfitTrendChartProps) {
  const theme = useChartTheme();
  const [fetched, setFetched] = useState<HistoryTask[]>([]);

  useEffect(() => {
    if (tasks) return; // caller provided data
    let cancelled = false;
    fetch("/api/tasks/list", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setFetched((Array.isArray(data.tasks) ? data.tasks : []) as HistoryTask[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tasks, refreshKey]);

  const source = tasks ?? fetched;

  const data: TrendDatum[] = useMemo(() => {
    // Only completed tasks with a summary contribute to the trend.
    const done = source
      .filter((t) => t.status === "done" && t.summary)
      .sort(
        (a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
      );
    // Take the last 20 completed scans for a readable chart.
    const recent = done.slice(-20);
    return recent.map((t) => {
      const { label, shortLabel } = formatTimeLabel(t.started_at);
      return {
        ts: new Date(t.started_at).getTime(),
        label,
        shortLabel,
        bestProfit: Math.round(t.summary!.bestProfitEur),
        bestMargin: Math.round(t.summary!.bestMarginPct),
        viable: t.summary!.shown,
        total: t.summary!.total,
        query: t.query,
      };
    });
  }, [source]);

  if (data.length < 2) {
    // Need at least 2 points to draw a meaningful trend line.
    return null;
  }

  const profits = data.map((d) => d.bestProfit);
  const maxProfit = Math.max(...profits);
  const minProfit = Math.min(...profits);
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const delta = last.bestProfit - prev.bestProfit;
  const trendIcon =
    delta > 5 ? TrendingUp : delta < -5 ? TrendingDown : Minus;
  const trendTone =
    delta > 5
      ? "text-emerald-600 dark:text-emerald-400"
      : delta < -5
        ? "text-rose-600 dark:text-rose-400"
        : "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4" />
          Profit Trend Across Scans
          <span className="ml-auto flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className={trendTone}>
                {(() => {
                  const Icon = trendIcon;
                  return <Icon className="h-3.5 w-3.5" />;
                })()}
              </span>
              <span className={trendTone}>
                {delta > 0 ? "+" : ""}
                {eur(delta)}
              </span>
            </span>
            <span>·</span>
            <span>{data.length} scans</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
          >
            <defs>
              <linearGradient id="profitTrendGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
            <XAxis
              dataKey="shortLabel"
              tick={{ fontSize: 10, fill: theme.axis }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              tick={{ fontSize: 10, fill: theme.axis }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `€${v}`}
              width={48}
            />
            <Tooltip
              contentStyle={{
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
              labelFormatter={(_: unknown, payload: unknown) => {
                // Cast payload to the structural shape we actually use.
                // Recharts' labelFormatter generic (`Payload<ValueType, NameType>[]`)
                // doesn't match the Tooltip's `<number, string>` instantiation,
                // which trips a TS2769 overload error. Typing the param as
                // `unknown` and narrowing via cast is type-safe and avoids the
                // recharts generic mismatch.
                const arr = payload as Array<{ payload?: TrendDatum }>;
                const d = arr?.[0]?.payload;
                return d ? `${d.label} · ${d.query}` : "";
              }}
              formatter={(value: number, name: string) => {
                if (name === "bestProfit") {
                  return [eur(value), "Best profit"] as [string, string];
                }
                return [String(value), String(name)] as [string, string];
              }}
            />
            <ReferenceLine y={0} stroke={theme.referenceLine} strokeWidth={1} />
            <Area
              type="monotone"
              dataKey="bestProfit"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#profitTrendGradient)"
              dot={{ r: 3, fill: "#10b981", strokeWidth: 0 }}
              activeDot={{ r: 5, fill: "#10b981", stroke: "#fff", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
          <span>
            range{" "}
            <span className="font-medium text-foreground">{eur(minProfit)}</span>
            {" — "}
            <span className="font-medium text-foreground">{eur(maxProfit)}</span>
          </span>
          <span>
            latest{" "}
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {eur(last.bestProfit)}
            </span>{" "}
            ({last.bestMargin}% margin)
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
