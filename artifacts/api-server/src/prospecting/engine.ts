import { db } from "@workspace/db";
import { prospectingJobsTable, prospectingResultsTable, enrichmentReportsTable, companiesTable, prospectingExportsTable } from "@workspace/db";
import type { ProspectingJob, ProspectingResult, ProspectingCompanyResult, SiteScanSummary, ProspectingSettings, FastEnrichmentResult } from "@workspace/db";
import type { ProspectingExport } from "@workspace/db";
import { eq, desc, ilike } from "drizzle-orm";
import { multiAgentScrape, crawlFullWebsite, getBestContent } from "../orcengine/scraper";
import type { ScrapeResultItem, MultiAgentScrapeResult } from "../orcengine/scraper";
import { getPageContent, parseHtml } from "../browser-helper";
import { openai } from "../openai-client";
import { nexusExtract, nexusSynthesize } from "../lib/nexus/index.js";
import { scoutSiteIntel } from "../lib/scout-client.js";
import {
  exportProspectingToCSV,
  exportProspectingToJSON,
  exportProspectingToExcel,
  exportProspectingToPDF,
} from "../orcengine/export-service";
import type { ProspectingCompanyExport, ProspectingEnrichmentData, ProspectingExportInput } from "../orcengine/export-service";

const WAF_INDICATORS = [
  'cloudflare', 'just a moment', 'ray id', 'captcha', 'checking your browser',
  'access denied', 'ddos protection', 'sucuri', 'wordfence', 'cf-browser-verification',
  'attention required', 'please wait while we verify', 'blocked by',
  'security check', 'challenge-platform',
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

function detectContentLanguage(content: string): 'arabic' | 'english' | 'mixed' {
  const arabicChars = (content.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (content.match(/[a-zA-Z]/g) || []).length;
  const total = arabicChars + latinChars;
  if (total === 0) return 'english';
  const ratio = arabicChars / total;
  if (ratio > 0.7) return 'arabic';
  if (ratio > 0.4) return 'mixed';
  return 'english';
}

function extractContactsFromHtml(html: string): { phones: string[]; emails: string[]; landlines: string[] } {
  const phones: string[] = [];
  const emails: string[] = [];
  const landlines: string[] = [];
  const landlineRegex = /(?:\+966|00966|0)[\s.-]?(?:1|2|3|4|6|7)[\s.-]?\d{3}[\s.-]?\d{4}/g;
  const mobileRegex = /05\d[\s.-]?\d{3}[\s.-]?\d{4}/g;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  const landlineMatches = html.match(landlineRegex) || [];
  for (const p of landlineMatches) {
    const cleaned = p.replace(/[\s.-]/g, '');
    const normalized = cleaned.startsWith('+') ? cleaned :
      cleaned.startsWith('00966') ? '+' + cleaned.substring(2) :
      cleaned.startsWith('0') ? '+966' + cleaned.substring(1) : cleaned;
    if (normalized.length >= 12 && normalized.length <= 14) {
      landlines.push(normalized);
    }
  }

  const mobileMatches = html.match(mobileRegex) || [];
  for (const p of mobileMatches) {
    const cleaned = p.replace(/[\s.-]/g, '');
    const normalized = '+966' + cleaned.substring(1);
    phones.push(normalized);
  }

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
      throw new Error('WAF blocked or thin content');
    }

    return { html, text };
  } catch {
    try {
      console.log(`[Prospecting] Tier 1 failed for ${url}, trying Playwright (Tier 2)...`);
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

const LISTING_PATTERNS_EN = [
  /\/search/i, /\/directory/i, /\/listing/i, /\/companies/i, /\/members/i,
  /\/catalog/i, /\/browse/i, /\/category/i, /\/results/i, /\/businesses/i,
  /\/firms/i, /\/organizations/i, /\/find/i, /\/explore/i, /\/all[-_]?compan/i,
  /\/index/i, /\/page/i, /\/list/i,
];
const LISTING_PATTERNS_AR = [/\/بحث/i, /\/شركات/i, /\/دليل/i, /\/أعضاء/i, /\/تصنيف/i];
const LISTING_PATTERNS = [...LISTING_PATTERNS_EN, ...LISTING_PATTERNS_AR];

function findListingPages(allLinks: string[]): string[] {
  const candidates = allLinks.filter(url => {
    try {
      const path = new URL(url).pathname + new URL(url).search;
      return LISTING_PATTERNS.some(p => p.test(path));
    } catch { return false; }
  });
  if (candidates.length > 0) return candidates.slice(0, 5);
  const nonHomepageLinks = allLinks.filter(u => {
    try { return new URL(u).pathname !== '/' && new URL(u).pathname.length > 1; } catch { return false; }
  });
  return nonHomepageLinks.slice(0, 3);
}

function detectPaginationType(html: string): 'numbered' | 'load_more' | 'infinite_scroll' | 'unknown' {
  const lower = html.toLowerCase();
  if (/page=2|p=2|offset=|\?page/i.test(lower)) return 'numbered';
  if (/load\s*more|show\s*more|more\s*results|المزيد/i.test(lower)) return 'load_more';
  return 'unknown';
}

async function updateScanProgress(jobId: number, progressPct: number, progressMessage: string) {
  try {
    await db.update(prospectingJobsTable).set({
      progress: progressPct,
      scanResult: { progressMessage } as any,
    }).where(eq(prospectingJobsTable.id, jobId));
  } catch { }
}

export async function scanWebsite(targetUrl: string): Promise<ProspectingJob> {
  const [job] = await db.insert(prospectingJobsTable).values({
    targetUrl,
    status: "scanning",
    settings: { targetUrl, maxPages: 50, extractionFields: [], filters: {}, enrichmentDepth: 'standard' } satisfies ProspectingSettings,
  } as any).returning();

  scanWebsiteAsync(job.id, targetUrl).catch(err => {
    console.error(`[Prospecting] Scan failed: ${(err as Error).message}`);
  });

  return job;
}

async function scanWebsiteAsync(jobId: number, targetUrl: string) {
  const startTime = Date.now();
  console.log(`[Prospecting] Phase 1 SCAN started: ${targetUrl}`);
  try {
    await updateScanProgress(jobId, 10, 'Fetching target URL...');

    const fetched = await fastFetchPage(targetUrl);
    let homepageHtml = fetched.text;
    let homepageText = fetched.text;

    if (!homepageText || homepageText.length < 50) {
      await updateScanProgress(jobId, 15, 'Direct fetch failed, trying crawl4ai...');
      try {
        const { crawl4ai } = await import('../crawl4ai-engine.js');
        const crawlResult = await crawl4ai(targetUrl);
        if (crawlResult?.text && crawlResult.text.length > 100) {
          homepageText = crawlResult.text.slice(0, 15000);
          if (crawlResult.text) homepageHtml = crawlResult.text;
          console.log(`[Prospecting] crawl4ai succeeded for ${targetUrl} (${homepageText.length} chars)`);
        }
      } catch (crawlErr) {
        console.log(`[Prospecting] crawl4ai failed: ${(crawlErr as Error).message?.substring(0, 80)}`);
      }
    }

    if (!homepageText || homepageText.length < 50) {
      await updateScanProgress(jobId, 18, 'Trying StealthBrowser...');
      try {
        const { StealthBrowser, HumanBehavior } = await import('../lib/stealth-browser.js');
        const domain = targetUrl.replace(/^https?:\/\//, '').split('/')[0];
        const browser = new StealthBrowser((msg) => console.log(`[Prospecting:StealthBrowser] ${msg}`));
        await browser.start(domain);
        await browser.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20000 });
        await HumanBehavior.idle(1000, 2000);
        const rawHtml = await browser.getContent() || '';
        await browser.stop().catch(() => {});
        if (rawHtml.length > 500) {
          const $ = parseHtml(rawHtml);
          $('script,style,noscript,svg').remove();
          const stealthText = $('body').text().replace(/\s+/g, ' ').trim();
          if (stealthText.length > 100) {
            homepageText = stealthText.slice(0, 15000);
            homepageHtml = rawHtml;
            console.log(`[Prospecting] StealthBrowser succeeded for ${targetUrl} (${homepageText.length} chars)`);
          }
        }
      } catch (stealthErr) {
        console.log(`[Prospecting] StealthBrowser failed: ${(stealthErr as Error).message?.substring(0, 80)}`);
      }
    }

    if (!homepageText || homepageText.length < 50) {
      await db.update(prospectingJobsTable).set({
        status: "failed",
        error: "Could not retrieve content from the provided URL. The website may be blocking automated access.",
      } as any).where(eq(prospectingJobsTable.id, jobId));
      return;
    }

    console.log(`[Prospecting] Homepage fetched in ${Date.now() - startTime}ms (${homepageText.length} chars)`);
    await updateScanProgress(jobId, 30, 'Detecting language and structure...');

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
      } catch { }
    });

    const filteredLinks = filterRelevantUrls(allLinks, baseUrl.hostname);
    console.log(`[Prospecting] Found ${filteredLinks.length} relevant links`);

    await updateScanProgress(jobId, 40, 'Identifying listing pages...');
    const listingPages = findListingPages(filteredLinks);
    console.log(`[Prospecting] ${listingPages.length} listing page candidates`);

    const paginationType = detectPaginationType(homepageHtml);

    await updateScanProgress(jobId, 50, 'Sampling listing pages...');
    const listingSamples = await Promise.allSettled(
      listingPages.slice(0, 2).map(async (listUrl) => {
        const { text } = await fastFetchPage(listUrl, 8000);
        return { url: listUrl, text: text.substring(0, 6000) };
      })
    );

    let listingSampleText = "";
    let successfulSamples = 0;
    for (const result of listingSamples) {
      if (result.status === 'fulfilled' && result.value.text.length > 100) {
        listingSampleText += `\n\n--- LISTING PAGE: ${result.value.url} ---\n${result.value.text}`;
        successfulSamples++;
      }
    }
    console.log(`[Prospecting] Sampled ${successfulSamples} listing pages`);

    if (successfulSamples === 0 && filteredLinks.length > 0) {
      const fallbackLinks = filteredLinks.filter(u => !listingPages.includes(u)).slice(0, 3);
      const fallbackSamples = await Promise.allSettled(
        fallbackLinks.map(async (fbUrl) => {
          const { text } = await fastFetchPage(fbUrl, 8000);
          return { url: fbUrl, text: text.substring(0, 5000) };
        })
      );
      for (const result of fallbackSamples) {
        if (result.status === 'fulfilled' && result.value.text.length > 100) {
          listingSampleText += `\n\n--- PAGE: ${result.value.url} ---\n${result.value.text}`;
          successfulSamples++;
        }
      }
    }

    const allContent = (homepageText.substring(0, 8000) + listingSampleText).substring(0, 20000);
    await updateScanProgress(jobId, 70, 'AI analyzing site structure...');

    let scanSummary: SiteScanSummary;
    try {
      const prompt = `You are an intelligent web data extraction analyst. A user pasted a URL and wants to extract structured company/business data from it.

Your job:
1. Analyze what TYPE of website this is and what DATA it contains
2. Identify what companies/businesses are LISTED on this site
3. Generate TAILORED questions based on what you actually see in the content
4. The questions are NOT templates — read the actual site content and generate questions from what you found

IMPORTANT:
- If this is a government registry → ask about entity type (LLC / JSC / Sole Proprietorship) with options from the registry
- If this is a healthcare directory → ask about medical specialty using visible specialties
- If this is a chamber of commerce → ask about sector using the chamber's actual taxonomy
- If this is a business directory → ask about industry, city, size based on actual filters visible
- Generate ONLY questions relevant to THIS specific website's content
- Read Arabic content fluently if present

Content language: ${contentLanguage === 'arabic' ? 'Arabic (العربية)' : contentLanguage === 'mixed' ? 'Arabic+English' : 'English'}

URL: ${targetUrl}
Sampled content:
${allContent}

Discovered URLs (${filteredLinks.length} total): ${filteredLinks.slice(0, 20).join('\n')}
Listing page candidates: ${listingPages.join('\n')}

Return ONLY valid JSON:
{
  "totalPages": <estimated number of listing pages>,
  "sampleCompanies": [<up to 10 REAL company names found in the content — NOT the website itself>],
  "categories": [<content categories/industries found>],
  "cities": [<geographic locations found>],
  "industries": [<industry sectors found>],
  "websiteType": "<directory|marketplace|company_site|association|government|other>",
  "paginationType": "${paginationType}",
  "contentLanguage": "${contentLanguage}",
  "suggestedQuestions": [
    <2-4 tailored questions based on actual site content. Each must have "question" and "options" keys. Options must come from real content visible on the site.>,
    {"question": "What level of detail do you need?", "options": ["Basic", "Standard", "Deep"]},
    {"question": "How many companies to extract?", "options": ["First 50", "First 100", "First 200", "All available"]}
  ]
}

CRITICAL: The LAST TWO questions must ALWAYS be "What level of detail do you need?" and "How many companies to extract?" exactly as shown above. The earlier questions must be tailored to THIS website only.`;

      // NEXUS extraction tier with GPT-4o fallback + retry
      let scanRaw = '{}';
      try {
        const nexusResult = await nexusExtract(prompt, "Extract site scan summary as JSON matching the requested schema exactly.", { maxTokens: 2000, temperature: 0 });
        scanRaw = typeof nexusResult === "string" ? nexusResult : JSON.stringify(nexusResult);
        console.log(`[Prospecting] NEXUS site scan extraction complete`);
      } catch {
        let response: Awaited<ReturnType<typeof openai.chat.completions.create>> | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            response = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
              max_tokens: 2000,
            });
            break;
          } catch (retryErr: unknown) {
            const msg = (retryErr as Error).message || '';
            if (msg.includes('429') || msg.includes('rate') || msg.includes('quota')) {
              const delay = (attempt + 1) * 5000;
              console.log(`[Prospecting] Rate limited (attempt ${attempt + 1}/3), retrying in ${delay / 1000}s...`);
              await new Promise(r => setTimeout(r, delay));
            } else {
              throw retryErr;
            }
          }
        }
        if (!response) throw new Error('AI analysis failed after 3 retries');
        scanRaw = response.choices[0]?.message?.content || '{}';
      }

      scanSummary = JSON.parse(scanRaw) as SiteScanSummary;
      scanSummary.paginationType = scanSummary.paginationType || paginationType;
      scanSummary.websiteType = scanSummary.websiteType || 'other';
      scanSummary.contentLanguage = scanSummary.contentLanguage || contentLanguage;
      scanSummary.sampleCompanies = scanSummary.sampleCompanies || [];
      scanSummary.categories = scanSummary.categories || [];
      scanSummary.cities = scanSummary.cities || [];
      scanSummary.industries = scanSummary.industries || [];
      scanSummary.listingPages = listingPages.slice(0, 10);

      if (!(scanSummary?.suggestedQuestions ?? []) || ((scanSummary?.suggestedQuestions ?? [])?.length ?? 0) === 0) {
        if (scanSummary) scanSummary.suggestedQuestions = buildDefaultQuestions(scanSummary);
      }

      const lastQ = ((scanSummary?.suggestedQuestions ?? []) ?? [])[((scanSummary?.suggestedQuestions ?? [])?.length ?? 0) - 1];
      if (!lastQ || !lastQ.question.toLowerCase().includes('how many')) {
        (scanSummary?.suggestedQuestions ?? (scanSummary.suggestedQuestions = [])).push({
          question: "How many companies to extract?",
          options: ["First 50", "First 100", "First 200", "All available"],
        });
      }
      const secondLastQ = ((scanSummary?.suggestedQuestions ?? []) ?? [])[((scanSummary?.suggestedQuestions ?? [])?.length ?? 0) - 2];
      if (!secondLastQ || !secondLastQ.question.toLowerCase().includes('level of detail')) {
        (scanSummary?.suggestedQuestions ?? []).splice(((scanSummary?.suggestedQuestions ?? [])?.length ?? 0) - 1, 0, {
          question: "What level of detail do you need?",
          options: ["Basic", "Standard", "Deep"],
        });
      }

      for (const sq of (scanSummary?.suggestedQuestions ?? [])) {
        if (!sq.options || sq.options.length === 0) {
          sq.options = ["All available"];
        }
        const qLower = sq.question.toLowerCase();
        if (!sq.options.some(o => o.toLowerCase().startsWith('all'))) {
          if (qLower.includes('city') || qLower.includes('region') || qLower.includes('location')) {
            sq.options.unshift("All cities");
          } else if (qLower.includes('industr') || qLower.includes('sector')) {
            sq.options.unshift("All industries");
          } else if (qLower.includes('categor') || qLower.includes('type')) {
            sq.options.unshift("All");
          }
        }
      }
    } catch (aiErr: unknown) {
      console.log(`[Prospecting] AI scan analysis error: ${(aiErr as Error).message?.substring(0, 120)}`);
      scanSummary = {
        totalPages: filteredLinks.length || 1,
        sampleCompanies: [],
        categories: [],
        cities: [],
        industries: [],
        suggestedQuestions: buildDefaultQuestions(null),
        paginationType,
        websiteType: 'directory',
        contentLanguage,
        listingPages: listingPages.slice(0, 10),
      };
    }

    await db.update(prospectingJobsTable).set({
      status: "scanned",
      progress: 100,
      scanSummary,
      scanResult: { progressMessage: `Scan complete — found ${scanSummary.totalPages || 0} pages, ${scanSummary.sampleCompanies?.length || 0} sample companies` },
      pagesScanned: listingPages.length + 1,
    }).where(eq(prospectingJobsTable.id, jobId));

    const elapsed = Date.now() - startTime;
    console.log(`[Prospecting] Scan complete in ${(elapsed / 1000).toFixed(1)}s: ${scanSummary.sampleCompanies?.length || 0} samples, type: ${scanSummary.websiteType}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(prospectingJobsTable).set({
      status: "failed",
      error: message.substring(0, 500),
    } as any).where(eq(prospectingJobsTable.id, jobId));
  }
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
  questions.push({
    question: "What level of detail do you need?",
    options: ["Basic", "Standard", "Deep"],
  });
  questions.push({
    question: "How many companies to extract?",
    options: ["First 50", "First 100", "First 200", "All available"],
  });
  return questions;
}

async function verifyProspectingTable(): Promise<void> {
  try {
    await db.select().from(prospectingResultsTable).limit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('does not exist') || msg.includes('relation')) {
      throw new Error('The prospecting_results table does not exist. Run `pnpm --filter @workspace/db push` to create it.');
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

  await db.update(prospectingJobsTable).set({
    status: "extracting",
    settings: mergedSettings,
    progress: 0,
    totalCompaniesFound: 0,
    totalEnriched: 0,
    pagesScanned: 0,
    error: null,
    completedAt: null,
  } as any).where(eq(prospectingJobsTable.id, numId));

  const scanSummary = job.scanSummary as SiteScanSummary | null;
  extractAsync(numId, mergedSettings, scanSummary?.paginationType || 'unknown', scanSummary?.listingPages || []).catch(err => {
    console.error(`[Prospecting] Extraction failed: ${(err as Error).message}`);
  });

  const [updated] = await db.select().from(prospectingJobsTable).where(eq(prospectingJobsTable.id, numId)).limit(1);
  return updated;
}

async function crawlWithLoadMore(url: string, maxClicks: number = 10): Promise<string> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    let previousHeight = 0;
    let clickCount = 0;

    for (let i = 0; i < maxClicks; i++) {
      const loadMoreBtn = await page.$('button:has-text("Load More"), button:has-text("Show More"), a:has-text("Load More"), a:has-text("Show More"), [class*="load-more"], [class*="show-more"], button:has-text("More Results"), button:has-text("المزيد")');
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

function flattenScrapeResults(scrapeResults: MultiAgentScrapeResult): ScrapeResultItem[] {
  return [
    ...(scrapeResults.playwrightResults || []),
    ...(scrapeResults.crawl4aiResults || []),
    ...(scrapeResults.basicResults || []),
  ];
}

async function extractCompaniesFromContent(
  content: string,
  sourceUrl: string,
  settings: ProspectingSettings,
): Promise<ProspectingCompanyResult[]> {
  const filterEntries = Object.entries(settings.filters || {})
    .filter(([, v]) => v && String(v).toLowerCase() !== 'all' && String(v).toLowerCase() !== 'all available' && String(v).toLowerCase() !== 'all cities' && String(v).toLowerCase() !== 'all industries');
  const filterStr = filterEntries.map(([k, v]) => `${k}: ${v}`).join(', ');

  const cityFilter = filterEntries.find(([k]) => k.toLowerCase().includes('city') || k.toLowerCase().includes('region') || k.toLowerCase().includes('location'));
  const cityInstruction = cityFilter
    ? `Only extract companies in ${Array.isArray(cityFilter[1]) ? (cityFilter[1] as string[]).join(', ') : cityFilter[1]}. Skip all others.`
    : '';

  const outputLang = settings.extractionLanguage || 'english';
  const langInstruction = outputLang === 'arabic'
    ? `Output in Arabic (العربية). Keep phone numbers, emails, websites in original format.`
    : `Translate all output to English. Keep phone numbers, emails, websites in original format.`;

  const extractPrompt = `Extract ALL company/business listings from this webpage content.
The content may be in Arabic, English, or both languages.
You MUST read and understand Arabic text (العربية) to find all companies.

${langInstruction}
${cityInstruction}

URL: ${sourceUrl}
User preferences: ${filterStr || 'None'}

Content:
${content.substring(0, 12000)}

Return JSON:
{ "companies": [{
    "name":          "Company Name",
    "phone":         "phone number",
    "email":         "email address",
    "website":       "website URL",
    "address":       "full address",
    "city":          "city name",
    "industry":      "industry/sector",
    "description":   "brief description",
    "contactPerson": "contact person name if available"
}]}

CRITICAL RULES:
- Extract EVERY company/business listing visible in the content
- Read Arabic text carefully — do not skip Arabic-only entries
- Return ONLY valid JSON with REAL data found on the page
- Do NOT fabricate or guess — omit any field not explicitly found
- If a field is not available, omit it or set to null
- NEVER include the website name itself as a company result
- NEVER extract navigation items, header text, footer text, or website branding as a company`;

  // NEXUS extraction tier: DeepSeek → Groq → Qwen → Gemini → GPT-4o
  let extractRaw = '{}';
  try {
    const nexusResult = await nexusExtract(extractPrompt, "Extract company listings as JSON matching the schema exactly. Return all visible companies.", { maxTokens: 4000, temperature: 0 });
    extractRaw = typeof nexusResult === "string" ? nexusResult : JSON.stringify(nexusResult);
    console.log(`[Prospecting] NEXUS company extraction complete`);
  } catch {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: extractPrompt }],
      response_format: { type: "json_object" },
      max_tokens: 4000,
    });
    extractRaw = response.choices[0]?.message?.content || '{}';
  }

  const parsed = JSON.parse(extractRaw) as Record<string, unknown>;
  const rawItems: Record<string, unknown>[] = (
    (parsed.companies as Record<string, unknown>[]) ||
    (parsed.results as Record<string, unknown>[]) ||
    (parsed.items as Record<string, unknown>[]) ||
    []
  );

  const result: ProspectingCompanyResult[] = [];
  const cityFilterValues: string[] = [];
  if (cityFilter) {
    const raw = cityFilter[1];
    if (Array.isArray(raw)) {
      for (const v of raw) cityFilterValues.push(String(v).toLowerCase());
    } else {
      cityFilterValues.push(String(raw).toLowerCase());
    }
  }
  const hasCityFilter = cityFilterValues.length > 0 && !cityFilterValues.some(c => c === 'all' || c === 'all cities');

  for (const item of rawItems) {
    const name = String(item.name || '').trim();
    if (!name || name.length < 2) continue;

    if (hasCityFilter && item.city) {
      const companyCity = String(item.city).toLowerCase();
      const matched = cityFilterValues.some(cf => companyCity.includes(cf) || cf.includes(companyCity));
      if (!matched) continue;
    }

    const isDupe = result.some(e => e.name.toLowerCase() === name.toLowerCase());
    if (isDupe) continue;

    const extras: Record<string, string> = {};
    const CORE_KEYS = new Set(['name', 'phone', 'email', 'website', 'address', 'city', 'industry', 'description', 'contactPerson', 'contact_person', 'contactperson']);
    for (const [k, v] of Object.entries(item)) {
      if (!v || CORE_KEYS.has(k)) continue;
      extras[k] = String(v);
    }

    result.push({
      name,
      phone: item.phone ? String(item.phone) : undefined,
      email: item.email ? String(item.email) : undefined,
      website: item.website ? String(item.website) : undefined,
      address: item.address ? String(item.address) : undefined,
      city: item.city ? String(item.city) : undefined,
      industry: item.industry ? String(item.industry) : undefined,
      description: item.description ? String(item.description) : undefined,
      contactPerson: item.contactPerson ? String(item.contactPerson) : (item.contact_person ? String(item.contact_person) : undefined),
      extras: Object.keys(extras).length > 0 ? extras : undefined,
      enrichmentStatus: 'pending',
    });
  }
  return result;
}

async function extractAsync(jobId: number, settings: ProspectingSettings, paginationType: string = 'unknown', seedListingPages: string[] = []) {
  console.log(`[Prospecting] Phase 2 EXTRACT started for job ${jobId}: ${settings.targetUrl} (pagination: ${paginationType})`);

  try {
    const maxPages = Math.min(settings.maxPages || 50, 100);

    if (paginationType === 'load_more' || paginationType === 'infinite_scroll') {
      const loadMoreUrl = seedListingPages.length > 0 ? seedListingPages[0] : settings.targetUrl;
      console.log(`[Prospecting] Strategy A: Playwright scroll/click for ${loadMoreUrl}`);
      const loadMoreContent = await crawlWithLoadMore(loadMoreUrl, maxPages);
      if (loadMoreContent.length > 200) {
        const allCompanies = await extractCompaniesFromContent(loadMoreContent, loadMoreUrl, settings);
        if (allCompanies.length > 0) {
          await saveAndFinishExtraction(jobId, settings, allCompanies, 1);
          return;
        }
      }
      console.log(`[Prospecting] Strategy A yielded insufficient content, falling through to URL crawl`);
    }

    console.log(`[Prospecting] Strategy B: URL discovery + batch crawl`);
    let discoveredUrls: string[] = [];

    if (seedListingPages.length > 0) {
      console.log(`[Prospecting] Using ${seedListingPages.length} seed listing pages from scan`);
      discoveredUrls = [...seedListingPages];
      for (const seedUrl of seedListingPages.slice(0, 3)) {
        for (let p = 2; p <= Math.min(Math.ceil(maxPages / seedListingPages.length), 30); p++) {
          try {
            const u = new URL(seedUrl);
            u.searchParams.set('page', String(p));
            if (!discoveredUrls.includes(u.href)) discoveredUrls.push(u.href);
          } catch { }
        }
      }
      console.log(`[Prospecting] Built ${discoveredUrls.length} paginated URLs from seeds`);
    } else {
      try {
        console.log(`[Prospecting] No seed pages — running crawlFullWebsite`);
        const crawlResult = await crawlFullWebsite(settings.targetUrl, Math.min(maxPages, 30));
        discoveredUrls = crawlResult.urls || [];
        console.log(`[Prospecting] crawlFullWebsite discovered ${discoveredUrls.length} URLs`);
      } catch (crawlErr: unknown) {
        console.log(`[Prospecting] crawlFullWebsite error: ${(crawlErr as Error).message?.substring(0, 60)}`);
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
            } catch { }
          });

          for (let p = 2; p <= Math.min(10, maxPages); p++) {
            const pageUrl = new URL(settings.targetUrl);
            if (!discoveredUrls.some(u => u.includes(`page=${p}`) || u.includes(`p=${p}`))) {
              pageUrl.searchParams.set('page', String(p));
              discoveredUrls.push(pageUrl.href);
            }
          }
        } catch { }
      }
    }

    const baseHost = new URL(settings.targetUrl).hostname;
    discoveredUrls = filterRelevantUrls(discoveredUrls, baseHost);
    const pagesToProcess = discoveredUrls.slice(0, maxPages);
    console.log(`[Prospecting] Will process ${pagesToProcess.length} pages`);

    const allCompanies: ProspectingCompanyResult[] = [];
    const existingNames = new Set<string>();
    const BATCH_SIZE = 5;

    for (let batchStart = 0; batchStart < pagesToProcess.length; batchStart += BATCH_SIZE) {
      const batchUrls = pagesToProcess.slice(batchStart, batchStart + BATCH_SIZE);
      console.log(`[Prospecting] Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: ${batchUrls.length} URLs`);

      let scrapeResults: MultiAgentScrapeResult;
      try {
        scrapeResults = await multiAgentScrape(batchUrls);
      } catch {
        console.log(`[Prospecting] multiAgentScrape failed for batch, trying individual fetch`);
        scrapeResults = { playwrightResults: [], crawl4aiResults: [], basicResults: [] };
        for (const url of batchUrls) {
          try {
            const { text } = await fastFetchPage(url, 12000);
            if (text.length > 50) {
              (scrapeResults.basicResults as ScrapeResultItem[]).push({ url, content: text, success: true });
            }
          } catch { }
        }
      }

      for (const url of batchUrls) {
        const flat = flattenScrapeResults(scrapeResults);
        const urlResults = flat.filter(r => r.url === url && r.success && r.content);
        let bestContent = '';
        for (const r of urlResults) {
          if (r.content && r.content.length > bestContent.length) {
            bestContent = r.content;
          }
        }

        if (!bestContent || bestContent.length < 50) {
          try {
            const { text } = await fastFetchPage(url, 12000);
            if (text.length > bestContent.length) bestContent = text;
          } catch { }
        }

        if (bestContent.length < 50) {
          console.log(`[Prospecting] Thin content for ${url} (${bestContent.length} chars), skipping`);
          continue;
        }

        try {
          const pageCompanies = await extractCompaniesFromContent(bestContent, url, settings);
          for (const company of pageCompanies) {
            const nameLower = company.name.toLowerCase().trim();
            if (!existingNames.has(nameLower)) {
              existingNames.add(nameLower);
              allCompanies.push(company);
            }
          }
          console.log(`[Prospecting] Extracted ${pageCompanies.length} companies from ${url} (total: ${allCompanies.length})`);
        } catch (e: unknown) {
          console.log(`[Prospecting] GPT extraction failed for ${url}: ${(e as Error).message?.substring(0, 80)}`);
        }
      }

      await db.update(prospectingJobsTable).set({
        pagesScanned: Math.min(batchStart + BATCH_SIZE, pagesToProcess.length),
        totalCompaniesFound: allCompanies.length,
        progress: Math.round(((batchStart + BATCH_SIZE) / pagesToProcess.length) * 50),
      } as any).where(eq(prospectingJobsTable.id, jobId));
    }

    if (allCompanies.length === 0) {
      console.log(`[Prospecting] 0 companies from crawl — trying Perplexity site:domain fallback`);
      try {
        const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
        const domain = new URL(settings.targetUrl).hostname;
        if (perplexityApiKey) {
          const queries = [
            `site:${domain} companies businesses members list`,
            `companies listed on ${domain} Saudi Arabia business directory`,
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
            } catch { }
          }

          const combinedText = texts.join('\n\n');
          if (combinedText.length > 100) {
            const perplexityCompanies = await extractCompaniesFromContent(combinedText, settings.targetUrl, settings);
            for (const c of perplexityCompanies) {
              const nameLower = c.name.toLowerCase().trim();
              if (!existingNames.has(nameLower)) {
                existingNames.add(nameLower);
                allCompanies.push(c);
              }
            }
            console.log(`[Prospecting] Perplexity fallback: ${allCompanies.length} companies`);
          }
        }
      } catch (fbErr: unknown) {
        console.log(`[Prospecting] Perplexity fallback error: ${(fbErr as Error).message?.substring(0, 80)}`);
      }
    }

    await saveAndFinishExtraction(jobId, settings, allCompanies, pagesToProcess.length);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(prospectingJobsTable).set({
      status: "failed",
      error: message.substring(0, 500),
    } as any).where(eq(prospectingJobsTable.id, jobId));
  }
}

async function saveAndFinishExtraction(
  jobId: number,
  settings: ProspectingSettings,
  allCompanies: ProspectingCompanyResult[],
  pagesScanned: number,
): Promise<void> {
  for (const company of allCompanies) {
    await db.insert(prospectingResultsTable).values({
      jobId,
      companyData: company,
      enrichmentStatus: 'pending',
      sourceUrl: settings.targetUrl,
    } as any);
  }

  if ((settings.enrichmentDepth === 'standard' || settings.enrichmentDepth === 'deep') && allCompanies.length > 0) {
    await db.update(prospectingJobsTable).set({
      status: "enriching",
      totalCompaniesFound: allCompanies.length,
      pagesScanned,
    } as any).where(eq(prospectingJobsTable.id, jobId));
    enrichResultsAsync(jobId, settings.enrichmentDepth, settings.extractionLanguage, normalizeFocusFields(settings.extractionFields || [])).catch(err => {
      console.log(`[Prospecting] Enrichment phase error: ${(err as Error).message?.substring(0, 80)}`);
    });
  } else {
    await db.update(prospectingJobsTable).set({
      status: "completed",
      totalCompaniesFound: allCompanies.length,
      pagesScanned,
      completedAt: new Date(),
    } as any).where(eq(prospectingJobsTable.id, jobId));
  }

  console.log(`[Prospecting] Extraction complete: ${allCompanies.length} companies from ${pagesScanned} pages`);
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

const FOCUS_FIELD_LABEL_TO_KEY: Record<string, string> = {
  'Company Name': 'companyName', 'Phone': 'landline', 'Email': 'email',
  'Website': 'website', 'Address': 'address', 'City': 'location',
  'Industry': 'industry', 'Category': 'entityType', 'CR Number': 'crNumber',
  'Employees': 'employees', 'Revenue': 'revenue', 'Founded Year': 'founded',
  'Owner/CEO': 'ownerName', 'Description': 'description',
  'Registration Number': 'crNumber', 'Services': 'services',
};

function normalizeFocusFields(fields: string[]): string[] {
  return fields.map(f => FOCUS_FIELD_LABEL_TO_KEY[f] || f).filter((v, i, a) => a.indexOf(v) === i);
}

async function fastEnrichSingle(company: ProspectingCompanyResult, language?: string, focusFields?: string[]): Promise<FastEnrichmentResult | null> {
  const focusSearchTerms = focusFields && focusFields.length > 0
    ? focusFields.filter(f => FOCUS_FIELD_SEARCH_TERMS[f]).map(f => FOCUS_FIELD_SEARCH_TERMS[f]).join(' ')
    : '';
  const searchQuery = `"${company.name}" Saudi Arabia ${company.city || ''} ${company.industry || ''} ${focusSearchTerms}`.trim();

  const needsOwnerSearch = focusFields && (
    focusFields.includes('ownerName') || focusFields.includes('shareholders') || focusFields.includes('estimatedWealth')
  );
  const ownerSearchQuery = needsOwnerSearch
    ? `"${company.name}" Saudi Arabia owner founder shareholders ownership مالك مؤسس مساهمون`
    : null;

  let scrapedContacts: { phones: string[]; emails: string[]; landlines: string[] } = { phones: [], emails: [], landlines: [] };

  const needsContactScrape = !focusFields || focusFields.length === 0 ||
    focusFields.includes('landline') || focusFields.includes('email') || focusFields.includes('address');

  const webDataPromise = (company.website && !isPrivateUrl(company.website))
    ? fastFetchPage(company.website, 6000).then(r => {
        if (r.text.length > 200) scrapedContacts = extractContactsFromHtml(r.text);
        return r.text.substring(0, 3000);
      }).catch(() => "")
    : Promise.resolve("");

  const contactPagePromise = (needsContactScrape && company.website && !isPrivateUrl(company.website))
    ? (async () => {
        try {
          const base = company.website!.replace(/\/$/, '');
          const pages = [`${base}/contact`, `${base}/about`, `${base}/contact-us`, `${base}/about-us`];
          const allText: string[] = [];
          for (const page of pages) {
            try {
              const r = await fastFetchPage(page, 5000);
              if (r.text.length > 100) {
                const extra = extractContactsFromHtml(r.text);
                if (extra.landlines.length > 0) scrapedContacts.landlines.push(...extra.landlines);
                if (extra.emails.length > 0) scrapedContacts.emails.push(...extra.emails);
                if (extra.phones.length > 0) scrapedContacts.phones.push(...extra.phones);
                allText.push(r.text.substring(0, 800));
              }
            } catch { continue; }
          }
          return allText.join('\n');
        } catch { }
        return "";
      })()
    : Promise.resolve("");

  const playwrightDeepPromise = (company.website && !isPrivateUrl(company.website))
    ? (async () => {
        try {
          const html = await getPageContent(company.website!, { waitMs: 5000 });
          if (html.length > 500) {
            const $ = parseHtml(html);
            $('script,style,noscript,iframe,svg').remove();
            const text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 4000);
            const extraContacts = extractContactsFromHtml(html);
            if (extraContacts.landlines.length > 0) scrapedContacts.landlines.push(...extraContacts.landlines);
            if (extraContacts.emails.length > 0) scrapedContacts.emails.push(...extraContacts.emails);
            if (extraContacts.phones.length > 0) scrapedContacts.phones.push(...extraContacts.phones);
            return text;
          }
          return "";
        } catch { return ""; }
      })()
    : Promise.resolve("");

  const crawl4aiPromise = (company.website && !isPrivateUrl(company.website))
    ? (async () => {
        try {
          const { crawl4aiBatch } = await import("../crawl4ai-engine");
          const results = await crawl4aiBatch([company.website!], { waitMs: 6000, concurrency: 1 });
          const r = results.find(x => x && x.success && x.markdown.length > 100);
          if (r) {
            if (r.emails?.length) scrapedContacts.emails.push(...r.emails);
            if (r.phones?.length) scrapedContacts.phones.push(...r.phones);
            return r.markdown.substring(0, 4000);
          }
          return "";
        } catch { return ""; }
      })()
    : Promise.resolve("");

  const perplexityPromise = (async () => {
    try {
      const perplexity = new (await import("../perplexity-service")).PerplexityService();
      const searchResult = await perplexity.researchQuery(searchQuery);
      const text = typeof searchResult === 'string' ? searchResult : searchResult?.answer || JSON.stringify(searchResult);
      return text.substring(0, 3000);
    } catch { return ""; }
  })();

  const perplexityDetailPromise = (async () => {
    try {
      const perplexity = new (await import("../perplexity-service")).PerplexityService();
      const detailQuery = `${company.name} السعودية CR number commercial registration رقم سجل تجاري رأس المال المدفوع employees revenue ${company.city || ''}`;
      const searchResult = await perplexity.researchQuery(detailQuery);
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
      const firstWord = company.name.split(' ')[0];
      if (!firstWord || firstWord.length < 2) return "";
      const matches = await db.select().from(companiesTable)
        .where(ilike(companiesTable.nameEn, `%${firstWord}%`))
        .limit(1);
      if (matches.length > 0) {
        const m = matches[0];
        return `DB match: ${m.nameEn || m.nameAr}, Industry: ${m.industry || 'N/A'}, Employees: ${m.employeeCount || 'N/A'}, Revenue: ${m.revenue || 'N/A'}, Founded: ${m.foundingYear || 'N/A'}, Owner: ${m.ownerName || 'N/A'}, City: ${m.city || 'N/A'}`;
      }
      return "";
    } catch { return ""; }
  })();

  const saudiSourcesPromise = (async () => {
    try {
      const timeoutPromise = new Promise<string>((resolve) => setTimeout(() => resolve(""), 20000));
      const fetchPromise = (async () => {
        const { fetchSaudiSources } = await import("../orcengine/saudi-data-sources");
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

  // Scout site intel — runs in parallel with all existing scrapers, fills contact gaps
  const scoutSitePromise = (company.website && !isPrivateUrl(company.website))
    ? scoutSiteIntel(company.website, { followSubpages: true }).catch(() => null)
    : Promise.resolve(null);

  const [webData, perplexityData, perplexityDetailData, dbMatch, saudiGovData, exploriumData, ownerData, contactPageData, playwrightData, crawl4aiData, scoutSiteData] = await Promise.all([
    webDataPromise, perplexityPromise, perplexityDetailPromise, dbPromise, saudiSourcesPromise, exploriumPromise, ownerPerplexityPromise, contactPagePromise, playwrightDeepPromise, crawl4aiPromise, scoutSitePromise
  ]);

  // Merge Scout contacts into scrapedContacts (fills gaps left by JS-blocked scrapers)
  if (scoutSiteData) {
    if (scoutSiteData.emails?.length) {
      for (const e of scoutSiteData.emails) {
        if (!scrapedContacts.emails.includes(e)) scrapedContacts.emails.push(e);
      }
    }
    if (scoutSiteData.phones?.length) {
      for (const p of scoutSiteData.phones) {
        const isMobile = /^(05\d|009665\d|\+9665\d)/.test(p);
        if (isMobile && !scrapedContacts.phones.includes(p)) scrapedContacts.phones.push(p);
        else if (!isMobile && !scrapedContacts.landlines.includes(p)) scrapedContacts.landlines.push(p);
      }
    }
    console.log(`[Prospecting] Scout site intel for ${company.name}: ${(scoutSiteData.emails?.length || 0)} emails, ${(scoutSiteData.phones?.length || 0)} phones`);
  }

  scrapedContacts.landlines = [...new Set(scrapedContacts.landlines)].slice(0, 5);
  scrapedContacts.emails    = [...new Set(scrapedContacts.emails)].slice(0, 5);
  scrapedContacts.phones    = [...new Set(scrapedContacts.phones)].slice(0, 5);

  const langInstruction = language === 'arabic'
    ? `OUTPUT LANGUAGE: Write ALL text fields in Arabic (العربية). Keep numbers, URLs, emails, and phone numbers in their original format.`
    : `OUTPUT LANGUAGE: Write ALL text fields in English. If source data is in Arabic, translate to English.`;

  const FOCUS_FIELD_LABELS: Record<string, string> = {
    ownerName: 'Owner / Founder full name', shareholders: 'Shareholders with names and %',
    estimatedWealth: "Owner's estimated net worth (only if publicly documented)",
    landline: 'Saudi landline phone number', email: 'Company email address',
    crNumber: 'Saudi commercial registration (CR) number', capital: 'Paid-up capital amount',
    revenue: 'Annual revenue or turnover', employees: 'Employee count or range',
    founded: 'Year founded / established', entityType: 'Legal entity type (LLC / JSC)',
    keyPeople: 'Key executives and their titles', services: 'Services and products offered',
    address: 'Full physical address', location: 'City and district',
    marketPositioning: 'Market position, key clients', contactPerson: 'Contact person name and title',
  };
  const focusInstruction = focusFields && focusFields.length > 0
    ? `\n=== MANDATORY OUTPUT FIELDS ===\nThe user SPECIFICALLY requested these fields. Populate each one from every source. Do NOT return "Unknown" unless absolutely no data exists:\n${focusFields.map(f => `• ${FOCUS_FIELD_LABELS[f] || f}`).join('\n')}\n`
    : '';

  const scrapedLandlines = scrapedContacts.landlines;
  const scrapedEmails = scrapedContacts.emails;
  const verifiedContactSection = (scrapedLandlines.length > 0 || scrapedContacts.phones.length > 0 || scrapedEmails.length > 0)
    ? `=== VERIFIED CONTACTS (scraped from company website — authoritative) ===\n${scrapedLandlines.length > 0 ? `Landlines: ${scrapedLandlines.join(', ')}\n` : ''}${scrapedContacts.phones.length > 0 ? `Mobile phones: ${scrapedContacts.phones.join(', ')}\n` : ''}${scrapedEmails.length > 0 ? `Emails: ${scrapedEmails.join(', ')}\n` : ''}`
    : '';

  const enrichPrompt = `You are a Saudi business intelligence analyst. Extract REAL, VERIFIED data about this company from the sources below.

${langInstruction}
${focusInstruction}
Company: ${company.name}
City: ${company.city || 'Unknown'}
Industry: ${company.industry || 'Unknown'}
Phone (from directory): ${company.phone || 'N/A'}
Website: ${company.website || 'N/A'}

${verifiedContactSection}
${webData ? `=== Company Website Content (direct fetch) ===\n${webData}\n` : ''}
${playwrightData ? `=== Company Website Content (Playwright JS-rendered) ===\n${playwrightData}\n` : ''}
${crawl4aiData ? `=== Company Website Content (Crawl4AI markdown) ===\n${crawl4aiData}\n` : ''}
${contactPageData ? `=== Company Contact/About Pages ===\n${contactPageData}\n` : ''}
${perplexityData ? `=== Web Research (focus-targeted) ===\n${perplexityData}\n` : ''}
${perplexityDetailData ? `=== Web Research (CR/financial detail) ===\n${perplexityDetailData}\n` : ''}
${ownerData ? `=== Ownership Research ===\n${ownerData}\n` : ''}
${dbMatch ? `=== Internal Database Match ===\n${dbMatch}\n` : ''}
${saudiGovData ? `=== Saudi Government Sources ===\n${saudiGovData}\n` : ''}
${exploriumData ? `=== Explorium Firmographic Data ===\n${exploriumData}\n` : ''}

Return JSON with these 22 fields:
{
  "profileSummary": "4-5 sentence company brief",
  "industry": "specific sector",
  "employees": "count or range",
  "revenue": "SAR 50M or USD 15M",
  "founded": "2005",
  "services": ["service 1", "service 2"],
  "keyPeople": ["Full Name - CEO", "Full Name - CFO"],
  "ownerName": "real person name only — not estimated",
  "ownerDetails": "owner background, education, other ventures",
  "estimatedWealth": "SAR 500M — only if Forbes Arabia or similar public source",
  "shareholders": [{"name": "", "percentage": "25%", "estimatedWealth": "SAR 200M"}],
  "location": "full address with city and district",
  "landline": "${scrapedLandlines.length > 0 ? scrapedLandlines[0] : '+966-1x-xxx-xxxx'}",
  "email": "${scrapedEmails.length > 0 ? scrapedEmails[0] : 'company@domain.com'}",
  "website": "https://...",
  "socialMedia": {"linkedin": "", "twitter": "", "instagram": ""},
  "crNumber": "1234567890",
  "capital": "SAR 1,000,000",
  "entityType": "LLC / JSC / SJSC / Sole Proprietorship",
  "registrationDate": "15/03/2005",
  "marketPositioning": "key clients, competitors, industry standing",
  "contactPerson": "Name - Title"
}

STRICT RULES:
- Only include data verifiable from the provided sources — use "Unknown" otherwise
- Never fabricate phone numbers, emails, CR numbers, or owner names
- Verified scraped contacts override any inference — use them as-is
- estimatedWealth only if publicly documented (Forbes Arabia, etc.)
- profileSummary must be 4-5 sentences
- Cross-reference all sources: if one source has a phone and another has a CR number, combine them`;

  let result: (FastEnrichmentResult & { email?: string; ownerDetails?: string; estimatedWealth?: string; contactPerson?: string }) | null = null;

  // NEXUS synthesis tier: Gemini → Claude → GPT-4o → DeepSeek (4-provider chain)
  try {
    const nexusResult = await nexusSynthesize(enrichPrompt, "You are a Saudi Arabia business intelligence expert. Return ONLY valid JSON matching the schema. Never fabricate contacts.", { maxTokens: 3000, temperature: 0 });
    result = JSON.parse(nexusResult.text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim() || 'null');
    console.log(`[Prospecting] NEXUS enrichment via ${nexusResult.provider}/${nexusResult.model} for ${company.name}`);
  } catch {
    // Fallback: direct GPT-4o
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: enrichPrompt }],
        response_format: { type: "json_object" },
        max_tokens: 3000,
      });
      result = JSON.parse(response.choices[0]?.message?.content || 'null');
    } catch (gptErr: unknown) {
      console.log(`[Prospecting] GPT-4o enrichment also failed for ${company.name}: ${(gptErr as Error).message?.substring(0, 120)}`);
    }
  }

  const hasUnknowns = result && (
    !isKnown(result.ownerName) || !isKnown(result.crNumber) || !isKnown(result.revenue) ||
    !isKnown(result.employees) || !isKnown(result.landline) || !isKnown((result as any).email)
  );

  if (!result || hasUnknowns) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (anthropicKey) {
        const anthropic = new Anthropic({ apiKey: anthropicKey });
        const missingFields = !result ? 'ALL fields' : [
          !isKnown(result.ownerName) && 'ownerName',
          !isKnown(result.crNumber) && 'crNumber',
          !isKnown(result.revenue) && 'revenue',
          !isKnown(result.employees) && 'employees',
          !isKnown(result.landline) && 'landline',
          !isKnown((result as any).email) && 'email',
          !isKnown(result.capital) && 'capital',
          !isKnown(result.founded) && 'founded',
          !isKnown(result.marketPositioning) && 'marketPositioning',
        ].filter(Boolean).join(', ');

        const claudePrompt = `You are a Saudi Arabia business intelligence expert. I need REAL data about this company.

Company: ${company.name}
City: ${company.city || 'Unknown'}, Industry: ${company.industry || 'Unknown'}
Website: ${company.website || 'N/A'}

I specifically need these missing fields: ${missingFields}

${perplexityData ? `Web Research:\n${perplexityData}\n` : ''}
${perplexityDetailData ? `Financial Research:\n${perplexityDetailData}\n` : ''}
${webData ? `Website Content:\n${webData.substring(0, 2000)}\n` : ''}
${playwrightData ? `Playwright Content:\n${playwrightData.substring(0, 2000)}\n` : ''}
${saudiGovData ? `Saudi Gov Sources:\n${saudiGovData.substring(0, 2000)}\n` : ''}

Return ONLY a JSON object with these fields (only include fields you have REAL data for):
{ "ownerName": "", "crNumber": "", "revenue": "", "employees": "", "landline": "", "email": "", "capital": "", "founded": "", "services": [], "keyPeople": [], "shareholders": [{"name":"","percentage":""}], "marketPositioning": "", "profileSummary": "", "industry": "", "location": "", "entityType": "", "registrationDate": "", "contactPerson": "" }

NEVER invent data. Use "Unknown" for fields you cannot verify.`;

        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2500,
          messages: [{ role: "user", content: claudePrompt }],
        });
        const claudeText = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
        const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const claudeResult = JSON.parse(jsonMatch[0]);
          if (!result) {
            result = claudeResult;
          } else {
            for (const [key, val] of Object.entries(claudeResult)) {
              if (isKnown(val as string) && !isKnown((result as any)[key])) {
                (result as any)[key] = val;
              }
            }
          }
          console.log(`[Prospecting] Claude backup filled missing fields for ${company.name}`);
        }
      }
    } catch (claudeErr: unknown) {
      console.log(`[Prospecting] Claude backup failed for ${company.name}: ${(claudeErr as Error).message?.substring(0, 100)}`);
    }
  }

  if (!result) return null;

  if (scrapedLandlines.length > 0 && (!result.landline || result.landline === 'Unknown')) {
    result.landline = scrapedLandlines[0];
  }
  if (scrapedEmails.length > 0 && (!result.email || result.email === 'Unknown')) {
    result.email = scrapedEmails[0];
  }

  return result as FastEnrichmentResult;
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
  if (isKnown((enrichData as any).ownerDetails)) extras.ownerDetails = (enrichData as any).ownerDetails;
  if (isKnown((enrichData as any).estimatedWealth)) extras.estimatedWealth = (enrichData as any).estimatedWealth;
  if (isKnown(enrichData.landline)) extras.landline = enrichData.landline;
  if (isKnown(enrichData.marketPositioning)) extras.marketPositioning = enrichData.marketPositioning;
  if (isKnown((enrichData as any).contactPerson)) extras.contactPerson = (enrichData as any).contactPerson;
  if (enrichData.shareholders && enrichData.shareholders.length > 0) {
    const shText = enrichData.shareholders
      .filter(s => s.name && s.name !== 'Unknown')
      .map(s => `${s.name}${s.percentage && s.percentage !== 'Unknown' ? ` (${s.percentage})` : ''}${s.estimatedWealth && s.estimatedWealth !== 'Unknown' ? ` [~${s.estimatedWealth}]` : ''}`)
      .join('; ');
    if (shText) extras.shareholders = shText;
  }
  if (isKnown(enrichData.location)) extras.location = enrichData.location;

  return {
    ...company,
    industry: isKnown(enrichData.industry) ? enrichData.industry : company.industry,
    description: isKnown(enrichData.profileSummary) ? enrichData.profileSummary : company.description,
    website: isKnown(enrichData.website) ? enrichData.website : company.website,
    phone: company.phone || (isKnown(enrichData.landline) ? enrichData.landline : undefined),
    email: isKnown((enrichData as any).email) ? (enrichData as any).email : company.email,
    address: company.address || (isKnown(enrichData.location) ? enrichData.location : undefined),
    extras,
  };
}

async function enrichResultsAsync(jobId: number, depth: string, language?: string, focusFields?: string[]) {
  const startTime = Date.now();
  console.log(`[Prospecting] Phase 3 ENRICH started for job ${jobId} (depth: ${depth})`);
  const dbResults = await db.select().from(prospectingResultsTable)
    .where(eq(prospectingResultsTable.jobId, jobId));

  let enrichedCount = 0;
  const maxEnrich = depth === 'basic' ? 10 : dbResults.length;
  const toEnrich = dbResults.slice(0, Math.min(dbResults.length, maxEnrich));
  console.log(`[Prospecting] Enriching ${toEnrich.length} of ${dbResults.length} companies`);

  const CONCURRENCY = 5;
  for (let i = 0; i < toEnrich.length; i += CONCURRENCY) {
    const batch = toEnrich.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (result) => {
      const company = result.companyData as ProspectingCompanyResult;
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
              } as any).returning();
              reportId = String(report.id);
            } catch { }

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
          console.log(`[Prospecting] Enriched ${enrichedCount}/${toEnrich.length}: ${company.name}`);
        })()]);
      } catch (e: unknown) {
        await db.update(prospectingResultsTable).set({ enrichmentStatus: 'failed' })
          .where(eq(prospectingResultsTable.id, result.id));
        enrichedCount++;
        console.log(`[Prospecting] Enrichment failed for ${company.name}: ${(e as Error).message?.substring(0, 80)}`);
      }
    }));
  }

  await db.update(prospectingJobsTable).set({
    status: "completed",
    totalEnriched: enrichedCount,
    progress: 100,
    completedAt: new Date(),
  } as any).where(eq(prospectingJobsTable.id, jobId));
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
  return db.select().from(prospectingResultsTable).where(eq(prospectingResultsTable.jobId, numId));
}

export async function listProspectingJobs(): Promise<ProspectingJob[]> {
  return db.select().from(prospectingJobsTable).orderBy(desc(prospectingJobsTable.createdAt)).limit(50);
}

export async function deleteProspectingJob(jobId: string): Promise<void> {
  const numId = parseInt(jobId, 10);
  if (isNaN(numId)) return;
  await db.delete(prospectingResultsTable).where(eq(prospectingResultsTable.jobId, numId));
  await db.delete(prospectingJobsTable).where(eq(prospectingJobsTable.id, numId));
}

export async function exportProspectingResults(jobId: string, format: string): Promise<{ content: string; filename: string; mimeType: string }> {
  const results = await getProspectingResults(jobId);
  if (!results || results.length === 0) throw new Error("No results to export");

  const companies: ProspectingCompanyExport[] = results.map(r => {
    const cd = r.companyData as ProspectingCompanyResult;
    const extras = cd.extras || {};
    return {
      name: cd.name || '',
      phone: cd.phone || extras.landline || '',
      email: cd.email || '',
      website: cd.website || '',
      address: cd.address || extras.location || '',
      city: cd.city || '',
      industry: cd.industry || '',
      description: cd.description || '',
      contactPerson: cd.contactPerson || extras.contactPerson || '',
      crNumber: cd.crNumber || extras.crNumber || '',
      employees: String(cd.employees || extras.employees || ''),
      revenue: cd.revenue || extras.revenue || '',
      founded: String(cd.foundedYear || extras.founded || ''),
      ownerName: extras.ownerName || '',
      capital: extras.capital || '',
      entityType: extras.entityType || '',
      services: extras.services || '',
      keyPeople: extras.keyPeople || '',
      shareholders: extras.shareholders || '',
      marketPositioning: extras.marketPositioning || '',
      landline: extras.landline || '',
      location: extras.location || '',
    };
  });

  const [job] = await db.select().from(prospectingJobsTable).where(eq(prospectingJobsTable.id, parseInt(jobId, 10))).limit(1);

  const input = {
    targetUrl: job?.targetUrl || results[0]?.sourceUrl || '',
    totalCompanies: companies.length,
    totalEnriched: results.filter(r => r.enrichmentStatus === 'completed').length,
    pagesScanned: job?.pagesScanned || 0,
    companies,
    enrichmentData: [] as ProspectingEnrichmentData[],
  };

  let exportResult: { content: string; filename: string; mimeType: string };
  switch (format) {
    case 'csv': exportResult = exportProspectingToCSV(input); break;
    case 'json': exportResult = exportProspectingToJSON(input); break;
    case 'excel':
    case 'xlsx': exportResult = exportProspectingToExcel(input); break;
    case 'pdf': exportResult = await exportProspectingToPDF(input); break;
    default: throw new Error(`Unsupported format: ${format}`);
  }

  try {
    await db.insert(prospectingExportsTable).values({
      jobId: parseInt(jobId, 10),
      format,
      filename: exportResult.filename,
      recordCount: companies.length,
      fileSize: exportResult.content.length,
      targetUrl: job?.targetUrl || null,
    } as any);
  } catch (e) {
    console.log(`[Prospecting] Failed to save export history: ${(e as Error).message?.substring(0, 80)}`);
  }

  return exportResult;
}

export async function listExportHistory(): Promise<ProspectingExport[]> {
  return db.select().from(prospectingExportsTable).orderBy(desc(prospectingExportsTable.createdAt)).limit(50);
}
