"use client";

// Alerts control — header popover configuring BOTH alert channels:
//
// 1. Deal alerts — a scan finds a VIABLE lead with margin ≥ target %.
//    Rich toast + (if granted) an OS notification + a three-note fanfare.
// 2. Profit-move watch — a TRACKED Goofish listing's estimated net profit
//    jumped ≥ €X since the previous scan (seller cut the price or the EU
//    resale baseline rose). The buy-signal complement: works even when the
//    lead is still below the margin gate.
//
// This component only manages the preference UI; the scan-completion wiring
// lives in page.tsx's poll handler, which reads preferences straight from
// localStorage at completion time (never a stale closure).
//
// localStorage is consumed via useSyncExternalStore — the SSR-safe external
// store pattern (server snapshot = defaults, no hydration mismatch, and
// cross-tab "storage" events update the UI for free). Writes bump a local
// version so React re-reads the store immediately.

import { useCallback, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Bell, ArrowDownUp, Target, TrendingDown, TrendingUp, Volume2 } from "lucide-react";
import { toast } from "sonner";
import {
  DEAL_ALERT_THRESHOLD_DEFAULT,
  DEAL_ALERT_THRESHOLD_MAX,
  DEAL_ALERT_THRESHOLD_MIN,
  PROFIT_MOVE_THRESHOLD_DEFAULT,
  PROFIT_MOVE_THRESHOLD_MAX,
  PROFIT_MOVE_THRESHOLD_MIN,
  getDealAlertEnabled,
  setDealAlertEnabled,
  getDealAlertThreshold,
  setDealAlertThreshold,
  getProfitMoveDirection,
  setProfitMoveDirection,
  getProfitMoveEnabled,
  setProfitMoveEnabled,
  getProfitMoveThreshold,
  setProfitMoveThreshold,
  type ProfitMoveDirection,
} from "@/lib/deal-alert";
import { playProfitDropSound, playProfitMoveSound, playTestBlip } from "@/lib/sound";

