/**
 * PowerScraper — Unified Multi-Engine Web Scraping Stack
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Layers (auto-escalating — each layer kicks in if the previous is blocked
 * or returns insufficient content):
 *
 *   Layer 1 │ Cheerio          Fast static HTML parser. No browser overhead.
 *   Layer 2 │ Playwright       Full Chromium browser. Executes JS, waits for
 *            │                 dynamic content, handles SPAs.
 *   Layer 3 │ Playwright+Stealth  Playwright + puppeteer-extra-plugin-stealth.
 *            │                 Evades bot detection: hides webdriver, spoofs
 *            │                 fingerprint, randomises timing + mouse movement.
 *   Layer 4 │ BeautifulSoup    Python subprocess (bs4 + lxml). Superior Arabic
 *            │                 RTL text extraction, handles malformed HTML.
 *
 * Additional capabilities:
 *   • Multi-page BFS crawler with priority queue (about > team > contact > news > *)
 *   • Pagination detection: ?page=N, /page/N, التالي, next buttons, infinite scroll
 *   • Stealth agent: user-agent rotation, viewport randomisation, realistic delays
 *   • Per-page type classification (about, team, services, contact, news, careers…)
 *   • Email + Saudi phone extraction from every page
 *   • Full link graph extraction
 */

import axios from "axios";
import * as cheerio from "cheerio";
import { spawn } from "child_process";
import * as path from "path";
import { chromium as playwrightChromium } from "playwright";
import playwrightExtra from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getProxy } from "./nexus/proxy-manager.js";
import {
  randomUAProfile,
  buildRealisticHeaders,
  hardenPage,
  warmUpSession,
  simulateMouseMovement,
  simulateScroll,
  humanJitter,
  lightJitter,
} from "./nexus/session-manager.js";

// __dirname-equivalent that works in both ESM and CJS builds
const BS4_SCRIPT = path.join(
  typeof __dirname !== "undefined"
    ? __dirname
    : process.cwd(),
  "bs4_extract.py"
);

const CHROMIUM_PATH =
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser";

const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--no-first-run",
  "--no-zygote",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-translate",
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

function randomDelay(min = 800, max = 2500): Promise<void> {
  return new Promise(r => setTimeout(r, Math.random() * (max - min) + min));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScrapingEngine = "cheerio" | "playwright" | "playwright-stealth" | "beautifulsoup";

export interface ScrapeResult {
  url: string;
  html: string;
  text: string;
  title: string;
  emails: string[];
  phones: string[];
  links: string[];
  meta: Record<string, string>;
  engine: ScrapingEngine;
  statusCode?: number;
  loadTimeMs: number;
  hasArabic: boolean;
  charCount: number;
  blocked: boolean;
  error?: string;
}

export interface ScrapeOptions {
  /** Which engines to allow. Default: all */
  engines?: ScrapingEngine[];
  /** Minimum text length before escalating to next engine. Default: 400 */
  minContentLength?: number;
  /** Timeout per attempt in ms. Default: 20000 */
  timeoutMs?: number;
  /** Extra HTTP headers */
  headers?: Record<string, string>;
  /** Wait for this selector before extracting (Playwright layers only) */
  waitForSelector?: string;
  /** Scroll to bottom to trigger infinite scroll (Playwright only) */
  scrollToBottom?: boolean;
  /** Force a specific engine, skip escalation */
  forceEngine?: ScrapingEngine;
}

export interface CrawlOptions {
  /** Max pages to crawl. Default: 20 */
  maxPages?: number;
  /** Max depth from root. Default: 3 */
  maxDepth?: number;
  /** Follow pagination links. Default: true */
  followPagination?: boolean;
  /** Scroll infinite-scroll pages. Default: false */
  scrollInfinite?: boolean;
  /** Page types to prioritise */
  priorityTypes?: PageType[];
  /** Only crawl pages whose URL matches this pattern */
  urlFilter?: RegExp;
  /** Timeout per page. Default: 20000 */
  timeoutMs?: number;
  /** Scraping options passed to each page */
  scrapeOptions?: ScrapeOptions;
}

export type PageType =
  | "about" | "services" | "products" | "contact" | "team"
  | "news" | "blog" | "careers" | "projects" | "financials"
  | "investors" | "board" | "gallery" | "general";

export interface CrawlPage {
  url: string;
  depth: number;
  pageType: PageType;
  title: string;
  text: string;
  html: string;
  emails: string[];
  phones: string[];
  links: string[];
  meta: Record<string, string>;
  engine: ScrapingEngine;
  paginatedUrls: string[];
  hasArabic: boolean;
}

export interface CrawlResult {
  rootUrl: string;
  pages: CrawlPage[];
  allEmails: string[];
  allPhones: string[];
  allLinks: string[];
  pagesAnalyzed: number;
  engineUsage: Partial<Record<ScrapingEngine, number>>;
  paginationFollowed: number;
  durationMs: number;
  errors: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractEmails(text: string): string[] {
  const matches = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(matches)].slice(0, 25);
}

function extractPhones(text: string): string[] {
  const matches = text.match(/(?:\+966|00966|0)[\s.\-]?\d{2}[\s.\-]?\d{3}[\s.\-]?\d{4}/g) || [];
  return [...new Set(matches)].slice(0, 20);
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const href = $(el).attr("href") || "";
      if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) return;
      const resolved = new URL(href, baseUrl);
      resolved.hash = "";
      if (resolved.hostname === base.hostname) links.add(resolved.toString());
      else links.add(resolved.toString()); // keep external links too
    } catch { /* ignore */ }
  });
  return [...links].slice(0, 150);
}

