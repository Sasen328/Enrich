// ─── Unified Harvester Engine (façade) ───────────────────────────────────────
//
// One entry point for every engine that needs to source rows from external
// sources. Internally fans out across the existing harvester modules in
// priority order, dedupes by domain/cr/email/phone, and streams results.
//
// Engines should call this instead of importing individual scrapers:
//
//   import { harvest } from "@/lib/harvester";
//   for await (const row of harvest({ scope: "saudi", maxCost: "free", query })) {
//     // ... do something with row
//   }
//
// This is Option A from the proposal: lightweight wrapper, additive only.
// No existing harvester is removed or refactored. Engines can migrate to
// the façade incrementally.

import { freeWebSearch, type FreeSearchHit } from "../free-search.js";
import { googleNewsForCompany, type NewsHit } from "../google-news-scraper.js";
import { fetchSaudiNewsForCompany, type SaudiNewsHit } from "../saudi-news-rss.js";
import { screenSanctions } from "../sanctions-screen.js";
import { lookupGleif, lookupOpenCorporates, lookupWikidata } from "../free-sources.js";
import { scoutSiteIntel, scoutOsintHarvest, isScoutAlive } from "../scout-client.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HarvestQuery {
  /** Free-text query passed to web-search / news harvesters. */
  query: string;
  /** Optional company name for targeted news / sanctions checks. */
  companyName?: string;
  /** Optional Arabic name for Saudi RSS matching. */
  companyNameAr?: string;
  /** Geo-scope. "saudi" → prefer SA-specific sources; "gcc" → broaden; "global" → no filter. */
  scope?: "saudi" | "gcc" | "global";
  /** Cost ceiling. "free" → never call paid APIs even if configured. */
  maxCost?: "free" | "any";
  /** Recency window in days (for news/signals). */
  windowDays?: number;
  /** Max rows per source. */
  perSourceLimit?: number;
  /** Specific harvesters to include (defaults: all enabled). */
  include?: HarvesterId[];
  /** Specific harvesters to skip. */
  exclude?: HarvesterId[];
  /** Optional anchored entity fields used by Scout / GLEIF / OpenCorporates. */
  entity?: HarvestQueryEntity;
}

export type HarvesterId =
  | "free_search"
  | "google_news"
  | "saudi_news"
  | "sanctions"
  | "gleif"
  | "opencorporates"
  | "wikidata"
  | "scout_site_intel"
  | "scout_osint";

export interface HarvestedRow {
  /** Stable id within a single run; not persisted. */
  id: string;
  /** Source harvester that produced it. */
  source: HarvesterId;
  /** Source label (publisher / domain) for display. */
  sourceLabel: string;
  /** Free-text title. */
  title: string;
  /** Free-text body / snippet. */
  snippet: string;
  /** URL to the original document. */
  url: string;
  /** ISO timestamp when known. */
  publishedAt?: string;
  /** When the harvester yields entity hints. */
  entity?: {
    name?: string;
    nameAr?: string;
    domain?: string;
    phone?: string;
    email?: string;
    crNumber?: string;
    city?: string;
    industry?: string;
  };
  /** Semantic category (lead / signal / sanctions / news). */
  category: "lead" | "signal" | "sanctions" | "news";
  /** Original record for callers that need the raw shape. */
  raw?: unknown;
}

// ── Internal: dedup key ──────────────────────────────────────────────────────

function dedupKey(row: HarvestedRow): string {
  return [
    row.url?.toLowerCase(),
    row.entity?.domain?.toLowerCase(),
    row.entity?.crNumber,
    row.entity?.email?.toLowerCase(),
    row.entity?.phone?.replace(/\D/g, ""),
  ].filter(Boolean).join("|") || row.title.toLowerCase();
}

// ── Internal: priority + enable check ────────────────────────────────────────

const PRIORITY: Record<HarvesterId, number> = {
  // Lower number = runs first. Registry / authoritative sources before
  // search / news so we anchor entity identity before we collect signals.
  gleif: 5,
  opencorporates: 6,
  wikidata: 7,
  free_search: 10,
  scout_site_intel: 15,
  scout_osint: 16,
  saudi_news: 20,
  google_news: 30,
  sanctions: 40,
};

