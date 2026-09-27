"use client";
// ScraperStatusPanel — per-site outcome breakdown for the last scan.
// Shows every scraper (Goofish, OLX, Vinted, KuantoKusta, Amazon) with an
// at-a-glance status chip, the number of results it produced, how long it
// took, and (on failure) the precise reason so debugging is trivial.
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { CheckCircle2, AlertTriangle, ShieldAlert, XCircle, MinusCircle, ChevronDown, Globe } from "lucide-react";
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

export function ScraperStatusPanel({ statuses }: { statuses: ScraperStatus[] }) {
  const [open, setOpen] = useState(true);
  if (!Array.isArray(statuses) || statuses.length === 0) return null;
  const okCount = statuses.filter((s) => s.status === "ok").length;
  const failCount = statuses.filter((s) => ["blocked", "error", "empty"].includes(s.status)).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card shadow-sm">
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />
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
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <TooltipProvider delayDuration={150}>
          <div className="grid grid-cols-1 gap-2 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-5">
            {statuses.map((s) => {
              const meta = STATUS_META[s.status] ?? STATUS_META.empty;
              const Icon = meta.icon;
              const secs = s.durationMs ? (s.durationMs / 1000).toFixed(1) : null;
              const chip = (
                <div
                  className={`flex min-h-[92px] cursor-default flex-col gap-1.5 rounded-lg border bg-background/40 p-3 border-l-4 ${meta.rowGlow}`}
                  aria-label={`${s.label}: ${meta.label}, ${s.count} results`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1.5 truncate text-xs font-medium">
                      <span aria-hidden>{SITE_FLAGS[s.site] ?? "🌐"}</span>
                      <span className="truncate">{s.label}</span>
                    </span>
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
                </div>
              );
              return (
                <Tooltip key={s.site}>
                  <TooltipTrigger asChild>
                    <div>
                      {chip}
                      {s.detail && (
                        <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground" title={s.detail}>
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
      </CollapsibleContent>
    </Collapsible>
  );
}
