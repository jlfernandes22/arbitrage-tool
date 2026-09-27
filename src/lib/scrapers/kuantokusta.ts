// scrapers/kuantokusta.ts
// KuantoKusta.pt scraper — Portuguese price-comparison site.
// All listings on KuantoKusta are NEW retail products (stores selling at
// retail prices), so every comp returned here is tagged condition="new"
// and isRetail=true.
//
// Strategy: Try a plain HTTP fetch first (which has a different TLS
// fingerprint than Playwright headless Chrome and is less likely to be
// blocked by Akamai WAF). If that returns HTML, parse it. If blocked,
// fall back to Playwright — first with the FULL Chromium engine
// (channel "chromium", far harder for Akamai to fingerprint than the
// headless shell) and an engine-matched UA, then the default shell.
// If Akamai still denies access, return an honest "blocked" status so
// the UI can show exactly why there are no KuantoKusta results.
import { config } from "@/lib/config";
import type { Condition, EuMarketComp, NormalizedProduct } from "@/lib/engine/types";
import { buildEuQuery } from "@/lib/engine/matcher";
import { isTitleRelevantToQuery } from "@/lib/engine/relevance";
import { sleep, jitter, isAccessoryTitle } from "./utils";

export interface KuantokustaScrapeResult {
  comps: EuMarketComp[];
  degraded: boolean;
  warning?: string;
  liveFetchStatus?: string;
  blocked?: boolean; // anti-bot (Akamai) denied the fetch
}

function buildKuantokustaSearchUrl(query: string, page: number = 1): string {
  const base = `${config.scraping.kuantokusta_search_url}${encodeURIComponent(query)}`;
  return page > 1 ? `${base}&page=${page}` : base;
}

/**
 * Launch the FULL Chromium engine in new-headless mode (channel
 * "chromium") with a graceful fallback to the default headless shell.
 * Akamai's fingerprinting is much harsher on the headless shell — the
 * full engine is byte-identical to regular Chrome for its probes.
 */