/** Optional input fields for the entity-anchoring harvesters. */
export interface HarvestQueryEntity {
  /** Optional website domain — anchors Scout / Clearbit / Wappalyzer paths. */
  domain?: string;
}

function isEnabled(id: HarvesterId, q: HarvestQuery): boolean {
  if (q.exclude?.includes(id)) return false;
  if (q.include && !q.include.includes(id)) return false;
  return true;
}

// ── Streaming runner ─────────────────────────────────────────────────────────
//
// Yields rows as each harvester finishes. Failures from any one harvester are
// caught and logged via the optional onError hook, so a single broken source
// never breaks the whole run.

export async function* harvest(
  q: HarvestQuery,
  opts: { onError?: (id: HarvesterId, err: unknown) => void } = {},
): AsyncIterable<HarvestedRow> {
  const perSource = q.perSourceLimit ?? 10;
  const ids: HarvesterId[] = (Object.keys(PRIORITY) as HarvesterId[])
    .filter((id) => isEnabled(id, q))
    .sort((a, b) => PRIORITY[a] - PRIORITY[b]);

  const seen = new Set<string>();
  let counter = 0;
  const newId = () => `h${Date.now().toString(36)}-${counter++}`;

  const safeRun = async <T>(id: HarvesterId, fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); } catch (err) { opts.onError?.(id, err); return null; }
  };

  for (const id of ids) {
    switch (id) {
      case "free_search": {
        const hits = await safeRun(id, () => freeWebSearch(q.query, { limit: perSource }));
        for (const h of (hits as FreeSearchHit[] | null) ?? []) {
          const row: HarvestedRow = {
            id: newId(),
            source: id,
            sourceLabel: h.source,
            title: h.title,
            snippet: h.snippet,
            url: h.url,
            category: "lead",
            raw: h,
          };
          const key = dedupKey(row);
          if (seen.has(key)) continue;
          seen.add(key);
          yield row;
        }
        break;
      }

      case "saudi_news": {
        if (!q.companyName) break;
        const hits = await safeRun(id, () =>
          fetchSaudiNewsForCompany(q.companyName!, q.companyNameAr, {
            limit: perSource,
            windowDays: q.windowDays,
          }),
        );
        for (const h of (hits as SaudiNewsHit[] | null) ?? []) {
          const row: HarvestedRow = {
            id: newId(),
            source: id,
            sourceLabel: h.source,
            title: h.title,
            snippet: h.snippet ?? "",
            url: h.url,
            publishedAt: h.publishedAt,
            category: "news",
            raw: h,
          };
          const key = dedupKey(row);
          if (seen.has(key)) continue;
          seen.add(key);
          yield row;
        }
        break;
      }

      case "google_news": {
        if (!q.companyName) break;
        const hits = await safeRun(id, () => googleNewsForCompany(q.companyName!, { limit: perSource }));
        for (const h of (hits as NewsHit[] | null) ?? []) {
          const row: HarvestedRow = {
            id: newId(),
            source: id,
            sourceLabel: h.source,
            title: h.title,
            snippet: h.snippet ?? "",
            url: h.url,
            publishedAt: h.publishedAt,
            category: "news",
            raw: h,
          };
          const key = dedupKey(row);
          if (seen.has(key)) continue;
          seen.add(key);
          yield row;
        }
        break;
      }

      case "gleif": {
        if (!q.companyName) break;
        const r = await safeRun(id, () => lookupGleif(q.companyName!));
        if (r) {
          const row: HarvestedRow = {
            id: newId(),
            source: id,
            sourceLabel: "GLEIF",
            title: r.legalName,
            snippet: `LEI ${r.lei} · ${r.country}${r.legalForm ? " · " + r.legalForm : ""}`,
            url: `https://search.gleif.org/#/record/${r.lei}`,
            category: "lead",
            entity: { name: r.legalName },
            raw: r,
          };
          const key = dedupKey(row);
          if (!seen.has(key)) { seen.add(key); yield row; }
        }
        break;
      }

      case "opencorporates": {
        if (!q.companyName) break;
        const r = await safeRun(id, () => lookupOpenCorporates(q.companyName!));
        if (r) {
          const row: HarvestedRow = {
            id: newId(),
            source: id,
            sourceLabel: "OpenCorporates",
            title: r.name ?? q.companyName!,
            snippet: `CR ${r.crNumber ?? "—"} · ${r.jurisdiction ?? ""} · founded ${r.foundingYear ?? "?"}`,
            url: r.sourceUrl ?? "https://opencorporates.com",
            category: "lead",
            entity: { name: r.name, crNumber: r.crNumber },
            raw: r,
          };
          const key = dedupKey(row);
          if (!seen.has(key)) { seen.add(key); yield row; }
        }
        break;
      }

      case "wikidata": {
        if (!q.companyName) break;
        const r = await safeRun(id, () => lookupWikidata(q.companyName!));
        if (r) {
          const row: HarvestedRow = {
            id: newId(),
            source: id,
            sourceLabel: "Wikidata",
            title: q.companyName!,
            snippet: JSON.stringify(r).slice(0, 280),
            url: "https://www.wikidata.org",
            category: "lead",
            entity: { name: q.companyName },
            raw: r,
          };
          const key = dedupKey(row);
          if (!seen.has(key)) { seen.add(key); yield row; }
        }
        break;
      }

      case "scout_site_intel": {
        if (!q.entity?.domain) break;
        // Skip if the Scout sidecar is unreachable to avoid a slow timeout
        const alive = await safeRun(id, () => isScoutAlive());
        if (!alive) break;
        const r = await safeRun(id, () => scoutSiteIntel(q.entity!.domain!));
        if (r) {
          const row: HarvestedRow = {
            id: newId(),
            source: id,
            sourceLabel: "Scout · site-intel",
            title: q.entity!.domain!,
            snippet: JSON.stringify(r).slice(0, 280),
            url: `https://${q.entity!.domain}`,
            category: "lead",
            entity: { domain: q.entity!.domain! },
            raw: r,
          };
          const key = dedupKey(row);
          if (!seen.has(key)) { seen.add(key); yield row; }
        }
        break;
      }

      case "scout_osint": {
        if (!q.entity?.domain && !q.companyName) break;
        const alive = await safeRun(id, () => isScoutAlive());
        if (!alive) break;
        const r = await safeRun(id, () => scoutOsintHarvest(q.entity?.domain ?? q.companyName!));
        if (r) {
          const row: HarvestedRow = {
            id: newId(),
            source: id,
            sourceLabel: "Scout · OSINT",
            title: q.companyName ?? q.entity?.domain ?? "OSINT result",
            snippet: JSON.stringify(r).slice(0, 280),
            url: q.entity?.domain ? `https://${q.entity.domain}` : "",
            category: "lead",
            entity: { domain: q.entity?.domain, name: q.companyName },
            raw: r,
          };
          const key = dedupKey(row);
          if (!seen.has(key)) { seen.add(key); yield row; }
        }
        break;
      }

      case "sanctions": {
        if (!q.companyName) break;
        const match = await safeRun(id, () =>
          screenSanctions(q.companyName!, q.companyNameAr ? [q.companyNameAr] : []),
        );
        if (match?.matched && match.score >= 0.85) {
          const row: HarvestedRow = {
            id: newId(),
            source: id,
            sourceLabel: `${match.source} consolidated list`,
            title: `Sanctions match: ${match.entry?.name}`,
            snippet: `${q.companyName} matched ${match.source} list with score ${match.score.toFixed(2)}`,
            url:
              match.source === "OFAC"
                ? "https://sanctionssearch.ofac.treas.gov"
                : match.source === "UN"
                  ? "https://scsanctions.un.org"
                  : "https://data.europa.eu",
            category: "sanctions",
            entity: { name: q.companyName, nameAr: q.companyNameAr },
            raw: match,
          };
          const key = dedupKey(row);
          if (!seen.has(key)) {
            seen.add(key);
            yield row;
          }
        }
        break;
      }
    }
  }
}

/** Convenience: collect all rows into an array. Prefer the async iterator for
 *  streaming callers (e.g. SSE). */
export async function harvestAll(
  q: HarvestQuery,
  opts: { onError?: (id: HarvesterId, err: unknown) => void } = {},
): Promise<HarvestedRow[]> {
  const out: HarvestedRow[] = [];
  for await (const r of harvest(q, opts)) out.push(r);
  return out;
}
