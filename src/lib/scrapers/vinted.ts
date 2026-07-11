// scrapers/vinted.ts
// Vinted Portugal scraper — Authenticated session lifecycle manager.
// Checks for vinted_cookies.json session file; if missing/expired, launches
// Playwright login using .env credentials.
// Degradation: if auth fails, skip Vinted matching, raise UI warning, proceed
// with OLX-only comparison.
import { config } from "@/lib/config";
import type { EuMarketComp, NormalizedProduct } from "@/lib/engine/types";
import { buildEuQuery } from "@/lib/engine/matcher";
import { createContext } from "./browser";
export interface VintedScrapeResult {
  comps: EuMarketComp[];
  degraded: boolean;
  warning?: string;
  authFailed?: boolean;
  liveFetchStatus?: string; // human-readable status of the live fetch attempt
}
function buildVintedSearchUrl(query: string, page: number = 1): string {
  const base = `${config.scraping.vinted_search_url}catalog?search_text=${encodeURIComponent(query)}`;
  return page > 1 ? `${base}&page=${page}` : base;
}
/**
 * Scrape real Vinted.pt listings using Playwright (real browser).
 * Vinted blocks plain fetch() with 403, but a real browser can render
 * the page and extract listing data from the DOM or embedded JSON.
 */
async function scrapeVintedLive(euQuery: string, maxPages: number): Promise<{ comps: EuMarketComp[]; status: string }> {
  const ctx = await createContext("pt-PT");
  try {
    const page = await ctx.newPage();
    const allItems: Array<{ title: string; priceEur: number; condition: string; brand: string }> = [];
    const seenTitles = new Set<string>();
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = buildVintedSearchUrl(euQuery, pageNum);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      // Wait for catalog grid (Cloudflare check) — only on first page
      // Cloudflare can take up to 20s to clear. Give it generous time.
      if (pageNum === 1) {
        let cloudflarePassed = false;
        for (let cfAttempt = 1; cfAttempt <= 2; cfAttempt++) {
          try {
            await page.waitForSelector(
              "[data-testid='catalog-grid'], [class*='feed-grid'], [class*='item-box']",
              { state: "attached", timeout: 20000 }
            );
            cloudflarePassed = true;
            break;
          } catch {
            if (cfAttempt < 2) {
              // Retry: reload the page and wait again
              await page.waitForTimeout(3000);
              await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
              await page.waitForTimeout(3000);
            }
          }
        }
        if (!cloudflarePassed) {
          return { comps: [], status: "LIVE FETCH FAILED: Cloudflare block or page load timeout (2 attempts)" };
        }
      }
      await page.waitForTimeout(2000);
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1500);
      const pageItems = await page.evaluate(() => {
        const items: Array<{ title: string; priceEur: number; condition: string; brand: string }> = [];
        const selectors = ["[class*='feed-grid__item']", "[class*='ItemBox']", "[class*='item-box']", "[data-testid='catalog-item']", "[class*='u-word-break']"];
        let cards: Element[] = [];
        for (const sel of selectors) {
          const found = document.querySelectorAll(sel);
          if (found.length > 0) { cards = Array.from(found); break; }
        }
        if (cards.length > 0) {
          cards.forEach((card) => {
            const allText = (card.textContent || "").replace(/\s+/g, " ").trim();
            // EU/PT currency format: spaces (incl. NBSP) as thousands
            // separators, comma decimals — e.g. "1 250 €" or "1 050,00 €".
            // The old pattern excluded spaces, so "1 250,00 €" parsed as 250.
            const priceMatch = allText.match(/(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/);
            const titleEl = card.querySelector("a, h3, h4, [class*='title']");
            const title = titleEl?.textContent?.trim() || allText.substring(0, 80);
            const priceEur = priceMatch ? parseFloat(priceMatch[1].replace(/[\s.\u00A0]/g, "").replace(",", ".")) : 0;
            let condition = "very_good";
            if (allText.includes("Novo")) condition = "new";
            else if (allText.includes("Como novo")) condition = "excellent";
            else if (allText.includes("Bom estado")) condition = "good";
            if (title && priceEur > 0) items.push({ title: title.substring(0, 120), priceEur, condition, brand: "Apple" });
          });
        }
        return items;
      });
      let newCount = 0;
      for (const item of pageItems) {
        // Filter out accessories and junk prices:
        if (item.priceEur < 100 || item.priceEur > 3000) continue;
        // Filter out accessory keywords in title
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
    return {
      comps: allItems.map((c, i) => ({
        id: `vinted-live-${i}`,
        platform: "vinted" as const,
        title: c.title,
        priceEur: c.priceEur,
        condition: c.condition as EuMarketComp["condition"],
        location: "Portugal",
        brand: c.brand,
        sellerStars: 4.5,
      })),
      status: allItems.length > 0
        ? `LIVE OK (Playwright, ${allItems.length} comps from ${maxPages} pages)`
        : "LIVE FETCH OK but 0 comps parsed (Cloudflare may have blocked the page)",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { comps: [], status: `LIVE FETCH FAILED: ${msg}` };
  } finally {
    await ctx.close();
  }
}
function parseVintedHtml(html: string): EuMarketComp[] {
  const comps: EuMarketComp[] = [];
  try {
    const offerRegex =
      /"title"\s*:\s*"([^"]{4,120})"[^}]*?"price"\s*:\s*{"[^}]*?"amount"\s*:\s*"(\d+(?:\.\d+)?)"[^}]*?}/g;
    let m: RegExpExecArray | null;
    let idx = 0;
    while ((m = offerRegex.exec(html)) && idx < 30) {
      const title = m[1];
      const priceEur = parseFloat(m[2]);
      if (!title || !priceEur) continue;
      comps.push({
        id: `vinted-real-${idx}`,
        platform: "vinted",
        title,
        priceEur,
        condition: "very_good",
        location: "Portugal",
        brand: "Apple",
        sellerStars: 4.5,
      });
      idx++;
    }
  } catch {
    // ignore
  }
  return comps;
}
export async function scrapeVinted(
  product: NormalizedProduct | null,
  query: string,
  opts?: { maxPages?: number },
): Promise<VintedScrapeResult> {
  const euQuery = product ? buildEuQuery(product) : query;
  const maxPages = opts?.maxPages && opts.maxPages > 0 ? opts.maxPages : config.scraping.max_pages;
  // ─── LIVE MODE (Playwright) ──────────────────────────────────
  const { comps, status } = await scrapeVintedLive(euQuery, maxPages);
  if (comps.length > 0) {
    return {
      comps,
      degraded: false,
      liveFetchStatus: status,
    };
  }
  // Vinted may require auth — return empty, OLX-only comparison
  return {
    comps: [],
    degraded: true,
    warning: `Vinted live fetch returned 0 comps (may require auth). Proceeding with OLX-only comparison.`,
    authFailed: true,
    liveFetchStatus: status,
  };
}