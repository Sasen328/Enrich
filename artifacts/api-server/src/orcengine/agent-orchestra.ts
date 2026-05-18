import { crawlUrls } from "./crawler";
import { getPageContent, parseHtml } from "../browser-helper";
import { searchWithGemini, researchCompanyWithGemini, isGeminiConfigured, deepResearchWithGemini, synthesizeWithGemini } from "../gemini-search";
import { crawl4ai, crawl4aiBatch } from "../crawl4ai-engine";
import { PerplexityService } from "../perplexity-service";
import { openai } from "../openai-client";
import Anthropic from "@anthropic-ai/sdk";
// Apify stubs — replace with @apify/client if APIFY_API_KEY configured
async function runActor(actorId: string, input: unknown, opts?: unknown): Promise<any> {
  throw new Error("Apify not configured");
}
async function getDatasetItems(datasetId: string): Promise<any[]> {
  return [];
}


const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "dummy",
});

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const EXPLORIUM_API_KEY = process.env.EXPLORIUM_API_KEY;
const EXPLORIUM_BASE_URL = "https://app.explorium.ai/api/bundle/v1";

export interface AgentResult {
  agentName: string;
  status: "success" | "partial" | "failed";
  data: any;
  sources: string[];
  executionTimeMs: number;
  error?: string;
}

