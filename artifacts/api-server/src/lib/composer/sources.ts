/**
 * Composer — sources registry. 80+ built-in sources grouped by category.
 * Auto-recommended subset based on industry + country + listing status.
 */

export type SourceCategory = "ksa-market" | "arabic-press" | "regional-press" | "global-open" | "sector" | "social";

export interface ComposerSource {
  id: string;
  label: string;
  category: SourceCategory;
  url: string;
  language: "ar" | "en" | "both";
  countries?: string[];      // primary coverage; empty = global
  industries?: string[];     // primary coverage; empty = all
}

export const BUILTIN_SOURCES: ComposerSource[] = [
  // ── Saudi market & registries
  { id: "tadawul",   label: "Tadawul (Saudi Exchange)", category: "ksa-market", url: "https://www.saudiexchange.sa", language: "both", countries: ["sa"] },
  { id: "cma",       label: "CMA disclosures",          category: "ksa-market", url: "https://cma.org.sa",          language: "both", countries: ["sa"] },
  { id: "edaa",      label: "Edaa depositary",          category: "ksa-market", url: "https://edaa.com.sa",         language: "both", countries: ["sa"] },
  { id: "mci-cr",    label: "MCI Commercial Registry",  category: "ksa-market", url: "https://mc.gov.sa",           language: "ar",   countries: ["sa"] },
  { id: "monshaat",  label: "Monsha'at",                category: "ksa-market", url: "https://monshaat.gov.sa",     language: "both", countries: ["sa"] },
  { id: "sdaia",     label: "SDAIA Open Data",          category: "ksa-market", url: "https://sdaia.gov.sa",        language: "both", countries: ["sa"] },
  { id: "gastat",    label: "GASTAT",                   category: "ksa-market", url: "https://stats.gov.sa",        language: "both", countries: ["sa"] },
  { id: "sama",      label: "SAMA",                     category: "ksa-market", url: "https://sama.gov.sa",         language: "both", countries: ["sa"], industries: ["banking", "insurance"] },
  { id: "zatca",     label: "ZATCA",                    category: "ksa-market", url: "https://zatca.gov.sa",        language: "both", countries: ["sa"] },
  { id: "misa",      label: "MISA",                     category: "ksa-market", url: "https://misa.gov.sa",         language: "both", countries: ["sa"] },
  { id: "masar",     label: "Masar (CR lookup)",        category: "ksa-market", url: "https://masar",               language: "ar",   countries: ["sa"] },

  // ── Arabic press
  { id: "argaam",       label: "Argaam",            category: "arabic-press", url: "https://argaam.com",       language: "both", countries: ["sa"] },
  { id: "mubasher",     label: "Mubasher",          category: "arabic-press", url: "https://mubasher.info",    language: "both", countries: ["sa"] },
  { id: "maal",         label: "Maal",              category: "arabic-press", url: "https://maaal.com",        language: "ar",   countries: ["sa"] },
  { id: "aleqtisadiah", label: "Al-Eqtisadiah",     category: "arabic-press", url: "https://aleqt.com",        language: "ar",   countries: ["sa"] },
  { id: "asharq",       label: "Asharq Business",   category: "arabic-press", url: "https://asharqbusiness.com", language: "ar", countries: ["sa", "ae"] },
  { id: "saudi-gazette",label: "Saudi Gazette",     category: "arabic-press", url: "https://saudigazette.com.sa", language: "en", countries: ["sa"] },
  { id: "arabnews",     label: "Arab News",         category: "arabic-press", url: "https://arabnews.com",     language: "en",   countries: ["sa"] },
  { id: "spa",          label: "SPA",               category: "arabic-press", url: "https://spa.gov.sa",       language: "both", countries: ["sa"] },

  // ── Regional press
  { id: "meed",        label: "MEED",              category: "regional-press", url: "https://meed.com",        language: "en", industries: ["energy", "construction"] },
  { id: "wamda",       label: "Wamda",             category: "regional-press", url: "https://wamda.com",       language: "en", industries: ["saas", "fintech"] },
  { id: "magnitt",     label: "MAGNiTT",           category: "regional-press", url: "https://magnitt.com",     language: "en", industries: ["saas", "fintech"] },
  { id: "crunchbase",  label: "Crunchbase MENA",   category: "regional-press", url: "https://crunchbase.com",  language: "en" },
  { id: "bloomberg-me",label: "Bloomberg ME",      category: "regional-press", url: "https://bloomberg.com/middleeast", language: "en" },
  { id: "reuters-me",  label: "Reuters ME",        category: "regional-press", url: "https://reuters.com/world/middle-east/", language: "en" },
  { id: "ft-me",       label: "FT MidEast",        category: "regional-press", url: "https://ft.com/world/mideast", language: "en" },
  { id: "zawya",       label: "Zawya",             category: "regional-press", url: "https://zawya.com",       language: "en" },
  { id: "national-ae", label: "The National (UAE)",category: "regional-press", url: "https://thenationalnews.com", language: "en", countries: ["ae"] },
  { id: "agbi",        label: "AGBI",              category: "regional-press", url: "https://agbi.com",        language: "en" },
  { id: "gulf-biz",    label: "Gulf Business",     category: "regional-press", url: "https://gulfbusiness.com",language: "en" },

  // ── Global open-data / legal
  { id: "gleif",          label: "GLEIF",                 category: "global-open", url: "https://gleif.org",        language: "en" },
  { id: "opencorporates", label: "OpenCorporates",        category: "global-open", url: "https://opencorporates.com", language: "en" },
  { id: "wikidata",       label: "Wikidata",              category: "global-open", url: "https://wikidata.org",     language: "en" },
  { id: "opensanctions",  label: "OpenSanctions",         category: "global-open", url: "https://opensanctions.org",language: "en" },
  { id: "ofac",           label: "OFAC SDN",              category: "global-open", url: "https://ofac.treasury.gov",language: "en" },
  { id: "un-sanctions",   label: "UN Consolidated",       category: "global-open", url: "https://scsanctions.un.org",language: "en" },
  { id: "eu-sanctions",   label: "EU Sanctions",          category: "global-open", url: "https://sanctionsmap.eu",  language: "en" },
  { id: "edgar",          label: "EDGAR (SEC)",           category: "global-open", url: "https://sec.gov/edgar",    language: "en" },
  { id: "uk-companies-house", label: "UK Companies House",category: "global-open", url: "https://gov.uk/companies-house", language: "en" },
  { id: "pep-database",   label: "PEP database",          category: "global-open", url: "https://peps.opensanctions.org", language: "en" },
  { id: "icij",           label: "ICIJ Offshore Leaks",   category: "global-open", url: "https://offshoreleaks.icij.org", language: "en" },

  // ── Sector
  { id: "rega",            label: "REGA",            category: "sector", url: "https://rega.gov.sa",           language: "both", countries: ["sa"], industries: ["realestate"] },
  { id: "sakani",          label: "Sakani",          category: "sector", url: "https://sakani.sa",             language: "both", countries: ["sa"], industries: ["realestate"] },
  { id: "neom-updates",    label: "NEOM Updates",    category: "sector", url: "https://neom.com",              language: "both", countries: ["sa"], industries: ["construction"] },
  { id: "pif-portfolio",   label: "PIF Portfolio",   category: "sector", url: "https://pif.gov.sa",            language: "both", countries: ["sa"] },
  { id: "meed-projects",   label: "MEED Projects",   category: "sector", url: "https://meedprojects.com",      language: "en",   industries: ["construction", "energy"] },
  { id: "bayut",           label: "Bayut",           category: "sector", url: "https://bayut.sa",              language: "both", industries: ["realestate"] },
  { id: "property-finder", label: "Property Finder", category: "sector", url: "https://propertyfinder.sa",     language: "en",   industries: ["realestate"] },

  // ── Social / live web
  { id: "linkedin",     label: "LinkedIn public",    category: "social", url: "https://linkedin.com",       language: "en" },
  { id: "twitter",      label: "X / Twitter",        category: "social", url: "https://x.com",              language: "both" },
  { id: "reddit",       label: "Reddit",             category: "social", url: "https://reddit.com",         language: "en" },
  { id: "youtube",      label: "YouTube transcripts",category: "social", url: "https://youtube.com",        language: "both" },
  { id: "telegram",     label: "Telegram channels",  category: "social", url: "",                            language: "both" },
  { id: "tavily",       label: "Tavily web search",  category: "social", url: "",                            language: "both" },
  { id: "perplexity",   label: "Perplexity",         category: "social", url: "",                            language: "both" },
  { id: "google-news",  label: "Google News RSS",    category: "social", url: "https://news.google.com",    language: "both" },
];

