import type { ResearchSource } from "@workspace/db";
import { getPageContent } from "../browser-helper";

interface CrawlResult {
  url: string;
  title: string;
  content: string;
  success: boolean;
  error?: string;
  metadata?: {
    crawledAt: string;
    method: 'playwright' | 'fetch';
    wordCount?: number;
  };
}

const SAUDI_NEWS_SOURCES = [
  { domain: 'argaam.com', name: 'Argaam', category: 'financial' },
  { domain: 'saudiexchange.sa', name: 'Saudi Exchange', category: 'exchange' },
  { domain: 'arabnews.com', name: 'Arab News', category: 'news' },
  { domain: 'zawya.com', name: 'Zawya', category: 'financial' },
  { domain: 'reuters.com', name: 'Reuters Middle East', category: 'news' },
  { domain: 'bloomberg.com', name: 'Bloomberg Middle East', category: 'financial' },
  { domain: 'sama.gov.sa', name: 'SAMA', category: 'regulatory' },
  { domain: 'spa.gov.sa', name: 'Saudi Press Agency', category: 'government' },
  { domain: 'cnbcarabia.com', name: 'CNBC Arabia', category: 'financial' },
  { domain: 'alarabiya.net', name: 'Al Arabiya', category: 'news' },
  { domain: 'aleqt.com', name: 'Al Eqtisadiah', category: 'financial' },
  { domain: 'vision2030.gov.sa', name: 'Vision 2030', category: 'government' },
];

async function crawlWithPlaywright(urls: string[]): Promise<CrawlResult[]> {
  if (urls.length === 0) return [];

  console.log(`[Crawler] Starting Playwright crawler for ${urls.length} URLs`);
  const results: CrawlResult[] = [];

  // Process in batches of 3 to avoid overwhelming browser resources
  const batchSize = 3;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (url) => {
        try {
          const html = await getPageContent(url, { waitMs: 3500 });
          if (!html) throw new Error('Empty response');
          const title = extractTitle(html);
          const content = extractTextContent(html);
          return {
            url,
            title,
            content,
            success: true,
            metadata: {
              crawledAt: new Date().toISOString(),
              method: 'playwright' as const,
              wordCount: content.split(/\s+/).length,
            },
          };
        } catch (error) {
          // Fallback to simple fetch for this URL
          return crawlUrlWithFetch(url);
        }
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }
  }

  console.log(`[Crawler] Playwright crawl complete: ${results.filter(r => r.success).length}/${urls.length} succeeded`);
  return results;
}

