import { db } from "@workspace/db";
import { prospectingJobsTable, prospectingResultsTable, enrichmentReportsTable, companiesTable } from "@workspace/db";
import type { ProspectingJob, ProspectingResult, ProspectingCompanyResult, SiteScanSummary, ProspectingSettings, EnrichmentReportData, FastEnrichmentResult } from "@workspace/db";
import { eq, desc, inArray, ilike } from "drizzle-orm";
import { multiAgentScrape, crawlFullWebsite, getBestContent } from "./scraper";
import type { ScrapeResultItem, MultiAgentScrapeResult } from "./scraper";
import { getPageContent, parseHtml } from "../browser-helper";
import { openai } from "../openai-client";
import { synthesizeWithGemini, extractCompaniesWithGemini, isGeminiConfigured } from "../gemini-search";
import { nexusExtract } from "../lib/nexus/index.js";

/**
 * Routes JSON-extraction calls through Nexus instead of instantiating
 * Anthropic directly. Nexus picks the cheapest capable model (DeepSeek →
 * Groq → Mistral → Gemini → Claude). The function name keeps the original
 * `_callClaudeJson` for minimal blast radius on the 7+ call sites.
 */
async function _callClaudeJson(userContent: string, systemContent: string, _maxTokens = 2000): Promise<string> {
  const prompt = `${systemContent} Return ONLY valid JSON.\n\n${userContent}`;
  const result = await nexusExtract(prompt, "Return only the JSON object the user asked for.");
  return result.text || "{}";
}
import {
  exportProspectingToCSV,
  exportProspectingToJSON,
  exportProspectingToExcel,
  exportProspectingToPDF,
} from "./export-service";
import type { ProspectingCompanyExport, ProspectingEnrichmentData } from "./export-service";

interface ExtractionResponse {
  items?: Record<string, unknown>[];
  companies?: ExtractedCompany[];
  results?: ExtractedCompany[];
}

interface ExtractedCompany {
  name?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  industry?: string;
  description?: string;
  contactPerson?: string;
  extras?: Record<string, string>;
}


function flattenScrapeResults(scrapeResults: MultiAgentScrapeResult): ScrapeResultItem[] {
  return [
    ...(scrapeResults.playwrightResults || []),
    ...(scrapeResults.crawl4aiResults || []),
    ...(scrapeResults.basicResults || []),
  ];
}

async function crawlWithLoadMore(url: string, maxClicks: number = 10): Promise<string> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    let previousHeight = 0;
    let clickCount = 0;

    for (let i = 0; i < maxClicks; i++) {
      const loadMoreBtn = await page.$('button:has-text("Load More"), button:has-text("Show More"), a:has-text("Load More"), [class*="load-more"], [class*="show-more"], button:has-text("More Results")');
      if (loadMoreBtn) {
        await loadMoreBtn.click();
        await page.waitForTimeout(2000);
        clickCount++;
      } else {
        const currentHeight = await page.evaluate(() => document.body.scrollHeight);
        if (currentHeight === previousHeight) break;
        previousHeight = currentHeight;
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
      }
    }
    console.log(`[Prospecting] Load-more/scroll: ${clickCount} interactions on ${url}`);
    const content = await page.evaluate(() => document.body.innerText);
    await page.close();
    await context.close();
    await browser.close();
    return content;
  } catch {
    return "";
  }
}

async function crawlPageContent(url: string): Promise<string> {
  try {
    const results: MultiAgentScrapeResult = await multiAgentScrape([url]);
    return getBestContent(flattenScrapeResults(results));
  } catch {
    try {
      const html = await getPageContent(url, { waitMs: 3000 });
      const $ = parseHtml(html);
      return $('body').text().replace(/\s+/g, ' ').trim();
    } catch {
      return "";
    }
  }
}

const WAF_INDICATORS = [
  'access to this site has been limited',
  'access denied',
  'attention required',
  'checking your browser',
  'please wait while we verify',
  'cloudflare',
  'wordfence',
  'sucuri',
  'ddos protection',
  'just a moment',
  'ray id',
  'security check',
  'blocked by',
  'captcha',
  'challenge-platform',
  'cf-browser-verification',
];

function isWafBlocked(html: string, text: string): boolean {
  const lowerHtml = html.toLowerCase();
  const lowerText = text.toLowerCase();
  const matchCount = WAF_INDICATORS.filter(indicator =>
    lowerHtml.includes(indicator) || lowerText.includes(indicator)
  ).length;
  if (matchCount >= 2) return true;
  if (text.length < 200 && matchCount >= 1) return true;
  return false;
}

function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) return true;
    const blockedHosts = new Set([
      'localhost', '0.0.0.0', '[::1]', '[::]', '::',
      'metadata.google.internal', 'metadata.google', 'instance-data', 'metadata',
    ]);
    const hn = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (blockedHosts.has(hn)) return true;
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hn)) return true;
    if (hn === '::1' || hn === '0:0:0:0:0:0:0:1') return true;
    if (/^0+\.0+\.0+\.0+$/.test(hn)) return true;
    if (hn.startsWith('10.')) return true;
    if (hn.startsWith('192.168.')) return true;
    if (hn.startsWith('172.')) {
      const oct2 = parseInt(hn.split('.')[1], 10);
      if (oct2 >= 16 && oct2 <= 31) return true;
    }
    if (hn.startsWith('169.254.') || /^fe80/i.test(hn)) return true;
    if (/^f[cd]/i.test(hn)) return true;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hn)) return true;
    if (/^\d+$/.test(hn) || /^0x/i.test(hn) || /^0\d/.test(hn)) return true;
    return false;
  } catch {
    return true;
  }
}

async function fastFetchPage(url: string, timeoutMs: number = 8000): Promise<{ html: string; text: string }> {
  if (isPrivateUrl(url)) {
    throw new Error(`Blocked private/internal URL: ${url}`);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
    });
    clearTimeout(timer);
    const html = await res.text();
    const $ = parseHtml(html);
    $('script, style, noscript, svg, iframe').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    if (isWafBlocked(html, text) || text.length < 100) {
      console.log(`[Prospecting] WAF/thin content detected for ${url}, falling back to Playwright`);
      throw new Error('WAF blocked or thin content');
    }

    return { html, text };
  } catch (fetchErr) {
    try {
      console.log(`[Prospecting] Fast fetch failed for ${url}, trying Playwright...`);
      // Saudi .sa domains typically need longer render time (Odoo, government CMS, etc.)
      const isSaudiDomain = url.includes('.sa') || url.includes('.com.sa');
      const html = await getPageContent(url, { waitMs: isSaudiDomain ? 10000 : 5000 });
      const $ = parseHtml(html);
      $('script, style, noscript, svg, iframe').remove();
      const text = $('body').text().replace(/\s+/g, ' ').trim();
      if (text.length > 50) {
        console.log(`[Prospecting] Playwright succeeded for ${url} (${text.length} chars)`);
        return { html, text };
      }
      console.log(`[Prospecting] Playwright returned thin content for ${url} (${text.length} chars)`);
      return { html: '', text: '' };
    } catch (pwErr) {
      console.log(`[Prospecting] Playwright also failed for ${url}: ${(pwErr as Error).message?.substring(0, 80)}`);
      return { html: '', text: '' };
    }
  }
}

export async function scanWebsite(targetUrl: string): Promise<ProspectingJob> {
  const [job] = await db.insert(prospectingJobsTable).values({
    targetUrl,
    status: "scanning",
    settings: { targetUrl, maxPages: 50, extractionFields: [], filters: {}, enrichmentDepth: 'standard' } satisfies ProspectingSettings,
  }).returning();

  scanWebsiteAsync(job.id, targetUrl).catch(err => {
    console.error(`[Prospecting] Scan failed: ${(err as Error).message}`);
  });

  return job;
}

const IRRELEVANT_PATH_PATTERNS = [
  /\/(login|signin|sign-in|signup|sign-up|register)\b/i,
  /\/(forgot|reset)[-_]?password/i,
  /\/(cart|checkout|payment|billing)\b/i,
  /\/(privacy|terms|cookie|gdpr|disclaimer)\b/i,
  /\/(admin|dashboard|account|profile|settings)\b/i,
  /\/(analytics|tracking)\b/i,
  /\/#$/,
  /\.(jpg|jpeg|png|gif|svg|pdf|css|js|woff|ttf|ico)$/i,
];

function filterRelevantUrls(urls: string[], baseHostname: string): string[] {
  return urls.filter(u => {
    try {
      const parsed = new URL(u);
      if (parsed.hostname !== baseHostname) return false;
      const path = parsed.pathname + parsed.search;
      return !IRRELEVANT_PATH_PATTERNS.some(p => p.test(path));
    } catch { return false; }
  });
}

function detectContentLanguage(content: string): 'arabic' | 'english' | 'mixed' {
  const arabicChars = (content.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (content.match(/[a-zA-Z]/g) || []).length;
  const total = arabicChars + latinChars;
  if (total === 0) return 'english';
  const arabicRatio = arabicChars / total;
  if (arabicRatio > 0.4) return arabicRatio > 0.7 ? 'arabic' : 'mixed';
  return 'english';
}

// Well-known Saudi Chamber / business directory member listing paths
// Chambers use Odoo, custom CMS, or government portals — all have predictable structures
const SAUDI_CHAMBER_MEMBER_PATHS = [
  '/ar/members', '/en/members', '/members',
  '/ar/members/search', '/en/members/search', '/members/search',
  '/ar/company', '/en/company', '/companies',
  '/ar/directory', '/en/directory', '/directory',
  '/ar/search', '/en/search',
  '/ar/businesses', '/en/businesses', '/businesses',
  '/ar/catalog', '/en/catalog',
  '/ar/register', '/ar/members/list', '/en/members/list',
  '/member-companies', '/member-list',
  '/الأعضاء', '/الشركات', '/دليل-الأعضاء',
];

async function findListingPages(targetUrl: string, allLinks: string[]): Promise<string[]> {
  const listingPatterns = [
    /search/i, /directory/i, /listing/i, /companies/i, /members/i,
    /catalog/i, /browse/i, /category/i, /results/i, /businesses/i,
    /firms/i, /organizations/i, /find/i, /explore/i, /all[-_]?compan/i,
    /index/i, /page/i, /list/i,
    /بحث/i, /شركات/i, /دليل/i, /أعضاء/i, /تصنيف/i,
  ];

  const candidates = allLinks.filter(url => {
    try {
      const path = new URL(url).pathname + new URL(url).search;
      return listingPatterns.some(p => p.test(path));
    } catch { return false; }
  });

  if (candidates.length > 0) return candidates.slice(0, 8);

  // Probe common Saudi Chamber / directory member paths
  try {
    const base = new URL(targetUrl);
    const probed: string[] = [];
    for (const path of SAUDI_CHAMBER_MEMBER_PATHS) {
      const probeUrl = `${base.protocol}//${base.host}${path}`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const r = await fetch(probeUrl, {
          method: 'HEAD',
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ar,en;q=0.9' },
          redirect: 'follow',
        });
        clearTimeout(timer);
        if (r.ok || r.status === 200) {
          probed.push(probeUrl);
          console.log(`[Prospecting] Found member directory path: ${probeUrl}`);
          if (probed.length >= 3) break;
        }
      } catch { /* path not found */ }
    }
    if (probed.length > 0) return probed;
  } catch { /* ignore probe errors */ }

  const nonHomepageLinks = allLinks.filter(u => {
    try {
      const path = new URL(u).pathname;
      return path !== '/' && path.length > 1;
    } catch { return false; }
  });
  return nonHomepageLinks.slice(0, 3);
}

const CITY_SLUG_MAP: Record<string, string[]> = {
  riyadh: ['riyadh', 'الرياض', 'ryd'],
  jeddah: ['jeddah', 'jedda', 'جدة', 'jed'],
  mecca: ['mecca', 'makkah', 'مكة', 'mak'],
  medina: ['medina', 'madinah', 'المدينة', 'med'],
  dammam: ['dammam', 'الدمام', 'dam'],
  khobar: ['khobar', 'الخبر', 'kho'],
  dhahran: ['dhahran', 'الظهران'],
  jubail: ['jubail', 'الجبيل'],
  tabuk: ['tabuk', 'تبوك'],
  abha: ['abha', 'أبها'],
  taif: ['taif', 'الطائف'],
};

function getCitySlugs(city: string): string[] {
  const lower = city.toLowerCase().trim();
  for (const [key, slugs] of Object.entries(CITY_SLUG_MAP)) {
    if (lower === key || slugs.some(s => lower.includes(s) || s.includes(lower))) {
      return slugs;
    }
  }
  return [lower, lower.replace(/\s+/g, '-'), lower.replace(/\s+/g, '_')];
}

