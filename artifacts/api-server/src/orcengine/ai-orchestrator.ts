import { PerplexityService } from "../perplexity-service";
import { openai } from "../openai-client";
import { getPageContent } from "../browser-helper";
import { searchWithGemini, searchMultipleWithGemini, isGeminiConfigured, deepResearchWithGemini, synthesizeWithGemini } from "../gemini-search";
import Anthropic from "@anthropic-ai/sdk";
import { nexusGenerate, nexusSynthesize } from "../lib/nexus/index.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "dummy",
});

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

export interface ResearchStrategy {
  taskType: 'company_list' | 'people_list' | 'company_profile' | 'person_profile' | 'market_research' | 'general';
  entities: string[];
  searchQueries: string[];
  dataSourcesToUse: ('apollo' | 'perplexity' | 'web')[];
  outputFormat: 'table' | 'report' | 'profile' | 'list';
  fieldsToExtract: string[];
}

export interface DataSourceResult {
  source: string;
  success: boolean;
  data: any[];
  rawContent: string;
  error?: string;
}

export interface CombinedResearchResult {
  strategy: ResearchStrategy;
  allData: DataSourceResult[];
  synthesizedReport: any;
}

export async function analyzeQueryWithAI(query: string): Promise<ResearchStrategy> {
  console.log(`[AI Orchestrator] Analyzing query: "${query}"`);

  const strategySystem = `You are a research strategy AI. Analyze the user's query and determine the optimal research approach.

TASK TYPES:
- company_list: User wants a LIST of multiple companiesTable (e.g., "top 20 retail companiesTable")
- people_list: User wants a LIST of multiple people/executivesTable (e.g., "50 women leaders")
- company_profile: User wants detailed info about ONE specific company
- person_profile: User wants detailed info about ONE specific person
- market_research: User wants industry/market analysis
- general: Other research queries

IMPORTANT RULES FOR TASK TYPE DETECTION:
- If the query asks about companiesTable in Saudi Arabia, Saudi companiesTable, or businesses in KSA, set taskType to 'company_list'
- If the query asks about top/best/largest companiesTable, always use 'table' outputFormat
- For any list query (top X, best Y, all Z), always include 'perplexity' in dataSourcesToUse for current data

OUTPUT FORMATS:
- table: For lists - data in table/grid format
- report: For detailed analysis with sections
- profile: For single entity deep-dive
- list: Simple bulleted list

Analyze what DATA SOURCES to use:
- apollo: Best for company info, employee data, contact details, B2B data
- perplexity: Best for real-time news, recent events, general web search - ALWAYS include for list queries
- web: Best for web scraping, Google/DuckDuckGo search results, LinkedIn data, direct URL crawling

Return JSON with the research strategy.`;

  const strategyPrompt = `Query: "${query}"

Return JSON:
{
  "taskType": "company_list|people_list|company_profile|person_profile|market_research|general",
  "entities": ["extracted entity names from query"],
  "searchQueries": ["optimized search query 1", "optimized search query 2"],
  "dataSourcesToUse": ["apollo", "web"],
  "outputFormat": "table|report|profile|list",
  "fieldsToExtract": ["field1", "field2", "field3"]
}`;

  // NEXUS realtime tier (Groq 800 tok/s) — fast and cheap for routing decisions
  let content = '{}';
  try {
    const nexusResult = await nexusGenerate(strategyPrompt, { tier: "realtime", systemPrompt: strategySystem, maxTokens: 1000, temperature: 0 });
    content = nexusResult.text;
    console.log(`[AI Orchestrator] NEXUS strategy via ${nexusResult.provider}/${nexusResult.model}`);
  } catch {
    // Fallback: direct GPT-4o
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: strategySystem }, { role: "user", content: strategyPrompt }],
      response_format: { type: "json_object" },
      max_tokens: 1000,
    });
    content = response.choices[0]?.message?.content || '{}';
  }

  const strategy = JSON.parse(content) as ResearchStrategy;
  console.log(`[AI Orchestrator] Strategy: ${strategy.taskType}, Format: ${strategy.outputFormat}`);
  console.log(`[AI Orchestrator] Data sources: ${strategy.dataSourcesToUse.join(', ')}`);
  return strategy;
}

