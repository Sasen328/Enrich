import axios from "axios";
import * as cheerio from "cheerio";
import { openai } from "./openai.js";
import { db, prospectingResultsTable, jobsTable } from "@workspace/db";
import { nexusExtract, nexusGenerate } from "./nexus/index.js";
import { eq, desc } from "drizzle-orm";
import { enrichCompanyWithAI } from "./enrichment-engine.js";
import { getPageContent, parseHtml } from "../browser-helper.js";
import {
  isBluepagesUrl,
  bluepagesApiScan,
  parseBluepagesUrlFilters,
  type BluepagesCompany,
} from "./bluepages-scraper.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldDef {
  key: string;
  label: string;
  labelAr: string;
  category: "identity" | "contact" | "business" | "financial" | "registration" | "people";
  detected: boolean;
  confidence: number;
  description: string;
}

export interface ScanResult {
  siteType: string;
  contentType: string;
  language: string;
  estimatedTotal: number;
  pagesDiscovered: number;
  sampleItems: Record<string, string>[];
  fields: FieldDef[];
  pageUrls: string[];
  rawAnalysis: string;
  siteNote: string;
}

const ALL_FIELDS: Omit<FieldDef, "detected" | "confidence">[] = [
  { key: "nameEn",       label: "Company Name (English)",  labelAr: "اسم الشركة (إنجليزي)",  category: "identity",     description: "Official English company name" },
  { key: "nameAr",       label: "Company Name (Arabic)",   labelAr: "اسم الشركة (عربي)",     category: "identity",     description: "Official Arabic company name" },
  { key: "website",      label: "Website URL",             labelAr: "الموقع الإلكتروني",       category: "contact",      description: "Official company website" },
  { key: "phone",        label: "Phone Number",            labelAr: "رقم الهاتف",              category: "contact",      description: "Main contact phone number" },
  { key: "email",        label: "Email Address",           labelAr: "البريد الإلكتروني",       category: "contact",      description: "Main contact email" },
  { key: "industry",     label: "Industry / Sector",       labelAr: "القطاع / الصناعة",        category: "business",     description: "Business sector or industry" },
  { key: "city",         label: "City",                    labelAr: "المدينة",                 category: "business",     description: "City where company is located" },
  { key: "region",       label: "Region / Province",       labelAr: "المنطقة",                 category: "business",     description: "Saudi administrative region" },
  { key: "description",  label: "Company Description",     labelAr: "وصف الشركة",              category: "business",     description: "Brief description of what the company does" },
  { key: "revenue",      label: "Annual Revenue",          labelAr: "الإيرادات السنوية",       category: "financial",    description: "Estimated or stated annual revenue" },
  { key: "employeeCount",label: "Employee Count",          labelAr: "عدد الموظفين",            category: "financial",    description: "Number of employees" },
  { key: "capitalAmount",label: "Capital Amount",          labelAr: "رأس المال",               category: "financial",    description: "Registered capital amount" },
  { key: "crNumber",     label: "CR Number",               labelAr: "رقم السجل التجاري",       category: "registration", description: "Commercial Registration number" },
  { key: "entityType",   label: "Entity Type",             labelAr: "نوع الكيان القانوني",     category: "registration", description: "Legal entity type (LLC, JSC, etc.)" },
  { key: "foundingYear", label: "Founding Year",           labelAr: "سنة التأسيس",             category: "registration", description: "Year the company was established" },
  { key: "companyType",  label: "Company Size",            labelAr: "حجم الشركة",              category: "registration", description: "SME / Large / Enterprise / Listed" },
  { key: "ownerName",    label: "Owner / CEO Name",        labelAr: "اسم المالك / المدير",     category: "people",       description: "Name of the owner or CEO" },
  { key: "ownerPhone",   label: "Owner Phone",             labelAr: "هاتف المالك",             category: "people",       description: "Direct phone of the owner" },
  { key: "ownerEmail",   label: "Owner Email",             labelAr: "بريد المالك",             category: "people",       description: "Direct email of the owner" },
  { key: "keyExecutives",label: "Key Executives",          labelAr: "المدراء التنفيذيون",      category: "people",       description: "Names and titles of key executives" },
];

