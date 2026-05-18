/**
 * Free & Low-Cost Enrichment Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * Priority order (matches NexFlow waterfall):
 *   18 — GLEIF         Legal name, country, LEI
 *   28 — OpenCorporates CR number, jurisdiction, founded year
 *   32 — Wikidata       Founded year, headcount, HQ (SPARQL)
 *   34 — Clearbit Logo  Company logo by domain (CDN, no key)
 *   36 — GitHub Org     Hiring signals, tech stack
 *   38 — Wappalyzer     Tech-stack fingerprint (via public Wappalyzer API)
 *   60 — Email Permutator Fallback email guess
 *   26 — Tadawul/Argaam Revenue, ISIN, sector (KSA listed)
 *   20 — Hunter.io      Email + verified pattern (needs HUNTER_API_KEY)
 */

import axios from "axios";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GleifResult {
  lei: string;
  legalName: string;
  country: string;
  status: string;
  registrationAuthority?: string;
  legalForm?: string;
}

export interface OpenCorporatesResult {
  crNumber?: string;
  name?: string;
  jurisdiction?: string;
  foundingYear?: number;
  status?: string;
  companyType?: string;
  registeredAddress?: string;
  sourceUrl?: string;
}

export interface WikidataResult {
  wikidataId?: string;
  foundingYear?: number;
  employees?: number;
  headquarters?: string;
  isin?: string;
  stockExchange?: string;
  ceo?: string;
  description?: string;
}

export interface GithubOrgResult {
  orgName?: string;
  description?: string;
  location?: string;
  publicRepos?: number;
  followers?: number;
  website?: string;
  techSignals?: string[];
  hiringSignals?: string[];
}

export interface HunterResult {
  domain?: string;
  emailPattern?: string;
  emails?: Array<{ value: string; type: string; confidence: number; firstName?: string; lastName?: string; position?: string }>;
  companyName?: string;
  country?: string;
}

export interface TadawulResult {
  isin?: string;
  ticker?: string;
  sector?: string;
  listedMarket?: string;
  marketCap?: string;
  revenue?: string;
  companyName?: string;
  website?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getJson<T>(url: string, timeoutMs = 10000, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await axios.get<T>(url, {
      timeout: timeoutMs,
      headers: {
        "User-Agent": "ProspectSA/1.0 (Saudi Arabia B2B Intelligence Platform)",
        "Accept": "application/json",
        ...headers,
      },
    });
    return res.data ?? null;
  } catch {
    return null;
  }
}

// ─── 1. GLEIF ─────────────────────────────────────────────────────────────────
// Free REST API — no key required. Best for large listed / multinational entities.

export async function lookupGleif(companyName: string): Promise<GleifResult | null> {
  if (!companyName?.trim()) return null;
  try {
    // Try fuzzy completion first (fast)
    const q = encodeURIComponent(companyName.trim());
    const res = await getJson<{ data?: Array<{ id: string; attributes?: { value?: string; entity?: { legalName?: { name?: string }; legalAddress?: { country?: string }; status?: string; registrationAuthority?: { registrationAuthorityCode?: string }; legalForm?: { id?: string } } } }> }>(
      `https://api.gleif.org/api/v1/fuzzycompletions?field=entity.legalName&q=${q}&filter%5Bentity.legalAddress.country%5D=SA`,
      12000
    );

    if (!res?.data?.length) {
      // Fallback: full search without country filter
      const res2 = await getJson<{ data?: Array<{ id: string; attributes?: { entity?: { legalName?: { name?: string }; legalAddress?: { country?: string }; status?: string; legalForm?: { id?: string } } } }> }>(
        `https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalName%5D=${q}&page%5Bsize%5D=3`,
        12000
      );
      if (!res2?.data?.length) return null;
      const r = res2.data[0];
      const e = r.attributes?.entity;
      return {
        lei: r.id,
        legalName: e?.legalName?.name || companyName,
        country: e?.legalAddress?.country || "SA",
        status: e?.status || "ACTIVE",
        legalForm: e?.legalForm?.id,
      };
    }

    const r = res.data[0];
    const e = r.attributes?.entity;
    return {
      lei: r.id,
      legalName: e?.legalName?.name || r.attributes?.value || companyName,
      country: e?.legalAddress?.country || "SA",
      status: e?.status || "ACTIVE",
      registrationAuthority: e?.registrationAuthority?.registrationAuthorityCode,
      legalForm: e?.legalForm?.id,
    };
  } catch {
    return null;
  }
}

