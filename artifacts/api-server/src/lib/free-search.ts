// ─── Free Web Search Client ───────────────────────────────────────────────────
// Zero-cost discovery: SearXNG (self-hosted or public instance) and Google's
// HTML search results page. Used as a Perplexity fallback in Lead Factory and
// anywhere else discovery is needed without a paid API key.
//
// Env:
//   SEARXNG_URL              Single SearXNG endpoint (e.g. https://searx.be)
//   SEARXNG_INSTANCES        Comma-separated fallback list (rotates on 429/5xx)
//   FREE_SEARCH_USER_AGENT   Override the default UA (recommended for Google)

import axios from "axios";
import * as cheerio from "cheerio";

export interface FreeSearchHit {
  title: string;
  url: string;
  snippet: string;
  source: "searxng" | "google";
}

const DEFAULT_UA =
  process.env.FREE_SEARCH_USER_AGENT ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function getSearxngEndpoints(): string[] {
  const list = (process.env.SEARXNG_INSTANCES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (process.env.SEARXNG_URL) list.unshift(process.env.SEARXNG_URL);
  return Array.from(new Set(list));
}

// ── SearXNG ────────────────────────────────────────────────────────────────────
// Public JSON API: GET {base}/search?q=...&format=json&categories=general
// Rotates through configured instances on failure. Returns [] if all fail.
export async function searxngSearch(
  query: string,
  opts: { limit?: number; safesearch?: 0 | 1 | 2 } = {},
): Promise<FreeSearchHit[]> {
  const limit = opts.limit ?? 10;
  const safesearch = opts.safesearch ?? 1;
  const endpoints = getSearxngEndpoints();
  if (endpoints.length === 0) return [];

  for (const base of endpoints) {
    try {
      const url = `${base.replace(/\/$/, "")}/search`;
      const r = await axios.get(url, {
        params: { q: query, format: "json", safesearch, categories: "general" },
        headers: { "User-Agent": DEFAULT_UA, Accept: "application/json" },
        timeout: 15000,
      });
      const results = Array.isArray(r.data?.results) ? r.data.results : [];
      return results.slice(0, limit).map((row: { title?: string; url?: string; content?: string }) => ({
        title: row.title || "",
        url: row.url || "",
        snippet: row.content || "",
        source: "searxng" as const,
      }));
    } catch {
      /* try next endpoint */
    }
  }
  return [];
}

// ── Google HTML scraper ───────────────────────────────────────────────────────
// Last-resort free path. Parses the HTML results page; selectors break
// periodically — use SearXNG first whenever possible.
export async function googleHtmlSearch(
  query: string,
  opts: { limit?: number; hl?: string; gl?: string } = {},
): Promise<FreeSearchHit[]> {
  const limit = opts.limit ?? 10;
  const hl = opts.hl ?? "en";
  const gl = opts.gl ?? "sa";
  try {
    const r = await axios.get("https://www.google.com/search", {
      params: { q: query, num: Math.min(limit, 20), hl, gl, pws: 0 },
      headers: {
        "User-Agent": DEFAULT_UA,
        "Accept-Language": `${hl},en;q=0.8`,
        Accept: "text/html,application/xhtml+xml",
      },
      timeout: 15000,
    });

    const $ = cheerio.load(r.data);
    const hits: FreeSearchHit[] = [];
    $("div.g, div.tF2Cxc, div[data-hveid]").each((_, el) => {
      if (hits.length >= limit) return;
      const node = $(el);
      const a = node.find("a[href^='http']").first();
      const url = a.attr("href") || "";
      const title = node.find("h3").first().text().trim();
      const snippet = node.find("div[role='heading'] + div, div.VwiC3b, span.aCOpRe").first().text().trim();
      if (url && title) hits.push({ title, url, snippet, source: "google" });
    });
    return hits;
  } catch {
    return [];
  }
}

// ── Combined: prefer SearXNG, fall back to Google ────────────────────────────
export async function freeWebSearch(
  query: string,
  opts: { limit?: number } = {},
): Promise<FreeSearchHit[]> {
  const sx = await searxngSearch(query, opts);
  if (sx.length > 0) return sx;
  return googleHtmlSearch(query, opts);
}

/** True when at least one free search path is reachable (SearXNG configured
 *  or Google HTML is allowed to be hit). Google is always available as a
 *  best-effort fallback, so this returns true unconditionally — callers can
 *  still gate on SearXNG availability via `getSearxngEndpoints().length > 0`. */
export function isFreeSearchEnabled(): boolean {
  return true;
}
