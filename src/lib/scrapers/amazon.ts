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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}

/**
 * Parse Amazon search results from raw HTML.
 * Amazon renders search results server-side with data in the HTML.
 */
function parseAmazonHtml(html: string): Array<{ title: string; priceEur: number; prime: boolean }> {
  const items: Array<{ title: string; priceEur: number; prime: boolean }> = [];
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
      // Title: h2 a span or h2 span.a-text-normal
      const titleMatch = cardHtml.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([^<]{5,200})<\/span>/);
      const title = titleMatch?.[1]?.trim() || "";
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
      items.push({ title: title.substring(0, 120), priceEur, prime });
    }

    // Strategy 2: Fallback — extract all h2 titles + prices positionally
    if (items.length === 0) {
      const titleRegex = /<h2[^>]*>[\s\S]*?<span[^>]*class="[^"]*a-text-normal[^"]*"[^>]*>([^<]{5,200})<\/span>/g;
      const titles: string[] = [];
      let tm: RegExpExecArray | null;
      while ((tm = titleRegex.exec(html)) && titles.length < 50) {
        titles.push(tm[1].trim());
      }
      const priceRegex = /(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/g;
      const prices: number[] = [];
      let pm: RegExpExecArray | null;
      while ((pm = priceRegex.exec(html)) && prices.length < 50) {
        const cleanPrice = pm[1].replace(/[\s.\u00A0]/g, "").replace(",", ".");
        const priceEur = parseFloat(cleanPrice);
        if (priceEur > 1 && priceEur <= 10000) prices.push(priceEur);
      }
      const count = Math.min(titles.length, prices.length);
      for (let i = 0; i < count; i++) {
        items.push({ title: titles[i].substring(0, 120), priceEur: prices[i], prime: false });
      }
    }
  } catch {
    // ignore
  }
  return items;
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
 * Scrape Amazon using HTTP-fetch-first approach, then Playwright fallback.
 */
async function scrapeAmazonLive(
  euQuery: string,
  maxPages: number,
): Promise<{ comps: EuMarketComp[]; status: string }> {
  const allItems: Array<{ title: string; priceEur: number; prime: boolean }> = [];
  const seenTitles = new Set<string>();

  // Strategy 1: Plain HTTP fetch (works from most IPs — Amazon returns full HTML)
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const { html } = await fetchAmazonHtml(euQuery, pageNum);
    if (html) {
      const items = parseAmazonHtml(html);
      let newCount = 0;
      for (const item of items) {
        if (item.priceEur < 100 || item.priceEur > 3000) continue;
        const titleLower = item.title.toLowerCase();
        if (/\b(case|cover|capa|film|protector|protetor|charger|carregador|cable|cabo|adapter|adaptador|screen|ecra|écrã|battery|bateria|holder|suporte|stand|dock|mount|bracket|clip|sticker|skin|decal|tempered|vidro|película|pelicula)\b/i.test(titleLower)) continue;
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
        location: "Amazon.es",
        vendorType: c.prime ? "Amazon Prime" : "Amazon",
        negotiable: false,
        viewCount: 0,
        isRetail: true,
      })),
      status: `LIVE OK (HTTP fetch, ${allItems.length} comps)`,
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
    const ctx = await freshBrowser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "es-ES",
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
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
    const page = await ctx.newPage();

    // Step 1: Visit Amazon home page first to establish a session + WAF token.
    // Amazon's bot detection is intermittent — sometimes blocks the first
    // request. Retry up to 5 times with increasing waits.
    let homeLoaded = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await page.goto("https://www.amazon.es/", { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(3000 + attempt * 2000); // increasing wait
        const homeTitle = await page.title();
        if (homeTitle && !homeTitle.includes("sentimos") && homeTitle.length > 5) {
          homeLoaded = true;
          break;
        }
      } catch {
        // retry
      }
    }
    if (!homeLoaded) {
      await freshBrowser.close();
      return { comps: [], status: "LIVE FETCH FAILED: Amazon home page blocked after 5 attempts" };
    }

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = buildAmazonSearchUrl(euQuery, pageNum);
      // Step 2: Navigate to search page (now with session cookie + WAF token)
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(4000);
      // Check if the search page loaded properly
      const searchTitle = await page.title();
      if (searchTitle.includes("sentimos")) {
        // Amazon blocked the search request — wait and retry once
        await page.waitForTimeout(3000);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(4000);
      }

      const pageItems = await page.evaluate(() => {
        const items: Array<{ title: string; priceEur: number; prime: boolean }> = [];
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
          const titleSelectors = [
            "h2 a span",
            "h2 span.a-text-normal",
            "h2 a",
            "img.s-image",
          ];
          for (const sel of titleSelectors) {
            const el = card.querySelector(sel);
            const text = el?.textContent?.trim() || (el as HTMLImageElement)?.alt || "";
            if (text && text.length > 5) {
              title = text;
              break;
            }
          }
          if (!title) return;
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
            items.push({ title: title.substring(0, 120), priceEur, prime });
          }
        });
        return items;
      });

      let newCount = 0;
      for (const item of pageItems) {
        if (item.priceEur < 100 || item.priceEur > 3000) continue;
        const titleLower = item.title.toLowerCase();
        if (/\b(case|cover|capa|film|protector|protetor|charger|carregador|cable|cabo|adapter|adaptador|screen|ecra|écrã|battery|bateria|holder|suporte|stand|dock|mount|bracket|clip|sticker|skin|decal|tempered|vidro|película|pelicula)\b/i.test(titleLower)) continue;
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
        location: "Amazon.es",
        vendorType: c.prime ? "Amazon Prime" : "Amazon",
        negotiable: false,
        viewCount: 0,
        isRetail: true,
      })),
      status: `LIVE OK (Playwright, ${allItems.length} comps from ${maxPages} pages)`,
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
