/**
 * BluPages.com.sa scraper — API-first approach.
 *
 * The listing pages are JS-rendered, but BluPages exposes a proper JSON API:
 *   GET /api/companies?categoryId=X&cityId=Y&limit=24
 *   GET /api/categories   → all categories with company counts
 *   GET /api/cities       → all Saudi cities with IDs
 *
 * By iterating all category × city combos we can discover thousands of
 * unique companies.  For each discovered ID we also fetch the HTML profile
 * page which carries richer address / description / registration data.
 */

import axios from "axios";
import * as cheerio from "cheerio";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Accept-Language": "ar-SA,ar;q=0.9,en-US;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Cache-Control": "no-cache",
};

const BP_BASE = "https://bluepages.com.sa";
const BP_API  = "https://bluepages.com.sa/api";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BluepagesManagement {
  nameEn: string;
  nameAr: string;
  title: string;
}

export interface BluepagesCompany {
  id: number;
  url: string;
  nameAr: string;
  nameEn?: string;
  industry?: string;
  city?: string;
  region?: string;
  address?: string;
  phone?: string;
  phone2?: string;
  email?: string;
  website?: string;
  description?: string;
  crNumber?: string;
  postalCode?: string;
  foundingYear?: number;
  grade?: string;
  branches?: string;
  country: string;
  management?: BluepagesManagement[];
  linkedin?: string;
  facebook?: string;
  twitter?: string;
  whatsapp?: string;
  instagram?: string;
}

// ─── Internal API types ───────────────────────────────────────────────────────

interface BPApiCompany {
  id: number;
  name_en: string;
  name_ar: string;
  email: string;
  standard_phone: string;
  website: string;
  post_code: string;
  building_no: string;
  street_ar: string;
  street_en: string;
  district_en: string;
  district_ar: string;
  description_en: string;
  description_ar: string;
  keywords: string;
  commercial_reg: string;
  facebook: string;
  twitter: string;
  linkedin: string;
  youtube: string;
  tiktok: string;
  whatsapp: string;
  instagram: string;
  agent_name: string;
  agent_job: string;
  cityId: number;
  status: string;
  categories: Array<{ id: number; name_en: string; name_ar: string }>;
}

interface BPApiCategory {
  id: number;
  name_en: string;
  name_ar: string;
  companiesCount: number;
  cityCount?: Record<string, number>;
}

interface BPApiCity {
  id: number;
  name_en: string;
  name_ar: string;
  city_code?: string;
}

// ─── In-memory caches ─────────────────────────────────────────────────────────

let _categoriesCache: BPApiCategory[] | null = null;
let _citiesCache: BPApiCity[] | null = null;

async function getBluepagesCategories(): Promise<BPApiCategory[]> {
  if (_categoriesCache) return _categoriesCache;
  try {
    const { data } = await axios.get<BPApiCategory[]>(`${BP_API}/categories`, {
      headers: { ...HEADERS, Accept: "application/json" },
      timeout: 15000,
    });
    _categoriesCache = Array.isArray(data) ? data : [];
    return _categoriesCache;
  } catch {
    return [];
  }
}

async function getBluepagesCities(): Promise<BPApiCity[]> {
  if (_citiesCache) return _citiesCache;
  try {
    const { data } = await axios.get<BPApiCity[]>(`${BP_API}/cities`, {
      headers: { ...HEADERS, Accept: "application/json" },
      timeout: 15000,
    });
    _citiesCache = Array.isArray(data) ? data : [];
    return _citiesCache;
  } catch {
    return [];
  }
}