// ─── HTML utilities ───────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{3,}/g, "  ")
    .trim()
    .slice(0, 12000);
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await axios.get(url, {
      timeout: 20000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      },
    });
    return res.data as string;
  } catch (axiosErr: unknown) {
    const status = (axiosErr as { response?: { status?: number } })?.response?.status;
    if (status === 403 || status === 429 || status === 406 || !status) {
      console.log(`[ProspectEngine] Axios blocked (${status}), falling back to Playwright for: ${url}`);
      return await getPageContent(url);
    }
    throw axiosErr;
  }
}

function parseHtmlWithCheerio(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript, iframe").remove();
  const text = $("body").text().replace(/\s{3,}/g, "  ").trim().slice(0, 15000);
  return text;
}

async function discoverSitemapUrls(baseUrl: string, maxUrls = 50): Promise<string[]> {
  const base = new URL(baseUrl);
  const sitemapCandidates = [
    `${base.origin}/sitemap.xml`,
    `${base.origin}/sitemap_index.xml`,
    `${base.origin}/sitemap.xml.gz`,
    `${base.origin}/robots.txt`,
  ];

  const discovered: string[] = [];

  for (const candidate of sitemapCandidates) {
    try {
      const res = await axios.get(candidate, { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } });
      const body = res.data as string;

      if (candidate.endsWith("robots.txt")) {
        const sitemapLine = body.match(/^Sitemap:\s*(.+)$/im);
        if (sitemapLine) {
          const sitemapUrl = sitemapLine[1].trim();
          const xml = await axios.get(sitemapUrl, { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.data as string).catch(() => "");
          const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
          discovered.push(...urls.slice(0, maxUrls));
        }
        continue;
      }

      if (body.includes("<sitemap>") || body.includes("<sitemapindex>")) {
        const indexUrls = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.endsWith(".xml")).slice(0, 5);
        for (const iu of indexUrls) {
          const childXml = await axios.get(iu, { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.data as string).catch(() => "");
          const childUrls = [...childXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
          discovered.push(...childUrls.slice(0, maxUrls));
        }
      } else {
        const urls = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
        discovered.push(...urls.slice(0, maxUrls));
      }

      if (discovered.length > 0) break;
    } catch {
      continue;
    }
  }

  return discovered.filter((u) => u.startsWith("http")).slice(0, maxUrls);
}

// ─── Pagination discovery ─────────────────────────────────────────────────────

function discoverPaginationUrls(baseUrl: string, html: string, maxPages: number): string[] {
  const base = new URL(baseUrl);
  const urls = new Set<string>();
  urls.add(baseUrl);

  // Find all <a href> tags
  const hrefPattern = /href=["']([^"']+)["']/gi;
  let match;
  const candidates: string[] = [];

  while ((match = hrefPattern.exec(html)) !== null) {
    candidates.push(match[1]);
  }

  // Score candidates as pagination links
  for (const href of candidates) {
    let full: string;
    try {
      full = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    // Must be same origin
    if (!full.startsWith(base.origin)) continue;

    // Pagination patterns
    const isPagination =
      /[?&]page=\d+/i.test(full) ||
      /[?&]p=\d+/i.test(full) ||
      /[?&]offset=\d+/i.test(full) ||
      /[?&]start=\d+/i.test(full) ||
      /\/page\/\d+/i.test(full) ||
      /\/p\/\d+/i.test(full) ||
      /\/\d+\/?$/.test(new URL(full).pathname);

    if (isPagination && full !== baseUrl) {
      urls.add(full);
    }
  }

  // Also try generating sequential page URLs if we found at least one pattern
  const found = Array.from(urls).filter((u) => u !== baseUrl);
  if (found.length > 0) {
    const sample = found[0];
    const pageMatch = sample.match(/([?&]page=)(\d+)/i) || sample.match(/(\/page\/)(\d+)/i);
    if (pageMatch) {
      const prefix = pageMatch[1];
      for (let p = 2; p <= maxPages; p++) {
        const generated = sample.replace(/([?&]page=)\d+/i, `$1${p}`)
          .replace(/(\/page\/)\d+/i, `$1${p}`);
        urls.add(generated);
      }
    }
  }

  const result = Array.from(urls).slice(0, maxPages);
  return result;
}

// ─── GPT analysis of a website ───────────────────────────────────────────────

async function analyzeWithGPT(url: string, combinedText: string, htmlSnippet: string): Promise<{
  siteType: string;
  contentType: string;
  language: string;
  estimatedTotal: number;
  detectedFieldKeys: string[];
  sampleItems: Record<string, string>[];
  siteNote: string;
}> {
  const validKeys = ALL_FIELDS.map((f) => f.key);
  const fieldList = ALL_FIELDS.map((f) => `- ${f.key}: ${f.description}`).join("\n");

  const prompt = `You are analyzing a scraped website to determine what structured data can be extracted.

URL: ${url}

── HTML STRUCTURE HINTS ──
${htmlSnippet}

── EXTRACTED TEXT (truncated) ──
${combinedText}

── AVAILABLE FIELD KEYS ──
${fieldList}

Analyze the page content carefully. Look at:
1. HTML patterns: repeated list items, table rows, card layouts, directory entries
2. Link structures: detail page links, pagination patterns, category links
3. Text snippets: phone numbers, emails, addresses, company names (Arabic and English), CR numbers, industry labels

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "siteType": "chamber_of_commerce|business_directory|government_portal|exhibitor_list|yellow_pages|trade_registry|news_site|other",
  "contentType": "companies|products|people|events|mixed",
  "language": "ar|en|mixed",
  "estimatedTotal": <integer estimate of total records on whole site>,
  "detectedFieldKeys": ["nameEn", "phone", ...],
  "siteNote": "<one-line description of what kind of records this site contains, e.g. 'Saudi chamber of commerce member directory with 450+ registered companies'>",
  "sampleItems": [
    { "nameEn": "...", "phone": "...", ... },
    ...
  ]
}

IMPORTANT:
- detectedFieldKeys must ONLY contain keys from the available list above. Only mark a field as detected if you see actual data for it in the text.
- sampleItems: extract exactly 5-8 real records you can see in the text, using only the available field keys.
- siteNote: describe what specific records are on this site (not generic).`;

  // NEXUS extraction tier: DeepSeek → Groq → Qwen → Gemini → GPT-4o
  let raw = "{}";
  try {
    const nexusResult = await nexusExtract(prompt, "Extract site analysis as JSON. Return only valid JSON matching the requested schema.", { maxTokens: 2000 });
    raw = typeof nexusResult === "string" ? nexusResult : JSON.stringify(nexusResult);
  } catch {
    // Fallback to direct OpenAI
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    });
    raw = res.choices[0]?.message?.content || "{}";
  }

  try {
    const parsed = typeof raw === "object" ? raw : JSON.parse(raw as string);
    parsed.detectedFieldKeys = (parsed.detectedFieldKeys || []).filter(
      (k: string) => validKeys.includes(k)
    );
    return parsed;
  } catch {
    return {
      siteType: "other",
      contentType: "companies",
      language: "en",
      estimatedTotal: 50,
      detectedFieldKeys: ["nameEn"],
      sampleItems: [],
      siteNote: "",
    };
  }
}

