// scrapers/amazon.ts
// Amazon.es scraper — amazon.pt redirects to amazon.es (same Iberian store,
// EUR pricing, ships to Portugal). All listings are NEW retail products sold
// by Amazon or third-party sellers at retail prices, so every comp returned
// here is tagged condition="new" and isRetail=true.
//
// Strategy: Try a plain HTTP fetch first (different TLS fingerprint than
// Playwright headless Chrome, less likely to be blocked by Amazon's bot
// detection). If that returns HTML, parse it. If blocked, fall back to
// Playwright with stealth measures.
import { config } from "@/lib/config";
import type { Condition, EuMarketComp, NormalizedProduct } from "@/lib/engine/types";
import { buildEuQuery } from "@/lib/engine/matcher";
import { isTitleRelevantToQuery } from "@/lib/engine/relevance";
import { sleep, jitter, isAccessoryTitle } from "./utils";

export interface AmazonScrapeResult {
  comps: EuMarketComp[];
  degraded: boolean;
  warning?: string;
  liveFetchStatus?: string;
}

function buildAmazonSearchUrl(query: string, page: number = 1): string {
  const base = `${config.scraping.amazon_search_url}${encodeURIComponent(query)}`;
  return page > 1 ? `${base}&page=${page}` : base;
}

/**
 * Dismiss Amazon's cookie-consent banner so it doesn't overlay the page.
 * Verified live with Playwright: the banner is form#cos-banner containing
 *   #sp-cc-accept         (input[type=submit], "Aceptar")
 *   #sp-cc-rejectall-link (input[type=submit], "Rechazar")
 * Clicking either one removes the overlay (choice is stored per-context,
 * but the banner can reappear on subsequent pages in some regions, so this
 * is called on every page load). Returns true if a banner was dismissed.
 */
async function dismissCookieBanner(page: import("playwright").Page): Promise<boolean> {
  const selectors = ["#sp-cc-accept", "#sp-cc-rejectall-link"];
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    try {
      if ((await btn.count()) === 0) continue;
      if (!(await btn.isVisible({ timeout: 1500 }))) continue;
      await btn.click({ timeout: 3000 });
      await page.waitForTimeout(1200);
      return true;
    } catch {
      // Banner may be partially covered — retry with a forced click
      try {
        await btn.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(1200);
        return true;
      } catch {
        // try the next selector
      }
    }
  }
  return false;
}

/**
 * Parse Amazon search results from raw HTML.
 * Amazon renders search results server-side with data in the HTML.
 *
 * `fallbackUsed` is set to true when the unreliable Strategy 2 (broad
 * title + price extraction) had to be used, so the caller can warn the
 * user that title↔price pairing may be inaccurate.
 */
