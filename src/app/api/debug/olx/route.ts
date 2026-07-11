import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/debug/olx?query=iPhone+15+Pro+256GB
 * Debug endpoint for OLX.pt scraper — captures screenshots, selector counts,
 * and sample listings.
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
      extraHTTPHeaders: { "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8" },
    });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
    const page = await ctx.newPage();

    const slug = query.toLowerCase().replace(/\s+/g, "-");
    const url = `https://www.olx.pt/q-${slug}/`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "1. Navigate", url, pageTitle: await page.title() });

    try { await page.waitForSelector("[data-cy='l-card']", { state: "attached", timeout: 10000 }); } catch { /* */ }
    await page.waitForTimeout(2000);

    const cardCount = await page.locator("[data-cy='l-card']").count();
    const htmlLen = await page.evaluate(() => document.documentElement.outerHTML.length);
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "2. State after wait", cardCount, htmlLen });

    // Screenshot
    const dir = path.join(process.cwd(), "db", "debug-screenshots");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ss = path.join(dir, `olx-${Date.now()}.png`);
    await page.screenshot({ path: ss, fullPage: false });
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "3. Screenshot", screenshot: ss });

    // Extract sample listings
    const samples = await page.evaluate(() => {
      const cards = document.querySelectorAll("[data-cy='l-card']");
      const results: Array<{ title: string; price: string; allText: string }> = [];
      cards.forEach((card, i) => {
        if (i >= 5) return;
        const titleEl = card.querySelector("h4, h6");
        const allText = (card.textContent || "").replace(/\s+/g, " ").trim();
        const priceMatch = allText.match(/(\d[\d\s.\u00A0]*(?:,\d{1,2})?)\s*€/);
        results.push({ title: titleEl?.textContent?.trim()?.substring(0, 80) || "", price: priceMatch ? priceMatch[0] : "NO PRICE", allText: allText.substring(0, 200) });
      });
      return results;
    });
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "4. Sample listings", samples });

    await ctx.close();
  } catch (e) {
    (diagnostics.errors as string[]).push(e instanceof Error ? e.message : String(e));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return NextResponse.json(diagnostics);
}
