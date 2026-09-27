// lib/orchestrator.ts
// Task pipeline orchestrator. Runs the full arbitrage pipeline for a task:
//   1. scraping_goofish  — fetch Goofish listings (direct URL synthesis + modal dismissal)
//   2. matching_eu       — for each normalized product, query OLX + Vinted comps
//   3. calculating       — run scam detection + landed cost + profit analysis
//   4. done              — assemble result + summary, persist to DB
//
// Concurrency: OLX + Vinted comps are fetched in parallel per product;
// multiple products run with bounded concurrency (Node async pool).
// Anti-detection jitter is injected inside each scraper module.
import { v4 as uuid } from "uuid";
import { db, withDbWriteRetry } from "@/lib/db";
import { config, resolveConfig } from "@/lib/config";
import {
  detectScam,
  shouldHideByScam,
  computeProfit,
  filterRelevantComps,
  getCnyToEurRate,
  buildEuQuery,
  type AppConfig,
  type Category,
  type EvaluatedListing,
  type EuMarketComp,
  type GoofishListing,
  type ScraperStatus,
  type TaskResult,
  type TaskSummary,
} from "@/lib/engine";
import { scrapeGoofish } from "@/lib/scrapers/goofish";
import { scrapeOlx } from "@/lib/scrapers/olx";
import { scrapeVinted } from "@/lib/scrapers/vinted";
import { scrapeKuantokusta } from "@/lib/scrapers/kuantokusta";
import { scrapeAmazon } from "@/lib/scrapers/amazon";
import { getReferencePrices } from "@/lib/reference-prices";
import { getTask, setTask, updateTask, appendLog, isCancelRequested, type TaskState } from "@/lib/task-store";
import {
  noteScanActivity,
  countLiveBrowserChildren,
  startBrowserJanitor,
} from "@/lib/browser-janitor";
import { forceCloseSharedBrowser } from "@/lib/scrapers/browser";
import { forceCloseVintedBrowser } from "@/lib/scrapers/vinted";
import { forceCloseKkBrowser } from "@/lib/scrapers/kuantokusta";
import { forceCloseAmazonBrowser } from "@/lib/scrapers/amazon";
import { ensureArray } from "@/lib/utils";