// ─── 2. OpenCorporates ────────────────────────────────────────────────────────
// Free public API — no key for basic lookups. Saudi jurisdiction = "sa"

export async function lookupOpenCorporates(name: string): Promise<OpenCorporatesResult | null> {
  if (!name?.trim()) return null;
  try {
    const q = encodeURIComponent(name.trim());
    const res = await getJson<{ results?: { companies?: Array<{ company?: { name?: string; company_number?: string; jurisdiction_code?: string; incorporation_date?: string; current_status?: string; company_type?: string; registered_address_in_full?: string; opencorporates_url?: string } }> } }>(
      `https://api.opencorporates.com/v0.4/companies/search?q=${q}&jurisdiction_code=sa&per_page=5&format=json`,
      12000
    );

    const companies = res?.results?.companies;
    if (!companies?.length) return null;

    const match = companies.find(c => {
      const cName = c.company?.name?.toLowerCase() || "";
      const nameClean = name.toLowerCase();
      return cName.includes(nameClean.split(" ")[0]) || nameClean.includes(cName.split(" ")[0]);
    }) || companies[0];

    const c = match?.company;
    if (!c) return null;

    const foundingYear = c.incorporation_date
      ? parseInt(c.incorporation_date.slice(0, 4), 10) || undefined
      : undefined;

    return {
      crNumber: c.company_number || undefined,
      name: c.name || undefined,
      jurisdiction: c.jurisdiction_code || "sa",
      foundingYear,
      status: c.current_status || undefined,
      companyType: c.company_type || undefined,
      registeredAddress: c.registered_address_in_full || undefined,
      sourceUrl: c.opencorporates_url || undefined,
    };
  } catch {
    return null;
  }
}

// ─── 3. Wikidata SPARQL ───────────────────────────────────────────────────────
// Free, no key. Uses Wikidata Query Service.