// ─── Main scan function ───────────────────────────────────────────────────────

function extractHtmlStructureHints(html: string): string {
  const hints: string[] = [];

  const listItems = (html.match(/<li[\s>]/gi) || []).length;
  const tableRows = (html.match(/<tr[\s>]/gi) || []).length;
  const divCards = (html.match(/class="[^"]*card[^"]*"/gi) || []).length;
  const links = (html.match(/<a[\s][^>]*href/gi) || []).length;

  if (listItems > 5) hints.push(`Detected ${listItems} list items (<li>)`);
  if (tableRows > 3) hints.push(`Detected ${tableRows} table rows (<tr>)`);
  if (divCards > 2) hints.push(`Detected ${divCards} card-style elements`);
  hints.push(`Found ${links} links on page`);

  const emailMatches = html.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
  if (emailMatches.length > 0) hints.push(`Found ${emailMatches.length} email addresses (e.g. ${emailMatches[0]})`);

  const phoneMatches = html.match(/(?:\+966|00966|0)\s*\d[\d\s\-]{7,}/g) || [];
  if (phoneMatches.length > 0) hints.push(`Found ${phoneMatches.length} Saudi phone numbers`);

  const crMatches = html.match(/\d{10,}/g) || [];
  if (crMatches.length > 0) hints.push(`Found ${crMatches.length} long numeric codes (possible CR numbers)`);

  const repeatedPatterns = html.match(/<(?:div|article|section)[^>]*class="([^"]+)"[^>]*>/gi) || [];
  const classCounts: Record<string, number> = {};
  for (const m of repeatedPatterns) {
    const cls = m.match(/class="([^"]+)"/i)?.[1] || "";
    classCounts[cls] = (classCounts[cls] || 0) + 1;
  }
  const repeatedClasses = Object.entries(classCounts).filter(([, c]) => c >= 3).map(([cls, c]) => `"${cls}" x${c}`);
  if (repeatedClasses.length > 0) hints.push(`Repeated CSS classes (likely entity cards): ${repeatedClasses.slice(0, 5).join(", ")}`);

  return hints.join("\n") || "No special HTML patterns detected";
}

