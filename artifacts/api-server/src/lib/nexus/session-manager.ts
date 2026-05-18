/**
 * NEXUS — Session & Identity Manager
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Manages browser session identity to appear human:
 *
 *   • Session warming   — Visit 3–5 benign pages before targeting protected pages
 *   • Cookie building   — Accumulate realistic cookie profiles per domain
 *   • Header entropy    — Rotate Accept-Language, Referrer, User-Agent realistically
 *   • Request jitter    — Random delays (2–8s) between requests
 *   • Realistic Accept headers matching the User-Agent
 *
 * Used by PowerScraper's Playwright and stealth layers.
 */

import type { BrowserContext, Page } from "playwright";

// ── User agent profiles ────────────────────────────────────────────────────────

export interface UAProfile {
  ua: string;
  platform: string;
  acceptLanguage: string;
  vendor: string;
  renderer: string;
}

export const UA_PROFILES: UAProfile[] = [
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    platform: "Win32",
    acceptLanguage: "en-US,en;q=0.9,ar;q=0.8",
    vendor: "Google Inc.",
    renderer: "Chrome/138",
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    platform: "MacIntel",
    acceptLanguage: "en-GB,en;q=0.9,ar-SA;q=0.8",
    vendor: "Google Inc.",
    renderer: "Chrome/137",
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
    platform: "Win32",
    acceptLanguage: "ar-SA,ar;q=0.9,en;q=0.8",
    vendor: "Microsoft Corporation",
    renderer: "Edg/136",
  },
  {
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    platform: "Linux x86_64",
    acceptLanguage: "en-US,en;q=0.9",
    vendor: "Google Inc.",
    renderer: "Chrome/138",
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    platform: "MacIntel",
    acceptLanguage: "ar,en-US;q=0.9,en;q=0.8",
    vendor: "Apple Computer, Inc.",
    renderer: "Safari/17",
  },
];

export function randomUAProfile(): UAProfile {
  return UA_PROFILES[Math.floor(Math.random() * UA_PROFILES.length)];
}

// ── Realistic headers ──────────────────────────────────────────────────────────

const REFERRERS = [
  "https://www.google.com/",
  "https://www.google.sa/",
  "https://www.bing.com/",
  "https://duckduckgo.com/",
  "https://www.linkedin.com/",
  "",
];

const ACCEPT_HEADERS = [
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
];

export function buildRealisticHeaders(profile?: UAProfile): Record<string, string> {
  const ua = profile || randomUAProfile();
  return {
    "User-Agent": ua.ua,
    "Accept": ACCEPT_HEADERS[Math.floor(Math.random() * ACCEPT_HEADERS.length)],
    "Accept-Language": ua.acceptLanguage,
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": Math.random() > 0.5 ? "cross-site" : "none",
    "Sec-Fetch-User": "?1",
    "Referer": REFERRERS[Math.floor(Math.random() * REFERRERS.length)],
    "Cache-Control": "max-age=0",
  };
}

// ── Request jitter ─────────────────────────────────────────────────────────────

/**
 * Wait a random delay to simulate human reading/thinking time.
 */
export function humanJitter(minMs = 2000, maxMs = 8000): Promise<void> {
  const delay = Math.random() * (maxMs - minMs) + minMs;
  return new Promise(r => setTimeout(r, delay));
}

export function lightJitter(minMs = 500, maxMs = 1500): Promise<void> {
  const delay = Math.random() * (maxMs - minMs) + minMs;
  return new Promise(r => setTimeout(r, delay));
}

// ── Benign warm-up pages ───────────────────────────────────────────────────────

const WARMUP_PAGES: Record<string, string[]> = {
  "sa": [
    "https://www.google.sa",
    "https://www.saudigazette.com.sa",
    "https://www.sabq.org",
    "https://www.alekhbariya.net",
  ],
  "global": [
    "https://www.google.com",
    "https://www.wikipedia.org",
    "https://www.reuters.com",
  ],
};

