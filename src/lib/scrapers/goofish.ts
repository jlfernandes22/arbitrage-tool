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
import { includesNonNegated } from "@/lib/engine/scam-detector";
import { detectConditionFlags } from "@/lib/engine/condition-flags";
import { createContext } from "./browser";
import { sleep, jitter } from "./utils";
import { chromium } from "playwright";
export interface GoofishScrapeResult {
  listings: GoofishListing[];
  degraded: boolean;
  warning?: string;
  blocked?: boolean; // hard block — needs manual paste
  liveFetchStatus?: string; // human-readable status of the live fetch attempt
}
export function buildGoofishSearchUrl(
  query: string,
  opts?: { minPriceCny?: number; maxPriceCny?: number },
): string {
  // The spm parameter is REQUIRED for Goofish to return search results.
  // Without it, the page may render empty.
  // CRITICAL: Use the ORIGINAL English query, NOT a Chinese translation.
  // The Chinese-translated query (e.g. "苹果 15 Pro 256GB") gets blocked by
  // Goofish's anti-bot system on automated browsers, returning a 6.8KB empty
  // page. The English query (e.g. "iPhone 15 Pro 256GB") returns the full
  // 305KB page with 30 listings. Goofish search supports English queries
  // and returns the same Chinese-language listings.
  let url = `${config.scraping.goofish_search_url}${encodeURIComponent(query)}&spm=a21ybx.search.searchInput.0`;
  if (opts?.minPriceCny && opts.minPriceCny > 0) {
    url += `&minPrice=${opts.minPriceCny}&startPrice=${opts.minPriceCny}`;
  }
  if (opts?.maxPriceCny && opts.maxPriceCny > 0) {
    url += `&maxPrice=${opts.maxPriceCny}&endPrice=${opts.maxPriceCny}`;
  }
  return url;
}
// ── Anti-Bot: Windows UA rotation ─────────────────────────────────────
// Goofish's Baxia anti-bot can flag a user agent after detecting
// automation (it then shows the SMS-login modal with a NoCaptcha slider
// on every listing page). When that happens we rotate to a FRESH Windows
// Chrome UA from this pool and retry — a new UA gets a clean session.
// Sec-Ch-Ua must match the UA's Chrome version.
const GOOFISH_UA_POOL = [
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="129", "Not_A Brand";v="24", "Google Chrome";v="129"',
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="127", "Not_A Brand";v="24", "Google Chrome";v="127"',
  },
];

/**
 * Create a Goofish browser context with the given UA-pool index. Always a
 * Windows Chrome fingerprint (bypasses the NVIDIA/Linux overlay) with an
 * en-US locale matching a non-China IP (never Accept-Language: zh-CN —
 * that geo-mismatch triggers an immediate block).
 */
async function createGoofishContext(
  browser: import("playwright").Browser,
  uaIndex: number,
): Promise<import("playwright").BrowserContext> {
  const ua = GOOFISH_UA_POOL[uaIndex % GOOFISH_UA_POOL.length];
  const ctx = await browser.newContext({
    userAgent: ua.userAgent,
    locale: "en-US",
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Ch-Ua": ua.secChUa,
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
    },
  });
  // Only remove webdriver flag — don't use the full stealth script
  // (it overrides navigator.languages which can cause detection).
  // navigator.platform is spoofed to Win32 so it agrees with the Windows
  // User-Agent (a Linux value would contradict it and could be detected).
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
  });
  return ctx;
}

/**
 * Surgically remove Goofish's login / Baxia overlays.
 *
 * CRITICAL: NEVER click the modal's close (X) button — observed behavior:
 * clicking X makes the listing fail to load. el.remove() with surgical
 * selectors only, which unblocks the content underneath.
 *
 * Covers the old .loginCon/.login-modal variants AND the new SMS-login
 * modal (<div id="login" class="... login-view-sms baxia">…</div> with the
 * NoCaptcha slider) that appears ~10-15s after opening a listing.
 */