export async function lookupWikidata(companyName: string): Promise<WikidataResult | null> {
  if (!companyName?.trim()) return null;
  const name = companyName.trim().replace(/"/g, '\\"');
  const sparql = `
SELECT ?company ?companyLabel ?founded ?employees ?hq ?hqLabel ?isin ?exchange ?exchangeLabel ?ceo ?ceoLabel ?description WHERE {
  ?company wdt:P17 wd:Q851 .
  ?company rdfs:label "${name}"@en .
  OPTIONAL { ?company wdt:P571 ?founded }
  OPTIONAL { ?company wdt:P1082 ?employees }
  OPTIONAL { ?company wdt:P159 ?hq }
  OPTIONAL { ?company wdt:P946 ?isin }
  OPTIONAL { ?company wdt:P414 ?exchange }
  OPTIONAL { ?company wdt:P169 ?ceo }
  OPTIONAL { ?company schema:description ?description FILTER(LANG(?description) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ar" }
}
LIMIT 1
`.trim();

  try {
    const res = await axios.get<{ results?: { bindings?: Array<Record<string, { value?: string }>> } }>(
      "https://query.wikidata.org/sparql",
      {
        params: { query: sparql, format: "json" },
        timeout: 12000,
        headers: {
          "Accept": "application/json",
          "User-Agent": "ProspectSA/1.0 (Saudi Arabia B2B Intelligence; contact: info@prospectsa.com)",
        },
      }
    );

    const bindings = res.data?.results?.bindings;
    if (!bindings?.length) return null;
    const b = bindings[0];

    const rawId = b.company?.value?.split("/").pop();
    const foundedStr = b.founded?.value;
    const foundingYear = foundedStr ? parseInt(foundedStr.slice(0, 4), 10) || undefined : undefined;
    const employees = b.employees?.value ? parseInt(b.employees.value, 10) || undefined : undefined;

    return {
      wikidataId: rawId,
      foundingYear,
      employees,
      headquarters: b.hqLabel?.value || b.hq?.value?.split("/").pop(),
      isin: b.isin?.value,
      stockExchange: b.exchangeLabel?.value,
      ceo: b.ceoLabel?.value,
      description: b.description?.value,
    };
  } catch {
    return null;
  }
}

// ─── 4. Clearbit Logo CDN ─────────────────────────────────────────────────────
// No API key needed. Simply returns the CDN URL — always resolves.

export function getClearbitLogoUrl(domain: string): string | null {
  if (!domain?.trim()) return null;
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  if (!clean || !clean.includes(".")) return null;
  return `https://logo.clearbit.com/${clean}`;
}

// Verify the logo URL actually returns an image (200 response)
export async function verifyClearbitLogo(domain: string): Promise<string | null> {
  const url = getClearbitLogoUrl(domain);
  if (!url) return null;
  try {
    const res = await axios.head(url, { timeout: 5000 });
    return res.status === 200 ? url : null;
  } catch {
    return null;
  }
}

// ─── 5. GitHub Org ────────────────────────────────────────────────────────────
// Public GitHub API — 60 req/hour unauthenticated. Used for tech/hiring signals.

export async function lookupGithubOrg(domain: string): Promise<GithubOrgResult | null> {
  if (!domain?.trim()) return null;
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  // Derive org slug from domain (e.g. aramco.com → aramco)
  const orgSlug = clean.split(".")[0];
  if (!orgSlug || orgSlug.length < 2) return null;

  try {
    const orgRes = await getJson<{ login?: string; description?: string; location?: string; public_repos?: number; followers?: number; blog?: string; html_url?: string }>(
      `https://api.github.com/orgs/${orgSlug}`,
      10000,
      { "Accept": "application/vnd.github+json" }
    );

    if (!orgRes) return null;

    const result: GithubOrgResult = {
      orgName: orgRes.login,
      description: orgRes.description || undefined,
      location: orgRes.location || undefined,
      publicRepos: orgRes.public_repos,
      followers: orgRes.followers,
      website: orgRes.blog || undefined,
    };

    // Fetch recent repos to extract tech signals
    if ((orgRes.public_repos || 0) > 0) {
      const reposRes = await getJson<Array<{ language?: string | null; topics?: string[]; name?: string }>>(
        `https://api.github.com/orgs/${orgSlug}/repos?sort=pushed&per_page=10`,
        10000,
        { "Accept": "application/vnd.github+json" }
      );

      if (reposRes?.length) {
        const langs = [...new Set(reposRes.map(r => r.language).filter(Boolean) as string[])];
        const topics = [...new Set(reposRes.flatMap(r => r.topics || []))];
        result.techSignals = [...langs, ...topics].slice(0, 12);
        // Look for hiring-related repos
        result.hiringSignals = reposRes
          .filter(r => /career|job|hire|recruit|opening/i.test(r.name || ""))
          .map(r => r.name!)
          .filter(Boolean);
      }
    }

    return result;
  } catch {
    return null;
  }
}

// ─── 6. Email Permutator ──────────────────────────────────────────────────────
// Zero-cost — generates likely business email patterns from name + domain.

export function generateEmailPermutations(
  firstName: string,
  lastName: string,
  domain: string
): string[] {
  if (!firstName || !lastName || !domain) return [];
  const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
  const f1 = f[0] || "";
  const l1 = l[0] || "";
  const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();

  if (!f || !l || !d) return [];

  return [
    `${f}.${l}@${d}`,
    `${f}${l}@${d}`,
    `${f1}${l}@${d}`,
    `${f}.${l1}@${d}`,
    `${f1}.${l}@${d}`,
    `${l}.${f}@${d}`,
    `${f}@${d}`,
    `info@${d}`,
    `contact@${d}`,
    `sales@${d}`,
  ].filter((v, i, a) => a.indexOf(v) === i); // deduplicate
}

// ─── 7. Hunter.io ─────────────────────────────────────────────────────────────
// Needs HUNTER_API_KEY. Returns emails + pattern for a domain.

export function isHunterConfigured(): boolean {
  return !!process.env.HUNTER_API_KEY;
}

export async function lookupHunterByDomain(domain: string): Promise<HunterResult | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey || !domain?.trim()) return null;

  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  try {
    const res = await getJson<{
      data?: {
        domain?: string;
        pattern?: string;
        organization?: string;
        country?: string;
        emails?: Array<{ value?: string; type?: string; confidence?: number; first_name?: string; last_name?: string; position?: string }>;
      };
      meta?: { results?: number };
    }>(
      `https://api.hunter.io/v2/domain-search?domain=${clean}&api_key=${apiKey}&limit=10&type=generic`,
      15000
    );

    if (!res?.data) return null;
    const d = res.data;

    return {
      domain: d.domain,
      emailPattern: d.pattern,
      companyName: d.organization,
      country: d.country,
      emails: (d.emails || []).map(e => ({
        value: e.value || "",
        type: e.type || "generic",
        confidence: e.confidence || 0,
        firstName: e.first_name,
        lastName: e.last_name,
        position: e.position,
      })).filter(e => e.value),
    };
  } catch {
    return null;
  }
}