export interface ScopeForReco {
  industry?: string;
  countries: string[];
  listing?: string;  // "Any" | "Tadawul main" | "Nomu" | etc.
  target?: "person" | "company" | "both";
}

/** Auto-recommend the best 6-7 sources based on scope. */
export function recommendSources(scope: ScopeForReco): ComposerSource[] {
  const out: ComposerSource[] = [];
  const has = (id: string): boolean => out.some((s) => s.id === id);
  const add = (id: string): void => {
    if (has(id)) return;
    const s = BUILTIN_SOURCES.find((x) => x.id === id);
    if (s) out.push(s);
  };

  // Always include live web
  add("tavily");

  // KSA-centric defaults
  if (scope.countries.includes("sa") || scope.countries.includes("gcc") || scope.countries.includes("mena")) {
    add("tadawul"); add("argaam"); add("mubasher"); add("mci-cr"); add("gleif");
  }

  // Listing-status routing
  if (scope.listing && (scope.listing.includes("Tadawul") || scope.listing.includes("Nomu"))) {
    add("cma"); add("edaa");
  }
  if (scope.listing === "VC-backed" || scope.listing === "Private only") {
    add("wamda"); add("magnitt");
  }

  // Industry routing
  if (scope.industry === "banking" || scope.industry === "insurance") add("sama");
  if (scope.industry === "energy") { add("meed-projects"); add("pif-portfolio"); }
  if (scope.industry === "construction") { add("rega"); add("neom-updates"); add("meed-projects"); }
  if (scope.industry === "realestate") { add("rega"); add("sakani"); add("bayut"); }
  if (scope.industry === "saas" || scope.industry === "fintech") { add("wamda"); add("magnitt"); }

  // Person-target additions
  if (scope.target === "person" || scope.target === "both") add("linkedin");

  return out.slice(0, 8);
}

export function findSource(id: string): ComposerSource | undefined {
  return BUILTIN_SOURCES.find((s) => s.id === id);
}