async function removeGoofishOverlays(page: import("playwright").Page): Promise<void> {
  await page.evaluate(() => {
    const overlaySelectors = [
      '[class*="loginCon"]',            // old login container
      '[class*="login-modal"]',         // old login modal
      '#login',                         // SMS-login modal (login-view-sms baxia)
      '[class*="login-view-sms"]',
      '[class*="baxia"]',               // Baxia captcha wrapper inside the modal
      '[class*="keep-login"]',          // "keep login" confirmation overlay
    ];
    overlaySelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    });
    // Passport/login iframes block interaction
    document
      .querySelectorAll('iframe[src*="passport"], iframe[src*="login"]')
      .forEach((el) => el.remove());
    // Restore body scroll
    document.body.style.overflow = "auto";
    document.body.style.position = "static";
    document.documentElement.style.overflow = "auto";
  }).catch(() => {});
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
/**
 * Filter out listings that aren't real products: phone boxes, rentals,
 * installments, unlock services, model phones, commission scams and
 * non-electronics. These pollute the arbitrage results with useless entries.
 *
 * The box/packaging tokens are matched negation-aware via
 * `includesNonNegated` so legitimate listings like "带包装" (with original
 * packaging) or "有盒子" (has the box) are NOT rejected — only bare
 * 包装/盒子 tokens (or explicit box-only phrases like 只卖包装) are junk.
 */
