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
  Percent,
  Trophy,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  // When set, the numeric value animates with a count-up on change
  // (rAF ease-out). `format` re-renders the animated number.
  animate?: { target: number; format: (n: number) => string };
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

/**
 * Count-up animation for stat values. Runs a ~650ms ease-out rAF tween from
 * the PREVIOUS value to the new one whenever `target` changes (scan completes,
 * different scan selected, filter toggles). Reduced-motion users get the
 * instant value. SSR-safe: renders the plain target on the first paint.
 * (All setState calls happen inside rAF callbacks — never synchronously in
 * the effect body — per react-hooks/set-state-in-effect.)
 */
function useCountUp(target: number, enabled: boolean): number {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!enabled || reduced || from === target || !Number.isFinite(target)) {
      // No tween wanted — land on the final value next frame.
      const raf = requestAnimationFrame(() => setDisplay(target));
      return () => cancelAnimationFrame(raf);
    }
    let raf = 0;
    const t0 = performance.now();
    const DURATION = 650;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / DURATION);
      const eased = 1 - Math.pow(1 - p, 3); // cubic ease-out
      setDisplay(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);
  return display;
}

export function SummaryCards({ summary, activeFilter = null, onFilterChange }: SummaryCardsProps) {
  const viablePct =
    summary.total > 0 ? Math.round((summary.shown / summary.total) * 100) : 0;
  const cards: CardConfig[] = [
    {
      title: "Listings Scanned",
      value: summary.total.toString(),
      animate: { target: summary.total, format: (n) => String(Math.round(n)) },
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
      animate: { target: summary.shown, format: (n) => String(Math.round(n)) },
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
      animate: { target: summary.hiddenScam, format: (n) => String(Math.round(n)) },
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
      animate: { target: summary.hiddenProfit, format: (n) => String(Math.round(n)) },
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
      animate: {
        target: summary.avgMarginPct,
        format: (n) => `${Math.round(n)}%`,
      },
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
      animate: {
        target: summary.bestProfitEur,
        format: (n) => eur(Math.round(n)),
      },
      icon: Trophy,
      iconBg: "bg-emerald-100 dark:bg-emerald-950",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      valueTone: "text-emerald-600 dark:text-emerald-400",
      sub: "Top lead",
      // Defensive round: persisted summaries from before the bestMarginPct
      // rounding fix contain raw floats like 620.321374151544.
      trend: `${Math.round(summary.bestMarginPct * 10) / 10}% margin`,
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
          <StatCardView
            key={c.title}
            card={c}
            isActive={!!isActive}
            isClickable={isClickable}
            onClick={() => handleCardClick(c)}
          />
        );
      })}
    </div>
  );
}

/** One animated stat card. Hook lives here so each card tweens independently. */
function StatCardView({
  card,
  isActive,
  isClickable,
  onClick,
}: {
  card: CardConfig;
  isActive: boolean;
  isClickable: boolean;
  onClick: () => void;
}) {
  const Icon = card.icon;
  const animated = useCountUp(card.animate?.target ?? 0, !!card.animate);
  const shown = card.animate ? card.animate.format(animated) : card.value;
  return (
    <Card
      onClick={onClick}
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
        className={`absolute inset-x-0 top-0 h-0.5 ${card.iconBg} transition-opacity ${
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      />
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.iconBg} ${card.iconColor} transition-transform duration-200 ${
              isClickable ? "group-hover:scale-110" : ""
            }`}
          >
            <Icon className="h-4.5 w-4.5" strokeWidth={2.2} />
          </div>
          {card.trend && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none ${
                card.trendTone === "up"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : card.trendTone === "down"
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {card.trend}
            </span>
          )}
        </div>
        <div
          className={`mt-3 text-2xl font-bold tabular-nums tracking-tight ${card.valueTone}`}
        >
          {shown}
        </div>
        <div className="mt-0.5 flex flex-col">
          <span className="text-[11px] font-medium text-foreground/80">
            {card.title}
          </span>
          <span className="text-[10px] text-muted-foreground">{card.sub}</span>
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
}
