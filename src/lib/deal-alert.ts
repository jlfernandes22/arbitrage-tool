// Client-side deal-alert preferences + threshold helpers.
//
// A "deal" is a VIABLE lead (not profit-filtered, not scam-hidden) whose
// margin % meets or beats the user's target threshold. When a scan finds
// one, the UI fires a rich toast + (optionally) a desktop notification and a
// distinct three-note alert sound — so the user can leave a scan running in
// a background tab and still catch the good stuff the moment it lands.
//
// Mirrors the localStorage design of notify.ts / sound.ts: preferences are
// read AT USE TIME (never cached in long-lived React state) so poll-loop
// closures can't go stale.

const THRESHOLD_KEY = "arbitrage_deal_alert_threshold";
const ENABLED_KEY = "arbitrage_deal_alert_enabled";
const MOVE_THRESHOLD_KEY = "arbitrage_profit_move_threshold";
const MOVE_ENABLED_KEY = "arbitrage_profit_move_enabled";

export const DEAL_ALERT_THRESHOLD_MIN = 5;
export const DEAL_ALERT_THRESHOLD_MAX = 80;
// A sane default: above the pipeline's 15% viability gate, below the
// "strong deal" band — alerts fire for genuinely interesting leads only.
export const DEAL_ALERT_THRESHOLD_DEFAULT = 20;

// ── Profit-move watch ("buy signal" complement) ────────────────────────────
// A margin deal alert needs a VIABLE lead. But a tracked Goofish listing whose
// estimated net profit JUMPED since the previous scan (seller cut the price,
// or the EU resale baseline rose) is also worth leaving the couch for — even
// when the deal still sits below the target margin. This watch alerts on the
// biggest per-listing profit improvement past a € threshold.
export const PROFIT_MOVE_THRESHOLD_MIN = 1;
export const PROFIT_MOVE_THRESHOLD_MAX = 200;
export const PROFIT_MOVE_THRESHOLD_DEFAULT = 10;

/** Read the user's target margin threshold (%). Persisted, 5–80, default 20. */
export function getDealAlertThreshold(): number {
  if (typeof window === "undefined") return DEAL_ALERT_THRESHOLD_DEFAULT;
  try {
    const raw = localStorage.getItem(THRESHOLD_KEY);
    if (raw === null) return DEAL_ALERT_THRESHOLD_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEAL_ALERT_THRESHOLD_DEFAULT;
    return Math.min(
      DEAL_ALERT_THRESHOLD_MAX,
      Math.max(DEAL_ALERT_THRESHOLD_MIN, Math.round(n * 10) / 10),
    );
  } catch {
    return DEAL_ALERT_THRESHOLD_DEFAULT;
  }
}

export function setDealAlertThreshold(pct: number): void {
  try {
    const clamped = Math.min(
      DEAL_ALERT_THRESHOLD_MAX,
      Math.max(DEAL_ALERT_THRESHOLD_MIN, Math.round(pct * 10) / 10),
    );
    localStorage.setItem(THRESHOLD_KEY, String(clamped));
  } catch {
    // storage unavailable — preference just won't persist
  }
}

/** Deal alerts default ON: they only fire when a real lead beats the bar. */
export function getDealAlertEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setDealAlertEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    // ignore
  }
}

/**
 * Decide whether a finished scan qualifies for a deal alert.
 * Returns the best margin for messaging when it qualifies, else null.
 *
 * Only VIABLE leads count: `shown > 0` guarantees the pipeline kept at least
 * one lead after scam + profitability filters, and `bestMarginPct` is
 * computed over shown listings only (buildSummary excludes hidden ones).
 */
export function evaluateDealAlert(opts: {
  shown: number;
  bestMarginPct: number;
  bestProfitEur: number;
  threshold: number;
  enabled: boolean;
}): { marginPct: number; profitEur: number } | null {
  if (!opts.enabled) return null;
  if (opts.shown <= 0) return null;
  if (!Number.isFinite(opts.bestMarginPct)) return null;
  if (opts.bestMarginPct < opts.threshold) return null;
  return {
    marginPct: opts.bestMarginPct,
    profitEur: Number.isFinite(opts.bestProfitEur) ? opts.bestProfitEur : 0,
  };
}

// ── Profit-move watch preferences (same localStorage pattern) ──────────────

/** Read the per-listing profit-improvement threshold (€). 1–200, default 10. */
export function getProfitMoveThreshold(): number {
  if (typeof window === "undefined") return PROFIT_MOVE_THRESHOLD_DEFAULT;
  try {
    const raw = localStorage.getItem(MOVE_THRESHOLD_KEY);
    if (raw === null) return PROFIT_MOVE_THRESHOLD_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return PROFIT_MOVE_THRESHOLD_DEFAULT;
    return Math.min(
      PROFIT_MOVE_THRESHOLD_MAX,
      Math.max(PROFIT_MOVE_THRESHOLD_MIN, Math.round(n * 10) / 10),
    );
  } catch {
    return PROFIT_MOVE_THRESHOLD_DEFAULT;
  }
}

export function setProfitMoveThreshold(eur: number): void {
  try {
    const clamped = Math.min(
      PROFIT_MOVE_THRESHOLD_MAX,
      Math.max(PROFIT_MOVE_THRESHOLD_MIN, Math.round(eur * 10) / 10),
    );
    localStorage.setItem(MOVE_THRESHOLD_KEY, String(clamped));
  } catch {
    // ignore
  }
}

/** Profit-move watch defaults ON: it only fires on a real ≥threshold jump. */
export function getProfitMoveEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MOVE_ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setProfitMoveEnabled(on: boolean): void {
  try {
    localStorage.setItem(MOVE_ENABLED_KEY, on ? "on" : "off");
  } catch {
    // ignore
  }
}

/**
 * Decide whether a finished scan qualifies for a profit-move alert.
 * Returns the biggest qualifying jump for messaging, else null.
 *
 * Candidates come from the listing-trend API (Δ estimated net profit per
 * Goofish listing vs its most recent prior sighting). Only POSITIVE jumps
 * count — a listing getting WORSE is information, not a buy signal, and it
 * stays visible in the table's Trend column instead of interrupting anyone.
 */
export function evaluateProfitMoveAlert(opts: {
  candidates: Array<{ id: string; title: string; deltaProfitEur: number; profitEur: number }>;
  thresholdEur: number;
  enabled: boolean;
}): { id: string; title: string; deltaProfitEur: number; profitEur: number; jumped: number } | null {
  if (!opts.enabled) return null;
  if (!Array.isArray(opts.candidates) || opts.candidates.length === 0) return null;
  if (!Number.isFinite(opts.thresholdEur) || opts.thresholdEur <= 0) return null;
  let best: { id: string; title: string; deltaProfitEur: number; profitEur: number } | null = null;
  let jumped = 0;
  for (const c of opts.candidates) {
    if (!Number.isFinite(c.deltaProfitEur) || c.deltaProfitEur <= 0) continue;
    if (c.deltaProfitEur < opts.thresholdEur) continue;
    jumped++;
    if (!best || c.deltaProfitEur > best.deltaProfitEur) best = c;
  }
  if (!best) return null;
  return { ...best, jumped };
}