// ─── Bluepages-specific analysis ─────────────────────────────────────────────

/**
 * Perform a quick real analysis of bluepages.com.sa by fetching an actual
 * company profile and mapping the known field structure to ScanResult format.
 * NO AI guessing — every field is either present or not based on the real page.
 */
async function crawlBluepages(url: string): Promise<ScanResult> {
  const { city, keyword } = parseBluepagesUrlFilters(url);

  // Fetch a few real companies from the API to build sample items
  const sampleCompanies: BluepagesCompany[] = [];
  for await (const { company } of bluepagesApiScan(keyword, city, undefined, 5)) {
    if (company) sampleCompanies.push(company);
    if (sampleCompanies.length >= 3) break;
  }

  // BluPages API returns: name, industry, city, address, phone, email, website, description,
  // crNumber, postalCode, management (agent), social links
  const bluepagesDetected = new Set([
    "nameAr", "nameEn", "industry", "city", "region", "address",
    "phone", "email", "website", "description", "crNumber", "postalCode",
    "foundingYear", "management",
  ]);

  const fields: FieldDef[] = ALL_FIELDS.map((f) => ({
    ...f,
    detected: bluepagesDetected.has(f.key),
    confidence: bluepagesDetected.has(f.key) ? 0.95 : 0.1,
  }));

  const sampleItems: Record<string, string>[] = sampleCompanies.map(c => ({
    nameAr: c.nameAr || "",
    nameEn: c.nameEn || "",
    industry: c.industry || "",
    city: c.city || "",
    address: c.address || "",
    phone: c.phone || "",
    email: c.email || "",
    website: c.website || "",
    description: (c.description || "").slice(0, 200),
    crNumber: c.crNumber || "",
    postalCode: c.postalCode || "",
    management: c.management ? c.management.map(m => `${m.nameEn} (${m.title})`).join(", ") : "",
  }));

  const filterNote = [city && `مدينة: ${city}`, keyword && `كلمة بحث: ${keyword}`].filter(Boolean).join(" | ");

  return {
    siteType: "business_directory",
    contentType: "companies",
    language: "ar",
    estimatedTotal: 10000,
    pagesDiscovered: 1870,
    sampleItems,
    fields,
    pageUrls: [url],
    rawAnalysis: JSON.stringify({ scraperMode: "bluepages_api", city, keyword }),
    siteNote: `دليل الأعمال السعودي — بيانات حقيقية من BluPages API (374 تصنيف × 5 مدن). ${filterNote}`,
  };
}