function isJunkListing(title: string): boolean {
  const hasBoxQualifier = /[带有含].{0,3}?(?:包装|盒子)/.test(title);
  if (!hasBoxQualifier) {
    // Phone boxes / packaging only — catch all variants
    if (/手机盒|包装盒|原装盒子|只是盒子|是盒子|只卖包装|空盒|纸盒|only.*box|空壳/i.test(title)) return true;
    // Bare 包装/盒子 tokens — negation-aware, so "无包装" (no packaging)
    // is not junk either.
    if (includesNonNegated(title, "包装") || includesNonNegated(title, "盒子")) return true;
  }
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
      const rawPic = picUrl ? picUrl.replace(/\\\//g, "/") : "";
      const imageUrls = rawPic
        ? [rawPic.startsWith("//")
          ? `https:${rawPic}`
          : rawPic.startsWith("http")
            ? rawPic
            : rawPic.startsWith("/")
              ? `https://www.goofish.com${rawPic}`
              : rawPic]
        : [];
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

  const MAX_RETRIES = 3;
  // Scale the overall timeout with the number of pages requested.
  // Base 90s for initial page load + modal dismissal + first extraction,
  // then 40s per additional page for the exhaustive scroll-load + next-page
  // navigation cycles (the per-page load is now much more thorough).
  // Floor: 120s, Ceiling: 600s (10 min).
  const OVERALL_TIMEOUT_MS = Math.max(120000, Math.min(600000, 90000 + 40000 * maxPages));
  const startTime = Date.now();
  let lastStatus = "";

  // The context is created PER ATTEMPT with a rotating UA: if Baxia flags
  // one UA (login modal everywhere), the next attempt gets a fresh one.
  let ctx: import("playwright").BrowserContext | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Overall timeout check — bail out if we've been scraping too long
    if (Date.now() - startTime > OVERALL_TIMEOUT_MS) {
      lastStatus = `LIVE FETCH TIMEOUT: exceeded ${OVERALL_TIMEOUT_MS / 1000}s overall limit after ${attempt - 1} attempts. ${lastStatus}`;
      break;
    }
    if (ctx) await ctx.close().catch(() => {});
    ctx = await createGoofishContext(freshBrowser, attempt - 1);
    let page: import("playwright").Page | null = null;
    try {
      if (!ctx) break;
      page = await ctx.newPage();
      const url = buildGoofishSearchUrl(query, opts);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(3000);
    // Dismiss ALL login modal overlays and blocking dialogs (spec §2.1).
    // Goofish renders multiple blocking layers:
    //   - .loginCon--* (the login modal itself)
    //   - .ant-modal-mask (Ant Design modal mask, z-index 1000)
    //   - .ant-modal-wrap.login-modal-wrap--* (modal wrapper, z-index 1000)
    //   - .baxia-dialog (CAPTCHA/verification dialog, z-index 2147483647)
    //   - #login.login-view-sms.baxia (SMS-login modal + NoCaptcha slider)
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
    //   - NEVER click the modal's close (X) button — that makes the
    //     listing fail to load (observed with the Baxia SMS-login modal).
    try {
      // Wait for the modal to render
      await page.waitForTimeout(1500);
      await removeGoofishOverlays(page);
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

    // Prime the list: scroll down a few steps so the first lazy-load batch
    // renders. The exhaustive per-page loop below does the FULL loading
    // (scrolling + extracting + pagination) — this is just a head start so
    // the price-filter row and the first cards are in the DOM.
    for (let primeStep = 0; primeStep < 4; primeStep++) {
      if (Date.now() - startTime > OVERALL_TIMEOUT_MS) break;
      await page.evaluate(() => window.scrollBy(0, 1500));
      await page.waitForTimeout(1000);
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
    // Helper: extract all listings currently rendered in the DOM.
    // Uses linkEl.href (resolved absolute URL) instead of getAttribute so
    // relative paths like "/item?id=..." become "https://www.goofish.com/item?id=...".
    // Also walks up from the title to find a wrapping <a> (Goofish sometimes
    // wraps the whole card in an anchor) and checks descendants too.
    const extractListings = async () => {
      // `page` is assigned earlier in the retry loop body before this closure
      // is invoked. Capture it in a local const so TypeScript can prove
      // non-nullability inside the closure (otherwise it flags
      // "page is possibly null" because the outer `let page` is nullable).
      const activePage = page;
      if (!activePage) return [];
      // Category-specific minimum realistic price (e.g. MacBooks never
      // below ¥2000) — computed in Node and passed into the browser
      // context, since the page evaluate can't access Node imports.
      const categoryMinPriceCny = getMinPriceCny(category);
      const filterBounds = {
        minPrice: minPriceCny > 0 ? minPriceCny : categoryMinPriceCny,
        maxPrice: maxPriceCny > 0 ? maxPriceCny : 0,
      };
      return await activePage.evaluate((bounds) => {
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
        // Real prices in this category are always above the category minimum
        // (¥500 for iPhones, ¥2000 for MacBooks, …). If a price is below it,
        // it's likely a recommended product (fruit juice ¥26, flower pots ¥5,
        // etc.) that slipped through.
        const MIN_REALISTIC_PRICE = bounds.minPrice;

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

        // Positional pairing is enabled when the RAW element counts match —
        // a single card with an unparseable price no longer disables it for
        // every listing (previously that forced the fragile walk-up for all).
        const usePositional = titleEls.length === priceEls.length
          && titleEls.length > 0;

        // Per-title fallback: walk up from the title to the SMALLEST ancestor
        // containing exactly ONE title and ONE price element — that ancestor
        // is the listing card, so the price is guaranteed to be this title's.
        const findPriceForTitle = (titleEl: Element): string | null => {
          let el: Element | null = titleEl;
          for (let j = 0; j < 6; j++) {
            el = el.parentElement;
            if (!el) return null;
            const tCount = el.querySelectorAll("[class*='main-title']").length;
            const pCount = el.querySelectorAll("[class*='row3-wrap-price']").length;
            if (tCount === 1 && pCount === 1) {
              const priceEl = el.querySelector("[class*='row3-wrap-price']");
              const p = priceEl ? parsePriceFromEl(priceEl) : null;
              if (p) {
                const n = parseFloat(p);
                if (n >= 50 && n <= 100000) return p;
              }
              return null;
            }
            // We walked past the card into a container with multiple cards
            // — no single-card price for this title.
            if (tCount > 1 && pCount > 0) return null;
          }
          return null;
        };

        titleEls.forEach((titleEl, idx) => {
          const title = titleEl.textContent?.trim()?.substring(0, 120) || "";

          let priceText: string | null = null;
          let card: HTMLElement | null = null;

          if (usePositional) {
            // Positional: title[idx] → price[idx]. If that card's price
            // failed to parse, fall back to the per-card lookup.
            priceText = parsedPrices[idx] ?? findPriceForTitle(titleEl);
            if (!priceText) return;
            // Find the card container for description/image — walk up a
            // few levels to get the card text, but DON'T use it for price.
            card = titleEl as HTMLElement;
            for (let j = 0; j < 3; j++) {
              card = card?.parentElement;
              if (!card) break;
            }
          } else {
            // Counts mismatched (virtualized list mid-hydration) — locate
            // each title's price by its own card ancestor.
            card = titleEl as HTMLElement;
            for (let j = 0; j < 3; j++) {
              card = card?.parentElement;
              if (!card) break;
            }
            priceText = findPriceForTitle(titleEl);
            if (!priceText) return;
          }

          if (!priceText) return;
          // PRICE SANITY & USER FILTER CHECK
          const priceNum = parseFloat(priceText);
          if (bounds.minPrice > 0 && priceNum < bounds.minPrice) return;
          if (bounds.maxPrice > 0 && priceNum > bounds.maxPrice) return;

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
      }, filterBounds);
    };
    // ─── PAGINATION + EXTRACTION LOOP ───────────────────────────────
    // Strategy per page (verified against Goofish's DOM):
    //   1. EXHAUSTIVELY load the current page: Goofish lazy-loads cards as
    //      you scroll, and its list is VIRTUALIZED — offscreen cards are
    //      removed from the DOM. So a single end-of-page extraction only
    //      sees whatever happens to be rendered at that moment. Instead we
    //      scroll down one viewport at a time and extract after EVERY step,
    //      accumulating unique titles.
    //   2. Only once the current page stops yielding new listings do we
    //      move to the NEXT page by clicking the pagination arrow button
    //      (button[class*='search-pagination-arrow'] with the right arrow).
    //   3. Fallback: if no next-page button exists, keep scrolling (some
    //      Goofish variants use pure infinite scroll).
    //   4. Deduplicate by title across pages.
    const allRawListings: Array<{
      title: string; priceText: string; description: string;
      imageUrl: string; href: string; location: string;
    }> = [];
    const seenTitles = new Set<string>();
    const MAX_SCROLL_ROUNDS = 24; // per page
    const STABLE_ROUNDS_BEFORE_END = 5; // ~10s of no new listings → end of page
    // Extract everything currently rendered, with a 15s timeout so a hung
    // evaluate() can't block the whole scraper indefinitely.
    const extractCurrentDom = async (): Promise<Awaited<ReturnType<typeof extractListings>>> => {
      return Promise.race([
        extractListings(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("extractListings timeout (15s)")), 15000),
        ),
      ]);
    };
    // Click the "next page" arrow (right-pointing) if present. Returns true
    // only when the click succeeded AND the page actually changed.
    const clickNextPage = async (): Promise<boolean> => {
      // Capture the nullable `page` in a local const so TypeScript can prove
      // non-nullability inside the closure (same pattern as extractListings).
      const activePage = page;
      if (!activePage) return false;
      try {
        let nextTarget = activePage.locator("button:has([class*='search-pagination-arrow-right'])").first();
        if ((await nextTarget.count()) === 0) {
          nextTarget = activePage.locator("[class*='search-pagination-arrow-right']").first();
        }
        if ((await nextTarget.count()) === 0) return false;
        const firstTitleBefore = (await activePage.locator("[class*='main-title']").first().textContent().catch(() => null))?.trim() ?? null;
        const countBefore = await activePage.locator("[class*='main-title']").count();
        await nextTarget.click({ timeout: 3000 });
        await activePage.waitForTimeout(800);
        // Wait for the page to actually change: the first title differs or
        // the rendered card count differs.
        const changed = await activePage
          .waitForFunction(
            (args: { firstTitle: string | null; countBefore: number }) => {
              const first = document.querySelector("[class*='main-title']");
              const firstText = first ? first.textContent?.trim() || "" : "";
              const count = document.querySelectorAll("[class*='main-title']").length;
              return firstText !== args.firstTitle || count !== args.countBefore;
            },
            { firstTitle: firstTitleBefore, countBefore },
            { timeout: 10000 },
          )
          .then(() => true)
          .catch(() => false);
        if (!changed) return false;
        // Prices hydrate after the new page renders
        await activePage.waitForTimeout(1500);
        // Re-dismiss any login/Baxia modal that reappeared during navigation
        await removeGoofishOverlays(activePage);
        return true;
      } catch {
        return false;
      }
    };

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      // ── Load + extract ALL listings on the current page ─────────
      let stableRounds = 0;
      for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
        if (Date.now() - startTime > OVERALL_TIMEOUT_MS) break;
        // 1) Extract whatever is currently rendered
        let batch: Awaited<ReturnType<typeof extractListings>>;
        try {
          batch = await extractCurrentDom();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          lastStatus = `LIVE FETCH FAILED: extraction error on page ${pageNum}: ${msg}`;
          break;
        }
        // Check if the page returned "no results" (showing recommendations instead)
        if ((batch as any).__noResultsPage === true) {
          // Goofish returned a "no results" page with unrelated recommendations.
          // This happens when Baxia CAPTCHA blocks the search query.
          // Don't extract any listings — return empty with a clear warning.
          // CRITICAL: close the browser context + browser before returning.
          // The `ctx` and `freshBrowser` were created OUTSIDE the retry loop;
          // without this cleanup every "no results" page would leak a full
          // Chromium process, eventually exhausting file descriptors.
          if (page) await page.close().catch(() => {});
          if (ctx) await ctx.close().catch(() => {});
          await freshBrowser.close().catch(() => {});
          return {
            listings: [],
            status: `LIVE OK (Playwright, 0 listings) | WARNING: Goofish returned "no results" page (showing recommendations). Baxia CAPTCHA likely blocked the search. Try again later or use Manual Paste.`,
          };
        }
        // 2) Accumulate new (unseen) listings
        let addedNew = 0;
        for (const l of batch) {
          if (!seenTitles.has(l.title)) {
            seenTitles.add(l.title);
            allRawListings.push(l);
            addedNew++;
          }
        }
        // 3) End-of-page detection: several consecutive scroll steps that
        //    yield zero NEW listings mean we've exhausted this page.
        if (addedNew === 0) {
          stableRounds++;
          if (stableRounds >= STABLE_ROUNDS_BEFORE_END) break;
        } else {
          stableRounds = 0;
        }
        // 4) Scroll down one viewport to trigger the next lazy-load batch.
        //    Incremental scrolling (not jumping to the bottom) matters for
        //    virtualized lists — jumping skips rendering the middle cards.
        await page.evaluate(() => window.scrollBy(0, Math.max(400, window.innerHeight * 0.9)));
        await page.waitForTimeout(1200);
      }
      // Settle time for prices to hydrate after the final batch
      await page.waitForTimeout(1200);
      // ── Move to the NEXT page ─────────────────────────────────────
      // Only after the current page has been fully exhausted.
      if (pageNum >= maxPages) break;
      if (Date.now() - startTime > OVERALL_TIMEOUT_MS) break;
      const wentNext = await clickNextPage();
      if (!wentNext) break;
      // Goofish swaps the list in place, so the scroll position from the
      // previous page persists. Start the next page from the TOP — the
      // incremental scroll loop above relies on it to render + extract the
      // whole list (a bottom-anchored start would skip the top cards).
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await page.waitForTimeout(500);
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

    // Convert raw listings to GoofishListing format.
    // Junk listings (phone boxes, rentals, unlock services, scams…) are
    // filtered here in Node — NOT in the browser evaluate — so the
    // positional title↔price pairing in the browser stays aligned for
    // every extracted card.
    const listings: GoofishListing[] = allRawListings
      .filter((r) => r.priceText && parseFloat(r.priceText.replace(/,/g, "")) > 0)
      .filter((r) => {
        const price = parseFloat(r.priceText.replace(/,/g, ""));
        if (minPriceCny > 0 && price < minPriceCny) return false;
        if (maxPriceCny > 0 && price > maxPriceCny) return false;
        return true;
      })
      .filter((r) => !isJunkListing(r.title))
      .filter((r) => isTitleRelevant(r.title))
      .map((r, i) => {
        const priceCny = Math.round(parseFloat(r.priceText.replace(/,/g, "")));
        const normalized = normalizeListing(r.title, r.description);
        return {
          id: `gf-live-${i}`,
          title: r.title,
          priceCny,
          description: r.description,
          imageUrls: r.imageUrl
            ? [r.imageUrl.startsWith("//")
              ? `https:${r.imageUrl}`
              : r.imageUrl.startsWith("http")
                ? r.imageUrl
                : r.imageUrl.startsWith("/")
                  ? `https://www.goofish.com${r.imageUrl}`
                  : r.imageUrl]
            : [],
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
        if (ctx) await ctx.close().catch(() => {});
        await freshBrowser.close();
        return {
          listings: listings.slice(0, config.scraping.max_listings_per_search),
          status: `${status} (enrichment disabled — toggle "Enrich all listings" to enable)`,
        };
      }
      if (remaining < 20000) {
        // Not enough time for enrichment — return listings with flags already set
        if (ctx) await ctx.close().catch(() => {});
        await freshBrowser.close();
        return {
          listings: listings.slice(0, config.scraping.max_listings_per_search),
          status: `${status} (enrichment skipped — time limit)`,
        };
      }
      const enrichedListings = await enrichListingsFromPages(freshBrowser, ctx, listings, opts);
      if (ctx) await ctx.close().catch(() => {});
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
  if (ctx) await ctx.close().catch(() => {});
  await freshBrowser.close();
  return { listings: [], status: lastStatus || `All ${MAX_RETRIES} attempts failed (Baxia blocked or no results)` };
}

// ── LISTING ENRICHMENT ────────────────────────────────────────────────
// Opens each listing's item page to extract:
//   1. Seller positive feedback rate (好评率97%) from [class*="item-user-info-label"]
//   2. Actual image count from [class*="item-main-window-list-item"] elements
//   3. Full image URLs from the listing page (not just search thumbnails)
//
// BAXIA PROTECTION: Goofish intermittently overlays listing pages with the
// SMS-login modal (<div id="login" class="… login-view-sms baxia">…) that
// appears ~10-15s after load and BLOCKS the listing content. It is removed
// surgically (never by clicking the X — that makes the listing fail to
// load), and if the content still doesn't render the current UA is flagged:
// we rotate to a fresh Windows Chrome UA and retry the listing once.
//
// Runs concurrently (5 at a time) with a 10s timeout per page.
// If enrichment fails for a listing, it keeps the default values.
async function enrichListingsFromPages(
  browser: import("playwright").Browser,
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

  // UA-rotation state: when the Baxia login modal blocks a listing page the
  // current UA is flagged — rotate and retry with a fresh one.
  let activeCtx = ctx;
  let uaIndex = 0;

  // Enrich a single listing page. Returns:
  //   "ok"      — content extracted (or no href to open)
  //   "blocked" — the Baxia login modal blocked the content; caller should
  //               rotate the UA and retry
  //   "failed"  — transient error (timeout etc.); keep defaults
  const enrichOne = async (
    c: import("playwright").BrowserContext,
    listing: GoofishListing,
  ): Promise<"ok" | "blocked" | "failed"> => {
    if (!listing.href) return "ok";
    let detailPage: import("playwright").Page | null = null;
    try {
      detailPage = await c.newPage();
      await detailPage.goto(listing.href, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUT_MS,
      });
      // Wait for the listing page to render — reduced from 5s to 2s
      // since we just need the seller rating text which loads early.
      await detailPage.waitForTimeout(2000);

      // Surgically remove ALL login/Baxia overlays (never click the X —
      // that makes the listing fail to load).
      await removeGoofishOverlays(detailPage);
      // Wait for content to render after modal removal — reduced from 2s to 1s
      await detailPage.waitForTimeout(1000);

      // Does the listing content exist? (title / image window / seller info)
      const hasContent = await detailPage.evaluate(() => {
        return !!document.querySelector(
          "[class*='item-title'], [class*='item-main-window'], [class*='item-user-info-label'], h1",
        );
      }).catch(() => false);

      if (!hasContent) {
        // The Baxia SMS-login modal appears ~10-15s after load and blocks
        // the listing. Wait for it; if it shows, the UA is likely flagged.
        const baxiaAppeared = await detailPage
          .waitForSelector("#login, [class*='login-view-sms'], [class*='baxia']", {
            state: "attached",
            timeout: 10000,
          })
          .then(() => true)
          .catch(() => false);
        if (baxiaAppeared) {
          await removeGoofishOverlays(detailPage);
          await detailPage.waitForTimeout(1000);
          const hasContentAfter = await detailPage.evaluate(() => {
            return !!document.querySelector(
              "[class*='item-title'], [class*='item-main-window'], [class*='item-user-info-label'], h1",
            );
          }).catch(() => false);
          if (!hasContentAfter) return "blocked";
        } else {
          // No content AND no modal — the page is compromised either way.
          return "blocked";
        }
      }

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
        // Additional fallbacks: try more selectors used by Goofish
        if (imageEls.length === 0) {
          imageEls = document.querySelectorAll(
            '[class*="pic"] img, [class*="gallery"] img, [class*="slider"] img, [class*="carousel"] img, [class*="swiper"] img',
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

        // Fallback: if we found imageCount but no URLs, try ALL images
        // with alicdn.com in the src (Goofish CDN domain)
        if (imageCount > 0 && imageUrls.length === 0) {
          const allImgs = document.querySelectorAll(
            'img[src*="alicdn.com"], img[data-src*="alicdn.com"]',
          );
          allImgs.forEach((img) => {
            const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
            if (src) {
              const fullUrl = src.startsWith("//")
                ? `https:${src}`
                : src.startsWith("http")
                  ? src
                  : `https:${src}`;
              imageUrls.push(fullUrl);
            }
          });
        }

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

      // ── Full description + spec labels ─────────────────────────────
      // The search-card text is TRUNCATED and misses key condition info —
      // "版本：海外有锁" (overseas carrier-locked) only appears in the detail
      // page's spec/labels block. Capture the listing's OWN description
      // (largest desc-like block — recommendation cards are much smaller)
      // plus the labels block (品牌/型号/版本/成色/拆修和功能), merge them
      // into the listing, and re-run flag detection so Locked / Water /
      // Repair flags reflect the FULL listing text.
      const detailText = await detailPage.evaluate(() => {
        let description = "";
        let bestLen = 0;
        document.querySelectorAll("[class*='desc']").forEach((el) => {
          const t = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (t.length > bestLen) { bestLen = t.length; description = t; }
        });
        // Spec/labels block — first block containing 版本 in DOM order.
        let labels = "";
        document.querySelectorAll("[class*='labels'], [class*='spec'], [class*='params']").forEach((el) => {
          if (labels) return;
          const t = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (t.includes("版本") && t.length < 600) labels = t;
        });
        if (!labels) {
          // Fallback: any short element containing the full spec header.
          document.querySelectorAll("div, li, span").forEach((el) => {
            if (labels) return;
            const t = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (t.includes("版本") && t.includes("品牌") && t.length < 600) labels = t;
          });
        }
        return { description, labels };
      }).catch(() => ({ description: "", labels: "" }));

      const mergedDesc = [
        detailText.description && detailText.description.length > listing.description.length
          ? detailText.description
          : listing.description,
        detailText.labels,
      ].filter(Boolean).join(" ").trim();
      if (mergedDesc && mergedDesc !== listing.description) {
        listing.description = mergedDesc;
        // Re-detect condition flags on the FULL title + detail text — the
        // search-page detection may have missed spec-table conditions.
        detectConditionFlags(listing);
      }

      return "ok";
    } catch (e) {
      // Enrichment failed for this listing — keep defaults
      console.log(`[Goofish Enrichment] Failed for ${listing.href}: ${e instanceof Error ? e.message : String(e)}`);
      return "failed";
    } finally {
      if (detailPage) await detailPage.close().catch(() => {});
    }
  };

  // Process listings in batches of CONCURRENCY
  for (let i = 0; i < MAX_TO_ENRICH; i += CONCURRENCY) {
    const batch = listings.slice(i, Math.min(i + CONCURRENCY, MAX_TO_ENRICH));
    console.log(`[Goofish Enrichment] Processing batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(MAX_TO_ENRICH / CONCURRENCY)} (listings ${i + 1}-${Math.min(i + CONCURRENCY, MAX_TO_ENRICH)}/${MAX_TO_ENRICH})`);
    await Promise.all(
      batch.map(async (listing) => {
        const result = await enrichOne(activeCtx, listing);
        if (result === "blocked") {
          // The current UA is flagged by Baxia — rotate to a fresh UA and
          // retry this listing once. The new context has no prior history
          // or cookies, giving it a clean anti-bot slate.
          console.log(`[Goofish Enrichment] Baxia modal blocked ${listing.href} — rotating user agent and retrying`);
          await activeCtx.close().catch(() => {});
          uaIndex++;
          activeCtx = await createGoofishContext(browser, uaIndex);
          await enrichOne(activeCtx, listing);
        }
      }),
    );
  }

  // Close the rotated context if we created one (the caller closes the
  // original context itself).
  if (activeCtx !== ctx) await activeCtx.close().catch(() => {});
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
export function parseManualPasteHtml(
  html: string,
  query: string,
  opts?: { minPriceCny?: number; maxPriceCny?: number },
): GoofishListing[] {
  let parsed = parseGoofishHtml(html);
  // If structured parse found nothing, fall back to a looser extraction
  if (parsed.length === 0) {
    // Heuristic: try to find listing-like blocks by splitting on item/card markers
    const cardSplits = html.split(/(?=<[^>]+class="[^"]*(?:item|card|search-result)[^"]*")/gi);
    let idx = 0;
    for (const chunk of cardSplits) {
      if (idx >= 60) break;
      const priceM = chunk.match(/¥\s*(\d[\d,]*(?:\.\d{1,2})?)/);
      if (!priceM) continue;
      const priceCny = parseFloat(priceM[1].replace(/,/g, ""));
      if (isNaN(priceCny) || priceCny <= 0) continue;

      // Extract title: first substantial text before or around price
      const cleanText = chunk
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const titleM =
        chunk.match(/<[^>]+class="[^"]*(?:title|name|header)[^"]*"[^>]*>([^<]{4,120})<\/[^>]+>/i) ||
        chunk.match(/<[^>]*>([^<]{4,120})<\/[^>]*>/);
      const title = (titleM ? titleM[1].replace(/<[^>]+>/g, "") : cleanText).trim();
      if (!title || title.length < 3) continue;

      const normalized = normalizeListing(title, cleanText);
      parsed.push({
        id: `gf-manual-${idx}`,
        title,
        priceCny,
        description: cleanText.slice(0, 500),
        imageUrls: [],
        sellerLocation: "未知",
        wantsCount: 0,
        sellerVerified: false,
        sellerVerifiedTransactions: 0,
        rawText: cleanText,
        source: "goofish",
        normalized,
      });
      idx++;
    }
  }

  if (opts?.minPriceCny && opts.minPriceCny > 0) {
    parsed = parsed.filter((item) => item.priceCny >= opts.minPriceCny!);
  }
  if (opts?.maxPriceCny && opts.maxPriceCny > 0) {
    parsed = parsed.filter((item) => item.priceCny <= opts.maxPriceCny!);
  }

  return parsed;
}