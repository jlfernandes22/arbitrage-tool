"use client";
// ScraperStatusPanel — per-site outcome breakdown for the last scan.
// Shows every scraper (Goofish, OLX, Vinted, KuantoKusta, Amazon) with an
// at-a-glance status chip, the number of results it produced, how long it
// took, and (on failure) the precise reason so debugging is trivial.
//
// Plus a RELIABILITY strip (per-site success rate over the last N scans,
// fetched from /api/tasks/scraper-health) so flaky sites are visible over
// time, and a one-click "Copy debug report" button that puts a markdown
// summary on the clipboard for bug reports.
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  XCircle,
  MinusCircle,
  ChevronDown,
  Globe,
  Activity,
  ClipboardCopy,
  Check,
  RotateCcw,
  Loader2,
  Timer,
  HeartPulse,
  MemoryStick,
  RefreshCw,
} from "lucide-react";
import type { ScraperStatus } from "./types";

const STATUS_META: Record<
  ScraperStatus["status"],
  { label: string; icon: typeof CheckCircle2; chipClass: string; rowGlow: string; help: string }
> = {
  ok: {
    label: "OK",
    icon: CheckCircle2,
    chipClass: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
    rowGlow: "border-l-emerald-500",
    help: "Scraper completed and returned results.",
  },
  empty: {
    label: "0 results",
    icon: AlertTriangle,
    chipClass: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
    rowGlow: "border-l-amber-500",
    help: "Scraper completed but returned no results for this query.",
  },
  blocked: {
    label: "Blocked",
    icon: ShieldAlert,
    chipClass: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800",
    rowGlow: "border-l-orange-500",
    help: "The site's anti-bot system (Baxia / Cloudflare / Akamai / Datadome) denied the fetch. Usually network/IP-level — retry from another network or use Manual Paste.",
  },
  error: {
    label: "Failed",
    icon: XCircle,
    chipClass: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800",
    rowGlow: "border-l-red-500",
    help: "The scraper crashed or timed out (network error, page change, parse failure).",
  },
  skipped: {
    label: "Skipped",
    icon: MinusCircle,
    chipClass: "bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-400 dark:border-zinc-700",
    rowGlow: "border-l-zinc-400",
    help: "Disabled by your configuration (skip toggles).",
  },
};

const SITE_FLAGS: Record<ScraperStatus["site"], string> = {
  goofish: "🇨🇳",
  olx: "🇵🇹",
  vinted: "🇵🇹",
  kuantokusta: "🇵🇹",
  amazon: "🇪🇸",
};

interface SiteHealth {
  site: string;
  scans: number;
  ok: number;
  blocked: number;
  error: number;
  empty: number;
  skipped: number;
  successRate: number | null;
  avgResults: number;
  lastOkScansAgo: number | null;
  lastStatus: string | null;
  lastDetail: string | null;
}

interface SystemHealth {
  timestamp: string;
  uptimeSec: number;
  scanActive: boolean;
  browsers: { liveChildren: number };
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  janitor: {
    sweeps: number;
    lastSweepAgoSec: number | null;
    reapedTotal: number;
    lastReapedAgoSec: number | null;
    lastReapedCount: number;
  };
}