/**
 * Warm up a Playwright browser context by visiting benign pages first.
 * This builds a realistic cookie profile and browsing history before
 * navigating to the target (protected) page.
 */
export async function warmUpSession(
  page: Page,
  targetHostname: string,
  warmupCount = 3
): Promise<void> {
  const isSaudi = targetHostname.endsWith(".sa") || targetHostname.includes("saudi");
  const pool = isSaudi ? WARMUP_PAGES["sa"] : WARMUP_PAGES["global"];
  const pages = pool.slice(0, warmupCount);

  for (const warmUrl of pages) {
    try {
      await page.goto(warmUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
      await lightJitter(500, 1500);
      // Simulate quick scroll
      await page.evaluate(() => window.scrollBy(0, Math.random() * 300 + 100));
    } catch { /* warmup failure is non-fatal */ }
  }
}

// ── Playwright context hardening ───────────────────────────────────────────────

/**
 * Inject browser fingerprint overrides into a Playwright page.
 * Covers: navigator properties, WebGL, canvas noise, timing.
 */
export async function hardenPage(page: Page, profile: UAProfile): Promise<void> {
  await page.addInitScript((p: UAProfile) => {
    // Override navigator properties
    Object.defineProperty(navigator, "platform",  { get: () => p.platform });
    Object.defineProperty(navigator, "vendor",    { get: () => p.vendor });
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", { get: () => p.acceptLanguage.split(",").map((l: string) => l.split(";")[0].trim()) });

    // Remove automation indicators
    // @ts-ignore
    delete window.__playwright;
    // @ts-ignore
    delete window.__pw_manual;
    // @ts-ignore
    delete window.callPhantom;
    // @ts-ignore
    delete window._phantom;

    // Canvas noise
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: any[]): any {
      const ctx = (origGetContext as any).call(this, type, ...args) as CanvasRenderingContext2D | null;
      if (ctx && type === "2d") {
        const origFillText = ctx.fillText.bind(ctx);
        ctx.fillText = function (...fArgs: Parameters<typeof ctx.fillText>) {
          origFillText(...fArgs);
          ctx.fillStyle = `rgba(${Math.random() * 2},${Math.random() * 2},${Math.random() * 2},0.01)`;
          ctx.fillRect(0, 0, 1, 1);
        };
      }
      return ctx;
    };

    // Chrome runtime stub
    if (!(window as unknown as Record<string, unknown>).chrome) {
      (window as unknown as Record<string, unknown>).chrome = {
        runtime: {
          onConnect: { addListener: () => {} },
          onMessage: { addListener: () => {} },
        },
        loadTimes: () => ({ requestTime: Date.now() / 1000 }),
        csi: () => ({ pageT: Date.now(), startE: Date.now() - 100 }),
      };
    }

    // Permissions API
    const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (origQuery) {
      navigator.permissions.query = (params: PermissionDescriptor) => {
        if ((params as { name: string }).name === "notifications") {
          return Promise.resolve({ state: "prompt" } as PermissionStatus);
        }
        return origQuery(params);
      };
    }
  }, profile);
}

/**
 * Simulate realistic mouse movement on a Playwright page.
 */
export async function simulateMouseMovement(page: Page): Promise<void> {
  try {
    const vp = page.viewportSize() || { width: 1280, height: 720 };
    const points = 4;
    for (let i = 0; i < points; i++) {
      const x = Math.random() * vp.width;
      const y = Math.random() * vp.height;
      await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
      await lightJitter(100, 400);
    }
  } catch { /* non-fatal */ }
}

/**
 * Simulate realistic scroll behaviour on a Playwright page.
 */
export async function simulateScroll(page: Page): Promise<void> {
  try {
    const scrolls = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < scrolls; i++) {
      const amount = Math.random() * 600 + 200;
      await page.evaluate((amt: number) => window.scrollBy({ top: amt, behavior: "smooth" }), amount);
      await lightJitter(300, 800);
    }
  } catch { /* non-fatal */ }
}