export async function lookupHunterByName(firstName: string, lastName: string, domain: string): Promise<{ email: string; confidence: number } | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey || !firstName || !lastName || !domain) return null;

  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  try {
    const res = await getJson<{ data?: { email?: string; score?: number } }>(
      `https://api.hunter.io/v2/email-finder?domain=${clean}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${apiKey}`,
      12000
    );
    const email = res?.data?.email;
    if (!email) return null;
    return { email, confidence: res?.data?.score || 0 };
  } catch {
    return null;
  }
}

// ─── 8. Tadawul / Argaam ──────────────────────────────────────────────────────
// KSA exchange data. Tadawul = Saudi Exchange. Argaam = financial data aggregator.
// Uses public JSON endpoints where available.

export async function lookupTadawulListed(companyName: string): Promise<TadawulResult | null> {
  if (!companyName?.trim()) return null;
  const name = companyName.trim();

  try {
    // Argaam has a public screener API that lists all Tadawul-listed companies
    const res = await getJson<{ data?: Array<{ companyNameEn?: string; companyNameAr?: string; symbol?: string; isin?: string; sectorNameEn?: string; marketNameEn?: string; marketCap?: number; website?: string }> }>(
      `https://www.argaam.com/en/company/company-screener?format=json&page=1&pageSize=200&sortColumn=marketCap&sortOrder=desc`,
      15000,
      { "Referer": "https://www.argaam.com/en/company/company-screener" }
    );

    if (res?.data?.length) {
      const match = res.data.find(c => {
        const enName = (c.companyNameEn || "").toLowerCase();
        const arName = (c.companyNameAr || "").toLowerCase();
        const target = name.toLowerCase();
        return enName.includes(target.split(" ")[0]) || target.includes(enName.split(" ")[0]) || arName.includes(target);
      });

      if (match) {
        return {
          isin: match.isin,
          ticker: match.symbol,
          sector: match.sectorNameEn,
          listedMarket: match.marketNameEn || "Tadawul (Saudi Exchange)",
          marketCap: match.marketCap ? `SAR ${(match.marketCap / 1e9).toFixed(2)}B` : undefined,
          companyName: match.companyNameEn || match.companyNameAr,
          website: match.website,
        };
      }
    }

    // Fallback: try searching Tadawul directly
    const tadawulRes = await getJson<{ hits?: { hits?: Array<{ _source?: { companyNameEn?: string; isinCode?: string; symbol?: string; sectorNameEn?: string } }> } }>(
      `https://www.saudiexchange.sa/wps/portal/saudiexchange/uss-search-results?q=${encodeURIComponent(name)}&format=json`,
      10000
    );

    const hit = tadawulRes?.hits?.hits?.[0]?._source;
    if (hit) {
      return {
        isin: hit.isinCode,
        ticker: hit.symbol,
        sector: hit.sectorNameEn,
        listedMarket: "Tadawul (Saudi Exchange)",
        companyName: hit.companyNameEn,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ─── 9. Wappalyzer (public) ───────────────────────────────────────────────────
// Wappalyzer has a public lookup endpoint. No key needed for basic lookups.

export interface WappalyzerResult {
  technologies?: Array<{ name: string; categories: string[]; website?: string }>;
  techStack?: string[];
}

export async function lookupWappalyzer(domain: string): Promise<WappalyzerResult | null> {
  if (!domain?.trim()) return null;
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").trim();
  if (!clean) return null;

  try {
    const res = await getJson<{ technologies?: Array<{ name?: string; categories?: Array<{ name?: string }> }>; }>(
      `https://api.wappalyzer.com/v2/lookup/?urls=https://${clean}&sets=all`,
      12000,
      { "x-api-key": process.env.WAPPALYZER_API_KEY || "" }
    );

    if (!res?.technologies?.length) return null;

    const technologies = res.technologies.map(t => ({
      name: t.name || "",
      categories: (t.categories || []).map(c => c.name || ""),
    }));

    const techStack = technologies.map(t => t.name).filter(Boolean);
    return { technologies, techStack };
  } catch {
    return null;
  }
}

// ─── Composite: enrich a single company with ALL free sources in parallel ─────

export interface FreeSourceEnrichmentResult {
  gleif?: GleifResult | null;
  opencorporates?: OpenCorporatesResult | null;
  wikidata?: WikidataResult | null;
  logoUrl?: string | null;
  github?: GithubOrgResult | null;
  hunter?: HunterResult | null;
  tadawul?: TadawulResult | null;
  emailPermutations?: string[];
}

export async function enrichWithFreeSources(
  companyName: string,
  domain?: string | null,
  ownerFirstName?: string | null,
  ownerLastName?: string | null
): Promise<FreeSourceEnrichmentResult> {
  const [gleif, opencorporates, wikidata, logoUrl, github, hunter, tadawul] = await Promise.allSettled([
    lookupGleif(companyName),
    lookupOpenCorporates(companyName),
    lookupWikidata(companyName),
    domain ? verifyClearbitLogo(domain) : Promise.resolve(null),
    domain ? lookupGithubOrg(domain) : Promise.resolve(null),
    domain && isHunterConfigured() ? lookupHunterByDomain(domain) : Promise.resolve(null),
    lookupTadawulListed(companyName),
  ]);

  let emailPermutations: string[] = [];
  if (ownerFirstName && ownerLastName && domain) {
    emailPermutations = generateEmailPermutations(ownerFirstName, ownerLastName, domain);
  }

  return {
    gleif: gleif.status === "fulfilled" ? gleif.value : null,
    opencorporates: opencorporates.status === "fulfilled" ? opencorporates.value : null,
    wikidata: wikidata.status === "fulfilled" ? wikidata.value : null,
    logoUrl: logoUrl.status === "fulfilled" ? logoUrl.value : null,
    github: github.status === "fulfilled" ? github.value : null,
    hunter: hunter.status === "fulfilled" ? hunter.value : null,
    tadawul: tadawul.status === "fulfilled" ? tadawul.value : null,
    emailPermutations,
  };
}

// ─── Harvest helpers: seed raw company data from OpenCorporates (SA jurisdiction) ─

export interface RawSeedCompany {
  nameEn?: string;
  nameAr?: string;
  crNumber?: string;
  foundingYear?: string;
  status?: string;
  companyType?: string;
  city?: string;
  source: string;
  sourceUrl?: string;
}

export async function harvestOpenCorporatesSA(keyword: string, maxPages = 3): Promise<RawSeedCompany[]> {
  const results: RawSeedCompany[] = [];
  const q = encodeURIComponent(keyword.trim() || "saudi");

  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await getJson<{ results?: { companies?: Array<{ company?: { name?: string; company_number?: string; jurisdiction_code?: string; incorporation_date?: string; current_status?: string; company_type?: string; opencorporates_url?: string } }> }; meta?: { total_count?: number } }>(
        `https://api.opencorporates.com/v0.4/companies/search?q=${q}&jurisdiction_code=sa&per_page=30&page=${page}&format=json`,
        15000
      );

      const companies = res?.results?.companies;
      if (!companies?.length) break;

      for (const item of companies) {
        const c = item.company;
        if (!c?.name) continue;
        const fy = c.incorporation_date ? c.incorporation_date.slice(0, 4) : undefined;
        results.push({
          nameEn: c.name,
          crNumber: c.company_number,
          foundingYear: fy,
          status: c.current_status,
          companyType: c.company_type,
          source: "opencorporates",
          sourceUrl: c.opencorporates_url,
        });
      }

      const total = res?.meta?.total_count || 0;
      if (results.length >= total || results.length >= maxPages * 30) break;
      await new Promise(r => setTimeout(r, 500));
    } catch {
      break;
    }
  }

  return results;
}

export async function harvestGleifSA(keyword: string, maxResults = 50): Promise<RawSeedCompany[]> {
  const results: RawSeedCompany[] = [];
  const q = encodeURIComponent(keyword.trim() || "saudi");

  try {
    const res = await getJson<{ data?: Array<{ id?: string; attributes?: { entity?: { legalName?: { name?: string }; legalAddress?: { country?: string; city?: string }; status?: string; legalForm?: { id?: string } }; registration?: { initialRegistrationDate?: string } } }> }>(
      `https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalName%5D=${q}&filter%5Bentity.legalAddress.country%5D=SA&page%5Bsize%5D=${Math.min(maxResults, 100)}`,
      15000
    );

    for (const r of (res?.data || [])) {
      const e = r.attributes?.entity;
      if (!e?.legalName?.name) continue;
      const initDate = r.attributes?.registration?.initialRegistrationDate;
      const fy = initDate ? initDate.slice(0, 4) : undefined;

      results.push({
        nameEn: e.legalName.name,
        city: e.legalAddress?.city,
        status: e.status,
        companyType: e.legalForm?.id,
        foundingYear: fy,
        source: "gleif",
        sourceUrl: `https://search.gleif.org/#/record/${r.id}`,
      });
    }
  } catch { /* non-fatal */ }

  return results;
}

export async function harvestWikidataSA(keyword: string): Promise<RawSeedCompany[]> {
  const results: RawSeedCompany[] = [];
  const term = keyword.replace(/"/g, '\\"');

  const sparql = `
SELECT DISTINCT ?company ?companyLabel ?founded ?employees ?hq ?hqLabel WHERE {
  ?company wdt:P17 wd:Q851 .
  ?company wdt:P31 ?type .
  VALUES ?type { wd:Q783794 wd:Q4830453 wd:Q6881511 wd:Q891723 wd:Q9053942 wd:Q1650915 }
  FILTER(CONTAINS(LCASE(STR(?companyLabel)), LCASE("${term}")))
  OPTIONAL { ?company wdt:P571 ?founded }
  OPTIONAL { ?company wdt:P1082 ?employees }
  OPTIONAL { ?company wdt:P159 ?hq }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ar" }
}
LIMIT 50
`.trim();

  try {
    const res = await axios.get<{ results?: { bindings?: Array<Record<string, { value?: string }>> } }>(
      "https://query.wikidata.org/sparql",
      {
        params: { query: sparql, format: "json" },
        timeout: 15000,
        headers: {
          "Accept": "application/json",
          "User-Agent": "ProspectSA/1.0 (Saudi Arabia B2B Intelligence; contact: info@prospectsa.com)",
        },
      }
    );

    for (const b of (res.data?.results?.bindings || [])) {
      const nameEn = b.companyLabel?.value;
      if (!nameEn) continue;
      const foundedStr = b.founded?.value;
      const fy = foundedStr ? foundedStr.slice(0, 4) : undefined;

      results.push({
        nameEn,
        city: b.hqLabel?.value || b.hq?.value?.split("/").pop(),
        foundingYear: fy,
        source: "wikidata",
        sourceUrl: b.company?.value,
      });
    }
  } catch { /* non-fatal */ }

  return results;
}