async function searchApollo(strategy: ResearchStrategy, rawUserQuery: string): Promise<DataSourceResult> {
  console.log(`[Apollo] Starting search...`);
  
  if (!APOLLO_API_KEY) {
    return { source: 'apollo', success: false, data: [], rawContent: '', error: 'No API key' };
  }

  try {
    const allData: any[] = [];
    let rawContent = '';

    if (strategy.taskType === 'people_list' || strategy.taskType === 'person_profile') {
      const keywordQuery = strategy.searchQueries[0] || strategy.entities.join(' ') || rawUserQuery || '';
      
      const titleTerms = strategy.entities.filter(e => {
        const lower = e.toLowerCase();
        return lower.includes('ceo') || lower.includes('cfo') || lower.includes('coo') ||
               lower.includes('executive') || lower.includes('director') || lower.includes('manager') ||
               lower.includes('leader') || lower.includes('founder') || lower.includes('chairman') ||
               lower.includes('president') || lower.includes('women') || lower.includes('female');
      });
      
      let executiveTitles: string[] = [];
      if (titleTerms.length > 0) {
        executiveTitles = titleTerms.map(t => {
          if (t.toLowerCase().includes('women') || t.toLowerCase().includes('female')) {
            return "Chairwoman,Director,CEO,CFO,Managing Director,Founder,President";
          }
          return t;
        }).flatMap(t => t.split(','));
      }
      const locationTerms = strategy.entities.filter(e => {
        const lower = e.toLowerCase();
        return lower.includes('saudi') || lower.includes('riyadh') || lower.includes('jeddah') ||
               lower.includes('dubai') || lower.includes('gcc') || lower.includes('gulf') ||
               lower.includes('uae') || lower.includes('qatar') || lower.includes('bahrain');
      });
      
      const queryLower = rawUserQuery.toLowerCase();
      if (locationTerms.length === 0) {
        if (queryLower.includes('saudi') || queryLower.includes('riyadh') || queryLower.includes('ksa')) {
          locationTerms.push('Saudi Arabia');
        } else if (queryLower.includes('dubai') || queryLower.includes('uae')) {
          locationTerms.push('United Arab Emirates');
        } else if (queryLower.includes('gcc') || queryLower.includes('gulf')) {
          locationTerms.push('Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain', 'Oman');
        }
      }
      const locations = locationTerms.length > 0 ? locationTerms : undefined;
      
      const searchBody: any = {
        q_keywords: keywordQuery.slice(0, 100),
        per_page: 100,
        page: 1,
      };
      
      if (executiveTitles.length > 0) {
        searchBody.person_titles = executiveTitles;
      }
      if (locations && locations.length > 0) {
        searchBody.person_locations = locations;
      }
      
      const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": APOLLO_API_KEY,
        },
        body: JSON.stringify(searchBody),
      });

      if (response.ok) {
        const data = await response.json();
        const people = data.people || data.contacts || [];
        allData.push(...people);
        rawContent += people.map((p: any) => 
          `PERSON: ${p.name || `${p.first_name} ${p.last_name}`} | Title: ${p.title} | Company: ${p.organization?.name || p.organization_name} | LinkedIn: ${p.linkedin_url} | Email: ${p.email}`
        ).join('\n');
        console.log(`[Apollo] Found ${people.length} people`);
      } else {
        console.log(`[Apollo] People search failed: ${response.status}`);
      }
    }

    if (strategy.taskType === 'company_list' || strategy.taskType === 'company_profile') {
      const queries = strategy.searchQueries.length > 0 
        ? strategy.searchQueries.slice(0, 2)
        : [strategy.entities.join(' ') || rawUserQuery].filter(q => q && q.trim());
        
      if (queries.length === 0) {
        console.log(`[Apollo] No company queries to search`);
      }
      
      const locationTerms = strategy.entities.filter(e => {
        const lower = e.toLowerCase();
        return lower.includes('saudi') || lower.includes('riyadh') || lower.includes('jeddah') ||
               lower.includes('dubai') || lower.includes('gcc') || lower.includes('gulf') ||
               lower.includes('uae') || lower.includes('qatar') || lower.includes('bahrain');
      });
      
      const queryLower = rawUserQuery.toLowerCase();
      if (locationTerms.length === 0) {
        if (queryLower.includes('saudi') || queryLower.includes('riyadh') || queryLower.includes('ksa')) {
          locationTerms.push('Saudi Arabia');
        } else if (queryLower.includes('dubai') || queryLower.includes('uae')) {
          locationTerms.push('United Arab Emirates');
        } else if (queryLower.includes('gcc') || queryLower.includes('gulf')) {
          locationTerms.push('Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain', 'Oman');
        }
      }
      
      for (const searchQuery of queries) {
        const companySearchBody: any = {
          q_organization_name: searchQuery.slice(0, 50),
          per_page: 50,
        };
        
        if (locationTerms.length > 0) {
          companySearchBody.organization_locations = locationTerms;
        }
        
        const response = await fetch("https://api.apollo.io/api/v1/mixed_companies/api_search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "X-Api-Key": APOLLO_API_KEY,
          },
          body: JSON.stringify(companySearchBody),
        });

        if (response.ok) {
          const data = await response.json();
          const companiesTable = data.organizations || data.accounts || [];
          allData.push(...companiesTable);
          rawContent += companiesTable.map((c: any) => 
            `COMPANY: ${c.name} | Industry: ${c.industry} | Employees: ${c.estimated_num_employees} | Revenue: ${c.annual_revenue_printed || c.estimated_annual_revenue} | Website: ${c.website_url} | LinkedIn: ${c.linkedin_url}`
          ).join('\n');
          console.log(`[Apollo] Found ${companiesTable.length} companiesTable for query: ${searchQuery}`);
        }
      }
    }

    return { source: 'apollo', success: true, data: allData, rawContent };
  } catch (error) {
    console.error(`[Apollo] Error:`, error);
    return { source: 'apollo', success: false, data: [], rawContent: '', error: String(error) };
  }
}

