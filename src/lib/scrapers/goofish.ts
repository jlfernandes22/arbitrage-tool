// scrapers/goofish.ts
// Goofish (闲鱼) scraper — Unauthenticated Modal-Dismissal Strategy via
// Direct URL Synthesis with Playwright (real browser).
//
// Strategy (production):
//  1. Construct search URL: https://www.goofish.com/search?q=<encoded>&spm=a21ybx.search.searchInput.0
//     The spm parameter is REQUIRED — without it, Goofish may return an empty page.
//  2. After page.goto(), the login modal (.loginCon--d9IpwYeU) overlays the
//     page. Do NOT log in. Dismiss by pressing Escape or clicking (0,0).
//  3. Wait for listing cards to render in the DOM (they load via AJAX after
//     the modal is dismissed).
//  4. Extract: title, price (CNY), seller info, image URLs, item link.
//  5. Hard-cap to 50 listings per search. Inject 3-7s jitter between requests.
//  6. NO mock data fallback in live mode. If 0 listings extracted, return empty.
//
import { config } from "@/lib/config";
import type { Category, GoofishListing } from "@/lib/engine/types";
import { normalizeListing } from "@/lib/engine/normalizer";
import { createContext } from "./browser";
import { chromium } from "playwright";
export interface GoofishScrapeResult {
  listings: GoofishListing[];
  degraded: boolean;
  warning?: string;
  blocked?: boolean; // hard block — needs manual paste
  liveFetchStatus?: string; // human-readable status of the live fetch attempt
}
export function buildGoofishSearchUrl(query: string): string {
  // The spm parameter is REQUIRED for Goofish to return search results.
  // Without it, the page may render empty.
  // CRITICAL: Use the ORIGINAL English query, NOT a Chinese translation.
  // The Chinese-translated query (e.g. "苹果 15 Pro 256GB") gets blocked by
  // Goofish's anti-bot system on automated browsers, returning a 6.8KB empty
  // page. The English query (e.g. "iPhone 15 Pro 256GB") returns the full
  // 305KB page with 30 listings. Goofish search supports English queries
  // and returns the same Chinese-language listings.
  return `${config.scraping.goofish_search_url}${encodeURIComponent(query)}&spm=a21ybx.search.searchInput.0`;
}
/**
 * Translate an English search query to Chinese for Goofish (闲鱼).
 * Chinese sellers write listings in Chinese, so English queries like
 * "iPhone 15 Pro" should become "苹果15 Pro" and "Samsung Galaxy S26 Ultra"
 * should become "三星 Galaxy S26 Ultra".
 */