function fmtUptime(sec: number): string {
  if (sec < 90) return `${sec}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

function rateColor(rate: number | null): string {
  if (rate === null) return "bg-zinc-300 dark:bg-zinc-700";
  if (rate >= 80) return "bg-emerald-500";
  if (rate >= 50) return "bg-amber-500";
  if (rate > 0) return "bg-orange-500";
  return "bg-red-500";
}

/**
 * Goofish Baxia rate-limit detection: when the detail text shows the search
 * was CAPTCHA/login-walled, rapid re-scanning makes it WORSE (each attempt
 * with a flagged fingerprint extends the block). The chip tells the user to
 * wait ~10 minutes instead of hammering the site.
 */
function isBaxiaRateLimited(s: ScraperStatus): boolean {
  if (s.site !== "goofish") return false;
  if (s.status !== "blocked" && s.status !== "empty") return false;
  return /baxia|captcha|login.wall|no results page|anti-bot/i.test(
    s.detail ?? "",
  );
}

export function ScraperStatusPanel({
  statuses,
  onRetrySite,
  retryingSite,
}: {
  statuses: ScraperStatus[];
  /** When provided, failed non-Goofish cards render a per-site retry button. */
  onRetrySite?: (site: ScraperStatus["site"]) => void;
  /** Site currently being retried (spinner state). */
  retryingSite?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<SiteHealth[] | null>(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [sysHealth, setSysHealth] = useState<SystemHealth | null>(null);
  const [sysRefreshing, setSysRefreshing] = useState(false);

  // System-health poll: browsers alive, janitor counters, process memory.
  // Cheap local endpoint; refresh every 30s while mounted so the strip
  // reflects the post-scan janitor audit without a manual reload.
  const fetchSysHealth = useCallback(async () => {
    setSysRefreshing(true);
    try {
      const r = await fetch("/api/system/health", { cache: "no-store" });
      if (r.ok) setSysHealth((await r.json()) as SystemHealth);
    } catch {
      // best-effort — the strip just keeps its last known values
    } finally {
      setSysRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void fetchSysHealth();
    const t = setInterval(() => void fetchSysHealth(), 30_000);
    return () => clearInterval(t);
  }, [fetchSysHealth]);

  // Load per-site reliability once the panel mounts (after a scan result).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/tasks/scraper-health?limit=20", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.sites) setHealth(d.sites as SiteHealth[]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const copyReport = useCallback(async () => {
    const lines: string[] = [
      "## Scraper debug report",
      "",
      ...statuses.map((s) => {
        const secs = s.durationMs ? ` (${(s.durationMs / 1000).toFixed(1)}s)` : "";
        return `- **${s.label}** [${s.site}]: ${s.status.toUpperCase()} — ${s.count} results${secs}${s.detail ? `\n  - reason: ${s.detail}` : ""}`;
      }),
    ];
    if (health) {
      lines.push("", "## Reliability (last 20 scans)", "");
      for (const h of health) {
        lines.push(`- **${h.site}**: ${h.successRate === null ? "no data" : `${h.successRate}% success`} (${h.ok}/${h.scans - h.skipped} scans, avg ${h.avgResults} results)${h.lastDetail ? `\n  - last reason: ${h.lastDetail}` : ""}`);
      }
    }
    if (sysHealth) {
      lines.push("", "## System health", "");
      lines.push(`- uptime: ${fmtUptime(sysHealth.uptimeSec)} · scan active: ${sysHealth.scanActive ? "yes" : "no"}`);
      lines.push(`- browsers alive: ${sysHealth.browsers.liveChildren} · janitor: ${sysHealth.janitor.sweeps} sweeps, ${sysHealth.janitor.reapedTotal} reaped`);
      lines.push(`- memory: RSS ${sysHealth.memory.rssMb} MB / heap ${sysHealth.memory.heapUsedMb} MB`);
    }
    const text = lines.join("\n");
    // navigator.clipboard is unavailable/denied in some contexts (insecure
    // origins, permission policies) — fall back to the legacy execCommand
    // path with a temporary textarea before giving up.
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      } catch {
        return; // both paths failed — keep the button as-is
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [statuses, health, sysHealth]);

  if (!Array.isArray(statuses) || statuses.length === 0) return null;
  const okCount = statuses.filter((s) => s.status === "ok").length;
  const failCount = statuses.filter((s) => ["blocked", "error", "empty"].includes(s.status)).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md">
      <CollapsibleTrigger asChild>
        <button className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Globe className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden />
            Scraper Results
            <span className="text-xs font-normal text-muted-foreground">
              {okCount}/{statuses.length} sites returned data
            </span>
          </span>
          <span className="flex items-center gap-2">
            {failCount > 0 && (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {failCount} without results
              </Badge>
            )}
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <TooltipProvider delayDuration={150}>
          <div className="grid grid-cols-1 gap-2 px-4 pb-2 sm:grid-cols-2 lg:grid-cols-5 sm:pb-4">
            {statuses.map((s) => {
              const meta = STATUS_META[s.status] ?? STATUS_META.empty;
              const Icon = meta.icon;
              const secs = s.durationMs ? (s.durationMs / 1000).toFixed(1) : null;
              return (
                <Tooltip key={s.site}>
                  <TooltipTrigger asChild>
                    <div className="transition-transform duration-150 hover:-translate-y-0.5">
                      <div
                        className={`flex min-h-[92px] cursor-default flex-col gap-1.5 rounded-lg border border-y border-r bg-background/60 p-3 border-l-4 ${meta.rowGlow} transition-colors hover:bg-background`}
                        aria-label={`${s.label}: ${meta.label}, ${s.count} results`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="flex items-center gap-1.5 truncate text-xs font-medium">
                            <span aria-hidden>{SITE_FLAGS[s.site] ?? "🌐"}</span>
                            <span className="truncate">{s.label}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {onRetrySite && s.site !== "goofish" &&
                              (s.status === "blocked" || s.status === "error" || s.status === "empty") && (
                              <button
                                type="button"
                                aria-label={`Retry ${s.label} only`}
                                title={`Re-scrape just ${s.label} and merge results (Goofish untouched)`}
                                disabled={retryingSite != null}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  onRetrySite(s.site);
                                }}
                                className="rounded-md border border-amber-500/40 bg-amber-500/10 p-1 text-amber-600 transition-colors hover:bg-amber-500/20 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-400"
                              >
                                {retryingSite === s.site ? (
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                                ) : (
                                  <RotateCcw className="h-3 w-3" aria-hidden />
                                )}
                              </button>
                            )}
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          </span>
                        </div>
                        <Badge variant="outline" className={`w-fit text-[10px] ${meta.chipClass}`}>
                          {meta.label}
                        </Badge>
                        <div className="flex items-baseline gap-1.5">
                          <span className={`text-lg font-bold leading-none ${s.count > 0 ? "" : "text-muted-foreground/60"}`}>
                            {s.count}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {s.site === "goofish" ? "listings" : "comps"}{secs ? ` · ${secs}s` : ""}
                          </span>
                        </div>
                        {isBaxiaRateLimited(s) && (
                          <span
                            className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400"
                            title="Baxia flagged this session. Scanning again right away usually extends the block — wait ~10 minutes, or paste results manually via Manual Paste."
                          >
                            <Timer className="h-2.5 w-2.5 animate-pulse" aria-hidden />
                            Cooldown ~10 min
                          </span>
                        )}
                      </div>
                      {s.detail && (
                        <p className="mt-1 line-clamp-2 px-1 text-[10px] leading-snug text-muted-foreground" title={s.detail}>
                          {s.detail}
                        </p>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-xs">
                    <p className="font-medium">{meta.help}</p>
                    {s.detail && <p className="mt-1 text-muted-foreground">{s.detail}</p>}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>

        {/* ── Reliability over recent scans ──────────────────────────
            Per-site success rate across the last N persisted scans so
            flaky/anti-bot-blocked sites are visible over time, not just
            in the latest scan. */}
        {health && (
          <Collapsible open={healthOpen} onOpenChange={setHealthOpen} className="mx-4 mb-4 rounded-lg border border-dashed bg-muted/30">
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" aria-hidden />
                  Reliability — last 20 scans
                  <span className="font-normal">
                    ({health.filter((h) => h.scans > 0).length} tracked)
                  </span>
                </span>
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${healthOpen ? "rotate-180" : ""}`} aria-hidden />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-1.5 px-3 pb-3">
                {health.map((h) => {
                  const rate = h.successRate;
                  return (
                    <div key={h.site} className="flex items-center gap-2 text-[11px]">
                      <span className="w-24 shrink-0 truncate text-muted-foreground">
                        {SITE_FLAGS[h.site as ScraperStatus["site"]] ?? "🌐"} {h.site}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={rate ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`${h.site} success rate`}>
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${rateColor(rate)}`}
                          style={{ width: `${rate ?? 0}%` }}
                        />
                      </div>
                      <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
                        {rate === null ? "no data" : `${rate}% · ${h.avgResults} avg`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* ── System health strip ──────────────────────────────────
            Live process vitals: browser children (leak watch), janitor
            activity, memory + uptime. Answers "is the backend healthy?"
            at a glance instead of grepping dev.log. */}
        {sysHealth && (
          <div className="mx-4 mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed bg-muted/30 px-3 py-2">
            <span className="mr-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <HeartPulse className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
              System
            </span>
            {/* Browser children: 1 while idle is NORMAL (OLX shared singleton
                stays alive by design). >1 with no scan running = leak watch. */}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                sysHealth.scanActive || sysHealth.browsers.liveChildren <= 1
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
              title={
                sysHealth.scanActive
                  ? "A scan is running — browsers are expected right now"
                  : "Playwright browser processes alive right now. 1 while idle is normal (OLX shared singleton); more could indicate a leak the janitor will reap."
              }
            >
              <Globe className="h-3 w-3" aria-hidden />
              {sysHealth.browsers.liveChildren} browser{sysHealth.browsers.liveChildren === 1 ? "" : "s"}
              {sysHealth.scanActive ? " · scanning" : ""}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
              title="Browser-janitor activity since boot: total sweeps + browsers reaped (leaked chromium processes killed)"
            >
              janitor: {sysHealth.janitor.sweeps} sweeps · reaped {sysHealth.janitor.reapedTotal}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
              title="next-server process memory (RSS / heap used) — watch this under repeated scans"
            >
              <MemoryStick className="h-3 w-3" aria-hidden />
              {sysHealth.memory.rssMb} MB / {sysHealth.memory.heapUsedMb} MB heap
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
              title="Time since the server process started"
            >
              up {fmtUptime(sysHealth.uptimeSec)}
            </span>
            <button
              type="button"
              onClick={() => void fetchSysHealth()}
              className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Refresh system health"
              aria-label="Refresh system health"
            >
              <RefreshCw className={`h-3 w-3 ${sysRefreshing ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
        )}

        {/* Copy debug report — puts a markdown summary of this scan's
            per-site outcomes (+ recent reliability) on the clipboard for
            easy bug reports. */}
        <div className="flex justify-end px-4 pb-3">
          <button
            onClick={copyReport}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Copy a markdown summary of scraper outcomes + reliability to the clipboard"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" aria-hidden /> : <ClipboardCopy className="h-3 w-3" aria-hidden />}
            {copied ? "Copied!" : "Copy debug report"}
          </button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