async function fetchWithTimeout(url: string, timeout = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

function extractTextContent(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  
  return text.substring(0, 15000);
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();
  
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();
  
  const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
  if (ogTitleMatch) return ogTitleMatch[1].trim();
  
  return 'Untitled';
}

async function crawlUrlWithFetch(url: string): Promise<CrawlResult> {
  try {
    console.log(`[Crawler] Fetching: ${url}`);
    const response = await fetchWithTimeout(url);
    
    if (!response.ok) {
      return { url, title: '', content: '', success: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    const title = extractTitle(html);
    const content = extractTextContent(html);
    
    return { 
      url, 
      title, 
      content, 
      success: true,
      metadata: {
        crawledAt: new Date().toISOString(),
        method: 'fetch',
        wordCount: content.split(/\s+/).length,
      }
    };
  } catch (error) {
    return { 
      url, 
      title: '', 
      content: '', 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

export async function crawlUrl(url: string): Promise<CrawlResult> {
  // Try Playwright first for JS-heavy sites, fallback to fetch
  const playwrightResults = await crawlWithPlaywright([url]);
  if (playwrightResults.length > 0 && playwrightResults[0].success && playwrightResults[0].content.length > 100) {
    return playwrightResults[0];
  }
  return crawlUrlWithFetch(url);
}

export async function crawlUrls(urls: string[]): Promise<CrawlResult[]> {
  console.log(`[Crawler] Processing ${urls.length} URLs with Playwright`);
  return crawlWithPlaywright(urls);
}

function detectQueryType(query: string): 'ipo' | 'company' | 'executive' | 'general' {
  const lowerQuery = query.toLowerCase();
  if (lowerQuery.includes('ipo') || lowerQuery.includes('listing') || lowerQuery.includes('going public')) return 'ipo';
  if (lowerQuery.includes('executive') || lowerQuery.includes('ceo') || lowerQuery.includes('board') || lowerQuery.includes('leadership')) return 'executive';
  if (lowerQuery.includes('company') || lowerQuery.includes('companiesTable') || lowerQuery.includes('firm')) return 'company';
  return 'general';
}

function getStructuredPrompt(query: string, queryType: string, maxResults: number): string {
  if (queryType === 'ipo') {
    return `Search for specific upcoming or recent IPOs in Saudi Arabia (TASI/NOMU) related to: "${query}"

IMPORTANT: Return a list of SPECIFIC COMPANIES with their IPO details.

Search these sources: Argaam, ZAWYA, Tadawul, CMA Saudi Arabia, Reuters, Bloomberg

Return a JSON array with SPECIFIC companiesTable:
[{
  "title": "Company Name IPO",
  "content": "COMPANY: [Exact company name]. SECTOR: [Industry]. IPO DATE: [Expected/actual date]. VALUATION: [Expected valuation in SAR]. SHARES OFFERED: [Number and %]. PRICE RANGE: [SAR per share]. LEAD MANAGERS: [Banks]. SHAREHOLDERS: [Major shareholders and their stakes]. PURPOSE: [Use of proceeds]. STATUS: [Filed/Approved/Upcoming/Completed].",
  "url": "source URL",
  "source": "source name",
  "reliability": 0.9,
  "entityType": "ipo",
  "entityName": "Company Name"
}]

Include ${maxResults} specific companiesTable. Each entry MUST have a real company name and specific IPO details. Return ONLY the JSON array.`;
  }
  
  if (queryType === 'company') {
    return `Search for specific Saudi Arabian companiesTable related to: "${query}"

Return a list of SPECIFIC COMPANIES with details.

Search these sources: Argaam, ZAWYA, Tadawul, Bloomberg, Reuters

Return a JSON array:
[{
  "title": "Company Name - Overview",
  "content": "COMPANY: [Name]. TICKER: [Symbol]. SECTOR: [Industry]. REVENUE: [Latest figures in SAR]. MARKET CAP: [Value]. EMPLOYEES: [Count]. CEO: [Name]. HEADQUARTERS: [City]. KEY DEVELOPMENTS: [Recent news].",
  "url": "source URL",
  "source": "source name",
  "reliability": 0.9,
  "entityType": "company",
  "entityName": "Company Name"
}]

Include ${maxResults} specific companiesTable. Return ONLY the JSON array.`;
  }

  if (queryType === 'executive') {
    return `Search for specific Saudi Arabian executivesTable related to: "${query}"

Return a list of SPECIFIC EXECUTIVES with details.

Search these sources: LinkedIn, Argaam, Bloomberg, Company websites

Return a JSON array:
[{
  "title": "Executive Name - Position at Company",
  "content": "NAME: [Full name]. POSITION: [Title]. COMPANY: [Organization]. BACKGROUND: [Education and career history]. ACHIEVEMENTS: [Key accomplishments]. BOARD POSITIONS: [Other roles].",
  "url": "source URL",
  "source": "source name",
  "reliability": 0.9,
  "entityType": "executive",
  "entityName": "Executive Name"
}]

Include ${maxResults} specific executivesTable. Return ONLY the JSON array.`;
  }

  return `Search for information about: "${query}" in the Saudi Arabian business context.

Search these sources: Argaam, ZAWYA, Tadawul, Bloomberg, Reuters, Arab News

Return a JSON array:
[{
  "title": "Result title",
  "content": "Detailed information with specific facts, figures, and data.",
  "url": "source URL",
  "source": "source name",
  "reliability": 0.9,
  "entityType": "general",
  "entityName": ""
}]

Include ${maxResults} results. Return ONLY the JSON array.`;
}

export async function researchWithSources(query: string, maxResults: number = 10): Promise<ResearchSource[]> {
  const queryType = detectQueryType(query);
  const prompt = getStructuredPrompt(query, queryType, maxResults);
  
  try {
    const { perplexityService } = await import('../perplexity-service');
    const result = await perplexityService.researchQuery(prompt);
    
    const jsonMatch = result.answer.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const rawSources = JSON.parse(jsonMatch[0]);
      return rawSources.slice(0, maxResults).map((s: any, idx: number) => ({
        id: `source-${Date.now()}-${idx}`,
        url: s.url || '',
        domain: s.source || new URL(s.url || 'https://perplexity.ai').hostname,
        title: s.title || '',
        content: s.content || '',
        extractedAt: new Date().toISOString(),
        reliability: s.reliability || 0.8,
      }));
    }
    
    return [{
      url: result.citations?.[0] || '',
      title: `Research: ${query}`,
      snippet: (result.answer || '').slice(0, 200),
    }];
  } catch (error) {
    console.error("[Crawler] Research error:", error);
    return [];
  }
}

export async function searchWeb(query: string, maxResults: number = 10): Promise<ResearchSource[]> {
  console.log(`[Crawler] Searching web for: "${query}"`);
  return researchWithSources(query, maxResults);
}

export { SAUDI_NEWS_SOURCES };
