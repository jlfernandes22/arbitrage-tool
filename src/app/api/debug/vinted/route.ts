import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/debug/vinted?query=iPhone+15+Pro+256GB
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query") || "iPhone 15 Pro 256GB";
  const diagnostics: Record<string, unknown> = { query, steps: [], errors: [] };

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "pt-PT", viewport: { width: 1920, height: 1080 },
    });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
    const page = await ctx.newPage();

    const url = `https://www.vinted.pt/catalog?search_text=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "1. Navigate", url, pageTitle: await page.title() });

    // Wait for Cloudflare
    let cfPassed = false;
    try {
      await page.waitForSelector("[data-testid='catalog-grid'], [class*='feed-grid'], [class*='item-box']", { state: "attached", timeout: 20000 });
      cfPassed = true;
    } catch { /* Cloudflare blocked */ }
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "2. Cloudflare check", cloudflarePassed: cfPassed });

    await page.waitForTimeout(2000);
    const cardCount = await page.evaluate(() => {
      const selectors = ["[class*='feed-grid__item']", "[class*='ItemBox']", "[class*='item-box']", "[data-testid='catalog-item']", "[class*='u-word-break']"];
      for (const sel of selectors) { const found = document.querySelectorAll(sel); if (found.length > 0) return { count: found.length, selector: sel }; }
      return { count: 0, selector: "none" };
    });
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "3. Cards", cardCount });

    // Screenshot
    const dir = path.join(process.cwd(), "db", "debug-screenshots");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ss = path.join(dir, `vinted-${Date.now()}.png`);
    await page.screenshot({ path: ss, fullPage: false });
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "4. Screenshot", screenshot: ss });

    // Sample listings
    const samples = await page.evaluate(() => {
      const selectors = ["[class*='feed-grid__item']", "[class*='ItemBox']", "[class*='item-box']", "[data-testid='catalog-item']", "[class*='u-word-break']"];
      let cards: Element[] = [];
      for (const sel of selectors) { const found = document.querySelectorAll(sel); if (found.length > 0) { cards = Array.from(found); break; } }
      return cards.slice(0, 5).map(card => {
        const allText = (card.textContent || "").replace(/\s+/g, " ").trim();
        const priceMatch = allText.match(/(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/);
        return { title: allText.substring(0, 80), price: priceMatch ? priceMatch[0] : "NO PRICE" };
      });
    });
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "5. Samples", samples });

    await ctx.close();
  } catch (e) {
    (diagnostics.errors as string[]).push(e instanceof Error ? e.message : String(e));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return NextResponse.json(diagnostics);
}
