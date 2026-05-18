import { db } from "@workspace/db";
import { scrapeSessionsTable } from "@workspace/db";
import type {
  ScrapeSession,
} from "@workspace/db";

// Local type definitions (not stored in DB schema directly)
export interface KnowledgeChunk {
  id: string;
  content: string;
  source?: string;
  metadata?: {
    title?: string;
    crawledAt?: string;
    agent?: string;
    [key: string]: unknown;
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}
import { eq, sql, desc } from "drizzle-orm";
import { crawlUrls } from "./crawler";
import { getPageContent, parseHtml } from "../browser-helper";
import { crawl4aiBatch } from "../crawl4ai-engine";

import { openai } from "../openai-client";

// Apify stubs - replace with @apify/client if APIFY_API_KEY is configured
async function runActor(actorId: string, input: unknown, opts: unknown): Promise<{ datasetId?: string }> {
  throw new Error("Apify not configured");
}
async function getDatasetItems(datasetId: string): Promise<Record<string, unknown>[]> {
  return [];
}


export interface ScrapeResultItem {
  url: string;
  success: boolean;
  content?: string;
  text?: string;
  markdown?: string;
  title?: string;
  error?: string;
  links?: Array<{ text: string; href: string }>;
  emails?: string[];
  phones?: string[];
  headings?: string[];
  images?: string[];
  tables?: string[];
}

export interface MultiAgentScrapeResult {
  basicResults: ScrapeResultItem[];
  crawl4aiResults: ScrapeResultItem[];
  playwrightResults: ScrapeResultItem[];
}

export async function multiAgentScrape(urls: string[]): Promise<MultiAgentScrapeResult> {
  console.log(`[Scraper] Starting multi-agent scrape for ${urls.length} URLs`);

  // Run all scrapers in parallel
  const [basicResults, crawl4aiResults, playwrightResults] =
    await Promise.allSettled([
      // Basic crawler
      crawlUrls(urls),

      // Crawl4AI Engine - AI-ready markdown extraction with Playwright + Turndown
      (async () => {
        try {
          console.log(`[Crawl4AI] Starting AI-ready markdown extraction for ${urls.length} URLs`);
          const c4Results = await crawl4aiBatch(urls.slice(0, 8), { waitMs: 4000, concurrency: 3 });
          const items = c4Results
            .filter((r): r is NonNullable<typeof r> => r != null && r.success && r.markdown.length > 100)
            .map(r => ({
              url: r.url,
              success: true as const,
              title: r.title,
              text: r.extractedText,
              markdown: r.markdown,
              emails: r.emails,
              phones: r.phones,
              tables: r.tables,
              headings: r.headings,
            }));
          console.log(`[Crawl4AI] Extracted ${items.length} pages with AI-ready markdown`);
          return items;
        } catch (e: unknown) {
          console.log(`[Crawl4AI] Error: ${(e as Error).message}`);
          return [];
        }
      })(),

      (async () => {
        try {
          console.log(`[BrowserHelper] Rendering ${urls.length} pages`);
          const results: ScrapeResultItem[] = [];

          for (const url of urls.slice(0, 5)) {
            try {
              const html = await getPageContent(url, { waitMs: 3000 });
              const $ = parseHtml(html);
              const mainEl = $('main, article, .content, #content').first();
              const bodyText = (mainEl.length ? mainEl.text() : $('body').text()) || '';
              
              results.push({
                url,
                success: true,
                title: $('title').text() || '',
                text: bodyText.substring(0, 10000),
                links: $('a').slice(0, 20).map((_, a) => ({
                  text: $(a).text()?.trim() || '',
                  href: $(a).attr('href') || '',
                })).get(),
                emails: bodyText.match(/[\w.-]+@[\w.-]+\.\w+/g) || [],
                phones: bodyText.match(/\+?\d[\d\s-]{8,}/g) || [],
              });
            } catch {
              // Skip failed pages
            }
          }

          console.log(`[BrowserHelper] Extracted ${results.length} pages`);
          return results;
        } catch (e: unknown) {
          console.log(`[BrowserHelper] Error: ${(e as Error).message}`);
          return [];
        }
      })(),
    ]);

  return {
    basicResults: basicResults.status === "fulfilled" ? basicResults.value : [],
    crawl4aiResults:
      crawl4aiResults.status === "fulfilled" ? crawl4aiResults.value : [],
    playwrightResults:
      playwrightResults.status === "fulfilled" ? playwrightResults.value : [],
  };
}

async function runPlaywrightOnly(urls: string[]): Promise<ScrapeResultItem[]> {
  try {
    const maxUrls = Math.min(urls.length, 20);
    console.log(`[BrowserHelper] Rendering ${maxUrls} pages (direct)`);
    const results: ScrapeResultItem[] = [];

    for (const url of urls.slice(0, maxUrls)) {
      try {
        const html = await getPageContent(url, { waitMs: 5000 });
        if (!html) {
          results.push({ url, success: false, error: "Empty response" });
          continue;
        }
        const $ = parseHtml(html);
        const mainEl = $('main, article, .content, #content').first();
        const bodyText = (mainEl.length ? mainEl.text() : $('body').text()) || '';
        
        results.push({
          url,
          success: true,
          content: bodyText.substring(0, 20000),
          title: $('title').text() || '',
          text: bodyText.substring(0, 20000),
          links: $('a').slice(0, 30).map((_, a) => ({
            text: $(a).text()?.trim() || '',
            href: $(a).attr('href') || '',
          })).get(),
          emails: bodyText.match(/[\w.-]+@[\w.-]+\.\w+/g) || [],
          phones: bodyText.match(/\+?\d[\d\s-]{8,}/g) || [],
        });
      } catch {
        results.push({ url, success: false, error: "Failed to load page" });
      }
    }

    console.log(
      `[Playwright] Extracted ${results.filter((r) => r.success).length}/${results.length} pages`,
    );
    return results;
  } catch (e: unknown) {
    console.log(`[Playwright] Error: ${(e as Error).message}`);
    return [];
  }
}

async function runCrawl4AIOnly(urls: string[]): Promise<ScrapeResultItem[]> {
  if (!process.env.APIFY_API_KEY) {
    console.log(`[Crawl4AI] No APIFY_API_KEY configured`);
    return [];
  }
  try {
    console.log(`[Crawl4AI] Crawling ${urls.length} URLs (direct)`);
    const run = await runActor(
      "janbuchar/crawl4ai",
      {
        startUrls: urls.map((url) => ({ url })),
        maxCrawlPages: Math.min(urls.length * 5, 50),
        crawlerType: "playwright",
        extractionStrategy: "markdown",
        includeScreenshots: false,
        maxConcurrency: 5,
      },
      { waitForFinish: true, timeout: 120 },
    );

    if (!run.datasetId) return [];
    const items = await getDatasetItems(run.datasetId);
    console.log(`[Crawl4AI] Extracted ${items.length} pages`);
    return items.map((item: Record<string, unknown>) => ({
      url: String(item.url || ''),
      success: true,
      content: String(item.markdown || item.text || ''),
      title: String(item.title || ''),
    }));
  } catch (e: unknown) {
    console.log(`[Crawl4AI] Error: ${(e as Error).message}`);
    return [];
  }
}

async function runBasicCrawler(urls: string[]): Promise<ScrapeResultItem[]> {
  console.log(`[Scraper] Crawling ${urls.length} URLs via basic crawler`);
  return await crawlUrls(urls);
}

export async function createScrapeSession(
  urls: string[],
  engine: string = "playwright",
): Promise<ScrapeSession> {
  console.log(
    `[Scraper] Creating scrape session with engine: ${engine} for ${urls.length} URLs`,
  );

  const validEngines = ["playwright", "crawl4ai", "multi"];
  const selectedEngine = validEngines.includes(engine) ? engine : "playwright";

  let basicResults: ScrapeResultItem[] = [];
  let crawl4aiResults: ScrapeResultItem[] = [];
  let playwrightResults: ScrapeResultItem[] = [];

  if (selectedEngine === "multi") {
    // Use all agents in parallel
    const results = await multiAgentScrape(urls);
    basicResults = results.basicResults;
    crawl4aiResults = results.crawl4aiResults;
    playwrightResults = results.playwrightResults;
  } else if (selectedEngine === "playwright") {
    // Playwright only - direct call without other agents
    playwrightResults = await runPlaywrightOnly(urls);
    console.log(
      `[Scraper] Playwright-only: ${playwrightResults.length} results`,
    );
  } else if (selectedEngine === "crawl4ai") {
    // Crawl4AI only - direct call without other agents
    crawl4aiResults = await runCrawl4AIOnly(urls);
    console.log(`[Scraper] Crawl4AI-only: ${crawl4aiResults.length} results`);
  } else {
    playwrightResults = await runPlaywrightOnly(urls);
    const successCount = playwrightResults.filter(r => r.success).length;
    console.log(`[Scraper] Playwright: ${successCount} results`);
    if (successCount === 0) {
      console.log(`[Scraper] Playwright returned no results, falling back to basic crawler...`);
      basicResults = await runBasicCrawler(urls);
      console.log(`[Scraper] Basic crawler fallback: ${basicResults.filter(r => r.success).length} results`);
    }
  }

  const knowledgeBase: KnowledgeChunk[] = [];

  basicResults
    .filter(r => r.success)
    .forEach((result, index) => {
      knowledgeBase.push({
        id: `basic-${Date.now()}-${index}`,
        content: result.content || result.text || '',
        source: result.url,
        metadata: {
          title: result.title || '',
          crawledAt: new Date().toISOString(),
          agent: "BasicCrawler",
        },
      });
    });

  crawl4aiResults.forEach((result, index) => {
    const content = result.markdown || result.text || result.content;
    if (content) {
      knowledgeBase.push({
        id: `crawl4ai-${Date.now()}-${index}`,
        content,
        source: result.url,
        metadata: {
          title: result.title || '',
          crawledAt: new Date().toISOString(),
          agent: "Crawl4AI",
        },
      });
    }
  });

  playwrightResults.forEach((result, index) => {
    if (result.text) {
      knowledgeBase.push({
        id: `playwright-${Date.now()}-${index}`,
        content: result.text,
        source: result.url,
        metadata: {
          title: result.title || '',
          crawledAt: new Date().toISOString(),
          agent: "Playwright",
          emails: result.emails,
          phones: result.phones,
          links: result.links,
        },
      });
    }
  });

  console.log(
    `[Scraper] Combined ${knowledgeBase.length} knowledge chunks from all agents`,
  );

  const [session] = await db
    .insert(scrapeSessionsTable)
    .values({
      urls,
      knowledgeBase,
      chatHistory: [],
      status: "active",
    })
    .returning();

  return session;
}

export async function getScrapeSession(
  sessionId: string,
): Promise<ScrapeSession | null> {
  const result = await db
    .select()
    .from(scrapeSessionsTable)
    .where(eq(scrapeSessionsTable.id, parseInt(sessionId, 10)))
    .limit(1);

  return result[0] || null;
}

export async function getAllScrapeSessions(): Promise<ScrapeSession[]> {
  const result = await db
    .select()
    .from(scrapeSessionsTable)
    .orderBy(sql`${scrapeSessionsTable.createdAt} DESC`)
    .limit(50);

  return result;
}

export async function deleteScrapeSession(sessionId: string): Promise<boolean> {
  const result = await db
    .delete(scrapeSessionsTable)
    .where(eq(scrapeSessionsTable.id, parseInt(sessionId, 10)));
  return true;
}

export async function addUrlsToSession(
  sessionId: string,
  urls: string[],
): Promise<ScrapeSession | null> {
  const session = await getScrapeSession(sessionId);
  if (!session) return null;

  console.log(
    `[Scraper] Adding ${urls.length} URLs to session ${sessionId} with multi-agent`,
  );

  // Use multi-agent scraping for new URLs too
  const { basicResults, crawl4aiResults, playwrightResults } =
    await multiAgentScrape(urls);

  const newChunks: KnowledgeChunk[] = [];

  basicResults
    .filter(r => r.success)
    .forEach((result, index) => {
      newChunks.push({
        id: `basic-add-${Date.now()}-${index}`,
        content: result.content || result.text || '',
        source: result.url,
        metadata: {
          title: result.title || '',
          crawledAt: new Date().toISOString(),
          agent: "BasicCrawler",
        },
      });
    });

  crawl4aiResults.forEach((result, index) => {
    const content = result.markdown || result.text || result.content;
    if (content) {
      newChunks.push({
        id: `crawl4ai-add-${Date.now()}-${index}`,
        content,
        source: result.url,
        metadata: {
          title: result.title || '',
          crawledAt: new Date().toISOString(),
          agent: "Crawl4AI",
        },
      });
    }
  });

  playwrightResults.forEach((result, index) => {
    if (result.text) {
      newChunks.push({
        id: `playwright-add-${Date.now()}-${index}`,
        content: result.text,
        source: result.url,
        metadata: {
          title: result.title || '',
          crawledAt: new Date().toISOString(),
          agent: "Playwright",
          emails: result.emails,
          phones: result.phones,
        },
      });
    }
  });

  console.log(
    `[Scraper] Added ${newChunks.length} new chunks from multi-agent scrape`,
  );

  const existingUrls = session.urls || [];
  const existingKnowledge = (Array.isArray(session.knowledgeBase) ? session.knowledgeBase : []) as KnowledgeChunk[];

  await db
    .update(scrapeSessionsTable)
    .set({
      urls: [...(Array.isArray(existingUrls) ? existingUrls : []), ...urls] as unknown,
      knowledgeBase: [...existingKnowledge, ...newChunks] as unknown,
    })
    .where(eq(scrapeSessionsTable.id, parseInt(sessionId, 10)));

  return getScrapeSession(sessionId);
}

export async function chatWithSession(
  sessionId: string,
  message: string,
): Promise<string> {
  const session = await getScrapeSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const knowledgeBase = (session.knowledgeBase || []) as KnowledgeChunk[];
  const chatHistory = (session.chatHistory || []) as ChatMessage[];

  const context = knowledgeBase
    .slice(0, 5)
    .map(
      (chunk) =>
        `Source: ${chunk.source}\nContent: ${chunk.content.substring(0, 2000)}...`,
    )
    .join("\n\n---\n\n");

  const previousMessages = chatHistory.slice(-10).map((msg) => ({
    role: msg.role as "user" | "assistant",
    content: msg.content,
  }));

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an AI research assistant with access to scraped web content. Answer questions based on the provided knowledge base. Always cite sources when making claims.

Knowledge Base:
${context}`,
        },
        ...previousMessages,
        { role: "user", content: message },
      ],
      max_completion_tokens: 2000,
    });

    const assistantMessage =
      response.choices[0]?.message?.content ||
      "I couldn't generate a response.";

    const newUserMessage: ChatMessage = {
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };

    const newAssistantMessage: ChatMessage = {
      role: "assistant",
      content: assistantMessage,
      timestamp: new Date().toISOString(),
    };

    await db
      .update(scrapeSessionsTable)
      .set({
        chatHistory: [...chatHistory, newUserMessage, newAssistantMessage],
      })
      .where(eq(scrapeSessionsTable.id, parseInt(sessionId, 10)));

    return assistantMessage;
  } catch (error) {
    console.error("Chat with session error:", error);
    throw new Error("Failed to process chat message");
  }
}

export async function extractDataFromSession(
  sessionId: string,
  extractionPrompt: string,
): Promise<Record<string, unknown>> {
  const session = await getScrapeSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const knowledgeBase = (session.knowledgeBase || []) as KnowledgeChunk[];

  const context = knowledgeBase
    .map((chunk) => `Source: ${chunk.source}\nContent: ${chunk.content}`)
    .join("\n\n---\n\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a data extraction specialist. Extract structured data from the provided content according to the user's instructions. Return valid JSON only.`,
        },
        {
          role: "user",
          content: `Content to analyze:\n${context.substring(0, 30000)}\n\nExtraction instructions: ${extractionPrompt}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const extractedData = JSON.parse(content);

    await db
      .update(scrapeSessionsTable)
      .set({ knowledgeBase: extractedData })
      .where(eq(scrapeSessionsTable.id, parseInt(sessionId, 10)));

    return extractedData;
  } catch (error) {
    console.error("Data extraction error:", error);
    throw new Error("Failed to extract data");
  }
}

async function fetchPageHtml(url: string, timeout = 15000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null;
    return await resp.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function extractCleanText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(href: string, pageUrl: string, baseHost: string): string | null {
  try {
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return null;
    const full = href.startsWith('http') ? href : new URL(href, pageUrl).href;
    const u = new URL(full);
    if (u.hostname !== baseHost) return null;
    const skip = /\.(pdf|jpg|jpeg|png|gif|svg|css|js|xml|zip|mp4|mp3|ico|woff|woff2|ttf|eot)$/i;
    if (skip.test(u.pathname)) return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

export async function crawlFullWebsite(
  baseUrl: string,
  maxPages: number = 50,
): Promise<{
  urls: string[];
  knowledgeBase: KnowledgeChunk[];
  report?: Record<string, unknown>;
}> {
  console.log(`[Scraper] Starting full website crawl for: ${baseUrl} (max ${maxPages} pages)`);

  let baseHost: string;
  try {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      console.error(`[Scraper] Invalid protocol: ${parsed.protocol}`);
      return { urls: [], knowledgeBase: [] };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' ||
        hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('172.') ||
        hostname === '[::1]' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      console.error(`[Scraper] Blocked private/internal URL: ${baseUrl}`);
      return { urls: [], knowledgeBase: [] };
    }
    baseHost = parsed.hostname;
  } catch {
    console.error(`[Scraper] Invalid URL: ${baseUrl}`);
    return { urls: [], knowledgeBase: [] };
  }

  const discoveredUrls = new Set<string>([baseUrl]);
  const crawledUrls = new Set<string>();
  const failedUrls = new Set<string>();
  const allContent: KnowledgeChunk[] = [];
  const BATCH = 8;
  const DELAY_BETWEEN_BATCHES = 1000;

  while (discoveredUrls.size > crawledUrls.size + failedUrls.size && crawledUrls.size < maxPages) {
    const remaining = maxPages - crawledUrls.size;
    if (remaining <= 0) break;
    const batch = Array.from(discoveredUrls)
      .filter(u => !crawledUrls.has(u) && !failedUrls.has(u))
      .slice(0, Math.min(BATCH, remaining));
    if (batch.length === 0) break;

    const results = await Promise.allSettled(
      batch.map(async (url) => {
        let html: string | null = null;

        try {
          html = await getPageContent(url, { waitMs: 5000 });
        } catch (e) {
          console.log(`[Scraper] Playwright failed for ${url}: ${(e as Error).message?.substring(0, 100)}`);
        }

        if (!html) {
          try {
            html = await fetchPageHtml(url);
          } catch (e) {
            console.log(`[Scraper] Fetch fallback failed for ${url}`);
          }
        }
        if (!html) {
          failedUrls.add(url);
          return null;
        }

        crawledUrls.add(url);
        const $ = parseHtml(html);

        $('a').each((_, a) => {
          const href = $(a).attr('href') || '';
          const normalized = normalizeUrl(href, url, baseHost);
          if (normalized && discoveredUrls.size < maxPages * 3) {
            discoveredUrls.add(normalized);
          }
        });

        const mainEl = $('main, article, [role="main"], .content, #content, .post-content, .entry-content, .article-body').first();
        let bodyText = '';
        if (mainEl.length) {
          bodyText = mainEl.text().replace(/\s+/g, ' ').trim();
        }
        if (bodyText.length < 50) {
          bodyText = extractCleanText(html);
        }

        const title = $('title').text().trim() ||
          $('meta[property="og:title"]').attr('content')?.trim() ||
          $('h1').first().text().trim() || '';

        return { url, title, bodyText };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.bodyText.length > 20) {
        const { url, title, bodyText } = r.value;
        allContent.push({
          id: `fullcrawl-${Date.now()}-${allContent.length}`,
          content: bodyText.substring(0, 25000),
          source: url,
          metadata: {
            title,
            crawledAt: new Date().toISOString(),
            agent: "FullWebsiteCrawl",
            emails: bodyText.match(/[\w.-]+@[\w.-]+\.\w+/g) || [],
            phones: bodyText.match(/\+?\d[\d\s-]{8,}/g) || [],
          },
        });
      }
    }

    console.log(`[Scraper] Crawled ${crawledUrls.size}/${maxPages} pages (${failedUrls.size} failed), discovered ${discoveredUrls.size} URLs, ${allContent.length} chunks`);

    if (crawledUrls.size < maxPages && batch.length > 0) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
    }
  }

  console.log(`[Scraper] Full crawl complete: ${crawledUrls.size} pages crawled, ${failedUrls.size} failed, ${allContent.length} chunks`);
  return { urls: Array.from(crawledUrls), knowledgeBase: allContent };
}

// Generate organized GPT report from knowledge base
interface KnowledgeReport {
  type: "company" | "product" | "general";
  generatedAt: string;
  sourcePages: number;
  content: string;
}

export async function generateKnowledgeReport(
  sessionId: string,
  reportType: "company" | "product" | "general" = "general",
): Promise<KnowledgeReport> {
  const session = await getScrapeSession(sessionId);
  if (!session || !Array.isArray(session.knowledgeBase) || !session.knowledgeBase.length) {
    throw new Error("No knowledge base found for this session");
  }

  // Combine all content
  const allContent = (session.knowledgeBase as KnowledgeChunk[])
    .map(
      (chunk: KnowledgeChunk) =>
        `--- Page: ${chunk.metadata?.title || chunk.source} ---\n${chunk.content}`,
    )
    .join("\n\n");

  const reportPrompts: Record<string, string> = {
    company: `Generate a comprehensive COMPANY INTELLIGENCE REPORT with these sections:
1. EXECUTIVE SUMMARY - Key findings and business overview
2. COMPANY PROFILE - Name, founding year, headquarters, industry, registration
3. LEADERSHIP & EXECUTIVES - CEO, founders, board members with backgrounds
4. PRODUCTS & SERVICES - Main offerings, business model
5. FINANCIALS - Revenue, funding, growth metrics if available
6. CONTACT INFORMATION - Phone, email, addresses, social media
7. KEY INSIGHTS - Strategic analysis and recommendations`,

    product: `Generate a comprehensive PRODUCT/SERVICE REPORT with these sections:
1. EXECUTIVE SUMMARY - Overview of offerings
2. PRODUCT CATALOG - List all products/services with descriptions
3. PRICING INFORMATION - Any pricing found
4. FEATURES & BENEFITS - Key features
5. TARGET MARKET - Who the products serve
6. COMPETITIVE ADVANTAGES - Unique selling points`,

    general: `Generate a comprehensive KNOWLEDGE REPORT with these sections:
1. EXECUTIVE SUMMARY - Overview of all content
2. KEY TOPICS - Main subjects covered
3. IMPORTANT FINDINGS - Critical information extracted
4. CONTACT DETAILS - Any contact information found
5. LINKS & RESOURCES - Important links discovered
6. RECOMMENDATIONS - How to use this information`,
  };

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an expert business intelligence analyst. Create a well-organized, professional report from website content. 
Use proper formatting with headers, bullet points, and tables where appropriate.
Extract ALL relevant data - names, numbers, dates, contact info, etc.
If data is not available for a section, note "Not found in source material".`,
      },
      {
        role: "user",
        content: `${reportPrompts[reportType]}

SOURCE MATERIAL FROM WEBSITE:
${allContent.substring(0, 80000)}

Generate the report in a well-structured format. Include all data found.`,
      },
    ],
    max_completion_tokens: 8000,
    temperature: 0.3,
  });

  const reportContent = response.choices[0]?.message?.content || "";

  // Store as extracted data
  const report = {
    type: reportType,
    generatedAt: new Date().toISOString(),
    sourcePages: (Array.isArray(session.knowledgeBase) ? session.knowledgeBase.length : 0),
    content: reportContent,
  };

  await db
    .update(scrapeSessionsTable)
    .set({ knowledgeBase: report as unknown })
    .where(eq(scrapeSessionsTable.id, parseInt(sessionId, 10)));

  return report;
}