function prioritizeCityFilteredUrls(urls: string[], cityFilter: string): string[] {
  if (!cityFilter || cityFilter.toLowerCase() === 'all cities' || cityFilter.toLowerCase() === 'all') {
    return urls;
  }

  const slugs = getCitySlugs(cityFilter);
  const cityUrls: string[] = [];
  const otherUrls: string[] = [];

  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const fullPath = (parsed.pathname + parsed.search + parsed.hash).toLowerCase();
      const decodedPath = decodeURIComponent(fullPath).toLowerCase();
      const isCityUrl = slugs.some(slug => {
        const lowerSlug = slug.toLowerCase();
        return fullPath.includes(lowerSlug) ||
          decodedPath.includes(lowerSlug) ||
          fullPath.includes(`city=${encodeURIComponent(slug).toLowerCase()}`) ||
          fullPath.includes(`location=${encodeURIComponent(slug).toLowerCase()}`) ||
          fullPath.includes(`region=${encodeURIComponent(slug).toLowerCase()}`);
      });
      if (isCityUrl) {
        cityUrls.push(url);
      } else {
        otherUrls.push(url);
      }
    } catch {
      otherUrls.push(url);
    }
  }

  if (cityUrls.length > 0) {
    console.log(`[Prospecting] Found ${cityUrls.length} city-filtered URLs for "${cityFilter}"`);
  }
  return [...cityUrls, ...otherUrls];
}

interface ListingItem {
  name: string;
  detailUrl?: string;
  phone?: string;
  email?: string;
  city?: string;
  industry?: string;
}

function extractDetailLinksFromHtml(html: string, baseUrl: string): Array<{ text: string; href: string }> {
  const $ = parseHtml(html);
  const baseHostname = new URL(baseUrl).hostname;
  const links: Array<{ text: string; href: string }> = [];
  const seen = new Set<string>();

  const NAV_PATTERNS = /\/(login|signup|register|cart|checkout|about|contact|privacy|terms|faq|help|blog|careers|jobs)\b/i;

  const selectors = [
    '.company-name a', '.business-name a', '.listing-title a',
    '.card-title a', '.result-title a', '.item-title a',
    '[class*="company"] a', '[class*="listing"] a', '[class*="card"] a',
    '[class*="member"] a', '[class*="profile"] a', '[class*="result"] a',
    'h3 a', 'h4 a', 'h2 a',
    'a[href*="company"]', 'a[href*="profile"]', 'a[href*="business"]',
    'a[href*="firm"]', 'a[href*="member"]', 'a[href*="detail"]',
    'a[href*="view"]', 'a[href*="establishment"]',
    'a[href*="شركة"]', 'a[href*="مؤسسة"]', 'a[href*="منشأة"]',
  ];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const resolved = new URL(href, baseUrl);
        if (resolved.hostname !== baseHostname) return;
        if (resolved.href === baseUrl || resolved.pathname === '/') return;
        if (NAV_PATTERNS.test(resolved.pathname)) return;
        if (seen.has(resolved.href)) return;
        seen.add(resolved.href);
        let text = $(el).text().trim();
        if (!text || text.length < 2) {
          const parent = $(el).closest('[class*="card"], [class*="listing"], [class*="item"], [class*="result"], tr, li');
          if (parent.length) {
            const parentText = parent.find('h2, h3, h4, .title, .name, [class*="name"]').first().text().trim();
            if (parentText && parentText.length > 2) text = parentText;
          }
        }
        if (text && text.length >= 2 && text.length < 150) {
          links.push({ text, href: resolved.href });
        }
      } catch { /* skip */ }
    });
  }

  return links.slice(0, 50);
}

async function parseCompanyDetailPage(
  detailUrl: string,
  companyHint: string,
  settings: ProspectingSettings,
): Promise<ProspectingCompanyResult | null> {
  try {
    const { html, text } = await fastFetchPage(detailUrl, 12000);
    if (text.length < 80) return null;

    const contacts = extractContactsFromHtml(html);

    const outputLang = settings.extractionLanguage || 'english';
    const langInstruction = outputLang === 'arabic'
      ? `OUTPUT LANGUAGE: Arabic (العربية). Keep phone numbers, emails, websites in original format.`
      : `OUTPUT LANGUAGE: English. Translate Arabic content to English. Keep phone numbers, emails, websites in original format.`;

    const scrapedSection = (contacts.landlines.length > 0 || contacts.phones.length > 0 || contacts.emails.length > 0)
      ? `\nSCRAPED CONTACTS (from HTML — these are real, use them):\n${contacts.landlines.length > 0 ? `Landlines: ${contacts.landlines.join(', ')}\n` : ''}${contacts.phones.length > 0 ? `Phones: ${contacts.phones.join(', ')}\n` : ''}${contacts.emails.length > 0 ? `Emails: ${contacts.emails.join(', ')}\n` : ''}`
      : '';

    const detailPrompt = `You are parsing a COMPANY PROFILE PAGE from a business directory. Extract ALL real data visible on this page about the company.

${langInstruction}

Company hint (from listing): "${companyHint}"
Profile URL: ${detailUrl}
${scrapedSection}

PAGE CONTENT:
${text.substring(0, 10000)}

Return ONLY valid JSON:
{
  "name": "Full company name as shown on this page",
  "phone": "phone number",
  "email": "email address",
  "website": "company's own website (NOT the directory URL)",
  "address": "full address",
  "city": "city",
  "industry": "industry/sector",
  "category": "business category",
  "description": "company description or about text",
  "contactPerson": "contact person name if shown",
  "crNumber": "commercial registration number if shown",
  "employees": "employee count or range",
  "revenue": "revenue if shown",
  "founded": "founding year",
  "services": "services or products offered",
  "entityType": "LLC/JSC/sole proprietorship etc",
  "ownerName": "owner or CEO name if shown",
  "capital": "paid-up capital if shown"
}

RULES:
1. Extract ONLY data that is actually visible on this page — NEVER fabricate
2. If a field is not on the page, omit it or set to null
3. The "website" field must be the company's OWN website, not the directory URL (${new URL(detailUrl).hostname})
4. Read Arabic text fluently
5. Phone numbers from the scraped contacts above are VERIFIED — always include them`;

    let detailContent: string;
    // Gemini (1st) → Claude (2nd) → GPT-4o (3rd)
    if (isGeminiConfigured()) {
      try {
        detailContent = (await synthesizeWithGemini(detailPrompt, "You are a Saudi Arabia business data extraction specialist. Return ONLY valid JSON.", "gemini-2.5-flash")) ?? '{}';
      } catch {
        try {
          detailContent = await _callClaudeJson(detailPrompt, "You are a Saudi Arabia business data extraction specialist.", 1500);
        } catch {
          try {
            const r = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: detailPrompt }], response_format: { type: "json_object" }, max_tokens: 1500 });
            detailContent = r.choices[0]?.message?.content || '{}';
          } catch { detailContent = '{}'; }
        }
      }
    } else {
      try {
        detailContent = await _callClaudeJson(detailPrompt, "You are a Saudi Arabia business data extraction specialist.", 1500);
      } catch {
        try {
          const r = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: detailPrompt }], response_format: { type: "json_object" }, max_tokens: 1500 });
          detailContent = r.choices[0]?.message?.content || '{}';
        } catch { detailContent = '{}'; }
      }
    }

    const parsed = JSON.parse(detailContent.match(/\{[\s\S]*\}/)?.[0] || '{}') as Record<string, unknown>;
    const name = String(parsed.name || companyHint || '').trim();
    if (!name || name.length < 2) return null;

    const get = (k: string) => {
      const v = parsed[k];
      return typeof v === 'string' && v.trim() && v.trim() !== 'null' && v.trim() !== 'N/A' && v.trim() !== 'Unknown' ? v.trim() : undefined;
    };

    const extras: Record<string, string> = {};
    const EXTRA_KEYS = ['founded', 'services', 'entityType', 'ownerName', 'capital', 'shareholders', 'keyPeople', 'marketPositioning', 'landline', 'location'];
    for (const ek of EXTRA_KEYS) {
      const v = get(ek);
      if (v) extras[ek] = v;
    }
    if (contacts.landlines.length > 0 && !extras.landline) extras.landline = contacts.landlines[0];

    return {
      name,
      phone: get('phone') || (contacts.phones.length > 0 ? contacts.phones[0] : undefined) || (contacts.landlines.length > 0 ? contacts.landlines[0] : undefined),
      email: get('email') || (contacts.emails.length > 0 ? contacts.emails[0] : undefined),
      website: get('website'),
      address: get('address'),
      city: get('city'),
      industry: get('industry'),
      category: get('category'),
      description: get('description'),
      contactPerson: get('contactPerson'),
      crNumber: get('crNumber'),
      employees: get('employees'),
      revenue: get('revenue'),
      extras: Object.keys(extras).length > 0 ? extras : undefined,
      enrichmentStatus: 'pending',
      sourceUrl: detailUrl,
    };
  } catch (e) {
    console.log(`[Prospecting] Detail page parse failed for ${detailUrl}: ${(e as Error).message?.substring(0, 80)}`);
    return null;
  }
}

async function extractCompaniesViaDetailPages(
  listingHtml: string,
  listingUrl: string,
  settings: ProspectingSettings,
  jobId: number,
  existingNames: Set<string>,
): Promise<ProspectingCompanyResult[]> {
  const detailLinks = extractDetailLinksFromHtml(listingHtml, listingUrl);
  if (detailLinks.length === 0) {
    console.log(`[Prospecting] No detail links found on ${listingUrl}`);
    return [];
  }

  console.log(`[Prospecting] Found ${detailLinks.length} company detail links on ${listingUrl}`);

  const results: ProspectingCompanyResult[] = [];
  const CONCURRENT = 3;

  for (let i = 0; i < detailLinks.length; i += CONCURRENT) {
    const chunk = detailLinks.slice(i, i + CONCURRENT);
    const promises = chunk.map(({ text, href }) => {
      if (existingNames.has(text.toLowerCase().trim())) {
        console.log(`[Prospecting] Skipping duplicate: ${text}`);
        return Promise.resolve(null);
      }
      return parseCompanyDetailPage(href, text, settings);
    });

    const parsed = await Promise.allSettled(promises);
    for (const r of parsed) {
      if (r.status === 'fulfilled' && r.value) {
        const nameLower = r.value.name.toLowerCase().trim();
        if (!existingNames.has(nameLower)) {
          existingNames.add(nameLower);
          results.push(r.value);
        }
      }
    }

    if (results.length > 0 && (i + CONCURRENT) % 9 === 0) {
      await db.update(prospectingJobsTable).set({
        totalCompaniesFound: existingNames.size,
      }).where(eq(prospectingJobsTable.id, jobId));
    }

    console.log(`[Prospecting] Detail pages ${i + 1}-${Math.min(i + CONCURRENT, detailLinks.length)}/${detailLinks.length}: ${results.length} companies parsed so far`);
  }

  return results;
}

