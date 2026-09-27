import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getTask } from "@/lib/task-store";
import { compTrendKey, type CompTrendDelta } from "@/lib/comp-trend";
import type { TaskResult, EuMarketComp } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/comp-trend/[id]
 *
 * Price-watch for EU market comps: compares the comps of scan [id] against
 * the same item in PREVIOUS scans of the same query. An OLX seller dropping
 * their asking price by €40 since your last scan is exactly the kind of
 * signal an arbitrage hunter wants surfaced without re-reading 80 rows.
 *
 * Matching keys are derived by the shared compTrendKey() helper (URL-based
 * when available, conservative platform|title|condition|location fallback).
 *
 * Previous scans: up to 5 most recent persisted done-scans with the same
 * query (excluding this one, older than this one). For each key the MOST
 * RECENT prior price wins ("what you last saw this item at").
 *
 * Response (CompTrendResponse): { comparedAgainst, scansCompared,
 * currentComps, matched, deltas } — deltaEur = current − previous
 * (positive = EU price went UP = better for resale margins).
 */

function collectComps(result: TaskResult): Array<{ key: string; source: "url" | "fallback"; priceEur: number }> {
  const out: Array<{ key: string; source: "url" | "fallback"; priceEur: number }> = [];
  const listings = Array.isArray(result?.listings) ? result.listings : [];
  for (const l of listings) {
    const comps = Array.isArray(l?.euComps) ? l.euComps : [];
    for (const c of comps as EuMarketComp[]) {
      const k = compTrendKey(c);
      if (k) out.push({ key: k.key, source: k.source, priceEur: c.priceEur });
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

  // key → { prevPriceEur, source } — first writer wins (rows are ordered
  // newest-first, so the map holds the MOST RECENT prior price per item).
  const prevMap = new Map<string, { prevPriceEur: number; source: "url" | "fallback" }>();
  let scansCompared = 0;
  let newestPrior: { taskId: string; at: string } | null = null;
  for (const row of prevRows) {
    try {
      const prev = JSON.parse(row.resultsJson as string) as TaskResult;
      const comps = collectComps(prev);
      if (comps.length === 0) continue;
      scansCompared++;
      if (!newestPrior) {
        newestPrior = { taskId: row.id, at: row.createdAt.toISOString() };
      }
      for (const c of comps) {
        if (!prevMap.has(c.key)) {
          prevMap.set(c.key, { prevPriceEur: c.priceEur, source: c.source });
        }
      }
    } catch {
      // corrupted row — skip it
    }
  }

  // ── Diff the current comps against the prior-price map ──
  const current = collectComps(storedResult);
  const deltas: Record<string, CompTrendDelta> = {};
  let matched = 0;
  for (const c of current) {
    const prev = prevMap.get(c.key);
    if (!prev) continue;
    matched++;
    // Round to cents — raw float subtraction showed garbage in earlier rounds.
    const delta = Math.round((c.priceEur - prev.prevPriceEur) * 100) / 100;
    if (delta === 0) continue; // unchanged items are noise
    deltas[c.key] = {
      prevPriceEur: prev.prevPriceEur,
      deltaEur: delta,
      source: c.source === "url" && prev.source === "url" ? "url" : "fallback",
    };
  }

  return NextResponse.json({
    comparedAgainst: newestPrior,
    scansCompared,
    currentComps: current.length,
    matched,
    deltas,
  });
}
