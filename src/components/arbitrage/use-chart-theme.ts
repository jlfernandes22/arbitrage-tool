"use client";
// use-chart-theme.ts
// Shared hook that returns theme-aware colors for Recharts components.
//
// Recharts renders SVG attributes (`stroke`, `fill`) which cannot reliably
// consume Tailwind CSS variables (`var(--foreground)`) across all browsers.
// Instead we read the resolved theme via `next-themes` and return a palette
// object keyed by the active theme. Components pick from this palette so the
// chart is readable in both light and dark mode.
//
// Previously the charts hardcoded light-mode colors (`#e5e5e5` grid,
// `#888` axis labels, `rgba(255,255,255,0.98)` tooltip background), which
// made them nearly unreadable in dark mode — washed-out grid, dim labels,
// and a white tooltip box floating over a dark card.
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export interface ChartTheme {
  grid: string; // CartesianGrid stroke
  axis: string; // XAxis/YAxis tick fill
  tooltipBg: string; // Tooltip contentStyle backgroundColor
  tooltipBorder: string; // Tooltip contentStyle border color
  tooltipLabel: string; // Tooltip labelStyle color
  tooltipItem: string; // Tooltip itemStyle color
  referenceLine: string; // ReferenceLine stroke
  cursor: string; // Tooltip cursor fill
}

const LIGHT: ChartTheme = {
  grid: "#e5e5e5",
  axis: "#888888",
  tooltipBg: "rgba(255, 255, 255, 0.98)",
  tooltipBorder: "oklch(0.9 0 0)",
  tooltipLabel: "#111111",
  tooltipItem: "#333333",
  referenceLine: "#e5e5e5",
  cursor: "oklch(0.97 0 0)",
};

const DARK: ChartTheme = {
  grid: "oklch(0.3 0 0)", // subtle dark grid line
  axis: "oklch(0.65 0 0)", // dim but readable axis label
  tooltipBg: "oklch(0.21 0 0)", // matches dark card surface
  tooltipBorder: "oklch(0.35 0 0)",
  tooltipLabel: "oklch(0.95 0 0)",
  tooltipItem: "oklch(0.8 0 0)",
  referenceLine: "oklch(0.4 0 0)",
  cursor: "oklch(0.3 0 0)",
};

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  // `resolvedTheme` is undefined on first render (SSR). We track a mounted
  // flag so the chart always renders with a deterministic palette on the
  // server and only switches to the theme-specific palette after hydration.
  // Uses queueMicrotask (same pattern as use-saved-queries.ts) to avoid the
  // react-hooks/set-state-in-effect lint rule which flags synchronous
  // setState calls in effect bodies as cascading-render sources.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);
  if (!mounted) return LIGHT;
  return resolvedTheme === "dark" ? DARK : LIGHT;
}
