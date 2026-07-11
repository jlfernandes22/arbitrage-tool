"use client";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Package,
  Eye,
  EyeOff,
  ShieldAlert,
  TrendingUp,
  Percent,
  Trophy,
} from "lucide-react";
import type { TaskSummary } from "./types";
import { eur } from "./types";
import type { LucideIcon } from "lucide-react";

// Filter keys that the results table understands. Clicking a card sets the
// active filter; clicking the same card again clears it.
export type CardFilter = "all" | "viable" | "scam" | "profit" | null;

interface SummaryCardsProps {
  summary: TaskSummary;
  activeFilter?: CardFilter;
  onFilterChange?: (filter: CardFilter) => void;
}

interface CardConfig {
  title: string;
  value: string;
  icon: LucideIcon;
  // Tailwind classes for the icon badge background + icon color
  iconBg: string;
  iconColor: string;
  // Tailwind class for the value text color
  valueTone: string;
  sub: string;
  // Optional trend indicator (e.g. "+12%", "top lead")
  trend?: string;
  trendTone?: "up" | "down" | "neutral";
  // Filter key this card activates when clicked. Omit for non-filterable cards.
  filter?: Exclude<CardFilter, null>;
}

export function SummaryCards({ summary, activeFilter = null, onFilterChange }: SummaryCardsProps) {
  const viablePct =
    summary.total > 0 ? Math.round((summary.shown / summary.total) * 100) : 0;
  const cards: CardConfig[] = [
    {
      title: "Listings Scanned",
      value: summary.total.toString(),
      icon: Package,
      iconBg: "bg-slate-100 dark:bg-slate-800",
      iconColor: "text-slate-600 dark:text-slate-300",
      valueTone: "text-foreground",
      sub: "Goofish raw",
      trend: `${viablePct}% viable`,
      trendTone: viablePct >= 20 ? "up" : "neutral",
      filter: "all",
    },
    {
      title: "Viable Leads",
      value: summary.shown.toString(),
      icon: Eye,
      iconBg: "bg-emerald-100 dark:bg-emerald-950",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      valueTone: "text-emerald-600 dark:text-emerald-400",
      sub: "Passed all filters",
      filter: "viable",
    },
    {
      title: "Hidden (Scam)",
      value: summary.hiddenScam.toString(),
      icon: ShieldAlert,
      iconBg: "bg-rose-100 dark:bg-rose-950",
      iconColor: "text-rose-600 dark:text-rose-400",
      valueTone: "text-rose-600 dark:text-rose-400",
      sub: "Risk > threshold",
      filter: "scam",
    },
    {
      title: "Hidden (Profit)",
      value: summary.hiddenProfit.toString(),
      icon: EyeOff,
      iconBg: "bg-amber-100 dark:bg-amber-950",
      iconColor: "text-amber-600 dark:text-amber-400",
      valueTone: "text-amber-600 dark:text-amber-400",
      sub: "Margin/profit too low",
      filter: "profit",
    },
    {
      title: "Avg Margin",
      value: `${summary.avgMarginPct}%`,
      icon: Percent,
      iconBg:
        summary.avgMarginPct >= 30
          ? "bg-emerald-100 dark:bg-emerald-950"
          : summary.avgMarginPct >= 15
            ? "bg-amber-100 dark:bg-amber-950"
            : "bg-rose-100 dark:bg-rose-950",
      iconColor:
        summary.avgMarginPct >= 30
          ? "text-emerald-600 dark:text-emerald-400"
          : summary.avgMarginPct >= 15
            ? "text-amber-600 dark:text-amber-400"
            : "text-rose-600 dark:text-rose-400",
      valueTone:
        summary.avgMarginPct >= 30
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-foreground",
      sub: "Shown leads",
      // No filter — this is a metric, not a category
    },
    {
      title: "Best Net Profit",
      value: eur(summary.bestProfitEur),
      icon: Trophy,
      iconBg: "bg-emerald-100 dark:bg-emerald-950",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      valueTone: "text-emerald-600 dark:text-emerald-400",
      sub: "Top lead",
      trend: `${summary.bestMarginPct}% margin`,
      trendTone: "up",
      // No filter — this is a metric, not a category
    },
  ];
  const handleCardClick = (c: CardConfig) => {
    if (!onFilterChange || !c.filter) return;
    // Toggle: clicking the active filter clears it.
    if (activeFilter === c.filter) {
      onFilterChange(null);
    } else {
      onFilterChange(c.filter);
    }
  };
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => {
        const Icon = c.icon;
        const isActive = c.filter && activeFilter === c.filter;
        const isClickable = !!onFilterChange && !!c.filter;
        return (
          <Card
            key={c.title}
            onClick={() => handleCardClick(c)}
            className={`group relative overflow-hidden border-border/60 transition-all duration-200 ${
              isClickable ? "cursor-pointer hover:-translate-y-0.5 hover:border-border hover:shadow-md" : ""
            } ${
              isActive
                ? "border-emerald-400 ring-1 ring-inset ring-emerald-400/40 shadow-md"
                : ""
            }`}
          >
            {/* Subtle accent bar at the top — appears on hover or when active */}
            <div
              className={`absolute inset-x-0 top-0 h-0.5 ${c.iconBg} transition-opacity ${
                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            />
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.iconBg} ${c.iconColor} transition-transform duration-200 ${
                    isClickable ? "group-hover:scale-110" : ""
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" strokeWidth={2.2} />
                </div>
                {c.trend && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none ${
                      c.trendTone === "up"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : c.trendTone === "down"
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {c.trend}
                  </span>
                )}
              </div>
              <div
                className={`mt-3 text-2xl font-bold tabular-nums tracking-tight ${c.valueTone}`}
              >
                {c.value}
              </div>
              <div className="mt-0.5 flex flex-col">
                <span className="text-[11px] font-medium text-foreground/80">
                  {c.title}
                </span>
                <span className="text-[10px] text-muted-foreground">{c.sub}</span>
              </div>
              {/* Active filter indicator */}
              {isActive && (
                <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function PipelineIcon() {
  return <TrendingUp className="h-4 w-4" />;
}
