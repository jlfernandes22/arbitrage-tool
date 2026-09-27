"use client";

// What-if Profit Simulator — interactive scenario tool inside the listing
// detail dialog.
//
// The pipeline prices a lead using the EU median resale and the seller's
// asking price. Real arbitrage decisions need more: "what if I negotiate the
// seller down to ¥X?" / "what if I list at €Y instead of the median?" This
// component recomputes the FULL landed-cost + profit chain live from the
// stored per-listing breakdown, deriving every rate (FX fee, agent %,
// insurance %, duty %, VAT base, resale fee %) from the original numbers so
// it always matches the engine's model — no duplicated constants.
//
// Flat fees (inspection, CN shipping, air freight, customs clearance, PT
// courier) stay constant; percentage-based fees scale with the negotiated
// acquisition exactly like profit-calc.ts does.

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  SlidersHorizontal,
  RotateCcw,
  TrendingUp,
  CircleCheck,
  CircleX,
  Info,
} from "lucide-react";
import {
  type ProfitAnalysis,
  type GoofishListing,
  eur,
  eurPrecise,
  cny,
} from "./types";

// Gates are fetched once per session from the same config the pipeline uses
// (GET /api/config/gates) instead of being hard-coded in the frontend.
let gatesCache: { minMarginPct: number; minNetProfitEur: number } | null = null;
async function fetchGates(): Promise<{ minMarginPct: number; minNetProfitEur: number }> {
  if (gatesCache) return gatesCache;
  try {
    const r = await fetch("/api/config/gates", { cache: "no-store" });
    if (r.ok) {
      const d = await r.json();
      gatesCache = {
        minMarginPct: (d.profitability?.min_margin_pct ?? 0.15) * 100,
        minNetProfitEur: d.profitability?.min_net_profit_eur ?? 30,
      };
    }
  } catch {
    // fall through to defaults
  }
  return gatesCache ?? { minMarginPct: 15, minNetProfitEur: 30 };
}

interface WhatIfSimulatorProps {
  profit: ProfitAnalysis;
  listing: GoofishListing;
}