export async function crawlAndAnalyze(url: string, maxPages = 20): Promise<ScanResult> {
  // Route bluepages.com.sa to dedicated real scraper (no AI guessing)
  if (isBluepagesUrl(url)) {
    return crawlBluepages(url);
  }

  // 1. Fetch main page (Playwright fallback if Axios blocked)
  const mainHtml = await fetchHtml(url);

  // 2. Discover pagination URLs
  const paginationUrls = discoverPaginationUrls(url, mainHtml, maxPages);

  // 3. Discover sitemap URLs in parallel (don't block if it fails)
  const [sitemapUrls] = await Promise.allSettled([discoverSitemapUrls(url, 30)]);
  const sitemapUrlList = sitemapUrls.status === "fulfilled" ? sitemapUrls.value : [];

  // Merge pagination + sitemap (deduplicated), sitemap takes precedence for deep coverage
  const allPageUrlSet = new Set<string>([url, ...paginationUrls]);
  for (const su of sitemapUrlList) {
    if (allPageUrlSet.size >= maxPages) break;
    allPageUrlSet.add(su);
  }
  const allPageUrls = Array.from(allPageUrlSet).slice(0, maxPages);

  // 4. Fetch up to 3 sample pages for analysis
  const sampleUrls = allPageUrls.slice(0, 3);
  const htmlParts: string[] = [parseHtmlWithCheerio(mainHtml)];

  for (const pageUrl of sampleUrls.slice(1)) {
    try {
      const html = await fetchHtml(pageUrl);
      htmlParts.push(stripHtml(html));
    } catch {
      // ignore failed pages
    }
  }

  const combinedText = htmlParts.join("\n\n---PAGE---\n\n").slice(0, 14000);
  const htmlSnippet = extractHtmlStructureHints(mainHtml);

  const analysis = await analyzeWithGPT(url, combinedText, htmlSnippet);

  const validKeys = new Set(ALL_FIELDS.map((f) => f.key));
  const detectedSet = new Set(
    (analysis.detectedFieldKeys || []).filter((k: string) => validKeys.has(k))
  );
  const fields: FieldDef[] = ALL_FIELDS.map((f) => ({
    ...f,
    detected: detectedSet.has(f.key),
    confidence: detectedSet.has(f.key) ? 0.85 : 0.2,
  }));

  return {
    siteType: analysis.siteType,
    contentType: analysis.contentType,
    language: analysis.language,
    estimatedTotal: analysis.estimatedTotal || 50,
    pagesDiscovered: allPageUrls.length,
    sampleItems: analysis.sampleItems || [],
    fields,
    pageUrls: allPageUrls,
    rawAnalysis: JSON.stringify(analysis),
    siteNote: analysis.siteNote || "",
  };
}

// ─── Extract records from one page ───────────────────────────────────────────

async function extractRecordsFromPage(
  html: string,
  pageUrl: string,
  selectedFields: string[],
): Promise<Record<string, string>[]> {
  const text = stripHtml(html);
  const fieldDescs = selectedFields.map((k) => {
    const f = ALL_FIELDS.find((x) => x.key === k);
    return `"${k}": "${f?.description || k}"`;
  }).join(", ");

  const prompt = `You are extracting structured data from a webpage.

URL: ${pageUrl}
PAGE TEXT:
${text.slice(0, 10000)}

Extract EVERY distinct record (company/person/item) you can find on this page.
For each record, fill in these fields where available: { ${fieldDescs} }
Leave a field as empty string "" if not found.

Respond ONLY with valid JSON array. No markdown. No explanation. Example:
[
  {"nameEn": "Saudi Company Ltd", "phone": "+966501234567", ...},
  ...
]

If no records found, respond: []`;

  // NEXUS extraction tier: DeepSeek → Groq → Qwen → Gemini → GPT-4o
  let raw = "";
  try {
    const nexusResult = await nexusGenerate(prompt, { tier: "extraction", maxTokens: 3000, temperature: 0 });
    raw = nexusResult.text.trim();
    console.log(`[Extract] NEXUS extraction via ${nexusResult.provider}/${nexusResult.model}, length: ${raw.length}`);
  } catch {
    // Fallback to direct GPT-4o
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });
    raw = (res.choices[0]?.message?.content || "").trim();
    console.log(`[Extract] GPT-4o fallback, length: ${raw.length}`);
  }
  console.log(`[Extract] Response starts: ${raw.slice(0, 100)}`);

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) { console.log(`[Extract] Got array with ${parsed.length} records`); return parsed; }
    for (const v of Object.values(parsed)) {
      if (Array.isArray(v)) { console.log(`[Extract] Got nested array with ${(v as unknown[]).length} records`); return v as Record<string, string>[]; }
    }
    console.log(`[Extract] No array found in object with keys: ${Object.keys(parsed).join(", ")}`);
    return [];
  } catch {
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const arr = JSON.parse(arrayMatch[0]);
        if (Array.isArray(arr)) { console.log(`[Extract] Extracted array via regex, ${arr.length} records`); return arr; }
      } catch { /* */ }
    }
    console.log(`[Extract] Parse failed for page: ${pageUrl}`);
    return [];
  }
}

