import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTask, setTask, appendLog } from "@/lib/task-store";
import { resolveConfig } from "@/lib/config";
import { ensureArray } from "@/lib/utils";
import {
  detectScam,
  shouldHideByScam,
  computeProfit,
  getCnyToEurRate,
  filterRelevantComps,
  type AppConfig,
  type EuMarketComp,
  type EvaluatedListing,
  type ScraperStatus,
  type TaskResult,
  type TaskState,
} from "@/lib/engine";
import { getReferencePrices } from "@/lib/reference-prices";
import { buildSummary } from "@/lib/orchestrator";
import { sanitizeConfigOverrides } from "@/lib/overrides";
import { scrapeOlx } from "@/lib/scrapers/olx";
import { scrapeVinted } from "@/lib/scrapers/vinted";
import { scrapeKuantokusta } from "@/lib/scrapers/kuantokusta";
import { scrapeAmazon } from "@/lib/scrapers/amazon";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Retry ONLY the failed EU scrapers of a completed scan.
 *
 * Why this exists: when a scan completes partially (e.g. Vinted hit Datadome,
 * KuantoKusta hit Akamai, Amazon came back empty), the only recovery so far
 * was re-running the WHOLE scan — which re-scrapes Goofish too. Goofish's
 * Baxia rate-limits by IP, so every full re-run burns the user's Goofish
 * budget for data we already have. This endpoint re-scrapes just the
 * blocked/empty/error EU sites, merges the fresh comps into the stored
 * listing pool, and re-runs matching + scam + profit — Goofish is NEVER
 * touched.
 *
 * Accepts an optional `sites` array to retry a specific subset; defaults to
 * every non-ok EU site from the stored scraperStatuses.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  // ── Load the stored task + result (in-memory first, then DB fallback) ──
  let task = getTask(id);
  let storedResult: TaskResult | null = null;
  if (task?.result) {
    storedResult = task.result;
  } else {
    try {
      const row = await db.task.findUnique({ where: { id } });
      if (row?.resultsJson) {
        storedResult = JSON.parse(row.resultsJson) as TaskResult;
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
  if (!task || !storedResult?.listings?.length) {
    return NextResponse.json(
      { error: "task not found or has no stored listings" },
      { status: 404 },
    );
  }
  // Optional config overrides (same sanitizer as submit/reevaluate).
  let body: { sites?: string[]; configOverrides?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  const sanitized = sanitizeConfigOverrides(body.configOverrides);
  if (!sanitized.ok) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }
  const cfg = resolveConfig(
    (sanitized.overrides as Partial<AppConfig> | undefined) ?? task.configOverrides,
  );

  // ── Decide which sites to retry ─────────────────────────────────────
  const storedStatuses: ScraperStatus[] = ensureArray(storedResult.scraperStatuses);
  const RETRYABLE: string[] = ["olx", "vinted", "kuantokusta", "amazon"];
  const failedSites = storedStatuses
    .filter((s) => s.site !== "goofish" && (s.status === "blocked" || s.status === "error" || s.status === "empty"))
    .map((s) => s.site as string);
  const requested = Array.isArray(body.sites) && body.sites.length > 0
    ? body.sites.filter((s): s is string => RETRYABLE.includes(s))
    : failedSites;
  const sitesToRetry = requested.filter((s) => failedSites.includes(s));
  if (sitesToRetry.length === 0) {
    return NextResponse.json(
      { error: "no retryable failed sites (nothing blocked/empty/error, or the requested sites already succeeded)" },
      { status: 400 },
    );
  }
  appendLog(id, "INFO", `[Retry] Re-scraping ONLY failed sites: ${sitesToRetry.join(", ")} — Goofish untouched`);

  // ── Re-scrape the failed sites in parallel ──────────────────────────
  const query = storedResult.query || task.query;
  const maxPages = cfg.scraping.max_pages > 0 ? cfg.scraping.max_pages : 1;
  const newComps: EuMarketComp[] = [];
  const newStatuses = new Map<string, ScraperStatus>();

  const jobs: Array<Promise<void>> = [];
  const runJob = async (
    site: string,
    label: string,
    fn: () => Promise<{
      comps: EuMarketComp[];
      liveFetchStatus?: string;
      warning?: string;
      blocked?: boolean;
    }>,
  ) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      newComps.push(...r.comps);
      const status: ScraperStatus["status"] = r.comps.length > 0
        ? "ok"
        : r.blocked
          ? "blocked"
          : /failed|error|timeout|abort|denied/i.test(`${r.liveFetchStatus ?? ""} ${r.warning ?? ""}`)
            ? "error"
            : "empty";
      newStatuses.set(site, {
        site: site as ScraperStatus["site"],
        label,
        status,
        count: r.comps.length,
        detail: r.warning ?? r.liveFetchStatus ?? undefined,
        durationMs: Date.now() - t0,
      });
      appendLog(id, r.comps.length > 0 ? "SUCCESS" : "WARN",
        `[Retry] ${label}: ${status.toUpperCase()} — ${r.comps.length} comps${r.liveFetchStatus ? ` | ${r.liveFetchStatus.substring(0, 120)}` : ""}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      newStatuses.set(site, {
        site: site as ScraperStatus["site"],
        label, status: "error", count: 0, detail: msg, durationMs: Date.now() - t0,
      });
      appendLog(id, "WARN", `[Retry] ${label}: ERROR — ${msg}`);
    }
  };

  if (sitesToRetry.includes("olx")) {
    jobs.push(runJob("olx", "OLX.pt", () => scrapeOlx(null, query, { maxPages })));
  }
  if (sitesToRetry.includes("vinted")) {
    jobs.push(runJob("vinted", "Vinted.pt", () => scrapeVinted(null, query, { maxPages })));
  }
  if (sitesToRetry.includes("kuantokusta")) {
    jobs.push(runJob("kuantokusta", "KuantoKusta.pt", () => scrapeKuantokusta(null, query, { maxPages })));
  }
  if (sitesToRetry.includes("amazon")) {
    jobs.push(runJob("amazon", "Amazon.es", () => scrapeAmazon(null, query, { maxPages })));
  }
  await Promise.all(jobs);

  // ── Merge old comps + fresh comps (dedupe by platform+title+price+url) ──
  // The stored per-listing euComps are FILTERED subsets; rebuilding the raw
  // pool from their union keeps every previously matched comp.
  const compKey = (c: EuMarketComp) =>
    `${c.platform}|${c.title.slice(0, 80)}|${c.priceEur.toFixed(2)}|${c.url ?? ""}`;
  const mergedPool: EuMarketComp[] = [];
  const seen = new Set<string>();
  for (const l of storedResult.listings) {
    for (const c of l.euComps ?? []) {
      const k = compKey(c);
      if (!seen.has(k)) { seen.add(k); mergedPool.push(c); }
    }
  }
  for (const c of newComps) {
    const k = compKey(c);
    if (!seen.has(k)) { seen.add(k); mergedPool.push(c); }
  }
  appendLog(id, "INFO",
    `[Retry] Comp pool: ${mergedPool.length} unique (${newComps.length} fresh from ${sitesToRetry.length} site(s))`);

  // ── Re-run matching + scam + profit over the merged pool ────────────
  try {
    const forex = await getCnyToEurRate(cfg.forex.cny_to_eur_rate);
    const refPrices = await getReferencePrices();
    const reevaluated: EvaluatedListing[] = storedResult.listings.map((l) => {
      const comps = l.listing.normalized
        ? filterRelevantComps(mergedPool, l.listing.normalized, 40)
        : mergedPool;
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
    // Refresh scraper statuses: retried sites get new entries, the rest keep
    // their stored outcome.
    const refreshedStatuses: ScraperStatus[] = storedStatuses.map((s) =>
      newStatuses.get(s.site) ?? s,
    );
    // A site that had NO stored entry (crashed before reporting) gets one now.
    for (const [site, st] of newStatuses) {
      if (!refreshedStatuses.some((s) => s.site === site)) refreshedStatuses.push(st);
    }
    const newWarnings = (storedResult.warnings ?? []).filter(
      (w) => !(w ?? "").startsWith("Goofish:"),
    );
    const result: TaskResult = {
      taskId: id,
      query: storedResult.query ?? task.query,
      category: storedResult.category ?? task.category,
      status: "done",
      listings: reevaluated,
      summary,
      warnings: newWarnings,
      degraded: refreshedStatuses.some((s) => s.status === "blocked" || s.status === "error"),
      scraperStatuses: refreshedStatuses,
      createdAt: storedResult.createdAt ?? new Date(task.startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
    };
    const updatedState: TaskState = {
      ...task,
      result,
      logs: getTask(id)?.logs ?? task.logs ?? [],
    };
    setTask(id, updatedState);
    appendLog(id, "SUCCESS",
      `[Retry] Complete — pool ${mergedPool.length} comps, ${summary.shown}/${summary.total} viable, best profit €${Math.round(summary.bestProfitEur)}`);
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
      retried: sitesToRetry,
      freshComps: newComps.length,
      summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(id, "ERROR", `[Retry] Failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