function extractTitle(html: string): string {
  const $ = cheerio.load(html);
  return $("title").first().text().trim() || $("h1").first().text().trim() || "";
}

function extractMeta(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const meta: Record<string, string> = {};
  $("meta[name='description']").each((_, el) => { meta.description = $(el).attr("content") || ""; });
  $("meta[property='og:title']").each((_, el) => { meta.og_title = $(el).attr("content") || ""; });
  $("meta[property='og:description']").each((_, el) => { meta.og_description = $(el).attr("content") || ""; });
  $("meta[name='keywords']").each((_, el) => { meta.keywords = $(el).attr("content") || ""; });
  return meta;
}

function cleanText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, nav, footer, aside, [aria-hidden='true']").remove();
  const raw = $("body").text().replace(/\s{3,}/g, "  ").trim();
  return raw.slice(0, 10000);
}

function hasArabicText(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function isBlocked(html: string, statusCode?: number): boolean {
  if (statusCode && [403, 429, 503, 407].includes(statusCode)) return true;
  const lower = html.toLowerCase();
  return (
    lower.includes("access denied") ||
    lower.includes("cloudflare") ||
    lower.includes("please enable cookies") ||
    lower.includes("just a moment") ||
    lower.includes("verify you are human") ||
    lower.includes("ddos-guard") ||
    (html.length < 500 && lower.includes("blocked"))
  );
}

export function classifyPageType(url: string, title = "", text = ""): PageType {
  const combined = `${url} ${title} ${text.slice(0, 200)}`.toLowerCase();
  if (/about|من-نحن|about-us|who-we-are|قصتنا|company|overview/i.test(combined)) return "about";
  if (/service|خدمات|solution|حلول|offer|نقدم/i.test(combined)) return "services";
  if (/product|منتج|catalog|كتالوج/i.test(combined)) return "products";
  if (/contact|اتصل|reach|location|موقع|address|عنوان/i.test(combined)) return "contact";
  if (/team|فريق|leadership|people|staff|مدير|موظف/i.test(combined)) return "team";
  if (/news|أخبار|press|media|إعلام|update|blog|مدونة/i.test(combined)) return "news";
  if (/blog|article|post|مقال/i.test(combined)) return "blog";
  if (/career|وظائف|job|hire|vacancy|فرصة/i.test(combined)) return "careers";
  if (/project|مشروع|portfolio|work|أعمال|achievement/i.test(combined)) return "projects";
  if (/financial|مالي|revenue|إيراد|annual-report|تقرير/i.test(combined)) return "financials";
  if (/investor|مستثمر|shareholder|مساهم|governance/i.test(combined)) return "investors";
  if (/board|مجلس|director|executive|تنفيذي/i.test(combined)) return "board";
  return "general";
}

const PAGE_TYPE_PRIORITY: Record<PageType, number> = {
  about: 10, team: 9, board: 9, contact: 8, financials: 8,
  investors: 7, services: 6, products: 6, news: 5, blog: 4,
  projects: 4, careers: 3, gallery: 2, general: 1,
};

function detectPaginationUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const paginationUrls = new Set<string>();

  const tryAdd = (href: string) => {
    try {
      const resolved = new URL(href, baseUrl);
      resolved.hash = "";
      paginationUrls.add(resolved.toString());
    } catch { /* ignore */ }
  };

  // Numbered pages: ?page=2, /page/2, ?p=2, ?start=10, ?offset=10
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim().toLowerCase();
    const isPageNum = /^\d+$/.test(text) || /page|next|التالي|›|»|>|more/i.test(text);
    const hasPageParam = /[?&](page|p|pg|paged|start|offset|from)=\d+/i.test(href) || /\/page\/\d+/i.test(href);
    if (isPageNum || hasPageParam) tryAdd(href);
  });

  // Rel="next" pagination
  $("link[rel='next'], a[rel='next']").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (href) tryAdd(href);
  });

  // Arabic pagination patterns
  $("a").filter((_, el) => {
    const t = $(el).text().trim();
    return /التالي|الصفحة التالية|المزيد/.test(t);
  }).each((_, el) => {
    const href = $(el).attr("href") || "";
    if (href) tryAdd(href);
  });

  // Remove the current URL from pagination set
  try { paginationUrls.delete(new URL(baseUrl).toString()); } catch { /* ignore */ }
  return [...paginationUrls].slice(0, 20);
}