async function scanWebsiteAsync(jobId: number, targetUrl: string) {
  const startTime = Date.now();
  console.log(`[Prospecting] ⚡ Fast scan started: ${targetUrl}`);
  try {
    let homepageHtml = '';
    let homepageText = '';
    let usedAiFallback = false;

    const fetched = await fastFetchPage(targetUrl);
    homepageHtml = fetched.html;
    homepageText = fetched.text;

    if (!homepageText || homepageText.length < 50) {
      console.log(`[Prospecting] Direct crawl failed, trying AI-based analysis for ${targetUrl}`);
      try {
        const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
        if (perplexityApiKey) {
          const aiRes = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${perplexityApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'sonar',
              messages: [{ role: 'user', content: `Analyze this website: ${targetUrl}\n\nDescribe what this website is about, what type of site it is (directory, magazine, company listing, government portal, etc.), what companies or businesses are listed or mentioned on it, and what categories/industries it covers. Be specific about any Saudi Arabian companies mentioned.` }],
              max_tokens: 2000,
            }),
          });
          if (aiRes.ok) {
            const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> };
            const aiContent = aiData.choices?.[0]?.message?.content || '';
            if (aiContent.length > 100) {
              homepageText = aiContent;
              homepageHtml = `<html><body><p>${aiContent}</p></body></html>`;
              usedAiFallback = true;
              console.log(`[Prospecting] AI fallback succeeded for ${targetUrl} (${aiContent.length} chars)`);
            }
          }
        }
      } catch (aiErr) {
        console.log(`[Prospecting] AI fallback failed: ${(aiErr as Error).message?.substring(0, 80)}`);
      }
    }

    if (!homepageText || homepageText.length < 50) {
      await db.update(prospectingJobsTable).set({
        status: "failed",
        error: "Could not retrieve content from the provided URL. The website may be blocking automated access. Try a different URL from the same site, or enter a direct listing/directory page URL.",
      }).where(eq(prospectingJobsTable.id, jobId));
      return;
    }
    console.log(`[Prospecting] Homepage fetched in ${Date.now() - startTime}ms (${homepageText.length} chars)`);

    const contentLanguage = detectContentLanguage(homepageText);

    const $ = parseHtml(homepageHtml);
    const baseUrl = new URL(targetUrl);
    const allLinks: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const resolved = new URL(href, baseUrl.origin);
        if (resolved.hostname === baseUrl.hostname && !allLinks.includes(resolved.href)) {
          allLinks.push(resolved.href);
        }
      } catch { /* invalid href */ }
    });

    const filteredLinks = filterRelevantUrls(allLinks, baseUrl.hostname);
    console.log(`[Prospecting] Found ${filteredLinks.length} links on homepage in ${Date.now() - startTime}ms`);

    const listingPages = await findListingPages(targetUrl, filteredLinks);
    console.log(`[Prospecting] ${listingPages.length} listing page candidates identified`);

    const listingSamples = await Promise.allSettled(
      listingPages.slice(0, 5).map(async (listingUrl) => {
        const { html: lHtml, text } = await fastFetchPage(listingUrl, 8000);
        return { url: listingUrl, text: text.substring(0, 6000), html: lHtml };
      })
    );

    let deepContent = "";
    let listingHtml = "";
    let successfulSamples = 0;
    for (const result of listingSamples) {
      if (result.status === 'fulfilled' && result.value.text.length > 100) {
        deepContent += `\n\n--- PAGE: ${result.value.url} ---\n${result.value.text}`;
        listingHtml += result.value.html;
        successfulSamples++;
      }
    }
    console.log(`[Prospecting] Listing pages sampled in ${Date.now() - startTime}ms (${successfulSamples}/${listingPages.slice(0, 5).length} succeeded)`);

    if (successfulSamples === 0 && filteredLinks.length > 0) {
      console.log(`[Prospecting] No listing pages returned content, trying general site pages...`);
      const fallbackLinks = filteredLinks
        .filter(u => !listingPages.includes(u))
        .slice(0, 3);
      const fallbackSamples = await Promise.allSettled(
        fallbackLinks.map(async (fbUrl) => {
          const { text } = await fastFetchPage(fbUrl, 8000);
          return { url: fbUrl, text: text.substring(0, 5000) };
        })
      );
      for (const result of fallbackSamples) {
        if (result.status === 'fulfilled' && result.value.text.length > 100) {
          deepContent += `\n\n--- PAGE: ${result.value.url} ---\n${result.value.text}`;
          successfulSamples++;
        }
      }
      console.log(`[Prospecting] Fallback sampling: ${successfulSamples} pages with content`);
    }

    const allContent = (homepageText.substring(0, 8000) + deepContent).substring(0, 20000);

    const paginationHints = allContent.match(/page\s*\d+|next\s*page|load\s*more|showing\s*\d+\s*of\s*\d+|\u00BB|\u203A|المزيد|الصفحة\s*\d+|التالي|عرض\s*\d+|السابق|next|prev/gi) || [];
    let paginationType: SiteScanSummary['paginationType'] = 'unknown';
    if (paginationHints.some(h => /page\s*\d+|\u00BB|\u203A|الصفحة\s*\d+/i.test(h))) paginationType = 'numbered';
    else if (paginationHints.some(h => /load\s*more|المزيد/i.test(h))) paginationType = 'load_more';

    let scanSummary: SiteScanSummary;
    try {
      const prompt = `You are an intelligent web data extraction analyst. A user has pasted a URL and wants to extract structured data from it. Your job is to:
1. Analyze what TYPE of website this is and what DATA it contains
2. Identify what records/items are LISTED on this site (they may be companies, products, people, jobs, articles, properties, events, or anything else)
3. Generate TAILORED questions to understand exactly what the user wants from this specific website
4. Suggest the exact data fields that exist on this site

IMPORTANT RULES:
- This could be ANY type of website — do NOT assume it is always a company/business directory
- If it is a company directory (like bluepages, amaaly, Yellow Pages, chamber of commerce) → ask about industry, city, size, what company data they need
- If it is a news/article site (like argaam.com, Reuters Arabia) → ask about topic, date range, language, author
- If it is a product catalog or marketplace → ask about category, price range, brand, condition
- If it is a job board → ask about job type, location, salary, experience level
- If it is a property listing → ask about property type, area, price, rooms
- If it is a government registry → ask about entity type, status, region, license type
- Generate ONLY questions that are relevant to THIS specific website's content
- Questions must be based on what you actually see in the site content, not generic assumptions
- Read Arabic content fluently if present

Content language: ${contentLanguage === 'arabic' ? 'Arabic (العربية)' : contentLanguage === 'mixed' ? 'Arabic+English' : 'English'}

URL: ${targetUrl}
Sampled content from the website:
${allContent}

Discovered URLs (${filteredLinks.length} total): ${filteredLinks.slice(0, 20).join('\n')}
Identified listing pages: ${listingPages.join('\n')}

Return ONLY valid JSON in this exact format:
{
  "totalPages": <estimated number of listing pages>,
  "dataType": "<what kind of records this site has: companies|products|people|jobs|articles|properties|events|other>",
  "siteDescription": "<1-2 sentence description of what this website is and what data it contains>",
  "sampleItems": [<up to 10 REAL LISTED items/companies found in the content. These must be individual entities LISTED ON the site, NOT the website itself. For a business directory: names of listed companies. For a news site: article headlines. NEVER include the website brand name (e.g. "BluPages", "Yellow Pages") as a sample item.>],
  "suggestedFields": [<5-12 specific data fields that exist on THIS site, e.g. for companies: "Company Name","Phone","Email","City","Industry","CR Number" — for jobs: "Job Title","Company","Salary","Location","Requirements" — match the actual site>],
  "suggestedQuestions": [
    <2-5 questions SPECIFIC to this site's content. Each question must have "question" and "options" keys. Generate questions based on actual filter options visible in the site — e.g. if site has city filter, ask about city; if site has category/industry filter, ask about that; always include a question about how many records to extract with options like "First 50","First 100","First 200","All available">
  ],
  "categories": [<content categories found — industry types, product categories, article topics, etc.>],
  "cities": [<geographic locations found in the content, if any>],
  "paginationType": "${paginationType}",
  "websiteType": "<directory|marketplace|news|government|jobs|properties|association|ecommerce|other>",
  "contentLanguage": "${contentLanguage}"
}

CRITICAL: suggestedQuestions must be tailored to THIS website only. Do not use generic questions. Each option array must have 2+ real values from the site content.`;

      // Site scan: Gemini (1st) → Claude (2nd) → GPT-4o retry (3rd)
      let scanRawContent: string | null = null;
      if (isGeminiConfigured()) {
        try {
          console.log('[Prospecting] Site scan — trying Gemini...');
          scanRawContent = await synthesizeWithGemini(prompt, "You are a web intelligence analyst. Analyze website content and return a detailed JSON report. Return ONLY valid JSON.", "gemini-2.5-flash");
        } catch { /* fall through */ }
      }
      if (!scanRawContent) {
        try {
          console.log('[Prospecting] Site scan — trying Claude...');
          scanRawContent = await _callClaudeJson(prompt, "You are a web intelligence analyst. Analyze website content and return a detailed JSON report.", 2000);
        } catch { /* fall through */ }
      }
      if (!scanRawContent) {
        console.log('[Prospecting] Site scan — trying GPT-4o...');
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
              max_tokens: 2000,
            });
            scanRawContent = response.choices[0]?.message?.content || '{}';
            break;
          } catch (retryErr: unknown) {
            const msg = (retryErr as Error).message || '';
            if (msg.includes('429') || msg.includes('rate') || msg.includes('quota')) {
              const delay = (attempt + 1) * 5000;
              console.log(`[Prospecting] GPT-4o rate limited (attempt ${attempt + 1}/3), retrying in ${delay / 1000}s...`);
              await new Promise(r => setTimeout(r, delay));
            } else { break; }
          }
        }
      }
      if (!scanRawContent) throw new Error('All AI models failed for site scan');

      scanSummary = JSON.parse(scanRawContent.match(/\{[\s\S]*\}/)?.[0] || '{}') as SiteScanSummary;
      scanSummary.paginationType = scanSummary.paginationType || paginationType;
      scanSummary.websiteType = scanSummary.websiteType || 'other';
      scanSummary.contentLanguage = scanSummary.contentLanguage || contentLanguage;
      // sampleItems is the new field; keep sampleCompanies for backward compat
      scanSummary.sampleItems = scanSummary.sampleItems || [];
      scanSummary.sampleCompanies = scanSummary.sampleItems.length > 0 ? scanSummary.sampleItems : (scanSummary.sampleCompanies || []);
      scanSummary.suggestedFields = scanSummary.suggestedFields || [];
      scanSummary.categories = scanSummary.categories || [];
      scanSummary.cities = scanSummary.cities || [];
      scanSummary.industries = scanSummary.industries || [];
      // Store discovered listing pages so extraction starts from the RIGHT pages
      scanSummary.listingPages = listingPages.slice(0, 10);

      if (!scanSummary.suggestedQuestions || scanSummary.suggestedQuestions.length === 0) {
        scanSummary.suggestedQuestions = buildDefaultQuestions(scanSummary);
      }
      for (const sq of scanSummary.suggestedQuestions) {
        if (!sq.options || sq.options.length === 0) {
          sq.options = ["All available"];
        }
        // Add "All X" prefix option when not present, for any filter question
        const qLower = sq.question.toLowerCase();
        if (!sq.options.some(o => o.toLowerCase().startsWith('all'))) {
          if (qLower.includes('city') || qLower.includes('region') || qLower.includes('location')) {
            sq.options.unshift("All cities");
          } else if (qLower.includes('industr') || qLower.includes('sector')) {
            sq.options.unshift("All industries");
          } else if (qLower.includes('categor') || qLower.includes('type') || qLower.includes('topic')) {
            sq.options.unshift("All");
          }
        }
      }
    } catch (aiErr: unknown) {
      console.log(`[Prospecting] AI scan analysis error: ${(aiErr as Error).message?.substring(0, 120)}`);
      const combinedHtml = listingHtml.length > homepageHtml.length ? listingHtml : homepageHtml;
      const extractedData = extractFromContentFallback(allContent, combinedHtml, filteredLinks);
      scanSummary = {
        totalPages: filteredLinks.length || 1,
        sampleCompanies: extractedData.companyNames,
        categories: extractedData.categories,
        cities: extractedData.cities,
        industries: extractedData.industries,
        suggestedQuestions: buildDefaultQuestions({
          totalPages: filteredLinks.length || 1,
          sampleCompanies: extractedData.companyNames,
          categories: extractedData.categories,
          cities: extractedData.cities,
          industries: extractedData.industries,
          suggestedQuestions: [],
          paginationType,
        }),
        paginationType,
        websiteType: 'directory',
        contentLanguage,
      };
      console.log(`[Prospecting] Fallback extraction: ${extractedData.companyNames.length} items, ${extractedData.categories.length} categories`);
    }

    await db.update(prospectingJobsTable).set({
      status: "scanned",
      scanSummary,
      pagesScanned: listingPages.length + 1,
    }).where(eq(prospectingJobsTable.id, jobId));

    const elapsed = Date.now() - startTime;
    const sampleCount = (scanSummary.sampleItems?.length || scanSummary.sampleCompanies?.length || 0);
    console.log(`[Prospecting] ⚡ Scan complete in ${elapsed}ms (${(elapsed/1000).toFixed(1)}s): ${sampleCount} sample items, ${scanSummary.categories.length} categories, type: ${scanSummary.websiteType}, dataType: ${scanSummary.dataType}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(prospectingJobsTable).set({
      status: "failed",
      error: message.substring(0, 500),
    }).where(eq(prospectingJobsTable.id, jobId));
  }
}

interface FallbackExtractionResult {
  companyNames: string[];
  categories: string[];
  cities: string[];
  industries: string[];
}

const SAUDI_CITIES = [
  'Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar', 'Dhahran', 'Jubail',
  'Tabuk', 'Abha', 'Taif', 'Hail', 'Buraidah', 'Najran', 'Yanbu', 'Jazan', 'Khamis Mushait',
  'الرياض', 'جدة', 'مكة', 'المدينة', 'الدمام', 'الخبر', 'الظهران', 'الجبيل',
  'تبوك', 'أبها', 'الطائف', 'حائل', 'بريدة', 'نجران', 'ينبع', 'جازان', 'خميس مشيط',
];

const COMMON_CATEGORIES = [
  'Construction', 'Trading', 'Healthcare', 'Real Estate', 'Manufacturing',
  'Food & Beverage', 'Transportation', 'Technology', 'Education', 'Retail',
  'Oil & Gas', 'Consulting', 'Engineering', 'Contracting', 'Telecommunications',
  'Insurance', 'Banking', 'Tourism', 'Agriculture', 'Mining',
  'مقاولات', 'تجارة', 'صحة', 'عقارات', 'تصنيع', 'أغذية', 'نقل', 'تقنية', 'تعليم',
];

function extractFromContentFallback(textContent: string, html: string, links: string[]): FallbackExtractionResult {
  const companyNames: string[] = [];
  const categories: string[] = [];
  const cities: string[] = [];
  const industries: string[] = [];

  const arabicToEnglish: Record<string, string> = {
    'الرياض': 'Riyadh', 'جدة': 'Jeddah', 'مكة': 'Mecca', 'المدينة': 'Medina',
    'الدمام': 'Dammam', 'الخبر': 'Khobar', 'الظهران': 'Dhahran', 'الجبيل': 'Jubail',
    'تبوك': 'Tabuk', 'أبها': 'Abha', 'الطائف': 'Taif', 'حائل': 'Hail',
    'بريدة': 'Buraidah', 'نجران': 'Najran', 'ينبع': 'Yanbu', 'جازان': 'Jazan',
    'خميس مشيط': 'Khamis Mushait',
  };

  const foundCities = SAUDI_CITIES.filter(city => textContent.includes(city));
  const uniqueCities = [...new Set(foundCities.map(c => arabicToEnglish[c] || c))];
  cities.push(...uniqueCities);

  const foundCategories = COMMON_CATEGORIES.filter(cat =>
    textContent.toLowerCase().includes(cat.toLowerCase())
  );
  const uniqueCategories = [...new Set(foundCategories.filter(c => !/[\u0600-\u06FF]/.test(c)))];
  categories.push(...uniqueCategories.slice(0, 10));

  if (categories.length > 0) {
    industries.push(...categories.slice(0, 8));
  }

  const $ = parseHtml(html);
  const cardSelectors = [
    '.company-name', '.business-name', '.listing-title', '.card-title',
    'h3 a', 'h4 a', '.result-title', '.item-title', '.company a',
    '[class*="company"] h3', '[class*="business"] h3',
    '[class*="listing"] h3', '[class*="card"] h3',
  ];

  for (const selector of cardSelectors) {
    $(selector).each((_, el) => {
      if (companyNames.length >= 10) return;
      const name = $(el).text().trim();
      if (name.length > 2 && name.length < 100 && !companyNames.includes(name)) {
        companyNames.push(name);
      }
    });
    if (companyNames.length > 0) break;
  }

  if (companyNames.length === 0) {
    const linkTexts: string[] = [];
    const categoryPaths = links.filter(l => {
      try {
        const p = new URL(l).pathname;
        return /\/(company|business|listing|profile|firm)\//i.test(p);
      } catch { return false; }
    });
    for (const link of categoryPaths.slice(0, 10)) {
      try {
        const linkEl = $(`a[href*="${new URL(link).pathname}"]`);
        const text = linkEl.text().trim();
        if (text.length > 2 && text.length < 80 && !linkTexts.includes(text)) {
          linkTexts.push(text);
        }
      } catch { /* skip */ }
    }
    companyNames.push(...linkTexts.slice(0, 10));
  }

  if (companyNames.length === 0 && textContent.length > 200) {
    const companyPatterns = [
      /(?:شركة|مؤسسة|مصنع|مجموعة)\s+[\u0600-\u06FF\s]{3,40}/g,
      /(?:company|co\.|corp|group|est)\s*[:.]?\s*[A-Z][\w\s&]{3,40}/gi,
    ];
    for (const pattern of companyPatterns) {
      const matches = textContent.match(pattern) || [];
      for (const m of matches) {
        const name = m.trim();
        if (name.length > 4 && name.length < 80 && !companyNames.includes(name) && companyNames.length < 10) {
          companyNames.push(name);
        }
      }
      if (companyNames.length > 0) break;
    }
  }

  if (cities.length === 0) {
    cities.push('Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina');
  }

  if (categories.length === 0) {
    const skipPaths = /^(page|index|list|search|api|about|about[-_]us|contact|contact[-_]us|blog|login|signup|register|privacy|terms|faq|help|home|services|verification|verify|careers|jobs|company[-_]verification|news|media|press|partners|pricing|plans|features|how[-_]it[-_]works|support|resources|sitemap|feed|rss|newsletter|subscribe|unsubscribe|cookie|cookies|legal|tos|eula|imprint|impressum)$/i;
    const urlCategories = links
      .map(l => { try { return decodeURIComponent(new URL(l).pathname); } catch { return ''; } })
      .filter(p => p.length > 1)
      .map(p => {
        const segments = p.split('/').filter(Boolean);
        return segments.find(s => s.length > 3 && !/^\d+$/.test(s) && !skipPaths.test(s));
      })
      .filter((s): s is string => !!s);
    const uniqueUrlCategories = [...new Set(urlCategories)].slice(0, 8);
    if (uniqueUrlCategories.length > 0) {
      categories.push(...uniqueUrlCategories.map(c => c.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())));
    }
  }

  if (categories.length === 0) {
    categories.push('Construction', 'Trading', 'Healthcare', 'Real Estate', 'Manufacturing', 'Technology', 'Oil & Gas', 'Consulting');
  }

  return { companyNames, categories, cities, industries };
}

function buildDefaultQuestions(summary: SiteScanSummary | null): SiteScanSummary['suggestedQuestions'] {
  const questions: SiteScanSummary['suggestedQuestions'] = [];

  if (summary?.cities && summary.cities.length > 0) {
    questions.push({
      question: "Which city or region are you interested in?",
      options: ["All cities", ...summary.cities.slice(0, 8)],
    });
  }

  if (summary?.industries && summary.industries.length > 0) {
    questions.push({
      question: "Which industry or sector?",
      options: ["All industries", ...summary.industries.slice(0, 8)],
    });
  }

  if (summary?.categories && summary.categories.length > 0) {
    questions.push({
      question: "Which category are you interested in?",
      options: ["All categories", ...summary.categories.slice(0, 8)],
    });
  }

  questions.push({
    question: "How many companies do you want to extract?",
    options: ["Top 50", "Top 100", "Top 200", "All available"],
  });

  questions.push({
    question: "What level of detail do you need?",
    options: ["Basic (name, phone, address)", "Standard (+ website, email, industry)", "Deep (+ AI enrichment with financials and executivesTable)"],
  });

  return questions;
}

async function verifyProspectingTable(): Promise<void> {
  try {
    await db.select().from(prospectingResultsTable).limit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('does not exist') || msg.includes('relation')) {
      throw new Error(
        'The prospecting_results table does not exist in the database. ' +
        'Run `pnpm --filter @workspace/db push` to create it.'
      );
    }
    throw err;
  }
}

export async function startExtraction(jobId: string, settings: Partial<ProspectingSettings>): Promise<ProspectingJob> {
  await verifyProspectingTable();
  const numId = parseInt(jobId, 10);
  if (isNaN(numId)) throw new Error("Invalid job ID");
  const [job] = await db.select().from(prospectingJobsTable).where(eq(prospectingJobsTable.id, numId)).limit(1);
  if (!job) throw new Error("Job not found");

  const existingSettings = job.settings as ProspectingSettings | null;
  const userAnswerFilters: Record<string, unknown> = {};
  if (settings.userAnswers) {
    for (const [question, answer] of Object.entries(settings.userAnswers)) {
      // Keep answers exactly as-is keyed by the question text — the AI extraction prompt will apply them
      userAnswerFilters[question] = answer;
    }
  }
  const mergedSettings: ProspectingSettings = {
    targetUrl: existingSettings?.targetUrl || job.targetUrl,
    maxPages: settings.maxPages || existingSettings?.maxPages || 50,
    extractionFields: settings.extractionFields || existingSettings?.extractionFields || [],
    filters: { ...(existingSettings?.filters || {}), ...(settings.filters || {}), ...userAnswerFilters },
    enrichmentDepth: settings.enrichmentDepth || existingSettings?.enrichmentDepth || 'standard',
    exportFormat: settings.exportFormat || existingSettings?.exportFormat,
    extractionLanguage: settings.extractionLanguage || existingSettings?.extractionLanguage || 'english',
    userAnswers: settings.userAnswers,
  };

  await db.delete(prospectingResultsTable).where(eq(prospectingResultsTable.jobId, numId));

  await db.update(prospectingJobsTable).set({
    status: "extracting",
    settings: mergedSettings,
    totalCompaniesFound: 0,
    totalEnriched: 0,
    pagesScanned: 0,
    error: null,
    completedAt: null,
  }).where(eq(prospectingJobsTable.id, numId));

  const scanSummary = job.scanSummary as SiteScanSummary | null;
  extractAsync(numId, mergedSettings, scanSummary?.paginationType || 'unknown', scanSummary?.listingPages || []).catch(err => {
    console.error(`[Prospecting] Extraction failed: ${(err as Error).message}`);
  });

  const [updated] = await db.select().from(prospectingJobsTable).where(eq(prospectingJobsTable.id, numId)).limit(1);
  return updated;
}

async function extractCompaniesFromContent(
  content: string,
  sourceUrl: string,
  settings: ProspectingSettings,
): Promise<ProspectingCompanyResult[]> {
  const filterEntries = Object.entries(settings.filters || {})
    .filter(([, v]) => v && String(v).toLowerCase() !== 'all' && String(v).toLowerCase() !== 'all available');
  const filterStr = filterEntries.map(([k, v]) => `- ${k}: ${v}`).join('\n');

  const outputLang = settings.extractionLanguage || 'english';
  const langInstruction = outputLang === 'arabic'
    ? `OUTPUT LANGUAGE: Arabic (العربية). Return ALL names, descriptions, and addresses in Arabic. Keep phone numbers, emails, and websites in their original format.`
    : `OUTPUT LANGUAGE: English. If the source content is in Arabic, translate names and descriptions to English. Keep phone numbers, emails, websites, and IDs in their original format.`;

  const requestedFields = settings.extractionFields?.length
    ? settings.extractionFields
    : ['name', 'phone', 'email', 'website', 'address', 'city', 'industry', 'description'];

  const fieldList = requestedFields.join(', ');
  const fieldsForJson = requestedFields.map(f => {
    const key = f.toLowerCase().replace(/[\s/()]+/g, '_').replace(/[^a-z0-9_]/g, '');
    return `"${key}": "<${f}>"`;
  }).join(', ');

  const targetDomain = (() => { try { return new URL(sourceUrl).hostname; } catch { return ''; } })();

  const extractPrompt = `You are a data extraction specialist. This is a LISTING/DIRECTORY PAGE. Extract the COMPANIES AND BUSINESSES that are LISTED on this page.

${langInstruction}

URL: ${sourceUrl}
${filterStr ? `USER FILTERS (apply these when extracting — skip records that don't match):\n${filterStr}` : ''}

FIELDS TO EXTRACT PER COMPANY: ${fieldList}

Content:
${content.substring(0, 12000)}

Return ONLY valid JSON in this format:
{"companies": [{${fieldsForJson}}]}

CRITICAL RULES — READ CAREFULLY:
1. MOST IMPORTANT: The user wants companies/businesses LISTED ON this directory page — NOT the directory website itself.
   - If this is "BluPages" (الصفحات الزرقاء) → extract companies IN BluPages, NOT "BluPages" itself
   - If this is "Yellow Pages" → extract the listed businesses, NOT "Yellow Pages"
   - If this is a Chamber of Commerce → extract MEMBER companies, NOT the chamber itself
   - NEVER include the website name "${targetDomain}" or its Arabic equivalent as a result
   - NEVER extract navigation items, header text, footer text, or website branding as a company

2. Look for COMPANY LISTING ITEMS — cards, rows, tiles, search results showing individual businesses.
   Each real listing typically has: a unique company name, phone number, address, and/or category.

3. Read Arabic text carefully — company names in Arabic are valid (e.g. "شركة الخليج للتجارة" is a company name).

4. Return ONLY real data visible in the content — never fabricate or invent values.

5. Apply user filters: skip records that don't match the filter criteria.

6. If no company listings are found on this page (e.g. it is a homepage or search form page with no results), return {"companies": []}.

7. The company name field is REQUIRED — skip any item with no identifiable company name.`;

  // Main extraction: Gemini (1st) → Claude (2nd) → GPT-4o (3rd)
  let extractRaw: string;
  if (isGeminiConfigured()) {
    try {
      const geminiItems = await extractCompaniesWithGemini(extractPrompt, "company");
      extractRaw = JSON.stringify({ items: geminiItems });
    } catch {
      try {
        extractRaw = await _callClaudeJson(extractPrompt, "You are a Saudi Arabia B2B data extraction specialist.", 4000);
      } catch {
        try {
          const r = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: extractPrompt }], response_format: { type: "json_object" }, max_tokens: 4000 });
          extractRaw = r.choices[0]?.message?.content || '{}';
        } catch { extractRaw = '{}'; }
      }
    }
  } else {
    try {
      extractRaw = await _callClaudeJson(extractPrompt, "You are a Saudi Arabia B2B data extraction specialist.", 4000);
    } catch {
      try {
        const r = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: extractPrompt }], response_format: { type: "json_object" }, max_tokens: 4000 });
        extractRaw = r.choices[0]?.message?.content || '{}';
      } catch { extractRaw = '{}'; }
    }
  }

  const parsed = JSON.parse(extractRaw.match(/\{[\s\S]*\}/)?.[0] || '{}') as Record<string, unknown>;
  // Accept both the new "items" key and legacy "companies"/"results" keys
  const rawItems: Record<string, unknown>[] = (
    (parsed.items as Record<string, unknown>[]) ||
    (parsed.companies as Record<string, unknown>[]) ||
    (parsed.results as Record<string, unknown>[]) ||
    []
  );
  const result: ProspectingCompanyResult[] = [];

  const STANDARD_KEYS = new Set(['name', 'phone', 'email', 'website', 'address', 'city', 'industry', 'category', 'description', 'contact_person', 'contactperson', 'cr_number', 'crnumber', 'employees', 'revenue', 'founded_year', 'foundedyear', 'registration_number', 'registrationnumber', 'source_url', 'sourceurl', 'source', 'enrichment_status', 'enrichmentstatus']);

  for (const item of rawItems) {
    // Find the primary identifier — any first non-null string value
    const nameKey = Object.keys(item).find(k => {
      const kl = k.toLowerCase().replace(/[^a-z]/g, '');
      return (kl === 'name' || kl === 'title' || kl === 'companyname' || kl === 'jobtitle' || kl === 'productname' || kl === 'articlename' || kl === 'articleheadline' || kl === 'headline' || kl === 'propertyname' || kl === 'listingname') && typeof item[k] === 'string' && (item[k] as string).length > 0;
    }) || Object.keys(item).find(k => typeof item[k] === 'string' && (item[k] as string).length > 1);

    if (!nameKey) continue;
    const primaryName = String(item[nameKey] || '').trim();
    if (!primaryName || primaryName.length < 2) continue;

    const isDupe = result.some(ex => ex.name?.toLowerCase() === primaryName.toLowerCase());
    if (isDupe) continue;

    // Map well-known standard fields directly; everything else goes into extras
    const extras: Record<string, string> = {};
    for (const [k, v] of Object.entries(item)) {
      if (!v || k === nameKey) continue;
      const kl = k.toLowerCase().replace(/[^a-z]/g, '');
      if (!STANDARD_KEYS.has(kl) && !STANDARD_KEYS.has(k.toLowerCase())) {
        extras[k] = String(v);
      }
    }

    const getString = (key: string) => {
      const found = Object.entries(item).find(([k]) => k.toLowerCase().replace(/[^a-z]/g, '') === key.replace(/[^a-z]/g, '').toLowerCase());
      return found ? String(found[1] || '').trim() || undefined : undefined;
    };

    result.push({
      name: primaryName,
      phone: getString('phone'),
      email: getString('email'),
      website: getString('website'),
      address: getString('address'),
      city: getString('city'),
      industry: getString('industry'),
      category: getString('category'),
      description: getString('description'),
      contactPerson: getString('contactperson') || getString('contact_person'),
      crNumber: getString('crnumber') || getString('cr_number'),
      revenue: getString('revenue'),
      extras: Object.keys(extras).length > 0 ? extras : undefined,
      enrichmentStatus: 'pending',
    });
  }
  return result;
}

async function saveAndFinishExtraction(
  jobId: number,
  settings: ProspectingSettings,
  allCompanies: ProspectingCompanyResult[],
  pagesScanned: number,
  skipInsert = false,
): Promise<void> {
  if (!skipInsert) {
    for (const company of allCompanies) {
      await db.insert(prospectingResultsTable).values({
        jobId,
        companyData: company,
        enrichmentStatus: 'pending',
        sourceUrl: settings.targetUrl,
      });
    }
  }

  const hasMissingCriticalFields = allCompanies.some(c => !c.phone || !c.email || !c.website);
  const shouldEnrich = settings.enrichmentDepth === 'deep' || settings.enrichmentDepth === 'standard' || hasMissingCriticalFields;
  if (shouldEnrich && allCompanies.length > 0) {
    await db.update(prospectingJobsTable).set({
      status: "enriching",
      totalCompaniesFound: allCompanies.length,
      pagesScanned,
    }).where(eq(prospectingJobsTable.id, jobId));
    enrichResultsAsync(jobId, settings.enrichmentDepth, settings.extractionLanguage, normalizeFocusFields(settings.extractionFields || [])).catch(err => {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[Prospecting] Enrichment phase error: ${msg.substring(0, 80)}`);
    });
  } else {
    await db.update(prospectingJobsTable).set({
      status: "completed",
      totalCompaniesFound: allCompanies.length,
      pagesScanned,
      completedAt: new Date(),
    }).where(eq(prospectingJobsTable.id, jobId));
  }

  console.log(`[Prospecting] Extraction complete: ${allCompanies.length} companies from ${pagesScanned} pages`);
}

