// scrapers/vinted.ts
// Vinted Portugal scraper — Playwright real-browser strategy with
// Datadome-aware session handling.
//
// Vinted sits behind Datadome ("Client Challenge" interstitial). The
// challenge is solved by real browser JS — but ONLY when the browser
// fingerprint is credible. Two detection vectors matter:
//   1. Headless-shell fingerprints → challenge never resolves.
//      Fix: launch the FULL Chromium engine (channel "chromium") first,
//      which is byte-identical to a regular Chrome minus the window.
//   2. UA ↔ engine version mismatch (e.g. a Chrome/131 UA on a Chromium
//      149 engine) — Datadome cross-checks Sec-Ch-Ua against the real
//      engine. Fix: read the browser's REAL version at runtime and build
//      a matching UA + Sec-Ch-Ua header pair.
// Degradation: if the challenge still fails, the scraper returns an
// accurate "blocked" status so the UI can show exactly why Vinted has no
// results, and the pipeline proceeds with OLX-only comparison.
import { config } from "@/lib/config";
import type { EuMarketComp, NormalizedProduct } from "@/lib/engine/types";
import { buildEuQuery } from "@/lib/engine/matcher";
import { isTitleRelevantToQuery } from "@/lib/engine/relevance";
import { isAccessoryTitle } from "./utils";
export interface VintedScrapeResult {
  comps: EuMarketComp[];
  degraded: boolean;
  warning?: string;
  authFailed?: boolean;
  liveFetchStatus?: string; // human-readable status of the live fetch attempt
}
function extractBrandFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("samsung") || t.includes("galaxy")) return "Samsung";
  if (t.includes("xiaomi") || t.includes("redmi") || t.includes("poco")) return "Xiaomi";
  if (t.includes("dji")) return "DJI";
  if (t.includes("nintendo") || t.includes("switch")) return "Nintendo";
  if (t.includes("xbox")) return "Microsoft";
  if (t.includes("sony") || t.includes("playstation") || t.includes("ps5")) return "Sony";
  if (t.includes("iphone") || t.includes("ipad") || t.includes("macbook") || t.includes("apple watch") || t.includes("airpods")) return "Apple";
  return "Unknown";
}
function buildVintedSearchUrl(query: string, page: number = 1): string {
  const base = `${config.scraping.vinted_search_url}catalog?search_text=${encodeURIComponent(query)}`;
  return page > 1 ? `${base}&page=${page}` : base;
}
/**
 * Read the browser's real Chromium version at runtime and derive a
 * matching UA + Sec-Ch-Ua pair. Datadome compares the User-Agent's
 * Chrome version against Sec-Ch-Ua AND the actual JS engine — a
 * mismatched pair is an instant flag. This keeps the headers honest
 * regardless of which Playwright version is installed.
 */
