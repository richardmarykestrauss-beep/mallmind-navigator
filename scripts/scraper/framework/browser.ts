/**
 * Playwright browser manager.
 *
 * Launches a single stealth Chromium instance shared across all scrapers.
 * Stealth patches make it indistinguishable from a real user's browser —
 * the key to bypassing Cloudflare and similar bot detection.
 *
 * Usage:
 *   const browser = await getBrowser();
 *   const page = await newStealthPage(browser);
 *   await page.goto('https://...');
 *   await browser.close();
 */

import { chromium, Browser, Page, BrowserContext } from "playwright";

// Injected into every page before any scripts run.
// These patches hide the fact that we're using automation.
const STEALTH_SCRIPT = `
  // Hide webdriver flag — the #1 signal bots check
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // Add chrome object real browsers always have
  if (!window.chrome) {
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
  }

  // Non-empty plugins list (headless Chrome has none by default)
  Object.defineProperty(navigator, 'plugins', {
    get: () => ({ length: 5, 0: { name: 'PDF Plugin' }, item: () => null }),
  });

  // Languages matching a South African user
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-ZA', 'en-GB', 'en'],
  });

  // Prevent iframe-based detection
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    get: function() { return window; },
  });

  // Realistic screen dimensions
  Object.defineProperty(screen, 'width',  { get: () => 1920 });
  Object.defineProperty(screen, 'height', { get: () => 1080 });
`;

let _browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (_browser) return _browser;
  _browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled", // removes "Chrome is being controlled" banner
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  });
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) { await _browser.close(); _browser = null; }
}

/**
 * Creates a new stealth page in an isolated browser context.
 * Each scraper gets its own context so cookies don't bleed between retailers.
 */
export async function newStealthPage(browser: Browser): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-ZA",
    timezoneId: "Africa/Johannesburg",
    extraHTTPHeaders: {
      "Accept-Language": "en-ZA,en;q=0.9",
    },
  });

  const page = await context.newPage();
  await page.addInitScript(STEALTH_SCRIPT);

  // Block images, fonts, media — speeds up scraping significantly
  await page.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4,mp3}", (r) => r.abort());
  // Block analytics/tracking that can fingerprint us
  await page.route(
    "**/{google-analytics,googletagmanager,facebook,hotjar,mixpanel,segment}**",
    (r) => r.abort()
  );

  return { page, context };
}

/**
 * Navigate with human-like behaviour: wait for network idle,
 * then pause briefly as a real user would after page load.
 */
export async function goto(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Small random pause — humans don't process pages instantly
  await page.waitForTimeout(800 + Math.random() * 1200);
}

/**
 * Try to extract embedded JSON from window.__NEXT_DATA__ or similar.
 * Many SA retail sites (Next.js, Nuxt) embed their full data payload here —
 * extracting it is faster and more reliable than DOM scraping.
 */
export async function extractWindowData(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const sources = [
      (window as Record<string, unknown>)["__NEXT_DATA__"],
      (window as Record<string, unknown>)["__NUXT__"],
      (window as Record<string, unknown>)["__INITIAL_STATE__"],
      (window as Record<string, unknown>)["digitalData"],
      (window as Record<string, unknown>)["__APP_STATE__"],
    ];
    return sources.find(Boolean) ?? null;
  });
}

/**
 * Extract JSON-LD structured data from the page.
 */
export async function extractPageJsonLd(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const results: unknown[] = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      try { results.push(JSON.parse(el.textContent ?? "")); } catch { /* skip */ }
    });
    return results;
  });
}