async function extractAsync(jobId: number, settings: ProspectingSettings, paginationType: string = 'unknown', seedListingPages: string[] = []) {
  console.log(`[Prospecting] Starting extraction for job ${jobId}: ${settings.targetUrl} (pagination: ${paginationType}, seed pages: ${seedListingPages.length})`);

  try {
    const maxPages = Math.min(settings.maxPages || 50, 100);

    if (paginationType === 'load_more' || paginationType === 'infinite_scroll') {
      // Start from the first seed listing page if available, not the homepage
      const loadMoreUrl = (seedListingPages && seedListingPages.length > 0)
        ? seedListingPages[0]
        : settings.targetUrl;
      console.log(`[Prospecting] Using Playwright load-more/scroll strategy for ${loadMoreUrl}`);
      const loadMoreContent = await crawlWithLoadMore(loadMoreUrl, maxPages);
      if (loadMoreContent.length > 200) {
        const allCompanies = await extractCompaniesFromContent(loadMoreContent, loadMoreUrl, settings);
        await saveAndFinishExtraction(jobId, settings, allCompanies, 1);
        return;
      }
      console.log(`[Prospecting] Load-more strategy yielded insufficient content, falling back to URL crawling`);
    }

    let discoveredUrls: string[] = [];

    // PRIORITY: use listing pages discovered during scan — they are already
    // the correct listing/directory pages (e.g. /companies, /search, /members)
    // NOT the homepage which contains only the website's own branding.
    if (seedListingPages && seedListingPages.length > 0) {
      console.log(`[Prospecting] Using ${seedListingPages.length} seed listing pages from scan`);
      discoveredUrls = [...seedListingPages];
      // Generate paginated variants from each seed page
      const pagePatterns = [
        (base: string, n: number) => {
          const u = new URL(base);
          u.searchParams.set('page', String(n));
          return u.href;
        },
        (base: string, n: number) => {
          const u = new URL(base);
          u.searchParams.set('p', String(n));
          return u.href;
        },
        (base: string, n: number) => {
          // /page/N suffix
          const u = new URL(base);
          u.pathname = u.pathname.replace(/\/$/, '') + `/page/${n}`;
          return u.href;
        },
      ];
      for (const seedUrl of seedListingPages.slice(0, 3)) {
        for (let p = 2; p <= Math.min(Math.ceil(maxPages / seedListingPages.length), 30); p++) {
          for (const pattern of pagePatterns.slice(0, 2)) {
            const pageUrl = pattern(seedUrl, p);
            if (!discoveredUrls.includes(pageUrl)) {
              discoveredUrls.push(pageUrl);
            }
          }
        }
      }
      console.log(`[Prospecting] Built ${discoveredUrls.length} paginated URLs from seed listing pages`);
    } else {
      // FALLBACK: no scan listing pages — crawl from the target URL
      try {
        console.log(`[Prospecting] No seed pages — running full website crawl for discovery (max ${Math.min(maxPages, 30)} pages)`);
        const crawlResult = await crawlFullWebsite(settings.targetUrl, Math.min(maxPages, 30));
        discoveredUrls = crawlResult.urls || [];
        console.log(`[Prospecting] crawlFullWebsite discovered ${discoveredUrls.length} URLs`);
      } catch (crawlErr: unknown) {
        console.log(`[Prospecting] crawlFullWebsite fallback: ${(crawlErr as Error).message?.substring(0, 60)}`);
      }

      if (discoveredUrls.length < 2) {
        discoveredUrls = [settings.targetUrl];
        try {
          const html = await getPageContent(settings.targetUrl, { waitMs: 3000 });
          const $ = parseHtml(html);
          const baseUrl = new URL(settings.targetUrl);

          $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;
            try {
              const resolved = new URL(href, baseUrl.origin);
              if (resolved.hostname === baseUrl.hostname && !discoveredUrls.includes(resolved.href)) {
                const text = $(el).text().toLowerCase();
                if (/page|next|company|director|list|categor|sector|industr|\d+/.test(text) || /page=|p=|offset=|start=/.test(resolved.search)) {
                  discoveredUrls.push(resolved.href);
                }
              }
            } catch { /* invalid href */ }
          });

          for (let p = 2; p <= Math.min(10, maxPages); p++) {
            const pageUrl = new URL(settings.targetUrl);
            if (!discoveredUrls.some(u => u.includes(`page=${p}`) || u.includes(`p=${p}`))) {
              pageUrl.searchParams.set('page', String(p));
              discoveredUrls.push(pageUrl.href);
            }
          }
        } catch { /* link fallback */ }
      }
    }

    const baseHost = new URL(settings.targetUrl).hostname;
    discoveredUrls = filterRelevantUrls(discoveredUrls, baseHost);

    const cityFilter = Object.entries(settings.filters || {})
      .find(([k]) => k.toLowerCase().includes('city') || k.toLowerCase().includes('region') || k.toLowerCase().includes('location') || k.toLowerCase().includes('area'))?.[1]
      || '';
    if (cityFilter && typeof cityFilter === 'string' && !cityFilter.toLowerCase().startsWith('all')) {
      discoveredUrls = prioritizeCityFilteredUrls(discoveredUrls, cityFilter);
    }

    const pagesToProcess = discoveredUrls.slice(0, maxPages);
    console.log(`[Prospecting] Will process ${pagesToProcess.length} relevant pages (filtered from ${discoveredUrls.length})`);

    const allCompanies: ProspectingCompanyResult[] = [];
    const existingNames = new Set<string>();
    let batchInserted = false;

    for (let pageIdx = 0; pageIdx < pagesToProcess.length; pageIdx++) {
      const listingUrl = pagesToProcess[pageIdx];
      console.log(`[Prospecting] Processing listing page ${pageIdx + 1}/${pagesToProcess.length}: ${listingUrl}`);

      try {
        const { html: listingHtml, text: listingText } = await fastFetchPage(listingUrl, 12000);
        if (listingText.length < 80) {
          console.log(`[Prospecting] Listing page too thin (${listingText.length} chars), skipping`);
          continue;
        }

        const detailCompanies = await extractCompaniesViaDetailPages(
          listingHtml, listingUrl, settings, jobId, existingNames
        );

        if (detailCompanies.length > 0) {
          console.log(`[Prospecting] Detail-page strategy: ${detailCompanies.length} companies from ${listingUrl}`);
          allCompanies.push(...detailCompanies);

          await db.insert(prospectingResultsTable).values(
            detailCompanies.map(company => ({
              jobId,
              companyData: company,
              enrichmentStatus: 'pending',
              sourceUrl: listingUrl,
            }))
          );
          batchInserted = true;
        } else {
          console.log(`[Prospecting] No detail links found, falling back to listing-page text extraction for ${listingUrl}`);
          const pageCompanies = await extractCompaniesFromContent(listingText, listingUrl, settings);

          const newCompanies: ProspectingCompanyResult[] = [];
          for (const company of pageCompanies) {
            const nameLower = company.name.toLowerCase().trim();
            if (!existingNames.has(nameLower)) {
              existingNames.add(nameLower);
              allCompanies.push(company);
              newCompanies.push(company);
            }
          }

          if (newCompanies.length > 0) {
            await db.insert(prospectingResultsTable).values(
              newCompanies.map(company => ({
                jobId,
                companyData: company,
                enrichmentStatus: 'pending',
                sourceUrl: listingUrl,
              }))
            );
            batchInserted = true;
          }
          console.log(`[Prospecting] Text extraction fallback: ${newCompanies.length} companies from ${listingUrl}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[Prospecting] Failed to process listing page ${listingUrl}: ${msg.substring(0, 80)}`);
      }

      await db.update(prospectingJobsTable).set({
        pagesScanned: pageIdx + 1,
        totalCompaniesFound: allCompanies.length,
        progress: Math.round(((pageIdx + 1) / pagesToProcess.length) * 50),
      }).where(eq(prospectingJobsTable.id, jobId));
    }

    // -----------------------------------------------------------------------
    // PLAYWRIGHT CHAMBER FALLBACK: For Saudi Chamber / directory sites that
    // require JS rendering (Odoo, Wagtail, etc.), try Playwright with longer
    // wait times on known member directory paths.
    // -----------------------------------------------------------------------
    if (allCompanies.length === 0) {
      console.log(`[Prospecting] 0 companies from static crawl — trying Playwright JS-render on member directory paths`);
      try {
        const base = new URL(settings.targetUrl);
        // Prefer seed listing pages from scan over generic Saudi Chamber paths
        const chamberPaths = seedListingPages && seedListingPages.length > 0
          ? [...seedListingPages, ...SAUDI_CHAMBER_MEMBER_PATHS]
          : [...SAUDI_CHAMBER_MEMBER_PATHS, base.pathname];
        for (const memberPath of chamberPaths.slice(0, 8)) {
          const memberUrl = memberPath.startsWith('http') ? memberPath : `${base.protocol}//${base.host}${memberPath}`;
          try {
            const jsContent = await crawlWithLoadMore(memberUrl, 2);
            if (jsContent.length > 300) {
              const companies = await extractCompaniesFromContent(jsContent, memberUrl, settings);
              if (companies.length > 0) {
                console.log(`[Prospecting] Playwright found ${companies.length} companies at ${memberUrl}`);
                for (const c of companies) {
                  const isDupe = allCompanies.some(x => x.name.toLowerCase() === c.name.toLowerCase());
                  if (!isDupe) allCompanies.push(c);
                }
                if (allCompanies.length > 0) break;
              }
            }
          } catch { /* try next path */ }
        }
        if (allCompanies.length > 0) {
          console.log(`[Prospecting] Playwright chamber fallback: ${allCompanies.length} companies total`);
        }
      } catch (pfErr: unknown) {
        console.log(`[Prospecting] Playwright chamber fallback error: ${(pfErr as Error).message?.substring(0, 80)}`);
      }
    }

    // -----------------------------------------------------------------------
    // PERPLEXITY SITE-SEARCH FALLBACK: If Playwright also yields 0 companies,
    // use Perplexity — STRICTLY domain-locked to the target website only.
    // Data from any other domain (e.g. bluepages.com.sa) is REJECTED.
    // -----------------------------------------------------------------------
    if (allCompanies.length === 0) {
      console.log(`[Prospecting] 0 companies from crawl — trying Perplexity site-search fallback for ${settings.targetUrl}`);
      try {
        const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
        const targetDomain = new URL(settings.targetUrl).hostname;
        if (perplexityApiKey) {
          const queries = [
            `List companies and businesses registered on ${targetDomain}. Only give me company names that appear on this specific website. Do not mention any other website or directory.`,
            `What Saudi companies are members of ${targetDomain}? Give me real company names, phone numbers, and cities from this website only.`,
          ];
          const texts: string[] = [];
          for (const q of queries) {
            try {
              const pRes = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${perplexityApiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: 'sonar',
                  messages: [{ role: 'user', content: q }],
                  max_tokens: 3000,
                }),
              });
              if (pRes.ok) {
                const pData = await pRes.json() as { choices: Array<{ message: { content: string } }> };
                const pText = pData.choices?.[0]?.message?.content || '';
                if (pText.length > 100) texts.push(pText);
              }
            } catch { /* skip */ }
          }

          const combinedText = texts.join('\n\n');
          if (combinedText.length > 100) {
            const perplexityExtractMsg = `Extract ONLY company/business names that were found on the website "${targetDomain}". 

CRITICAL RULES:
- ONLY include companies that belong to or are listed on ${targetDomain}
- REJECT any company or data mentioned from other websites (bluepages, yellow pages, google, etc.)
- If a company's website is from a different domain, omit the website field
- Do NOT fabricate companies — only include companies explicitly named in this text

TEXT TO ANALYZE:
${combinedText.substring(0, 6000)}

Return JSON: {"companies": [{"name": "Company Name", "industry": "sector", "city": "city", "description": "brief description", "phone": "phone if mentioned", "email": "email if mentioned"}]}

Rules: minimum 2 characters in name, max 50 companies, real businesses only.`;

            // Perplexity text extraction: Gemini (1st) → Claude (2nd) → GPT-4o (3rd)
            let perplexityExtractRaw: string;
            if (isGeminiConfigured()) {
              try {
                perplexityExtractRaw = (await synthesizeWithGemini(perplexityExtractMsg, "You are a B2B data extraction specialist. Return ONLY valid JSON.", "gemini-2.5-flash")) ?? '{"companies":[]}';
              } catch {
                try {
                  perplexityExtractRaw = await _callClaudeJson(perplexityExtractMsg, "You are a Saudi Arabia B2B data extraction specialist.", 2000);
                } catch {
                  try {
                    const extractResp = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: perplexityExtractMsg }], response_format: { type: "json_object" }, max_tokens: 2000 });
                    perplexityExtractRaw = extractResp.choices[0]?.message?.content || '{"companies":[]}';
                  } catch { perplexityExtractRaw = '{"companies":[]}'; }
                }
              }
            } else {
              try {
                perplexityExtractRaw = await _callClaudeJson(perplexityExtractMsg, "You are a Saudi Arabia B2B data extraction specialist.", 2000);
              } catch {
                try {
                  const extractResp = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: perplexityExtractMsg }], response_format: { type: "json_object" }, max_tokens: 2000 });
                  perplexityExtractRaw = extractResp.choices[0]?.message?.content || '{"companies":[]}';
                } catch { perplexityExtractRaw = '{"companies":[]}'; }
              }
            }

            const parsed = JSON.parse(perplexityExtractRaw.match(/\{[\s\S]*\}/)?.[0] || '{"companies":[]}') as { companies?: Array<{ name?: string; industry?: string; city?: string; description?: string; website?: string; phone?: string; email?: string }> };
            for (const c of (parsed.companies || [])) {
              if (!c.name || c.name.length < 2) continue;
              allCompanies.push({
                name: c.name,
                industry: c.industry || 'Business',
                city: c.city || '',
                phone: c.phone || '',
                website: '',
                address: '',
                email: c.email || '',
                description: c.description || `Company found via ${targetDomain}`,
                sourceUrl: settings.targetUrl,
                extras: {},
              });
            }
            console.log(`[Prospecting] Perplexity fallback (domain-locked): found ${allCompanies.length} companies`);
          }
        }
      } catch (fbErr: unknown) {
        console.log(`[Prospecting] Perplexity fallback error: ${(fbErr as Error).message?.substring(0, 80)}`);
      }
    }

    const fallbackNeedsInsert = allCompanies.length > 0 && !batchInserted;
    await saveAndFinishExtraction(jobId, settings, allCompanies, pagesToProcess.length, !fallbackNeedsInsert);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(prospectingJobsTable).set({
      status: "failed",
      error: message.substring(0, 500),
    }).where(eq(prospectingJobsTable.id, jobId));
  }
}

