import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/config/gates
 *
 * Exposes the decision-critical profitability gates (and the default resale
 * fee rate) to the client so the listing-detail "what-if" simulator can mark
 * a scenario as passing/failing the SAME thresholds the pipeline uses to hide
 * listings — instead of duplicating magic numbers in the frontend.
 *
 * Base config only: per-task overrides live on each task row and were applied
 * at scan time; the simulator is an exploratory tool, so base gates are the
 * right reference point.
 */
export async function GET() {
  return NextResponse.json({
    profitability: {
      min_margin_pct: config.profitability.min_margin_pct,
      min_net_profit_eur: config.profitability.min_net_profit_eur,
    },
    default_resale_fee_rate: config.marketplace_fees.default_resale_fee_rate,
  });
}