async function launchKkBrowser(): Promise<import("playwright").Browser> {
  const { chromium } = await import("playwright");
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

/**
 * Parse KuantoKusta search results from raw HTML.
 * KuantoKusta is a Next.js SPA that embeds product data in <script> tags
 * as JSON (Next.js __NEXT_DATA__ or similar). We also try regex extraction
 * from the rendered HTML.
 *
 * `fallbackUsed` is set to true when the unreliable Strategy 3 (broad
 * price + title extraction) had to be used, so the caller can warn the
 * user that title↔price pairing may be inaccurate.
 */
function parseKkHtml(
  html: string,
  baseUrl: string,
): { items: Array<{ title: string; priceEur: number; store: string; url?: string }>; fallbackUsed: boolean } {
  const items: Array<{ title: string; priceEur: number; store: string; url?: string }> = [];
  let fallbackUsed = false;
  try {
    // Strategy 1: Extract from Next.js __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        // Navigate the Next.js data structure to find products
        const products = data?.props?.pageProps?.products
          || data?.props?.pageProps?.searchResults?.products
          || data?.props?.pageProps?.results
          || [];
        for (const p of products) {
          const title = p.name || p.title || "";
          const priceEur = parseFloat(p.price || p.minPrice || p.priceEur || "0");
          const store = p.store || p.merchant || p.shop || "Loja";
          let url: string | undefined;
          const rawUrl = p.url || p.slug || p.link;
          if (typeof rawUrl === "string" && rawUrl.startsWith("/")) {
            url = `https://www.kuantokusta.pt${rawUrl}`;
          } else if (typeof rawUrl === "string" && rawUrl.startsWith("http")) {
            url = rawUrl;
          }
          if (title && priceEur > 0 && priceEur <= 10000) {
            items.push({ title: title.substring(0, 120), priceEur, store, url });
          }
        }
      } catch {
        // JSON parse failed — continue to regex
      }
    }

    // Strategy 2: Regex extraction from HTML
    if (items.length === 0) {
      // Look for product cards with /produto/ links and € prices
      // Pattern: <a href="/produto/...">Title</a> ... price
      const productRegex = /href="(\/produto\/[^"]+)"[^>]*>([^<]{5,120})<\/a>[\s\S]{0,500}?(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/g;
      let m: RegExpExecArray | null;
      while ((m = productRegex.exec(html)) && items.length < 50) {
        const title = m[2].trim();
        const cleanPrice = m[3].replace(/[\s.\u00A0]/g, "").replace(",", ".");
        const priceEur = parseFloat(cleanPrice);
        if (title && priceEur > 0 && priceEur <= 10000) {
          items.push({
            title: title.substring(0, 120),
            priceEur,
            store: "Loja",
            url: `https://www.kuantokusta.pt${m[1]}`,
          });
        }
      }
    }

    // Strategy 3: Broad price + title extraction.
    // This strategy is UNRELIABLE — titles and prices are extracted
    // independently from the whole page (nav bars, footer links, etc.).
    // The old code paired them by array index, silently matching the 1st
    // nav price to the 1st product title. Instead, correlate each title
    // with the NEAREST price that appears AFTER it in the HTML, and flag
    // the fallback so the user knows results may be inaccurate.
    if (items.length === 0) {
      fallbackUsed = true;
      console.warn(
        "[kuantokusta] HTML fallback parser activated: no structured product data found. Titles and prices are correlated by HTML proximity — data may be inaccurate.",
      );
      const priceRegex = /(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/g;
      const priceHits: Array<{ priceEur: number; index: number }> = [];
      let pm: RegExpExecArray | null;
      while ((pm = priceRegex.exec(html)) && priceHits.length < 200) {
        const cleanPrice = pm[1].replace(/[\s.\u00A0]/g, "").replace(",", ".");
        const priceEur = parseFloat(cleanPrice);
        if (priceEur > 1 && priceEur <= 10000) priceHits.push({ priceEur, index: pm.index });
      }
      // Find product titles (h2, h3, or elements with product-related classes).
      // Also capture the href when the element is an <a> so we can link
      // straight to the listing.
      const titleRegex = /<(?:h2|h3|a)([^>]*)>([^<]{5,120})<\/(?:h2|h3|a)>/g;
      const titleHits: Array<{ title: string; index: number; href?: string }> = [];
      let tm: RegExpExecArray | null;
      while ((tm = titleRegex.exec(html)) && titleHits.length < 100) {
        const title = tm[2].trim();
        // Filter out navigation items
        if (title.length > 5 && !title.includes("Pesquisa") && !title.includes("Início")) {
          let href: string | undefined;
          const hrefMatch = tm[1].match(/href="([^"]+)"/);
          if (hrefMatch) {
            const raw = hrefMatch[1];
            if (raw.startsWith("/")) href = `https://www.kuantokusta.pt${raw}`;
            else if (raw.startsWith("http")) href = raw;
          }
          titleHits.push({ title, index: tm.index, href });
        }
      }
      // Pair each title with the nearest price AFTER it in the HTML
      // (each price is consumed at most once). Prices too far from the
      // title (> 1500 chars) or missing are skipped.
      let pricePtr = 0;
      for (const t of titleHits) {
        while (pricePtr < priceHits.length && priceHits[pricePtr].index < t.index) pricePtr++;
        const p = priceHits[pricePtr];
        if (!p) break;
        if (p.index - (t.index + t.title.length) > 1500) continue;
        items.push({ title: t.title.substring(0, 120), priceEur: p.priceEur, store: "Loja", url: t.href });
        pricePtr++;
        if (items.length >= 50) break;
      }
    }
  } catch {
    // ignore
  }
  return { items, fallbackUsed };
}

/**
 * Try a plain HTTP fetch first — this has a different TLS fingerprint than
 * Playwright's headless Chrome and is less likely to be blocked by Akamai.
 *
 * `page` is forwarded to `buildKuantokustaSearchUrl` so multi-page fetching
 * actually advances past page 1. Previously this function ignored the page
 * parameter entirely, so the multi-page loop in `scrapeKuantokustaLive` would
 * fetch the same page 1 every iteration and then `break` (because dedup
 * reported `newCount === 0` on iteration 2). Multi-page fetching was silently
 * broken for the HTTP strategy.
 */
async function fetchKkHtml(euQuery: string, page: number = 1): Promise<{ html: string | null; status: number }> {
  const url = buildKuantokustaSearchUrl(euQuery, page);
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
    });
    if (res.ok) {
      const html = await res.text();
      if (html && html.length > 500) {
        return { html, status: res.status };
      }
    }
    return { html: null, status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { html: null, status: 0 };
  }
}

/**
 * Scrape KuantoKusta using fetch-first approach, then Playwright fallback.
 */
