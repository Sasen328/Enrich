import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  linkStyle: "inlined",
});

turndown.remove(["script", "style", "noscript", "iframe", "nav", "footer", "header", "aside"]);

export interface CrawlResult {
  url: string;
  success: boolean;
  markdown: string;
  text: string;
  extractedText: string;
  title: string;
  links: string[];
  emails: string[];
  phones: string[];
  tables: string[];
  headings: string[];
  images: string[];
  metadata: {
    wordCount: number;
    crawledAt: string;
  };
}

export interface CrawlOptions {
  waitMs?: number;
  concurrency?: number;
}

function extractEmails(text: string): string[] {
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  return [...new Set(matches || [])];
}

function extractPhones(text: string): string[] {
  const matches = text.match(/(?:\+?\d{1,4}[\s.-]?)?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}/g);
  return [...new Set((matches || []).filter(p => p.replace(/\D/g, '').length >= 7))];
}

// ── Browser availability check (run once at module load) ────────────────────
let _browserAvailable: boolean | null = null;

async function isBrowserAvailable(): Promise<boolean> {
  if (_browserAvailable !== null) return _browserAvailable;
  try {
    const { chromium } = await import("playwright");
    const execPath = chromium.executablePath();
    const { existsSync } = await import("fs");
    _browserAvailable = existsSync(execPath);
    if (!_browserAvailable) {
      console.warn(`[crawl4ai] Chromium not found at ${execPath} — browser crawling disabled. HTTP fallback will be used.`);
    } else {
      console.log(`[crawl4ai] Chromium available at ${execPath}`);
    }
  } catch {
    _browserAvailable = false;
    console.warn("[crawl4ai] Playwright not loadable — browser crawling disabled. HTTP fallback will be used.");
  }
  return _browserAvailable;
}

// Kick off the check immediately (non-blocking)
isBrowserAvailable().catch(() => { _browserAvailable = false; });

export async function crawl4ai(url: string, options?: CrawlOptions): Promise<CrawlResult | null> {
  // Skip immediately if browser is unavailable — no timeout wasted
  const available = await isBrowserAvailable();
  if (!available) return null;

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(options?.waitMs || 2000);

      const html = await page.content();
      const title = await page.title();

      const text = await page.evaluate(`
        (function() {
          document.querySelectorAll("script, style, noscript, svg, iframe, nav, footer, header, aside").forEach(function(el) { el.remove(); });
          var main = document.querySelector("main, [role='main'], article, .content, #content, .main-content");
          return (main || document.body) ? (main || document.body).innerText : "";
        })()
      `) as string;

      const links = await page.evaluate(`
        (function() {
          return Array.from(document.querySelectorAll("a[href]"))
            .map(function(a) { return a.getAttribute("href") || ""; })
            .filter(function(href) { return href.startsWith("http"); });
        })()
      `) as string[];

      const headings = await page.evaluate(`
        (function() {
          return Array.from(document.querySelectorAll("h1, h2, h3, h4"))
            .map(function(h) { return h.textContent || ""; })
            .filter(function(t) { return t.trim().length > 0; });
        })()
      `) as string[];

      const tables = await page.evaluate(`
        (function() {
          return Array.from(document.querySelectorAll("table"))
            .map(function(t) { return t.outerHTML || ""; })
            .filter(function(h) { return h.length > 0; });
        })()
      `) as string[];

      const images = await page.evaluate(`
        (function() {
          return Array.from(document.querySelectorAll("img[src]"))
            .map(function(img) { return img.getAttribute("src") || ""; })
            .filter(function(src) { return src.startsWith("http") && !src.includes("data:"); })
            .slice(0, 50);
        })()
      `) as string[];

      const mainHtml = await page.evaluate(`
        (function() {
          document.querySelectorAll("script, style, noscript, svg, iframe, nav, footer, header, aside").forEach(function(el) { el.remove(); });
          var main = document.querySelector("main, [role='main'], article, .content, #content, .main-content");
          return (main || document.body) ? (main || document.body).innerHTML : "";
        })()
      `) as string;

      const markdown = turndown.turndown(mainHtml || html);
      const cleanText = (text || "").substring(0, 50000);
      const emails = extractEmails(cleanText + " " + html);
      const phones = extractPhones(cleanText);

      await context.close();

      return {
        url,
        success: true,
        markdown: markdown.substring(0, 50000),
        text: cleanText,
        extractedText: cleanText,
        title,
        links: (links || []).slice(0, 200),
        emails,
        phones,
        tables: (tables || []).slice(0, 20),
        headings: (headings || []).slice(0, 50),
        images: (images || []).slice(0, 50),
        metadata: {
          wordCount: cleanText.split(/\s+/).length,
          crawledAt: new Date().toISOString(),
        },
      };
    } finally {
      await browser.close();
    }
  } catch (err) {
    const msg = (err as Error).message || "";
    // If browser executable disappeared or failed to launch, mark unavailable
    if (msg.includes("Executable doesn't exist") || msg.includes("browserType.launch")) {
      _browserAvailable = false;
      console.warn("[crawl4ai] Browser launch failed — disabling for this session. HTTP fallback will be used.");
    } else {
      console.log(`[crawl4ai] Failed to crawl ${url}: ${msg.substring(0, 80)}`);
    }
    return null;
  }
}

export async function crawl4aiBatch(
  urls: string[],
  options?: CrawlOptions,
): Promise<Array<CrawlResult | null>> {
  const concurrency = options?.concurrency || 3;
  const results: Array<CrawlResult | null> = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((url) => crawl4ai(url, options))
    );
    results.push(...batchResults.map((r) => (r.status === "fulfilled" ? r.value : null)));
  }

  return results;
}
