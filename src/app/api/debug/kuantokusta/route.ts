import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/debug/kuantokusta?query=iPhone+15+Pro+256GB
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query") || "iPhone 15 Pro 256GB";
  const diagnostics: Record<string, unknown> = { query, steps: [], errors: [] };

  // Strategy 1: HTTP fetch
  try {
    const url = `https://www.kuantokusta.pt/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
      },
    });
    const html = await res.text();
    (diagnostics.steps as Array<Record<string, unknown>>).push({
      step: "1. HTTP fetch", url, status: res.status, htmlLength: html.length,
      hasProducts: html.includes("/produto/"), hasPrices: html.includes("€"),
      bodySnippet: html.substring(0, 500),
    });
  } catch (e) {
    (diagnostics.errors as string[]).push(`HTTP fetch: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Strategy 2: Playwright
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-setuid-sandbox"] });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "pt-PT", viewport: { width: 1920, height: 1080 },
    });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
    const page = await ctx.newPage();

    const url = `https://www.kuantokusta.pt/search?q=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);
    const pageTitle = await page.title();
    const htmlLen = await page.evaluate(() => document.documentElement.outerHTML.length);
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
    const productLinks = await page.locator("a[href*='/produto/']").count();
    (diagnostics.steps as Array<Record<string, unknown>>).push({
      step: "2. Playwright", pageTitle, htmlLen, productLinks, bodyText,
    });

    // Screenshot
    const dir = path.join(process.cwd(), "db", "debug-screenshots");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ss = path.join(dir, `kuantokusta-${Date.now()}.png`);
    await page.screenshot({ path: ss, fullPage: false });
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "3. Screenshot", screenshot: ss });

    await ctx.close();
  } catch (e) {
    (diagnostics.errors as string[]).push(`Playwright: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return NextResponse.json(diagnostics);
}