function isKnown(val: unknown): val is string {
  return typeof val === 'string' && val.trim() !== '' && val !== 'Unknown' && val !== 'N/A';
}

function applyEnrichmentToCompany(company: ProspectingCompanyResult, enrichData: FastEnrichmentResult): ProspectingCompanyResult {
  const extras: Record<string, string> = { ...(company.extras || {}) };
  if (isKnown(enrichData.crNumber)) extras.crNumber = enrichData.crNumber;
  if (isKnown(enrichData.capital)) extras.capital = enrichData.capital;
  if (isKnown(enrichData.entityType)) extras.entityType = enrichData.entityType;
  if (isKnown(enrichData.registrationDate)) extras.registrationDate = enrichData.registrationDate;
  if (isKnown(enrichData.founded)) extras.founded = enrichData.founded;
  if (isKnown(enrichData.employees)) extras.employees = enrichData.employees;
  if (isKnown(enrichData.revenue)) extras.revenue = enrichData.revenue;
  if (enrichData.keyPeople && enrichData.keyPeople.length > 0) extras.keyPeople = enrichData.keyPeople.join('; ');
  if (enrichData.services && enrichData.services.length > 0) extras.services = enrichData.services.join('; ');
  if (isKnown(enrichData.ownerName)) extras.ownerName = enrichData.ownerName;
  if (isKnown(enrichData.ownerDetails)) extras.ownerDetails = enrichData.ownerDetails;
  if (isKnown(enrichData.estimatedWealth)) extras.estimatedWealth = enrichData.estimatedWealth;
  if (isKnown(enrichData.landline)) extras.landline = enrichData.landline;
  if (isKnown(enrichData.marketPositioning)) extras.marketPositioning = enrichData.marketPositioning;
  if (isKnown(enrichData.contactPerson)) extras.contactPerson = enrichData.contactPerson;
  if (enrichData.shareholders && enrichData.shareholders.length > 0) {
    const shText = enrichData.shareholders
      .filter(s => s.name && s.name !== 'Unknown')
      .map(s => `${s.name}${s.percentage && s.percentage !== 'Unknown' ? ` (${s.percentage})` : ''}${s.estimatedWealth && s.estimatedWealth !== 'Unknown' ? ` [~${s.estimatedWealth}]` : ''}`)
      .join('; ');
    if (shText) extras.shareholders = shText;
  }
  if (isKnown(enrichData.location)) extras.location = enrichData.location;
  const bestEmail = enrichData.email && isKnown(enrichData.email) ? enrichData.email : company.email;
  return {
    ...company,
    industry: isKnown(enrichData.industry) ? enrichData.industry : company.industry,
    description: isKnown(enrichData.profileSummary) ? enrichData.profileSummary : company.description,
    website: isKnown(enrichData.website) ? enrichData.website : company.website,
    phone: isKnown(enrichData.landline) && !company.phone ? enrichData.landline : company.phone,
    email: bestEmail || company.email,
    address: isKnown(enrichData.location) && !company.address ? enrichData.location : company.address,
    extras,
  };
}