function translateQueryToChinese(query: string): string {
  let q = query.trim();
  // ── COMPREHENSIVE CHINESE TRANSLATION TABLE ──
  // Every brand/product in the catalog that has a Chinese name used by
  // Goofish (闲鱼) sellers. Products are translated to Chinese so the
  // search returns real results (Chinese sellers list in Chinese).
  //
  // DOUBLE-TRANSLATION PREVENTION: Product-specific translations that
  // already include the brand's Chinese name (e.g. "Osmo Pocket" → "大疆口袋云台")
  // are applied FIRST. Then the generic brand replacement (e.g. "DJI" → "大疆")
  // only runs if the Chinese brand name isn't already in the string.

  // ── Sony — specific products FIRST ──
  q = q.replace(/PlayStation\s*5/gi, "PS5");
  q = q.replace(/PlayStation/gi, "PS");
  q = q.replace(/\bDualSense\b/gi, "索尼手柄");
  q = q.replace(/\bDualShock\b/gi, "索尼手柄");
  q = q.replace(/\bWH-1000XM(\d+)/gi, "索尼降噪耳机XM$1");
  q = q.replace(/\bWF-1000XM(\d+)/gi, "索尼降噪豆XM$1");
  q = q.replace(/\bWF-C700N\b/gi, "索尼降噪豆C700N");
  // Sony brand: replace with 索尼, or remove if 索尼 already present
  q = q.includes("索尼") ? q.replace(/\bSony\s*/gi, "") : q.replace(/\bSony\b/gi, "索尼");

  // ── DJI — specific products FIRST ──
  q = q.replace(/\bDJI Mic 2\b/gi, "大疆麦克风2");
  q = q.replace(/\bDJI Mic\b/gi, "大疆麦克风");
  q = q.replace(/\bOsmo Pocket\b/gi, "大疆口袋云台");
  q = q.replace(/\bOsmo Action\b/gi, "大疆运动相机");
  q = q.replace(/\bOsmo Mobile\b/gi, "大疆灵眸");
  q = q.replace(/\bDJI RS\b/gi, "大疆如影");
  q = q.replace(/\bMavic\b/gi, "大疆Mavic");
  q = q.replace(/\bAvata\b/gi, "大疆Avata");
  q = q.replace(/\bInspire\b/gi, "大疆悟");
  // DJI brand: replace with 大疆, or remove if 大疆 already present
  q = q.includes("大疆") ? q.replace(/\bDJI\s*/gi, "") : q.replace(/\bDJI\b/gi, "大疆");

  // ── Lenovo — specific product FIRST ──
  q = q.replace(/\bLegion Go\b/gi, "联想拯救者掌机");
  // Lenovo brand: replace with 联想, or remove if 联想 already present
  q = q.includes("联想") ? q.replace(/\bLenovo\s*/gi, "") : q.replace(/\bLenovo\b/gi, "联想");

  // ── ASUS / ROG — specific products FIRST ──
  q = q.replace(/\bROG Ally\b/gi, "华硕掌机");
  q = q.replace(/\bROG Strix\b/gi, "华硕ROG Strix");
  q = q.replace(/\bROG Zephyrus\b/gi, "华硕ROG Zephyrus");
  // ROG generic: replace standalone "ROG" (not part of 华硕ROG) with 华硕ROG,
  // or skip if 华硕ROG or 华硕掌机 already present
  if (!q.includes("华硕ROG") && !q.includes("华硕掌机")) {
    q = q.replace(/\bROG\b/gi, "华硕ROG");
  }
  // Remove any remaining standalone "ROG " (leftover from product-specific translations)
  q = q.replace(/\bROG\s+(?!Strix|Zephyrus)/gi, "");
  // ASUS brand: replace with 华硕, or remove if 华硕 already present
  q = q.includes("华硕") ? q.replace(/\bASUS\s*/gi, "") : q.replace(/\bASUS\b/gi, "华硕");
  // TUF: only add 华硕 if not already present
  q = q.includes("华硕") ? q.replace(/\bTUF\b/gi, "TUF") : q.replace(/\bTUF\b/gi, "华硕TUF");

  // ── Apple ──
  q = q.replace(/\bApple Watch\b/gi, "苹果手表");
  q = q.replace(/\biPhone\b/gi, "苹果");
  q = q.replace(/\bMacBook\b/gi, "苹果笔记本");
  q = q.replace(/\biPad\b/gi, "苹果平板");
  q = q.replace(/\bAirPods\b/gi, "苹果耳机");

  // ── Samsung — specific products FIRST ──
  q = q.replace(/\bGalaxy Tab\b/gi, "三星平板");
  q = q.replace(/\bGalaxy Book\b/gi, "三星笔记本");
  q = q.replace(/\bGalaxy Buds\b/gi, "三星耳机");
  // Samsung brand: replace with 三星, or remove if 三星 already present
  q = q.includes("三星") ? q.replace(/\bSamsung\s*/gi, "") : q.replace(/\bSamsung\b/gi, "三星");

  // ── Xiaomi — specific products FIRST ──
  q = q.replace(/\bMi Band\b/gi, "小米手环");
  q = q.replace(/\bXiaomi Watch\b/gi, "小米手表");
  q = q.replace(/\bXiaomi Pad\b/gi, "小米平板");
  q = q.replace(/\bXiaomi Buds\b/gi, "小米耳机");
  q = q.replace(/\bMi Smart Desk Lamp\b/gi, "小米台灯");
  q = q.replace(/\bMi Desk Lamp\b/gi, "小米台灯");
  q = q.replace(/\bMi Bedside Lamp\b/gi, "小米床头灯");
  q = q.replace(/\bMi Smart LED Bulb\b/gi, "小米灯泡");
  q = q.replace(/\bMi Air Purifier\b/gi, "小米空气净化器");
  q = q.replace(/\bMi Smart Humidifier\b/gi, "小米加湿器");
  q = q.replace(/\bMi Smart Kettle\b/gi, "小米电水壶");
  q = q.replace(/\bYeelight\b/gi, "易来灯");
  q = q.replace(/\bMijia\b/gi, "米家");
  // Xiaomi brand: replace with 小米, or remove if 小米 already present
  q = q.includes("小米") ? q.replace(/\bXiaomi\s*/gi, "") : q.replace(/\bXiaomi\b/gi, "小米");
  q = q.replace(/\bRedmi Book\b/gi, "红米笔记本");
  q = q.replace(/\bRedmi Pad\b/gi, "红米平板");
  q = q.replace(/\bRedmi Buds\b/gi, "红米耳机");
  q = q.replace(/\bRedmi\b/gi, "红米");

  // ── OnePlus ──
  q = q.replace(/\bOnePlus\b/gi, "一加");

  // ── OPPO ──
  // OPPO stays as-is (sellers use "OPPO")

  // ── Honor ──
  q = q.replace(/\bHonor\b/gi, "荣耀");

  // ── Realme ──
  q = q.replace(/\bRealme\b/gi, "真我");

  // ── Vivo ──
  q = q.replace(/\bVivo\b/gi, "vivo");
  // iQOO stays as-is

  // ── Motorola ──
  q = q.replace(/\bRazr\b/gi, "刀锋");
  q = q.replace(/\bMotorola\b/gi, "摩托罗拉");
  q = q.replace(/\bMoto\b/gi, "摩托罗拉");

  // ── Nintendo ──
  q = q.replace(/\bNintendo\b/gi, "任天堂");

  // ── Steam Deck — sellers use "Steam Deck" as-is ──

  // ── Logitech ──
  q = q.replace(/\bLogitech\b/gi, "罗技");

  // ── Razer — specific products FIRST ──
  q = q.replace(/\bDeathAdder\b/gi, "炼狱蝰蛇");
  q = q.replace(/\bBlackWidow\b/gi, "黑寡妇");
  q = q.replace(/\bViper\b/gi, "毒蝰");
  q = q.replace(/\bBasilisk\b/gi, "巴塞利斯蛇");
  q = q.replace(/\bHuntsman\b/gi, "猎魂光蛛");
  q = q.replace(/\bBlackShark\b/gi, "黑鲨");
  q = q.replace(/\bKraken\b/gi, "北海巨妖");
  q = q.replace(/\bRazer\b/gi, "雷蛇");

  // ── Corsair ──
  q = q.replace(/\bCorsair\b/gi, "海盗船");

  // ── Camera brands ──
  q = q.replace(/\bCanon\b/gi, "佳能");
  q = q.replace(/\bNikon\b/gi, "尼康");
  q = q.replace(/\bFujifilm\b/gi, "富士");
  q = q.replace(/\bFuji\b/gi, "富士");

  // ── Microphone brands ──
  q = q.replace(/\bShure\b/gi, "舒尔");
  q = q.replace(/\bRode\b/gi, "罗德");

  // ── Speaker / audio brands ──
  // JBL → stays as-is (sellers use "JBL")
  // Bose → stays as-is (sellers use "Bose")
  // Sonos → stays as-is (sellers use "Sonos")

  // ── Robot vacuums ──
  q = q.replace(/\bRoborock\b/gi, "石头");
  q = q.replace(/\bEcovacs\b/gi, "科沃斯");
  q = q.replace(/\bDeebot\b/gi, "地宝");

  // ── Dyson — specific products FIRST ──
  q = q.replace(/\bAirwrap\b/gi, "戴森美发棒");
  q = q.replace(/\bSupersonic\b/gi, "戴森吹风机");
  q = q.replace(/\bCorrale\b/gi, "戴森卷发棒");
  q = q.replace(/\bAirstrait\b/gi, "戴森直发器");
  // Dyson brand: replace with 戴森, or remove if 戴森 already present
  q = q.includes("戴森") ? q.replace(/\bDyson\s*/gi, "") : q.replace(/\bDyson\b/gi, "戴森");

  // ── Projectors ──
  q = q.replace(/\bXGIMI\b/gi, "极米");
  q = q.replace(/\bAnker\b/gi, "安克");
  // Nebula → stays as-is

  // ── GoPro → sellers use "GoPro" as-is ──
  // ── Insta360 ──
  q = q.replace(/\bInsta360\b/gi, "影石");

  // ── Vitamix ──
  q = q.replace(/\bVitamix\b/gi, "维他密斯");

  return q;
}
/**
 * Get a sensible minimum price (CNY) for the Goofish price filter.
 * This filters out accessories/cases/scam listings that are priced very low.
 * Based on the product category — iPhones are never below ¥500, MacBooks
 * never below ¥2000, etc.
 */
function getMinPriceCny(category: Category): number {
  switch (category) {
    case "iphone": return 500;   // Real iPhones start at ~¥500
    case "macbook": return 2000; // Real MacBooks start at ~¥2000
    case "ipad": return 800;     // Real iPads start at ~¥800
    case "ps5": return 1000;     // Real PS5s start at ~¥1000
    default: return 500;
  }
}
function jitter(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
/**
 * Result of a live fetch attempt. Distinguishes "blocked/failed" from
 * "succeeded with HTML" so the caller can log the exact reason mock data
 * was (or wasn't) used.
 */
interface LiveFetchResult {
  html: string | null;
  ok: boolean;
  status?: number;
  error?: string;
}
/**
 * Attempt a real HTTP fetch of the Goofish search page HTML.
 * Returns a LiveFetchResult so the caller knows exactly what happened.
 */
async function attemptRealFetch(query: string): Promise<LiveFetchResult> {
  const url = buildGoofishSearchUrl(query);
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: "https://www.goofish.com/",
      },
    });
    if (res.ok) {
      const html = await res.text();
      if (html && html.length > 500) {
        return { html, ok: true, status: res.status };
      }
      return { html: null, ok: false, status: res.status, error: `response too short (${html?.length ?? 0} bytes)` };
    }
    return { html: null, ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { html: null, ok: false, error: msg };
  }
}
/**
 * Parse Goofish search-result HTML into listings.
 * Extracts: title, price (CNY), description, image URLs, seller location,
 * wants metric, seller reliability.
 *
 * Goofish is a React SPA so the real DOM is hydrated from JSON in <script> tags.
 * This parser looks for the embedded item JSON; if absent (anti-bot shell page),
 * returns empty so the caller falls back to mock data.
 */