/** Fetch one page from the BluPages API (up to 24 results). */
async function fetchBluepagesApiPage(opts: {
  categoryId?: number;
  cityId?: number;
  limit?: number;
}): Promise<BPApiCompany[]> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 24));
  if (opts.categoryId !== undefined) params.set("categoryId", String(opts.categoryId));
  if (opts.cityId     !== undefined) params.set("cityId",     String(opts.cityId));

  try {
    const { data } = await axios.get<BPApiCompany[]>(`${BP_API}/companies?${params.toString()}`, {
      headers: { ...HEADERS, Accept: "application/json" },
      timeout: 15000,
    });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Map a raw API company record to our standard BluepagesCompany shape. */
function mapApiBluepagesCompany(c: BPApiCompany, cities: BPApiCity[]): BluepagesCompany {
  const categories = (c.categories || []).map(cat => cat.name_ar || cat.name_en).filter(Boolean);
  const addrParts  = [c.district_ar || c.district_en, c.street_ar || c.street_en, c.building_no].filter(Boolean);

  // City name from cityId lookup
  const cityObj = cities.find(ci => ci.id === c.cityId);
  const cityName = cityObj?.name_ar || cityObj?.name_en || undefined;

  // Management from agent fields
  const management: BluepagesManagement[] = [];
  const agentName = (c.agent_name || "").trim();
  if (agentName && agentName.toLowerCase() !== "null") {
    management.push({
      nameEn: agentName,
      nameAr: agentName,
      title: (c.agent_job || "").trim() || "Contact Person",
    });
  }

  const normalizeUrl = (u: string | undefined) =>
    u && u.trim() && u !== "null" ? (u.startsWith("http") ? u : `https://${u}`) : undefined;

  return {
    id: c.id,
    url: `${BP_BASE}/companies/${c.id}`,
    nameAr: c.name_ar || c.name_en || "",
    nameEn: c.name_en || undefined,
    industry: categories.join(", ") || undefined,
    city: cityName,
    region: cityName,
    address: addrParts.join(", ") || undefined,
    phone: c.standard_phone || undefined,
    email: c.email && c.email !== "null" ? c.email : undefined,
    website: normalizeUrl(c.website),
    description: c.description_ar || c.description_en || undefined,
    crNumber: c.commercial_reg && c.commercial_reg !== "0" && c.commercial_reg !== "null" ? c.commercial_reg : undefined,
    postalCode: c.post_code || undefined,
    country: "Saudi Arabia",
    management: management.length > 0 ? management : undefined,
    linkedin: normalizeUrl(c.linkedin),
    facebook: normalizeUrl(c.facebook),
    twitter:  normalizeUrl(c.twitter),
    whatsapp: normalizeUrl(c.whatsapp),
    instagram: normalizeUrl(c.instagram),
  };
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

/** Extract a bluepages company ID from any URL that contains one. */
export function extractBluepagesId(url: string): number | null {
  const m = url.match(/bluepages\.com\.sa\/companies\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function isBluepagesUrl(url: string): boolean {
  return url.includes("bluepages.com.sa");
}

/** Parse city + keyword from a BluPages URL query string.
 *  e.g. https://bluepages.com.sa/companies?city=الرياض&activity=أثاث
 */
export function parseBluepagesUrlFilters(url: string): { city?: string; keyword?: string } {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    const city    = u.searchParams.get("city")     || u.searchParams.get("cityId")    || undefined;
    const keyword = u.searchParams.get("activity") || u.searchParams.get("category")  || u.searchParams.get("q") || undefined;
    return { city: city?.trim() || undefined, keyword: keyword?.trim() || undefined };
  } catch {
    return {};
  }
}

// ─── HTML profile scraper (kept for richer fallback data) ─────────────────────

/** Convert Arabic-Indic digits to Western digits */
function normalizeDigits(s: string): string {
  return s.replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/** Parse a bluepages company HTML profile page for additional data. */
export function parseBluecompany(html: string, id: number): Partial<BluepagesCompany> {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const bodyText = $("body").text();

  const nameAr = $("h1").filter((_, el) => {
    const cls = $(el).attr("class") || "";
    return cls.includes("font-black") || cls.includes("font-extrabold");
  }).first().text().trim() || $("h1").first().text().trim();

  if (!nameAr || nameAr.length < 2) return {};

  const phones: string[] = [];
  $("a[href^='tel:']").each((_, el) => {
    const num = $(el).text().trim().replace(/\s+/g, " ");
    if (num && !phones.includes(num)) phones.push(num);
  });

  const email = $("a[href^='mailto:']").first().attr("href")?.replace("mailto:", "")?.trim() || undefined;

  let website: string | undefined;
  $("a[href^='http']").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href.includes("bluepages.com.sa") && !href.includes("apple.com") &&
        !href.includes("google.com") && href.startsWith("http") && !website) {
      website = href;
    }
  });

  let city: string | undefined;
  $("h2").each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length >= 3 && text.length <= 30 && /[\u0600-\u06FF]/.test(text)) {
      if (!city) city = text;
    }
  });

  const addrParts: string[] = [];
  if (city) addrParts.push(city);
  $("h3").each((_, el) => {
    const cls = ($(el).attr("class") || "").toLowerCase();
    const text = $(el).text().trim();
    if (text && /[\u0600-\u06FF]/.test(text) && !cls.includes("font-bold")) addrParts.push(text);
  });

  const categories: string[] = [];
  $("a, span").each((_, el) => {
    const cls = ($(el).attr("class") || "").toLowerCase();
    if (!cls) return;
    const isCat = cls.includes("categor") || cls.includes("tag") || cls.includes("badge") || cls.includes("rounded") || cls.includes("pill");
    if (!isCat) return;
    const text = $(el).text().trim();
    if (text && text.length >= 3 && text.length <= 60 && /[\u0600-\u06FF]/.test(text) && !categories.includes(text)) {
      categories.push(text);
    }
  });

  let description: string | undefined;
  $("h1, h2, h3").each((_, el): false | void => {
    const text = $(el).text().trim();
    if (text.includes("عن الشركة")) {
      const next = $(el).parent().next().text().trim() || $(el).nextAll().first().text().trim();
      if (next && next.length > 20) { description = next.slice(0, 2000); return false; }
    }
  });
  if (!description) {
    const ql = $("[class*='ql-editor'], [class*='ql-align'], .description").text().trim();
    if (ql && ql.length > 20) description = ql.slice(0, 2000);
  }

  const normalized = normalizeDigits(bodyText);
  const crDateMatch = normalized.match(/السجل التجاري\s*:?\s*([\d]{1,2}[-\/][\d]{1,2}[-\/][\d]{4})/);
  const postalMatch = normalized.match(/الرمز البريدي\s*:?\s*(\d{4,6})/);
  const gradeMatch  = bodyText.match(/الدرجه?\s*:?\s*([^\s\n\r]{1,20})/);

  let foundingYear: number | undefined;
  const hijriMatch = normalized.match(/تأسست[^0-9]*(\d{4})\s*[هه]/);
  if (hijriMatch) { const hy = parseInt(hijriMatch[1]); if (hy > 1300 && hy < 1450) foundingYear = Math.round(hy - hy / 33 + 622); }
  const gregMatch = normalized.match(/تأسس[^0-9]*(\d{4})\s*[مM]/);
  if (gregMatch) { const gy = parseInt(gregMatch[1]); if (gy > 1900 && gy < 2025) foundingYear = gy; }

  const branchSection = bodyText.match(/الفروع[\s\S]{0,500}/);
  let branches: string | undefined;
  if (branchSection) {
    const lines = branchSection[0].split(/\n/).map(l => l.trim()).filter(l => l && l.length < 40 && l !== "الفروع" && /[\u0600-\u06FF]/.test(l));
    if (lines.length > 0) branches = lines.join(" ، ");
  }

  return {
    nameAr,
    industry: [...new Set(categories)].join(", ") || undefined,
    city, region: city,
    address: addrParts.join(" , ") || undefined,
    phone: phones[0] || undefined,
    phone2: phones[1] || undefined,
    email, website, description,
    crNumber: crDateMatch ? crDateMatch[1] : undefined,
    postalCode: postalMatch ? postalMatch[1] : undefined,
    foundingYear,
    grade: gradeMatch ? gradeMatch[1] : undefined,
    branches,
  };
}

