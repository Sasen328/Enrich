// ─── Sanctions Screening (free, no key) ──────────────────────────────────────
// Pulls and caches the free public consolidated sanctions lists:
//   • OFAC SDN consolidated XML
//   • UN Security Council consolidated XML
//   • EU consolidated XML
//
// Used by signal-engine as a fast, local, key-free fallback when the
// scoutSignalsSanctions sidecar isn't reachable. Refreshes daily.
//
// Each entity in the lists has many aliases. We index by lowercased
// alias and match by exact + substring + token-set overlap.

import axios from "axios";

interface SanctionEntry {
  name: string;
  aliases: string[];
  type: "individual" | "entity";
  source: "OFAC" | "UN" | "EU";
  sanctionDate?: string;
  reason?: string;
}

interface MatchResult {
  matched: boolean;
  source?: "OFAC" | "UN" | "EU";
  entry?: SanctionEntry;
  score: number; // 0..1
}

const REFRESH_MS = 1000 * 60 * 60 * 24; // daily
let cache: SanctionEntry[] = [];
let cacheTs = 0;
let refreshing: Promise<void> | null = null;

// ── Loaders ──────────────────────────────────────────────────────────────────

async function loadOfac(): Promise<SanctionEntry[]> {
  try {
    const url = "https://www.treasury.gov/ofac/downloads/sdn.xml";
    const r = await axios.get<string>(url, { timeout: 30000, responseType: "text" });
    const entries: SanctionEntry[] = [];
    // SDN XML schema: <sdnEntry><sdnType>Individual|Entity</sdnType><firstName/>...
    // We use a regex extractor — fully-correct XML parsing is overkill for the
    // limited shape we read.
    const blocks = r.data.split(/<sdnEntry>/).slice(1);
    for (const b of blocks) {
      const close = b.indexOf("</sdnEntry>");
      const seg = close > 0 ? b.slice(0, close) : b;
      const first = /<firstName>([^<]+)<\/firstName>/.exec(seg)?.[1] || "";
      const last = /<lastName>([^<]+)<\/lastName>/.exec(seg)?.[1] || "";
      const fullName = `${first} ${last}`.trim() || /<n>([^<]+)<\/n>/.exec(seg)?.[1] || "";
      const sdnType = (/<sdnType>([^<]+)<\/sdnType>/.exec(seg)?.[1] || "Entity").toLowerCase();
      if (!fullName) continue;
      const aliasMatches = [...seg.matchAll(/<aka>[\s\S]*?<lastName>([^<]+)<\/lastName>/g)];
      const aliases = aliasMatches.map((m) => m[1]).filter(Boolean);
      entries.push({
        name: fullName,
        aliases,
        type: sdnType.startsWith("indiv") ? "individual" : "entity",
        source: "OFAC",
      });
    }
    return entries;
  } catch {
    return [];
  }
}

async function loadUn(): Promise<SanctionEntry[]> {
  try {
    const url = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";
    const r = await axios.get<string>(url, { timeout: 30000, responseType: "text" });
    const entries: SanctionEntry[] = [];
    const indiv = r.data.split(/<INDIVIDUAL>/).slice(1);
    for (const b of indiv) {
      const seg = b.slice(0, b.indexOf("</INDIVIDUAL>"));
      const first = /<FIRST_NAME>([^<]+)<\/FIRST_NAME>/.exec(seg)?.[1] || "";
      const second = /<SECOND_NAME>([^<]+)<\/SECOND_NAME>/.exec(seg)?.[1] || "";
      const third = /<THIRD_NAME>([^<]+)<\/THIRD_NAME>/.exec(seg)?.[1] || "";
      const name = [first, second, third].filter(Boolean).join(" ").trim();
      if (!name) continue;
      const aliasMatches = [...seg.matchAll(/<INDIVIDUAL_ALIAS>[\s\S]*?<ALIAS_NAME>([^<]+)<\/ALIAS_NAME>/g)];
      entries.push({
        name,
        aliases: aliasMatches.map((m) => m[1]).filter(Boolean),
        type: "individual",
        source: "UN",
      });
    }
    const ents = r.data.split(/<ENTITY>/).slice(1);
    for (const b of ents) {
      const seg = b.slice(0, b.indexOf("</ENTITY>"));
      const first = /<FIRST_NAME>([^<]+)<\/FIRST_NAME>/.exec(seg)?.[1] || "";
      if (!first) continue;
      const aliasMatches = [...seg.matchAll(/<ENTITY_ALIAS>[\s\S]*?<ALIAS_NAME>([^<]+)<\/ALIAS_NAME>/g)];
      entries.push({
        name: first,
        aliases: aliasMatches.map((m) => m[1]).filter(Boolean),
        type: "entity",
        source: "UN",
      });
    }
    return entries;
  } catch {
    return [];
  }
}