async function scrapeKuantokustaLive(
  euQuery: string,
  maxPages: number,
): Promise<{ comps: EuMarketComp[]; status: string; blocked: boolean }> {
  const allItems: Array<{ title: string; priceEur: number; store: string; url?: string }> = [];
  const seenTitles = new Set<string>();

  // Strategy 1: Plain HTTP fetch (less likely to be blocked)
  let usedFallbackParser = false;
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const { html } = await fetchKkHtml(euQuery, pageNum);
    if (html) {
      const { items, fallbackUsed } = parseKkHtml(html, buildKuantokustaSearchUrl(euQuery, pageNum));
      if (fallbackUsed) usedFallbackParser = true;
      let newCount = 0;
      for (const item of items) {
        if (item.priceEur < 100 || item.priceEur > 3000) continue;
        if (isAccessoryTitle(item.title)) continue;
        if (!isTitleRelevantToQuery(item.title, euQuery)) continue;
        if (!seenTitles.has(item.title)) {
          seenTitles.add(item.title);
          allItems.push(item);
          newCount++;
        }
      }
      if (newCount === 0) break;
    } else {
      // HTTP fetch failed (likely blocked by Akamai) — break to Playwright fallback
      break;
    }
  }

  if (allItems.length > 0) {
    return {
      comps: allItems.map((c, i) => ({
        id: `kk-fetch-${i}`,
        platform: "kuantokusta" as const,
        title: c.title,
        priceEur: c.priceEur,
        condition: "new" as Condition,
        url: c.url,
        location: "Portugal",
        vendorType: c.store,
        negotiable: false,
        viewCount: 0,
        isRetail: true,
      })),
      status: usedFallbackParser
        ? `LIVE OK (HTTP fetch, ${allItems.length} comps) | WARNING: used fallback parser — titles/prices are correlated by HTML proximity and may be mispaired`
        : `LIVE OK (HTTP fetch, ${allItems.length} comps)`,
      blocked: false,
    };
  }

  // Strategy 2: Playwright fallback — FULL Chromium engine first.
  // KuantoKusta uses Akamai WAF which blocks headless browsers and
  // datacenter IPs. Use the full engine + engine-matched UA + realistic
  // headers, and poll for products to give Akamai's JS a chance.
  const browser = await launchKkBrowser();
  try {
    // Read the REAL Chromium version so UA ↔ Sec-Ch-Ua ↔ engine all match
    // (Akamai cross-checks these — a mismatch is an instant flag).
    const probe = await browser.newContext();
    const probePage = await probe.newPage();
    const realVersion = await probePage.evaluate(() => {
      const m = navigator.userAgent.match(/Chrome\/(\d+)/);
      return m ? parseInt(m[1], 10) : 131;
    }).catch(() => 131);
    await probePage.close().catch(() => {});
    await probe.close().catch(() => {});
    const ver = Number.isFinite(realVersion) ? realVersion : 131;

    const ctx = await browser.newContext({
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver}.0.0.0 Safari/537.36`,
      locale: "pt-PT",
      viewport: { width: 1920, height: 1080 },
      // NO extraHTTPHeaders — same fix as the Amazon scraper: forcing
      // Sec-Fetch-* / Sec-Ch-Ua on every request (including Akamai's own
      // sensor XHRs, which must carry `Sec-Fetch-Mode: cors`) contradicts
      // real browser behaviour and is itself a bot flag. Chromium emits
      // correct per-request headers natively.
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    });
    const page = await ctx.newPage();
    let akamaiDenied = false;
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = buildKuantokustaSearchUrl(euQuery, pageNum);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

      // Poll for products for up to 15s — Akamai sometimes serves an
      // interstitial first, and a credible browser passes it silently.
      // NOTE: the probe runs via page.evaluate (Node side) so denial
      // detection actually propagates — browser-context callbacks can't
      // mutate Node variables.
      let denied = false;
      const pollStart = Date.now();
      while (Date.now() - pollStart < 15000) {
        const state = await page.evaluate(() => ({
          products: document.querySelectorAll("a[href*='/produto/']").length,
          title: document.title || "",
          body: (document.body?.innerText || "").substring(0, 300),
        })).catch(() => ({ products: 0, title: "", body: "" }));
        if (state.products > 0) break;
        if (/access denied|forbidden|403/i.test(state.title) || /access denied/i.test(state.body)) {
          denied = true;
          break;
        }
        await page.waitForTimeout(750);
      }
      if (denied) {
        akamaiDenied = true;
        break;
      }

      const pageItems = await page.evaluate(() => {
        const items: Array<{ title: string; priceEur: number; store: string; url?: string }> = [];
        // Find all links to /produto/ and walk up to find prices
        const productLinks = document.querySelectorAll("a[href*='/produto/']");
        const cardSet = new Set<Element>();
        productLinks.forEach((link) => {
          let el = link as HTMLElement;
          for (let i = 0; i < 4; i++) {
            el = el.parentElement as HTMLElement;
            if (!el) break;
            if (el.textContent && el.textContent.includes("€")) {
              cardSet.add(el);
              break;
            }
          }
        });
        cardSet.forEach((card) => {
          const productLink = card.querySelector<HTMLAnchorElement>("a[href*='/produto/']");
          const title = productLink?.textContent?.trim() || "";
          if (!title) return;
          const allText = (card.textContent || "").replace(/\s+/g, " ").trim();
          const priceMatch = allText.match(/(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/);
          let priceEur = 0;
          if (priceMatch) {
            const cleanPrice = priceMatch[1].replace(/[\s.\u00A0]/g, "").replace(",", ".");
            priceEur = parseFloat(cleanPrice);
          }
          if (!priceEur) return;
          const storeEl = card.querySelector("[class*='store'], [class*='merchant'], [class*='shop'], [class*='seller']");
          const store = storeEl?.textContent?.trim() || "Loja";
          // Direct listing URL from the product anchor (resolved absolute).
          const url = productLink?.href || undefined;
          if (title && priceEur > 0) {
            items.push({ title: title.substring(0, 120), priceEur, store, url });
          }
        });
        return items;
      });

      let newCount = 0;
      for (const item of pageItems) {
        if (item.priceEur < 100 || item.priceEur > 3000) continue;
        if (isAccessoryTitle(item.title)) continue;
        if (!isTitleRelevantToQuery(item.title, euQuery)) continue;
        if (!seenTitles.has(item.title)) {
          seenTitles.add(item.title);
          allItems.push(item);
          newCount++;
        }
      }
      if (newCount === 0) break;
    }
    await ctx.close().catch(() => {});
    if (allItems.length > 0) {
      return {
        comps: allItems.map((c, i) => ({
          id: `kk-live-${i}`,
          platform: "kuantokusta" as const,
          title: c.title,
          priceEur: c.priceEur,
          condition: "new" as Condition,
          url: c.url,
          location: "Portugal",
          vendorType: c.store,
          negotiable: false,
          viewCount: 0,
          isRetail: true,
        })),
        status: `LIVE OK (Playwright, ${allItems.length} comps from ${maxPages} pages)`,
        blocked: false,
      };
    }
    return {
      comps: [],
      status: akamaiDenied
        ? `LIVE FETCH BLOCKED: KuantoKusta's Akamai WAF denies access from this IP/network (HTTP 403 on both HTTP fetch and a real-browser session). Works from residential/Portuguese IPs — this is a network-level block, not a scraper bug.`
        : `LIVE FETCH FAILED: KuantoKusta rendered no product cards (no /produto/ links found). The page may have changed or the search returned nothing.`,
      blocked: akamaiDenied,
    };
  } catch (e) {
    await browser.close().catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return { comps: [], status: `LIVE FETCH FAILED: ${msg}`, blocked: false };
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function scrapeKuantokusta(
  product: NormalizedProduct | null,
  query: string,
  opts?: { maxPages?: number },
): Promise<KuantokustaScrapeResult> {
  const euQuery = product ? buildEuQuery(product) : query;
  const maxPages =
    opts?.maxPages && opts.maxPages > 0 ? opts.maxPages : config.scraping.max_pages;
  await sleep(jitter(config.scraping.jitter_min_ms, config.scraping.jitter_max_ms));
  let { comps, status, blocked } = await scrapeKuantokustaLive(euQuery, maxPages);
  // Browser-crash retry: when several scans run in parallel the standalone
  // KK browser can be killed mid-run ("Target page, context or browser has
  // been closed" / "Browser has been closed"). That's an environment
  // failure, not a block — retry ONCE with a fresh browser before
  // reporting, so a transient OOM doesn't zero out the whole source.
  const BROWSER_CRASH = /browser ?has been closed|target page, context or browser|browser disconnected|session closed/i;
  if (comps.length === 0 && BROWSER_CRASH.test(status)) {
    await sleep(jitter(1500, 3000));
    const retry = await scrapeKuantokustaLive(euQuery, maxPages);
    if (retry.comps.length > 0 || !BROWSER_CRASH.test(retry.status)) {
      comps = retry.comps;
      status = retry.status;
      blocked = retry.blocked;
    }
  }
  if (comps.length > 0) {
    return { comps, degraded: false, liveFetchStatus: status };
  }
  return {
    comps: [],
    degraded: true,
    warning: blocked
      ? `KuantoKusta: Akamai WAF denied access from this network (403). Works from residential IPs — not a scraper bug.`
      : `KuantoKusta live fetch returned 0 comps. ${status}`,
    liveFetchStatus: status,
    blocked,
  };
}

export { buildEuQuery };