function parseAmazonHtml(
  html: string,
): { items: Array<{ title: string; priceEur: number; prime: boolean; url?: string }>; fallbackUsed: boolean } {
  const items: Array<{ title: string; priceEur: number; prime: boolean; url?: string }> = [];
  let fallbackUsed = false;
  try {
    // Amazon search results are in div[data-component-type="s-search-result"]
    // Each card has:
    //   - h2 > a > span (title)
    //   - span.a-price > span.a-offscreen (price text like "1.299,90 €")

    // Strategy 1: Extract using data-component-type blocks
    const cardRegex = /data-component-type="s-search-result"[\s\S]*?(?=data-component-type="s-search-result"|$)/g;
    let cardMatch: RegExpExecArray | null;
    while ((cardMatch = cardRegex.exec(html)) && items.length < 50) {
      const cardHtml = cardMatch[0];
      // Title: h2 a span or h2 span.a-text-normal. Some layouts (e.g. the
      // refurbished/renewed cards) render <h2 aria-label="…"><span>…</span></h2>
      // WITHOUT an anchor, so the anchor is optional and we also fall back
      // to the h2 aria-label. The anchor href (when present) is the direct
      // product link (/dp/ASIN or /gp/…).
      const titleMatch = cardHtml.match(/<h2[^>]*>[\s\S]*?(?:<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?)?<span[^>]*>([^<]{5,200})<\/span>/);
      let title = titleMatch?.[2]?.trim() || "";
      let href = titleMatch?.[1]?.trim() || "";
      if (!title) {
        const ariaMatch = cardHtml.match(/<h2[^>]*aria-label="([^"]{5,200})"/);
        title = ariaMatch?.[1]?.trim() || "";
      }
      if (!href) {
        // Anchorless cards still carry the listing link (usually the image
        // anchor: <a href="/…/dp/ASIN/ref=…">)
        const dpMatch = cardHtml.match(/href="(\/[^"]*\/dp\/[^"]+)"/);
        if (dpMatch) href = dpMatch[1];
      }
      if (!title) continue;

      // Price: "1.299,90 €" or "€1.299,90"
      let priceEur = 0;
      const priceMatch1 = cardHtml.match(/(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/);
      if (priceMatch1) {
        const cleanPrice = priceMatch1[1].replace(/[\s.\u00A0]/g, "").replace(",", ".");
        priceEur = parseFloat(cleanPrice);
      }
      if (!priceEur) {
        const priceMatch2 = cardHtml.match(/€\s*(\d[\d\s.\u00A0]*(?:,\d{1,2})?)/);
        if (priceMatch2) {
          const cleanPrice = priceMatch2[1].replace(/[\s.\u00A0]/g, "").replace(",", ".");
          priceEur = parseFloat(cleanPrice);
        }
      }
      if (!priceEur) continue;

      const prime = /prime/i.test(cardHtml);
      items.push({
        title: title.substring(0, 120),
        priceEur,
        prime,
        url: href.startsWith("/") ? `https://www.amazon.es${href}` : href || undefined,
      });
    }

    // Strategy 2: Fallback — extract all h2 titles + prices, correlated by
    // HTML proximity. The old code paired them by array index, silently
    // matching the 1st price (possibly from a nav bar) to the 1st title.
    // Now each title is paired with the NEAREST price that appears AFTER it
    // in the HTML, and the fallback is flagged so the user knows the data
    // may be inaccurate.
    if (items.length === 0) {
      fallbackUsed = true;
      console.warn(
        "[amazon] HTML fallback parser activated: no structured s-search-result cards found. Titles and prices are correlated by HTML proximity — data may be inaccurate.",
      );
      const titleRegex = /<h2[^>]*>[\s\S]*?(?:<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?)?<span[^>]*class="[^"]*a-text-normal[^"]*"[^>]*>([^<]{5,200})<\/span>/g;
      const titleHits: Array<{ title: string; index: number; href?: string }> = [];
      let tm: RegExpExecArray | null;
      while ((tm = titleRegex.exec(html)) && titleHits.length < 100) {
        const href = tm[1]?.trim() || "";
        titleHits.push({
          title: tm[2].trim(),
          index: tm.index,
          href: href ? (href.startsWith("/") ? `https://www.amazon.es${href}` : href) : undefined,
        });
      }
      const priceRegex = /(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/g;
      const priceHits: Array<{ priceEur: number; index: number }> = [];
      let pm: RegExpExecArray | null;
      while ((pm = priceRegex.exec(html)) && priceHits.length < 200) {
        const cleanPrice = pm[1].replace(/[\s.\u00A0]/g, "").replace(",", ".");
        const priceEur = parseFloat(cleanPrice);
        if (priceEur > 1 && priceEur <= 10000) priceHits.push({ priceEur, index: pm.index });
      }
      // Pair each title with the nearest price AFTER it (each price consumed
      // at most once). Prices too far from the title are skipped.
      let pricePtr = 0;
      for (const t of titleHits) {
        while (pricePtr < priceHits.length && priceHits[pricePtr].index < t.index) pricePtr++;
        const p = priceHits[pricePtr];
        if (!p) break;
        if (p.index - (t.index + t.title.length) > 1500) continue;
        items.push({ title: t.title.substring(0, 120), priceEur: p.priceEur, prime: false, url: t.href });
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
 * Try a plain HTTP fetch — different TLS fingerprint than Playwright.
 *
 * `page` is forwarded to `buildAmazonSearchUrl` so multi-page fetching
 * actually advances past page 1. Previously this function ignored the page
 * parameter, so the multi-page loop in `scrapeAmazonLive` would fetch the
 * same page 1 every iteration and then `break` (because dedup reported
 * `newCount === 0` on iteration 2). Multi-page fetching was silently broken
 * for the HTTP strategy.
 */
async function fetchAmazonHtml(euQuery: string, page: number = 1): Promise<{ html: string | null; status: number }> {
  const url = buildAmazonSearchUrl(euQuery, page);
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
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
  } catch {
    return { html: null, status: 0 };
  }
}

/**
 * Text markers that indicate an Amazon block page (error, robot check,
 * captcha) rather than a real results page. Amazon shows these
 * intermittently and they contain NO listing cards — the scraper must
 * detect them and retry instead of silently returning 0 listings.
 */
const BLOCK_PAGE_PATTERN = /sentimos|lo sentimos|captcha|robot check|enter the characters|escribe los caracteres/i;

function looksLikeBlockPage(bodyText: string): boolean {
  return BLOCK_PAGE_PATTERN.test(bodyText);
}

// ── Session rotation ──────────────────────────────────────────────────
// Amazon's bot detection is INTERMITTENT and session-based: a flagged
// session keeps getting served block pages. Retrying in the SAME context
// is futile — we rotate to a FRESH context with a different Windows Chrome
// UA (clean cookies, clean WAF token) and retry from scratch.
const AMAZON_UA_POOL = [
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="128", "Not_A Brand";v="24", "Google Chrome";v="128"',
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="125", "Not_A Brand";v="24", "Google Chrome";v="125"',
  },
];

async function createAmazonContext(
  browser: import("playwright").Browser,
  uaIndex: number,
): Promise<import("playwright").BrowserContext> {
  const ua = AMAZON_UA_POOL[uaIndex % AMAZON_UA_POOL.length];
  const ctx = await browser.newContext({
    userAgent: ua.userAgent,
    locale: "es-ES",
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Sec-Ch-Ua": ua.secChUa,
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, "languages", { get: () => ["es-ES", "es", "en"] });
    (window as any).chrome = { runtime: {} };
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p: number) {
      if (p === 37445) return "Intel Inc.";
      if (p === 37446) return "Intel Iris OpenGL Engine";
      return getParameter.call(this, p);
    };
  });
  return ctx;
}

/**
 * Unregister amazon.es service workers. The SW can serve STALE cached
 * navigations (e.g. a previously cached "sentimos" error or an empty shell
 * page) for the search URL — one source of the intermittent 0-listing
 * results — and it bypasses the network entirely. Unregistering forces
 * every navigation to hit the real server.
 */
async function unregisterServiceWorkers(page: import("playwright").Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return;
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    });
  } catch {
    // best-effort — ignore failures
  }
}

