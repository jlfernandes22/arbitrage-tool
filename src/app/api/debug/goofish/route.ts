import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/debug/goofish?query=iPhone+15+Pro+256GB
 *
 * Runs the Goofish scraper in debug mode and returns detailed diagnostics:
 * - Page title, URL, final HTML length
 * - Screenshot saved to db/debug-screenshots/
 * - Selector counts for all key elements (main-title, price, pagination, etc.)
 * - Body HTML snippet (first 2000 chars)
 * - Any error messages captured
 *
 * This endpoint launches a fresh browser per request so debug runs don't
 * interfere with active scans.
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query") || "iPhone 15 Pro 256GB";

  const diagnostics: {
    query: string;
    steps: Array<{ step: string; timestamp: string; details: Record<string, unknown> }>;
    errors: string[];
    finalListingCount: number;
    screenshotPaths: string[];
  } = {
    query,
    steps: [],
    errors: [],
    finalListingCount: 0,
    screenshotPaths: [],
  };

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "zh-CN",
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: {
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });

    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await ctx.newPage();

    // Capture console messages from the page
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        diagnostics.errors.push(`[page console] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      diagnostics.errors.push(`[page error] ${err.message}`);
    });

    const searchUrl = `https://www.goofish.com/search?q=${encodeURIComponent(query)}&spm=a21ybx.search.searchInput.0`;

    // Step 1: Navigate
    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      diagnostics.steps.push({
        step: "1. Navigate to Goofish",
        timestamp: new Date().toISOString(),
        details: {
          url: searchUrl,
          status: "OK",
          pageTitle: await page.title(),
          finalUrl: page.url(),
        },
      });
    } catch (e) {
      diagnostics.errors.push(`Navigation failed: ${e instanceof Error ? e.message : String(e)}`);
      diagnostics.steps.push({
        step: "1. Navigate to Goofish",
        timestamp: new Date().toISOString(),
        details: { url: searchUrl, status: "FAILED", error: String(e) },
      });
    }

    await page.waitForTimeout(2000);

    // Step 2: Capture initial state (before modal dismiss)
    try {
      const htmlLen = await page.evaluate(() => document.documentElement.outerHTML.length);
      const titleCount = await page.locator('[class*="main-title"]').count();
      const loginModalCount = await page.locator('[class*="loginCon"], [class*="login-modal"]').count();
      const baxiaCount = await page.locator('[class*="baxia"]').count();
      const iframeCount = await page.locator("iframe").count();
      const passportIframeCount = await page.locator('iframe[src*="passport"], iframe[src*="login"]').count();

      diagnostics.steps.push({
        step: "2. Initial state (before modal dismiss)",
        timestamp: new Date().toISOString(),
        details: {
          htmlLength: htmlLen,
          mainTitleCount: titleCount,
          loginModalElements: loginModalCount,
          baxiaElements: baxiaCount,
          totalIframes: iframeCount,
          passportIframes: passportIframeCount,
          bodyOverflow: await page.evaluate(() => document.body.style.overflow),
        },
      });
    } catch (e) {
      diagnostics.errors.push(`Initial state capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Step 3: Take screenshot (before modal dismiss)
    try {
      const screenshotDir = path.join(process.cwd(), "db", "debug-screenshots");
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      const ts = Date.now();
      const screenshotPath = path.join(screenshotDir, `goofish-${ts}-1-initial.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      diagnostics.screenshotPaths.push(screenshotPath);
      diagnostics.steps.push({
        step: "3. Screenshot (initial)",
        timestamp: new Date().toISOString(),
        details: { screenshot: screenshotPath },
      });
    } catch (e) {
      diagnostics.errors.push(`Screenshot 1 failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Step 4: Dismiss modals — SURGICAL REMOVE (not CSS hide!)
    // CSS hide (display:none) triggers Baxia anti-bot detection.
    // el.remove() with surgical selectors is the approach that WORKS.
    try {
      const htmlBefore = await page.evaluate(() => document.documentElement.outerHTML.length);

      // Step 4a: Try clicking the close button
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

      // Step 4b: SURGICAL remove — only specific login modal elements
      // CRITICAL: Do NOT remove ant-modal-mask or ant-modal-wrap — they
      // contain 126KB of listing content. Only remove loginCon + login-modal.
      await page.evaluate(() => {
        const modalSelectors = [
          '[class*="loginCon"]',
          '[class*="login-modal"]',
        ];
        modalSelectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => el.remove());
        });
        document
          .querySelectorAll('iframe[src*="passport"], iframe[src*="login"]')
          .forEach((el) => el.remove());
        document.body.style.overflow = "auto";
        document.body.style.position = "static";
        document.documentElement.style.overflow = "auto";
      });
      await page.waitForTimeout(500);

      const htmlAfter = await page.evaluate(() => document.documentElement.outerHTML.length);
      diagnostics.steps.push({
        step: "4. Modal dismissal (surgical remove)",
        timestamp: new Date().toISOString(),
        details: {
          status: "OK",
          htmlBefore: htmlBefore,
          htmlAfter: htmlAfter,
          htmlRemoved: htmlBefore - htmlAfter,
          note: htmlBefore - htmlAfter > 100000
            ? "WARNING: Over 100KB removed — may have destroyed listing content."
            : "Surgical removal (under 100KB).",
        },
      });
    } catch (e) {
      diagnostics.errors.push(`Modal dismiss failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Step 5: Wait for listings
    await page.waitForTimeout(3000);

    // Step 6: Capture state after modal dismiss + wait
    try {
      const titleCount = await page.locator('[class*="main-title"]').count();
      const priceCount = await page.locator('[class*="row3-wrap-price"], [class*="price"]').count();
      const itemLinkCount = await page.locator("a[href*='/item'], a[href*='/detail']").count();
      const paginationBtnCount = await page.locator("button[class*='search-pagination-arrow']").count();
      const htmlLen = await page.evaluate(() => document.documentElement.outerHTML.length);

      diagnostics.steps.push({
        step: "5. State after modal dismiss + 3s wait",
        timestamp: new Date().toISOString(),
        details: {
          mainTitleCount: titleCount,
          priceElements: priceCount,
          itemLinks: itemLinkCount,
          paginationButtons: paginationBtnCount,
          htmlLength: htmlLen,
        },
      });

      // Step 7: If no listings, try scrolling
      if (titleCount === 0) {
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(3000);
        const titleCountAfterScroll = await page.locator('[class*="main-title"]').count();
        diagnostics.steps.push({
          step: "6. After scroll attempt",
          timestamp: new Date().toISOString(),
          details: {
            mainTitleCount: titleCountAfterScroll,
            scrolled: true,
          },
        });
        diagnostics.finalListingCount = titleCountAfterScroll;
      } else {
        diagnostics.finalListingCount = titleCount;
      }
    } catch (e) {
      diagnostics.errors.push(`Post-dismiss capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Step 8: Final screenshot
    try {
      const screenshotDir = path.join(process.cwd(), "db", "debug-screenshots");
      const ts = Date.now();
      const screenshotPath = path.join(screenshotDir, `goofish-${ts}-2-final.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      diagnostics.screenshotPaths.push(screenshotPath);
      diagnostics.steps.push({
        step: "7. Screenshot (final)",
        timestamp: new Date().toISOString(),
        details: { screenshot: screenshotPath },
      });
    } catch (e) {
      diagnostics.errors.push(`Screenshot 2 failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Step 9: Capture HTML snippet (first 2000 chars of body)
    try {
      const bodyHtml = await page.evaluate(() => document.body?.innerHTML?.slice(0, 2000) ?? "");
      diagnostics.steps.push({
        step: "8. Body HTML snippet (first 2000 chars)",
        timestamp: new Date().toISOString(),
        details: { bodyHtmlSnippet: bodyHtml },
      });
    } catch (e) {
      diagnostics.errors.push(`HTML capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Step 10: Run the ACTUAL extraction logic (same as the real scraper)
    // and report exactly where it fails. This is the key diagnostic —
    // if the extraction returns 0 but mainTitleCount is 30, we can see
    // which step (parent walk, price match, href) is failing.
    try {
      const extractionDebug = await page.evaluate(() => {
        // ── Same parsePriceText + parsePriceFromEl as the real scraper ──
        const parsePriceText = (text: string): string | null => {
          if (!text) return null;
          const match = text.match(/¥\s*((?:\d[\d,]*)(?:\.\d{2})?)/);
          if (!match) return null;
          let num = parseFloat(match[1].replace(/,/g, ""));
          if (isNaN(num)) return null;
          const afterNum = text.slice(match.index! + match[0].length);
          if (afterNum.startsWith("万")) num = num * 10000;
          else if (afterNum.startsWith("千")) num = num * 1000;
          return String(Math.round(num));
        };
        const parsePriceFromEl = (el: Element): string | null => {
          // Try child elements FIRST (they have clean price text)
          for (const child of el.children) {
            const text = child.textContent?.trim() || "";
            if (text.includes("¥")) {
              const price = parsePriceText(text);
              if (price) return price;
            }
          }
          const firstChildText = el.firstChild?.textContent?.trim() || "";
          if (firstChildText.includes("¥")) {
            const price1 = parsePriceText(firstChildText);
            if (price1) return price1;
          }
          for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              const text = child.textContent?.trim() || "";
              if (text.includes("¥")) {
                const price = parsePriceText(text);
                if (price) return price;
              }
            }
          }
          const fullText = el.textContent?.trim() || "";
          return parsePriceText(fullText);
        };
        const findBestPrice = (card: HTMLElement): string | null => {
          const primaryEls = card.querySelectorAll("[class*='row3-wrap-price']");
          for (const el of primaryEls) {
            const price = parsePriceFromEl(el);
            if (price && parseFloat(price) >= 50 && parseFloat(price) <= 100000) return price;
          }
          return null;
        };

        const titleEls = document.querySelectorAll("[class*='main-title']");
        const stats = {
          totalTitles: titleEls.length,
          foundPriceInParent: 0,
          foundPriceMatch: 0,
          noPriceInParent: 0,
          priceRegexFailed: 0,
          samples: [] as Array<{
            title: string;
            parentLevelsWalked: number;
            priceFound: boolean;
            extractedPrice: string;
            allPriceElements: string[];
            hrefFound: boolean;
            href: string;
          }>,
        };
        titleEls.forEach((titleEl, idx) => {
          let card = titleEl as HTMLElement;
          let levelsWalked = 0;
          let priceFound = false;
          for (let j = 0; j < 5; j++) {
            card = card.parentElement as HTMLElement;
            if (!card) break;
            levelsWalked++;
            // Check if ANY price element exists (for foundPriceInParent stat)
            const anyPrice = card.querySelector("[class*='row3-wrap-price'], [class*='price']");
            if (anyPrice) {
              priceFound = true;
              break;
            }
          }
          if (!priceFound) {
            stats.noPriceInParent++;
            if (idx < 5) {
              stats.samples.push({
                title: titleEl.textContent?.trim()?.substring(0, 80) || "",
                parentLevelsWalked: levelsWalked,
                priceFound: false,
                extractedPrice: "",
                allPriceElements: [],
                hrefFound: false,
                href: "",
              });
            }
            return;
          }
          stats.foundPriceInParent++;
          // Now run the ACTUAL findBestPrice logic
          const priceText = findBestPrice(card as HTMLElement);
          if (!priceText) {
            stats.priceRegexFailed++;
            // Collect ALL price element texts for debugging
            const allTexts: string[] = [];
            (card as HTMLElement).querySelectorAll("[class*='price']").forEach((el) => {
              if (el.tagName !== "INPUT") {
                allTexts.push((el.textContent || "").trim().substring(0, 80));
              }
            });
            if (idx < 5) {
              stats.samples.push({
                title: titleEl.textContent?.trim()?.substring(0, 80) || "",
                parentLevelsWalked: levelsWalked,
                priceFound: true,
                extractedPrice: "FAILED",
                allPriceElements: allTexts,
                hrefFound: false,
                href: "",
              });
            }
            return;
          }
          stats.foundPriceMatch++;
          // Check href
          let linkEl: HTMLAnchorElement | null = (card as HTMLElement).querySelector<HTMLAnchorElement>("a[href*='/item'], a[href*='/detail']");
          if (!linkEl) {
            const ancestor = (titleEl as HTMLElement).closest("a[href*='/item'], a[href*='/detail']");
            if (ancestor) linkEl = ancestor as HTMLAnchorElement;
          }
          if (!linkEl) {
            linkEl = (card as HTMLElement).querySelector<HTMLAnchorElement>("a[href]");
          }
          // Collect all price element texts for the sample
          const allTexts: string[] = [];
          (card as HTMLElement).querySelectorAll("[class*='price']").forEach((el) => {
            if (el.tagName !== "INPUT") {
              allTexts.push((el.textContent || "").trim().substring(0, 80));
            }
          });
          if (idx < 5) {
            stats.samples.push({
              title: titleEl.textContent?.trim()?.substring(0, 80) || "",
              parentLevelsWalked: levelsWalked,
              priceFound: true,
              extractedPrice: priceText,
              allPriceElements: allTexts,
              hrefFound: !!linkEl,
              href: linkEl?.href || linkEl?.getAttribute("href") || "",
            });
          }
        });
        return stats;
      });
      diagnostics.steps.push({
        step: "9. EXTRACTION DIAGNOSTICS (the key test)",
        timestamp: new Date().toISOString(),
        details: extractionDebug as Record<string, unknown>,
      });
    } catch (e) {
      diagnostics.errors.push(`Extraction diagnostics failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    await ctx.close();
  } catch (e) {
    diagnostics.errors.push(`Browser launch failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }

  return NextResponse.json(diagnostics);
}
