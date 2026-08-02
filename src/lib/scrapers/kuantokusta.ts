// scrapers/kuantokusta.ts
// KuantoKusta.pt scraper — Portuguese price-comparison site.
// All listings on KuantoKusta are NEW retail products (stores selling at
// retail prices), so every comp returned here is tagged condition="new"
// and isRetail=true.
//
// Strategy: Try a plain HTTP fetch first (which has a different TLS
// fingerprint than Playwright headless Chrome and is less likely to be
// blocked by Akamai WAF). If that returns HTML, parse it. If blocked,
// fall back to Playwright with stealth measures.
import { config } from "@/lib/config";
import type { Condition, EuMarketComp, NormalizedProduct } from "@/lib/engine/types";
import { buildEuQuery } from "@/lib/engine/matcher";
import { createContext } from "./browser";

export interface KuantokustaScrapeResult {
  comps: EuMarketComp[];
  degraded: boolean;
  warning?: string;
  liveFetchStatus?: string;
}

function buildKuantokustaSearchUrl(query: string, page: number = 1): string {
  const base = `${config.scraping.kuantokusta_search_url}${encodeURIComponent(query)}`;
  return page > 1 ? `${base}&page=${page}` : base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}

/**
 * Parse KuantoKusta search results from raw HTML.
 * KuantoKusta is a Next.js SPA that embeds product data in <script> tags
 * as JSON (Next.js __NEXT_DATA__ or similar). We also try regex extraction
 * from the rendered HTML.
 */
function parseKkHtml(html: string, baseUrl: string): Array<{ title: string; priceEur: number; store: string }> {
  const items: Array<{ title: string; priceEur: number; store: string }> = [];
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
          if (title && priceEur > 0 && priceEur <= 10000) {
            items.push({ title: title.substring(0, 120), priceEur, store });
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
          items.push({ title: title.substring(0, 120), priceEur, store: "Loja" });
        }
      }
    }

    // Strategy 3: Broad price + title extraction
    if (items.length === 0) {
      // Find all € prices and try to pair them with nearby titles
      const priceRegex = /(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/g;
      const prices: number[] = [];
      let pm: RegExpExecArray | null;
      while ((pm = priceRegex.exec(html)) && prices.length < 50) {
        const cleanPrice = pm[1].replace(/[\s.\u00A0]/g, "").replace(",", ".");
        const priceEur = parseFloat(cleanPrice);
        if (priceEur > 1 && priceEur <= 10000) prices.push(priceEur);
      }
      // Find product titles (h2, h3, or elements with product-related classes)
      const titleRegex = /<(?:h2|h3|a)[^>]*>([^<]{5,120})<\/(?:h2|h3|a)>/g;
      const titles: string[] = [];
      let tm: RegExpExecArray | null;
      while ((tm = titleRegex.exec(html)) && titles.length < 50) {
        const title = tm[1].trim();
        // Filter out navigation items
        if (title.length > 5 && !title.includes("Pesquisa") && !title.includes("Início")) {
          titles.push(title);
        }
      }
      // Pair titles with prices positionally
      const count = Math.min(titles.length, prices.length);
      for (let i = 0; i < count; i++) {
        items.push({ title: titles[i].substring(0, 120), priceEur: prices[i], store: "Loja" });
      }
    }
  } catch {
    // ignore
  }
  return items;
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
): Promise<{ comps: EuMarketComp[]; status: string }> {
  const allItems: Array<{ title: string; priceEur: number; store: string }> = [];
  const seenTitles = new Set<string>();

  // Strategy 1: Plain HTTP fetch (less likely to be blocked)
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const { html } = await fetchKkHtml(euQuery, pageNum);
    if (html) {
      const items = parseKkHtml(html, buildKuantokustaSearchUrl(euQuery, pageNum));
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
        location: "Portugal",
        vendorType: c.store,
        negotiable: false,
        viewCount: 0,
        isRetail: true,
      })),
      status: `LIVE OK (HTTP fetch, ${allItems.length} comps)`,
    };
  }

  // Strategy 2: Playwright fallback with stealth measures
  // KuantoKusta uses Akamai WAF which blocks headless browsers.
  // Use extra stealth measures: realistic headers, longer waits.
  const ctx = await createContext("pt-PT");
  try {
    const page = await ctx.newPage();

    // Set extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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
    });

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = buildKuantokustaSearchUrl(euQuery, pageNum);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

      // Wait for Cloudflare/Akamai challenge to pass (up to 15s)
      try {
        await page.waitForSelector(
          "[class*='product'], [data-product-id], [class*='card'], a[href*='/produto/']",
          { state: "attached", timeout: 15000 },
        );
      } catch {
        // Try scrolling to trigger lazy load
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(3000);
      }

      const pageItems = await page.evaluate(() => {
        const items: Array<{ title: string; priceEur: number; store: string }> = [];
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
          const productLink = card.querySelector("a[href*='/produto/']");
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
          if (title && priceEur > 0) {
            items.push({ title: title.substring(0, 120), priceEur, store });
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
    await ctx.close();
    if (allItems.length > 0) {
      return {
        comps: allItems.map((c, i) => ({
          id: `kk-live-${i}`,
          platform: "kuantokusta" as const,
          title: c.title,
          priceEur: c.priceEur,
          condition: "new" as Condition,
          location: "Portugal",
          vendorType: c.store,
          negotiable: false,
          viewCount: 0,
          isRetail: true,
        })),
        status: `LIVE OK (Playwright, ${allItems.length} comps from ${maxPages} pages)`,
      };
    }
    return {
      comps: [],
      status: `LIVE FETCH FAILED: KuantoKusta blocked by Akamai WAF (HTTP 403 + Playwright blocked). This IP is blocked.`,
    };
  } catch (e) {
    await ctx.close();
    const msg = e instanceof Error ? e.message : String(e);
    return { comps: [], status: `LIVE FETCH FAILED: ${msg}` };
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
  const { comps, status } = await scrapeKuantokustaLive(euQuery, maxPages);
  if (comps.length > 0) {
    return { comps, degraded: false, liveFetchStatus: status };
  }
  return {
    comps: [],
    degraded: true,
    warning: `KuantoKusta live fetch returned 0 comps.`,
    liveFetchStatus: status,
  };
}

export { buildEuQuery };
