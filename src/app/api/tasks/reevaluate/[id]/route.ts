import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTask, setTask, appendLog } from "@/lib/task-store";
import { resolveConfig } from "@/lib/config";
import {
  detectScam,
  shouldHideByScam,
  computeProfit,
  getCnyToEurRate,
  type AppConfig,
  type EvaluatedListing,
  type TaskResult,
  type TaskState,
  type GoofishListing,
} from "@/lib/engine";
import { getReferencePrices } from "@/lib/reference-prices";
import { buildSummary } from "@/lib/orchestrator";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Re-evaluate a stored task's listings using current reference prices and
 * config — WITHOUT re-scraping Goofish or re-querying EU comps.
 *
 * This is useful after the admin edits the reference price matrix or adjusts
 * config overrides (VAT, shipping, thresholds): the user can instantly see
 * how the new baselines affect profitability without paying the scraping cost.
 *
 * Reads the stored result's listings + euComps, re-runs scam detection +
 * profit calc with fresh reference prices + current forex, and returns a new
 * evaluated result.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  // Load the stored task (in-memory first, then DB fallback)
  let task = getTask(id);
  let storedListings: EvaluatedListing[] | null = null;
  if (task?.result?.listings) {
    storedListings = task.result.listings;
  } else {
    // Try loading from DB
    try {
      const row = await db.task.findUnique({ where: { id } });
      if (row?.resultsJson) {
        const parsed = JSON.parse(row.resultsJson) as TaskResult;
        storedListings = parsed.listings;
        // Reconstruct a minimal TaskState in memory for logging
        if (!task) {
          task = {
            id: row.id,
            query: row.query,
            category: row.category as TaskState["category"],
            status: row.status as TaskState["status"],
            progress: 100,
            step: row.step ?? "Done",
            warnings: [],
            degraded: row.degraded,
            startedAt: row.createdAt.getTime(),
            finishedAt: row.updatedAt.getTime(),
            logs: [],
          };
          setTask(id, task);
        }
      }
    } catch {
      /* ignore DB errors */
    }
  }
  if (!task || !storedListings) {
    return NextResponse.json(
      { error: "task not found or has no stored listings" },
      { status: 404 },
    );
  }
  // Parse optional config overrides from the request body
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine — use defaults */
  }
  const { configOverrides } = body as { configOverrides?: Partial<AppConfig> };
  const cfg = resolveConfig(configOverrides ?? task.configOverrides);
  appendLog(id, "INFO", "[Re-eval] Re-running scam detection + profit calc with current reference prices (no re-scrape)");
  try {
    const forex = await getCnyToEurRate();
    appendLog(id, "INFO", `[Re-eval] Forex CNY→EUR=${forex.rate} (source: ${forex.source})`);
    const refPrices = await getReferencePrices();
    appendLog(id, "INFO", `[Re-eval] Loaded ${Object.keys(refPrices).length} reference price entries`);
    const reevaluated: EvaluatedListing[] = storedListings.map((l) => {
      // Reuse the stored EU comps (no re-scrape)
      const comps = l.euComps;
      const scam = detectScam(l.listing, cfg, refPrices);
      const profit = computeProfit(
        l.listing.priceCny,
        l.listing.normalized,
        comps,
        forex.rate,
        cfg,
        refPrices,
      );
      let hidden = false;
      let hiddenReason: string | undefined;
      const scamHide = shouldHideByScam(scam, cfg);
      if (scamHide.hidden) {
        hidden = true;
        hiddenReason = scamHide.reason;
      } else if (profit.hidden) {
        hidden = true;
        const reasons: string[] = [];
        if (!profit.meetsMinMargin)
          reasons.push(`margin ${profit.marginPct.toFixed(1)}% < ${cfg.profitability.min_margin_pct * 100}%`);
        if (!profit.meetsMinProfit)
          reasons.push(`net profit €${profit.netProfitEur.toFixed(0)} < €${cfg.profitability.min_net_profit_eur}`);
        hiddenReason = `Profitability filter: ${reasons.join(", ")}`;
      }
      return { listing: l.listing, scam, profit, euComps: comps, hidden, hiddenReason };
    });
    const summary = buildSummary(reevaluated, cfg);
    const result: TaskResult = {
      taskId: id,
      query: task.query,
      category: task.category,
      status: "done",
      listings: reevaluated,
      summary,
      warnings: task.warnings ?? [],
      degraded: task.degraded,
      createdAt: new Date(task.startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
    };
    // Update the in-memory task with the re-evaluated result
    const updatedState: TaskState = {
      ...task,
      result,
      logs: getTask(id)?.logs ?? task.logs ?? [],
    };
    setTask(id, updatedState);
    appendLog(id, "SUCCESS", `[Re-eval] Complete — ${summary.shown}/${summary.total} viable, best profit €${Math.round(summary.bestProfitEur)}`);
    // Persist to DB
    try {
      await db.task.update({
        where: { id },
        data: {
          resultsJson: JSON.stringify(result),
          summaryJson: JSON.stringify(summary),
        },
      });
    } catch {
      /* ignore DB errors */
    }
    return NextResponse.json({
      task_id: id,
      status: "done",
      summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(id, "ERROR", `[Re-eval] Failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
// Re-export for type availability
export type { GoofishListing };