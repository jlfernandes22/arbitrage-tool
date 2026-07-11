// scrapers/olx.ts
// OLX Portugal scraper — uses Playwright (real browser) to bypass anti-bot
// protection and extract real listings from the rendered DOM.
import { config } from "@/lib/config";
import type { Condition, EuMarketComp, NormalizedProduct } from "@/lib/engine/types";
import { buildEuQuery, scoreEuComp } from "@/lib/engine/matcher";
import { createContext } from "./browser";
export interface OlxScrapeResult {
  comps: EuMarketComp[];
  degraded: boolean;
  warning?: string;
  liveFetchStatus?: string; // human-readable status of the live fetch attempt
}
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
];
function pickUa(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}
export function buildOlxSearchUrl(query: string, page: number = 1): string {
  const slug = query.toLowerCase().replace(/\s+/g, "-");
  const base = `${config.scraping.olx_search_url}${slug}/`;
  return page > 1 ? `${base}?page=${page}` : base;
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function jitter(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}
/**
 * Scrape real OLX.pt listings using Playwright (real browser).
 * Extracts title + price + location from the rendered DOM.
 */
async function scrapeOlxLive(euQuery: string, maxPages: number): Promise<{ comps: EuMarketComp[]; status: string }> {
  const ctx = await createContext("pt-PT");
  try {
    const page = await ctx.newPage();
    const allItems: Array<{ title: string; priceEur: number; location: string; condition: string }> = [];
    const seenTitles = new Set<string>();
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = buildOlxSearchUrl(euQuery, pageNum);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      // Wait for listing cards to render — OLX uses client-side JS rendering.
      // If the selector doesn't appear within 8s, the page is likely blocked
      // or showing a CAPTCHA. Don't wait the full 15s — move on quickly.
      try {
        await page.waitForSelector("[data-cy='l-card']", { state: "attached", timeout: 8000 });
      } catch {
        // Cards didn't render — try scrolling to trigger lazy load
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(2000);
      }
      const pageItems = await page.evaluate(() => {
        const items: Array<{ title: string; priceEur: number; location: string; condition: string }> = [];
        const cards = document.querySelectorAll("[data-cy='l-card']");
        cards.forEach((card) => {
          const titleEl = card.querySelector("h4, h6");
          const allText = (card.textContent || "").replace(/\s+/g, " ").trim();
          // EU/PT currency format: "1 250 €", "1 050,00 €", "1.250 €".
          // Anchor on a leading digit so stray separators are never captured,
          // strip space/NBSP/dot thousands separators, comma → decimal point.
          const priceMatch = allText.match(/(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/);
          let priceEur = 0;
          if (priceMatch) {
            const cleanPrice = priceMatch[1].replace(/[\s.\u00A0]/g, "").replace(",", ".");
            priceEur = parseFloat(cleanPrice);
          }
          const locationMatch = allText.match(/(?:Usado|Novo|Como novo)\s*(.+?)(?:\d|\d{2} de)/);
          let condition = "very_good";
          if (allText.includes("Novo")) condition = "new";
          else if (allText.includes("Como novo")) condition = "excellent";
          else if (allText.includes("Usado")) condition = "good";
          const title = titleEl?.textContent?.trim() || "";
          if (title && priceEur > 0) {
            items.push({ title: title.substring(0, 120), priceEur, location: locationMatch?.[1]?.trim() || "Portugal", condition });
          }
        });
        return items;
      });
      let newCount = 0;
      for (const item of pageItems) {
        // Filter out accessories and junk prices:
        // < €100 = accessories (cases, chargers, screen protectors)
        // > €3000 = parsing errors or bundles
        if (item.priceEur < 100 || item.priceEur > 3000) continue;
        // Filter out accessory keywords in title
        const titleLower = item.title.toLowerCase();
        if (/\b(case|cover|capa|film|protector|protetor|charger|carregador|cable| cabo|adapter|adaptador|screen|ecra|écrã|battery|bateria|holder|suporte|stand|dock|mount|bracket|clip|sticker|skin|decal|tempered|vidro|película|pelicula)\b/i.test(titleLower)) continue;
        if (!seenTitles.has(item.title)) {
          seenTitles.add(item.title);
          allItems.push(item);
          newCount++;
        }
      }
      if (newCount === 0) break; // no more results
    }
    await ctx.close();
    return {
      comps: allItems.map((c, i) => ({
        id: `olx-live-${i}`,
        platform: "olx" as const,
        title: c.title,
        priceEur: c.priceEur,
        condition: c.condition as Condition,
        location: c.location,
        vendorType: "Particular",
        negotiable: false,
        viewCount: 0,
      })),
      status: `LIVE OK (Playwright, ${allItems.length} comps from ${maxPages} pages)`,
    };
  } catch (e) {
    await ctx.close();
    const msg = e instanceof Error ? e.message : String(e);
    return { comps: [], status: `LIVE FETCH FAILED: ${msg}` };
  }
}
function parseOlxHtml(html: string): EuMarketComp[] {
  const comps: EuMarketComp[] = [];
  try {
    // OLX embeds listing data in JSON-LD or data attributes.
    // Try JSON-LD offers first.
    const offerRegex =
      /"name"\s*:\s*"([^"]{4,120})"[^}]*?"price"\s*:\s*"?(\d+(?:\.\d+)?)"?[^}]*?"priceCurrency"\s*:\s*"EUR"/g;
    let m: RegExpExecArray | null;
    let idx = 0;
    while ((m = offerRegex.exec(html)) && idx < 30) {
      const title = m[1];
      const priceEur = parseFloat(m[2]);
      if (!title || !priceEur) continue;
      comps.push({
        id: `olx-real-${idx}`,
        platform: "olx",
        title,
        priceEur,
        condition: "very_good",
        location: "Lisboa",
        vendorType: "Particular",
        negotiable: true,
        viewCount: 0,
      });
      idx++;
    }
  } catch {
    // ignore
  }
  return comps;
}
export async function scrapeOlx(
  product: NormalizedProduct | null,
  query: string,
  opts?: { maxPages?: number },
): Promise<OlxScrapeResult> {
  const euQuery = product ? buildEuQuery(product) : query;
  const maxPages = opts?.maxPages && opts.maxPages > 0 ? opts.maxPages : config.scraping.max_pages;
  // ─── LIVE MODE (Playwright) ──────────────────────────────────
  await sleep(jitter(config.scraping.jitter_min_ms, config.scraping.jitter_max_ms));
  const { comps, status } = await scrapeOlxLive(euQuery, maxPages);
  if (comps.length > 0) {
    const filtered = product
      ? comps.filter((c) => scoreEuComp(c, product) >= 30)
      : comps;
    return {
      comps: filtered,
      degraded: false,
      liveFetchStatus: status,
    };
  }
  // Live fetch returned 0 comps — return empty
  return {
    comps: [],
    degraded: true,
    warning: `Live Playwright fetch to olx.pt returned 0 comps.`,
    liveFetchStatus: status,
  };
}
export { buildEuQuery };
export type { Condition };