async function loadEu(): Promise<SanctionEntry[]> {
  try {
    // Public EU consolidated file (one of the canonical mirrors).
    const url = "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw";
    const r = await axios.get<string>(url, { timeout: 30000, responseType: "text", validateStatus: (s) => s < 600 });
    if (r.status >= 400) return [];
    const entries: SanctionEntry[] = [];
    const blocks = r.data.split(/<sanctionEntity[^>]*>/i).slice(1);
    for (const b of blocks) {
      const seg = b.slice(0, b.indexOf("</sanctionEntity>"));
      const names = [...seg.matchAll(/<nameAlias[^>]*\bwholeName="([^"]+)"/g)].map((m) => m[1]);
      if (names.length === 0) continue;
      const subjectType = (/<subjectType[^>]*\bcode="([^"]+)"/.exec(seg)?.[1] || "P").toUpperCase();
      entries.push({
        name: names[0],
        aliases: names.slice(1),
        type: subjectType.startsWith("E") ? "entity" : "individual",
        source: "EU",
      });
    }
    return entries;
  } catch {
    return [];
  }
}

async function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const [ofac, un, eu] = await Promise.all([loadOfac(), loadUn(), loadEu()]);
    cache = [...ofac, ...un, ...eu];
    cacheTs = Date.now();
  })();
  try { await refreshing; } finally { refreshing = null; }
}

async function ensureLoaded(): Promise<void> {
  if (cache.length > 0 && Date.now() - cacheTs < REFRESH_MS) return;
  await refresh();
}

// ── Matching ────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter((t) => t.length >= 3));
  const tb = new Set(b.split(" ").filter((t) => t.length >= 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n / Math.min(ta.size, tb.size);
}

/** Screen a single entity name against the consolidated lists. Returns the
 *  best match across sources. Triggers a background refresh on first call. */
export async function screenSanctions(name: string, aliases: string[] = []): Promise<MatchResult> {
  await ensureLoaded();
  const candidates = [name, ...aliases].map(normalize).filter(Boolean);
  if (candidates.length === 0 || cache.length === 0) return { matched: false, score: 0 };

  let best: MatchResult = { matched: false, score: 0 };
  for (const entry of cache) {
    const names = [entry.name, ...entry.aliases].map(normalize).filter(Boolean);
    for (const cand of candidates) {
      for (const en of names) {
        // Exact match
        if (cand === en) {
          return { matched: true, source: entry.source, entry, score: 1 };
        }
        // Substring containment (one side fully inside the other)
        if (en.length >= 6 && (cand.includes(en) || en.includes(cand))) {
          if (best.score < 0.85) best = { matched: true, source: entry.source, entry, score: 0.85 };
        }
        // Token overlap
        const ov = tokenOverlap(cand, en);
        if (ov >= 0.75 && ov > best.score) {
          best = { matched: true, source: entry.source, entry, score: ov };
        }
      }
    }
  }
  return best;
}

/** Status helper for routes / health checks. */
export function getSanctionsCacheStats(): { entries: number; ageMs: number } {
  return { entries: cache.length, ageMs: cacheTs ? Date.now() - cacheTs : -1 };
}
