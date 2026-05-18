// ─── Google News Scraper ──────────────────────────────────────────────────────
// Pulls headlines from news.google.com RSS endpoint — no API key, no rate limit
// (within reason). Used by signal-engine as an additional news source alongside
// Tavily and the existing RSS readers (Arab News, Argaam).
//
// RSS endpoint pattern (public, documented):
//   https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en
//
// Filtering options: site:domain.com inurl:term "exact phrase" OR keyword.

import axios from "axios";
import * as cheerio from "cheerio";

export interface NewsHit {
  title: string;
  url: string;
  source: string;
  publishedAt?: string; // ISO 8601
  snippet?: string;
}

const DEFAULT_UA =
  process.env.FREE_SEARCH_USER_AGENT ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Fetch news headlines for a query via Google News RSS.
 *
 * @param query   Search string. Supports Google search operators
 *                (site:, inurl:, "exact phrase", OR).
 * @param opts.hl Display language (default "en")
 * @param opts.gl Country code for ranking (default "SA" for Saudi)
 * @param opts.limit Max hits returned (default 20)
 */
export async function googleNewsSearch(
  query: string,
  opts: { hl?: string; gl?: string; limit?: number } = {},
): Promise<NewsHit[]> {
  const hl = opts.hl ?? "en";
  const gl = opts.gl ?? "SA";
  const limit = opts.limit ?? 20;
  const ceid = `${gl}:${hl}`;

  try {
    const r = await axios.get("https://news.google.com/rss/search", {
      params: { q: query, hl: `${hl}-${gl}`, gl, ceid },
      headers: { "User-Agent": DEFAULT_UA, Accept: "application/rss+xml,application/xml" },
      timeout: 15000,
      responseType: "text",
    });

    const $ = cheerio.load(r.data, { xmlMode: true });
    const hits: NewsHit[] = [];
    $("item").each((_, el) => {
      if (hits.length >= limit) return;
      const node = $(el);
      const title = node.find("title").first().text().trim();
      const link = node.find("link").first().text().trim();
      const pubDate = node.find("pubDate").first().text().trim();
      const sourceName = node.find("source").first().text().trim();
      const description = node.find("description").first().text().trim();
      // The description is HTML — pull out the first <a> text as snippet
      const snippet = description.replace(/<[^>]+>/g, "").slice(0, 280).trim();

      if (title && link) {
        hits.push({
          title,
          url: link,
          source: sourceName || "Google News",
          publishedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
          snippet,
        });
      }
    });
    return hits;
  } catch {
    return [];
  }
}

/** Quick helper: news about a specific company in the Saudi market. */
export function googleNewsForCompany(company: string, opts: { limit?: number } = {}): Promise<NewsHit[]> {
  // Bias toward Saudi-relevant outlets and recent results
  const q = `"${company}" (Saudi OR KSA OR Riyadh OR Jeddah OR Dammam) when:30d`;
  return googleNewsSearch(q, { gl: "SA", limit: opts.limit ?? 20 });
}