export interface FlatResult {
  url: string;
  content: string;
  title: string;
  agent: string;
  metadata?: Record<string, unknown>;
}

export function flattenResults(scrapeResult: MultiAgentScrapeResult): FlatResult[] {
  const flat: FlatResult[] = [];
  for (const r of scrapeResult.basicResults) {
    if (r?.content || r?.text) {
      flat.push({ url: r.url || "", content: r.content || r.text || "", title: r.title || "", agent: "basic" });
    }
  }
  for (const r of scrapeResult.crawl4aiResults) {
    if (r?.markdown || r?.text || r?.content) {
      flat.push({
        url: r.url || "",
        content: r.markdown || r.text || r.content || "",
        title: r.title || "",
        agent: "crawl4ai",
        metadata: { emails: r.emails, phones: r.phones, headings: r.headings, images: r.images },
      });
    }
  }
  for (const r of scrapeResult.playwrightResults) {
    if (r?.text || r?.content) {
      flat.push({ url: r.url || "", content: r.text || r.content || "", title: r.title || "", agent: "playwright" });
    }
  }
  return flat;
}

export function getBestContent(items: ScrapeResultItem[], targetUrl?: string): string {
  let best = "";
  if (targetUrl) {
    for (const r of items) {
      if (r?.url === targetUrl) {
        const t = r?.markdown || r?.text || r?.content || "";
        if (t.length > best.length) best = t;
      }
    }
  }
  if (!best) {
    const sorted = [...items]
      .filter(r => r?.text || r?.markdown || r?.content)
      .sort((a, b) => ((b?.markdown || b?.text || b?.content || "").length) - ((a?.markdown || a?.text || a?.content || "").length));
    best = sorted.slice(0, 3).map(r => r?.markdown || r?.text || r?.content || "").join("\n\n---\n\n");
  }
  return best.substring(0, 100000);
}