async function buildMatchingUa(page: import("playwright").Page): Promise<{
  userAgent: string;
  secChUa: string;
}> {
  try {
    const ver = await page.evaluate(() => {
      const m = navigator.userAgent.match(/Chrome\/(\d+)/);
      return m ? parseInt(m[1], 10) : 131;
    });
    const version = Number.isFinite(ver) ? ver : 131;
    return {
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`,
      secChUa: `"Chromium";v="${version}", "Not_A Brand";v="24", "Google Chrome";v="${version}"`,
    };
  } catch {
    return {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      secChUa: '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    };
  }
}
/**
 * Launch a browser with a credible fingerprint. Order of preference:
 *   1. FULL Chromium engine in new-headless mode (channel "chromium") —
 *      indistinguishable from regular Chrome for Datadome's canvas /
 *      WebGL / font probes. Works when the headless SHELL fails.
 *   2. Default Playwright headless (shell) — fallback when the full
 *      engine binary isn't installed.
 */
async function launchVintedBrowser(): Promise<import("playwright").Browser> {
  const { chromium } = await import("playwright");
  // Preferred: full engine (new headless) — much harder to fingerprint.
  try {
    return await chromium.launch({
      headless: true,
      channel: "chromium",
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
  } catch {
    // Full-engine binary missing — fall back to the default headless shell.
    return await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
  }
}
// Selectors that prove the real catalog rendered (challenge cleared).
const CATALOG_SELECTORS = [
  "[data-testid='catalog-item']",
  "[class*='feed-grid'] a[href*='/items/']",
  "a[href*='/items/']",
  "[class*='ItemBox']",
  "[class*='item-box']",
  "[class*='u-word-break']",
];
// Datadome interstitial markers (any language variant).
const CHALLENGE_TITLE = /client challenge|um momento|please wait|verificando|attention/i;
const CHALLENGE_BODY = /verificando se você|please wait|um momento|verifying you are human/i;
function looksLikeChallenge(title: string, bodyText: string): boolean {
  return CHALLENGE_TITLE.test(title) || CHALLENGE_BODY.test(bodyText.substring(0, 400));
}
/**
 * Scrape real Vinted.pt listings using Playwright (real browser).
 * Waits up to 35s for the Datadome challenge to clear (it auto-solves
 * on credible fingerprints), then extracts listing data from the DOM.
 */
async function scrapeVintedLive(euQuery: string, maxPages: number): Promise<{ comps: EuMarketComp[]; status: string; blocked: boolean }> {
  const browser = await launchVintedBrowser();
  try {
    // ── Page 1 + Datadome challenge wait ─────────────────────────────
    // The challenge can take 5-20s to auto-solve. Poll for real catalog
    // content (not just a title change — the interstitial title flips to
    // "Vinted" while the body still says "Please wait").
    const ctx = await browser.newContext({
      locale: "pt-PT",
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: { "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8" },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await ctx.newPage();
    // Build an engine-matched UA AFTER the first navigation revealed the
    // real Chromium version, then apply it to the context.
    const ua = await buildMatchingUa(page);
    await page.close();
    await ctx.close();
    const ctx2 = await browser.newContext({
      userAgent: ua.userAgent,
      locale: "pt-PT",
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: {
        "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
        "Sec-Ch-Ua": ua.secChUa,
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
      },
    });
    await ctx2.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page2 = await ctx2.newPage();
    const allItems: Array<{ title: string; priceEur: number; condition: string; brand: string; url?: string }> = [];
    const seenTitles = new Set<string>();
    try {
      // ── Step 0: Homepage warm-up ─────────────────────────────────────
      // Verified live: the Datadome challenge clears MUCH more readily on
      // the bare homepage than on a deep catalog link (observed: homepage
      // cleared in ~4s on a flagged IP while the catalog deep-link stayed
      // challenged). Clearing it here sets the datadome cookie in ctx2, so
      // the subsequent catalog navigation skips the challenge entirely.
      // If the homepage still doesn't clear, fall through — the catalog
      // attempt below keeps its own 35s challenge wait.
      try {
        await page2.goto("https://www.vinted.pt/", { waitUntil: "domcontentloaded", timeout: 25000 });
        const HOME_WAIT_MS = 20000;
        const h0 = Date.now();
        while (Date.now() - h0 < HOME_WAIT_MS) {
          const hState = await page2.evaluate(() => ({
            title: document.title || "",
            body: (document.body?.innerText || "").substring(0, 300),
            homeMarkers: document.querySelectorAll("a[href*='/items/'], header, [class*='header']").length,
          })).catch(() => ({ title: "", body: "", homeMarkers: 0 }));
          const challenged = looksLikeChallenge(hState.title, hState.body);
          if (!challenged && (hState.homeMarkers > 0 || hState.body.length > 100)) break;
          if (!challenged && hState.title.toLowerCase().includes("vinted")) break;
          await page2.waitForTimeout(1500);
        }
      } catch {
        // homepage warm-up is best-effort — ignore failures
      }

      const firstUrl = buildVintedSearchUrl(euQuery, 1);
      await page2.goto(firstUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      let challengeCleared = false;
      const CHALLENGE_WAIT_MS = 35000;
      const t0 = Date.now();
      while (Date.now() - t0 < CHALLENGE_WAIT_MS) {
        const state = await page2.evaluate(() => {
          let found = 0;
          for (const sel of ["a[href*='/items/']", "[data-testid='catalog-item']"]) {
            const n = document.querySelectorAll(sel).length;
            if (n > 0) { found = n; break; }
          }
          return {
            found,
            title: document.title || "",
            body: (document.body?.innerText || "").substring(0, 300),
          };
        }).catch(() => ({ found: 0, title: "", body: "" }));
        if (state.found > 0) {
          challengeCleared = true;
          break;
        }
        // Page is a hard error (403 HTML has no challenge interstitial)
        if (state.title && !CHALLENGE_TITLE.test(state.title) && !looksLikeChallenge(state.title, state.body)) {
          // Real page rendered but maybe zero results — check once more
          // for catalog markers before declaring a clean 0-result page.
          const anyCatalog = await page2.evaluate(() => document.body?.innerHTML.length || 0).catch(() => 0);
          if (anyCatalog > 5000) { challengeCleared = true; break; }
        }
        await page2.waitForTimeout(1500);
      }
      if (!challengeCleared) {
        const finalTitle = await page2.title().catch(() => "");
        return {
          comps: [],
          status: `LIVE FETCH BLOCKED: Datadome anti-bot challenge did not clear after ${CHALLENGE_WAIT_MS / 1000}s (final page: "${finalTitle}"). This IP/browser fingerprint is flagged by Vinted — try from a residential IP or use a different network.`,
          blocked: true,
        };
      }
      // ── Catalog extraction, page by page ───────────────────────────
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        if (pageNum > 1) {
          const url = buildVintedSearchUrl(euQuery, pageNum);
          await page2.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page2.waitForTimeout(2500);
        } else {
          // We're already on page 1 (challenge cleared there)
          await page2.waitForTimeout(2000);
        }
        await page2.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
        await page2.waitForTimeout(1500);
        const pageItems = await page2.evaluate(() => {
          const items: Array<{ title: string; priceEur: number; condition: string; brand: string; url?: string }> = [];
          const selectors = ["[class*='feed-grid__item']", "[class*='ItemBox']", "[class*='item-box']", "[data-testid='catalog-item']", "[class*='u-word-break']"];
          let cards: Element[] = [];
          for (const sel of selectors) {
            const found = document.querySelectorAll(sel);
            if (found.length > 0) { cards = Array.from(found); break; }
          }
          // Fallback: individual /items/ anchors — build cards from them
          if (cards.length === 0) {
            const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/items/']"));
            const seenHref = new Set<string>();
            cards = anchors.filter((a) => {
              const href = a.href.split("?")[0];
              if (seenHref.has(href)) return false;
              seenHref.add(href);
              return true;
            });
          }
          cards.forEach((card) => {
            const allText = (card.textContent || "").replace(/\s+/g, " ").trim();
            // EU/PT currency format: spaces (incl. NBSP) as thousands
            // separators, comma decimals — e.g. "1 250 €" or "1 050,00 €".
            const priceMatch = allText.match(/(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/);
            const titleEl = card.querySelector("a, h3, h4, [class*='title']");
            const title = titleEl?.textContent?.trim() || allText.substring(0, 80);
            const priceEur = priceMatch ? parseFloat(priceMatch[1].replace(/[\s.\u00A0]/g, "").replace(",", ".")) : 0;
            let condition = "very_good";
            if (allText.includes("Novo")) condition = "new";
            else if (allText.includes("Como novo")) condition = "excellent";
            else if (allText.includes("Bom estado")) condition = "good";
            // Direct listing URL: prefer the Vinted item anchor (/items/…),
            // fall back to the first anchor href inside the card.
            const itemLink = card.querySelector<HTMLAnchorElement>("a[href*='/items/']")
              || (card instanceof HTMLAnchorElement && card.href.includes("/items/") ? card as HTMLAnchorElement : null)
              || card.querySelector<HTMLAnchorElement>("a[href]");
            const url = itemLink?.href || undefined;
            if (title && priceEur > 0) items.push({ title: title.substring(0, 120), priceEur, condition, brand: extractBrandFromTitle(title), url });
          });
          return items;
        }).catch(() => []);
        let newCount = 0;
        for (const item of pageItems) {
          // Filter out accessories and junk prices:
          if (item.priceEur < 100 || item.priceEur > 3000) continue;
          if (isAccessoryTitle(item.title)) continue;
          // Generation-aware relevance: reject wrong models for the query
          if (!isTitleRelevantToQuery(item.title, euQuery)) continue;
          if (!seenTitles.has(item.title)) {
            seenTitles.add(item.title);
            allItems.push(item);
            newCount++;
          }
        }
        if (newCount === 0) break;
      }
      return {
        comps: allItems.map((c, i) => ({
          id: `vinted-live-${i}`,
          platform: "vinted" as const,
          title: c.title,
          priceEur: c.priceEur,
          condition: c.condition as EuMarketComp["condition"],
          url: c.url,
          location: "Portugal",
          brand: c.brand,
          sellerStars: 4.5,
        })),
        status: allItems.length > 0
          ? `LIVE OK (Playwright, ${allItems.length} comps from ${maxPages} pages)`
          : "LIVE FETCH OK but 0 comps parsed — search returned no matching items on Vinted.pt",
        blocked: false,
      };
    } finally {
      await ctx2.close().catch(() => {});
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { comps: [], status: `LIVE FETCH FAILED: ${msg}`, blocked: false };
  } finally {
    await browser.close().catch(() => {});
  }
}
export async function scrapeVinted(
  product: NormalizedProduct | null,
  query: string,
  opts?: { maxPages?: number },
): Promise<VintedScrapeResult> {
  const euQuery = product ? buildEuQuery(product) : query;
  const maxPages = opts?.maxPages && opts.maxPages > 0 ? opts.maxPages : config.scraping.max_pages;
  // ─── LIVE MODE (Playwright) ──────────────────────────────────
  const { comps, status, blocked } = await scrapeVintedLive(euQuery, maxPages);
  if (comps.length > 0) {
    return {
      comps,
      degraded: false,
      liveFetchStatus: status,
    };
  }
  // Return an honest degraded result with the precise reason — the UI's
  // scraper-status panel shows exactly why Vinted produced nothing.
  return {
    comps: [],
    degraded: true,
    warning: blocked
      ? `Vinted: anti-bot challenge blocked the fetch (Datadome). ${status}`
      : `Vinted live fetch returned 0 comps. ${status}`,
    authFailed: blocked,
    liveFetchStatus: status,
  };
}