export function parseGoofishHtml(html: string): GoofishListing[] {
  const listings: GoofishListing[] = [];
  try {
    // Try to find embedded item data. Goofish embeds __INITIAL_STATE__ or
    // window.__NEXT_DATA__-style JSON. We attempt a permissive regex extract.
    const itemRegex =
      /"title"\s*:\s*"([^"]{4,120})"[^}]*?"price"\s*:\s*"?(\d+(?:\.\d+)?)"?[^}]*?"desc"\s*:\s*"([^"]*)"[^}]*?"pic"\s*:\s*"([^"]*)"/g;
    let m: RegExpExecArray | null;
    let idx = 0;
    while ((m = itemRegex.exec(html)) && idx < 50) {
      const title = m[1];
      const priceCny = parseFloat(m[2]);
      const description = m[3];
      const picUrl = m[4];
      if (!title || !priceCny) continue;
      const imageUrls = picUrl ? [picUrl.replace(/\\\//g, "/")] : [];
      const normalized = normalizeListing(title, description);
      listings.push({
        id: `gf-real-${idx}`,
        title,
        priceCny,
        description,
        imageUrls,
        sellerLocation: "未知",
        wantsCount: 0,
        sellerVerified: false,
        sellerVerifiedTransactions: 0,
        rawText: `${title}\n${description}`,
        source: "goofish",
        normalized,
      });
      idx++;
    }
  } catch {
    // ignore parse errors
  }
  return listings;
}
/**
 * Scrape real Goofish listings using Playwright (real browser).
 * Uses the spm parameter in the URL and dismisses the login modal.
 * Paginates by scrolling to load more results (Goofish uses infinite scroll).
 * NO mock data fallback — returns empty if 0 listings extracted.
 */