/** Fetch and parse a single company HTML profile page. */
export async function fetchCompany(id: number, timeoutMs = 20000): Promise<BluepagesCompany | null> {
  const url = `${BP_BASE}/companies/${id}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000));
      const { data: html, status } = await axios.get<string>(url, {
        headers: { ...HEADERS, Accept: "text/html,application/xhtml+xml" },
        timeout: timeoutMs, maxRedirects: 5, responseType: "text",
      });
      if (status !== 200) return null;
      const parsed = parseBluecompany(html, id);
      if (!parsed.nameAr) return null;
      return { id, url, country: "Saudi Arabia", ...parsed } as BluepagesCompany;
    } catch (err) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
    }
  }
  return null;
}

// ─── Legacy ID-range helpers (kept for backwards compatibility) ───────────────

export function buildIdRange(startId: number, count: number, stride = 1): number[] {
  const half = Math.floor(count / 2);
  const ids: number[] = [];
  for (let i = -half; i <= half && ids.length < count; i += stride) {
    const id = startId + i;
    if (id > 0) ids.push(id);
  }
  return ids;
}

export async function resolveStartId(_url: string): Promise<number> {
  return 642906;
}

export async function scanIdRange(
  ids: number[],
  concurrency = 5,
  onProgress?: (fetched: number, found: number, total: number) => void,
): Promise<BluepagesCompany[]> {
  const results: BluepagesCompany[] = [];
  let fetched = 0;
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(id => fetchCompany(id, 18000)));
    for (const s of settled) {
      fetched++;
      if (s.status === "fulfilled" && s.value) results.push(s.value);
    }
    onProgress?.(fetched, results.length, ids.length);
    if (i + concurrency < ids.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

// ─── Old scan (kept so existing callers don't break) ─────────────────────────

export async function* bluepagesScan(
  startId: number,
  totalTarget: number,
  concurrency = 6,
): AsyncGenerator<{ company: BluepagesCompany | null; id: number; fetched: number; total: number }> {
  // Delegate to the new API-based scan so even old callers benefit
  let i = 0;
  for await (const item of bluepagesApiScan(undefined, undefined, undefined, totalTarget)) {
    yield item;
    if (++i >= totalTarget) return;
  }
}

// ─── NEW: API-based scan (main entry point) ───────────────────────────────────

/**
 * Discover companies via the BluPages JSON API.
 *
 * Strategy:
 *  1. Load all categories + cities.
 *  2. Optionally filter categories by keyword.
 *  3. For each category iterate over city combinations to maximise unique records
 *     (the API always returns the same 24 "featured" companies per category
 *      but changes when cityId is supplied).
 *  4. Yield companies as they're found, de-duplicating by company ID.
 */
export async function* bluepagesApiScan(
  keyword?: string,
  cityFilter?: string,
  categoryFilter?: string,
  targetCount = 200,
): AsyncGenerator<{ company: BluepagesCompany | null; id: number; fetched: number; total: number }> {
  // ── 1. Load metadata ──────────────────────────────────────────────────────
  const [categories, cities] = await Promise.all([
    getBluepagesCategories(),
    getBluepagesCities(),
  ]);

  // ── 2. Resolve city filter to ID ──────────────────────────────────────────
  let targetCityId: number | undefined;
  if (cityFilter) {
    const cf = cityFilter.trim();
    const match = cities.find(c =>
      c.name_en?.toLowerCase().includes(cf.toLowerCase()) ||
      c.name_ar?.includes(cf) ||
      cf.toLowerCase().includes((c.name_en || "").toLowerCase())
    );
    if (match) targetCityId = match.id;
  }

  // ── 3. Filter / rank categories by keyword ────────────────────────────────
  const kw = (keyword || categoryFilter || "").toLowerCase().trim();
  let relevantCats: BPApiCategory[];

  if (kw) {
    const matched = categories.filter(c =>
      c.name_en?.toLowerCase().includes(kw) ||
      c.name_ar?.includes(keyword || categoryFilter || "") ||
      kw.includes((c.name_en || "").toLowerCase())
    );
    // If keyword matches specific categories, put those first; otherwise search all
    relevantCats = matched.length > 0
      ? [...matched, ...categories.filter(c => !matched.includes(c))]
      : categories;
  } else {
    relevantCats = categories;
  }

  // Sort by company count (largest first for best yield)
  relevantCats = [...relevantCats].sort((a, b) => (b.companiesCount || 0) - (a.companiesCount || 0));

  // ── 4. Build list of (categoryId, cityId) combos to try ───────────────────
  // If a cityFilter was given, only use that city.
  // Otherwise, use: no-city-filter + each individual city to maximise variety.
  const cityVariants: Array<number | undefined> = targetCityId
    ? [targetCityId]
    : [undefined, ...cities.map(c => c.id)];

  const seenIds = new Set<number>();
  let totalFetched = 0;
  let totalFound = 0;

  // ── 5. Iterate categories × cities ───────────────────────────────────────
  for (const cat of relevantCats) {
    if (totalFound >= targetCount) break;

    for (const cityId of cityVariants) {
      if (totalFound >= targetCount) break;

      const apiCompanies = await fetchBluepagesApiPage({ categoryId: cat.id, cityId, limit: 24 });

      let newInThisBatch = 0;
      for (const apiCo of apiCompanies) {
        if (seenIds.has(apiCo.id)) continue;
        seenIds.add(apiCo.id);
        newInThisBatch++;

        const company = mapApiBluepagesCompany(apiCo, cities);
        totalFound++;
        totalFetched++;
        yield { company, id: apiCo.id, fetched: totalFetched, total: targetCount };
        if (totalFound >= targetCount) return;
      }

      // If this category+city returned zero new companies, skip remaining cities for this cat
      if (newInThisBatch === 0 && cityId !== undefined) continue;

      // Brief pause to stay polite
      await new Promise(r => setTimeout(r, 150));
    }
  }
}