// ── BeautifulSoup bridge ──────────────────────────────────────────────────────

async function extractWithBS4(html: string, baseUrl = ""): Promise<{
  text: string; emails: string[]; phones: string[]; links: string[];
  meta: Record<string, string>; hasArabic: boolean;
} | null> {
  return new Promise(resolve => {
    try {
      const args = ["--mode", "full"];
      if (baseUrl) args.push("--url", baseUrl);
      const proc = spawn("python3", [BS4_SCRIPT, ...args], {
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code !== 0 || !stdout.trim()) {
          if (stderr) console.warn("[BS4] stderr:", stderr.slice(0, 200));
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as {
            text?: string; emails?: string[]; phones?: string[]; links?: string[];
            meta?: Record<string, string>; has_arabic?: boolean;
          };
          resolve({
            text: parsed.text || "",
            emails: parsed.emails || [],
            phones: parsed.phones || [],
            links: parsed.links || [],
            meta: parsed.meta || {},
            hasArabic: parsed.has_arabic || false,
          });
        } catch {
          resolve(null);
        }
      });
      proc.stdin.write(html);
      proc.stdin.end();
    } catch (e) {
      resolve(null);
    }
  });
}

// ── Layer 1: Cheerio (static HTML) ───────────────────────────────────────────

async function scrapeWithCheerio(url: string, options: ScrapeOptions): Promise<ScrapeResult> {
  const start = Date.now();
  try {
    const proxy = getProxy("per-request");
    const uaProfile = randomUAProfile();
    const realisticHeaders = buildRealisticHeaders(uaProfile);
    const resp = await axios.get(url, {
      timeout: options.timeoutMs ?? 15000,
      ...(proxy.axiosProxy ? { proxy: proxy.axiosProxy } : {}),
      headers: {
        ...realisticHeaders,
        ...options.headers,
      },
      maxRedirects: 5,
    });
    const html = String(resp.data || "");
    const text = cleanText(html);
    const title = extractTitle(html);
    const emails = extractEmails(text + html);
    const phones = extractPhones(text + html);
    const links = extractLinks(html, url);
    const meta = extractMeta(html);
    const blocked = isBlocked(html, resp.status);
    return {
      url, html, text, title, emails, phones, links, meta,
      engine: "cheerio",
      statusCode: resp.status,
      loadTimeMs: Date.now() - start,
      hasArabic: hasArabicText(text),
      charCount: text.length,
      blocked,
    };
  } catch (e) {
    return {
      url, html: "", text: "", title: "", emails: [], phones: [], links: [], meta: {},
      engine: "cheerio", loadTimeMs: Date.now() - start, hasArabic: false, charCount: 0,
      blocked: false, error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Layer 2: Playwright (full browser, no stealth) ────────────────────────────

async function scrapeWithPlaywright(url: string, options: ScrapeOptions, stealth = false): Promise<ScrapeResult> {
  const start = Date.now();
  let browser = null;
  try {
    const uaProfile = randomUAProfile();
    const viewport = randomViewport();
    const proxy = getProxy(stealth ? "sticky-15" : "per-request");

    const launchOptions = {
      executablePath: CHROMIUM_PATH,
      args: BROWSER_ARGS,
      headless: true as const,
    };

    if (stealth) {
      const stealthChromium = playwrightExtra.chromium;
      stealthChromium.use(StealthPlugin());
      browser = await stealthChromium.launch(launchOptions);
    } else {
      browser = await playwrightChromium.launch(launchOptions);
    }

    const contextOptions: Parameters<typeof browser.newContext>[0] = {
      userAgent: uaProfile.ua,
      viewport,
      locale: "ar-SA",
      timezoneId: "Asia/Riyadh",
      extraHTTPHeaders: {
        "Accept-Language": uaProfile.acceptLanguage,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        ...options.headers,
      },
    };

    if (proxy.playwrightProxy) {
      contextOptions.proxy = proxy.playwrightProxy;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // Inject NEXUS fingerprint hardening — covers 200+ detection signals
    if (stealth) {
      await hardenPage(page, uaProfile);
    }

    // Block heavy resources we don't need
    await page.route("**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,otf,mp4,mp3,avi}", route => route.abort());
    await page.route("**/analytics*", route => route.abort());
    await page.route("**/tracking*", route => route.abort());
    await page.route("**/ads*", route => route.abort());

    // Session warm-up for stealth mode: visit benign pages before the target
    if (stealth) {
      await lightJitter(500, 1500);
      try {
        const targetHost = new URL(url).hostname;
        await warmUpSession(page, targetHost, 2);
      } catch { /* non-fatal */ }
    }

    let statusCode: number | undefined;
    page.on("response", resp => {
      if (resp.url() === url || resp.url() === url + "/") statusCode = resp.status();
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: options.timeoutMs ?? 20000 });

    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 5000 }).catch(() => { /* ignore */ });
    }

    if (options.scrollToBottom) {
      await page.evaluate(async () => {
        await new Promise<void>(resolve => {
          let totalHeight = 0;
          const distance = 400;
          const timer = setInterval(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).scrollBy(0, distance);
            totalHeight += distance;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const bodyHeight = (globalThis as any).document.body.scrollHeight as number;
            if (totalHeight >= bodyHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 200);
        });
      });
      await page.waitForTimeout(1500);
    }

    if (stealth) {
      // NEXUS: realistic human behaviour — mouse movement + natural scroll
      await simulateMouseMovement(page);
      await simulateScroll(page);
      await lightJitter(300, 800);
    }

    const html = await page.content();
    const title = await page.title();
    const text = cleanText(html);
    const emails = extractEmails(text + html);
    const phones = extractPhones(text + html);
    const links = extractLinks(html, url);
    const meta = extractMeta(html);
    const blocked = isBlocked(html, statusCode);

    // Use BS4 for Arabic-heavy pages
    let finalText = text;
    if (hasArabicText(text)) {
      const bs4Result = await extractWithBS4(html, url);
      if (bs4Result?.text && bs4Result.text.length > finalText.length) {
        finalText = bs4Result.text;
        emails.push(...(bs4Result.emails || []));
        phones.push(...(bs4Result.phones || []));
      }
    }

    return {
      url, html, text: finalText, title, emails: [...new Set(emails)],
      phones: [...new Set(phones)], links, meta,
      engine: stealth ? "playwright-stealth" : "playwright",
      statusCode, loadTimeMs: Date.now() - start,
      hasArabic: hasArabicText(finalText), charCount: finalText.length, blocked,
    };
  } catch (e) {
    return {
      url, html: "", text: "", title: "", emails: [], phones: [], links: [], meta: {},
      engine: stealth ? "playwright-stealth" : "playwright",
      loadTimeMs: Date.now() - start, hasArabic: false, charCount: 0,
      blocked: false, error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    if (browser) await browser.close().catch(() => { /* ignore */ });
  }
}

// ── Layer 3: BeautifulSoup standalone (for when we have raw HTML but want better parsing) ──

async function enhanceWithBS4(result: ScrapeResult, baseUrl: string): Promise<ScrapeResult> {
  if (!result.html) return result;
  const bs4 = await extractWithBS4(result.html, baseUrl);
  if (!bs4) return result;
  return {
    ...result,
    text: bs4.text.length > result.text.length ? bs4.text : result.text,
    emails: [...new Set([...result.emails, ...bs4.emails])],
    phones: [...new Set([...result.phones, ...bs4.phones])],
    links: [...new Set([...result.links, ...bs4.links])],
    meta: { ...bs4.meta, ...result.meta },
    hasArabic: bs4.hasArabic || result.hasArabic,
  };
}

// ── Main: scrapePage — auto-escalating engine selection ──────────────────────

export async function scrapePage(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
  const minLen = options.minContentLength ?? 400;
  const engines = options.forceEngine
    ? [options.forceEngine]
    : (options.engines ?? ["cheerio", "playwright", "playwright-stealth"]);

  for (const engine of engines) {
    let result: ScrapeResult;

    if (engine === "cheerio") {
      result = await scrapeWithCheerio(url, options);
    } else if (engine === "playwright") {
      result = await scrapeWithPlaywright(url, options, false);
    } else if (engine === "playwright-stealth") {
      result = await scrapeWithPlaywright(url, options, true);
    } else {
      // beautifulsoup standalone — needs existing HTML
      continue;
    }

    // Check if we got useful content
    const useful = !result.blocked && !result.error && result.charCount >= minLen;
    if (useful) {
      // Enhance with BS4 if Arabic content detected
      if (result.hasArabic || options.engines?.includes("beautifulsoup")) {
        return await enhanceWithBS4(result, url);
      }
      return result;
    }

    if (result.error) {
      console.warn(`[PowerScraper] ${engine} failed for ${url}: ${result.error}`);
    } else if (result.blocked) {
      console.warn(`[PowerScraper] ${engine} was blocked on ${url} — escalating`);
    } else {
      console.warn(`[PowerScraper] ${engine} got thin content (${result.charCount} chars) for ${url} — escalating`);
    }
  }

  // §6 Layer 3.5 — Camoufox engine-level stealth, only when enabled + installed.
  // Last resort before giving up; returns null cleanly when unavailable.
  try {
    const { camoufoxAvailable, camoufoxFetch } = await import("./scrapers/camoufox-runner.js");
    if (camoufoxAvailable()) {
      const html = await camoufoxFetch(url);
      if (html && html.length >= minLen) {
        const { load } = await import("cheerio");
        const $ = load(html);
        const text = $("body").text().replace(/\s+/g, " ").trim();
        return {
          url, engine: "playwright-stealth" as ScrapingEngine, html, text,
          title: $("title").text() || "",
          emails: [], phones: [], links: [], meta: {},
          loadTimeMs: 0, charCount: text.length, blocked: false,
          hasArabic: /[؀-ۿ]/.test(text),
        } as ScrapeResult;
      }
    }
  } catch { /* camoufox unavailable — fall through */ }

  // All engines failed — return best effort from last attempt
  return await scrapeWithCheerio(url, options);
}

// ── Main: crawlSite — multi-page BFS with pagination ─────────────────────────

export async function crawlSite(rootUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const {
    maxPages = 20,
    maxDepth = 3,
    followPagination = true,
    scrollInfinite = false,
    urlFilter,
    timeoutMs = 20000,
    scrapeOptions = {},
  } = options;

  const start = Date.now();
  const visited = new Set<string>();
  const errors: string[] = [];
  const pages: CrawlPage[] = [];
  const engineUsage: Partial<Record<ScrapingEngine, number>> = {};

  // Priority queue item: [priority, url, depth]
  type QueueItem = { priority: number; url: string; depth: number };
  const queue: QueueItem[] = [{ priority: 10, url: rootUrl, depth: 0 }];

  const enqueue = (url: string, depth: number, html: string) => {
    if (visited.has(url) || queue.some(q => q.url === url)) return;
    if (urlFilter && !urlFilter.test(url)) return;
    try { new URL(url); } catch { return; }
    const pageType = classifyPageType(url, extractTitle(html));
    const priority = PAGE_TYPE_PRIORITY[pageType] ?? 1;
    queue.push({ priority, url, depth });
    queue.sort((a, b) => b.priority - a.priority);
  };

  let paginationFollowed = 0;

  while (queue.length > 0 && pages.length < maxPages) {
    const item = queue.shift()!;
    const { url, depth } = item;

    if (visited.has(url)) continue;
    visited.add(url);

    // Only follow same-domain links
    try {
      const rootHost = new URL(rootUrl).hostname;
      const pageHost = new URL(url).hostname;
      if (pageHost !== rootHost) continue;
    } catch { continue; }

    console.log(`[PowerScraper] Crawling [${pages.length + 1}/${maxPages}] depth=${depth}: ${url}`);

    const result = await scrapePage(url, {
      ...scrapeOptions,
      timeoutMs,
      scrollToBottom: scrollInfinite,
    });

    if (result.error) {
      errors.push(`${url}: ${result.error}`);
      continue;
    }

    const pageType = classifyPageType(url, result.title, result.text);
    const paginatedUrls = followPagination ? detectPaginationUrls(result.html, url) : [];

    // Track engine usage
    engineUsage[result.engine] = (engineUsage[result.engine] || 0) + 1;

    pages.push({
      url,
      depth,
      pageType,
      title: result.title,
      text: result.text,
      html: result.html,
      emails: result.emails,
      phones: result.phones,
      links: result.links,
      meta: result.meta,
      engine: result.engine,
      paginatedUrls,
      hasArabic: result.hasArabic,
    });

    // Enqueue internal links for BFS
    if (depth < maxDepth) {
      for (const link of result.links) {
        enqueue(link, depth + 1, result.html);
      }
    }

    // Follow pagination
    if (followPagination && paginatedUrls.length > 0 && pages.length < maxPages) {
      for (const pagUrl of paginatedUrls.slice(0, 5)) {
        if (!visited.has(pagUrl)) {
          queue.unshift({ priority: 8, url: pagUrl, depth });
          paginationFollowed++;
        }
      }
    }

    // Small delay between pages to be a good citizen
    await randomDelay(300, 800);
  }

  const allEmails = [...new Set(pages.flatMap(p => p.emails))];
  const allPhones = [...new Set(pages.flatMap(p => p.phones))];
  const allLinks  = [...new Set(pages.flatMap(p => p.links))];

  return {
    rootUrl,
    pages,
    allEmails,
    allPhones,
    allLinks,
    pagesAnalyzed: pages.length,
    engineUsage,
    paginationFollowed,
    durationMs: Date.now() - start,
    errors,
  };
}