async function scrapeGoofishLive(
  query: string,
  category: Category,
  maxPages: number,
  opts?: { minPriceCny?: number; maxPriceCny?: number; enrichAll?: boolean },
): Promise<{ listings: GoofishListing[]; status: string }> {
  // CRITICAL: Goofish must use a FRESH browser instance, NOT the shared
  // singleton from browser.ts. When OLX/Vinted/Amazon run concurrently
  // using the shared browser, they set cookies and visit Portuguese/Spanish
  // sites. Goofish's anti-bot detects this cross-site browsing history and
  // blocks the page (returns 6.8KB empty page instead of 305KB results).
  // A fresh browser has no prior history → Goofish allows it.
  const freshBrowser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  const ctx = await freshBrowser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  // Only remove webdriver flag — don't use the full stealth script
  // (it overrides navigator.languages which can cause detection)
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const MAX_RETRIES = 2;
  // Scale the overall timeout with the number of pages requested.
  // Base 90s for initial page load + modal dismissal + first extraction,
  // then 20s per additional page for scroll-to-load cycles.
  // Floor: 90s, Ceiling: 360s (6 min).
  const OVERALL_TIMEOUT_MS = Math.max(90000, Math.min(360000, 90000 + 20000 * maxPages));
  const startTime = Date.now();
  let lastStatus = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Overall timeout check — bail out if we've been scraping too long
    if (Date.now() - startTime > OVERALL_TIMEOUT_MS) {
      lastStatus = `LIVE FETCH TIMEOUT: exceeded ${OVERALL_TIMEOUT_MS / 1000}s overall limit after ${attempt - 1} attempts. ${lastStatus}`;
      break;
    }
    let page: Awaited<ReturnType<typeof ctx.newPage>> | null = null;
    try {
      page = await ctx.newPage();
      const url = buildGoofishSearchUrl(query);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(3000);
    // Dismiss ALL login modal overlays and blocking dialogs (spec §2.1).
    // Goofish renders multiple blocking layers:
    //   - .loginCon--* (the login modal itself)
    //   - .ant-modal-mask (Ant Design modal mask, z-index 1000)
    //   - .ant-modal-wrap.login-modal-wrap--* (modal wrapper, z-index 1000)
    //   - .baxia-dialog (CAPTCHA/verification dialog, z-index 2147483647)
    //   - Various fixed-position overlays with high z-index
    // These block all interaction and prevent search results from loading.
    // ── MODAL DISMISSAL — SURGICAL REMOVE ───────────────────────────
    // CRITICAL LESSON: 
    //   - el.remove() with BROAD selectors ([class*="mask"], [class*="dialog"])
    //     destroys listing content (121KB lost). BAD.
    //   - el.style.display = "none" hides the modal but leaves it in the DOM.
    //     Goofish's anti-bot DETECTS the hidden modal and triggers Baxia
    //     CAPTCHA, which blocks the search → "no results" page. BAD.
    //   - el.remove() with SURGICAL selectors (only login modal classes)
    //     removes ONLY the login modal, not listing content. This is the
    //     approach that WORKS — 30 listings extracted, screenshots show
    //     real iPhones. GOOD.
    try {
      // Wait for the modal to render
      await page.waitForTimeout(1500);

      // Try clicking the close button first (most natural)
      try {
        const closeSelectors = [
          '[class*="loginCon"] [class*="close"]',
          '[class*="login-modal"] [class*="close"]',
          '.ant-modal-close',
          '[class*="ant-modal-close"]',
        ];
        for (const sel of closeSelectors) {
          const btn = page.locator(sel).first();
          if ((await btn.count()) > 0) {
            await btn.click({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(1000);
            break;
          }
        }
      } catch {
        // close button click failed
      }

      // SURGICAL remove — ONLY specific login modal elements
      // CRITICAL: Do NOT remove [class*="ant-modal-wrap"] — it's a huge
      // container that includes 126KB of page content. Only remove the
      // specific login container + mask + iframes.
      await page.evaluate(() => {
        // Remove ONLY these specific elements:
        const modalSelectors = [
          '[class*="loginCon"]',           // login container
          '[class*="login-modal"]',         // login modal
        ];
        modalSelectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => el.remove());
        });
        // Remove passport/login iframes (they block interaction)
        document
          .querySelectorAll('iframe[src*="passport"], iframe[src*="login"]')
          .forEach((el) => el.remove());
        // Restore body scroll
        document.body.style.overflow = "auto";
        document.body.style.position = "static";
        document.documentElement.style.overflow = "auto";
      });
      await page.waitForTimeout(500);
    } catch {
      // Overlays may not have appeared — proceed
    }

    // Wait for listing cards to render — Goofish loads listings via AJAX
    // after the initial page load. We wait for the main-title elements to
    // appear, then scroll to trigger lazy-loading of additional cards.
    // CRITICAL: Don't just wait a fixed time — actively wait for the
    // selector to appear, then scroll to load ALL cards before extracting.
    try {
      await page.waitForSelector('[class*="main-title"]', { state: "attached", timeout: 15000 });
    } catch {
      // No main-title appeared — try scrolling to trigger load
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(3000);
    }

    // Scroll down incrementally to trigger lazy-loading of ALL listing cards.
    // Goofish uses virtualized rendering — cards load as you scroll.
    // We scroll in steps and wait for the card count to stabilize.
    // Increased to 20 attempts with larger scrolls to load more listings
    // on the initial page before paginating.
    let prevCount = 0;
    let stableCount = 0;
    for (let scrollAttempt = 0; scrollAttempt < 20; scrollAttempt++) {
      const currentCount = await page.locator('[class*="main-title"]').count();
      if (currentCount === prevCount) {
        stableCount++;
        // If count hasn't changed for 3 consecutive scrolls, all cards are loaded
        if (stableCount >= 3) break;
      } else {
        stableCount = 0;
      }
      prevCount = currentCount;
      // Scroll by a larger amount (1500px) to trigger the infinite scroll
      // watcher more aggressively
      await page.evaluate(() => window.scrollBy(0, 1500));
      await page.waitForTimeout(1200);
    }
    // Scroll back to top so the extraction sees the first page of results
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    // ─── PRICE FILTER ───────────────────────────────────────────
    // Only apply the price filter if the USER explicitly set a min or max
    // price. Do NOT apply a default category-based min price — it breaks
    // the page load on some IPs because the confirm button may be disabled
    // or the filtered page reload may not complete.
    const userMinPrice = opts?.minPriceCny;
    const userMaxPrice = opts?.maxPriceCny;
    const minPriceCny = userMinPrice && userMinPrice > 0 ? userMinPrice : 0;
    const maxPriceCny = userMaxPrice && userMaxPrice > 0 ? userMaxPrice : 0;
    if (minPriceCny > 0 || maxPriceCny > 0) {
      try {
        // Wait for the price filter inputs to be present
        const inputs = page.locator("input.search-price-input--p1NQEAuz");
        await inputs.first().waitFor({ state: "visible", timeout: 3000 });
        if (await inputs.count() >= 2) {
          // Fill min price
          if (minPriceCny > 0) {
            await inputs.nth(0).click({ timeout: 1000 });
            await inputs.nth(0).fill(String(minPriceCny));
          }
          // Fill max price
          if (maxPriceCny > 0) {
            await inputs.nth(1).click({ timeout: 1000 });
            await inputs.nth(1).fill(String(maxPriceCny));
          }
          // Click the confirm button (确定)
          const confirmBtn = page.locator("button.search-price-confirm-button--I2ThavjG");
          await confirmBtn.waitFor({ state: "visible", timeout: 2000 });
          // The button may be disabled until a value is entered
          await page.waitForTimeout(200);
          await confirmBtn.click({ timeout: 2000 });
          // Wait for filtered results to reload
          await page.waitForTimeout(3000);
        }
      } catch {
        // price filter not available or failed — proceed with unfiltered results
      }
    }
    // ─── PAGINATION + EXTRACTION LOOP ───────────────────────────
    // Goofish uses a "Next Page" pagination button (NOT infinite scroll).
    // The button HTML is:
    //   <button class="search-pagination-arrow-container--lt2kCP6J">
    //     <div class="...search-pagination-arrow-right--CKU78u4z"></div>
    //   </button>
    // Strategy per page:
    //   1. Extract ALL listings currently in the DOM
    //   2. If not the last page, click the next-page button (if present & enabled)
    //   3. Wait for the new listings to render (wait for main-title count to change)
    //   4. Fallback: if no next button, scroll to trigger lazy-load
    //   5. Deduplicate by title across pages
    const allRawListings: Array<{
      title: string; priceText: string; description: string;
      imageUrl: string; href: string; location: string;
    }> = [];
    const seenTitles = new Set<string>();
    // Helper: extract all listings currently rendered in the DOM.
    // Uses linkEl.href (resolved absolute URL) instead of getAttribute so
    // relative paths like "/item?id=..." become "https://www.goofish.com/item?id=...".
    // Also walks up from the title to find a wrapping <a> (Goofish sometimes
    // wraps the whole card in an anchor) and checks descendants too.
    const extractListings = async () => {
      return await page.evaluate(() => {
        const results: Array<{
          title: string; priceText: string; description: string;
          imageUrl: string; href: string; location: string;
        }> = [];

        // ── PRICE PARSING HELPER ──────────────────────────────────────
        // CRITICAL: Goofish price text is often concatenated:
        //   "¥379917人想要"  = ¥3799 + "17人想要" (17 people want)
        //   "¥26.5054人想要" = ¥26.50 + "54人想要" (54 people want)
        //
        // The regex must match the price and STOP before the "wants" count.
        // Strategy:
        //   1. Match ¥ followed by digits + optional decimal (2 digits max)
        //   2. The decimal part MUST be exactly 2 digits (prices use ¥XX.YY)
        //   3. If no decimal, the integer part stops at the first non-digit
        //
        // Also handle Chinese suffixes: 万 (×10000), 千 (×1000)
        const parsePriceText = (text: string): string | null => {
          if (!text) return null;
          // Match ¥ followed by digits (with optional comma) and optional .XX decimal
          // Use \d+ (unlimited digits) — NOT \d{1,3} which cuts prices at 3 digits!
          // e.g. "¥3299" → matches "3299" (not "329")
          //      "¥26.50" → matches "26.50"
          const match = text.match(/¥\s*((?:\d[\d,]*)(?:\.\d{2})?)/);
          if (!match) return null;
          let numStr = match[1].replace(/,/g, "");
          let num = parseFloat(numStr);
          if (isNaN(num)) return null;
          // REJECT year-like numbers: if the text has 年 (Chinese "year")
          // immediately after the matched number, it's a date not a price.
          // e.g. "¥2019年" = year 2019, not ¥2019.
          const afterNum = text.slice(match.index! + match[0].length);
          if (afterNum.startsWith("年")) return null;
          // Check for Chinese number suffix immediately after the matched digits
          if (afterNum.startsWith("万")) num = num * 10000;
          else if (afterNum.startsWith("千")) num = num * 1000;
          return String(Math.round(num));
        };

        const parsePriceFromEl = (el: Element): string | null => {
          // 1) Try each direct child ELEMENT's textContent FIRST
          //    Goofish wraps the price in a <span> separate from the "wants" <span>.
          //    Child elements have CLEAN text (e.g. "¥3299") while firstChild
          //    or full textContent may be concatenated (e.g. "¥329917人想要").
          for (const child of el.children) {
            const text = child.textContent?.trim() || "";
            // Only use this child if it contains ¥ (it's the price, not the wants count)
            if (text.includes("¥")) {
              const price = parsePriceText(text);
              if (price) return price;
            }
          }

          // 2) Try firstChild text content
          const firstChildText = el.firstChild?.textContent?.trim() || "";
          if (firstChildText.includes("¥")) {
            const price1 = parsePriceText(firstChildText);
            if (price1) return price1;
          }

          // 3) Try direct text nodes
          for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              const text = child.textContent?.trim() || "";
              if (text.includes("¥")) {
                const price = parsePriceText(text);
                if (price) return price;
              }
            }
          }

          // 4) Last resort: full textContent
          const fullText = el.textContent?.trim() || "";
          return parsePriceText(fullText);
        };

        // ── FIND THE BEST PRICE ELEMENT ───────────────────────────────
        // Only use the SPECIFIC Goofish price class (row3-wrap-price).
        // Do NOT fall back to broad [class*='price'] — it matches shipping
        // fees, deposit badges, and other noise that produces wrong prices.
        const findBestPrice = (card: HTMLElement): string | null => {
          // Try the SPECIFIC Goofish price class (most reliable)
          const primaryEls = card.querySelectorAll("[class*='row3-wrap-price']");
          for (const el of primaryEls) {
            const price = parsePriceFromEl(el);
            // Reject prices < ¥50 (shipping/deposit noise) and > ¥100000 (concatenation bug)
            if (price && parseFloat(price) >= 50 && parseFloat(price) <= 100000) return price;
          }
          // No fallback to [class*='price'] — it causes wrong prices
          return null;
        };

        // ── FILTER OUT NON-PHONE LISTINGS ─────────────────────────────
        // Reject listings that are selling phone BOXES (手机盒/包装盒),
        // rentals (出租/租赁/租借), installments (分期/首付), unlock services
        // (解锁/绕ID), or other non-product listings. These pollute the
        // arbitrage results with useless entries.
        const isJunkListing = (title: string): boolean => {
          // Phone boxes / packaging only — catch all variants
          if (/手机盒|包装盒|原装盒子|只是盒子|是盒子|只卖包装|空盒|纸盒|包装|盒子|only.*box|空壳/i.test(title)) return true;
          // Rentals / leases
          if (/出租|租赁|租借|以租代购|免押金出租|短租/i.test(title)) return true;
          // Installment / financing plans
          if (/分期|首付|月供|0首付|可分|可租/i.test(title)) return true;
          // Unlock / bypass services
          if (/解锁|绕id|绕开|黑解|官解/i.test(title)) return true;
          // Screenshots / digital services
          if (/截图|灵动岛|代截/i.test(title)) return true;
          // Model phones (non-functional display units)
          if (/模型机|模型/i.test(title)) return true;
          // Commission / task scams
          if (/垫付|佣金|接单|过单/i.test(title)) return true;
          // Non-electronics (tissue paper, food, etc. that slip through)
          if (/抽纸|纸巾|零食|水果|花盆|衣服|鞋|包/i.test(title)) return true;
          // Listing has "回馈活动" (giveaway/promotional event) — not a real listing
          if (/回馈活动|抽奖|中奖|免费送/i.test(title)) return true;
          return false;
        };

        // ── DETECT "NO RESULTS" PAGE ──────────────────────────────────
        // When Goofish's search is blocked by Baxia CAPTCHA or returns no
        // results, it shows a "猜你喜欢" (Guess You Like) section with
        // UNRELATED recommended products instead of actual search results.
        // We MUST detect this and return empty — extracting recommended
        // products gives false data (fruit juice, flower pots, etc.).
        const pageText = document.body?.innerText || "";
        const noResultsIndicators = [
          "没有找到你想要的宝贝",   // "didn't find the treasure you want"
          "猜你喜欢",               // "guess you like" (recommendations section)
          "为你推荐",               // "recommended for you"
        ];
        const isNoResultsPage = noResultsIndicators.some((indicator) =>
          pageText.includes(indicator),
        );
        // Also check: if there's no pagination, it's likely not real results
        const hasPagination = document.querySelector(
          "button[class*='search-pagination-arrow']",
        );

        // If this is a "no results" page with recommendations, DON'T extract.
        // Return empty so the caller knows the search failed.
        if (isNoResultsPage && !hasPagination) {
          // Page shows recommendations, not real search results.
          // Signal this by returning an empty array with a flag.
          (results as any).__noResultsPage = true;
          return results;
        }

        // ── PRICE SANITY CHECK ────────────────────────────────────────
        // For iPhone/MacBook/iPad/PS5 categories, real prices are always
        // > ¥500. If a price is < ¥500, it's likely a recommended product
        // (fruit juice ¥26, flower pots ¥5, etc.) that slipped through.
        const MIN_REALISTIC_PRICE = 500; // ¥500 — anything less is not a real iPhone/MacBook/etc.

        // ── POSITIONAL TITLE↔PRICE MATCHING ───────────────────────────
        // CRITICAL FIX: Goofish renders all listing cards under a shared
        // container. Walking up from the title finds this shared container,
        // and querySelectorAll returns ALL prices — we'd get the FIRST card's
        // price for EVERY card. Instead, we match titles to prices by their
        // order in the DOM: title[i] → price[i]. Goofish renders cards in
        // order, so this pairing is always correct.
        const titleEls = Array.from(document.querySelectorAll("[class*='main-title']"));
        const priceEls = Array.from(document.querySelectorAll("[class*='row3-wrap-price']"));

        // Parse all prices upfront so we can pair them positionally
        const parsedPrices: (string | null)[] = priceEls.map(el => {
          const p = parsePriceFromEl(el);
          if (!p) return null;
          const n = parseFloat(p);
          if (n < 50 || n > 100000) return null;
          return p;
        });

        // If the counts don't match, fall back to the walk-up approach for
        // each title. But if they DO match (the common case), positional is
        // 100% accurate.
        const usePositional = titleEls.length === parsedPrices.filter(p => p !== null).length
          && titleEls.length > 0;

        titleEls.forEach((titleEl, idx) => {
          const title = titleEl.textContent?.trim()?.substring(0, 120) || "";
          // FILTER: skip junk listings
          if (isJunkListing(title)) return;

          let priceText: string | null = null;
          let card: HTMLElement | null = null;

          if (usePositional) {
            // Positional: title[idx] → price[idx]
            priceText = parsedPrices[idx];
            if (!priceText) return;
            // Find the card container for description/image — walk up a
            // few levels to get the card text, but DON'T use it for price.
            card = titleEl as HTMLElement;
            for (let j = 0; j < 3; j++) {
              card = card?.parentElement;
              if (!card) break;
            }
          } else {
            // Fallback: walk up to find nearest price (original approach)
            card = titleEl as HTMLElement;
            for (let j = 0; j < 5; j++) {
              card = card?.parentElement as HTMLElement;
              if (!card) return;
              priceText = findBestPrice(card);
              if (priceText) break;
            }
            if (!priceText || !card) return;
          }

          if (!priceText) return;
          // PRICE SANITY CHECK
          const priceNum = parseFloat(priceText);
          if (priceNum < MIN_REALISTIC_PRICE) return;

          const cardText = card?.textContent?.replace(/\s+/g, " ").trim().substring(0, 500) || "";
          const imgEl = card?.querySelector("img");
          // HREF: use titleEl.closest('a') for this title's own link
          let linkEl: HTMLAnchorElement | null = (titleEl as HTMLElement).closest<HTMLAnchorElement>("a[href*='/item'], a[href*='/detail']");
          if (!linkEl && card) {
            if (card.tagName === "A" && /\/item|\/detail/.test(card.getAttribute("href") || "")) {
              linkEl = card as HTMLAnchorElement;
            }
          }
          if (!linkEl && card) {
            linkEl = card.querySelector<HTMLAnchorElement>("a[href*='/item'], a[href*='/detail']");
          }
          if (!linkEl && card) {
            linkEl = card.querySelector<HTMLAnchorElement>("a[href]");
          }
          const resolvedHref = linkEl?.href || linkEl?.getAttribute("href") || "";
          results.push({
            title,
            priceText,
            description: cardText,
            imageUrl: imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || "",
            href: resolvedHref,
            location: "中国",
          });
        });
        return results;
      });
    };
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      // 1) Extract listings on the current page — with a 15s timeout so
      //    a hung evaluate() can't block the whole scraper indefinitely.
      let pageListings: Awaited<ReturnType<typeof extractListings>>;
      try {
        pageListings = await Promise.race([
          extractListings(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("extractListings timeout (15s)")), 15000),
          ),
        ]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastStatus = `LIVE FETCH FAILED: extraction error on page ${pageNum}: ${msg}`;
        break;
      }
      // Check if the page returned "no results" (showing recommendations instead)
      const isNoResultsPage = (pageListings as any).__noResultsPage === true;
      if (isNoResultsPage) {
        // Goofish returned a "no results" page with unrelated recommendations.
        // This happens when Baxia CAPTCHA blocks the search query.
        // Don't extract any listings — return empty with a clear warning.
        return {
          listings: [],
          status: `LIVE OK (Playwright, 0 listings) | WARNING: Goofish returned "no results" page (showing recommendations). Baxia CAPTCHA likely blocked the search. Try again later or use Manual Paste.`,
        };
      }
      let newCount = 0;
      for (const l of pageListings) {
        if (!seenTitles.has(l.title)) {
          seenTitles.add(l.title);
          allRawListings.push(l);
          newCount++;
        }
      }
      // 2) If this is the last page, stop
      if (pageNum >= maxPages) break;
      // 3) Load more listings for the next "page".
      //    Goofish uses INFINITE SCROLL — there are no traditional page
      //    buttons. New listings load when the user scrolls near the bottom.
      //    Strategy: scroll to the bottom in steps, waiting for new listing
      //    cards to render after each scroll. We do 6 scroll steps per "page"
      //    to aggressively load as many new listings as possible.
      let loadedNew = false;
      try {
        let lastCount = await page.locator("[class*='main-title']").count();
        // Do 6 scroll steps per page to load a full batch of new listings.
        // Don't break early — keep scrolling to load as many as possible.
        for (let scrollStep = 0; scrollStep < 6; scrollStep++) {
          if (Date.now() - startTime > OVERALL_TIMEOUT_MS) break;
          // Scroll to the very bottom of the page
          await page.evaluate(() => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
          });
          // Wait for new listings to render (up to 6s per scroll)
          try {
            await page.waitForFunction(
              (prev: number) => {
                return document.querySelectorAll("[class*='main-title']").length > prev;
              },
              lastCount,
              { timeout: 6000 },
            );
            // New listings appeared — update count and continue scrolling
            lastCount = await page.locator("[class*='main-title']").count();
            loadedNew = true;
          } catch {
            // No new listings after this scroll — try another scroll step
          }
          await page.waitForTimeout(600);
        }
        // Settle time for prices to hydrate after new listings render
        await page.waitForTimeout(1500);
        // Re-dismiss any login modal that may have reappeared after scroll
        await page.evaluate(() => {
          document.querySelectorAll('[class*="loginCon"], [class*="login-modal"]').forEach(el => el.remove());
          document.querySelectorAll('iframe[src*="passport"], iframe[src*="login"]').forEach(el => el.remove());
          document.body.style.overflow = 'auto';
        }).catch(() => {});
        const countAfter = await page.locator("[class*='main-title']").count();
        // If no new listings loaded after all scroll attempts, stop paginating
        if (countAfter <= lastCount && pageNum > 1) {
          loadedNew = false;
        }
      } catch {
        // scroll failed
      }
      if (!loadedNew && pageNum > 1 && allRawListings.length > 0) break;
    }
    // ── TITLE RELEVANCE CHECK ──────────────────────────────────────
    // Filter out listings whose titles don't share ANY significant keyword
    // with the search query. This prevents mislabeled/irrelevant listings
    // (e.g. a phone case showing up when searching for a printer, or a
    // completely unrelated product that Goofish's fuzzy search returned).
    // We extract meaningful tokens (≥2 chars, alphanumeric) from the query
    // and require the title to contain at least ONE of them.
    const queryTokens = query
      .toLowerCase()
      .split(/[\s\-—,./]+/)
      .filter((t) => t.length >= 2 && /[a-z0-9]/i.test(t))
      // Filter out generic words that appear in many unrelated listings
      .filter((t) => !["the", "all", "and", "for", "with", "new", "pro", "max", "plus", "ultra"].includes(t) || t.length >= 4);
    const isTitleRelevant = (title: string): boolean => {
      if (queryTokens.length === 0) return true; // no tokens to check → don't filter
      const titleLower = title.toLowerCase();
      // Title must contain at least one query token
      return queryTokens.some((token) => titleLower.includes(token));
    };

    // Convert raw listings to GoofishListing format
    const listings: GoofishListing[] = allRawListings
      .filter((r) => r.priceText && parseFloat(r.priceText.replace(/,/g, "")) > 0)
      .filter((r) => isTitleRelevant(r.title))
      .map((r, i) => {
        const priceCny = Math.round(parseFloat(r.priceText.replace(/,/g, "")));
        const normalized = normalizeListing(r.title, r.description);
        return {
          id: `gf-live-${i}`,
          title: r.title,
          priceCny,
          description: r.description,
          imageUrls: r.imageUrl ? [r.imageUrl] : [],
          sellerLocation: r.location,
          wantsCount: 0,
          sellerVerified: false,
          sellerVerifiedTransactions: 0,
          rawText: `${r.title}\n${r.description}`,
          source: "goofish" as const,
          normalized,
          href: r.href || undefined,
        };
      });
    // Build a diagnostic status string when 0 listings are extracted.
    // This helps debug why the scraper fails even though the page loaded.
    let status = `LIVE OK (Playwright, ${listings.length} listings extracted)`;
    if (listings.length === 0) {
      // Run a quick diagnostic to see what's on the page
      try {
        const diag = await page.evaluate(() => {
          const titles = document.querySelectorAll("[class*='main-title']");
          let priceInParent = 0;
          let noPriceInParent = 0;
          titles.forEach((titleEl) => {
            let card = titleEl as HTMLElement;
            for (let j = 0; j < 5; j++) {
              card = card.parentElement as HTMLElement;
              if (!card) break;
              if (card.querySelector("[class*='row3-wrap-price'], [class*='price']")) {
                priceInParent++;
                return;
              }
            }
            noPriceInParent++;
          });
          return {
            totalTitles: titles.length,
            priceInParent,
            noPriceInParent,
            bodyLen: document.body?.innerHTML?.length ?? 0,
            hasLogin: !!document.querySelector('[class*="loginCon"], [class*="login-modal"]'),
            hasBaxia: !!document.querySelector('[class*="baxia"]'),
          };
        });
        status = `LIVE OK (Playwright, 0 listings extracted) | DIAG: titles=${diag.totalTitles}, priceFound=${diag.priceInParent}, noPrice=${diag.noPriceInParent}, bodyLen=${diag.bodyLen}, login=${diag.hasLogin}, baxia=${diag.hasBaxia}`;
      } catch {
        // page may have closed
      }
    }
    // Check if we got listings
    if (listings.length > 0) {
      // ── CONDITION FLAGS: Detect from title + description IMMEDIATELY ──
      // This runs on ALL listings, regardless of whether enrichment runs.
      // Previously flags were only set during enrichment (which opens each
      // listing page), so if enrichment was skipped or failed, flags were
      // empty. Now we detect flags from the search-page text which is always
      // available, then enrichment can ADD seller rating + image count.
      for (const listing of listings) {
        detectConditionFlags(listing);
      }
      // ── ENRICHMENT: Open each listing page to get seller rating + image count ──
      // Skip enrichment if we're close to the overall timeout — better to
      // return un-enriched listings than to hang for another 60s.
      // Also skip if enrichAll is false — the user opted out of enrichment.
      if (page) await page.close().catch(() => {});
      const elapsed = Date.now() - startTime;
      const remaining = OVERALL_TIMEOUT_MS - elapsed;
      if (opts?.enrichAll !== true) {
        // Enrichment disabled — return listings with condition flags only
        await ctx.close();
        await freshBrowser.close();
        return {
          listings: listings.slice(0, config.scraping.max_listings_per_search),
          status: `${status} (enrichment disabled — toggle "Enrich all listings" to enable)`,
        };
      }
      if (remaining < 20000) {
        // Not enough time for enrichment — return listings with flags already set
        await ctx.close();
        await freshBrowser.close();
        return {
          listings: listings.slice(0, config.scraping.max_listings_per_search),
          status: `${status} (enrichment skipped — time limit)`,
        };
      }
      const enrichedListings = await enrichListingsFromPages(ctx, listings, opts);
      await ctx.close();
      await freshBrowser.close();
      return {
        listings: enrichedListings.slice(0, config.scraping.max_listings_per_search),
        status: attempt > 1 ? `${status} (succeeded on attempt ${attempt}/${MAX_RETRIES})` : status,
      };
    }
    // 0 listings — check if Baxia blocked
    lastStatus = status;
    if (page) await page.close().catch(() => {});
    if (attempt < MAX_RETRIES) {
      // Wait before retrying (increasing backoff: 3s, 5s)
      const waitMs = 3000 + (attempt - 1) * 2000;
      await sleep(waitMs);
      // Continue to next attempt
      continue;
    }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastStatus = `LIVE FETCH FAILED (attempt ${attempt}): ${msg}`;
      if (page) await page.close().catch(() => {});
      if (attempt < MAX_RETRIES) {
        await sleep(3000);
        continue;
      }
    }
  } // end for loop

  // All retries exhausted
  await ctx.close();
      await freshBrowser.close();
  return { listings: [], status: lastStatus || `All ${MAX_RETRIES} attempts failed (Baxia blocked or no results)` };
}

