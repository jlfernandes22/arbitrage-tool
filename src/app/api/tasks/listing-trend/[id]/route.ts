import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getTask } from "@/lib/task-store";
import type { TaskResult, EvaluatedListing } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/listing-trend/[id]
 *
 * Profit-watch for the GOOFISH (source) side: tracks each scanned listing's
 * estimated net profit (and asking price) across previous scans of the same
 * query. Where comp-trend answers "are EU comps getting cheaper?", this
 * answers "is THIS Goofish deal getting better or worse since I last ran a
 * scan?" — the seller may have cut their price, or the EU resale baseline
 * may have moved. Either way, a listing whose estimated profit jumped by a
 * meaningful amount is the buy-signal complement to the margin deal alert.
 *
 * Matching key: `listing.id` — the Goofish item id is stable across scans
 * (the same physical ad re-scanned next week keeps its id), so this is more
 * reliable than any title/url heuristic. Synthetic market-preview rows are
 * skipped (they are not real leads and get a fresh id every scan).
 *
 * Response:
 * {
 *   comparedAgainst: { taskId, at } | null,
 *   scansCompared:   number,                    // prior scans actually parsed
 *   series: { [listingId]: { profits: number[], pricesCny: number[], at: string[] } },
 *        // chronological oldest → newest INCLUDING the current scan (sparkline fuel)
 *   deltas: { [listingId]: { prevProfitEur, deltaProfitEur, prevPriceCny, deltaPriceCny, at } },
 *        // vs the MOST RECENT prior sighting; unchanged (Δ=0) entries omitted
 * }
 */

interface ListingSnapshot {
  profitEur: number;
  priceCny: number;
}

function collectListings(result: TaskResult): Map<string, ListingSnapshot> {
  const out = new Map<string, ListingSnapshot>();
  const listings = Array.isArray(result?.listings) ? result.listings : [];
  for (const l of listings as EvaluatedListing[]) {
    const id = l?.listing?.id;
    const profit = l?.profit?.netProfitEur;
    const price = l?.listing?.priceCny;
    if (!id || typeof profit !== "number" || !Number.isFinite(profit)) continue;
    if (l?.listing?.synthetic) continue; // market-preview placeholders are not trackable
    if (!out.has(id)) {
      out.set(id, { profitEur: profit, priceCny: typeof price === "number" ? price : 0 });
    }
  }
  return out;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  // ── Load the current result (in-memory first, then DB fallback) ──
  const memTask = getTask(id);
  let query: string | null = memTask?.query ?? null;
  let storedResult: TaskResult | null = memTask?.result ?? null;
  let createdAt = memTask?.startedAt ? new Date(memTask.startedAt) : null;
  if (!storedResult) {
    const row = await db.task.findUnique({ where: { id } });
    if (row?.resultsJson) {
      storedResult = JSON.parse(row.resultsJson) as TaskResult;
      query = row.query;
      createdAt = row.createdAt;
    }
  }
  if (!storedResult || !query) {
    return NextResponse.json(
      { error: "Result not found for task" },
      { status: 404 },
    );
  }

  // ── Previous done-scans with the same query (most recent first) ──
  const prevRows = await db.task.findMany({
    where: {
      query,
      id: { not: id },
      status: "done",
      resultsJson: { not: null },
      ...(createdAt ? { createdAt: { lt: new Date(createdAt) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  // id → chronological snapshots of PRIOR scans (rows are newest-first, so
  // unshift onto the front to build oldest→newest order per listing).
  const history = new Map<string, Array<ListingSnapshot & { at: string; taskId: string }>>();
  let scansCompared = 0;
  let newestPrior: { taskId: string; at: string } | null = null;
  for (const row of prevRows) {
    try {
      const prev = JSON.parse(row.resultsJson as string) as TaskResult;
      const listings = collectListings(prev);
      if (listings.size === 0) continue;
      scansCompared++;
      if (!newestPrior) {
        newestPrior = { taskId: row.id, at: row.createdAt.toISOString() };
      }
      for (const [lid, snap] of listings) {
        let arr = history.get(lid);
        if (!arr) {
          arr = [];
          history.set(lid, arr);
        }
        arr.unshift({ ...snap, at: row.createdAt.toISOString(), taskId: row.id });
      }
    } catch {
      // corrupted row — skip it
    }
  }

  // ── Build series + deltas against the current scan ──
  const current = collectListings(storedResult);
  const series: Record<string, { profits: number[]; pricesCny: number[]; at: string[] }> = {};
  const deltas: Record<
    string,
    { prevProfitEur: number; deltaProfitEur: number; prevPriceCny: number; deltaPriceCny: number; at: string }
  > = {};
  for (const [lid, snap] of current) {
    const prior = history.get(lid);
    if (!prior || prior.length === 0) continue; // first-ever sighting — no trend
    const profits = [...prior.map((p) => p.profitEur), snap.profitEur];
    const pricesCny = [...prior.map((p) => p.priceCny), snap.priceCny];
    const at = [...prior.map((p) => p.at), (storedResult.finishedAt ?? createdAt?.toISOString()) || new Date().toISOString()];
    series[lid] = { profits, pricesCny, at };
    // Delta vs the MOST RECENT prior sighting (last element of prior).
    const last = prior[prior.length - 1];
    const deltaProfit = Math.round((snap.profitEur - last.profitEur) * 100) / 100;
    const deltaPrice = Math.round((snap.priceCny - last.priceCny) * 100) / 100;
    if (deltaProfit !== 0 || deltaPrice !== 0) {
      deltas[lid] = {
        prevProfitEur: last.profitEur,
        deltaProfitEur: deltaProfit,
        prevPriceCny: last.priceCny,
        deltaPriceCny: deltaPrice,
        at: last.at,
      };
    }
  }

  return NextResponse.json({
    comparedAgainst: newestPrior,
    scansCompared,
    series,
    deltas,
  });
}