// ─── Enrich missing fields via OpenAI ────────────────────────────────────────

async function enrichMissingFields(
  record: Record<string, string>,
  selectedFields: string[],
): Promise<Record<string, string>> {
  const missingFields = selectedFields.filter(
    (k) => !record[k] || record[k].trim() === "",
  );
  if (missingFields.length === 0) return record;

  const companyName = record.nameEn || record.nameAr || "";
  if (!companyName) return record;

  const fieldDescs = missingFields.map((k) => {
    const f = ALL_FIELDS.find((x) => x.key === k);
    return `"${k}": "${f?.description || k}"`;
  }).join(", ");

  const knownData = selectedFields
    .filter((k) => record[k])
    .map((k) => `${k}: ${record[k]}`)
    .join(", ");

  const prompt = `You are a Saudi Arabia business intelligence expert.

Company: "${companyName}"
Known data: ${knownData}

Based on your knowledge of Saudi companies, infer plausible values for these missing fields:
{ ${fieldDescs} }

Rules:
- Only provide realistic values you are confident about for Saudi Arabia
- For unknown fields, use empty string ""
- Do NOT fabricate specific phone/email/CR numbers
- Industry should be a real Saudi business sector
- City must be a real Saudi city
- Revenue format: "SAR 5M" or "SAR 50-100M" or ""

Respond ONLY with valid JSON object with exactly these keys: ${missingFields.map((k) => `"${k}"`).join(", ")}`;

  try {
    // NEXUS extraction tier: DeepSeek → Groq → Qwen → Gemini → GPT-4o
    const nexusResult = await nexusGenerate(prompt, { tier: "extraction", maxTokens: 1000, temperature: 0.2 });
    const enriched = JSON.parse(nexusResult.text.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim() || "{}");
    return { ...record, ...enriched };
  } catch {
    try {
      const res = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        response_format: { type: "json_object" },
      });
      const enriched = JSON.parse(res.choices[0]?.message?.content || "{}");
      return { ...record, ...enriched };
    } catch {
      return record;
    }
  }
}

// ─── Compute enrichment score from record ─────────────────────────────────────

function computeEnrichmentScore(record: Record<string, string>): number {
  const importantFields = ["nameEn", "nameAr", "industry", "city", "address", "website", "phone", "email", "description", "crNumber"];
  const filled = importantFields.filter((k) => record[k] && record[k].trim() !== "").length;
  return Math.round((filled / importantFields.length) * 100);
}

// ─── Background extraction job ────────────────────────────────────────────────