// Subscribe to cross-tab storage events so the control stays in sync if the
// user changes thresholds in another tab/window.
function subscribeToStorage(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function DealAlertControl() {
  // Version bump forces useSyncExternalStore to re-read after our own writes
  // (its native re-read triggers are subscribe events + re-renders).
  const [version, setVersion] = useState(0);
  const write = useCallback(() => setVersion((v) => v + 1), []);

  // Server snapshot = defaults → deterministic SSR HTML, no hydration sway.
  const threshold = useSyncExternalStore(
    subscribeToStorage,
    getDealAlertThreshold,
    () => DEAL_ALERT_THRESHOLD_DEFAULT,
  );
  const enabled = useSyncExternalStore(
    subscribeToStorage,
    getDealAlertEnabled,
    () => true,
  );
  const moveThreshold = useSyncExternalStore(
    subscribeToStorage,
    getProfitMoveThreshold,
    () => PROFIT_MOVE_THRESHOLD_DEFAULT,
  );
  const moveEnabled = useSyncExternalStore(
    subscribeToStorage,
    getProfitMoveEnabled,
    () => true,
  );
  const moveDirection = useSyncExternalStore(
    subscribeToStorage,
    getProfitMoveDirection,
    () => "jumps" as ProfitMoveDirection,
  );
  void version; // consumed implicitly via re-render on write()

  const persistEnabled = useCallback(
    (on: boolean) => {
      setDealAlertEnabled(on);
      write();
      if (on) {
        playTestBlip();
        toast.success(`Deal alerts on — you'll hear a fanfare when a lead beats ${getDealAlertThreshold()}% margin`);
      } else {
        toast.info("Deal alerts off");
      }
    },
    [write],
  );

  const persistThreshold = useCallback(
    (pct: number) => {
      setDealAlertThreshold(pct);
      write();
    },
    [write],
  );

  const persistMoveEnabled = useCallback(
    (on: boolean) => {
      setProfitMoveEnabled(on);
      write();
      if (on) {
        playProfitMoveSound();
        toast.success(`Profit-move watch on — I'll flag tracked listings whose profit jumps ≥ €${getProfitMoveThreshold()}`);
      } else {
        toast.info("Profit-move watch off");
      }
    },
    [write],
  );

  const persistMoveThreshold = useCallback(
    (eur: number) => {
      setProfitMoveThreshold(eur);
      write();
    },
    [write],
  );

  const persistMoveDirection = useCallback(
    (dir: ProfitMoveDirection) => {
      setProfitMoveDirection(dir);
      write();
      if (dir === "drops") {
        playProfitDropSound();
        toast.info("Watching for profit DROPS — a tracked deal decaying fires a warning");
      } else if (dir === "all") {
        playTestBlip();
        toast.success("Watching ALL profit moves — jumps and drops past your threshold");
      } else {
        playProfitMoveSound();
        toast.success("Watching profit JUMPS — the classic buy signal");
      }
    },
    [write],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-8 gap-1.5 px-2.5"
          title="Alerts — deal margin target + tracked-listing profit moves"
          aria-label="Alert settings"
        >
          <Bell
            className={`h-3.5 w-3.5 ${
              enabled || moveEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
            }`}
          />
          <span className="hidden text-xs font-medium sm:inline">Alerts</span>
          {/* Badges hidden on mobile — the header is tight at 390px; the icon
              color already signals on/off, the popover shows the values. */}
          <Badge
            variant={enabled ? "default" : "secondary"}
            className="ml-0.5 hidden h-5 rounded-full px-1.5 text-[10px] font-bold tabular-nums sm:inline-flex"
          >
            ≥{threshold}%
          </Badge>
          <Badge
            variant={moveEnabled ? "default" : "secondary"}
            className="hidden h-5 rounded-full px-1.5 text-[10px] font-bold tabular-nums sm:inline-flex"
          >
            +€{moveThreshold}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-4">
          {/* ── Channel 1: margin deal alerts ── */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold leading-none">
                <Target className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Deal alerts
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Ping me when a scan finds a viable lead above your target margin.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={persistEnabled}
              aria-label="Toggle deal alerts"
            />
          </div>

          <div className={enabled ? "space-y-3" : "space-y-3 opacity-50 pointer-events-none"}>
            <div className="flex items-center justify-between">
              <Label htmlFor="deal-threshold" className="text-xs font-medium">
                Target margin
              </Label>
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                ≥ {threshold.toFixed(0)}%
              </span>
            </div>
            <Slider
              id="deal-threshold"
              min={DEAL_ALERT_THRESHOLD_MIN}
              max={DEAL_ALERT_THRESHOLD_MAX}
              step={1}
              value={[threshold]}
              onValueChange={(v) => persistThreshold(v[0] ?? threshold)}
              aria-label="Deal alert margin threshold"
            />
            <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>{DEAL_ALERT_THRESHOLD_MIN}%</span>
              <span>pipeline gate is 15%</span>
              <span>{DEAL_ALERT_THRESHOLD_MAX}%</span>
            </div>
          </div>

          <Separator />

          {/* ── Channel 2: tracked-listing profit moves ── */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold leading-none">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Profit-move watch
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Ping me when a listing seen in a previous scan now nets ≥ this much more (price cut or resale rise).
              </p>
            </div>
            <Switch
              checked={moveEnabled}
              onCheckedChange={persistMoveEnabled}
              aria-label="Toggle profit-move watch"
            />
          </div>

          <div className={moveEnabled ? "space-y-3" : "space-y-3 opacity-50 pointer-events-none"}>
            {/* Direction: which half of the movement distribution fires. */}
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Direction</Label>
              <div
                role="radiogroup"
                aria-label="Profit move direction"
                className="flex rounded-md border p-0.5"
              >
                {(
                  [
                    { key: "jumps", label: "Jumps", icon: TrendingUp },
                    { key: "all", label: "All", icon: ArrowDownUp },
                    { key: "drops", label: "Drops", icon: TrendingDown },
                  ] as Array<{ key: ProfitMoveDirection; label: string; icon: typeof TrendingUp }>
                ).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={moveDirection === key}
                    onClick={() => persistMoveDirection(key)}
                    className={`flex items-center gap-1 rounded-[5px] px-2 py-1 text-[10px] font-semibold transition-colors ${
                      moveDirection === key
                        ? key === "drops"
                          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                          : key === "all"
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3 w-3" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="move-threshold" className="text-xs font-medium">
                {moveDirection === "drops" ? "Profit fall" : "Profit jump"}
              </Label>
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {moveDirection === "drops" ? "−" : "+"} €{moveThreshold.toFixed(0)}
              </span>
            </div>
            <Slider
              id="move-threshold"
              min={PROFIT_MOVE_THRESHOLD_MIN}
              max={PROFIT_MOVE_THRESHOLD_MAX}
              step={1}
              value={[moveThreshold]}
              onValueChange={(v) => persistMoveThreshold(v[0] ?? moveThreshold)}
              aria-label="Profit-move threshold in euros"
            />
            <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>€{PROFIT_MOVE_THRESHOLD_MIN}</span>
              <span>vs the same listing&apos;s last scan</span>
              <span>€{PROFIT_MOVE_THRESHOLD_MAX}</span>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <p className="text-[11px] leading-snug text-muted-foreground">
              Each fires a toast + desktop ping + its own chime. A combined
              &quot;market moved&quot; summary rides along when anything else changed.
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => {
                  playTestBlip();
                  toast.success("🎯 Deal alert preview — 24.5% margin · €188 net", {
                    description: "This is what a caught deal looks like.",
                    duration: 5000,
                  });
                }}
                title="Preview deal alert"
              >
                <Volume2 className="h-3 w-3" />
                Deal
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => {
                  playProfitMoveSound();
                  toast.success("📈 Profit jump preview — +€22 on a tracked listing", {
                    description: "The seller cut the price since your last scan.",
                    duration: 5000,
                  });
                }}
                title="Preview profit-move alert"
              >
                <TrendingUp className="h-3 w-3" />
                Jump
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => {
                  playProfitDropSound();
                  toast.warning("📉 Profit drop preview — −€18 on a tracked listing", {
                    description: "The ask rose since your last scan — the deal is decaying.",
                    duration: 5000,
                  });
                }}
                title="Preview profit-drop warning"
              >
                <TrendingDown className="h-3 w-3" />
                Drop
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
