import { PerplexityService } from "../perplexity-service.js";
import { openai } from "../openai-client.js";

const perplexityService = new PerplexityService();

interface NewsSource {
  domain: string;
  name: string;
  category: string;
  url: string;
  rssUrl?: string;
}

export const SAUDI_NEWS_SOURCES: NewsSource[] = [
  { domain: 'argaam.com', name: 'Argaam', category: 'financial', url: 'https://www.argaam.com' },
  { domain: 'saudiexchange.sa', name: 'Saudi Exchange (Tadawul)', category: 'exchange', url: 'https://www.saudiexchange.sa' },
  { domain: 'spa.gov.sa', name: 'Saudi Press Agency', category: 'government', url: 'https://www.spa.gov.sa' },
  { domain: 'sama.gov.sa', name: 'SAMA (Central Bank)', category: 'regulatory', url: 'https://www.sama.gov.sa' },
  { domain: 'vision2030.gov.sa', name: 'Vision 2030', category: 'government', url: 'https://www.vision2030.gov.sa' },
  { domain: 'arabnews.com', name: 'Arab News', category: 'news', url: 'https://www.arabnews.com' },
  { domain: 'zawya.com', name: 'Zawya', category: 'financial', url: 'https://www.zawya.com' },
  { domain: 'reuters.com', name: 'Reuters Middle East', category: 'news', url: 'https://www.reuters.com' },
  { domain: 'bloomberg.com', name: 'Bloomberg Middle East', category: 'financial', url: 'https://www.bloomberg.com' },
  { domain: 'cnbcarabia.com', name: 'CNBC Arabia', category: 'financial', url: 'https://www.cnbcarabia.com' },
  { domain: 'alarabiya.net', name: 'Al Arabiya', category: 'news', url: 'https://www.alarabiya.net' },
  { domain: 'aleqt.com', name: 'Al Eqtisadiah', category: 'financial', url: 'https://www.aleqt.com' },
  { domain: 'alriyadh.com', name: 'Al Riyadh', category: 'news', url: 'https://www.alriyadh.com' },
  { domain: 'okaz.com.sa', name: 'Okaz', category: 'news', url: 'https://www.okaz.com.sa' },
  { domain: 'alhayat.com', name: 'Al Hayat', category: 'news', url: 'https://www.alhayat.com' },
  { domain: 'alwatan.com.sa', name: 'Al Watan', category: 'news', url: 'https://www.alwatan.com.sa' },
  { domain: 'mci.gov.sa', name: 'Ministry of Commerce', category: 'government', url: 'https://www.mci.gov.sa' },
  { domain: 'mof.gov.sa', name: 'Ministry of Finance', category: 'government', url: 'https://www.mof.gov.sa' },
  { domain: 'cma.org.sa', name: 'Capital Market Authority', category: 'regulatory', url: 'https://www.cma.org.sa' },
  { domain: 'neom.com', name: 'NEOM', category: 'megaproject', url: 'https://www.neom.com' },
  { domain: 'pif.gov.sa', name: 'Public Investment Fund', category: 'investment', url: 'https://www.pif.gov.sa' },
  { domain: 'sdaia.gov.sa', name: 'SDAIA (Data & AI)', category: 'technology', url: 'https://www.sdaia.gov.sa' },
];

export interface NewsArticle {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  url: string;
  content: string;
  summary: string;
  category: string;
  tags: string[];
  publishedAt: Date;
  fetchedAt: Date;
  imageUrl: string | null;
  aiAnalysis?: {
    sentiment: 'positive' | 'negative' | 'neutral';
    marketImpact: 'high' | 'medium' | 'low';
    keyInsights: string[];
    affectedSectors: string[];
    investmentImplication: string;
  };
}

// In-memory cache
let _newsCache: NewsArticle[] = [];
let _lastFetch: number = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function generateEnhancedNewsContent(newsItem: { title: string; summary: string; category: string; source: string; url: string }): Promise<{
  enhancedHeadline: string;
  fullSummary: string;
  aiAnalysis: NewsArticle['aiAnalysis'];
}> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a senior Saudi Arabian financial journalist and market analyst. Your job is to:
1. Create compelling, professional news headlines that capture attention
2. Write comprehensive article summaries (3-5 sentences) with key details
3. Provide investment-grade analysis for business professionals`
        },
        {
          role: "user",
          content: `Enhance this Saudi business news article:

Original Title: ${newsItem.title}
Original Summary: ${newsItem.summary}
Category: ${newsItem.category}
Source: ${newsItem.source}

