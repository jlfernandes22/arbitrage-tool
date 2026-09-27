"use client";

// Deal-alert control — header popover to configure the target-margin alert.
//
// When a scan finds a VIABLE lead with margin ≥ threshold, the user gets a
// rich toast + (if granted) an OS notification + a distinct three-note
// fanfare. This component only manages the preference UI; the scan-completion
// wiring lives in page.tsx's poll handler, which reads the preference
// straight from localStorage at completion time (never a stale closure).
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
import { Target, Volume2 } from "lucide-react";
import { toast } from "sonner";
import {
  DEAL_ALERT_THRESHOLD_DEFAULT,
  DEAL_ALERT_THRESHOLD_MAX,
  DEAL_ALERT_THRESHOLD_MIN,
  getDealAlertEnabled,
  setDealAlertEnabled,
  getDealAlertThreshold,
  setDealAlertThreshold,
} from "@/lib/deal-alert";
import { playTestBlip } from "@/lib/sound";

// Subscribe to cross-tab storage events so the control stays in sync if the
// user changes the threshold in another tab/window.
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-8 gap-1.5 px-2.5"
          title="Deal alert — notify me when a scan finds a lead above a target margin"
          aria-label="Deal alert settings"
        >
          <Target
            className={`h-3.5 w-3.5 ${
              enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
            }`}
          />
          <span className="hidden text-xs font-medium sm:inline">Deal alert</span>
          {/* Badge hidden on mobile — the header is tight at 390px; the icon
              color already signals on/off, the popover shows the value. */}
          <Badge
            variant={enabled ? "default" : "secondary"}
            className="ml-0.5 hidden h-5 rounded-full px-1.5 text-[10px] font-bold tabular-nums sm:inline-flex"
          >
            ≥{threshold}%
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold leading-none">🎯 Deal alerts</h4>
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

          <Separator />

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

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] leading-snug text-muted-foreground">
              Fires a toast + desktop ping + fanfare on the finished scan.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1 text-xs"
              onClick={() => {
                playTestBlip();
                toast.success("🎯 Deal alert preview — 24.5% margin · €188 net", {
                  description: "This is what a caught deal looks like.",
                  duration: 5000,
                });
              }}
            >
              <Volume2 className="h-3 w-3" />
              Preview
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