// Start the periodic leak reaper (idempotent; no-op interval when idle).
startBrowserJanitor();
export interface SubmitInput {
  query: string;
  category: Category;
  configOverrides?: Partial<AppConfig>;
}
export async function createTask(input: SubmitInput): Promise<TaskState> {
  const id = uuid();
  const state: TaskState = {
    id,
    query: input.query,
    category: input.category,
    status: "pending",
    progress: 0,
    step: "Queued",
    warnings: [],
    degraded: false,
    startedAt: Date.now(),
    configOverrides: input.configOverrides,
    logs: [],
  };
  setTask(id, state);
  appendLog(id, "INFO", `Task created — query="${input.query}" category=${input.category}`);
  // Persist the task row BEFORE the pipeline starts. Fire-and-forget could
  // lose the task from DB history when the pipeline finishes before the
  // create lands (persistTask's update would no-op on a missing row).
  try {
    await withDbWriteRetry(() =>
      db.task.create({
        data: {
          id,
          query: input.query,
          category: input.category,
          status: "pending",
          progress: 0,
          step: "Queued",
        },
      }),
    );
  } catch (e) {
    // DB is optional in dev, but the user must KNOW history persistence failed
    // instead of the scan silently vanishing from history later.
    const msg = e instanceof Error ? e.message : String(e);
    appendLog(id, "WARN", `[Persist] Could not create task row in history DB: ${msg.substring(0, 120)}`);
  }
  return state;
}
async function persistTask(id: string, state: TaskState): Promise<void> {
  try {
    // withDbWriteRetry recovers from transient SQLite failures (hot journal
    // "readonly database" / "database is locked") by reconnecting and
    // retrying — previously a single transient failure silently dropped the
    // scan from history entirely.
    await withDbWriteRetry(() =>
      db.task.update({
        where: { id },
        data: {
          status: state.status,
          progress: state.progress,
          step: state.step,
          error: state.error,
          manualHtml: state.manualHtml,
          resultsJson: state.result ? JSON.stringify(state.result) : null,
          summaryJson: state.result ? JSON.stringify(state.result.summary) : null,
          degraded: state.degraded,
        },
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[persistTask] Failed to persist task ${id} after retries: ${msg}`);
    appendLog(
      id,
      "WARN",
      `[Persist] Results could NOT be saved to history DB (${msg.substring(0, 100)}) — this scan will disappear on restart`,
    );
  }
}
export function buildSummary(
  listings: EvaluatedListing[],
  cfg: AppConfig,
): TaskSummary {
  // Synthetic placeholder rows (injected when Goofish returned 0) have a ¥0
  // acquisition cost — including them produced absurd "620% margin" viable
  // stats for scans where nothing was actually buyable. They stay in the
  // listings array (the Market Price Preview panel still uses their comps)
  // but are excluded from every viable-lead metric here.
  const real = listings.filter((l) => !l.listing.synthetic);
  const shown = real.filter((l) => !l.hidden);
  const isScamHidden = (l: EvaluatedListing) =>
    l.scam.dropped || l.scam.riskScore > cfg.scam_filter.hide_threshold;
  const hiddenScam = real.filter((l) => l.hidden && isScamHidden(l)).length;
  const hiddenProfit = real.filter(
    (l) => l.hidden && !isScamHidden(l),
  ).length;
  const margins = shown.map((l) => l.profit.marginPct);
  const risks = real.map((l) => l.scam.riskScore);
  const profits = shown.map((l) => l.profit.netProfitEur);
  return {
    total: listings.length,
    shown: shown.length,
    hiddenScam,
    hiddenProfit,
    avgMarginPct: margins.length
      ? Math.round((margins.reduce((a, b) => a + b, 0) / margins.length) * 10) / 10
      : 0,
    avgRiskScore: risks.length
      ? Math.round(risks.reduce((a, b) => a + b, 0) / risks.length)
      : 0,
    bestProfitEur: profits.length ? Math.max(...profits) : 0,
    // Round to 1dp: raw floats rendered as "620.321374151544%" in the Best
    // Net Profit card badge.
    bestMarginPct: margins.length
      ? Math.round(Math.max(...margins) * 10) / 10
      : 0,
  };
}
// Tracks the CURRENT pipeline generation per task. A manual-paste resume
// bumps the generation and starts a new pipeline; the OLD (superseded) run
// must not keep patching the task or overwrite the new run's result when it
// finally finishes. Every state mutation is guarded with the generation check.
const pipelineGen = new Map<string, number>();

/**
 * Last-resort watchdog around a scraper promise. Every scraper has internal
 * timeouts, but a hung Playwright renderer (observed: 0.18s CPU over 10
 * minutes under memory pressure) can block its promise forever, freezing the
 * whole scan at 10%. The race fires after `budgetMs` and resolves with a
 * timeout sentinel so the pipeline can finish and report the site honestly
 * (the hung scraper's result, if it ever lands, is discarded).
 */
const SCRAPE_TIMEOUT = Symbol("scrape-timeout");
function isScrapeTimeout<T>(v: T | typeof SCRAPE_TIMEOUT): v is typeof SCRAPE_TIMEOUT {
  return v === SCRAPE_TIMEOUT;
}
function withScrapeWatchdog<T>(
  promise: Promise<T>,
  budgetMs: number,
  siteLabel: string,
  // Optional cancellation hook — force-closes the scraper's in-flight browser
  // so the hung scrape's pending Playwright ops REJECT and its own
  // finally-cleanup runs (instead of abandoning a live browser until process
  // exit). Goofish deliberately has no hook — its core lifecycle is protected.
  onTimeout?: () => void,
): Promise<T | typeof SCRAPE_TIMEOUT> {
  return Promise.race([
    promise,
    new Promise<typeof SCRAPE_TIMEOUT>((resolve) => {
      setTimeout(() => {
        console.warn(
          `[Orchestrator] ${siteLabel} exceeded its ${Math.round(budgetMs / 1000)}s budget — reporting timeout (scraper may still be hung in the background)`,
        );
        try {
          onTimeout?.();
        } catch {
          // cancellation is best-effort
        }
        resolve(SCRAPE_TIMEOUT);
      }, budgetMs);
    }),
  ]);
}

/**
 * End-of-scan browser audit — makes leaks VISIBLE in the server log instead
 * of silently accumulating chromium processes. The janitor reaps leftovers;
 * this tells us how many were alive the moment the scan ended.
 */
function logBrowserAudit(taskId: string): void {
  try {
    const n = countLiveBrowserChildren();
    if (n > 0) {
      console.warn(
        `[Orchestrator] Browser audit: ${n} playwright browser child(ren) still alive after scan ${taskId} — the janitor will reap them if they outlive the idle grace period`,
      );
    }
  } catch {
    // audit is best-effort
  }
}

export async function runPipeline(taskId: string): Promise<void> {
  const gen = (pipelineGen.get(taskId) ?? 0) + 1;
  pipelineGen.set(taskId, gen);
  await runPipelineInner(taskId, gen);
}
async function runPipelineInner(taskId: string, gen: number): Promise<void> {
  const state = getTask(taskId);
  if (!state) return;
  noteScanActivity();
  const cfg = resolveConfig(state.configOverrides);
  const patch = (p: Partial<TaskState>) => updateTask(taskId, p);
  // Per-site progress interval handle. Declared OUTSIDE the try block so the
  // catch block (and the cancel-checkpoint early returns) can clear it. Without
  // this hoist, the catch block references an out-of-scope `const` and throws a
  // ReferenceError, which masks the original error AND leaks the interval.
  let progressInterval: ReturnType<typeof setInterval> | null = null;
  const stopProgress = () => {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  };
  // Helper: if the user requested a cancel, finalize the task as "cancelled"
  // and return true so the caller can bail out of the pipeline gracefully.
  const checkCancelled = (at: string): boolean => {
    if (!isCancelRequested(taskId)) return false;
    appendLog(taskId, "WARN", `Cancel requested — aborting pipeline at ${at}`);
    // Stop the per-site progress ticker so it doesn't keep mutating the
    // cancelled task's `step` field (which would overwrite "Cancelled by user").
    stopProgress();
    const cur = getTask(taskId);
    const cancelledState: TaskState = {
      ...(cur ?? state),
      status: "cancelled",
      step: "Cancelled by user",
      progress: cur?.progress ?? 0,
      finishedAt: Date.now(),
      logs: cur?.logs ?? state.logs ?? [],
    };
    setTask(taskId, cancelledState);
    void persistTask(taskId, cancelledState);
    return true;
  };
  try {
    // ─── CONCURRENT SCRAPING ─────────────────────────────────────
    // Run Goofish + OLX + Vinted ALL AT ONCE for maximum speed (unless the
    // user opts out of Vinted via the skip_vinted toggle).
    // Each scraper logs its own site + page progress.
    // Per-site page counts. Each falls back to max_pages when unset / 0.
    const goofishPages = cfg.scraping.goofish_pages && cfg.scraping.goofish_pages > 0
      ? cfg.scraping.goofish_pages
      : cfg.scraping.max_pages;
    const olxPages = cfg.scraping.olx_pages && cfg.scraping.olx_pages > 0
      ? cfg.scraping.olx_pages
      : cfg.scraping.max_pages;
    const vintedPages = cfg.scraping.vinted_pages && cfg.scraping.vinted_pages > 0
      ? cfg.scraping.vinted_pages
      : cfg.scraping.max_pages;
    const kkPages = cfg.scraping.kuantokusta_pages && cfg.scraping.kuantokusta_pages > 0
      ? cfg.scraping.kuantokusta_pages
      : cfg.scraping.max_pages;
    const amazonPages = cfg.scraping.amazon_pages && cfg.scraping.amazon_pages > 0
      ? cfg.scraping.amazon_pages
      : cfg.scraping.max_pages;
    // Skip flags — individual + master switches.
    // skip_new (master) forces skip_kuantokusta + skip_amazon to true.
    // skip_used (master) forces skip_olx + skip_vinted to true.
    const skipVinted = cfg.scraping.skip_vinted === true || cfg.scraping.skip_used === true;
    const skipOlx = cfg.scraping.skip_olx === true || cfg.scraping.skip_used === true;
    const skipKk = cfg.scraping.skip_kuantokusta === true || cfg.scraping.skip_new === true;
    const skipAmazon = cfg.scraping.skip_amazon === true || cfg.scraping.skip_new === true;
    const skippedSites = [
      skipOlx ? "OLX" : null,
      skipVinted ? "Vinted" : null,
      skipKk ? "KuantoKusta" : null,
      skipAmazon ? "Amazon" : null,
    ].filter(Boolean).join(", ") || "none";
    appendLog(taskId, "INFO", `[Config] Pages — Goofish: ${goofishPages}, OLX: ${skipOlx ? "skipped" : olxPages}, Vinted: ${skipVinted ? "skipped" : vintedPages}, KuantoKusta: ${skipKk ? "skipped" : kkPages}, Amazon: ${skipAmazon ? "skipped" : amazonPages} | Skipped: ${skippedSites}`);

    // ── Factual pipeline duration estimation ──
    const isManual = Boolean(state.manualHtml && state.manualHtml.trim().length > 0);
    const activeScrapersCount = [!isManual, !skipOlx, !skipVinted, !skipKk, !skipAmazon].filter(Boolean).length;
    const maxActivePages = Math.max(
      !isManual ? goofishPages : 0,
      !skipOlx ? olxPages : 0,
      !skipVinted ? vintedPages : 0,
      !skipKk ? kkPages : 0,
      !skipAmazon ? amazonPages : 0,
      1,
    );
    const estimatedSec = isManual
      ? Math.max(6, activeScrapersCount * 2 + 4)
      : Math.max(12, Math.round(maxActivePages * 4.5 + (cfg.scraping.enrich_all ? 6 : 2) + 6));

    patch({ estimatedSec });
    appendLog(taskId, "INFO", `[Pipeline] Estimated scan time: ~${estimatedSec}s (${isManual ? "Manual Paste" : `${maxActivePages} page(s)`} + active EU scrapers)`);

    const stepLabel = (() => {
      const active: string[] = ["Goofish"];
      if (!skipOlx) active.push("OLX");
      if (!skipVinted) active.push("Vinted");
      if (!skipKk) active.push("KuantoKusta");
      if (!skipAmazon) active.push("Amazon");
      const skipped: string[] = [];
      if (skipOlx) skipped.push("OLX");
      if (skipVinted) skipped.push("Vinted");
      if (skipKk) skipped.push("KuantoKusta");
      if (skipAmazon) skipped.push("Amazon");
      if (skipped.length === 0) return "Scraping all platforms concurrently…";
      return `Scraping ${active.join(" + ")} concurrently (${skipped.join(" + ")} skipped)…`;
    })();
    patch({ status: "scraping_goofish", progress: 5, step: stepLabel });
    // ── Per-site progress tracking ──────────────────────────────────
    // Updates the step text every few seconds so the user can see which
    // sites are still running vs done. This makes it obvious if one site
    // is stuck (the others will show "done" while it stays "running").
    const siteProgress = {
      goofish: { status: "running", count: 0, label: "Goofish" },
      olx: { status: skipOlx ? "skipped" : "running", count: 0, label: "OLX" },
      vinted: { status: skipVinted ? "skipped" : "running", count: 0, label: "Vinted" },
      kk: { status: skipKk ? "skipped" : "running", count: 0, label: "KuantoKusta" },
      amazon: { status: skipAmazon ? "skipped" : "running", count: 0, label: "Amazon" },
    };
    progressInterval = setInterval(() => {
      // Superseded pipeline (manual-paste resume bumped the generation) —
      // stop mutating the task's step text.
      if (pipelineGen.get(taskId) !== gen) {
        stopProgress();
        return;
      }
      const parts = Object.values(siteProgress).map(s => {
        if (s.status === "skipped") return `${s.label}: ⏭️ skipped`;
        if (s.status === "done") return `${s.label}: ✅ ${s.count} listings`;
        if (s.status === "error") return `${s.label}: ❌ failed`;
        return `${s.label}: ⏳ scraping…`;
      });
      patch({ step: `${parts.join("  |  ")}` });
    }, 3000);
    const warnings: string[] = [];
    let degraded = false;
    // ── Per-scraper status collection ────────────────────────────────
    // Every site's outcome (ok / empty / blocked / error / skipped) is
    // recorded with its count + reason, then surfaced in the UI so the
    // user can see exactly which scrapers produced data and which failed.
    const scraperStatuses: ScraperStatus[] = [];
    const siteTimers: Record<string, number> = {};
    const siteStart = (site: string) => { siteTimers[site] = Date.now(); };
    const siteEnd = (site: string) =>
      siteTimers[site] ? Date.now() - siteTimers[site] : undefined;
    // Classify a scraper's liveFetchStatus string into blocked vs error.
    // Anti-bot markers in the status/warning text → "blocked"; anything
    // else with 0 results and a failure marker → "error".
    const classifySite = (statusText: string | undefined, warning: string | undefined): ScraperStatus["status"] => {
      const combined = `${statusText ?? ""} ${warning ?? ""}`;
      if (/blocked|block page|cloudflare|akamai|datadome|captcha|access denied|client challenge|403|baxia/i.test(combined)) return "blocked";
      if (/failed|error|timeout|timed out|ENOTFOUND|ECONNREFUSED|abort/i.test(combined)) return "error";
      return "empty";
    };
    const recordSite = (
      site: ScraperStatus["site"],
      label: string,
      count: number,
      statusText: string | undefined,
      warning: string | undefined,
      skipped = false,
    ) => {
      const status: ScraperStatus["status"] = skipped
        ? "skipped"
        : count > 0
          ? "ok"
          : classifySite(statusText, warning);
      scraperStatuses.push({
        site,
        label,
        status,
        count,
        detail: skipped ? "Disabled by user config" : (warning ?? statusText ?? undefined),
        durationMs: siteEnd(site),
      });
    };
    // Forex (needed for profit calc, fetch in parallel with scrapers).
    // Pass the task's RESOLVED rate so the user's UI override is honored
    // when the live API is unreachable.
    const forexPromise = getCnyToEurRate(cfg.forex.cny_to_eur_rate);
    // ── Goofish (source listings) ──
    const goofishPromise = (async () => {
      const minPrice = cfg.scraping.min_price_cny || 0;
      const maxPrice = cfg.scraping.max_price_cny || 0;
      const priceFilterInfo =
        minPrice > 0 || maxPrice > 0
          ? ` [Filter: ${minPrice > 0 ? `¥${minPrice} (~€${Math.round(minPrice * cfg.forex.cny_to_eur_rate)})` : "¥0"} - ${maxPrice > 0 ? `¥${maxPrice} (~€${Math.round(maxPrice * cfg.forex.cny_to_eur_rate)})` : "∞"}]`
          : "";

      siteStart("goofish");
      if (state.manualHtml && state.manualHtml.trim().length > 0) {
        appendLog(taskId, "INFO", `[Goofish] Manual paste mode${priceFilterInfo}`);
        const { parseManualPasteHtml } = await import("@/lib/scrapers/goofish");
        const parsed = parseManualPasteHtml(state.manualHtml, state.query, {
          minPriceCny: cfg.scraping.min_price_cny,
          maxPriceCny: cfg.scraping.max_price_cny,
        });
        appendLog(taskId, "SUCCESS", `[Goofish] ${parsed.length} listings from manual paste`);
        parsed.slice(0, 15).forEach((item, idx) => {
          const eur = Math.round(item.priceCny * 0.13 * 100) / 100;
          const flagText = item.conditionFlags && item.conditionFlags.length > 0 ? ` [Flags: ${item.conditionFlags.join(", ")}]` : "";
          appendLog(taskId, "INFO", `[Goofish] #${idx + 1} ${item.title.slice(0, 50)} — ¥${item.priceCny.toFixed(2)} (${eur.toFixed(2)} €)${flagText}`);
        });
        siteProgress.goofish.status = "done";
        siteProgress.goofish.count = parsed.length;
        recordSite("goofish", "Goofish (闲鱼)", parsed.length, `Manual paste: ${parsed.length} listings`, undefined);
        return parsed;
      }
      appendLog(taskId, "INFO", `[Goofish] Searching goofish.com for "${state.query}" (up to ${goofishPages} pages)${priceFilterInfo}…`);
      const r = await scrapeGoofish(state.query, state.category, {
        minPriceCny: cfg.scraping.min_price_cny,
        maxPriceCny: cfg.scraping.max_price_cny,
        maxPages: goofishPages,
        enrichAll: cfg.scraping.enrich_all === true,
      });
      if (r.warning) { warnings.push(r.warning); appendLog(taskId, "WARN", `[Goofish] ${r.warning}`); }
      if (r.liveFetchStatus) appendLog(taskId, "INFO", `[Goofish] ${r.liveFetchStatus}`);
      if (r.degraded) degraded = true;
      appendLog(taskId, "SUCCESS", `[Goofish] ${r.listings.length} listings acquired`);
      r.listings.slice(0, 15).forEach((item, idx) => {
        const eur = Math.round(item.priceCny * 0.13 * 100) / 100;
        const flagText = item.conditionFlags && item.conditionFlags.length > 0 ? ` [Flags: ${item.conditionFlags.join(", ")}]` : "";
        appendLog(taskId, "INFO", `[Goofish] #${idx + 1} ${item.title.slice(0, 50)} — ¥${item.priceCny.toFixed(2)} (${eur.toFixed(2)} €)${flagText}`);
      });
      siteProgress.goofish.status = "done";
      siteProgress.goofish.count = r.listings.length;
      recordSite("goofish", "Goofish (闲鱼)", r.listings.length, r.liveFetchStatus, r.blocked ? "Goofish blocked the search (Baxia CAPTCHA) — Manual Paste recommended" : r.warning);
      return r.listings;
    })();
    // ── OLX (EU comps) — skippable via config flag ──
    const olxPromise: Promise<EuMarketComp[]> = skipOlx
      ? Promise.resolve([])
      : (async () => {
          siteStart("olx");
          appendLog(taskId, "INFO", `[OLX] Searching olx.pt for "${state.query}" (up to ${olxPages} pages)…`);
          const r = await scrapeOlx(null, state.query, { maxPages: olxPages });
          if (r.liveFetchStatus) appendLog(taskId, "INFO", `[OLX] ${r.liveFetchStatus}`);
          appendLog(taskId, "SUCCESS", `[OLX] ${r.comps.length} comps acquired`);
          r.comps.slice(0, 10).forEach((comp, idx) => {
            appendLog(taskId, "INFO", `[OLX] Comp #${idx + 1}: ${comp.title.slice(0, 50)} — ${comp.priceEur.toFixed(2)} €`);
          });
          if (r.warning) warnings.push(`OLX: ${r.warning}`);
          if (r.degraded) degraded = true;
          siteProgress.olx.status = "done";
          siteProgress.olx.count = r.comps.length;
          recordSite("olx", "OLX.pt", r.comps.length, r.liveFetchStatus, r.warning);
          return r.comps;
        })();
    if (skipOlx) {
      recordSite("olx", "OLX.pt", 0, undefined, undefined, true);
      appendLog(taskId, "INFO", "[OLX] Skipped by user (skip_olx=true) — proceeding with Vinted-only comparison");
    }
    // ── Vinted (EU comps) — skippable via config flag ──
    const vintedPromise: Promise<EuMarketComp[]> = skipVinted
      ? Promise.resolve([])
      : (async () => {
          siteStart("vinted");
          appendLog(taskId, "INFO", `[Vinted] Searching vinted.pt for "${state.query}" (up to ${vintedPages} pages)…`);
          const r = await scrapeVinted(null, state.query, { maxPages: vintedPages });
          if (r.liveFetchStatus) appendLog(taskId, "INFO", `[Vinted] ${r.liveFetchStatus}`);
          appendLog(taskId, "SUCCESS", `[Vinted] ${r.comps.length} comps acquired`);
          r.comps.slice(0, 10).forEach((comp, idx) => {
            appendLog(taskId, "INFO", `[Vinted] Comp #${idx + 1}: ${comp.title.slice(0, 50)} — ${comp.priceEur.toFixed(2)} €`);
          });
          if (r.warning) warnings.push(`Vinted: ${r.warning}`);
          if (r.degraded) degraded = true;
          siteProgress.vinted.status = "done";
          siteProgress.vinted.count = r.comps.length;
          recordSite("vinted", "Vinted.pt", r.comps.length, r.liveFetchStatus, r.warning);
          return r.comps;
        })();
    if (skipVinted) {
      recordSite("vinted", "Vinted.pt", 0, undefined, undefined, true);
      appendLog(taskId, "INFO", "[Vinted] Skipped by user (skip_vinted=true) — proceeding with OLX-only comparison");
    }
    // ── KuantoKusta (NEW retail comps) — skippable via config flag ──
    // KuantoKusta is a Portuguese price-comparison site; every result is a
    // NEW product sold at retail (VAT-inclusive) prices. These comps give
    // the engine a "new retail price" baseline alongside the second-hand
    // OLX/Vinted resale prices.
    const kkPromise: Promise<EuMarketComp[]> = skipKk
      ? Promise.resolve([])
      : (async () => {
          siteStart("kuantokusta");
          appendLog(taskId, "INFO", `[KuantoKusta] Searching kuantokusta.pt for "${state.query}" (up to ${kkPages} pages)…`);
          const r = await scrapeKuantokusta(null, state.query, { maxPages: kkPages });
          if (r.liveFetchStatus) appendLog(taskId, "INFO", `[KuantoKusta] ${r.liveFetchStatus}`);
          appendLog(taskId, "SUCCESS", `[KuantoKusta] ${r.comps.length} NEW retail comps acquired`);
          r.comps.slice(0, 10).forEach((comp, idx) => {
            appendLog(taskId, "INFO", `[KuantoKusta] Comp #${idx + 1}: ${comp.title.slice(0, 50)} — ${comp.priceEur.toFixed(2)} €`);
          });
          if (r.warning) warnings.push(`KuantoKusta: ${r.warning}`);
          if (r.degraded) degraded = true;
          siteProgress.kk.status = "done";
          siteProgress.kk.count = r.comps.length;
          recordSite("kuantokusta", "KuantoKusta.pt", r.comps.length, r.liveFetchStatus, r.warning);
          return r.comps;
        })();
    if (skipKk) {
      recordSite("kuantokusta", "KuantoKusta.pt", 0, undefined, undefined, true);
      appendLog(taskId, "INFO", "[KuantoKusta] Skipped by user (skip_kuantokusta=true or skip_new=true)");
    }
    // ── Amazon.es (NEW retail comps) — skippable via config flag ──
    // Amazon.es serves Portugal (amazon.pt redirects here). Every result is
    // a NEW product at retail EUR prices. Paired with KuantoKusta, these
    // comps form the "new retail price" tier for new-vs-used comparison.
    const amazonPromise: Promise<EuMarketComp[]> = skipAmazon
      ? Promise.resolve([])
      : (async () => {
          siteStart("amazon");
          appendLog(taskId, "INFO", `[Amazon] Searching amazon.es for "${state.query}" (up to ${amazonPages} pages)…`);
          const r = await scrapeAmazon(null, state.query, { maxPages: amazonPages });
          if (r.liveFetchStatus) appendLog(taskId, "INFO", `[Amazon] ${r.liveFetchStatus}`);
          appendLog(taskId, "SUCCESS", `[Amazon] ${r.comps.length} NEW retail comps acquired`);
          r.comps.slice(0, 10).forEach((comp, idx) => {
            appendLog(taskId, "INFO", `[Amazon] Comp #${idx + 1}: ${comp.title.slice(0, 50)} — ${comp.priceEur.toFixed(2)} €`);
          });
          if (r.warning) warnings.push(`Amazon: ${r.warning}`);
          if (r.degraded) degraded = true;
          siteProgress.amazon.status = "done";
          siteProgress.amazon.count = r.comps.length;
          recordSite("amazon", "Amazon.es", r.comps.length, r.liveFetchStatus, r.warning);
          return r.comps;
        })();
    if (skipAmazon) {
      recordSite("amazon", "Amazon.es", 0, undefined, undefined, true);
      appendLog(taskId, "INFO", "[Amazon] Skipped by user (skip_amazon=true or skip_new=true)");
    }
    // Wait for all scrapers to finish concurrently. Each scraper is wrapped
    // in a watchdog budget (see withScrapeWatchdog): goofish gets 11 min
    // (its internal overall budget is up to 10 min), EU scrapers 9 min
    // (their bounded retries top out around 8 min). A timeout resolves as
    // SCRAPE_TIMEOUT and is reported as an honest per-site error below.
    patch({ progress: 10, step: stepLabel });
    const [goofishRaw, olxRaw, vintedRaw, kkRaw, amazonRaw, forex] = await Promise.all([
      withScrapeWatchdog(goofishPromise, 660_000, "Goofish"),
      withScrapeWatchdog(olxPromise, 540_000, "OLX", forceCloseSharedBrowser),
      withScrapeWatchdog(vintedPromise, 540_000, "Vinted", forceCloseVintedBrowser),
      withScrapeWatchdog(kkPromise, 540_000, "KuantoKusta", forceCloseKkBrowser),
      withScrapeWatchdog(amazonPromise, 540_000, "Amazon", forceCloseAmazonBrowser),
      forexPromise,
    ]);
    // Stop the per-site progress updates — all scrapers are done
    stopProgress();
    // Watchdog firings: report the site as an error so the UI shows WHY it
    // produced nothing instead of hanging forever, and swap the sentinel for
    // an empty array so downstream code sees plain arrays.
    if (isScrapeTimeout(goofishRaw)) {
      recordSite("goofish", "Goofish (闲鱼)", 0, undefined, `Scraper watchdog: exceeded its time budget (possible hung browser session under memory pressure). Its result, if any, was discarded.`);
      warnings.push("Goofish: scraper watchdog timeout — result discarded.");
      degraded = true;
      appendLog(taskId, "WARN", "[ScraperStatus] ⏱️ Goofish: TIMEOUT — exceeded budget, reported as failed");
    }
    if (isScrapeTimeout(olxRaw)) {
      recordSite("olx", "OLX.pt", 0, undefined, "Scraper watchdog: exceeded its time budget (possible hung browser session under memory pressure).");
      warnings.push("OLX: scraper watchdog timeout — result discarded.");
      degraded = true;
      appendLog(taskId, "WARN", "[ScraperStatus] ⏱️ OLX: TIMEOUT — exceeded budget, reported as failed");
    }
    if (isScrapeTimeout(vintedRaw)) {
      recordSite("vinted", "Vinted.pt", 0, undefined, "Scraper watchdog: exceeded its time budget (possible hung browser session under memory pressure).");
      warnings.push("Vinted: scraper watchdog timeout — result discarded.");
      degraded = true;
      appendLog(taskId, "WARN", "[ScraperStatus] ⏱️ Vinted: TIMEOUT — exceeded budget, reported as failed");
    }
    if (isScrapeTimeout(kkRaw)) {
      recordSite("kuantokusta", "KuantoKusta.pt", 0, undefined, "Scraper watchdog: exceeded its time budget (possible hung browser session under memory pressure).");
      warnings.push("KuantoKusta: scraper watchdog timeout — result discarded.");
      degraded = true;
      appendLog(taskId, "WARN", "[ScraperStatus] ⏱️ KuantoKusta: TIMEOUT — exceeded budget, reported as failed");
    }
    if (isScrapeTimeout(amazonRaw)) {
      recordSite("amazon", "Amazon.es", 0, undefined, "Scraper watchdog: exceeded its time budget (possible hung browser session under memory pressure).");
      warnings.push("Amazon: scraper watchdog timeout — result discarded.");
      degraded = true;
      appendLog(taskId, "WARN", "[ScraperStatus] ⏱️ Amazon: TIMEOUT — exceeded budget, reported as failed");
    }
    // Narrow away the timeout sentinel: downstream code expects arrays.
    const goofishListings = isScrapeTimeout(goofishRaw) ? [] : goofishRaw;
    const olxComps = isScrapeTimeout(olxRaw) ? [] : olxRaw;
    const vintedComps = isScrapeTimeout(vintedRaw) ? [] : vintedRaw;
    const kkComps = isScrapeTimeout(kkRaw) ? [] : kkRaw;
    const amazonComps = isScrapeTimeout(amazonRaw) ? [] : amazonRaw;
    for (const s of ["goofish", "olx", "vinted", "kk", "amazon"] as const) {
      const raw = s === "goofish" ? goofishRaw : s === "olx" ? olxRaw : s === "vinted" ? vintedRaw : s === "kk" ? kkRaw : amazonRaw;
      if (isScrapeTimeout(raw)) {
        siteProgress[s].status = "done";
        siteProgress[s].count = 0;
      }
    }
    // Guard: a scraper promise that REJECTED (should never happen — every
    // scraper catches internally) would leave its site unrecorded. Fill any
    // gap with an error status so the UI always shows all five sites.
    const recordedSites = new Set(scraperStatuses.map((s) => s.site));
    const siteLabels: Record<ScraperStatus["site"], string> = {
      goofish: "Goofish (闲鱼)",
      olx: "OLX.pt",
      vinted: "Vinted.pt",
      kuantokusta: "KuantoKusta.pt",
      amazon: "Amazon.es",
    };
    (Object.keys(siteLabels) as ScraperStatus["site"][]).forEach((site) => {
      if (!recordedSites.has(site)) {
        scraperStatuses.push({ site, label: siteLabels[site], status: "error", count: 0, detail: "Scraper crashed before reporting" });
      }
    });
    // Defensive guard: scraper should always return an array, but if corrupted
    // data somehow produced a plain object, ensureArray prevents .map() crashes.
    let listings = ensureArray(goofishListings);
    appendLog(taskId, "INFO", `[Forex] CNY→EUR rate=${forex.rate} (source: ${forex.source})`);
    if (forex.source === "fallback") {
      warnings.push(`Forex API unreachable; using fallback rate ${forex.rate}.`);
    }
    // ── Cancel checkpoint: between scraping and calculating ──
    if (checkCancelled("post-scrape")) return;
    patch({ progress: 60, step: "All scrapers complete. Calculating profitability…", warnings, degraded });
    // If Goofish returned 0, create synthetic listing
    if (listings.length === 0) {
      appendLog(taskId, "WARN", "Goofish returned 0 listings — using synthetic listing for EU price comparison");
      const { normalizeListing } = await import("@/lib/engine/normalizer");
      listings = [{
        id: `synthetic-${Date.now()}`,
        title: state.query,
        priceCny: 0,
        description: "Synthetic listing (Goofish returned 0)",
        imageUrls: [], sellerLocation: "未知", wantsCount: 0,
        sellerVerified: false, sellerVerifiedTransactions: 0,
        rawText: state.query, source: "goofish" as const,
        normalized: normalizeListing(state.query, state.query),
        synthetic: true,
      }];
    }
    // Strict per-listing comp filtering (Phase 10): run the matching engine
    // against each listing's normalized product so cross-tier false positives
    // (e.g. "Pro Max" comps for a "Pro" product) never reach the resale
    // median. Previously the raw comp pool was attached unfiltered —
    // filterRelevantComps was imported but never applied in the pipeline.
    const allComps = [...olxComps, ...vintedComps, ...kkComps, ...amazonComps];
    const compsByListing = new Map<string, EuMarketComp[]>();
    for (const l of listings) {
      const relevant = l.normalized
        ? filterRelevantComps(allComps, l.normalized, 40)
        : allComps;
      if (l.normalized && relevant.length < allComps.length) {
        appendLog(taskId, "INFO", `[Match] ${l.normalized.standardKey}: ${relevant.length}/${allComps.length} comps passed strict family/tier matching`);
      }
      compsByListing.set(l.id, relevant);
    }
    appendLog(taskId, "SUCCESS", `Scraping complete — ${listings.length} Goofish listings, ${olxComps.length} OLX, ${vintedComps.length} Vinted, ${kkComps.length} KuantoKusta (new), ${amazonComps.length} Amazon (new)`);
    // Per-scraper status summary line so the terminal console shows which
    // sites produced data and which failed at a glance.
    scraperStatuses.forEach((s) => {
      const icon = s.status === "ok" ? "✅" : s.status === "empty" ? "⚠️" : s.status === "blocked" ? "🚫" : s.status === "error" ? "❌" : "⏭️";
      const secs = s.durationMs ? ` (${(s.durationMs / 1000).toFixed(1)}s)` : "";
      appendLog(taskId, s.status === "ok" ? "SUCCESS" : "WARN", `[ScraperStatus] ${icon} ${s.label}: ${s.status.toUpperCase()} — ${s.count} results${secs}${s.detail ? ` | ${s.detail.substring(0, 140)}` : ""}`);
    });
    patch({ progress: 70, step: "Calculating landed cost & profitability…", warnings, degraded });
    // ---------- Phase 3: Calculating ----------
    patch({ status: "calculating", progress: 75 });
    appendLog(taskId, "INFO", `[Calc] Phase 3 — running scam detection + landed cost + profit analysis on ${listings.length} listings`);
    // Load DB-backed reference prices (admin-editable; seeded from JSON on
    // first access) so scam-detection + profit-calc use current baselines.
    const refPrices = await getReferencePrices();
    appendLog(taskId, "INFO", `[Calc] Loaded ${Object.keys(refPrices).length} reference price entries from DB`);
    const evaluated: EvaluatedListing[] = listings.map((listing) => {
      const comps = compsByListing.get(listing.id) ?? [];
      const scam = detectScam(listing, cfg, refPrices);
      const profit = computeProfit(
        listing.priceCny,
        listing.normalized,
        comps,
        forex.rate,
        cfg,
        refPrices,
      );
      // Log the CNY→EUR conversion for each listing so the user can verify
      // the conversion is happening correctly
      const key = listing.normalized?.standardKey ?? state.query;
      appendLog(taskId, "INFO",
        `[Calc] ¥${listing.priceCny} → €${profit.landed.acquisitionCostEur.toFixed(0)} acq + €${(profit.landed.totalLandedCostEur - profit.landed.acquisitionCostEur).toFixed(0)} fees = €${profit.landed.totalLandedCostEur.toFixed(0)} landed | resale €${profit.expectedResaleEur.toFixed(0)} | profit €${profit.netProfitEur.toFixed(0)} | ${key.substring(0, 30)}${profit.hidden ? " (FILTERED)" : ""}`
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
      return { listing, scam, profit, euComps: comps, hidden, hiddenReason };
    });
    const droppedCount = evaluated.filter((e) => e.scam.dropped).length;
    const hiddenCount = evaluated.filter((e) => e.hidden).length;
    appendLog(taskId, "INFO", `[Calc] Scam: ${droppedCount} auto-dropped, risk-scores computed`);
    appendLog(taskId, "INFO", `[Calc] Profitability: ${hiddenCount} filtered out, ${evaluated.length - hiddenCount} viable`);
    // ── Cancel checkpoint: before assembling the final result ──
    if (checkCancelled("post-calc")) return;
    patch({ progress: 92, step: "Assembling result sheet…" });
    const summary = buildSummary(evaluated, cfg);
    const result: TaskResult = {
      taskId,
      query: state.query,
      category: state.category,
      status: "done",
      listings: evaluated,
      summary,
      warnings,
      degraded,
      scraperStatuses,
      createdAt: new Date(state.startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
    };
    // ── Supersession guard ─────────────────────────────────────────
    // If a manual-paste resume bumped the generation while this run was
    // scraping, this run is obsolete — its result must NOT overwrite the
    // new pipeline's state.
    if (pipelineGen.get(taskId) !== gen) {
      stopProgress();
      return;
    }
    const finalState: TaskState = {
      // Refresh from the store to pick up any mutations (e.g. manualHtml set
      // via resumeWithManualPaste after the original `state` capture) instead
      // of spreading the stale `state` captured at pipeline start.
      ...(getTask(taskId) ?? state),
      status: "done",
      progress: 100,
      step: `Done — ${summary.shown} viable leads of ${summary.total} listings`,
      result,
      warnings,
      degraded,
      finishedAt: Date.now(),
      logs: getTask(taskId)?.logs ?? state.logs ?? [],
    };
    setTask(taskId, finalState);
    appendLog(taskId, "SUCCESS", `Pipeline complete — ${summary.shown}/${summary.total} viable, best profit €${Math.round(summary.bestProfitEur)}, avg margin ${summary.avgMarginPct}%`);
    await persistTask(taskId, finalState);
    noteScanActivity();
    logBrowserAudit(taskId);
  } catch (err) {
    stopProgress();
    // Superseded run — don't stamp "Pipeline error" over a newer run's state.
    if (pipelineGen.get(taskId) !== gen) return;
    const message = err instanceof Error ? err.message : String(err);
    appendLog(taskId, "ERROR", `Pipeline error: ${message}`);
    const cur = getTask(taskId);
    const errState: TaskState = {
      ...(cur ?? state),
      status: "error",
      step: "Pipeline error",
      error: message,
      progress: cur?.progress ?? 0,
      logs: cur?.logs ?? state.logs ?? [],
    };
    setTask(taskId, errState);
    await persistTask(taskId, errState);
    noteScanActivity();
    logBrowserAudit(taskId);
  }
}
/**
 * Resume a paused/blocked task using manually-pasted Goofish DOM HTML.
 * Stores the manual HTML on the task state, then re-runs the pipeline —
 * which detects the manual HTML and parses it directly instead of hitting
 * the live Goofish scraper (spec §2.1 graceful degradation).
 */
export async function resumeWithManualPaste(
  taskId: string,
  manualHtml: string,
): Promise<TaskState | undefined> {
  const cur = getTask(taskId);
  if (!cur) return undefined;
  updateTask(taskId, {
    manualHtml,
    status: "pending",
    step: "Resuming from manual paste…",
    error: undefined,
    progress: 5,
  });
  appendLog(taskId, "INFO", "Manual paste received — resuming pipeline with user-supplied Goofish DOM HTML");
  void runPipeline(taskId);
  return getTask(taskId);
}