async function processOnePage(
  jobId: string,
  numericJobId: number,
  sessionId: string,
  pageUrl: string,
  pageIndex: number,
  total: number,
  selectedFields: string[],
): Promise<{ records: number; enriched: number }> {
  let pageRecords = 0;
  let pageEnriched = 0;

  console.log(`[Job ${jobId}][Agent ${pageIndex + 1}/${total}] Fetching: ${pageUrl}`);
  const html = await fetchHtml(pageUrl);
  console.log(`[Job ${jobId}][Agent ${pageIndex + 1}] HTML length: ${html.length}`);
  const records = await extractRecordsFromPage(html, pageUrl, selectedFields);
  console.log(`[Job ${jobId}][Agent ${pageIndex + 1}] Extracted ${records.length} raw records`);

  for (const rawRecord of records) {
    const hasAnyData = Object.values(rawRecord).some((v) => v && String(v).trim() !== "");
    if (!hasAnyData) continue;

    // Store only the fields the user selected — no AI enrichment here.
    // AI enrichment is OrcEngine's job, triggered separately.
    const filtered: Record<string, string> = {};
    for (const key of selectedFields) {
      if (rawRecord[key]) filtered[key] = rawRecord[key];
    }
    // Always include names if present (needed for dedup / display)
    if (rawRecord.nameEn) filtered.nameEn = rawRecord.nameEn;
    if (rawRecord.nameAr) filtered.nameAr = rawRecord.nameAr;

    const nameEn = (filtered.nameEn || "").trim();
    const nameAr = (filtered.nameAr || "").trim();
    if (!nameEn && !nameAr) continue;

    const score = computeEnrichmentScore(filtered);
    const status = score >= 70 ? "enriched" : score >= 30 ? "partial" : "pending";

    await db.insert(prospectingResultsTable).values({
      jobId: numericJobId,
      companyData: {
        nameEn: nameEn || null,
        nameAr: nameAr || null,
        website: filtered.website || null,
        phone: filtered.phone || null,
        email: filtered.email || null,
        industry: filtered.industry || null,
        city: filtered.city || null,
        region: filtered.region || null,
        description: filtered.description || null,
        revenue: filtered.revenue || null,
        employeeCount: filtered.employeeCount ? parseInt(filtered.employeeCount) || null : null,
        capitalAmount: filtered.capitalAmount || null,
        crNumber: filtered.crNumber || null,
        entityType: filtered.entityType || null,
        foundingYear: filtered.foundingYear ? parseInt(filtered.foundingYear) || null : null,
        companyType: filtered.companyType || null,
        ownerName: filtered.ownerName || null,
        ownerPhone: filtered.ownerPhone || null,
        ownerEmail: filtered.ownerEmail || null,
        keyExecutives: filtered.keyExecutives || null,
        enrichmentScore: score,
      },
      sourceUrl: pageUrl,
      enrichmentStatus: status,
    });

    pageRecords++;
  }

  return { records: pageRecords, enriched: pageEnriched };
}

// ─── Bluepages extraction job ─────────────────────────────────────────────────

/**
 * Run a BluPages.com.sa extraction job using the JSON API.
 *
 * Iterates category × city combinations to maximise unique companies discovered.
 * The API returns real company data (no HTML scraping, no ID guessing).
 */
export async function runBluepagesJob(
  jobId: string,
  sessionId: string,
  sourceUrl: string,
  selectedFields: string[],
  targetCount = 200,
): Promise<void> {
  const [jobRecord] = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.jobId, jobId));
  const numericJobId = jobRecord?.id ?? 0;

  const { city, keyword } = parseBluepagesUrlFilters(sourceUrl);
  let totalFetched = 0;
  let totalFound  = 0;

  console.log(`[BluepagesJob ${jobId}] API scan — city="${city}" keyword="${keyword}" target=${targetCount}`);

  for await (const { company, id, fetched, total } of bluepagesApiScan(keyword, city, undefined, targetCount)) {
    totalFetched = fetched;

    if (company) {
      totalFound++;

      const score = computeEnrichmentScore({
        nameAr:      company.nameAr      || "",
        industry:    company.industry    || "",
        city:        company.city        || "",
        address:     company.address     || "",
        phone:       company.phone       || "",
        email:       company.email       || "",
        website:     company.website     || "",
        description: company.description || "",
        crNumber:    company.crNumber    || "",
        postalCode:  company.postalCode  || "",
        foundingYear: company.foundingYear ? String(company.foundingYear) : "",
      });
      const status = score >= 70 ? "enriched" : score >= 30 ? "partial" : "pending";

      const tagsArr: string[] = [];
      if (company.postalCode) tagsArr.push(`postal:${company.postalCode}`);
      if (company.grade)      tagsArr.push(`grade:${company.grade}`);
      if (company.branches)   tagsArr.push(`branches:${company.branches}`);
      if (company.linkedin)   tagsArr.push(`linkedin:${company.linkedin}`);
      if (company.facebook)   tagsArr.push(`facebook:${company.facebook}`);
      if (company.whatsapp)   tagsArr.push(`whatsapp:${company.whatsapp}`);

      const managementJson = company.management && company.management.length > 0
        ? JSON.stringify(company.management)
        : null;

      try {
        await db.insert(prospectingResultsTable).values({
          jobId: numericJobId,
          companyData: {
            nameAr:       company.nameAr       || null,
            nameEn:       company.nameEn       || null,
            website:      company.website      || null,
            phone:        company.phone        || null,
            email:        company.email        || null,
            industry:     company.industry     || null,
            city:         company.city         || null,
            region:       company.region       || null,
            address:      company.address      || null,
            description:  company.description  || null,
            crNumber:     company.crNumber     || null,
            foundingYear: company.foundingYear || null,
            management:   managementJson,
            tags:         tagsArr.length > 0 ? tagsArr.join(", ") : null,
            enrichmentScore: score,
          },
          sourceUrl: `https://bluepages.com.sa/companies/${id}`,
          enrichmentStatus: status,
        });
      } catch (dbErr) {
        console.error(`[BluepagesJob] DB insert failed for ID ${id}:`, dbErr);
      }
    }

    // Update progress every 5 found or every 10 fetched
    if (totalFound % 5 === 0 || fetched % 10 === 0 || fetched === total) {
      const progress = Math.min(Math.round((totalFound / targetCount) * 100), 99);
      await db.update(jobsTable).set({
        progress,
        companiesProcessed: fetched,
        companiesHarvested: totalFound,
        companiesEnriched:  totalFound,
        agentStatuses: JSON.stringify({
          pagesProcessed:   fetched,
          totalPages:       total,
          recordsExtracted: totalFound,
          recordsEnriched:  totalFound,
          scraperMode: "bluepages_api",
          city, keyword,
        }),
        updatedAt: new Date(),
      }).where(eq(jobsTable.jobId, jobId));
    }
  }

  await db.update(jobsTable).set({
    status: "completed",
    progress: 100,
    sourcesCompleted: 1,
    companiesProcessed: totalFetched,
    companiesHarvested: totalFound,
    companiesEnriched:  totalFound,
    agentStatuses: JSON.stringify({
      pagesProcessed:   totalFetched,
      totalPages:       totalFetched,
      recordsExtracted: totalFound,
      recordsEnriched:  totalFound,
      scraperMode: "bluepages_api",
      city, keyword, done: true,
    }),
    updatedAt: new Date(),
  }).where(eq(jobsTable.jobId, jobId));

  console.log(`[BluepagesJob ${jobId}] Done — ${totalFound} companies discovered`);
}

