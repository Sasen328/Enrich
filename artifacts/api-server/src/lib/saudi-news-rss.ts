// ─── Saudi Arabic Business-News RSS Aggregator ────────────────────────────────
// Pulls the major Saudi Arabic news feeds (Maal, Mubasher, Al Eqtisadiah) and
// returns hits filtered by company-name match. Used as an additional source
// in signal-engine.scanCompanySignals.
//
// All feeds are public RSS / Atom — no key. Each is parsed with the same
// cheerio-XML pass as google-news-scraper.

import axios from "axios";
import * as cheerio from "cheerio";

export interface SaudiNewsHit {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  snippet?: string;
  lang: "ar" | "en";
}

const DEFAULT_UA =
  process.env.FREE_SEARCH_USER_AGENT ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface FeedSpec {
  url: string;
  source: string;
  lang: "ar" | "en";
}

// Canonical Saudi business feeds. Each URL is the publisher's official RSS.
const FEEDS: FeedSpec[] = [
  { url: "https://www.maaal.com/feed", source: "Maal", lang: "ar" },
  { url: "https://www.mubasher.info/rss/news", source: "Mubasher", lang: "ar" },
  { url: "https://www.aleqt.com/rss.xml", source: "Al Eqtisadiah", lang: "ar" },
  // Wire Argaam / Arab News here too so a single helper covers them — the
  // lead-factory engine has its own per-source paths for discovery purposes.
  { url: "https://www.argaam.com/ar/rss/latest-news.aspx", source: "Argaam", lang: "ar" },
  { url: "https://www.argaam.com/en/rss/latest-news.aspx", source: "Argaam (EN)", lang: "en" },
  { url: "https://www.arabnews.com/rss.xml", source: "Arab News", lang: "en" },
];

async function parseFeed(spec: FeedSpec, limit: number): Promise<SaudiNewsHit[]> {
  try {
    const r = await axios.get<string>(spec.url, {
      headers: { "User-Agent": DEFAULT_UA, Accept: "application/rss+xml,application/xml,text/xml" },
      timeout: 12000,
      responseType: "text",
      validateStatus: (s) => s < 500,
    });
    if (r.status >= 400) return [];
    const $ = cheerio.load(r.data, { xmlMode: true });
    const hits: SaudiNewsHit[] = [];
    $("item, entry").each((_, el) => {
      if (hits.length >= limit) return;
      const node = $(el);
      const title = node.find("title").first().text().trim();
      const link = node.find("link").first().text().trim() || node.find("link").first().attr("href") || "";
      const pub = node.find("pubDate, updated, published").first().text().trim();
      const desc = node.find("description, summary, content").first().text().trim().replace(/<[^>]+>/g, "");
      if (title && link) {
        hits.push({
          title,
          url: link,
          source: spec.source,
          publishedAt: pub ? new Date(pub).toISOString() : undefined,
          snippet: desc.slice(0, 280),
          lang: spec.lang,
        });
      }
    });
    return hits;
  } catch {
    return [];
  }
}

/** Pull latest items from every Saudi feed in parallel. */
export async function fetchSaudiNewsLatest(limit = 40): Promise<SaudiNewsHit[]> {
  const perFeed = Math.max(5, Math.ceil(limit / FEEDS.length));
  const settled = await Promise.allSettled(FEEDS.map((f) => parseFeed(f, perFeed)));
  const all: SaudiNewsHit[] = [];
  for (const s of settled) if (s.status === "fulfilled") all.push(...s.value);
  // De-dupe by URL
  const seen = new Set<string>();
  const uniq: SaudiNewsHit[] = [];
  for (const h of all) {
    if (seen.has(h.url)) continue;
    seen.add(h.url);
    uniq.push(h);
  }
  return uniq.slice(0, limit);
}

/** Match hits whose title or snippet contains the company name (EN or AR). */
export async function fetchSaudiNewsForCompany(
  companyName: string,
  companyNameAr?: string,
  opts: { limit?: number; windowDays?: number } = {},
): Promise<SaudiNewsHit[]> {
  const limit = opts.limit ?? 30;
  const cutoff = opts.windowDays ? Date.now() - opts.windowDays * 86400_000 : 0;
  const items = await fetchSaudiNewsLatest(200);
  const en = companyName.toLowerCase();
  const ar = companyNameAr?.normalize("NFKC");
  const match = (hit: SaudiNewsHit): boolean => {
    const blob = `${hit.title} ${hit.snippet || ""}`;
    if (blob.toLowerCase().includes(en)) return true;
    if (ar && blob.includes(ar)) return true;
    return false;
  };
  return items
    .filter((h) => match(h) && (!cutoff || !h.publishedAt || new Date(h.publishedAt).getTime() >= cutoff))
    .slice(0, limit);
}