export function WhatIfSimulator({ profit, listing }: WhatIfSimulatorProps) {
  const landed = profit.landed;

  // ── Derived rates from the ORIGINAL breakdown (match profit-calc.ts EXACTLY) ──
  // The engine computes:
  //   dutyBase = acq + agent + inspection + cnShipping + insurance + intl
  //   duty     = dutyBase × dutyRate
  //   vatBase  = dutyBase + customsClearance + duty
  //   vat      = vatBase × vatRate
  // Every base component is stored on the breakdown, so reconstructing the
  // bases first and dividing gives EXACT rates — with the default inputs the
  // scenario reproduces the stored landed cost to the cent.
  const rates = useMemo(() => {
    const fx = landed.cnyToEurRate || 1;
    const acq0 = landed.acquisitionCostEur;
    const grossCny = landed.priceCny > 0 ? landed.priceCny * fx : 0;
    // (1 + exchange fee) implied by the original numbers
    const acqMultiplier = grossCny > 0 ? acq0 / grossCny : 1;
    const agentRate = acq0 > 0 ? landed.agentServiceFeeEur / acq0 : 0;
    const insuranceRate = acq0 > 0 ? landed.insuranceFeeEur / acq0 : 0;
    const dutyBase0 =
      acq0 +
      landed.agentServiceFeeEur +
      landed.inspectionFeeEur +
      landed.domesticShippingCnEur +
      landed.insuranceFeeEur +
      landed.internationalShippingEur;
    const dutyRate = dutyBase0 > 0 ? landed.importDutyEur / dutyBase0 : 0;
    const vatBase0 = dutyBase0 + landed.customsClearanceEur + landed.importDutyEur;
    const vatRate = vatBase0 > 0 ? landed.importVatEur / vatBase0 : 0;
    const resaleFeeRate =
      profit.expectedResaleEur > 0 ? profit.resaleFeeEur / profit.expectedResaleEur : 0;
    return { fx, acqMultiplier, agentRate, insuranceRate, dutyRate, vatRate, resaleFeeRate };
  }, [landed, profit.expectedResaleEur, profit.resaleFeeEur]);

  // ── User scenario inputs ──
  const [resaleEur, setResaleEur] = useState<number>(Math.round(profit.expectedResaleEur));
  const [cnyPrice, setCnyPrice] = useState<number>(Math.round(landed.priceCny));
  const [gates, setGates] = useState(gatesCache ?? { minMarginPct: 15, minNetProfitEur: 30 });

  useEffect(() => {
    void fetchGates().then(setGates);
  }, []);

  // Resale slider bounds: €0 .. 2× the expected resale (asking the moon).
  const resaleMax = Math.max(50, Math.ceil(profit.expectedResaleEur * 2));
  // Negotiation bounds: ¥0 .. 1.5× asking (sellers don't go up).
  const cnyMax = Math.max(50, Math.ceil(landed.priceCny * 1.5));

  // ── Live recompute — mirrors profit-calc.ts exactly ──
  const scenario = useMemo(() => {
    const acq = Math.max(0, cnyPrice) * rates.fx * rates.acqMultiplier;
    const agent = acq * rates.agentRate;
    const insurance = acq * rates.insuranceRate;
    const dutyBase =
      acq +
      agent +
      landed.inspectionFeeEur +
      landed.domesticShippingCnEur +
      insurance +
      landed.internationalShippingEur;
    const duty = dutyBase * rates.dutyRate;
    const vatBase = dutyBase + landed.customsClearanceEur + duty;
    const vat = vatBase * rates.vatRate;
    const totalLanded = dutyBase + landed.customsClearanceEur + duty + vat + landed.domesticShippingEur;
    const fee = Math.max(0, resaleEur) * rates.resaleFeeRate;
    const netResale = Math.max(0, resaleEur) - fee;
    const netProfit = netResale - totalLanded;
    const marginPct = totalLanded > 0 ? (netProfit / totalLanded) * 100 : 0;
    return { acq, totalLanded, fee, netResale, netProfit, marginPct };
  }, [cnyPrice, resaleEur, rates, landed]);

  const meetsMargin = scenario.marginPct >= gates.minMarginPct;
  const meetsProfit = scenario.netProfit >= gates.minNetProfitEur;
  const viable = meetsMargin && meetsProfit;

  // Deltas vs the as-scraped numbers
  const deltaProfit = scenario.netProfit - profit.netProfitEur;
  const isModified = resaleEur !== Math.round(profit.expectedResaleEur) || cnyPrice !== Math.round(landed.priceCny);

  const reset = () => {
    setResaleEur(Math.round(profit.expectedResaleEur));
    setCnyPrice(Math.round(landed.priceCny));
  };

  // Synthetic rows carry ¥0 cost — no meaningful scenario to simulate.
  if (!landed || landed.priceCny <= 0) {
    return (
      <section className="min-w-0 rounded-lg border border-dashed bg-muted/20 p-4">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          What-if Simulator
        </h4>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          No real cost basis for this row (market preview) — the simulator needs a priced listing.
        </p>
      </section>
    );
  }

  // Margin bar geometry: map −25%..75% → 0..100% so losses and big wins both
  // fit; the gate tick lands at (15+25)/100 = 40%.
  const MARGIN_MIN = -25;
  const MARGIN_MAX = 75;
  const clampPct = (m: number) =>
    Math.min(100, Math.max(0, ((m - MARGIN_MIN) / (MARGIN_MAX - MARGIN_MIN)) * 100));
  const fillPct = clampPct(scenario.marginPct);
  const gatePct = clampPct(gates.minMarginPct);

  return (
    <section className="min-w-0 rounded-lg border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.06] via-transparent to-amber-500/[0.06] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          What-if Simulator
        </h4>
        <div className="flex items-center gap-2">
          {isModified && (
            <Badge
              variant="outline"
              className={`h-5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                deltaProfit >= 0
                  ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                  : "border-rose-500/40 text-rose-700 dark:text-rose-400"
              }`}
            >
              {deltaProfit >= 0 ? "+" : "−"}
              {eurPrecise(Math.abs(deltaProfit))} vs asking/median
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
            onClick={reset}
            disabled={!isModified}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Negotiated purchase price */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="wi-cny" className="text-xs font-medium">
              Negotiated purchase
            </Label>
            <div className="relative w-28">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                ¥
              </span>
              <Input
                id="wi-cny"
                type="number"
                min={0}
                max={cnyMax}
                step={10}
                value={cnyPrice}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setCnyPrice(Math.min(cnyMax, Math.max(0, v)));
                }}
                className="h-7 pl-6 pr-1 text-right text-xs font-semibold tabular-nums"
              />
            </div>
          </div>
          <Slider
            min={0}
            max={cnyMax}
            step={10}
            value={[Math.min(cnyPrice, cnyMax)]}
            onValueChange={(v) => setCnyPrice(v[0] ?? cnyPrice)}
            aria-label="Negotiated purchase price in CNY"
          />
          <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>free</span>
            <span>asking {cny(landed.priceCny)}</span>
            <span>{cny(cnyMax)}</span>
          </div>
        </div>

        {/* Your resale price */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="wi-resale" className="text-xs font-medium">
              Your resale price
            </Label>
            <div className="relative w-28">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                €
              </span>
              <Input
                id="wi-resale"
                type="number"
                min={0}
                max={resaleMax}
                step={5}
                value={resaleEur}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setResaleEur(Math.min(resaleMax, Math.max(0, v)));
                }}
                className="h-7 pl-6 pr-1 text-right text-xs font-semibold tabular-nums"
              />
            </div>
          </div>
          <Slider
            min={0}
            max={resaleMax}
            step={5}
            value={[Math.min(resaleEur, resaleMax)]}
            onValueChange={(v) => setResaleEur(v[0] ?? resaleEur)}
            aria-label="Your resale price in EUR"
          />
          <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>€0</span>
            <span>median {eur(profit.expectedResaleEur)}</span>
            <span>{eur(resaleMax)}</span>
          </div>
        </div>
      </div>

      {/* Result panel */}
      <div className="mt-4 grid gap-3 rounded-lg border bg-background/60 p-3 sm:grid-cols-4">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Total landed
          </span>
          <div className="text-base font-bold tabular-nums">
            {eurPrecise(scenario.totalLanded)}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            acq {eurPrecise(scenario.acq)} + fees {eurPrecise(scenario.totalLanded - scenario.acq)}
          </div>
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Net resale
          </span>
          <div className="text-base font-bold tabular-nums">
            {eurPrecise(scenario.netResale)}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            − {eurPrecise(scenario.fee)} platform fee
          </div>
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Net profit
          </span>
          <div
            className={`text-base font-bold tabular-nums ${
              scenario.netProfit > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {eurPrecise(scenario.netProfit)}
          </div>
          <div
            className={`text-[10px] font-medium tabular-nums ${
              meetsProfit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
            }`}
          >
            gate ≥ {eur(gates.minNetProfitEur)}
          </div>
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Margin
          </span>
          <div
            className={`text-base font-bold tabular-nums ${
              scenario.marginPct >= gates.minMarginPct
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {scenario.marginPct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            gate ≥ {gates.minMarginPct.toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Margin bar with gate tick */}
      <div className="mt-3">
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-rose-500/15">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              scenario.marginPct >= 30
                ? "bg-emerald-500"
                : scenario.marginPct >= gates.minMarginPct
                  ? "bg-emerald-400/80"
                  : scenario.marginPct >= 0
                    ? "bg-amber-500"
                    : "bg-rose-500"
            }`}
            style={{ width: `${fillPct}%` }}
          />
          {/* Gate tick */}
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground/50"
            style={{ left: `${gatePct}%` }}
            title={`Viability gate: ${gates.minMarginPct.toFixed(0)}%`}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>−25%</span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-0.5 bg-foreground/50" /> gate
            {gates.minMarginPct.toFixed(0)}%
          </span>
          <span>+75%</span>
        </div>
      </div>

      {/* Verdict */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge
          className={`h-6 gap-1 rounded-full px-2 text-[11px] font-semibold ${
            viable
              ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
              : "bg-rose-500/15 text-rose-700 hover:bg-rose-500/20 dark:text-rose-400"
          }`}
        >
          {viable ? (
            <CircleCheck className="h-3 w-3" />
          ) : (
            <CircleX className="h-3 w-3" />
          )}
          {viable
            ? "Would pass viability gates"
            : !meetsMargin
              ? `Margin below ${gates.minMarginPct.toFixed(0)}% gate`
              : `Profit below ${eur(gates.minNetProfitEur)} gate`}
        </Badge>
        {!viable && (
          <span className="text-[11px] text-muted-foreground">
            Push the purchase price down or relist higher to clear the gates.
          </span>
        )}
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <TrendingUp className="h-3 w-3" />
          Flat fees (freight, customs, courier) stay constant — % fees scale with your negotiated price.
        </span>
      </div>
    </section>
  );
}