async function searchWeb(strategy: ResearchStrategy, rawUserQuery: string): Promise<DataSourceResult> {
  console.log(`[Web Search] Starting Gemini Google Search...`);

  try {
    const allData: any[] = [];
    let rawContent = '';

    const queries = strategy.searchQueries.length > 0
      ? strategy.searchQueries.slice(0, 3)
      : [strategy.entities.join(' '), rawUserQuery].filter(q => q && q.trim().length > 2);

    if (queries.length === 0) {
      return { source: 'web', success: false, data: [], rawContent: '', error: 'No queries available' };
    }

    // PRIMARY: Gemini Google Search grounding (real Google results via Gemini 2.0 Flash)
    if (isGeminiConfigured()) {
      console.log(`[Web Search] Using Gemini Google Search grounding for ${queries.length} queries`);
      
      const geminiResults = await searchMultipleWithGemini(
        queries.slice(0, 3),
        strategy.taskType === 'company_profile'
          ? 'You are a Saudi Arabian business intelligence analyst. Search for comprehensive company data including executivesTable, revenue, employees, locations, and recent news.'
          : strategy.taskType === 'person_profile'
          ? 'You are a Saudi Arabian executive researcher. Search for career history, current role, education, LinkedIn, and professional achievements.'
          : 'You are a Saudi Arabian market researcher. Search for accurate, current business intelligence data.'
      );

      // searchMultipleWithGemini returns combined string, adapt to expected shape
      const _geminiArr = geminiResults ? [{ success: true, query: queries?.[0] || "", answer: geminiResults, sources: [] as Array<{title:string;url:string}> }] : [];
      for (const gr of _geminiArr) {
        if (gr.success && gr.answer) {
          rawContent += `\nGOOGLE SEARCH RESULT (via Gemini) for "${gr.query}":\n${gr.answer}\n`;
          
          for (const src of gr.sources) {
            rawContent += `  SOURCE: ${src.title} | ${src.url}\n`;
          }

          allData.push({
            query: gr.query,
            answer: gr.answer,
            sources: gr.sources,
          });
        }
      }

      if (rawContent.length > 100) {
        console.log(`[Web Search] Gemini Google Search returned ${rawContent.length} chars of content`);
        return { source: 'web', success: true, data: allData, rawContent };
      }
    }

    // FALLBACK: DuckDuckGo HTML scraping if Gemini is unavailable
    console.log(`[Web Search] Falling back to DuckDuckGo HTML scraping`);
    const { load } = await import("cheerio");

    for (const searchQuery of queries.slice(0, 2)) {
      const encodedQ = encodeURIComponent(searchQuery);
      let html = '';

      try {
        const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodedQ}&kl=xa-ar`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(12000),
        });
        html = await resp.text();
      } catch (_) {}

      // Fallback: Bing search via Playwright
      if (!html || html.length < 1000) {
        try {
          html = await getPageContent(`https://www.bing.com/search?q=${encodedQ}&cc=SA`, { waitMs: 3000 }) || '';
        } catch (_) {}
      }

      if (!html) continue;

      const $ = load(html);
      const results: any[] = [];

      $('.result, .web-result').each((_, el) => {
        const title = $(el).find('.result__title, .result__a, h2 a').first().text().trim();
        const url = $(el).find('.result__url, a[href]').first().attr('href') || '';
        const description = $(el).find('.result__snippet, .result__body').first().text().trim();
        if (title && title.length > 3) {
          results.push({ title, url: url.replace(/^\/\//, 'https://'), description });
          rawContent += `WEB RESULT: ${title} | URL: ${url} | ${description.substring(0, 150)}\n`;
        }
      });

      if (results.length === 0) {
        $('li.b_algo').each((_, el) => {
          const title = $(el).find('h2').text().trim();
          const url = $(el).find('h2 a').attr('href') || '';
          const description = $(el).find('.b_caption p').first().text().trim();
          if (title && title.length > 3) {
            results.push({ title, url, description });
            rawContent += `WEB RESULT: ${title} | URL: ${url} | ${description.substring(0, 150)}\n`;
          }
        });
      }

      allData.push({ query: searchQuery, results });
    }

    if (allData.length === 0 && rawContent.length === 0) {
      return { source: 'web', success: false, data: [], rawContent: '', error: 'No results found' };
    }

    return { source: 'web', success: true, data: allData, rawContent };
  } catch (error) {
    console.error(`[Web Search] Error:`, error);
    return { source: 'web', success: false, data: [], rawContent: '', error: String(error) };
  }
}

async function searchPerplexity(strategy: ResearchStrategy, rawUserQuery: string): Promise<DataSourceResult> {
  console.log(`[Perplexity] Starting search...`);
  
  const perplexity = new PerplexityService();
  
  try {
    let rawContent = '';
    const allData: any[] = [];

    const queries = strategy.searchQueries.length > 0 
      ? strategy.searchQueries.slice(0, 2)
      : [strategy.entities.join(' '), rawUserQuery].filter(q => q && q.trim().length > 2);
    
    if (queries.length === 0) {
      console.log(`[Perplexity] No valid queries to search`);
      return { source: 'perplexity', success: false, data: [], rawContent: '', error: 'No queries available' };
    }

    for (const searchQuery of queries.slice(0, 2)) {
      try {
        const result = await perplexity.researchQuery(searchQuery);
        if (result.answer) {
          rawContent += `PERPLEXITY RESULT:\n${result.answer}\n\nSOURCES: ${result.citations?.join(', ') || 'none'}\n\n`;
          allData.push({ answer: result.answer, citations: result.citations });
          console.log(`[Perplexity] Got ${result.answer.length} chars for: ${searchQuery}`);
        }
      } catch (err) {
        console.log(`[Perplexity] Query failed: ${err}`);
      }
    }

    return { source: 'perplexity', success: rawContent.length > 0, data: allData, rawContent };
  } catch (error) {
    console.error(`[Perplexity] Error:`, error);
    return { source: 'perplexity', success: false, data: [], rawContent: '', error: String(error) };
  }
}

async function searchGeminiDeepResearch(strategy: ResearchStrategy, rawUserQuery: string): Promise<DataSourceResult> {
  if (!isGeminiConfigured()) {
    return { source: 'gemini', success: false, data: [], rawContent: '', error: 'Gemini not configured' };
  }
  try {
    console.log(`[Gemini] Starting deep research with Google Search grounding...`);
    const queries = strategy.searchQueries.length > 0
      ? strategy.searchQueries.slice(0, 2)
      : [rawUserQuery].filter(Boolean);

    const INTEL_CONTEXT = "You are a Saudi Arabia B2B intelligence analyst. Use Google Search to find current, factual information. Provide comprehensive details including company financials, ownership, executives, and market position.";

    const results = await Promise.all(
      queries.map(q => deepResearchWithGemini(q, INTEL_CONTEXT, "gemini-2.5-pro"))
    );

    const combined = results.filter(Boolean).map(r => r!.text).join("\n\n---\n\n");
    const allChunks = results.filter(Boolean).flatMap(r => r!.groundingChunks);

    if (!combined) {
      return { source: 'gemini', success: false, data: [], rawContent: '', error: 'No results' };
    }

    console.log(`[Gemini] Deep research complete: ${combined.length} chars, ${allChunks.length} sources`);
    return {
      source: 'gemini',
      success: true,
      data: [{ text: combined, sources: allChunks }],
      rawContent: `GEMINI DEEP RESEARCH (Google Search grounded):\n${combined}\n\nSources: ${allChunks.join(', ')}`,
    };
  } catch (error) {
    console.error(`[Gemini] Deep research error:`, error);
    return { source: 'gemini', success: false, data: [], rawContent: '', error: String(error) };
  }
}

export async function runAllDataSources(strategy: ResearchStrategy, rawUserQuery?: string): Promise<DataSourceResult[]> {
  console.log(`[AI Orchestrator] Running ALL data sources in PARALLEL...`);
  
  const userQuery = rawUserQuery || strategy.searchQueries[0] || strategy.entities.join(' ') || '';
  
  const promises: Promise<DataSourceResult>[] = [];
  
  promises.push(searchApollo(strategy, userQuery));
  promises.push(searchWeb(strategy, userQuery));
  promises.push(searchPerplexity(strategy, userQuery));
  promises.push(searchGeminiDeepResearch(strategy, userQuery));

  const results = await Promise.allSettled(promises);
  const sourceNames = ['apollo', 'web', 'perplexity', 'gemini'];
  
  const dataResults: DataSourceResult[] = results.map((r, i) => {
    if (r.status === 'fulfilled') {
      return r.value;
    }
    return { 
      source: sourceNames[i] || 'unknown', 
      success: false, 
      data: [], 
      rawContent: '', 
      error: String(r.reason) 
    };
  });

  console.log(`[AI Orchestrator] Data source results:`);
  for (const dr of dataResults) {
    console.log(`  - ${dr.source}: ${dr.success ? 'SUCCESS' : 'FAILED'} (${dr.data.length} items)`);
  }

  return dataResults;
}

export async function synthesizeWithAI(
  query: string, 
  strategy: ResearchStrategy, 
  dataResults: DataSourceResult[]
): Promise<any> {
  console.log(`[AI Orchestrator] Synthesizing results with AI...`);
  
  const combinedData = dataResults.map(dr => dr.rawContent).filter(Boolean).join('\n\n---\n\n');
  
  if (!combinedData || combinedData.length < 50) {
    return {
      title: "Research Results",
      summary: "Limited data found from available sources. Please try a more specific query.",
      sections: [],
      error: "Insufficient data from sources"
    };
  }

  const isPeopleQuery = /executivesTable?|ceo|cfo|cto|chairman|founder|manager|director|board|leadership|team|people|person|employee/i.test(query);
  const isCompanyQuery = /compan(y|ies)|business(es)?|firm|corporation|enterprise|startup|venture|brand/i.test(query);
  
  const companyTableFormat = `
For company data, use this EXACT structure in the dataTable:
{
  "name": "Company name",
  "arabicName": "Arabic name if known",
  "sector": "Industry sector",
  "founded": "Year founded",
  "headquarters": "City, Saudi Arabia",
  "employees": "Employee count or range",
  "revenue": "Annual revenue estimate",
  "description": "2-3 sentence company description",
  "website": "Company website URL",
  "ceo": "CEO/Managing Director name",
  "stockSymbol": "Tadawul stock symbol if listed",
  "sourceUrl": "Source URL where info was found"
}`;

  const peopleTableFormat = `
For people/executive data, use this EXACT structure in the dataTable:
{
  "fullName": "Person's full name in English",
  "title": "Job title/position",
  "company": "Company name",
  "estimatedIncome": "Estimated salary/compensation in SAR or USD",
  "linkedinUrl": "LinkedIn profile URL if found",
  "yearsExperience": "Years of experience or tenure",
  "interests": "Known interests or expertise areas",
  "profileSummary": "2-3 sentence professional summary",
  "approachStrategy": "Best way to approach/contact this person",
  "sourceUrl": "Source URL where info was found"
}`;

  const formatInstructions = strategy.outputFormat === 'table' 
    ? `Return a "dataTable" array with objects containing all requested fields. Each object should have real data from the sources.
    ${isCompanyQuery ? companyTableFormat : peopleTableFormat}`
    : (isPeopleQuery 
      ? `Return detailed "sections" array with in-depth analysis. ALSO include a "peopleTable" array with executive/people data in this EXACT format:
${peopleTableFormat}`
      : (isCompanyQuery
        ? `Return detailed "sections" array with in-depth analysis. ALSO include a "dataTable" array with company data in this EXACT format:
${companyTableFormat}`
        : `Return detailed "sections" array with in-depth analysis.`));

  // Build list of sources with URLs for citation
  const sourcesList = dataResults
    .filter(dr => dr.success && dr.data.length > 0)
    .map(dr => dr.source)
    .join(', ');

  const SYNTHESIS_SYSTEM = `You are an expert business intelligence analyst. Create a comprehensive, detailed report from the data provided.

CRITICAL RULES:
1. ONLY use data EXPLICITLY found in the sources - NEVER fabricate names, numbers, or URLs
2. If data for a field is not found, use null - DO NOT make up values or use "-" as placeholder
3. Include source attribution with every claim - cite the specific source (Apollo, Perplexity, Gemini, Web Search, etc.)
4. The report must directly answer the user's original query
5. OMIT any section that has NO data - do not include empty sections
6. Each section should have DETAILED analysis, not just bullet points
7. Always include the "sources" array with all data sources used
8. For peopleTable/dataTable: ONLY include entries where you have REAL data with actual names. Do NOT create entries with "-" or "N/A" in critical fields like fullName, title, company. If no real people data is found, return an empty array.

DEPTH AND DETAIL REQUIREMENTS:
9. Write EXTENSIVE analysis for each section - minimum 3-4 paragraphs per section
10. Include specific data points, percentages, financial figures, and dates from the source data
11. For company data, always include: founding date, employee count, revenue, headquarters, industry sector, key products/services
12. For people data, always include: current role, company, career history highlights, education if available

${formatInstructions}`;

  const synthesisUserMsg = `ORIGINAL USER QUERY: "${query}"

TASK TYPE: ${strategy.taskType}
OUTPUT FORMAT: ${strategy.outputFormat}
FIELDS TO EXTRACT: ${strategy.fieldsToExtract.join(', ')}
DATA SOURCES USED: ${sourcesList || 'None'}

ALL DATA FROM SOURCES:
${combinedData.slice(0, 15000)}

Generate a detailed JSON report. IMPORTANT:
- ONLY include sections that have actual data - omit empty sections entirely
- Each section must have detailed narrative analysis (not just lists)
- Include inline citations like [Source: Apollo] or [Source: Perplexity] or [Source: Gemini]
- The "sources" array must list all sources that provided data

{
  "title": "Report title matching the query",
  "summary": "Executive summary with key findings and numbers",
  ${strategy.outputFormat === 'table' ? `"dataTable": [{ ...fields with real data, include "sourceUrl" if available }],` : ''}
  ${isPeopleQuery ? `"peopleTable": [{ "fullName": "Name", "title": "Title", "company": "Company", "estimatedIncome": "Income", "linkedinUrl": "LinkedIn", "yearsExperience": "Experience", "interests": "Interests", "profileSummary": "Summary", "approachStrategy": "Approach", "sourceUrl": "Source" }],` : ''}
  "sections": [
    { 
      "heading": "Section heading", 
      "content": "Detailed narrative analysis with inline citations [Source: X]. Include specific numbers, names, dates found in the data. Provide context and insights.", 
      "citations": ["source1.com", "source2.com"]
    }
  ],
  "sources": [
    { "name": "Apollo", "type": "api", "itemsFound": number },
    { "name": "Perplexity", "type": "search", "itemsFound": number },
    { "name": "Gemini", "type": "search", "itemsFound": number }
  ],
  "totalResults": number,
  "confidence": 0.0-1.0
}`;

  // Run NEXUS + GPT-4o + Claude + Gemini in parallel — NEXUS coordinates the full provider chain
  const [nexusResult, gptResult, claudeResult, geminiResult] = await Promise.allSettled([
    nexusSynthesize(synthesisUserMsg, SYNTHESIS_SYSTEM + "\n\nReturn ONLY valid JSON matching the schema exactly.", { maxTokens: 8000 }),
    openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYNTHESIS_SYSTEM },
        { role: "user", content: synthesisUserMsg },
      ],
      response_format: { type: "json_object" },
      max_tokens: 12000,
    }).then(r => r.choices[0]?.message?.content || '{}'),
    anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: SYNTHESIS_SYSTEM + "\n\nReturn ONLY valid JSON, no markdown.",
      messages: [{ role: "user", content: synthesisUserMsg }],
    }).then(r => r.content[0]?.type === "text" ? r.content[0].text : '{}').catch(() => '{}'),
    isGeminiConfigured()
      ? synthesizeWithGemini(synthesisUserMsg, SYNTHESIS_SYSTEM + "\n\nReturn ONLY valid JSON matching the schema exactly.", "gemini-2.5-pro")
      : Promise.resolve(null),
  ]);

  // Pick Gemini (1st), Claude (2nd), GPT-4o (3rd), NEXUS (4th)
  const rawNexus = nexusResult.status === "fulfilled" ? nexusResult.value.text : null;
  const rawGpt = gptResult.status === "fulfilled" ? gptResult.value : null;
  const rawClaude = claudeResult.status === "fulfilled" ? claudeResult.value : null;
  const rawGemini = geminiResult.status === "fulfilled" && geminiResult.value ? geminiResult.value : null;
  if (nexusResult.status === "fulfilled") console.log(`[OrcEngine] NEXUS synthesis via ${nexusResult.value.provider}/${nexusResult.value.model}`);

  const content = rawGemini || rawClaude || rawGpt || rawNexus || '{}';
  const report = JSON.parse(content);
  
  if (report.sections) {
    report.sections = report.sections.filter((s: any) => 
      s.content && s.content.trim().length > 10
    );
  }

  if (report.peopleTable && Array.isArray(report.peopleTable)) {
    report.peopleTable = report.peopleTable.filter((p: any) => {
      const name = (p.fullName || '').trim();
      return name && name !== '-' && name !== 'N/A' && name !== 'null' && name.length > 2;
    });
  }
  if (report.dataTable && Array.isArray(report.dataTable)) {
    report.dataTable = report.dataTable.filter((p: any) => {
      const name = (p.fullName || p.name || '').trim();
      return name && name !== '-' && name !== 'N/A' && name !== 'null' && name.length > 2;
    });
  }
  
  // Add source tracking from actual data results
  if (!report.sources || report.sources.length === 0) {
    report.sources = dataResults
      .filter(dr => dr.success && dr.data.length > 0)
      .map(dr => ({
        name: dr.source,
        type: dr.source === 'Apollo' ? 'api' : 'search',
        itemsFound: dr.data.length
      }));
  }
  
  console.log(`[AI Orchestrator] Report generated: ${report.title} with ${report.sections?.length || 0} sections`);
  
  return report;
}

export async function executeAIResearch(query: string): Promise<CombinedResearchResult> {
  console.log(`\n========================================`);
  console.log(`[AI Orchestrator] STARTING RESEARCH`);
  console.log(`Query: "${query}"`);
  console.log(`========================================\n`);

  const strategy = await analyzeQueryWithAI(query);
  
  const allData = await runAllDataSources(strategy, query);
  
  const synthesizedReport = await synthesizeWithAI(query, strategy, allData);

  console.log(`\n========================================`);
  console.log(`[AI Orchestrator] RESEARCH COMPLETE`);
  console.log(`========================================\n`);

  return {
    strategy,
    allData,
    synthesizedReport
  };
}