function extractContactsFromHtml(html: string): { phones: string[]; emails: string[]; landlines: string[] } {
  const phones: string[] = [];
  const emails: string[] = [];
  const landlines: string[] = [];
  const phoneRegex = /(?:\+966|00966|0)[\s.-]?(?:1[0-9]|[2-9])[\s.-]?\d{3}[\s.-]?\d{4}/g;
  const phoneMatches = html.match(phoneRegex) || [];
  for (const p of phoneMatches) {
    const cleaned = p.replace(/[\s.-]/g, '');
    const normalized = cleaned.startsWith('+') ? cleaned :
      cleaned.startsWith('00966') ? '+' + cleaned.substring(2) :
      cleaned.startsWith('0') ? '+966' + cleaned.substring(1) : cleaned;
    if (normalized.length >= 12 && normalized.length <= 14) {
      const areaCode = normalized.substring(4, 5);
      if (['1', '2', '3', '4', '6', '7'].includes(areaCode)) {
        landlines.push(normalized);
      } else {
        phones.push(normalized);
      }
    }
  }
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emailMatches = html.match(emailRegex) || [];
  for (const e of emailMatches) {
    const lower = e.toLowerCase();
    if (!lower.includes('example.com') && !lower.includes('sentry') && !lower.includes('webpack') &&
        !lower.includes('placeholder') && !lower.endsWith('.png') && !lower.endsWith('.jpg') &&
        !lower.endsWith('.css') && !lower.endsWith('.js')) {
      emails.push(lower);
    }
  }
  return {
    phones: [...new Set(phones)].slice(0, 3),
    emails: [...new Set(emails)].slice(0, 3),
    landlines: [...new Set(landlines)].slice(0, 3),
  };
}