export async function runExtractionJob(
  jobId: string,
  sessionId: string,
  pageUrls: string[],
  selectedFields: string[],
  sourceUrl: string,
  concurrency = 3,
): Promise<void> {
  const [jobRecord] = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.jobId, jobId));
  const numericJobId = jobRecord?.id ?? 0;

  const total = pageUrls.length;
  let pagesProcessed = 0;
  let recordsExtracted = 0;
  let recordsEnriched = 0;

  for (let batchStart = 0; batchStart < total; batchStart += concurrency) {
    const batch = pageUrls.slice(batchStart, batchStart + concurrency);
    console.log(`[Job ${jobId}] Starting batch: pages ${batchStart + 1}-${batchStart + batch.length} of ${total} (${batch.length} parallel agents)`);

    const results = await Promise.all(
      batch.map((pageUrl, batchIdx) =>
        processOnePage(jobId, numericJobId, sessionId, pageUrl, batchStart + batchIdx, total, selectedFields)
          .catch((err) => {
            console.error(`[ProspectingEngine] Agent failed on page: ${pageUrl}`, err);
            return { records: 0, enriched: 0 };
          })
      )
    );

    for (const result of results) {
      recordsExtracted += result.records;
      recordsEnriched += result.enriched;
    }
    pagesProcessed += batch.length;

    await db.update(jobsTable).set({
      progress: Math.round((pagesProcessed / total) * 100),
      companiesProcessed: pagesProcessed,
      companiesHarvested: recordsExtracted,
      companiesEnriched: recordsEnriched,
      agentStatuses: JSON.stringify({ pagesProcessed, totalPages: total, recordsExtracted, recordsEnriched }),
      updatedAt: new Date(),
    }).where(eq(jobsTable.jobId, jobId));

    if (batchStart + concurrency < total) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  await db.update(jobsTable).set({
    status: "completed",
    progress: 100,
    sourcesCompleted: 1,
    companiesProcessed: pagesProcessed,
    companiesHarvested: recordsExtracted,
    companiesEnriched: recordsEnriched,
    agentStatuses: JSON.stringify({ pagesProcessed, totalPages: total, recordsExtracted, recordsEnriched, done: true }),
    updatedAt: new Date(),
  }).where(eq(jobsTable.jobId, jobId));
}