/**
 * Scrape Amazon using HTTP-fetch-first approach, then Playwright fallback.
 */
async function scrapeAmazonLive(
  euQuery: string,
  maxPages: number,
): Promise<{ comps: EuMarketComp[]; status: string }> {
  const allItems: Array<{ title: string; priceEur: number; prime: boolean; url?: string }> = [];
  const seenTitles = new Set<string>();

  // Strategy 1: Plain HTTP fetch (works from most IPs — Amazon returns full HTML)
  let usedFallbackParser = false;
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const { html } = await fetchAmazonHtml(euQuery, pageNum);
    if (html) {
      const { items, fallbackUsed } = parseAmazonHtml(html);
      if (fallbackUsed) usedFallbackParser = true;
      let newCount = 0;
      for (const item of items) {
        if (item.priceEur < 100 || item.priceEur > 3000) continue;
        if (isAccessoryTitle(item.title)) continue;
        // Generation-aware relevance: reject wrong models (e.g. an iPhone 15
        // showing up when searching for an iPhone 17).
        if (!isTitleRelevantToQuery(item.title, euQuery)) continue;
        if (!seenTitles.has(item.title)) {
          seenTitles.add(item.title);
          allItems.push(item);
          newCount++;
        }
      }
      if (newCount === 0) break;
    } else {
      break;
    }
  }

  if (allItems.length > 0) {
    return {
      comps: allItems.map((c, i) => ({
        id: `amazon-fetch-${i}`,
        platform: "amazon" as const,
        title: c.title,
        priceEur: c.priceEur,
        condition: "new" as Condition,
        url: c.url,
        location: "Amazon.es",
        vendorType: c.prime ? "Amazon Prime" : "Amazon",
        negotiable: false,
        viewCount: 0,
        isRetail: true,
      })),
      status: usedFallbackParser
        ? `LIVE OK (HTTP fetch, ${allItems.length} comps) | WARNING: used fallback parser — titles/prices are correlated by HTML proximity and may be mispaired`
        : `LIVE OK (HTTP fetch, ${allItems.length} comps)`,
    };
  }

  // Strategy 2: Playwright with home-page-first approach
  // Amazon blocks direct search page access from datacenter IPs (returns 503),
  // but allows it after visiting the home page first (establishes a session
  // cookie + AWS WAF token that bypasses the bot check).

  // Strategy: Playwright with home-page-first approach
  // Amazon blocks direct search page access from datacenter IPs (returns 503),
  // but allows it after visiting the home page first (establishes a session
  // cookie + AWS WAF token that bypasses the bot check). We use a FRESH
  // browser instance (not the shared singleton) to ensure clean state.
  const { chromium } = await import("playwright");
  const freshBrowser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  try {
    // Active context/page — ROTATED to a fresh session (new UA, no cookies)
    // whenever Amazon blocks the current one. Retrying a flagged session in
    // the same context never recovers.
    let ctx = await createAmazonContext(freshBrowser, 0);
    let page = await ctx.newPage();

    // ── Step 1: Visit the home page (best-effort) ────────────────────
    // Establishes a session cookie + AWS WAF token that helps bypass the
    // search-page bot check. The block is INTERMITTENT — up to 3 attempts,
    // each with a FRESH context + rotated UA + backoff.
    let homeLoaded = false;
    for (let attempt = 0; attempt < 3 && !homeLoaded; attempt++) {
      try {
        await page.goto("https://www.amazon.es/", { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(3000 + attempt * 2000); // increasing wait
        // The cookie-consent banner (form#cos-banner) overlays the page and
        // blocks content — dismiss it with Accept/Decline on every load.
        await dismissCookieBanner(page);
        // Amazon's service worker can serve stale cached pages — kill it so
        // the search navigations always hit the live server.
        await unregisterServiceWorkers(page);
        const homeTitle = await page.title();
        // A robot-check/captcha page has a normal-looking title ("Robot
        // Check") — reject it too, not just the "sentimos" error.
        const homeBody = await page.evaluate(() => (document.body?.innerText || "").substring(0, 600));
        if (homeTitle && !homeTitle.includes("sentimos") && homeTitle.length > 5 && !looksLikeBlockPage(homeBody)) {
          homeLoaded = true;
          break;
        }
        console.log(`[Amazon] Home attempt ${attempt + 1}/3 blocked (title="${homeTitle}") — rotating session`);
      } catch {
        console.log(`[Amazon] Home attempt ${attempt + 1}/3 failed — rotating session`);
      }
      if (!homeLoaded && attempt < 2) {
        await ctx.close().catch(() => {});
        ctx = await createAmazonContext(freshBrowser, attempt + 1);
        page = await ctx.newPage();
        await sleep(jitter(2000, 4000)); // backoff before the next attempt
      }
    }
    // If the home page is blocked, DON'T give up — fall through to the
    // search page directly with a fresh session (the search loop has its
    // own retries). Amazon sometimes only blocks the home endpoint.
    if (!homeLoaded) {
      await ctx.close().catch(() => {});
      ctx = await createAmazonContext(freshBrowser, 0);
      page = await ctx.newPage();
      console.log("[Amazon] Home page blocked — trying the search page directly with a fresh session");
    }

    // Block/empty-page tracking so the final status explains WHY 0 comps
    // were returned instead of a generic "0 comps".
    let lastPageIssue: string | null = null;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = buildAmazonSearchUrl(euQuery, pageNum);
      // Load the search page and WAIT for results to actually render.
      // Amazon intermittently serves a block page ("sentimos"), a robot
      // check, or an empty shell — the old fixed 4s wait + blind evaluate
      // silently returned 0 listings on those. Now we poll until cards
      // appear OR a block marker shows (max 15s), and retry up to 3 times
      // with a FRESH context + rotated UA between attempts.
      let pageReady = false;
      for (let attempt = 0; attempt < 3 && !pageReady; attempt++) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        // The consent banner can reappear on the search page — dismiss it
        // before evaluating so the overlay doesn't intercept the cards.
        await dismissCookieBanner(page);
        // Kill the service worker so it can't serve a stale cached shell
        // instead of the live results page.
        await unregisterServiceWorkers(page);
        // Poll (500ms) until listing cards render or a block page shows.
        try {
          await page.waitForFunction(
            (pattern: string) => {
              if (document.querySelectorAll("div[data-component-type='s-search-result'], div.s-result-item, div[data-asin]").length > 0) return true;
              return new RegExp(pattern, "i").test(document.body?.innerText || "");
            },
            BLOCK_PAGE_PATTERN.source,
            { timeout: 15000, polling: 500 },
          );
        } catch {
          // Neither cards nor a block marker within 15s — retry below.
        }
        const cardCount = await page.locator("div[data-component-type='s-search-result'], div.s-result-item, div[data-asin]").count();
        if (cardCount > 0) {
          pageReady = true;
          break;
        }
        // No cards — record the reason and rotate to a fresh session.
        const bodyText = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").substring(0, 120));
        lastPageIssue = looksLikeBlockPage(bodyText)
          ? `Amazon block page (${JSON.stringify(bodyText)})`
          : `Amazon returned an empty search page (${JSON.stringify(bodyText)})`;
        console.log(`[Amazon] Search attempt ${attempt + 1}/3 failed: ${lastPageIssue} — rotating session`);
        if (attempt < 2) {
          // A flagged session keeps getting blocked — start a completely
          // fresh context (no cookies, different UA) and retry.
          await ctx.close().catch(() => {});
          ctx = await createAmazonContext(freshBrowser, attempt + 1);
          page = await ctx.newPage();
          await sleep(jitter(1500, 3000));
        }
      }
      if (!pageReady) {
        // No cards after all retries — Amazon is blocking this IP/session.
        // Abort the page loop: later pages would hit the same wall.
        break;
      }

      const pageItems = await page.evaluate(() => {
        const items: Array<{ title: string; priceEur: number; prime: boolean; url?: string }> = [];
        let cards: Element[] = [];
        const selectors = [
          "div[data-component-type='s-search-result']",
          "div.s-result-item",
          "div[data-asin]",
        ];
        for (const sel of selectors) {
          const found = document.querySelectorAll(sel);
          if (found.length > 0) {
            cards = Array.from(found);
            break;
          }
        }
        cards.forEach((card) => {
          let title = "";
          // Some layouts (refurbished/renewed cards) render the title as
          // <h2 aria-label="…"><span>…</span></h2> WITHOUT an anchor, so the
          // h2 aria-label is used as a fallback before the image alt text.
          const h2El = card.querySelector("h2");
          const titleSelectors = [
            "h2 a span",
            "h2 span.a-text-normal",
            "h2 span",
          ];
          for (const sel of titleSelectors) {
            const el = card.querySelector(sel);
            const text = el?.textContent?.trim() || "";
            if (text && text.length > 5) {
              title = text;
              break;
            }
          }
          if (!title && h2El?.getAttribute("aria-label")) {
            const aria = h2El.getAttribute("aria-label")!.trim();
            if (aria.length > 5) title = aria;
          }
          if (!title) {
            const imgEl = card.querySelector<HTMLImageElement>("img.s-image");
            const alt = imgEl?.alt?.trim() || "";
            if (alt.length > 5) title = alt;
          }
          if (!title) return;
          // Direct listing URL: prefer the title/image /dp/ anchor, fall back
          // to any /dp/ link in the card, then any anchor.
          const productLink = card.querySelector<HTMLAnchorElement>(
            "h2 a[href*='/dp/'], a[href*='/dp/'], a[href]",
          );
          const url = productLink?.href || undefined;
          const allText = (card.textContent || "").replace(/\s+/g, " ").trim();
          let priceEur = 0;
          const priceMatch1 = allText.match(/(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/);
          if (priceMatch1) {
            const cleanPrice = priceMatch1[1].replace(/[\s.\u00A0]/g, "").replace(",", ".");
            priceEur = parseFloat(cleanPrice);
          }
          if (!priceEur) {
            const priceEl = card.querySelector("[class*='a-price'] [class*='a-offscreen'], .a-price .a-offscreen");
            if (priceEl) {
              const priceText = priceEl.textContent?.trim() || "";
              const priceMatch3 = priceText.match(/(\d[\d\s.\u00A0]*(?:,\d{1,2})?)/);
              if (priceMatch3) {
                const cleanPrice = priceMatch3[1].replace(/[\s.\u00A0]/g, "").replace(",", ".");
                priceEur = parseFloat(cleanPrice);
              }
            }
          }
          if (!priceEur) return;
          const prime = /prime/i.test(allText);
          if (title && priceEur > 0) {
            items.push({ title: title.substring(0, 120), priceEur, prime, url });
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
    await freshBrowser.close();
    return {
      comps: allItems.map((c, i) => ({
        id: `amazon-live-${i}`,
        platform: "amazon" as const,
        title: c.title,
        priceEur: c.priceEur,
        condition: "new" as Condition,
        url: c.url,
        location: "Amazon.es",
        vendorType: c.prime ? "Amazon Prime" : "Amazon",
        negotiable: false,
        viewCount: 0,
        isRetail: true,
      })),
      status: lastPageIssue
        ? `LIVE FETCH FAILED after 3 retries per page: ${lastPageIssue}`
        : `LIVE OK (Playwright, ${allItems.length} comps from ${maxPages} pages)`,
    };
  } catch (e) {
    await freshBrowser.close();
    const msg = e instanceof Error ? e.message : String(e);
    return { comps: [], status: `LIVE FETCH FAILED: ${msg}` };
  }
}

export async function scrapeAmazon(
  product: NormalizedProduct | null,
  query: string,
  opts?: { maxPages?: number },
): Promise<AmazonScrapeResult> {
  const euQuery = product ? buildEuQuery(product) : query;
  const maxPages =
    opts?.maxPages && opts.maxPages > 0 ? opts.maxPages : config.scraping.max_pages;
  // Reduced jitter for Amazon — the home-page-first approach needs to run
  // quickly before Amazon's rate limiter kicks in. Only wait 1-2s.
  await sleep(jitter(1000, 2000));
  const { comps, status } = await scrapeAmazonLive(euQuery, maxPages);
  if (comps.length > 0) {
    return { comps, degraded: false, liveFetchStatus: status };
  }
  return {
    comps: [],
    degraded: true,
    warning: `Amazon live fetch returned 0 comps.`,
    liveFetchStatus: status,
  };
}

export { buildEuQuery };