/**
 * Detect condition flags from a listing's title + description text.
 * Called on ALL listings immediately after extraction (before enrichment)
 * so flags are always available even if enrichment is skipped.
 *
 * CRITICAL: flags must be mutually consistent. "无拆修" (Never Opened)
 * CONTAINS "拆修" as a substring, so we check it FIRST and skip "拆修"
 * if "无拆修" is present. Also, if screen/battery was replaced, the phone
 * WAS opened — so "Never Opened" must NOT appear alongside "Screen Replaced"
 * or "Battery Replaced".
 */
function detectConditionFlags(listing: GoofishListing): void {
  const fullText = `${listing.title} ${listing.description}`;
  const flags: string[] = [];
  // Check "无拆修" (Never Opened) FIRST — if present, no repair flags
  const hasNeverOpened = fullText.includes("无拆修") || fullText.includes("无拆无修");
  // Check for repair/replacement indicators
  const hasScreenReplaced = /换屏|换过屏幕/.test(fullText);
  const hasBatteryReplaced = /换电池|换过电池/.test(fullText);
  const hasRepaired = /维修|拆修/.test(fullText) && !hasNeverOpened;
  const hasAnyRepair = hasScreenReplaced || hasBatteryReplaced || hasRepaired;
  // If "无拆修" is present AND no repair indicators, show "Never Opened"
  if (hasNeverOpened && !hasAnyRepair) {
    flags.push("Never Opened");
  }
  // Only show "Opened/Repaired" if the phone was actually opened
  if (hasRepaired) {
    flags.push("Opened/Repaired");
  }
  if (hasScreenReplaced) flags.push("Screen Replaced");
  if (hasBatteryReplaced) flags.push("Battery Replaced");
  // Other flags — independent
  if (/无盒|无原盒/.test(fullText)) flags.push("No Box");
  if (fullText.includes("进水")) flags.push("Water Damage");
  if (fullText.includes("漏液")) flags.push("Screen Leak");
  if (fullText.includes("碎屏")) flags.push("Cracked Screen");
  if (fullText.includes("有锁")) flags.push("Locked");
  // "全原" (All Original) — only if NO repair flags
  if (fullText.includes("全原") && !hasAnyRepair) flags.push("All Original");
  // "原装" (Original) — only if NO repair flags, DON'T duplicate with "All Original"
  if (/原装/.test(fullText) && !hasAnyRepair && !flags.includes("All Original")) {
    flags.push("Original");
  }
  listing.conditionFlags = flags;
}