Create a comprehensive JSON response with:
{
  "enhancedHeadline": "A more compelling, professional headline that captures the key news (max 100 chars)",
  "fullSummary": "A detailed 3-5 sentence summary covering: what happened, key numbers/figures, who is involved, why it matters for investors/businesses, and potential implications",
  "sentiment": "positive" | "negative" | "neutral",
  "marketImpact": "high" | "medium" | "low",
  "keyInsights": ["3-4 specific, actionable insights for investors"],
  "affectedSectors": ["List of 2-4 Saudi market sectors affected"],
  "investmentImplication": "2-3 sentences explaining the investment opportunity or risk, with specific recommendations"
}

Make the content professional, specific to Saudi/GCC markets, and valuable for business decision-makers.`
        }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 800,
      temperature: 0.4,
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(content);
      return {
        enhancedHeadline: parsed.enhancedHeadline || newsItem.title,
        fullSummary: parsed.fullSummary || newsItem.summary,
        aiAnalysis: {
          sentiment: parsed.sentiment || 'neutral',
          marketImpact: parsed.marketImpact || 'medium',
          keyInsights: parsed.keyInsights || [],
          affectedSectors: parsed.affectedSectors || [],
          investmentImplication: parsed.investmentImplication || ''
        }
      };
    }
  } catch (error) {
    console.error("AI enhancement error:", error);
  }
  return {
    enhancedHeadline: newsItem.title,
    fullSummary: newsItem.summary,
    aiAnalysis: undefined
  };
}

export async function fetchRealTimeNews(limit: number = 60, categories?: string[]): Promise<NewsArticle[]> {
  console.log(`[News] Fetching real-time news from Perplexity API (limit: ${limit})`);
  
  try {
    const perplexityNews = await (perplexityService as any).getGCCBusinessNews?.(limit, categories) ?? await perplexityService.search(`GCC business news ${categories?.join(' ') || ''}`);
    
    if (!perplexityNews || perplexityNews.length === 0) {
      console.log("[News] No news returned from Perplexity API");
      return [];
    }
    
    console.log(`[News] Received ${perplexityNews.length} articles from Perplexity`);
    console.log(`[News] Enhancing articles with AI-generated headlines and summaries...`);
    
    const batchSize = 5;
    const newsWithAnalysis: NewsArticle[] = [];
    const itemsToProcess = perplexityNews.slice(0, Math.min(limit, 20));
    
    for (let i = 0; i < itemsToProcess.length; i += batchSize) {
      const batch = itemsToProcess.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (item: any, batchIndex: number) => {
          const enhanced = await generateEnhancedNewsContent({
            title: item.title,
            summary: item.summary,
            category: item.category,
            source: item.source || 'News Source',
            url: item.url || '#',
          });
          
          return {
            id: `news-${Date.now()}-${i + batchIndex}`,
            source: item.source || 'Verified Source',
            sourceName: item.source || 'Saudi Business News',
            title: enhanced.enhancedHeadline,
            url: item.url || '#',
            content: enhanced.fullSummary,
            summary: enhanced.fullSummary,
            category: item.category,
            tags: [item.category, 'saudi', 'gcc', 'real-time'],
            publishedAt: item.date ? new Date(item.date) : new Date(),
            fetchedAt: new Date(),
            imageUrl: null,
            aiAnalysis: enhanced.aiAnalysis,
          } as NewsArticle;
        })
      );
      newsWithAnalysis.push(...batchResults);
    }
    
    console.log(`[News] Enhanced ${newsWithAnalysis.length} articles with AI content`);
    return newsWithAnalysis;
  } catch (error) {
    console.error("[News] Error fetching from Perplexity:", error);
    throw new Error("Failed to fetch real-time news from Perplexity API");
  }
}

export async function refreshNewsCache(): Promise<number> {
  console.log("[News] Refreshing in-memory cache from Perplexity API...");
  try {
    const news = await fetchRealTimeNews(50);
    _newsCache = news;
    _lastFetch = Date.now();
    console.log(`[News] Cached ${news.length} articles in memory`);
    return news.length;
  } catch (error) {
    console.error("[News] Failed to refresh cache:", error);
    return 0;
  }
}

export async function getLatestNews(limit = 20): Promise<NewsArticle[]> {
  // If cache is stale or empty, try to refresh
  if (_newsCache.length === 0 || (Date.now() - _lastFetch) > CACHE_TTL_MS) {
    try {
      await refreshNewsCache();
    } catch {
      // Return whatever is cached
    }
  }
  return _newsCache.slice(0, limit);
}

export async function getNewsByCategory(category: string, limit = 20): Promise<NewsArticle[]> {
  const all = await getLatestNews(200);
  return all.filter(a => a.category === category).slice(0, limit);
}

export function getNewsSources() {
  return SAUDI_NEWS_SOURCES;
}