export interface OrchestratedReport {
  companyName: string;
  arabicName?: string;
  englishName?: string;
  profileSummary?: string;
  companyOverview: {
    legalName?: string;
    arabicName?: string;
    founded?: string;
    founders?: Array<{
      name?: string;
      arabicName?: string;
      bio?: string;
      currentRole?: string;
      netWorth?: string;
    }> | string[];
    headquarters?: {
      address?: string;
      city?: string;
      country?: string;
      postalCode?: string;
      coordinates?: string;
    };
    companyType?: string;
    industry?: string;
    subIndustry?: string;
    stockInfo?: {
      exchange?: string;
      ticker?: string;
      marketCap?: string;
      currentPrice?: string;
    };
    registrationNumber?: string;
    website?: string;
  };
  ownership?: {
    ownershipType?: string;
    majorShareholders?: Array<{
      name?: string;
      arabicName?: string;
      percentage?: string;
      type?: string;
    }>;
    publicFloat?: string;
    governmentStake?: string;
    familyOwnership?: string;
  };
  financials: {
    revenue?: string;
    annualRevenue?: string;
    revenueGrowth?: string;
    netIncome?: string;
    profitMargin?: string;
    grossMargin?: string;
    operatingIncome?: string;
    totalAssets?: string;
    totalLiabilities?: string;
    equity?: string;
    debtToEquity?: string;
    marketCap?: string;
    fiscalYear?: string;
    revenueHistory?: Array<{ year?: string; revenue?: string; growth?: string }>;
  };
  workforce: {
    totalEmployees?: string;
    employeeGrowth?: string;
    saudiNationals?: string;
    saudizationRate?: string;
    departments?: string[];
    avgTenure?: string;
  };
  leadership: {
    ceo?: { 
      name?: string; 
      arabicName?: string; 
      bio?: string; 
      education?: string;
      previousRoles?: string[];
      estimatedCompensation?: string;
      linkedin?: string;
      email?: string;
    };
    chairman?: { 
      name?: string; 
      arabicName?: string; 
      bio?: string;
      otherRoles?: string[];
      estimatedCompensation?: string;
    };
    cfo?: {
      name?: string;
      arabicName?: string;
      bio?: string;
      estimatedCompensation?: string;
    };
    executiveTeam?: Array<{
      name?: string;
      arabicName?: string;
      title?: string;
      department?: string;
      bio?: string;
      estimatedCompensation?: string;
      linkedin?: string;
      email?: string;
    }>;
    boardOfDirectors?: Array<{
      name?: string;
      arabicName?: string;
      role?: string;
      committee?: string;
      bio?: string;
      otherBoards?: string[];
      aiAnalysis?: string;
    }>;
    boardMembers?: Array<{
      name?: string;
      arabicName?: string;
      role?: string;
    }>;
  };
  locations: {
    headquarters?: string | {
      name?: string;
      address?: string;
      city?: string;
      region?: string;
      country?: string;
      phone?: string;
      fax?: string;
      email?: string;
    };
    branches?: Array<{
      name?: string;
      type?: string;
      address?: string;
      city?: string;
      country?: string;
      phone?: string;
      employees?: string;
    }>;
    internationalOffices?: string[];
    operatingRegions?: string[];
    regions?: string[];
  };
  contactInfo: {
    phone?: string;
    mainPhone?: string;
    customerService?: string;
    email?: string;
    website?: string;
    investorRelations?: string | { phone?: string; email?: string; contact?: string };
    mediaContact?: string | { phone?: string; email?: string };
  };
  socialMedia: {
    linkedin?: { url?: string; followers?: string };
    twitter?: { url?: string; followers?: string };
    facebook?: { url?: string; followers?: string };
    instagram?: { url?: string; followers?: string };
    youtube?: { url?: string; subscribers?: string };
    tiktok?: { url?: string; followers?: string };
  };
  productsAndServices?: {
    mainProducts?: string[];
    mainServices?: string[];
    revenueStreams?: string[];
    targetMarkets?: string[];
    competitiveAdvantage?: string;
  };
  products?: string[];
  services?: string[];
  competitors?: string[];
  competitiveLandscape?: {
    directCompetitors?: Array<{ name?: string; comparison?: string; marketShare?: string }>;
    marketPosition?: string;
    marketShare?: string;
    industryRanking?: string;
  };
  swotAnalysis?: {
    strengths?: string[];
    weaknesses?: string[];
    opportunities?: string[];
    threats?: string[];
  };
  vision2030Alignment?: {
    relevantPillars?: string[];
    initiatives?: string[];
    governmentContracts?: string;
    alignmentScore?: string;
  };
  aiAnalysis?: {
    investmentOutlook?: string;
    growthPotential?: string;
    riskFactors?: string[];
    strategicRecommendations?: string[];
    partnershipOpportunities?: string;
    founderAnalysis?: string;
    boardEffectiveness?: string;
    managementQuality?: string;
  };
  keyInsights?: string[];
  recommendations?: string[];
  recentNews?: string[];
  agentResults: AgentResult[];
  dataSources: string[];
  generatedAt: string;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMsg)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function perplexityAgent(companyName: string, websiteUrl?: string): Promise<AgentResult> {
  const startTime = Date.now();
  const sources: string[] = [];
  
  try {
    const perplexity = new PerplexityService();
    
    const queries = [
      `What is ${companyName} Saudi Arabia? Provide company overview, founding year, founders with Arabic names (الاسم بالعربية), headquarters address, number of employees, annual revenue in SAR, net income, and industry. Include Arabic company name if available.`,
      `Who owns ${companyName}? List all shareholders and ownership percentages. Include major shareholders, family ownership, government stake, institutional investors. Provide names in English and Arabic.`,
      `What are the FULL office locations and branch addresses for ${companyName} in Saudi Arabia, GCC and internationally? Include building names, street addresses, cities, phone numbers for each location.`,
      `Who are the executivesTable of ${companyName}? For each executive (CEO, CFO, COO, etc), provide: name (English and Arabic), title, estimated annual salary/compensation in SAR based on company size and industry benchmarks.`,
      `Who are the board of directors of ${companyName}? For each board member provide: name in English and Arabic, role, committee memberships, other board positions, background.`,
      `What are the social media profiles for ${companyName}? Provide LinkedIn, Twitter, Facebook, Instagram, YouTube URLs with exact follower/subscriber counts.`,
      `What is the latest financial performance of ${companyName}? Include: annual revenue in SAR, revenue growth %, net income, profit margin, total assets, market cap if public, stock price and ticker if listed on Tadawul.`,
      `What products and services does ${companyName} offer? List all main products, services, revenue streams, and competitive advantages.`,
    ];
    
    const results: any[] = [];
    
    for (const query of queries) {
      try {
        const response = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              { role: "system", content: "You are a business intelligence researcher. Provide factual, verified data only. Include specific numbers, dates, and names when available." },
              { role: "user", content: query }
            ],
            max_tokens: 1500,
            temperature: 0.1,
            return_citations: true,
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          results.push(data.choices?.[0]?.message?.content || "");
          if (data.citations) {
            sources.push(...data.citations);
          }
        }
      } catch (e) {
        console.log(`[PerplexityAgent] Query failed: ${query.substring(0, 50)}...`);
      }
    }
    
    // Parse Perplexity results into structured format using GPT-4o
    let structuredData: any = { searchResults: results.join("\n\n") };
    
    if (results.length > 0) {
      try {
        const parseResponse = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "Extract structured business data from search results. Return ONLY data explicitly found - use null for missing fields."
            },
            {
              role: "user",
              content: `Parse this business research into structured JSON:\n\n${results.join("\n\n").substring(0, 10000)}\n\nReturn:\n{
  "companyName": "Company name",
  "arabicName": "الاسم بالعربية if found",
  "summary": "Company summary",
  "founders": ["Founder 1 name", "Founder 2 name"],
  "ownership": {
    "ownershipType": "Public/Private/Family/Government",
    "majorShareholders": [{"name": "Shareholder", "stake": "X%"}],
    "governmentStake": "X% if any",
    "familyOwnership": "X% if any",
    "publicFloat": "X% if listed"
  },
  "leadership": {
    "ceo": {"name": "CEO Name", "arabicName": "Arabic", "salary": "Est compensation"},
    "executivesTable": [{"name": "Name", "title": "Title", "arabicName": "Arabic"}],
    "boardOfDirectors": [{"name": "Name", "role": "Role", "arabicName": "Arabic"}],
    "salaries": [{"title": "CEO", "salary": "SAR X million"}]
  },
  "financials": {
    "revenue": "Annual revenue",
    "annualRevenue": "SAR X million/billion",
    "revenueGrowth": "X%",
    "netIncome": "SAR X",
    "profitMargin": "X%",
    "totalAssets": "SAR X"
  },
  "workforce": {
    "totalEmployees": "X",
    "employeeGrowth": "X%"
  },
  "locations": {
    "branches": [{"city": "City", "country": "Country", "address": "Address"}],
    "fullAddresses": ["Full address 1", "Full address 2"]
  },
  "socialMedia": {
    "linkedin": {"url": "URL", "followers": "X"},
    "twitter": {"url": "URL", "followers": "X"},
    "facebook": {"url": "URL", "followers": "X"},
    "instagram": {"url": "URL", "followers": "X"}
  },
  "productsAndServices": {
    "products": ["Product 1", "Product 2"],
    "services": ["Service 1", "Service 2"]
  },
  "competitors": ["Competitor 1", "Competitor 2"]
}`
            }
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 3000,
        });
        
        const parsed = JSON.parse(parseResponse.choices[0]?.message?.content || '{}');
        structuredData = { ...parsed, searchResults: results.join("\n\n") };
        console.log(`[PerplexityAgent] Parsed ${Object.keys(parsed).filter(k => parsed[k]).length} structured fields`);
      } catch (parseError: any) {
        console.log(`[PerplexityAgent] GPT parsing failed: ${parseError.message}`);
      }
    }
    
    return {
      agentName: "PerplexityAgent",
      status: results.length > 0 ? "success" : "failed",
      data: structuredData,
      sources: Array.from(new Set(sources)),
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      agentName: "PerplexityAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function crawlerAgent(websiteUrl: string): Promise<AgentResult> {
  const startTime = Date.now();
  const sources: string[] = [];
  
  try {
    if (!websiteUrl) {
      return {
        agentName: "CrawlerAgent",
        status: "failed",
        data: null,
        sources: [],
        executionTimeMs: Date.now() - startTime,
        error: "No website URL provided",
      };
    }
    
    const baseUrl = websiteUrl.replace(/\/$/, "");
    const urlsToCrawl = [
      baseUrl,
      `${baseUrl}/about`,
      `${baseUrl}/about-us`,
      `${baseUrl}/ar/about`,
      `${baseUrl}/leadership`,
      `${baseUrl}/management`,
      `${baseUrl}/team`,
      `${baseUrl}/our-team`,
      `${baseUrl}/board`,
      `${baseUrl}/board-of-directors`,
      `${baseUrl}/contact`,
      `${baseUrl}/contact-us`,
      `${baseUrl}/locations`,
      `${baseUrl}/branches`,
      `${baseUrl}/investors`,
      `${baseUrl}/investor-relations`,
    ];
    
    console.log(`[CrawlerAgent] Crawling ${urlsToCrawl.length} pages from ${baseUrl}`);
    
    const crawlResults = await crawlUrls(urlsToCrawl.slice(0, 10));
    const validResults = crawlResults.filter(r => r.content && r.content.length > 100);
    
    sources.push(...validResults.map(r => r.url));
    
    // Deterministic extraction fallback using regex patterns
    const extractDeterministic = (content: string) => {
      const emails = content.match(/[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/g) || [];
      const phones = content.match(/\+?[\d\s()-]{10,}/g)?.filter(p => p.replace(/\D/g, '').length >= 9) || [];
      const linkedinUrls = content.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[\w-]+/g) || [];
      const twitterUrls = content.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[\w-]+/g) || [];
      const facebookUrls = content.match(/https?:\/\/(?:www\.)?facebook\.com\/[\w.-]+/g) || [];
      const instagramUrls = content.match(/https?:\/\/(?:www\.)?instagram\.com\/[\w.-]+/g) || [];
      
      return {
        email: emails[0] || null,
        phone: phones[0]?.trim() || null,
        socialLinks: {
          linkedin: linkedinUrls[0] || null,
          twitter: twitterUrls[0] || null,
          facebook: facebookUrls[0] || null,
          instagram: instagramUrls[0] || null,
        },
        emails: [...new Set(emails)].slice(0, 5),
        phones: [...new Set(phones.map(p => p.trim()))].slice(0, 5),
      };
    };
    
    // If we have valid crawl results, use GPT-4o to extract structured data
    let extractedData: any = { pages: [] };
    const allContent = validResults.map(r => r.content || '').join('\n');
    const deterministicData = extractDeterministic(allContent);
    
    if (validResults.length > 0) {
      const combinedContent = validResults.map(r => `=== PAGE: ${r.url} ===\n${r.title}\n${r.content?.substring(0, 4000)}`).join('\n\n');
      
      try {
        const extractionResponse = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are a data extraction expert. Extract ALL structured business information from website content. Return JSON with ONLY data explicitly found - use null for missing fields.`
            },
            {
              role: "user",
              content: `Extract structured data from this website content:\n\n${combinedContent.substring(0, 12000)}\n\nReturn JSON:\n{
  "companyName": "Official company name",
  "arabicName": "الاسم بالعربية if found",
  "description": "Company description/about text",
  "foundedYear": "Year founded",
  "industry": "Main industry",
  "employeeCount": "Number of employees",
  "headquarters": "Full HQ address",
  "phone": "Main phone number",
  "email": "Main email",
  "executivesTable": [{"name": "Name", "title": "Title", "linkedin": "URL if found"}],
  "boardMembers": [{"name": "Name", "title": "Title"}],
  "products": ["Product/service 1", "Product/service 2"],
  "locations": ["Branch 1 address", "Branch 2 address"],
  "socialLinks": {"linkedin": "url", "twitter": "url", "facebook": "url", "instagram": "url"},
  "certifications": ["ISO cert", "Award"],
  "clients": ["Notable client 1", "Client 2"]
}`
            }
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 2000,
        });
        
        const extracted = JSON.parse(extractionResponse.choices[0]?.message?.content || '{}');
        console.log(`[CrawlerAgent] GPT-4o extracted: ${Object.keys(extracted).filter(k => extracted[k]).length} fields`);
        
        // Merge GPT extracted data with deterministic fallback for missing fields
        extractedData = {
          ...extracted,
          email: extracted.email || deterministicData.email,
          phone: extracted.phone || deterministicData.phone,
          socialLinks: {
            linkedin: extracted.socialLinks?.linkedin || deterministicData.socialLinks.linkedin,
            twitter: extracted.socialLinks?.twitter || deterministicData.socialLinks.twitter,
            facebook: extracted.socialLinks?.facebook || deterministicData.socialLinks.facebook,
            instagram: extracted.socialLinks?.instagram || deterministicData.socialLinks.instagram,
          },
          pages: validResults.map(r => ({
            url: r.url,
            title: r.title,
            content: r.content?.substring(0, 3000),
          }))
        };
      } catch (extractError: any) {
        console.log(`[CrawlerAgent] GPT extraction failed, using deterministic fallback: ${extractError.message}`);
        // Fall back to deterministic extraction when GPT fails
        extractedData = {
          ...deterministicData,
          pages: validResults.map(r => ({
            url: r.url,
            title: r.title,
            content: r.content?.substring(0, 5000),
          }))
        };
      }
    }
    
    return {
      agentName: "CrawlerAgent",
      status: validResults.length > 0 ? "success" : "partial",
      data: extractedData,
      sources,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      agentName: "CrawlerAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

// OpenAI Deep Research Agent - Uses o3-deep-research for autonomous multi-step research
async function deepResearchAgent(companyName: string, websiteUrl?: string): Promise<AgentResult> {
  const startTime = Date.now();
  const sources: string[] = ["OpenAI Deep Research"];
  
  try {
    console.log(`[DeepResearchAgent] Starting deep research for: ${companyName}`);
    
    const researchQuery = `
Research the Saudi Arabian company "${companyName}" comprehensively. Include:
1. Company overview with Arabic name (الاسم بالعربية)
2. Ownership structure with exact shareholder percentages
3. All major shareholders and their ownership stakes
4. Board of directors with full names (English and Arabic)
5. Executive team with titles, backgrounds, and estimated compensation
6. Financial data: revenue, net income, employee count
7. All office locations with full addresses in Saudi Arabia
8. Products and services offered
9. Recent news and developments
10. Vision 2030 alignment and government connections
11. Competitive landscape in Saudi market
12. Founder profiles and company history

Focus on official sources, regulatory filings, and Saudi business databases.
`;

    // Try deep research model, fallback to regular GPT-4o with web search if not available
    let researchText = "";
    let citedUrls: string[] = [];
    
    try {
      const response = await openai.responses.create({
        model: "o4-mini-deep-research-2025-06-26",
        input: [
          {
            role: "developer",
            content: [{
              type: "input_text",
              text: "You are a professional business intelligence researcher focusing on Saudi Arabian companiesTable. Provide comprehensive, data-backed analysis with Arabic names alongside English. Include exact percentages for ownership and shareholding. Focus on verified information from official sources."
            }]
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: researchQuery
            }]
          }
        ],
        tools: [{ type: "web_search_preview" }],
      } as any);
      
      // Extract the research output
      const researchOutput = (response as any).output || [];
      
      for (const item of researchOutput) {
        if (item.type === "message" && item.content) {
          for (const contentBlock of item.content) {
            if (contentBlock.type === "output_text") {
              researchText += contentBlock.text + "\n";
              if (contentBlock.annotations) {
                for (const ann of contentBlock.annotations) {
                  if (ann.type === "url_citation" && ann.url) {
                    citedUrls.push(ann.url);
                  }
                }
              }
            }
          }
        }
      }
    } catch (deepResearchError: any) {
      console.log(`[DeepResearchAgent] Deep Research model unavailable: ${deepResearchError.message}`);
      console.log(`[DeepResearchAgent] Falling back to GPT-4o with web search context`);
      
      // Fallback: Use regular GPT-4o with the Perplexity-style research
      const fallbackResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a professional business intelligence researcher focusing on Saudi Arabian companiesTable. Provide comprehensive, data-backed analysis with Arabic names alongside English."
          },
          {
            role: "user",
            content: researchQuery
          }
        ],
        max_completion_tokens: 4000,
      });
      
      researchText = fallbackResponse.choices[0]?.message?.content || "";
    }
    
    sources.push(...citedUrls.slice(0, 20));
    
    console.log(`[DeepResearchAgent] Research complete, ${researchText.length} chars, ${citedUrls.length} sources`);
    
    return {
      agentName: "DeepResearchAgent",
      status: researchText.length > 100 ? "success" : "partial",
      data: {
        researchReport: researchText,
        citations: citedUrls,
        model: "o4-mini-deep-research",
      },
      sources: Array.from(new Set(sources)),
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    console.log(`[DeepResearchAgent] Error: ${error.message}`);
    return {
      agentName: "DeepResearchAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

// Playwright Agent - Browser automation for JavaScript-rendered pages
async function playwrightAgent(companyName: string, websiteUrl?: string): Promise<AgentResult> {
  const startTime = Date.now();
  const sources: string[] = [];
  
  try {
    console.log(`[PlaywrightAgent] Starting browser automation for: ${companyName}`);
    
    const { getPageContent } = await import("../browser-helper");
    const cheerio = await import("cheerio");
    
    const extractedData: any = {
      pages: [],
      leadership: [],
      contactInfo: {},
      socialLinks: {},
    };
    
    if (websiteUrl) {
      try {
        const html = await getPageContent(websiteUrl, { waitMs: 3000 });
        const $ = cheerio.load(html);
        sources.push(websiteUrl);
        
        const bodyText = $('body').text().slice(0, 5000);
        const htmlContent = $.html() || '';
        const emailMatches = htmlContent.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
        const phoneMatches = htmlContent.match(/\+?[\d\s()-]{10,}/g) || [];
        
        const links: Array<{text: string; href: string}> = [];
        $('a[href]').each((i, a) => {
          if (i >= 50) return;
          links.push({ text: ($(a).text() || '').trim(), href: $(a).attr('href') || '' });
        });
        
        const mainPageData = {
          title: $('title').text() || '',
          description: $('meta[name="description"]').attr('content') || '',
          h1: $('h1').first().text().trim(),
          bodyText,
          links,
          socialLinks: {
            linkedin: $('a[href*="linkedin.com"]').attr('href') || '',
            twitter: $('a[href*="twitter.com"], a[href*="x.com"]').attr('href') || '',
            facebook: $('a[href*="facebook.com"]').attr('href') || '',
            instagram: $('a[href*="instagram.com"]').attr('href') || '',
          },
          emails: emailMatches,
          phones: phoneMatches.map((m: string) => m.trim()),
        };
        
        extractedData.mainPage = mainPageData;
        extractedData.socialLinks = mainPageData.socialLinks;
        extractedData.contactInfo.emails = mainPageData.emails;
        extractedData.contactInfo.phones = mainPageData.phones;
        
        const teamPageUrls = mainPageData.links
          .filter((l: any) => l.href && /about|team|leadership|management|board|executivesTable/i.test(l.href + l.text))
          .map((l: any) => l.href)
          .slice(0, 3);
        
        for (const teamUrl of teamPageUrls) {
          try {
            const fullUrl = teamUrl.startsWith('http') ? teamUrl : new URL(teamUrl, websiteUrl).href;
            const teamHtml = await getPageContent(fullUrl, { waitMs: 2000 });
            const $t = cheerio.load(teamHtml);
            sources.push(fullUrl);
            
            const images: Array<{src: string; alt: string}> = [];
            $t('img').each((i, img) => {
              if (i >= 20) return;
              images.push({ src: $t(img).attr('src') || '', alt: $t(img).attr('alt') || '' });
            });
            
            extractedData.pages.push({
              url: fullUrl,
              title: $t('title').text() || '',
              content: $t('body').text().slice(0, 10000),
              images,
            });
          } catch (e) {
            console.log(`[PlaywrightAgent] Failed to crawl ${teamUrl}`);
          }
        }
      } catch (e: any) {
        console.log(`[PlaywrightAgent] Website crawl error: ${e.message}`);
      }
    }
    
    try {
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(companyName + " Saudi Arabia company")}`;
      const googleHtml = await getPageContent(googleUrl, { waitMs: 2000 });
      const $g = cheerio.load(googleHtml);
      
      const searchResults: Array<{title: string; url: string; snippet: string}> = [];
      $g('.g').each((i, el) => {
        if (i >= 10) return;
        searchResults.push({
          title: $g(el).find('h3').text() || '',
          url: $g(el).find('a').attr('href') || '',
          snippet: $g(el).find('.VwiC3b').text() || '',
        });
      });
      
      extractedData.googleResults = searchResults;
      sources.push(...searchResults.map((r: any) => r.url).filter(Boolean).slice(0, 5));
    } catch (e) {
      console.log(`[PlaywrightAgent] Google search failed`);
    }
    
    console.log(`[PlaywrightAgent] Crawled ${sources.length} pages`);
    
    return {
      agentName: "PlaywrightAgent",
      status: sources.length > 0 ? "success" : "partial",
      data: extractedData,
      sources: Array.from(new Set(sources)),
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    console.log(`[PlaywrightAgent] Error: ${error.message}`);
    return {
      agentName: "PlaywrightAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function webSearchAgent(companyName: string, websiteUrl?: string): Promise<AgentResult> {
  const startTime = Date.now();

  try {
    if (!isGeminiConfigured()) {
      return {
        agentName: "WebSearchAgent",
        status: "failed",
        data: null,
        sources: [],
        executionTimeMs: Date.now() - startTime,
        error: "Gemini API key not configured",
      };
    }

    console.log(`[WebSearchAgent] Searching Google (via Gemini) for: ${companyName}`);

    // Run 3 parallel Google searches via Gemini grounding
    const [companyResult, executiveResult, newsResult] = await Promise.allSettled([
      searchWithGemini(`${companyName} Saudi Arabia company profile revenue employees headquarters LinkedIn`),
      searchWithGemini(`${companyName} CEO CFO chairman executivesTable board directors Saudi Arabia`),
      searchWithGemini(`${companyName} Saudi Arabia news 2024 2025 recent developments`),
    ]);

    const googleData: any = { company: null, executivesTable: null, news: null, sources: [] };

    if (companyResult.status === "fulfilled" && companyResult.value) {
      googleData.company = companyResult.value;
    }
    if (executiveResult.status === "fulfilled" && executiveResult.value) {
      googleData.executivesTable = executiveResult.value;
    }
    if (newsResult.status === "fulfilled" && newsResult.value) {
      googleData.news = newsResult.value;
    }

    // Try LinkedIn via Playwright as a bonus
    let linkedinData: any = null;
    try {
      const linkedInUrl = `https://www.linkedin.com/company/${encodeURIComponent(companyName.toLowerCase().replace(/\s+/g, "-"))}/about/`;
      const linkedInHtml = await getPageContent(linkedInUrl, { waitMs: 4000 });
      if (linkedInHtml && linkedInHtml.length > 500) {
        const { load } = await (import("cheerio") as Promise<any>);
        const $ = load(linkedInHtml);
        linkedinData = {
          description: $('[data-test-id="about-us__description"], .org-about-us-organization-description').text().trim().substring(0, 2000),
          industry: $('[data-test-id="about-us__industry"]').text().trim(),
          employees: $('[data-test-id="about-us__size"]').text().trim(),
        };
        googleData.sources.push(linkedInUrl);
      }
    } catch (_) {}

    const hasData = googleData.company || googleData.executivesTable;

    return {
      agentName: "WebSearchAgent",
      status: hasData ? "success" : "partial",
      data: { ...googleData, linkedin: linkedinData },
      sources: Array.from(new Set(googleData.sources)),
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      agentName: "WebSearchAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

// Crawl4AI Agent - Built-in AI-ready markdown extraction (Playwright + Turndown, no Apify needed)
async function crawl4aiAgent(companyName: string, websiteUrl?: string): Promise<AgentResult> {
  const startTime = Date.now();

  try {
    console.log(`[Crawl4AIAgent] Starting built-in Crawl4AI engine for: ${companyName}`);

    if (!websiteUrl) {
      // Try to find the website via Gemini search first
      if (isGeminiConfigured()) {
        const searchResult = await searchWithGemini(`${companyName} Saudi Arabia official website URL`);
        const urlMatch = (typeof searchResult === "string" ? searchResult : "").match(/https?:\/\/[^\s)>"]+/);
        if (urlMatch) websiteUrl = urlMatch[0];
      }

      if (!websiteUrl) {
        return {
          agentName: "Crawl4AIAgent",
          status: "partial",
          data: null,
          sources: [],
          executionTimeMs: Date.now() - startTime,
          error: "No website URL available to crawl",
        };
      }
    }

    // Build list of company pages to crawl
    const baseUrl = websiteUrl.replace(/\/$/, "");
    const urlsToCrawl = [
      websiteUrl,
      `${baseUrl}/about`,
      `${baseUrl}/about-us`,
      `${baseUrl}/team`,
      `${baseUrl}/leadership`,
      `${baseUrl}/management`,
      `${baseUrl}/executivesTable`,
      `${baseUrl}/contact`,
      `${baseUrl}/investors`,
      `${baseUrl}/investor-relations`,
    ];

    console.log(`[Crawl4AIAgent] Crawling ${urlsToCrawl.length} company pages with Crawl4AI engine...`);

    const c4Results = await crawl4aiBatch(urlsToCrawl, { waitMs: 4000, concurrency: 3 });
    const successfulPages = c4Results.filter((r): r is NonNullable<typeof r> & { success: true } => !!(r?.success && r?.markdown && r.markdown.length > 100));

    console.log(`[Crawl4AIAgent] Crawled ${successfulPages.length}/${urlsToCrawl.length} pages successfully`);

    if (successfulPages.length === 0) {
      return {
        agentName: "Crawl4AIAgent",
        status: "partial",
        data: null,
        sources: [],
        executionTimeMs: Date.now() - startTime,
        error: "No pages crawled successfully",
      };
    }

    // Combine all extracted data
    const allEmails = Array.from(new Set(successfulPages.flatMap((p) => p.emails)));
    const allPhones = Array.from(new Set(successfulPages.flatMap((p) => p.phones)));
    const allTables = successfulPages.flatMap((p) => p.tables);

    // Aggregate all text for pattern extraction
    const allMarkdown = successfulPages.map((p) => `## ${p.title}\n\n${p.markdown}`).join("\n\n---\n\n");

    const extractedData = {
      pages: successfulPages.map((p) => ({
        url: p.url,
        title: p.title,
        markdown: p.markdown,
        headings: p.headings,
        wordCount: p.metadata.wordCount,
      })),
      contactInfo: extractContactPatterns(successfulPages.map((p) => ({
        text: p.extractedText,
        emails: p.emails,
        phones: p.phones,
      }))),
      teamMentions: extractTeamMentions(successfulPages.map((p) => ({
        text: p.extractedText,
        markdown: p.markdown,
      }))),
      financialMentions: extractFinancialPatterns(successfulPages.map((p) => ({
        text: p.extractedText,
      }))),
      allEmails,
      allPhones,
      allTables: allTables.slice(0, 20),
      combinedMarkdown: allMarkdown.substring(0, 50000),
    };

    return {
      agentName: "Crawl4AIAgent",
      status: "success",
      data: extractedData,
      sources: successfulPages.map((p) => p.url),
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    console.error(`[Crawl4AIAgent] Error: ${error.message}`);
    return {
      agentName: "Crawl4AIAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

// Helper functions for Crawl4AI data extraction
function extractContactPatterns(pages: any[]): any {
  const contacts: any = {
    emails: [],
    phones: [],
    addresses: [],
  };
  
  for (const page of pages) {
    const content = page.markdown || page.text || page.content || '';
    
    // Extract emails
    const emailMatches = content.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
    contacts.emails.push(...emailMatches);
    
    // Extract Saudi phone numbers
    const phoneMatches = content.match(/\+966[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}/g) || [];
    contacts.phones.push(...phoneMatches);
    
    // Extract addresses with Saudi cities
    const addressPatterns = content.match(/(?:Riyadh|Jeddah|Dammam|Mecca|Medina|Khobar)[^.]*(?:Saudi Arabia|KSA)/gi) || [];
    contacts.addresses.push(...addressPatterns);
  }
  
  return {
    emails: Array.from(new Set(contacts.emails as string[])),
    phones: Array.from(new Set(contacts.phones as string[])),
    addresses: Array.from(new Set(contacts.addresses as string[])),
  };
}

function extractTeamMentions(pages: any[]): string[] {
  const teamMentions: string[] = [];
  const titlePatterns = /(?:CEO|CFO|COO|CTO|CMO|Chairman|President|Director|VP|Vice President|Managing Director|General Manager|Founder|Co-Founder)/gi;
  
  for (const page of pages) {
    const content = page.markdown || page.text || page.content || '';
    const sentences = content.split(/[.!?]/);
    
    for (const sentence of sentences) {
      if (titlePatterns.test(sentence)) {
        teamMentions.push(sentence.trim());
      }
    }
  }
  
  return teamMentions.slice(0, 20);
}

function extractFinancialPatterns(pages: any[]): string[] {
  const financialMentions: string[] = [];
  const patterns = /(?:SAR|SR|revenue|profit|income|billion|million|growth|market\s*cap|valuation)[^.]*\d+[^.]*/gi;
  
  for (const page of pages) {
    const content = page.markdown || page.text || page.content || '';
    const matches = content.match(patterns) || [];
    financialMentions.push(...matches);
  }
  
  return Array.from(new Set(financialMentions)).slice(0, 15);
}

async function apolloAgent(companyName: string, websiteUrl?: string): Promise<AgentResult> {
  const startTime = Date.now();
  const sources: string[] = ["Apollo.io"];
  
  try {
    if (!APOLLO_API_KEY) {
      return {
        agentName: "ApolloAgent",
        status: "failed",
        data: null,
        sources: [],
        executionTimeMs: Date.now() - startTime,
        error: "Apollo API key not configured",
      };
    }
    
    // Extract domain from websiteUrl if provided (PRIORITY: domain search is more accurate)
    let domain: string | undefined;
    if (websiteUrl) {
      try {
        const url = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
        domain = url.hostname.replace(/^www\./, '');
        console.log(`[ApolloAgent] Extracted domain: ${domain} from ${websiteUrl}`);
      } catch (e) {
        console.log(`[ApolloAgent] Could not parse URL: ${websiteUrl}`);
      }
    }
    
    console.log(`[ApolloAgent] Searching by ${domain ? 'DOMAIN: ' + domain : 'NAME: ' + companyName}`);
    
    let companyData: any = null;
    let executivesTable: any[] = [];
    let enrichedCompany: any = null;
    
    // FIRST: Try to search/enrich by domain (more accurate for website-based searches)
    if (domain) {
      try {
        const enrichResponse = await withTimeout(
          fetch("https://api.apollo.io/v1/organizations/enrich", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": APOLLO_API_KEY,
            },
            body: JSON.stringify({ domain }),
          }),
          15000,
          "Apollo domain enrich timeout"
        );
        
        if (enrichResponse.ok) {
          const enrichData = await enrichResponse.json();
          if (enrichData.organization) {
            enrichedCompany = enrichData.organization;
            companyData = enrichedCompany;
            console.log(`[ApolloAgent] Found company by DOMAIN: ${companyData.name}`);
          }
        }
      } catch (e) {
        console.log("[ApolloAgent] Domain enrich failed, falling back to name search...");
      }
    }
    
    // FALLBACK: Search by name if domain search didn't find anything
    if (!companyData) {
      const orgResponse = await withTimeout(
        fetch("https://api.apollo.io/v1/organizations/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": APOLLO_API_KEY,
          },
          body: JSON.stringify({
            q_organization_name: companyName,
            per_page: 5,
          }),
        }),
        15000,
        "Apollo org search timeout"
      );
      
      if (orgResponse.ok) {
        const orgData = await orgResponse.json();
        companyData = orgData.organizations?.[0];
        
        console.log(`[ApolloAgent] Found company by NAME: ${companyData?.name || 'Not found'}`);
      }
    }
    
    // If we have company data, search for executivesTable
    if (companyData) {
      console.log(`[ApolloAgent] Company data keys: ${Object.keys(companyData || {}).join(', ')}`);
      
      const searchDomain = companyData.primary_domain || domain;
      if (searchDomain) {
        // Search for executivesTable with expanded criteria
        const peopleResponse = await withTimeout(
          fetch("https://api.apollo.io/v1/people/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": APOLLO_API_KEY,
            },
            body: JSON.stringify({
              q_organization_domains: [searchDomain],
              person_seniorities: ["c_suite", "vp", "director", "owner", "founder", "partner", "manager"],
              per_page: 30,
            }),
          }),
          15000,
          "Apollo people search timeout"
        );
        
        if (peopleResponse.ok) {
          const peopleData = await peopleResponse.json();
          executivesTable = peopleData.people || [];
          console.log(`[ApolloAgent] Found ${executivesTable.length} executivesTable`);
        }
      }
    }
    
    // Merge enriched data with search data
    const finalCompanyData = enrichedCompany || companyData;
    
    return {
      agentName: "ApolloAgent",
      status: finalCompanyData ? "success" : "failed",
      data: {
        company: {
          // Core info
          name: finalCompanyData?.name,
          legalName: finalCompanyData?.name,
          primaryDomain: finalCompanyData?.primary_domain,
          website: finalCompanyData?.website_url || `https://${finalCompanyData?.primary_domain}`,
          logoUrl: finalCompanyData?.logo_url,
          
          // Location
          city: finalCompanyData?.city,
          state: finalCompanyData?.state,
          country: finalCompanyData?.country,
          rawAddress: finalCompanyData?.raw_address,
          streetAddress: finalCompanyData?.street_address,
          postalCode: finalCompanyData?.postal_code,
          
          // Industry
          industry: finalCompanyData?.industry,
          subIndustry: finalCompanyData?.subindustry || finalCompanyData?.sub_industry,
          industryTagId: finalCompanyData?.industry_tag_id,
          
          // Size & Financials - CRITICAL DATA
          employeeCount: finalCompanyData?.estimated_num_employees || finalCompanyData?.employee_count,
          annualRevenue: finalCompanyData?.annual_revenue || finalCompanyData?.estimated_annual_revenue,
          annualRevenueStr: finalCompanyData?.annual_revenue_printed,
          totalFunding: finalCompanyData?.total_funding || finalCompanyData?.total_funding_printed,
          latestFundingRound: finalCompanyData?.latest_funding_round_type,
          latestFundingAmount: finalCompanyData?.latest_funding_round_amount,
          
          // Social
          linkedinUrl: finalCompanyData?.linkedin_url,
          twitterUrl: finalCompanyData?.twitter_url,
          facebookUrl: finalCompanyData?.facebook_url,
          
          // Description
          description: finalCompanyData?.short_description || finalCompanyData?.seo_description,
          fullDescription: finalCompanyData?.long_description,
          
          // Tech & Keywords
          techStack: finalCompanyData?.technologies || finalCompanyData?.tech_stack,
          keywords: finalCompanyData?.keywords,
          specialities: finalCompanyData?.specialties,
          
          // Founding
          foundedYear: finalCompanyData?.founded_year,
          
          // Stock info if public
          stockTicker: finalCompanyData?.stock_symbol,
          stockExchange: finalCompanyData?.stock_exchange,
          marketCap: finalCompanyData?.market_cap,
          
          // All raw data for AI analysis
          rawData: finalCompanyData,
        },
        executivesTable: executivesTable.map((p: any) => ({
          name: p.name,
          firstName: p.first_name,
          lastName: p.last_name,
          title: p.title,
          headline: p.headline,
          email: p.email,
          phone: p.phone_numbers?.[0]?.sanitized_number || p.phone,
          linkedin: p.linkedin_url,
          seniority: p.seniority,
          departments: p.departments,
          city: p.city,
          country: p.country,
          photoUrl: p.photo_url,
          employmentHistory: p.employment_history,
          organization: p.organization,
        })),
        executiveCount: executivesTable.length,
      },
      sources,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    console.error("[ApolloAgent] Error:", error);
    return {
      agentName: "ApolloAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function exploriumAgent(companyName: string, websiteUrl?: string): Promise<AgentResult> {
  const startTime = Date.now();
  const sources: string[] = ["Explorium.ai"];
  
  try {
    if (!EXPLORIUM_API_KEY) {
      return {
        agentName: "ExploriumAgent",
        status: "failed",
        data: null,
        sources: [],
        executionTimeMs: Date.now() - startTime,
        error: "Explorium API key not configured",
      };
    }
    
    console.log(`[ExploriumAgent] Enriching: ${companyName}`);
    
    const domain = websiteUrl ? new URL(websiteUrl).hostname.replace("www.", "") : null;
    
    const response = await withTimeout(
      fetch(`${EXPLORIUM_BASE_URL}/companiesTable`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${EXPLORIUM_API_KEY}`,
        },
        body: JSON.stringify({
          company_name: companyName,
          company_domain: domain,
          country: "Saudi Arabia",
        }),
      }),
      20000,
      "Explorium API timeout"
    );
    
    if (!response.ok) {
      throw new Error(`Explorium API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      agentName: "ExploriumAgent",
      status: data ? "success" : "partial",
      data: {
        firmographics: data,
      },
      sources,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      agentName: "ExploriumAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function openaiAnalysisAgent(
  companyName: string,
  aggregatedData: any
): Promise<AgentResult> {
  const startTime = Date.now();
  
  try {
    console.log(`[OpenAIAgent] Generating comprehensive analysis for ${companyName}`);
    
    const prompt = `You are an expert business intelligence analyst. Analyze the following raw data collected about ${companyName} and generate a comprehensive, structured company report.

RAW DATA FROM MULTIPLE SOURCES:
${JSON.stringify(aggregatedData, null, 2)}

Generate a comprehensive JSON report. Extract ALL available data from the sources. This is for a Saudi business intelligence platform - extract Arabic names alongside English names. Include specific numbers, dates, and verified facts.

REQUIRED OUTPUT STRUCTURE:
{
  "companyName": "Official company name in English",
  "arabicName": "Official company name in Arabic (الاسم بالعربية)",
  "profileSummary": "3-4 paragraph executive summary including business model, market position, and strategic outlook",
  
  "companyOverview": {
    "legalName": "Full legal registered name",
    "arabicName": "Legal name in Arabic",
    "founded": "Year founded",
    "founders": [
      {
        "name": "Founder English name",
        "arabicName": "Founder Arabic name",
        "bio": "Founder background and other ventures",
        "currentRole": "Current role in company",
        "netWorth": "Estimated net worth if available"
      }
    ],
    "headquarters": {
      "address": "Full street address with building number",
      "city": "City name",
      "country": "Country",
      "postalCode": "Postal/ZIP code",
      "coordinates": "GPS coordinates if available"
    },
    "companyType": "Public/Private/Government/Family-owned",
    "industry": "Primary industry",
    "subIndustry": "Specific sector",
    "stockInfo": {
      "exchange": "TASI/Nomu if listed",
      "ticker": "Stock symbol",
      "marketCap": "Market capitalization in SAR",
      "currentPrice": "Current stock price",
      "52weekHigh": "52-week high",
      "52weekLow": "52-week low"
    },
    "registrationNumber": "Commercial Registration (CR) number",
    "website": "Official website URL"
  },
  
  "ownership": {
    "ownershipType": "Public/Private/Government/Mixed",
    "majorShareholders": [
      {
        "name": "Shareholder name in English",
        "arabicName": "Shareholder Arabic name",
        "percentage": "Ownership percentage",
        "type": "Individual/Institution/Government/Family"
      }
    ],
    "publicFloat": "Percentage of shares publicly traded",
    "governmentStake": "Government ownership percentage if any",
    "familyOwnership": "Family ownership details"
  },
  
  "financials": {
    "annualRevenue": "Annual revenue with SAR currency",
    "revenueGrowth": "Year-over-year growth percentage",
    "netIncome": "Net income/profit with SAR currency",
    "profitMargin": "Net profit margin percentage",
    "grossMargin": "Gross margin percentage",
    "operatingIncome": "Operating income",
    "totalAssets": "Total assets value",
    "totalLiabilities": "Total liabilities",
    "equity": "Shareholders equity",
    "debtToEquity": "Debt to equity ratio",
    "marketCap": "Market capitalization if public",
    "fiscalYear": "Latest fiscal year end",
    "revenueHistory": [
      {"year": "Year", "revenue": "Revenue", "growth": "Growth %"}
    ]
  },
  
  "workforce": {
    "totalEmployees": "Total number of employees",
    "employeeGrowth": "Year-over-year employee growth",
    "saudiNationals": "Number of Saudi national employees",
    "saudizationRate": "Saudization/Nitaqat percentage",
    "departments": ["List of major departments"],
    "avgTenure": "Average employee tenure"
  },
  
  "leadership": {
    "ceo": {
      "name": "CEO name in English",
      "arabicName": "CEO name in Arabic",
      "bio": "Detailed biography including education and career history",
      "education": "Educational background",
      "previousRoles": ["Previous positions"],
      "estimatedCompensation": "Estimated annual salary/compensation in SAR",
      "linkedin": "LinkedIn URL",
      "email": "Email if available"
    },
    "chairman": {
      "name": "Chairman name",
      "arabicName": "Arabic name",
      "bio": "Detailed biography",
      "otherRoles": ["Other board seats"],
      "estimatedCompensation": "Estimated compensation"
    },
    "cfo": {
      "name": "CFO name",
      "arabicName": "Arabic name",
      "bio": "Biography",
      "estimatedCompensation": "Estimated compensation"
    },
    "executiveTeam": [
      {
        "name": "Executive name",
        "arabicName": "Arabic name",
        "title": "Position title",
        "department": "Department",
        "bio": "Background",
        "estimatedCompensation": "Estimated salary range",
        "linkedin": "LinkedIn URL",
        "email": "Email"
      }
    ],
    "boardOfDirectors": [
      {
        "name": "Board member name",
        "arabicName": "Arabic name",
        "role": "Role (Independent/Executive/Non-Executive)",
        "committee": "Committee memberships",
        "bio": "Background and expertise",
        "otherBoards": ["Other board positions"],
        "aiAnalysis": "AI analysis of this board member's strategic value"
      }
    ]
  },
  
  "locations": {
    "headquarters": {
      "name": "Headquarters name",
      "address": "Full street address with building/tower name",
      "city": "City",
      "region": "Region/Province",
      "country": "Saudi Arabia",
      "phone": "Phone number",
      "fax": "Fax number",
      "email": "Office email"
    },
    "branches": [
      {
        "name": "Branch/Office name",
        "type": "Regional Office/Branch/Warehouse/Factory",
        "address": "Full address",
        "city": "City",
        "country": "Country",
        "phone": "Phone number",
        "employees": "Number of employees at this location"
      }
    ],
    "internationalOffices": ["List of countries with offices"],
    "operatingRegions": ["List of operating regions in Saudi Arabia"]
  },
  
  "contactInfo": {
    "mainPhone": "Main phone number",
    "customerService": "Customer service number",
    "email": "General email",
    "website": "Website URL",
    "investorRelations": {
      "phone": "IR phone",
      "email": "IR email",
      "contact": "IR contact person"
    },
    "mediaContact": {
      "phone": "Media phone",
      "email": "Media email"
    }
  },
  
  "socialMedia": {
    "linkedin": {"url": "LinkedIn URL", "followers": "Follower count"},
    "twitter": {"url": "Twitter/X URL", "followers": "Follower count"},
    "facebook": {"url": "Facebook URL", "followers": "Follower count"},
    "instagram": {"url": "Instagram URL", "followers": "Follower count"},
    "youtube": {"url": "YouTube URL", "subscribers": "Subscriber count"},
    "tiktok": {"url": "TikTok URL", "followers": "Follower count"}
  },
  
  "productsAndServices": {
    "mainProducts": ["List of main products with descriptions"],
    "mainServices": ["List of main services with descriptions"],
    "revenueStreams": ["Revenue stream 1 - X% of revenue", "Revenue stream 2 - Y%"],
    "targetMarkets": ["Target market segments"],
    "competitiveAdvantage": "Key competitive advantages"
  },
  
  "competitiveLandscape": {
    "directCompetitors": [
      {
        "name": "Competitor name",
        "comparison": "How they compare (size, market share, strengths)",
        "marketShare": "Estimated market share"
      }
    ],
    "marketPosition": "Company's market position",
    "marketShare": "Company's estimated market share",
    "industryRanking": "Ranking in industry"
  },
  
  "swotAnalysis": {
    "strengths": ["List of strengths with explanations"],
    "weaknesses": ["List of weaknesses with explanations"],
    "opportunities": ["List of opportunities with explanations"],
    "threats": ["List of threats with explanations"]
  },
  
  "vision2030Alignment": {
    "relevantPillars": ["Relevant Vision 2030 pillars"],
    "initiatives": ["Related government initiatives"],
    "governmentContracts": "Government contracts if any",
    "alignmentScore": "AI assessment of Vision 2030 alignment (1-10)"
  },
  
  "aiAnalysis": {
    "investmentOutlook": "AI analysis of investment potential",
    "growthPotential": "Growth potential assessment",
    "riskFactors": ["Key risk factors"],
    "strategicRecommendations": ["Strategic recommendations"],
    "partnershipOpportunities": "Potential partnership opportunities",
    "founderAnalysis": "AI analysis of founder/founding team if available",
    "boardEffectiveness": "AI assessment of board composition and effectiveness",
    "managementQuality": "AI assessment of management team quality"
  },
  
  "keyInsights": ["5-7 strategic insights about the company"],
  "recommendations": ["3-5 actionable business recommendations"],
  "recentNews": ["Recent news headlines about the company"]
}

CRITICAL INSTRUCTIONS:
- Extract ALL data that exists in the sources - do not skip any available information
- Arabic names MUST be preserved exactly as found (الاسم بالعربية)
- For Saudi executivesTable, search for common Arabic names (عبدالمحسن، محمد، عبدالله، خالد، etc.)
- Include specific SAR amounts for all financial figures
- Estimate executive salaries based on company size and industry benchmarks if not directly available
- List ALL office locations and addresses found
- Include ALL shareholders and ownership percentages
- Extract founder information with Arabic names
- Generate AI analysis sections using available data
- For missing data, use null - never fabricate information
- Ensure all URLs are complete and valid`;

    const COMPANY_SYSTEM = "You are an expert Saudi Arabia business intelligence analyst. Output valid JSON only. Extract maximum detail from all provided sources.";

    const [gptRes, claudeRes, geminiRes] = await Promise.allSettled([
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: COMPANY_SYSTEM },
          { role: "user", content: prompt }
        ],
        max_completion_tokens: 4000,
        response_format: { type: "json_object" },
      }).then(r => r.choices[0]?.message?.content || "{}"),
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: COMPANY_SYSTEM + " Return ONLY valid JSON.",
        messages: [{ role: "user", content: prompt }],
      }).then(r => r.content[0]?.type === "text" ? r.content[0].text : "{}").catch(() => "{}"),
      isGeminiConfigured()
        ? synthesizeWithGemini(prompt, COMPANY_SYSTEM + " Return ONLY valid JSON matching the schema.", "gemini-2.5-pro")
        : Promise.resolve(null),
    ]);

    const rawGpt = gptRes.status === "fulfilled" ? gptRes.value : null;
    const rawClaude = claudeRes.status === "fulfilled" ? claudeRes.value : null;
    const rawGemini = geminiRes.status === "fulfilled" && geminiRes.value ? geminiRes.value : null;

    const sourcesUsed: string[] = [];
    if (rawGpt) sourcesUsed.push("OpenAI GPT-4o");
    if (rawClaude) sourcesUsed.push("Claude Sonnet");
    if (rawGemini) sourcesUsed.push("Gemini 2.5 Pro");

    // Merge: Gemini (1st) → Claude (2nd) → GPT-4o (3rd)
    let merged: Record<string, unknown> = {};
    for (const raw of [rawGemini, rawClaude, rawGpt].filter(Boolean)) {
      try {
        const match = (raw as string).match(/\{[\s\S]*\}/);
        const parsed = match ? JSON.parse(match[0]) : {};
        for (const [k, v] of Object.entries(parsed)) {
          if (v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) {
            if (!merged[k]) merged[k] = v;
          }
        }
      } catch { /* ignore */ }
    }
    if (Object.keys(merged).length === 0) merged = JSON.parse(rawGemini || rawClaude || rawGpt || "{}");

    const analysisResult = merged;
    
    return {
      agentName: "MultiAIAnalysisAgent",
      status: "success",
      data: analysisResult,
      sources: sourcesUsed,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    console.error("[MultiAIAgent] Analysis failed:", error);
    return {
      agentName: "MultiAIAnalysisAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

export async function orchestrateCompanyEnrichment(
  companyName: string,
  websiteUrl?: string
): Promise<OrchestratedReport> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[Orchestra] Starting multi-agent enrichment for: ${companyName}`);
  console.log(`[Orchestra] Website: ${websiteUrl || "Not provided"}`);
  console.log(`${"=".repeat(60)}\n`);
  
  const startTime = Date.now();
  
  console.log("[Orchestra] Phase 1: Deploying ALL 8 agents in parallel...");
  console.log("  - PerplexityAgent: Deep web research with citations");
  console.log("  - CrawlerAgent: Basic website crawling");
  console.log("  - WebSearchAgent: Google Search via Gemini grounding + LinkedIn");
  console.log("  - ApolloAgent: Company & executive database");
  console.log("  - ExploriumAgent: Firmographic enrichment");
  console.log("  - DeepResearchAgent: OpenAI Deep Research (o4-mini)");
  console.log("  - PlaywrightAgent: Dynamic page rendering");
  console.log("  - Crawl4AIAgent: AI-ready markdown extraction (built-in engine)");

  const agentPromises = [
    perplexityAgent(companyName, websiteUrl),
    websiteUrl ? crawlerAgent(websiteUrl) : Promise.resolve({
      agentName: "CrawlerAgent",
      status: "failed" as const,
      data: null,
      sources: [],
      executionTimeMs: 0,
      error: "No website URL provided"
    }),
    webSearchAgent(companyName, websiteUrl),
    apolloAgent(companyName, websiteUrl),
    exploriumAgent(companyName, websiteUrl),
    deepResearchAgent(companyName, websiteUrl),
    playwrightAgent(companyName, websiteUrl),
    crawl4aiAgent(companyName, websiteUrl),
    // Gemini deep research agent with live Google Search grounding
    (async (): Promise<AgentResult> => {
      const t = Date.now();
      try {
        if (!isGeminiConfigured()) throw new Error("Gemini not configured");
        const result = await deepResearchWithGemini(
          `Saudi Arabia company "${companyName}" - provide financials, ownership structure, key executives, CR number, founding year, address, recent news, industry sector`,
          "You are a Saudi Arabia B2B intelligence analyst. Search the web for current, factual information about this company.",
          "gemini-2.5-pro"
        );
        if (!result?.text) throw new Error("No result");
        return { agentName: "GeminiDeepResearchAgent", status: "success", data: { text: result.text, sources: result.groundingChunks }, sources: result.groundingChunks, executionTimeMs: Date.now() - t };
      } catch (e) {
        return { agentName: "GeminiDeepResearchAgent", status: "failed", data: null, sources: [], executionTimeMs: Date.now() - t, error: String(e) };
      }
    })(),
  ];

  const agentResults = await Promise.allSettled(agentPromises);

  const agentNames = ["Perplexity", "Crawler", "WebSearch", "Apollo", "Explorium", "DeepResearch", "Playwright", "Crawl4AI"];
  const successfulResults: AgentResult[] = agentResults
    .map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        agentName: agentNames[index] + "Agent",
        status: "failed" as const,
        data: null,
        sources: [],
        executionTimeMs: 0,
        error: result.reason?.message || "Unknown error"
      };
    });
  
  console.log("\n[Orchestra] Phase 1 Results:");
  successfulResults.forEach(r => {
    console.log(`  - ${r.agentName}: ${r.status} (${r.executionTimeMs}ms)`);
  });
  
  console.log("\n[Orchestra] Phase 2: Extracting REAL data from ALL 8 agent responses...");
  
  // Get REAL data from EACH agent
  const apolloData = successfulResults.find(r => r.agentName === "ApolloAgent")?.data;
  const perplexityData = successfulResults.find(r => r.agentName === "PerplexityAgent")?.data;
  const exploriumData = successfulResults.find(r => r.agentName === "ExploriumAgent")?.data;
  const crawlerData = successfulResults.find(r => r.agentName === "CrawlerAgent")?.data;
  const deepResearchData = successfulResults.find(r => r.agentName === "DeepResearchAgent")?.data;
  const playwrightData = successfulResults.find(r => r.agentName === "PlaywrightAgent")?.data;
  const apifyData = successfulResults.find(r => r.agentName === "ApifyAgent")?.data;
  const crawl4aiData = successfulResults.find(r => r.agentName === "Crawl4AIAgent")?.data;
  
  // Extract REAL Apollo company data
  const apolloCompany = apolloData?.company || {};
  const apolloExecutives = apolloData?.executivesTable || [];
  
  // Extract REAL Perplexity data
  const perplexityOwnership = perplexityData?.ownership || {};
  const perplexityFinancials = perplexityData?.financials || {};
  const perplexityLeadership = perplexityData?.leadership || {};
  const perplexitySocial = perplexityData?.socialMedia || {};
  const perplexityProducts = perplexityData?.productsAndServices || {};
  
  // Extract REAL Explorium data
  const exploriumCompany = exploriumData?.firmographics || exploriumData?.company || {};
  
  // Extract REAL Apify/LinkedIn data
  const linkedinData = apifyData?.linkedin || {};
  const googleResults = apifyData?.googleResults || [];
  
  // Extract REAL Crawl4AI data
  const crawl4aiPages = crawl4aiData?.pages || [];
  const crawl4aiContacts = crawl4aiData?.contactInfo || {};
  const crawl4aiTeam = crawl4aiData?.teamMentions || [];
  const crawl4aiFinancial = crawl4aiData?.financialMentions || [];
  
  // Extract REAL DeepResearch data
  const deepResearchContent = deepResearchData?.research || deepResearchData?.content || "";
  const deepResearchCitations = deepResearchData?.citations || [];
  
  // Extract REAL Playwright data
  const playwrightContacts = playwrightData?.contactInfo || {};
  const playwrightSocial = playwrightData?.socialLinks || {};
  
  // Extract REAL Crawler data (GPT-4o extracted from website)
  const crawlerCompany = crawlerData || {};
  const crawlerExecutives = crawlerData?.executivesTable || [];
  const crawlerBoard = crawlerData?.boardMembers || [];
  const crawlerProducts = crawlerData?.products || [];
  const crawlerLocations = crawlerData?.locations || [];
  const crawlerSocialLinks = crawlerData?.socialLinks || {};
  
  // Log what we found from EACH agent
  console.log(`\n[Orchestra] === REAL DATA EXTRACTED FROM EACH AGENT ===`);
  console.log(`[Apollo] Company: ${apolloCompany.name || 'Not found'}`);
  console.log(`[Apollo] Employees: ${apolloCompany.employeeCount || 'N/A'}, Revenue: ${apolloCompany.annualRevenueStr || apolloCompany.annualRevenue || 'N/A'}`);
  console.log(`[Apollo] Executives found: ${apolloExecutives.length}`);
  apolloExecutives.slice(0, 5).forEach((e: any) => {
    console.log(`  - ${e.name}: ${e.title} (${e.email || 'No email'})`);
  });
  console.log(`[Perplexity] Ownership data: ${Object.keys(perplexityOwnership).length} fields`);
  console.log(`[Perplexity] Financials: ${Object.keys(perplexityFinancials).length} fields`);
  console.log(`[Explorium] Firmographics: ${Object.keys(exploriumCompany).length} fields`);
  console.log(`[Apify] LinkedIn data: ${Object.keys(linkedinData).length} fields`);
  console.log(`[Apify] Google results: ${googleResults.length} results`);
  console.log(`[Crawl4AI] Pages crawled: ${crawl4aiPages.length}`);
  console.log(`[Crawl4AI] Contacts found: ${crawl4aiContacts.emails?.length || 0} emails, ${crawl4aiContacts.phones?.length || 0} phones`);
  console.log(`[Crawl4AI] Team mentions: ${crawl4aiTeam.length}`);
  console.log(`[DeepResearch] Content length: ${deepResearchContent.length} chars`);
  console.log(`[DeepResearch] Citations: ${deepResearchCitations.length}`);
  console.log(`[Playwright] Contacts: ${playwrightContacts.phones?.length || 0} phones`);
  console.log(`[Playwright] Social links: ${Object.keys(playwrightSocial).length}`);
  console.log(`[Crawler] Company: ${crawlerCompany.companyName || 'Not found'}`);
  console.log(`[Crawler] Executives: ${crawlerExecutives.length}, Board: ${crawlerBoard.length}`);
  console.log(`[Crawler] Products: ${crawlerProducts.length}, Locations: ${crawlerLocations.length}`);
  console.log(`=`.repeat(60));
  
  // Build report DIRECTLY from REAL API data - NO AI GENERATION for facts
  const allSources = Array.from(new Set(successfulResults.flatMap(r => r.sources)));
  
  // Map Apollo executivesTable to leadership structure
  const executiveTeam = apolloExecutives.map((exec: any) => ({
    name: exec.name,
    arabicName: perplexityLeadership?.executivesTable?.find((e: any) => 
      e.name?.toLowerCase().includes(exec.name?.split(' ')[0]?.toLowerCase())
    )?.arabicName,
    title: exec.title,
    department: exec.departments?.[0],
    background: exec.headline,
    education: exec.education,
    previousRoles: exec.employmentHistory?.slice(0, 3).map((h: any) => `${h.title} at ${h.organization_name}`) || [],
    linkedin: exec.linkedin,
    email: exec.email,
    phone: exec.phone,
    estimatedCompensation: perplexityLeadership?.salaries?.find((s: any) => 
      s.title?.toLowerCase().includes(exec.title?.toLowerCase().split(' ')[0])
    )?.salary,
  }));
  
  // Find CEO, CFO, Chairman from executivesTable
  const ceo = apolloExecutives.find((e: any) => /ceo|chief executive/i.test(e.title));
  const cfo = apolloExecutives.find((e: any) => /cfo|chief financial/i.test(e.title));
  const chairman = apolloExecutives.find((e: any) => /chairman|chairperson/i.test(e.title));
  
  // Merge crawler executivesTable with Apollo if Apollo is missing
  const mergedExecutiveTeam = executiveTeam.length > 0 ? executiveTeam : 
    crawlerExecutives.map((e: any) => ({
      name: e.name,
      title: e.title,
      linkedin: e.linkedin,
      bio: e.bio || e.description || undefined,
      background: e.bio || e.description || undefined,
    }));
  
  // Build the report with REAL DATA FIRST, using crawler data as fallback
  const report: OrchestratedReport = {
    companyName: apolloCompany.name || crawlerCompany.companyName || perplexityData?.companyName || companyName,
    arabicName: crawlerCompany.arabicName || perplexityData?.arabicName || perplexityData?.companyOverview?.arabicName,
    englishName: apolloCompany.name || crawlerCompany.companyName || companyName,
    profileSummary: apolloCompany.fullDescription || apolloCompany.description || crawlerCompany.description || perplexityData?.summary,
    
    companyOverview: {
      legalName: apolloCompany.legalName || apolloCompany.name || crawlerCompany.companyName,
      arabicName: crawlerCompany.arabicName || perplexityData?.arabicName,
      founded: apolloCompany.foundedYear?.toString() || crawlerCompany.foundedYear,
      founders: perplexityData?.founders || [],
      headquarters: {
        address: apolloCompany.streetAddress || apolloCompany.rawAddress || crawlerCompany.headquarters,
        city: apolloCompany.city,
        country: apolloCompany.country || "Saudi Arabia",
        postalCode: apolloCompany.postalCode,
      },
      companyType: perplexityOwnership?.ownershipType || "Private",
      industry: apolloCompany.industry || exploriumCompany.industry || crawlerCompany.industry,
      subIndustry: apolloCompany.subIndustry,
      stockInfo: apolloCompany.stockTicker ? {
        exchange: apolloCompany.stockExchange || "TASI",
        ticker: apolloCompany.stockTicker,
        marketCap: apolloCompany.marketCap,
      } : undefined,
      website: apolloCompany.website || apolloCompany.primaryDomain || websiteUrl,
    },
    
    financials: {
      revenue: apolloCompany.annualRevenueStr || apolloCompany.annualRevenue?.toString() || perplexityFinancials?.revenue,
      annualRevenue: apolloCompany.annualRevenueStr || perplexityFinancials?.annualRevenue,
      revenueGrowth: perplexityFinancials?.revenueGrowth,
      netIncome: perplexityFinancials?.netIncome,
      profitMargin: perplexityFinancials?.profitMargin,
      totalAssets: perplexityFinancials?.totalAssets,
      marketCap: apolloCompany.marketCap,
      revenueHistory: perplexityFinancials?.revenueHistory,
    },
    
    workforce: {
      totalEmployees: apolloCompany.employeeCount?.toString() || exploriumCompany.employeeCount || crawlerCompany.employeeCount,
      employeeGrowth: perplexityData?.workforce?.employeeGrowth,
      saudiNationals: perplexityData?.workforce?.saudiNationals,
      saudizationRate: perplexityData?.workforce?.saudizationRate,
    },
    
    leadership: {
      ceo: ceo ? {
        name: ceo.name,
        arabicName: perplexityLeadership?.ceo?.arabicName,
        bio: ceo.headline,
        linkedin: ceo.linkedin,
        email: ceo.email,
        estimatedCompensation: perplexityLeadership?.ceo?.salary,
      } : (crawlerExecutives.find((e: any) => /ceo|chief executive/i.test(e.title)) || perplexityLeadership?.ceo),
      cfo: cfo ? {
        name: cfo.name,
        bio: cfo.headline,
      } : crawlerExecutives.find((e: any) => /cfo|chief financial/i.test(e.title)),
      chairman: chairman ? {
        name: chairman.name,
        bio: chairman.headline,
      } : crawlerExecutives.find((e: any) => /chairman|chairperson/i.test(e.title)),
      executiveTeam: mergedExecutiveTeam,
      boardOfDirectors: perplexityLeadership?.boardOfDirectors?.length > 0 ? perplexityLeadership.boardOfDirectors : 
        crawlerBoard.map((b: any) => ({ name: b.name, role: b.title || b.role, title: b.title })),
    },
    
    locations: {
      headquarters: apolloCompany.streetAddress || crawlerCompany.headquarters || `${apolloCompany.city || ''}, ${apolloCompany.country || 'Saudi Arabia'}`.replace(/^, |, $/g, ''),
      branches: perplexityData?.locations?.branches?.length > 0 ? perplexityData.locations.branches : crawlerLocations,
      operatingRegions: perplexityData?.locations?.fullAddresses || [],
    },
    
    contactInfo: {
      website: apolloCompany.website || websiteUrl,
      email: apolloExecutives[0]?.email || crawlerCompany.email,
      phone: apolloExecutives[0]?.phone || playwrightData?.contactInfo?.phones?.[0] || crawlerCompany.phone,
      mainPhone: apolloCompany.rawAddress,
    },
    
    socialMedia: {
      linkedin: { url: apolloCompany.linkedinUrl || crawlerSocialLinks.linkedin, followers: perplexitySocial?.linkedin?.followers },
      twitter: { url: apolloCompany.twitterUrl || crawlerSocialLinks.twitter, followers: perplexitySocial?.twitter?.followers },
      facebook: { url: apolloCompany.facebookUrl || crawlerSocialLinks.facebook, followers: perplexitySocial?.facebook?.followers },
      instagram: { url: playwrightData?.socialLinks?.instagram || crawlerSocialLinks.instagram, followers: perplexitySocial?.instagram?.followers },
    },
    
    products: perplexityProducts?.products?.length > 0 ? perplexityProducts.products : crawlerProducts,
    services: perplexityProducts?.services || [],
    competitors: perplexityData?.competitors || [],
    
    ownership: {
      ownershipType: perplexityOwnership?.ownershipType,
      majorShareholders: perplexityOwnership?.majorShareholders || [],
      publicFloat: perplexityOwnership?.publicFloat,
      governmentStake: perplexityOwnership?.governmentStake,
      familyOwnership: perplexityOwnership?.familyOwnership,
    },
    
    productsAndServices: perplexityProducts,
    competitiveLandscape: perplexityData?.competitiveLandscape,
    vision2030Alignment: perplexityData?.vision2030Alignment,
    recentNews: perplexityData?.recentNews || [],
    
    keyInsights: [],
    recommendations: [],
    agentResults: successfulResults,
    dataSources: allSources,
    generatedAt: new Date().toISOString(),
  };
  
  // Phase 3: Use AI ONLY for analysis and insights (not for facts)
  console.log("[Orchestra] Phase 3: AI generating INSIGHTS only (facts already extracted)...");
  const aggregatedData = {
    apollo: apolloData,
    perplexity: perplexityData,
    explorium: exploriumData,
    deepResearch: deepResearchData,
  };
  
  const analysisResult = await openaiAnalysisAgent(companyName, aggregatedData);
  successfulResults.push(analysisResult);
  
  // Only add AI insights, don't overwrite real data
  const aiInsights = analysisResult.data || {};
  report.swotAnalysis = aiInsights.swotAnalysis;
  report.aiAnalysis = aiInsights.aiAnalysis;
  report.keyInsights = aiInsights.keyInsights || [];
  report.recommendations = aiInsights.recommendations || [];
  
  // Fill gaps with AI data if real data is missing
  if (!report.profileSummary) {
    report.profileSummary = aiInsights.profileSummary;
  }
  if (!report.ownership?.majorShareholders?.length) {
    report.ownership = aiInsights.ownership || report.ownership;
  }
  
  const totalTime = Date.now() - startTime;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[Orchestra] Enrichment complete in ${totalTime}ms`);
  console.log(`[Orchestra] Agents: ${successfulResults.filter(r => r.status === "success").length}/${successfulResults.length} successful`);
  console.log(`[Orchestra] Sources: ${allSources.length} unique sources`);
  console.log(`${"=".repeat(60)}\n`);
  
  return report;
}

export interface OrchestratedPersonReport {
  personName: string;
  arabicName?: string;
  profileSummary?: string;
  currentRole?: {
    title?: string;
    company?: string;
    department?: string;
    startDate?: string;
    responsibilities?: string[];
    estimatedCompensation?: string;
  };
  careerHistory?: Array<{
    title?: string;
    company?: string;
    duration?: string;
    description?: string;
    location?: string;
  }>;
  education?: Array<{
    degree?: string;
    institution?: string;
    year?: string;
    field?: string;
    honors?: string;
  }>;
  skills?: {
    technical?: string[];
    leadership?: string[];
    industry?: string[];
    languages?: string[];
  };
  boardPositions?: Array<{
    company?: string;
    role?: string;
    since?: string;
    aiAnalysis?: string;
  }>;
  certifications?: string[];
  awards?: Array<{
    title?: string;
    year?: string;
    organization?: string;
  }>;
  publications?: Array<{
    title?: string;
    year?: string;
    source?: string;
  }>;
  contactInfo?: {
    email?: string;
    phone?: string;
    linkedin?: string;
    twitter?: string;
  };
  socialProfiles?: {
    linkedin?: { url?: string; connections?: string };
    twitter?: { url?: string; followers?: string };
  };
  networkInsights?: {
    connections?: string;
    mutualContacts?: string[];
    influenceScore?: string;
  };
  aiAnalysis?: {
    leadershipStyle?: string;
    strengths?: string[];
    weaknesses?: string[];
    careerTrajectory?: string;
    recommendedApproach?: string;
    netWorthEstimate?: string;
  };
  keyInsights?: string[];
  recommendations?: string[];
  agentResults: AgentResult[];
  dataSources: string[];
  generatedAt: string;
}

async function perplexityPersonAgent(personName: string, company?: string): Promise<AgentResult> {
  const startTime = Date.now();
  const allSources: string[] = [];
  
  try {
    // 8 parallel research threads — all fire simultaneously
    const threads = [
      `Full professional biography of "${personName}"${company ? ` at ${company}` : ""} in Saudi Arabia: current role, responsibilities, notable achievements, career trajectory. Include Arabic name if available.`,
      `Complete career history of "${personName}"${company ? ` from ${company}` : ""}: all past companies, titles, dates, key accomplishments in each role, promotions, and career moves.`,
      `Board positions and advisory roles of "${personName}"${company ? ` from ${company}` : ""} Saudi Arabia: which company boards they sit on, committee memberships, government advisory panels, non-profit boards.`,
      `Education background of "${personName}"${company ? ` from ${company}` : ""}: universities attended, degrees, graduation years, international studies, fellowships, scholarships.`,
      `Wealth profile and financial indicators of "${personName}"${company ? ` at ${company}` : ""} Saudi Arabia: estimated net worth, salary, bonuses, equity stakes, known assets, investments, real estate holdings.`,
      `Compensation estimates for ${company ? `${company} ` : ""}${personName}: executive pay benchmarks for this role and seniority in Saudi Arabia, known salary disclosures, total compensation package.`,
      `Personal interests, hobbies, and public persona of "${personName}"${company ? ` from ${company}` : ""} Saudi Arabia: sports, philanthropy, public speaking, LinkedIn activity, awards, conference appearances.`,
      `Recent news and public statements about "${personName}"${company ? ` at ${company}` : ""} in 2024-2025: press releases, interviews, deal announcements, company milestones, regulatory filings, LinkedIn posts.`,
    ];

    const settled = await Promise.allSettled(
      threads.map(async (query, idx) => {
        const resp = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              { role: "system", content: "You are an executive research analyst for Saudi Arabia B2B intelligence. Provide verified, specific facts only. Use exact numbers, names, and dates. Never hallucinate." },
              { role: "user", content: query },
            ],
            max_tokens: 1500,
            temperature: 0.1,
            return_citations: true,
          }),
          signal: AbortSignal.timeout(25000),
        });
        if (!resp.ok) throw new Error(`Perplexity thread ${idx} HTTP ${resp.status}`);
        const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }>; citations?: string[] };
        if (data.citations) allSources.push(...data.citations);
        return { thread: idx, text: data.choices?.[0]?.message?.content || "" };
      })
    );

    const threadLabels = ["professional_background", "career_history", "board_memberships", "education", "wealth_profile", "compensation", "personal_interests", "recent_news"];
    const results: Record<string, string> = {};
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value.text) {
        results[threadLabels[r.value.thread]] = r.value.text;
      }
    }
    const successCount = Object.keys(results).length;

    return {
      agentName: "PerplexityPersonAgent",
      status: successCount > 0 ? "success" : "failed",
      data: { searchResults: results, threadCount: successCount },
      sources: Array.from(new Set(allSources)).slice(0, 20),
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      agentName: "PerplexityPersonAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function apolloPersonAgent(personName: string, company?: string): Promise<AgentResult> {
  const startTime = Date.now();
  const sources: string[] = ["Apollo.io"];
  
  try {
    if (!APOLLO_API_KEY) {
      return {
        agentName: "ApolloPersonAgent",
        status: "failed",
        data: null,
        sources: [],
        executionTimeMs: Date.now() - startTime,
        error: "Apollo API key not configured",
      };
    }
    
    console.log(`[ApolloPersonAgent] Searching for: ${personName}`);
    
    const response = await withTimeout(
      fetch("https://api.apollo.io/v1/people/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": APOLLO_API_KEY,
        },
        body: JSON.stringify({
          q_person_name: personName,
          q_organization_name: company,
          per_page: 5,
        }),
      }),
      15000,
      "Apollo person search timeout"
    );
    
    if (!response.ok) {
      throw new Error(`Apollo API error: ${response.status}`);
    }
    
    const data = await response.json();
    const person = data.people?.[0];
    
    return {
      agentName: "ApolloPersonAgent",
      status: person ? "success" : "partial",
      data: {
        person: person ? {
          name: person.name,
          title: person.title,
          company: person.organization?.name,
          email: person.email,
          phone: person.phone_numbers?.[0]?.sanitized_number,
          linkedin: person.linkedin_url,
          city: person.city,
          country: person.country,
          headline: person.headline,
          seniority: person.seniority,
          departments: person.departments,
          organization: person.organization,
        } : null,
      },
      sources,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      agentName: "ApolloPersonAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

// LinkedIn Profile Scraper Agent using Apify
async function linkedInProfileScraperAgent(linkedinUrl?: string): Promise<AgentResult> {
  const startTime = Date.now();
  const sources: string[] = [];
  
  try {
    if (!linkedinUrl) {
      return {
        agentName: "LinkedInScraperAgent",
        status: "failed",
        data: null,
        sources: [],
        executionTimeMs: Date.now() - startTime,
        error: "No LinkedIn URL provided",
      };
    }
    
    // Clean and validate LinkedIn URL
    let cleanUrl = linkedinUrl.trim();
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = 'https://' + cleanUrl;
    }
    
    // Ensure it's a LinkedIn URL
    if (!cleanUrl.includes('linkedin.com')) {
      return {
        agentName: "LinkedInScraperAgent",
        status: "failed",
        data: null,
        sources: [],
        executionTimeMs: Date.now() - startTime,
        error: "Not a valid LinkedIn URL",
      };
    }
    
    console.log(`[LinkedInScraperAgent] Scraping LinkedIn profile: ${cleanUrl}`);
    
    // Use Apify LinkedIn Profile Scraper
    const run = await runActor("anchor/linkedin-profile-scraper", {
      profileUrls: [cleanUrl],
      proxy: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
      },
    }, { waitForFinish: true, timeout: 120 });
    
    if (run.status !== "SUCCEEDED" || !run.datasetId) {
      console.log(`[LinkedInScraperAgent] Scrape status: ${run.status}`);
      return {
        agentName: "LinkedInScraperAgent",
        status: "partial",
        data: { profileUrl: cleanUrl, status: run.status },
        sources: [cleanUrl],
        executionTimeMs: Date.now() - startTime,
        error: `Scrape ended with status: ${run.status}`,
      };
    }
    
    const items = await getDatasetItems(run.datasetId);
    
    if (!items || items.length === 0) {
      return {
        agentName: "LinkedInScraperAgent",
        status: "partial",
        data: { profileUrl: cleanUrl },
        sources: [cleanUrl],
        executionTimeMs: Date.now() - startTime,
        error: "No profile data returned",
      };
    }
    
    const profileData = items[0];
    sources.push(cleanUrl);
    
    console.log(`[LinkedInScraperAgent] Successfully scraped profile for: ${profileData.firstName} ${profileData.lastName}`);
    
    return {
      agentName: "LinkedInScraperAgent",
      status: "success",
      data: {
        fullName: `${profileData.firstName || ''} ${profileData.lastName || ''}`.trim(),
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        headline: profileData.headline,
        summary: profileData.summary,
        location: profileData.location,
        profileUrl: cleanUrl,
        profilePicture: profileData.profilePicture,
        backgroundPicture: profileData.backgroundPicture,
        connections: profileData.connectionCount || profileData.connections,
        followers: profileData.followerCount || profileData.followers,
        currentCompany: profileData.currentCompany,
        experience: profileData.positions?.map((p: any) => ({
          title: p.title,
          company: p.companyName,
          location: p.location,
          startDate: p.startDate,
          endDate: p.endDate,
          description: p.description,
          duration: p.duration,
        })) || [],
        education: profileData.education?.map((e: any) => ({
          school: e.schoolName,
          degree: e.degree,
          field: e.fieldOfStudy,
          startYear: e.startDate,
          endYear: e.endDate,
        })) || [],
        skills: profileData.skills || [],
        languages: profileData.languages || [],
        certifications: profileData.certifications || [],
        honors: profileData.honorsAwards || [],
        volunteering: profileData.volunteer || [],
        websites: profileData.websites || [],
        email: profileData.email,
        phone: profileData.phone,
      },
      sources,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    console.error("[LinkedInScraperAgent] Error:", error);
    return {
      agentName: "LinkedInScraperAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function openaiPersonAnalysisAgent(
  personName: string,
  aggregatedData: any
): Promise<AgentResult> {
  const startTime = Date.now();
  
  try {
    console.log(`[OpenAIPersonAgent] Generating comprehensive person analysis for ${personName}`);
    
    const prompt = `You are an expert executive intelligence analyst. Analyze the following raw data about ${personName} and generate a comprehensive professional dossier.

RAW DATA FROM MULTIPLE SOURCES:
${JSON.stringify(aggregatedData, null, 2)}

Generate a detailed JSON report with the following structure. Extract ALL available data. Include Arabic names if found. Estimate compensation based on role and company size if not directly available.

{
  "personName": "Full name in English",
  "arabicName": "Full name in Arabic (الاسم بالعربية)",
  "profileSummary": "2-3 paragraph executive summary of the person's career and significance",
  "currentRole": {
    "title": "Current job title",
    "company": "Current company",
    "department": "Department",
    "startDate": "When they started",
    "responsibilities": ["Key responsibilities"],
    "estimatedCompensation": "Estimated annual compensation in SAR (based on role/company size benchmarks)"
  },
  "careerHistory": [
    {
      "title": "Job title",
      "company": "Company name",
      "duration": "Start year - End year",
      "description": "Key achievements and responsibilities",
      "location": "City, Country"
    }
  ],
  "education": [
    {
      "degree": "Degree type",
      "institution": "University/School name",
      "year": "Graduation year",
      "field": "Field of study",
      "honors": "Any honors or distinctions"
    }
  ],
  "skills": {
    "technical": ["Technical skills"],
    "leadership": ["Leadership competencies"],
    "industry": ["Industry expertise"],
    "languages": ["Languages spoken"]
  },
  "boardPositions": [
    {
      "company": "Company name",
      "role": "Board role (Independent Director, etc.)",
      "since": "Year joined",
      "aiAnalysis": "AI assessment of this board position's strategic value"
    }
  ],
  "certifications": ["Professional certifications"],
  "awards": [
    {"title": "Award name", "year": "Year", "organization": "Awarding body"}
  ],
  "publications": [
    {"title": "Publication title", "year": "Year", "source": "Journal/Book"}
  ],
  "contactInfo": {
    "email": "Email address",
    "phone": "Phone number",
    "linkedin": "LinkedIn URL",
    "twitter": "Twitter handle"
  },
  "networkInsights": {
    "connections": "Estimated LinkedIn connections",
    "influenceScore": "AI-assessed influence score (1-10)"
  },
  "aiAnalysis": {
    "leadershipStyle": "Assessment of leadership style",
    "strengths": ["Key professional strengths"],
    "weaknesses": ["Potential areas for development"],
    "careerTrajectory": "Assessment of career trajectory and potential",
    "recommendedApproach": "Best approach for professional engagement",
    "netWorthEstimate": "Estimated net worth if public figure"
  },
  "keyInsights": ["5-7 key insights about this person"],
  "recommendations": ["3-5 recommendations for engaging with this person"]
}

CRITICAL:
- Extract ALL data from sources - do not skip available information
- Arabic names must be preserved exactly (الاسم بالعربية)
- Estimate compensation based on company size and role seniority if not available
- For missing data, use null - never fabricate information`;

    const PERSON_SYSTEM = "You are an expert Saudi Arabia executive intelligence analyst. Output valid JSON only. Extract maximum detail from all provided sources.";

    const [gptRes, claudeRes, geminiRes] = await Promise.allSettled([
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: PERSON_SYSTEM },
          { role: "user", content: prompt }
        ],
        max_completion_tokens: 4000,
        response_format: { type: "json_object" },
      }).then(r => r.choices[0]?.message?.content || "{}"),
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: PERSON_SYSTEM + " Return ONLY valid JSON.",
        messages: [{ role: "user", content: prompt }],
      }).then(r => r.content[0]?.type === "text" ? r.content[0].text : "{}").catch(() => "{}"),
      isGeminiConfigured()
        ? synthesizeWithGemini(prompt, PERSON_SYSTEM + " Return ONLY valid JSON matching the schema.", "gemini-2.5-pro")
        : Promise.resolve(null),
    ]);

    const rawGpt = gptRes.status === "fulfilled" ? gptRes.value : null;
    const rawClaude = claudeRes.status === "fulfilled" ? claudeRes.value : null;
    const rawGemini = geminiRes.status === "fulfilled" && geminiRes.value ? geminiRes.value : null;

    const sourcesUsed: string[] = [];
    if (rawGpt) sourcesUsed.push("OpenAI GPT-4o");
    if (rawClaude) sourcesUsed.push("Claude Sonnet");
    if (rawGemini) sourcesUsed.push("Gemini 2.5 Pro");

    // Merge: Gemini (1st) → Claude (2nd) → GPT-4o (3rd)
    let merged: Record<string, unknown> = {};
    for (const raw of [rawGemini, rawClaude, rawGpt].filter(Boolean)) {
      try {
        const match = (raw as string).match(/\{[\s\S]*\}/);
        const parsed = match ? JSON.parse(match[0]) : {};
        for (const [k, v] of Object.entries(parsed)) {
          if (v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) {
            if (!merged[k]) merged[k] = v;
          }
        }
      } catch { /* ignore */ }
    }
    if (Object.keys(merged).length === 0) merged = JSON.parse(rawGemini || rawClaude || rawGpt || "{}");

    const analysisResult = merged;
    
    return {
      agentName: "MultiAIPersonAgent",
      status: "success",
      data: analysisResult,
      sources: sourcesUsed,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    console.error("[MultiAIPersonAgent] Analysis failed:", error);
    return {
      agentName: "MultiAIPersonAgent",
      status: "failed",
      data: null,
      sources: [],
      executionTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

export async function orchestratePersonEnrichment(
  personName: string,
  company?: string,
  linkedinUrl?: string,
  websiteUrl?: string
): Promise<OrchestratedPersonReport> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[PersonOrchestra] Starting multi-agent enrichment for: ${personName}`);
  console.log(`[PersonOrchestra] Company: ${company || "Not provided"}`);
  console.log(`${"=".repeat(60)}\n`);
  
  const startTime = Date.now();
  
  console.log("[PersonOrchestra] Phase 1: Deploying ALL 7 agents in parallel...");
  const agentPromises = [
    perplexityPersonAgent(personName, company),
    apolloPersonAgent(personName, company),
    // LinkedIn Profile Scraper - use Apify for direct LinkedIn scraping
    linkedInProfileScraperAgent(linkedinUrl),
    websiteUrl ? crawlerAgent(websiteUrl) : Promise.resolve({
      agentName: "CrawlerAgent",
      status: "failed" as const,
      data: null,
      sources: [],
      executionTimeMs: 0,
      error: "No website URL provided"
    }),
    deepResearchAgent(personName + (company ? ` ${company}` : ""), websiteUrl),
    // Avoid LinkedIn URLs for Playwright - use website only (LinkedIn blocks bots)
    websiteUrl ? playwrightAgent(personName + (company ? ` ${company}` : ""), websiteUrl) : Promise.resolve({
      agentName: "PlaywrightAgent",
      status: "failed" as const,
      data: null,
      sources: [],
      executionTimeMs: 0,
      error: "No public website URL provided for Playwright (LinkedIn blocked)"
    }),
    // Explorium firmographic lookup for the person's company — enriches company context
    company ? exploriumAgent(company, websiteUrl) : Promise.resolve({
      agentName: "ExploriumAgent",
      status: "failed" as const,
      data: null,
      sources: [],
      executionTimeMs: 0,
      error: "No company provided for Explorium lookup"
    }),
  ];
  
  const agentResults = await Promise.allSettled(agentPromises);
  
  const personAgentNames = ["PerplexityPerson", "ApolloPerson", "LinkedInScraper", "Crawler", "DeepResearch", "Playwright", "Explorium"];
  const successfulResults: AgentResult[] = agentResults
    .map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        agentName: personAgentNames[index] + "Agent",
        status: "failed" as const,
        data: null,
        sources: [],
        executionTimeMs: 0,
        error: result.reason?.message || "Unknown error"
      };
    });
  
  console.log("\n[PersonOrchestra] Phase 1 Results:");
  successfulResults.forEach(r => {
    console.log(`  - ${r.agentName}: ${r.status} (${r.executionTimeMs}ms)`);
  });
  
  console.log("\n[PersonOrchestra] Phase 2: Aggregating data from ALL agents for AI analysis...");
  const linkedInData = successfulResults.find(r => r.agentName === "LinkedInScraperAgent")?.data;
  console.log(`[PersonOrchestra] LinkedIn scraper data: ${linkedInData ? Object.keys(linkedInData).length + ' fields' : 'none'}`);
  
  const aggregatedData = {
    perplexity: successfulResults.find(r => r.agentName === "PerplexityPersonAgent")?.data,
    apollo: successfulResults.find(r => r.agentName === "ApolloPersonAgent")?.data,
    linkedin: linkedInData, // Real LinkedIn profile data from Apify scraper
    crawler: successfulResults.find(r => r.agentName === "CrawlerAgent")?.data,
    deepResearch: successfulResults.find(r => r.agentName === "DeepResearchAgent")?.data,
    playwright: successfulResults.find(r => r.agentName === "PlaywrightAgent")?.data,
    explorium: successfulResults.find(r => r.agentName === "ExploriumAgent")?.data, // Company firmographics for person context
    linkedinUrl,
    company,
  };
  
  console.log("[PersonOrchestra] Phase 3: OpenAI deep analysis and report generation...");
  const analysisResult = await openaiPersonAnalysisAgent(personName, aggregatedData);
  successfulResults.push(analysisResult);
  
  const allSources = Array.from(new Set(successfulResults.flatMap(r => r.sources)));
  
  const analysisData = analysisResult.data || {};
  
  const report: OrchestratedPersonReport = {
    personName: analysisData.personName || personName,
    arabicName: analysisData.arabicName,
    profileSummary: analysisData.profileSummary,
    currentRole: analysisData.currentRole,
    careerHistory: analysisData.careerHistory,
    education: analysisData.education,
    skills: analysisData.skills,
    boardPositions: analysisData.boardPositions,
    certifications: analysisData.certifications,
    awards: analysisData.awards,
    publications: analysisData.publications,
    contactInfo: analysisData.contactInfo,
    socialProfiles: analysisData.socialProfiles,
    networkInsights: analysisData.networkInsights,
    aiAnalysis: analysisData.aiAnalysis,
    keyInsights: analysisData.keyInsights || [],
    recommendations: analysisData.recommendations || [],
    agentResults: successfulResults,
    dataSources: allSources,
    generatedAt: new Date().toISOString(),
  };
  
  const totalTime = Date.now() - startTime;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[PersonOrchestra] Enrichment complete in ${totalTime}ms`);
  console.log(`[PersonOrchestra] Agents: ${successfulResults.filter(r => r.status === "success").length}/${successfulResults.length} successful`);
  console.log(`[PersonOrchestra] Sources: ${allSources.length} unique sources`);
  console.log(`${"=".repeat(60)}\n`);
  
  return report;
}