// ── LISTING ENRICHMENT ────────────────────────────────────────────────
// Opens each listing's item page to extract:
//   1. Seller positive feedback rate (好评率97%) from [class*="item-user-info-label"]
//   2. Actual image count from [class*="item-main-window-list-item"] elements
//   3. Full image URLs from the listing page (not just search thumbnails)
//
// Runs concurrently (5 at a time) with an 8s timeout per page.
// If enrichment fails for a listing, it keeps the default values.
async function enrichListingsFromPages(
  ctx: import("playwright").BrowserContext,
  listings: GoofishListing[],
  opts?: { minPriceCny?: number; maxPriceCny?: number; enrichAll?: boolean },
): Promise<GoofishListing[]> {
  const CONCURRENCY = 5; // increased from 3 to speed up enrichment
  const TIMEOUT_MS = 10000; // reduced from 15s — 10s is enough for most pages
  // If enrichAll is enabled, enrich ALL listings. Otherwise cap at 5 (was 10).
  // Fewer enrichments = faster scan. The top 5 by price are the most relevant.
  const enrichAll = opts?.enrichAll === true;
  const MAX_TO_ENRICH = enrichAll ? listings.length : Math.min(listings.length, 5);

  // Process listings in batches of CONCURRENCY
  for (let i = 0; i < MAX_TO_ENRICH; i += CONCURRENCY) {
    const batch = listings.slice(i, Math.min(i + CONCURRENCY, MAX_TO_ENRICH));
    console.log(`[Goofish Enrichment] Processing batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(MAX_TO_ENRICH / CONCURRENCY)} (listings ${i + 1}-${Math.min(i + CONCURRENCY, MAX_TO_ENRICH)}/${MAX_TO_ENRICH})`);
    await Promise.all(
      batch.map(async (listing) => {
        if (!listing.href) return;
        let detailPage: import("playwright").Page | null = null;
        try {
          detailPage = await ctx.newPage();
          await detailPage.goto(listing.href, {
            waitUntil: "domcontentloaded",
            timeout: TIMEOUT_MS,
          });
          // Wait for the listing page to render — reduced from 5s to 2s
          // since we just need the seller rating text which loads early.
          await detailPage.waitForTimeout(2000);

          // Check for login modal on listing page and remove it
          await detailPage.evaluate(() => {
            document
              .querySelectorAll('[class*="loginCon"], [class*="login-modal"]')
              .forEach((el) => el.remove());
            document
              .querySelectorAll('iframe[src*="passport"], iframe[src*="login"]')
              .forEach((el) => el.remove());
            document.body.style.overflow = "auto";
          }).catch(() => {});
          // Wait for content to render after modal removal — reduced from 2s to 1s
          await detailPage.waitForTimeout(1000);

          // Extract seller rating + image count + image URLs
          const enriched = await detailPage.evaluate(() => {
            // 1. Seller rating: look for "好评率97%" in multiple selectors
            let sellerRating: number | undefined;
            // Try specific selector first
            const ratingEls = document.querySelectorAll(
              '[class*="item-user-info-label"]',
            );
            for (const el of ratingEls) {
              const text = el.textContent || "";
              const match = text.match(/好评率\s*(\d+)/);
              if (match) {
                sellerRating = parseInt(match[1], 10);
                break;
              }
            }
            // Fallback: search ALL elements for 好评率 pattern
            if (sellerRating === undefined) {
              const allEls = document.querySelectorAll("*");
              for (const el of allEls) {
                const text = el.textContent || "";
                if (text.length < 50) { // Only check short text nodes
                  const match = text.match(/好评率\s*(\d+)/);
                  if (match) {
                    sellerRating = parseInt(match[1], 10);
                    break;
                  }
                }
              }
            }
            // Last resort: check body innerText
            if (sellerRating === undefined) {
              const bodyText = document.body?.innerText || "";
              const match = bodyText.match(/好评率\s*(\d+)/);
              if (match) {
                sellerRating = parseInt(match[1], 10);
              }
            }

            // 2. Image count: count [class*="item-main-window-list-item"] elements
            let imageEls = document.querySelectorAll(
              '[class*="item-main-window-list-item"]',
            );
            // Fallback: try other image container selectors
            if (imageEls.length === 0) {
              imageEls = document.querySelectorAll(
                '[class*="item-main-window"] img, [class*="main-image"] img, [class*="detail-image"] img',
              );
            }
            const imageCount = imageEls.length;

            // 3. Full image URLs from listing page
            const imageUrls: string[] = [];
            imageEls.forEach((el) => {
              const img = el.tagName === "IMG" ? el : el.querySelector("img");
              const src = img?.getAttribute("src") || img?.getAttribute("data-src") || "";
              if (src) {
                const fullUrl = src.startsWith("//")
                  ? `https:${src}`
                  : src.startsWith("http")
                    ? src
                    : `https:${src}`;
                imageUrls.push(fullUrl);
              }
            });

            return { sellerRating, imageCount, imageUrls };
          });

          // Apply enrichment to the listing
          if (enriched.sellerRating !== undefined) {
            listing.sellerRating = enriched.sellerRating;
          }
          if (enriched.imageCount > 0) {
            listing.imageCount = enriched.imageCount;
            // Replace search-page thumbnail with full listing-page images
            if (enriched.imageUrls.length > 0) {
              listing.imageUrls = enriched.imageUrls;
            }
          }

          // Note: condition flags are already detected by detectConditionFlags()
          // which runs on ALL listings before enrichment. No need to re-detect here.
        } catch (e) {
          // Enrichment failed for this listing — keep defaults
          console.log(`[Goofish Enrichment] Failed for ${listing.href}: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          if (detailPage) await detailPage.close().catch(() => {});
        }
      }),
    );
  }

  return listings;
}

export async function scrapeGoofish(
  query: string,
  category: Category,
  opts?: { minPriceCny?: number; maxPriceCny?: number; maxPages?: number; enrichAll?: boolean },
): Promise<GoofishScrapeResult> {
  // ─── LIVE MODE (Playwright) ──────────────────────────────────
  // Anti-detection jitter before the live request (3-7s as per spec §9).
  await sleep(jitter(config.scraping.jitter_min_ms, config.scraping.jitter_max_ms));
  const maxPages = opts?.maxPages ?? config.scraping.max_pages;
  const { listings, status } = await scrapeGoofishLive(query, category, maxPages, opts);
  if (listings.length > 0) {
    return {
      listings,
      degraded: false,
      warning: undefined,
      liveFetchStatus: status,
    };
  }
  // Live fetch returned 0 listings — return EMPTY (NO mock data).
  // The user can use Manual Paste to provide real Goofish DOM HTML.
  return {
    listings: [],
    degraded: true,
    warning: `Live Playwright fetch to Goofish returned 0 listings. This may be due to a login wall, CAPTCHA, or anti-bot block from your IP. Use the Manual Paste feature to paste real Goofish DOM HTML from your browser.`,
    liveFetchStatus: status,
  };
}
/**
 * Parse manually-pasted raw DOM HTML (manual paste mode resume).
 * Used when the Goofish scraper hits a hard CAPTCHA / WAF block.
 */
export function parseManualPasteHtml(html: string, query: string): GoofishListing[] {
  const parsed = parseGoofishHtml(html);
  // If structured parse found nothing, fall back to a looser extraction
  if (parsed.length === 0) {
    // Heuristic: try to find listing-like blocks
    const blockRegex =
      /<[^>]*class="[^"]*item[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi;
    let m: RegExpExecArray | null;
    let idx = 0;
    while ((m = blockRegex.exec(html)) && idx < 50) {
      const block = m[1];
      const titleM = block.match(/<[^>]*>([^<]{4,120})<\/[^>]*>/);
      const priceM = block.match(/¥\s*(\d+(?:\.\d+)?)/);
      if (titleM && priceM) {
        const title = titleM[1].trim();
        const priceCny = parseFloat(priceM[1]);
        const normalized = normalizeListing(title, block);
        parsed.push({
          id: `gf-manual-${idx}`,
          title,
          priceCny,
          description: block.replace(/<[^>]+>/g, " ").slice(0, 500),
          imageUrls: [],
          sellerLocation: "未知",
          wantsCount: 0,
          sellerVerified: false,
          sellerVerifiedTransactions: 0,
          rawText: block.replace(/<[^>]+>/g, " "),
          source: "goofish",
          normalized,
        });
        idx++;
      }
    }
  }
  return parsed;
}