// Maps each user-selectable focus field key to search terms that help Perplexity find it
const FOCUS_FIELD_LABEL_TO_KEY: Record<string, string> = {
  'Company Name': 'companyName',
  'Phone': 'landline',
  'Email': 'email',
  'Website': 'website',
  'Address': 'address',
  'City': 'location',
  'Industry': 'industry',
  'Category': 'entityType',
  'CR Number': 'crNumber',
  'Employees': 'employees',
  'Revenue': 'revenue',
  'Founded Year': 'founded',
  'Owner/CEO': 'ownerName',
  'Description': 'description',
  'Registration Number': 'crNumber',
  'LinkedIn': 'services',
  'Services': 'services',
  'Subsidiaries': 'services',
};

function normalizeFocusFields(fields: string[]): string[] {
  return fields.map(f => FOCUS_FIELD_LABEL_TO_KEY[f] || f).filter((v, i, a) => a.indexOf(v) === i);
}

const FOCUS_FIELD_SEARCH_TERMS: Record<string, string> = {
  ownerName:          'owner founder chairman CEO managing director مالك مؤسس رئيس',
  shareholders:       'shareholders ownership stake equity مساهمون حصص ملكية',
  estimatedWealth:    'net worth wealth Forbes richest أثرى ثروة',
  landline:           'phone number landline contact هاتف اتصال رقم',
  email:              'email contact info بريد إلكتروني',
  crNumber:           'commercial registration CR number سجل تجاري',
  capital:            'paid up capital رأس المال المدفوع',
  revenue:            'revenue annual turnover إيرادات مبيعات سنوية',
  employees:          'employees headcount workforce عدد الموظفين',
  founded:            'founded established year تأسيس تاريخ',
  entityType:         'company type LLC JSC شركة مسؤولية محدودة',
  keyPeople:          'executives management board directors مدير تنفيذي مجلس إدارة',
  services:           'services products offerings خدمات منتجات',
  address:            'address location headquarters مقر العنوان',
  marketPositioning:  'market position competitors clients partners تنافسية عملاء',
};

