// scrapers/browser.ts
// Shared Playwright browser helper for real browser-based scraping.
// Uses stealth techniques to bypass anti-bot protection (Akamai, Amazon, etc.).
import { chromium, type Browser, type BrowserContext } from "playwright";
let browserInstance: Browser | null = null;
/**
 * Get a shared browser instance (singleton). Launches once, reuses across
 * scraper calls to avoid the ~1s launch overhead per request.
 */
export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  browserInstance = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-infobars",
      "--window-position=0,0",
      "--ignore-certifcate-errors",
      "--ignore-certifcate-errors-spki-list",
      "--no-zygote",
      "--enable-features=NetworkService,NetworkServiceInProcess",
    ],
  });
  return browserInstance;
}

/**
 * Stealth init script — patches browser fingerprints that anti-bot systems
 * (Akamai, Amazon, Cloudflare) check to detect headless browsers.
 * This runs BEFORE any page JavaScript, so the patched values are what the
 * anti-bot scripts see.
 */
const STEALTH_INIT_SCRIPT = `
// 1. Remove webdriver flag
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// 2. Fake plugins (headless Chrome has 0 plugins, real Chrome has 3+)
Object.defineProperty(navigator, 'plugins', {
  get: () => [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
  ],
});

// 3. Fake languages
Object.defineProperty(navigator, 'languages', { get: () => ['pt-PT', 'pt', 'en-US', 'en'] });

// 4. Add Chrome runtime (headless doesn't have it)
window.chrome = window.chrome || {};
window.chrome.runtime = window.chrome.runtime || {};

// 5. Fix permissions API (headless reports 'denied' for everything)
const originalQuery = window.navigator.permissions?.query;
if (originalQuery) {
  window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);
};

// 6. Fix WebGL vendor/renderer (headless reports SwiftShader/Google Inc.)
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
  if (parameter === 37445) return 'Intel Inc.'; // UNMASKED_VENDOR_WEBGL
  if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
  return getParameter.call(this, parameter);
};

// 7. Fix hairline feature detection (headless reports false)
const elementDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
if (elementDescriptor) {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    ...elementDescriptor,
    get: function() { return elementDescriptor.get?.call(this) || 1; },
  });
}

// 8. Prevent detection via toString() on patched functions
const origToString = Function.prototype.toString;
Function.prototype.toString = function() {
  if (this === window.navigator.permissions.query) return 'function query() { [native code] }';
  return origToString.call(this);
};
`;

/**
 * Create a stealth browser context with anti-detection measures.
 * - Realistic User-Agent (latest Chrome)
 * - Removes the `navigator.webdriver` flag
 * - Fakes plugins, WebGL vendor, Chrome runtime
 * - Sets locale + viewport
 * - navigator.languages is set DYNAMICALLY based on the locale parameter
 *   (NOT hardcoded to pt-PT — that caused Goofish to block because the
 *   Chinese site detected a language mismatch: zh-CN locale but pt-PT
 *   navigator.languages).
 */
export async function createContext(locale: string = "en-US"): Promise<BrowserContext> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale,
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      "Accept-Language": `${locale},en;q=0.8`,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
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
  // Build locale-specific stealth script — use the locale parameter to set
  // navigator.languages so it matches the browser locale. Hardcoding pt-PT
  // caused Goofish (Chinese site) to detect a mismatch and block the page.
  const langs = locale.startsWith("zh") ? "['zh-CN', 'zh', 'en-US', 'en']"
    : locale.startsWith("pt") ? "['pt-PT', 'pt', 'en-US', 'en']"
    : locale.startsWith("es") ? "['es-ES', 'es', 'en-US', 'en']"
    : "['en-US', 'en']";
  const localizedStealthScript = STEALTH_INIT_SCRIPT.replace(
    "['pt-PT', 'pt', 'en-US', 'en']",
    langs,
  );
  // Inject stealth patches BEFORE any page JS runs
  await ctx.addInitScript(localizedStealthScript);
  return ctx;
}

/**
 * Close the shared browser instance (called on server shutdown).
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
