import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dismiss Amazon's cookie-consent banner (form#cos-banner) via the Accept
 * (sp-cc-accept) or Decline (sp-cc-rejectall-link) submit inputs. Verified
 * live with Playwright: clicking either removes the overlay.
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
 * GET /api/debug/amazon?query=iPhone+15+Pro+256GB
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query") || "iPhone 15 Pro 256GB";
  const diagnostics: Record<string, unknown> = { query, steps: [], errors: [] };

  // Strategy 1: HTTP fetch
  try {
    const url = `https://www.amazon.es/s?k=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      },
    });
    const html = await res.text();
    const hasSearchResults = html.includes('data-component-type="s-search-result"');
    const hasPrices = html.includes("€");
    (diagnostics.steps as Array<Record<string, unknown>>).push({
      step: "1. HTTP fetch", url, status: res.status, htmlLength: html.length,
      hasSearchResults, hasPrices,
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
      locale: "es-ES", viewport: { width: 1920, height: 1080 },
    });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
    const page = await ctx.newPage();

    // Visit home first
    await page.goto("https://www.amazon.es/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
    const bannerOnHome = await page.locator("form#cos-banner, #sp-cc-accept, #sp-cc-rejectall-link").count();
    const bannerDismissed = await dismissCookieBanner(page);
    const homeTitle = await page.title();
    (diagnostics.steps as Array<Record<string, unknown>>).push({
      step: "2. Home page", homeTitle, homeBlocked: homeTitle.includes("sentimos"),
      cookieBannerPresent: bannerOnHome > 0, cookieBannerDismissed: bannerDismissed,
    });

    // Search
    const url = `https://www.amazon.es/s?k=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(4000);
    const bannerOnSearch = await page.locator("form#cos-banner, #sp-cc-accept, #sp-cc-rejectall-link").count();
    if (bannerOnSearch > 0) await dismissCookieBanner(page);
    const searchTitle = await page.title();
    const cardCount = await page.locator("div[data-component-type='s-search-result']").count();
    const htmlLen = await page.evaluate(() => document.documentElement.outerHTML.length);
    (diagnostics.steps as Array<Record<string, unknown>>).push({
      step: "3. Search page", searchTitle, cardCount, htmlLen, searchBlocked: searchTitle.includes("sentimos"),
      cookieBannerOnSearch: bannerOnSearch > 0,
    });

    // Screenshot
    const dir = path.join(process.cwd(), "db", "debug-screenshots");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ss = path.join(dir, `amazon-${Date.now()}.png`);
    await page.screenshot({ path: ss, fullPage: false });
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "4. Screenshot", screenshot: ss });

    // Sample listings
    const samples = await page.evaluate(() => {
      const cards = document.querySelectorAll("div[data-component-type='s-search-result']");
      return Array.from(cards).slice(0, 5).map(card => {
        const h2 = card.querySelector("h2");
        const titleEl = card.querySelector("h2 a span, h2 span.a-text-normal, h2 span");
        const priceEl = card.querySelector("[class*='a-price'] [class*='a-offscreen']");
        const linkEl = card.querySelector<HTMLAnchorElement>("h2 a[href*='/dp/'], a[href*='/dp/'], a[href]");
        return {
          title: (titleEl?.textContent?.trim() || h2?.getAttribute("aria-label") || "").substring(0, 80),
          price: priceEl?.textContent?.trim() || "NO PRICE",
          url: linkEl?.href?.substring(0, 90) || "NO LINK",
        };
      });
    });
    (diagnostics.steps as Array<Record<string, unknown>>).push({ step: "5. Samples", samples });

    await ctx.close();
  } catch (e) {
    (diagnostics.errors as string[]).push(`Playwright: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return NextResponse.json(diagnostics);
}