async function fastEnrichSingle(company: ProspectingCompanyResult, language?: string, focusFields?: string[]): Promise<FastEnrichmentResult | null> {
  // Build a Perplexity search query tailored to the selected focus fields
  const focusSearchTerms = focusFields && focusFields.length > 0
    ? focusFields
        .filter(f => FOCUS_FIELD_SEARCH_TERMS[f])
        .map(f => FOCUS_FIELD_SEARCH_TERMS[f])
        .join(' ')
    : '';
  const searchQuery = `"${company.name}" Saudi Arabia ${company.city || ''} ${company.industry || ''} ${focusSearchTerms}`.trim();

  // If owner/shareholder/wealth fields are selected, run a dedicated ownership search
  const needsOwnerSearch = focusFields && (
    focusFields.includes('ownerName') ||
    focusFields.includes('shareholders') ||
    focusFields.includes('estimatedWealth')
  );
  const ownerSearchQuery = needsOwnerSearch
    ? `"${company.name}" Saudi Arabia owner founder shareholders ownership مالك مؤسس مساهمون`
    : null;

  let scrapedContacts: { phones: string[]; emails: string[]; landlines: string[] } = { phones: [], emails: [], landlines: [] };

  // Scrape more pages if landline/email is a focus field
  const needsContactScrape = !focusFields || focusFields.length === 0 ||
    focusFields.includes('landline') || focusFields.includes('email') || focusFields.includes('address');

  const webDataPromise = (company.website && !isPrivateUrl(company.website))
    ? fastFetchPage(company.website, 6000).then(r => {
        if (r.text.length > 200) scrapedContacts = extractContactsFromHtml(r.text);
        return r.text.substring(0, 3000);
      }).catch(() => "")
    : Promise.resolve("");

  // Also scrape /contact and /about pages for phone/email if contact is a focus
  const contactPagePromise = (needsContactScrape && company.website && !isPrivateUrl(company.website))
    ? (async () => {
        try {
          const base = company.website!.replace(/\/$/, '');
          const pages = [`${base}/contact`, `${base}/about`, `${base}/contact-us`];
          for (const page of pages) {
            try {
              const r = await fastFetchPage(page, 5000);
              if (r.text.length > 100) {
                const extra = extractContactsFromHtml(r.text);
                if (extra.landlines.length > 0) scrapedContacts.landlines.push(...extra.landlines);
                if (extra.emails.length > 0) scrapedContacts.emails.push(...extra.emails);
                if (extra.phones.length > 0) scrapedContacts.phones.push(...extra.phones);
                return r.text.substring(0, 1000);
              }
            } catch { continue; }
          }
        } catch { }
        return "";
      })()
    : Promise.resolve("");

  const perplexityPromise = (async () => {
    try {
      const perplexity = new (await import("../perplexity-service")).PerplexityService();
      const searchResult = await perplexity.researchQuery(searchQuery);
      const text = typeof searchResult === 'string' ? searchResult : searchResult?.answer || JSON.stringify(searchResult);
      return text.substring(0, 2000);
    } catch { return ""; }
  })();

  const ownerPerplexityPromise = ownerSearchQuery
    ? (async () => {
        try {
          const perplexity = new (await import("../perplexity-service")).PerplexityService();
          const searchResult = await perplexity.researchQuery(ownerSearchQuery);
          const text = typeof searchResult === 'string' ? searchResult : searchResult?.answer || JSON.stringify(searchResult);
          return text.substring(0, 1500);
        } catch { return ""; }
      })()
    : Promise.resolve("");

  const dbPromise = (async () => {
    try {
      const matches = await db.select().from(companiesTable)
        .where(ilike(companiesTable.nameEn, `%${company.name.split(' ')[0]}%`))
        .limit(1);
      if (matches.length > 0) {
        const m = matches[0];
        return `DB match: ${m.nameEn || m.nameAr}, Industry: ${m.industry}, Employees: ${m.employeeCount || 'N/A'}, Revenue: ${m.revenue || 'N/A'}, Founded: ${m.foundingYear || 'N/A'}, Owner: ${m.ownerName || 'N/A'}, City: ${m.city || 'N/A'}`;
      }
      return "";
    } catch { return ""; }
  })();

  const saudiSourcesPromise = (async () => {
    try {
      const timeoutPromise = new Promise<string>((resolve) => setTimeout(() => resolve(""), 20000));
      const fetchPromise = (async () => {
        const { fetchSaudiSources } = await import("./saudi-data-sources");
        const result = await fetchSaudiSources(company.name, { skipSlow: true });
        return result.rawText.substring(0, 3000);
      })();
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch { return ""; }
  })();

  const exploriumPromise = (async () => {
    const EXPLORIUM_KEY = process.env.EXPLORIUM_API_KEY;
    if (!EXPLORIUM_KEY) return "";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const resp = await fetch("https://app.explorium.ai/api/bundle/v1/enrich/firmographics", {
        method: "POST",
        headers: { "Content-Type": "application/json", "api_key": EXPLORIUM_KEY },
        body: JSON.stringify([{ company: company.name, domain: company.website }]),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) return "";
      const data = await resp.json();
      const d = Array.isArray(data) && data.length > 0 ? data[0] : data;
      if (!d) return "";
      const parts: string[] = [];
      if (d.employee_count) parts.push(`Employees: ${d.employee_count}`);
      if (d.revenue || d.annual_revenue) parts.push(`Revenue: ${d.revenue || d.annual_revenue}`);
      if (d.industry) parts.push(`Industry: ${d.industry}`);
      if (d.founded_year || d.year_founded) parts.push(`Founded: ${d.founded_year || d.year_founded}`);
      if (d.company_type) parts.push(`Type: ${d.company_type}`);
      if (d.description) parts.push(`Desc: ${String(d.description).substring(0, 500)}`);
      if (d.address || d.full_address) parts.push(`Address: ${d.address || d.full_address}`);
      if (d.phone) parts.push(`Phone: ${d.phone}`);
      if (d.website || d.domain) parts.push(`Website: ${d.website || d.domain}`);
      if (d.linkedin_url) parts.push(`LinkedIn: ${d.linkedin_url}`);
      return parts.length > 0 ? parts.join('\n') : "";
    } catch { return ""; }
  })();

  const [webData, perplexityData, dbMatch, saudiGovData, exploriumData, ownerData, contactPageData] = await Promise.all([
    webDataPromise, perplexityPromise, dbPromise, saudiSourcesPromise, exploriumPromise, ownerPerplexityPromise, contactPagePromise
  ]);

  // Deduplicate scraped contacts after all pages are fetched
  scrapedContacts.landlines = [...new Set(scrapedContacts.landlines)].slice(0, 3);
  scrapedContacts.emails    = [...new Set(scrapedContacts.emails)].slice(0, 3);
  scrapedContacts.phones    = [...new Set(scrapedContacts.phones)].slice(0, 3);

  const langInstruction = language === 'arabic'
    ? `OUTPUT LANGUAGE: Write ALL text fields in Arabic (العربية) — profileSummary, industry, services, marketPositioning, location. Keep numbers, URLs, emails, and phone numbers in their original format.`
    : `OUTPUT LANGUAGE: Write ALL text fields in English. If source data is in Arabic, translate to English. Keep numbers, URLs, emails, and phone numbers in their original format.`;

  // Build a human-readable, forceful focus instruction
  const FOCUS_FIELD_LABELS: Record<string, string> = {
    ownerName: 'Owner / Founder full name (real person, not estimated)',
    shareholders: 'Shareholders with names and ownership %',
    estimatedWealth: "Owner's estimated net worth (e.g. SAR 500M — only if publicly documented)",
    landline: 'Saudi landline phone number (01x or +9661x format)',
    email: 'Company email address',
    crNumber: 'Saudi commercial registration (CR) number — 10 digits',
    capital: 'Paid-up capital amount',
    revenue: 'Annual revenue or turnover',
    employees: 'Employee count or range',
    founded: 'Year founded / established',
    entityType: 'Legal entity type (LLC / JSC / Sole Proprietorship)',
    keyPeople: 'Key executives and their titles',
    services: 'Services and products offered',
    address: 'Full physical address',
    location: 'City and district',
    marketPositioning: 'Market position, key clients, competitive standing',
    website: 'Company website URL',
    contactPerson: 'Contact person name and title',
  };
  const focusInstruction = focusFields && focusFields.length > 0
    ? `\n=== MANDATORY OUTPUT FIELDS ===\nThe user SPECIFICALLY requested the following fields. You MUST populate each one using every source provided below. Do NOT return "Unknown" for these unless absolutely no information exists across all sources:\n${focusFields.map(f => `• ${FOCUS_FIELD_LABELS[f] || f}`).join('\n')}\n`
    : '';

  const scrapedLandlines = scrapedContacts.landlines;
  const scrapedPhones = scrapedContacts.phones;
  const scrapedEmails = scrapedContacts.emails;
  const verifiedContactSection = (scrapedLandlines.length > 0 || scrapedPhones.length > 0 || scrapedEmails.length > 0)
    ? `=== VERIFIED CONTACTS (scraped directly from company website — treat as authoritative) ===
${scrapedLandlines.length > 0 ? `Landlines: ${scrapedLandlines.join(', ')}` : ''}
${scrapedPhones.length > 0 ? `Mobile phones: ${scrapedPhones.join(', ')}` : ''}
${scrapedEmails.length > 0 ? `Emails: ${scrapedEmails.join(', ')}` : ''}
`
    : '';

  const enrichPrompt = `You are a Saudi business intelligence analyst. Your task is to extract REAL, VERIFIED data about this company from the research sources below.

${langInstruction}
${focusInstruction}
Company: ${company.name}
City: ${company.city || 'Unknown'}
Industry: ${company.industry || 'Unknown'}
Phone (from directory): ${company.phone || 'N/A'}
Website: ${company.website || 'N/A'}

${verifiedContactSection}
${webData ? `=== Company Website Content ===\n${webData}\n` : ''}
${contactPageData ? `=== Company Contact/About Page ===\n${contactPageData}\n` : ''}
${perplexityData ? `=== Web Research (focus-targeted search) ===\n${perplexityData}\n` : ''}
${ownerData ? `=== Ownership Research ===\n${ownerData}\n` : ''}
${dbMatch ? `=== ORQESTRA Database Match ===\n${dbMatch}\n` : ''}
${saudiGovData ? `=== Saudi Government Sources (Wathq, Ministry of Commerce, Wikidata) ===\n${saudiGovData}\n` : ''}
${exploriumData ? `=== Explorium Firmographic Data ===\n${exploriumData}\n` : ''}

Return a comprehensive JSON with ALL fields you can verify:
{
  "profileSummary": "<4-5 sentence company brief: what they do, market position, key achievements, target customers, and significance in Saudi market>",
  "industry": "<specific industry sector>",
  "employees": "<employee count or range>",
  "revenue": "<annual revenue if known, e.g. SAR 50M or USD 15M>",
  "founded": "<founding year>",
  "services": ["<service 1>", "<service 2>"],
  "keyPeople": ["<Full Name - Title>"],
  "ownerName": "<owner/founder full name — REAL only, not estimated>",
  "ownerDetails": "<background, education, other ventures of the owner>",
  "estimatedWealth": "<owner/founder estimated net worth if publicly known, e.g. SAR 500M>",
  "shareholders": [{"name": "<shareholder name>", "percentage": "<% stake>", "estimatedWealth": "<net worth if known>"}],
  "location": "<full address with city and district>",
  "landline": "${scrapedLandlines.length > 0 ? scrapedLandlines[0] : '<Saudi landline starting with 01x or +9661x>'}",
  "email": "${scrapedEmails.length > 0 ? scrapedEmails[0] : '<real company email>'}",
  "website": "<verified URL>",
  "socialMedia": {"linkedin": "", "twitter": "", "instagram": ""},
  "crNumber": "<Saudi CR number — 10 digits>",
  "capital": "<paid up capital, e.g. SAR 1,000,000>",
  "entityType": "<LLC/JSC/SJSC/Sole Proprietorship>",
  "registrationDate": "<CR issue date>",
  "marketPositioning": "<competitive position, market share, key clients, industry standing>",
  "contactPerson": "<name and title of contact person if found>"
}

STRICT RULES:
- ONLY include data you can verify from the sources above. Use "Unknown" for unverified fields.
- NEVER fabricate phone numbers, emails, CR numbers, or owner names.
- If scraped contacts are provided above, use them for landline/email — they are real and override anything else.
- The profileSummary MUST be detailed (4-5 sentences) — this is what the user reads first.
- For estimatedWealth: only include if publicly known (e.g. Forbes Arabia listed). Otherwise "Unknown".
- For the MANDATORY OUTPUT FIELDS listed above: search every source section thoroughly before returning "Unknown". If Perplexity has the answer, use it. If the Saudi government data has it, use it. Cross-reference all sources.
- Phone numbers already in "Phone (from directory)" field above are real — include them in landline/contactPerson if they match Saudi landline format.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: enrichPrompt }],
      response_format: { type: "json_object" },
      max_tokens: 2500,
    });
    const result = JSON.parse(response.choices[0]?.message?.content || 'null') as FastEnrichmentResult & { email?: string; ownerDetails?: string; estimatedWealth?: string; contactPerson?: string };
    if (result && scrapedLandlines.length > 0 && (!result.landline || result.landline === 'Unknown')) {
      result.landline = scrapedLandlines[0];
    }
    if (result && scrapedEmails.length > 0 && (!result.email || result.email === 'Unknown')) {
      result.email = scrapedEmails[0];
    }
    return result as FastEnrichmentResult;
  } catch (enrichErr: unknown) {
    const msg = enrichErr instanceof Error ? enrichErr.message : String(enrichErr);
    console.log(`[Prospecting] AI enrichment failed for ${company.name}: ${msg.substring(0, 120)}`);
    return null;
  }
}

async function enrichResultsAsync(jobId: number, depth: string, language?: string, focusFields?: string[]) {
  const startTime = Date.now();
  console.log(`[Prospecting] Starting enrichment for job ${jobId} (depth: ${depth}, lang: ${language || 'english'})`);
  const dbResults = await db.select().from(prospectingResultsTable)
    .where(eq(prospectingResultsTable.jobId, jobId));

  let enrichedCount = 0;
  const maxEnrich = depth === 'basic' ? 10 : dbResults.length;
  const toEnrich = dbResults.slice(0, Math.min(dbResults.length, maxEnrich));
  console.log(`[Prospecting] Enriching ${toEnrich.length} of ${dbResults.length} companies (depth: ${depth})`);

  // Smart Prospecting always uses fastEnrichSingle (5 parallel sources + GPT-4o).
  // The full orchestra (enrichCompany) is for single-company research only — it takes
  // 6+ minutes per company and will always timeout in a bulk prospecting context.
  const CONCURRENCY = 5;
  for (let i = 0; i < toEnrich.length; i += CONCURRENCY) {
    const batch = toEnrich.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (result) => {
      const company = result.companyData as ProspectingCompanyResult;
      // 150s per company: covers Perplexity (~60s) + Saudi gov data (~30s) + GPT-4o (~20s)
      const enrichTimeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Enrichment timeout (150s)")), 150000)
      );
      try {
        await db.update(prospectingResultsTable).set({ enrichmentStatus: 'in_progress' })
          .where(eq(prospectingResultsTable.id, result.id));

        await Promise.race([enrichTimeout, (async () => {
          const enrichData = await fastEnrichSingle(company, language, focusFields);
          if (enrichData) {
            const updatedCompany = applyEnrichmentToCompany(company, enrichData);

            let reportId: string | undefined;
            try {
              const [report] = await db.insert(enrichmentReportsTable).values({
                type: 'company',
                subjectName: company.name,
                subjectCompany: company.name,
                confidenceScore: enrichData.profileSummary && enrichData.profileSummary !== 'Unknown' ? 'high' : 'medium',
                reportData: enrichData,
                sources: [],
              }).returning();
              reportId = String(report.id);
            } catch {
              /* enrichment report is best-effort */
            }

            await db.update(prospectingResultsTable).set({
              enrichmentStatus: 'completed',
              companyData: updatedCompany,
              ...(reportId ? { enrichmentReportId: reportId } : {}),
            }).where(eq(prospectingResultsTable.id, result.id));
          } else {
            await db.update(prospectingResultsTable).set({ enrichmentStatus: 'failed' })
              .where(eq(prospectingResultsTable.id, result.id));
          }

          enrichedCount++;
          const enrichProgress = 50 + Math.round((enrichedCount / toEnrich.length) * 50);
          await db.update(prospectingJobsTable).set({ totalEnriched: enrichedCount, progress: enrichProgress })
            .where(eq(prospectingJobsTable.id, jobId));
          console.log(`[Prospecting] Enriched ${enrichedCount}/${toEnrich.length}: ${company.name} (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
        })()]);
      } catch (e: unknown) {
        await db.update(prospectingResultsTable).set({ enrichmentStatus: 'failed' })
          .where(eq(prospectingResultsTable.id, result.id));
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[Prospecting] Enrichment failed for ${company.name}: ${msg.substring(0, 80)}`);
      }
    }));
  }

  await db.update(prospectingJobsTable).set({
    status: "completed",
    totalEnriched: enrichedCount,
    progress: 100,
    completedAt: new Date(),
  }).where(eq(prospectingJobsTable.id, jobId));

  console.log(`[Prospecting] Enrichment complete: ${enrichedCount}/${toEnrich.length} in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

export async function getProspectingJob(jobId: string): Promise<ProspectingJob | null> {
  const numId = parseInt(jobId, 10);
  if (isNaN(numId)) return null;
  const [job] = await db.select().from(prospectingJobsTable).where(eq(prospectingJobsTable.id, numId)).limit(1);
  return job || null;
}

export async function getProspectingResults(jobId: string): Promise<ProspectingResult[]> {
  const numId = parseInt(jobId, 10);
  if (isNaN(numId)) return [];
  return db.select().from(prospectingResultsTable)
    .where(eq(prospectingResultsTable.jobId, numId))
    .orderBy(prospectingResultsTable.createdAt);
}

export async function listProspectingJobs(): Promise<ProspectingJob[]> {
  return db.select().from(prospectingJobsTable)
    .orderBy(desc(prospectingJobsTable.createdAt))
    .limit(50);
}

export async function deleteProspectingJob(jobId: string): Promise<void> {
  const numId = parseInt(jobId, 10);
  if (isNaN(numId)) return;
  await db.delete(prospectingResultsTable).where(eq(prospectingResultsTable.jobId, numId));
  await db.delete(prospectingJobsTable).where(eq(prospectingJobsTable.id, numId));
}

interface ExportOutput {
  content: string;
  filename: string;
  mimeType: string;
}

export async function exportProspectingResults(jobId: string, format: string): Promise<ExportOutput> {
  const numId = parseInt(jobId, 10);
  if (isNaN(numId)) throw new Error("Invalid job ID");
  const [job] = await db.select().from(prospectingJobsTable).where(eq(prospectingJobsTable.id, numId)).limit(1);
  if (!job) throw new Error("Job not found");

  const dbResults = await db.select().from(prospectingResultsTable)
    .where(eq(prospectingResultsTable.jobId, numId));

  const companies: ProspectingCompanyExport[] = dbResults.map(r => {
    const data = r.companyData as ProspectingCompanyResult;
    const extras = data.extras || {};
    return {
      name: data.name,
      phone: data.phone,
      email: data.email,
      website: data.website,
      address: data.address,
      city: data.city,
      industry: data.industry,
      description: data.description,
      contactPerson: data.contactPerson,
      enrichmentStatus: r.enrichmentStatus || 'pending',
      crNumber: extras.crNumber,
      capital: extras.capital,
      entityType: extras.entityType,
      registrationDate: extras.registrationDate,
      founded: extras.founded,
      employees: extras.employees,
      revenue: extras.revenue,
      keyPeople: extras.keyPeople,
      services: extras.services,
      ownerName: extras.ownerName,
      shareholders: extras.shareholders,
      landline: extras.landline,
      location: extras.location,
      marketPositioning: extras.marketPositioning,
    };
  });

  let enrichmentData: ProspectingEnrichmentData[] = [];
  const enrichedIds = dbResults
    .filter(r => r.enrichmentReportId)
    .map(r => parseInt(r.enrichmentReportId as string, 10))
    .filter(id => !isNaN(id));
  if (enrichedIds.length > 0) {
    try {
      const reports = await db.select().from(enrichmentReportsTable)
        .where(inArray(enrichmentReportsTable.id, enrichedIds));
      enrichmentData = reports.map(report => {
        const data = report.reportData as EnrichmentReportData | null;
        return {
          subjectName: report.subjectName,
          confidenceScore: report.confidenceScore,
          profileSummary: data?.profileSummary,
          financials: data?.financials ? {
            annualRevenue: data.financials.annualRevenue,
            revenueGrowth: data.financials.revenueGrowth,
            netIncome: data.financials.netIncome,
            profitMargin: data.financials.profitMargin,
            totalAssets: data.financials.totalAssets,
          } : undefined,
          workforce: data?.workforce ? {
            totalEmployees: data.workforce.totalEmployees,
            employeeGrowth: data.workforce.employeeGrowth,
            saudiNationalsPercentage: data.workforce.saudiNationalsPercentage,
          } : undefined,
          companyOverview: data?.companyOverview ? {
            founded: data.companyOverview.founded,
            headquarters: data.companyOverview.headquarters,
            companyType: data.companyOverview.companyType,
          } : undefined,
          leadership: data?.leadership ? {
            executiveTeam: data.leadership.executiveTeam,
            boardOfDirectors: data.leadership.boardOfDirectors,
          } : undefined,
          strengths: data?.strengths,
          keyInsights: data?.keyInsights,
        };
      });
    } catch {
      console.log(`[Prospecting] Could not fetch enrichment data for export`);
    }
  }

  const input = {
    targetUrl: job.targetUrl,
    totalCompanies: companies.length,
    totalEnriched: job.totalEnriched || 0,
    pagesScanned: job.pagesScanned || 0,
    companies,
    enrichmentData,
  };

  if (format === 'csv') {
    const result = exportProspectingToCSV(input);
    return { content: result.content, filename: result.filename, mimeType: result.mimeType };
  }
  if (format === 'json') {
    const result = exportProspectingToJSON(input);
    return { content: result.content, filename: result.filename, mimeType: result.mimeType };
  }
  if (format === 'excel' || format === 'xlsx') {
    const result = exportProspectingToExcel(input);
    return { content: result.content, filename: result.filename, mimeType: result.mimeType };
  }
  if (format === 'pdf' || format === 'html') {
    const result = await exportProspectingToPDF(input);
    return { content: result.content, filename: result.filename, mimeType: result.mimeType };
  }

  return {
    content: companies.map(c => `${c.name} | ${c.phone || '-'} | ${c.email || '-'} | ${c.city || '-'} | ${c.industry || '-'}`).join('\n'),
    filename: `Prospecting_${new URL(job.targetUrl).hostname.replace('www.', '')}_${new Date().toISOString().split('T')[0]}.txt`,
    mimeType: 'text/plain',
  };
}

