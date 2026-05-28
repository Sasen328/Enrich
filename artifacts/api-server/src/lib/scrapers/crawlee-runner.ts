// §6 — Crawlee multi-page crawl runner.
// Optional dependency: only used when `crawlee` is installed AND
// CRAWLEE_ENABLED=true. Provides a robust queue-based crawler (auto-retry,
// concurrency, dedup) as an alternative to the built-in BFS crawler in
// power-scraper. Degrades to null when unavailable so callers can fall back.

export interface CrawleePage {
  url: string;
  title: string;
  text: string;
}

export function crawleeAvailable(): boolean {
  if (process.env.CRAWLEE_ENABLED !== "true") return false;
  try { require.resolve("crawlee"); return true; } catch { return false; }
}

/**
 * Crawl up to `maxPages` same-origin pages starting from `rootUrl` using
 * Crawlee's CheerioCrawler. Returns the collected pages, or null when Crawlee
 * is not installed/enabled so the caller escalates to the built-in crawler.
 */
export async function crawleeCrawl(
  rootUrl: string,
  opts: { maxPages?: number; timeoutMs?: number } = {},
): Promise<CrawleePage[] | null> {
  if (!crawleeAvailable()) return null;
  const maxPages = Math.min(Math.max(opts.maxPages ?? 20, 1), 200);
  try {
    const mod: any = await import("crawlee" as any).catch(() => null);
    if (!mod?.CheerioCrawler) return null;

    let origin = "";
    try { origin = new URL(rootUrl).origin; } catch { return null; }

    const pages: CrawleePage[] = [];
    const crawler = new mod.CheerioCrawler({
      maxRequestsPerCrawl: maxPages,
      requestHandlerTimeoutSecs: Math.round((opts.timeoutMs ?? 20000) / 1000),
      async requestHandler({ request, $, enqueueLinks }: any) {
        const text = $("body").text().replace(/\s+/g, " ").trim();
        pages.push({ url: request.url, title: $("title").text() || "", text });
        // Stay on the same origin; Crawlee dedups + respects maxRequestsPerCrawl.
        await enqueueLinks({ strategy: "same-origin", baseUrl: origin });
      },
    });

    await crawler.run([rootUrl]);
    return pages;
  } catch {
    return null;
  }
}
