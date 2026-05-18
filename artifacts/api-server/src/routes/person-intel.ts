import { Router, type Request, type Response } from "express";
import { db, prosengineResearchTable, leadListsTable, leadListItemsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { synthesizeWithGemini, isGeminiConfigured, deepResearchWithGemini } from "../gemini-search.js";
import { runWebSeeder } from "../lib/web-seeder.js";
import { nexusGenerate, getLLMStatus } from "../lib/nexus/index.js";
import { onProsEngineComplete } from "../lib/activepieces-client.js";

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "dummy",
});

// ── Web search: Perplexity → Gemini Google Search fallback ───────────────────
async function perplexityPersonSearch(query: string, maxTokens = 2000): Promise<string> {
  const key = process.env.PERPLEXITY_API_KEY;

  // ── Primary: Perplexity ──────────────────────────────────────────────────
  if (key) {
    try {
      const resp = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar",
          messages: [
            { role: "system", content: "You are a Saudi Arabia B2B intelligence researcher. Provide verified, factual information only. Use specific numbers, dates, and cite sources where possible. Never hallucinate." },
            { role: "user", content: query },
          ],
          max_tokens: maxTokens,
          temperature: 0.1,
          return_citations: true,
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (resp.ok) {
        const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
        const result = data.choices?.[0]?.message?.content || "";
        if (result.length > 50) return result;
      }
    } catch { /* fall through to Gemini */ }
  }

  // ── Fallback: Gemini with Google Search grounding ─────────────────────────
  if (isGeminiConfigured()) {
    try {
      const geminiPromise = deepResearchWithGemini(
        query,
        "You are a Saudi Arabia B2B intelligence researcher. Search the web and provide accurate, current, specific information about this person. Include verified facts, dates, titles, company names, and URLs where available.",
        "gemini-2.5-flash"
      );
      const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), 35000));
      const result = await Promise.race([geminiPromise, timeoutPromise]);
      return result?.text || "";
    } catch { return ""; }
  }

  return "";
}

// ── Apollo person lookup ─────────────────────────────────────────────────────
async function apolloPersonLookup(name: string, company?: string, title?: string): Promise<string> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return "";
  try {
    const params: Record<string, unknown> = {
      q_person_name: name,
      per_page: 5,
    };
    if (company) params.q_organization_name = company;

    const resp = await fetch("https://api.apollo.io/v1/people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return "";
    const data = await resp.json() as { people?: unknown[] };
    if (!data.people?.length) return "";
    const p = data.people[0] as Record<string, unknown>;
    return JSON.stringify({
      name: p.name,
      title: p.title,
      email: p.email,
      phone: (p.phone_numbers as Array<Record<string, unknown>>)?.[0]?.sanitized_number,
      linkedin: p.linkedin_url,
      city: p.city,
      country: p.country,
      seniority: p.seniority,
      departments: p.departments,
      employment_history: (p.employment_history as Array<Record<string, unknown>>)?.slice(0, 5),
    });
  } catch { return ""; }
}

// ── Explorium person lookup ──────────────────────────────────────────────────
async function exploriumPersonLookup(name: string, company?: string): Promise<string> {
  const key = process.env.EXPLORIUM_API_KEY;
  if (!key) return "";
  try {
    const resp = await fetch("https://app.explorium.ai/api/bundle/v1/people", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ full_name: name, company_name: company || undefined, country: "Saudi Arabia" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return "";
    const data = await resp.json() as Record<string, unknown>;
    return JSON.stringify(data);
  } catch { return ""; }
}


// ─── POST /person-intel/profile ───────────────────────────────────────────────
// Lean 8-agent pipeline: 4 Perplexity + 2 Gemini + Claude + GPT-4o →
// Gemini/Claude/GPT-4o synthesis with "Not found" discipline.
router.post("/person-intel/profile", async (req: Request, res: Response): Promise<void> => {
  const {
    name, company, title, linkedinUrl, websiteUrl: requestedWebsiteUrl, country = "Saudi Arabia",
    sellerContext, intelligenceGoals, knownFacts,
  } = req.body as {
    name: string; company?: string; title?: string; linkedinUrl?: string; websiteUrl?: string; country?: string;
    sellerContext?: { companyName?: string; product?: string; objective?: string; objectives?: string[] };
    intelligenceGoals?: string[];
    knownFacts?: string;
  };

  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }

  try {
    const goalsList = intelligenceGoals && intelligenceGoals.length > 0
      ? intelligenceGoals.join(", ")
      : "full profile including wealth, career, education, company analysis, and approach strategy";

    const sellerObjective = sellerContext?.objectives?.length ? sellerContext.objectives.join(" + ") : (sellerContext?.objective || "book a meeting");
    const sellerSection = sellerContext?.companyName
      ? `\nSALES CONTEXT (personalize everything to this):\n- Seller company: ${sellerContext.companyName}\n- Product/service: ${sellerContext.product || "B2B services"}\n- Objective: ${sellerObjective}`
      : "";

    const knownSection = knownFacts?.trim()
      ? `\nKNOWN FACTS (use these as confirmed data, build on them):\n${knownFacts}`
      : "";

    console.log(`[PersonIntel] Running pipeline for: ${name} @ ${company || "N/A"}`);

    // ── PARALLEL RESEARCH ENGINE — 8 agents ─────────────────────────────────
    // 4 Perplexity + 2 Gemini + Claude + GPT-4o (all with tight timeouts)
    const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>(r => setTimeout(() => r(fallback), ms))]);

    const [
      perplexityProfile,
      perplexityCompany,
      perplexityWealth,
      perplexityNews,
      companyWebsiteCrawl,
      geminiDossierResult,
      geminiCompanyResult,
      claudeKnowledgeResult,
      gptKnowledgeResult,
    ] = await Promise.allSettled([

      // ── PERPLEXITY 1: Career & professional background ──────────────────────
      perplexityPersonSearch(
        `Full professional background and career history of "${name}"${company ? ` at ${company}` : ""}${title ? `, ${title}` : ""} in Saudi Arabia. Include: ALL current and past roles with company names, dates, responsibilities, and achievements. Also include education: universities, degrees, graduation years, board memberships, advisory roles.`,
        2500
      ),

      // ── PERPLEXITY 2: Company intelligence ─────────────────────────────────
      company ? perplexityPersonSearch(
        `Company intelligence for ${company} in Saudi Arabia: founding year, shareholders ownership structure, CEO and executive team full names with titles, revenue estimate, employee count, market position, key clients, recent contracts, competitors, Vision 2030 alignment, recent news 2024-2025.`,
        2000
      ) : Promise.resolve(""),

      // ── PERPLEXITY 3: Compensation, wealth & financial profile ──────────────
      perplexityPersonSearch(
        `Compensation and wealth profile for "${name}"${company ? ` at ${company}` : ""} Saudi Arabia: estimated annual salary راتب سنوي, total compensation package تعويضات, board sitting fees, equity/shareholding percentage in ${company || "their company"}, known net worth, investments, real estate assets. Search Argaam, Mubasher, Aamaly, company annual reports, board remuneration disclosures, Saudi Gazette, Bloomberg. Also personal interests, philanthropy, sports, conference appearances, awards 2024-2025.`,
        1800
      ),

      // ── PERPLEXITY 4: Recent news & LinkedIn URL ────────────────────────────
      perplexityPersonSearch(
        `Latest news about "${name}"${company ? ` at ${company}` : ""} Saudi Arabia 2024-2025: deals, partnerships, conference appearances, awards, promotions, controversies. Also LinkedIn profile URL: linkedin.com/in/...`,
        1500
      ),

      // ── COMPANY WEBSITE CRAWL (optional) ───────────────────────────────────
      (async () => {
        try {
          const siteUrl = requestedWebsiteUrl?.trim() || "";
          if (!siteUrl) return "";
          const result = await withTimeout(
            runWebSeeder(siteUrl, company || "", { maxPages: 5 }),
            15000, null
          );
          if (!result?.success) return "";
          const parts: string[] = [];
          const agg = (result.aggregated || {}) as Record<string, unknown>;
          if (agg.company) parts.push(`Company overview: ${JSON.stringify(agg.company)}`);
          if (Array.isArray(agg.team) && (agg.team as unknown[]).length > 0)
            parts.push(`Team & leadership: ${JSON.stringify(agg.team)}`);
          if (Array.isArray(agg.services) && (agg.services as unknown[]).length > 0)
            parts.push(`Services: ${(agg.services as string[]).join(", ")}`);
          if (result.allEmails?.length) parts.push(`Emails: ${result.allEmails.join(", ")}`);
          if (result.allPhones?.length) parts.push(`Phones: ${result.allPhones.join(", ")}`);
          return parts.length > 0 ? `Company website (${result.pagesAnalyzed} pages):\n${parts.join("\n")}` : "";
        } catch { return ""; }
      })(),

      // ── GEMINI A: Comprehensive career & dossier (Google Search grounding) ──
      isGeminiConfigured()
        ? withTimeout(
            deepResearchWithGemini(
              `Comprehensive intelligence dossier on "${name}"${company ? ` at ${company}` : ""}${title ? `, ${title}` : ""} in Saudi Arabia.\n\nFind everything:\n- Full career history (all roles, dates, companies)\n- Education (universities, degrees, years)\n- Board memberships and advisory roles\n- LinkedIn profile URL: https://linkedin.com/in/...\n- Net worth estimate or equity stake\n- Personal interests, philanthropy, sports\n- Recent news or business activities 2024-2025\n- Public statements, conferences, awards\n- Vision 2030 project involvement`,
              "You are an elite Saudi Arabia B2B intelligence analyst. Use Google Search exhaustively. Return all factual data found, labeled by category.",
              "gemini-2.5-flash"
            ).then(r => r?.text ?? null),
            20000, null
          )
        : Promise.resolve(null),

      // ── GEMINI B: Company context & recent news ─────────────────────────────
      isGeminiConfigured()
        ? withTimeout(
            deepResearchWithGemini(
              `Research latest news and business activities for "${name}"${company ? ` from ${company}` : ""} in Saudi Arabia (2023-2025).\n\nFind:\n- Recent deals, contracts, tenders\n- Partnerships or joint ventures\n- Conference appearances and keynote speeches\n- Press releases and media interviews\n- Company performance and news about ${company || "their employer"}\n- Vision 2030 projects`,
              "You are a Saudi Arabia B2B intelligence researcher. Use Google Search for current news. Include dates and sources.",
              "gemini-2.5-flash"
            ).then(r => r?.text ?? null),
            20000, null
          )
        : Promise.resolve(null),

      // ── CLAUDE: Training knowledge base ────────────────────────────────────
      withTimeout(
        (async () => {
          try {
            const msg = await anthropic.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 1500,
              system: "You are an elite Saudi Arabia B2B intelligence analyst. Extract ALL facts you know from your training data. Be specific with dates, companies, titles, and LinkedIn URLs.",
              messages: [{
                role: "user",
                content: `What do you know about "${name}"${company ? ` at ${company}` : ""}${title ? ` as ${title}` : ""} in Saudi Arabia?\n\nList ALL known facts: name (EN + AR), roles with dates, education, LinkedIn URL, board memberships, net worth, achievements, awards, personal interests. Label uncertain info clearly.`,
              }],
            });
            return msg.content[0]?.type === "text" ? msg.content[0].text : null;
          } catch { return null; }
        })(),
        12000, null
      ),

      // ── GPT-4o: Training knowledge base ────────────────────────────────────
      withTimeout(
        (async () => {
          try {
            const completion = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [
                { role: "system", content: "You are an elite Saudi Arabia B2B intelligence analyst. Extract ALL facts from your training data. Be specific with dates, companies, titles, and LinkedIn URLs." },
                { role: "user", content: `What do you know about "${name}"${company ? ` at ${company}` : ""}${title ? ` as ${title}` : ""} in Saudi Arabia?\n\nList ALL known facts: name (EN + AR), roles with dates, education, LinkedIn URL, board memberships, net worth, achievements, awards, personal interests. Label uncertain info clearly.` },
              ],
              max_completion_tokens: 1500,
            });
            return completion.choices[0]?.message?.content ?? null;
          } catch { return null; }
        })(),
        12000, null
      ),
    ]);

    // ── Helper to safely extract settled value ─────────────────────────────
    const val  = (r: PromiseSettledResult<string>)         => (r.status === "fulfilled" ? r.value : "") as string;
    const gval = (r: PromiseSettledResult<string | null>)  => (r.status === "fulfilled" && r.value ? r.value : "") as string;

    const geminiDossierText   = gval(geminiDossierResult);
    const geminiCompanyText   = gval(geminiCompanyResult);
    const claudeKnowledgeText = gval(claudeKnowledgeResult);
    const gptKnowledgeText    = gval(gptKnowledgeResult);

    // Discover LinkedIn URL from any source
    const allText = val(perplexityProfile) + val(perplexityNews) + geminiDossierText + claudeKnowledgeText + gptKnowledgeText;
    const discoveredLinkedInUrl = !linkedinUrl ? (allText.match(/linkedin\.com\/in\/[^\s"',>)]+/)?.[0] || "") : "";
    const effectiveLinkedInUrl = linkedinUrl || (discoveredLinkedInUrl ? `https://${discoveredLinkedInUrl.replace(/^https?:\/\//, "")}` : "");

    const geminiHits = [geminiDossierText, geminiCompanyText].filter(Boolean).length;
    const aiHits = [claudeKnowledgeText, gptKnowledgeText].filter(Boolean).length;
    console.log(`[PersonIntel] Sources — perplexity: ${[val(perplexityProfile), val(perplexityCompany), val(perplexityWealth), val(perplexityNews)].filter(Boolean).length}/4, gemini: ${geminiHits}/2, ai-knowledge: ${aiHits}/2`);

    const sources = [
      val(perplexityProfile)  ? "Perplexity: professional background & career" : "",
      val(perplexityCompany)  ? "Perplexity: company intel" : "",
      val(perplexityWealth)   ? "Perplexity: wealth & financial profile" : "",
      val(perplexityNews)     ? "Perplexity: recent news & LinkedIn URL" : "",
      val(companyWebsiteCrawl) ? "Company website crawl" : "",
      geminiDossierText       ? "Gemini: comprehensive dossier (Google Search)" : "",
      geminiCompanyText       ? "Gemini: company context & recent news (Google Search)" : "",
      claudeKnowledgeText     ? "Claude: training knowledge base" : "",
      gptKnowledgeText        ? "GPT-4o: training knowledge base" : "",
    ].filter(Boolean);

    const sections = [
      val(perplexityProfile)   ? `=== SOURCE 1: WEB SEARCH — Professional Background & Career ===\n${val(perplexityProfile)}` : "",
      val(perplexityCompany)   ? `=== SOURCE 2: WEB SEARCH — Company Intelligence ===\n${val(perplexityCompany)}` : "",
      val(perplexityWealth)    ? `=== SOURCE 3: WEB SEARCH — Wealth & Financial Profile ===\n${val(perplexityWealth)}` : "",
      val(perplexityNews)      ? `=== SOURCE 4: WEB SEARCH — Recent News & LinkedIn URL ===\n${val(perplexityNews)}${effectiveLinkedInUrl ? `\nDISCOVERED LINKEDIN: ${effectiveLinkedInUrl}` : ""}` : "",
      val(companyWebsiteCrawl) ? `=== SOURCE 5: COMPANY WEBSITE ===\n${val(companyWebsiteCrawl)}` : "",
      geminiDossierText        ? `=== SOURCE 6: GEMINI — Comprehensive Dossier (Google Search) ===\n${geminiDossierText}` : "",
      geminiCompanyText        ? `=== SOURCE 7: GEMINI — Company Context & Recent News (Google Search) ===\n${geminiCompanyText}` : "",
      claudeKnowledgeText      ? `=== SOURCE 8: CLAUDE — Training Knowledge Base ===\n${claudeKnowledgeText}` : "",
      gptKnowledgeText         ? `=== SOURCE 9: GPT-4o — Training Knowledge Base ===\n${gptKnowledgeText}` : "",
    ].filter(Boolean);

    const aggregatedIntelligence = sections.join("\n\n").slice(0, 18000);
    const hasRealData = sections.length > 0;

    const synthesisPrompt = `You are an elite Saudi Arabia B2B intelligence analyst. Generate the most detailed, specific, and actionable intelligence dossier for this individual.

TARGET:
- Name: ${name}${company ? `\n- Company: ${company}` : ""}${title ? `\n- Title: ${title}` : ""}${effectiveLinkedInUrl ? `\n- LinkedIn: ${effectiveLinkedInUrl}` : ""}
- Country: ${country}
${sellerSection}
${knownSection}

REQUESTED INTELLIGENCE: ${goalsList}

${aggregatedIntelligence ? `AGGREGATED INTELLIGENCE FROM ${sections.length} RESEARCH SOURCES:\n${aggregatedIntelligence}` : "No live data available — use Saudi market knowledge and label all inferences clearly."}

SYNTHESIS RULES (MANDATORY):
1. CROSS-REFERENCE: A fact confirmed by 2+ sources is verified. Check all 9 sources.
2. LINKEDIN URL: Check Sources 4, 6, 8, 9 for a LinkedIn URL. Use it in profile.linkedin if found anywhere.
3. VERIFIED FACTS: Only include facts present in the research above. Cite source number.
4. ESTIMATES: Label inferences as "Estimated:" in text AND in estimated_facts.
5. NOT FOUND: Set "Not found" only after checking all sources. Never hallucinate.
6. SPECIFICITY: Use exact numbers, dates, role titles from research. No generic phrases.
7. AI KNOWLEDGE: Sources 8 (Claude) and 9 (GPT-4o) are training-data knowledge — treat as supplementary.
8. CAREER: Populate from all sources, most recent first.

Return a JSON object with EXACTLY this structure. Use "Not found" for missing text fields — never null:

{
  "profile": {
    "fullName": "Full formal name",
    "arabicName": "Arabic name if found or Not found",
    "title": "Current primary title",
    "company": "Current primary company",
    "nationality": "Nationality if found or Not found",
    "location": "City, Country if found",
    "age": null,
    "linkedin": "LinkedIn URL if known or Not found"
  },
  "career": [
    { "company": "Name", "title": "Role", "period": "YYYY – YYYY or Present", "description": "Specific achievements — not generic" }
  ],
  "education": [
    { "institution": "University name", "degree": "Degree and field", "year": "Year or period" }
  ],
  "company_analysis": {
    "name": "Company",
    "industry": "Industry",
    "founded": "Year or Not found",
    "headquarters": "City, Country or Not found",
    "employees": "Count from research or Not found",
    "revenue_estimate": "Revenue from research or Not found",
    "performance": "Specific performance data from research",
    "market_position": "Market positioning from research",
    "key_clients": ["Client from research"],
    "recent_developments": "Recent news from research",
    "competitors": ["Competitor from research"],
    "pain_points": ["Specific pain point inferred from company situation"]
  },
  "wealth_profile": {
    "estimated_net_worth": "From research or Estimated: [range] based on [reasoning]",
    "income_estimate": "From research or Estimated: [range] based on [role/company]",
    "wealth_sources": ["Source from research"],
    "assets": "From research or Not found",
    "investments": "From research or Not found",
    "lifestyle_indicators": "From research or Not found"
  },
  "personal_profile": {
    "interests": ["Interest from research"],
    "personality_traits": ["Trait inferred from public behavior"],
    "communication_style": "From public statements or Not found",
    "languages": ["Arabic", "English"],
    "board_memberships": ["Board from research or Not found"],
    "publications": ["Publication if found or Not found"],
    "awards": ["Award from research or Not found"],
    "social_presence": "From research or Not found"
  },
  "approach_strategy": {
    "best_channel": "Primary channel based on research",
    "best_timing": "Timing insight from research",
    "opening_angle": "Specific, personalized opening based on research data",
    "value_proposition": "Precisely tailored to their role and company situation",
    "potential_objections": ["Objection from company/industry context"],
    "conversation_starters": ["Topic grounded in research"],
    "cultural_notes": "Saudi business culture considerations specific to this person",
    "recommended_approach": "Full 3-4 paragraph tailored outreach strategy",
    "sample_message": "A ready-to-send, personalized first outreach message grounded in the research"
  },
  "intelligence_notes": {
    "confidence_level": "High / Medium / Low — based on data availability",
    "data_sources": ${JSON.stringify(sources.length > 0 ? sources : ["AI knowledge base"])},
    "verified_facts": ["Only facts confirmed in research sources above"],
    "estimated_facts": ["Inference — label clearly"],
    "caveats": "Important accuracy caveats based on data quality"
  }
}

Return valid JSON only. No markdown. No explanatory text.`;

    // ── Synthesis: Gemini (primary) + Claude + GPT-4o in parallel, all with timeouts ──
    const INTEL_SYSTEM = "You are an elite Saudi Arabia B2B intelligence analyst. Return valid JSON only. Be maximally specific and actionable. Ground all facts in the provided research data. Use 'Not found' for missing fields — never hallucinate.";

    const synthTimeoutMs = 35000;
    const synthWrap = (p: Promise<string | null>) =>
      Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), synthTimeoutMs))]);

    const [geminiResult, claudeResult, gptResult] = await Promise.allSettled([
      isGeminiConfigured()
        ? synthWrap(synthesizeWithGemini(synthesisPrompt, INTEL_SYSTEM, "gemini-2.5-flash"))
        : Promise.resolve(null),
      synthWrap((async () => {
        try {
          const msg = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4000,
            system: INTEL_SYSTEM,
            messages: [{ role: "user", content: synthesisPrompt }],
          });
          return msg.content[0]?.type === "text" ? msg.content[0].text : null;
        } catch { return null; }
      })()),
      synthWrap((async () => {
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: INTEL_SYSTEM },
              { role: "user", content: synthesisPrompt },
            ],
            max_completion_tokens: 4000,
          });
          return completion.choices[0]?.message?.content ?? null;
        } catch { return null; }
      })()),
    ]);

    // Priority: Gemini first, then Claude, then GPT-4o
    const getVal = (r: PromiseSettledResult<string | null>) =>
      r.status === "fulfilled" && r.value ? r.value : null;
    const raw = getVal(geminiResult) ?? getVal(claudeResult) ?? getVal(gptResult) ?? "{}";

    let parsed: Record<string, unknown>;
    try {
      const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
      parsed = JSON.parse(s !== -1 ? raw.slice(s, e + 1) : raw);
    } catch {
      parsed = {
        profile: { fullName: name, company, title },
        intelligence_notes: {
          confidence_level: "Low",
          data_sources: sources.length > 0 ? sources : ["AI knowledge base"],
          verified_facts: [],
          estimated_facts: [],
          caveats: "Parsing error — please retry.",
        },
      };
    }

    // Inject discovered LinkedIn URL if AI didn't find it
    if (effectiveLinkedInUrl) {
      const prof = parsed.profile as Record<string, unknown> | undefined;
      if (prof && (!prof.linkedin || prof.linkedin === "Not found")) {
        prof.linkedin = effectiveLinkedInUrl;
      }
    }

    // Attach pipeline metadata for UI
    (parsed as Record<string, unknown>)._pipelineStats = {
      sourcesUsed: sources,
      hasRealData,
      researchThreads: sections.length,
      geminiAgents: geminiHits,
      discoveredLinkedIn: effectiveLinkedInUrl || null,
    };

    // Layer 6 — Activepieces (non-blocking)
    onProsEngineComplete({
      mode: "persona",
      subject: name,
      agentsRun: sections.length,
      insightsGenerated: sections.length,
      hasContacts: !!(effectiveLinkedInUrl),
    }).catch(() => {});

    res.json(parsed);
  } catch (err) {
    console.error("[PersonIntel] profile error:", err);
    res.status(500).json({ error: "Failed to generate profile" });
  }
});

// ─── POST /person-intel/save ──────────────────────────────────────────────────
router.post("/person-intel/save", async (req: Request, res: Response): Promise<void> => {
  const { personName, company, title, linkedinUrl, sellerContext, intelligenceGoals, knownFacts, report, tags, notes } = req.body as {
    personName: string; company?: string; title?: string; linkedinUrl?: string;
    sellerContext?: object; intelligenceGoals?: string[]; knownFacts?: string;
    report: object; tags?: string; notes?: string;
  };
  if (!personName || !report) { res.status(400).json({ error: "personName and report required" }); return; }
  try {
    const [row] = await db.insert(prosengineResearchTable).values({
      personName,
      company: company ?? null,
      title: title ?? null,
      linkedinUrl: linkedinUrl ?? null,
      sellerContext: sellerContext ? JSON.stringify(sellerContext) : null,
      intelligenceGoals: intelligenceGoals ? JSON.stringify(intelligenceGoals) : null,
      knownFacts: knownFacts ?? null,
      report: JSON.stringify(report),
      tags: tags ?? null,
      notes: notes ?? null,
    }).returning();
    res.json(row);

    // ── Auto-seed into ProsEngine Watchlist (AI Hunt standing list) ────────────
    setImmediate(async () => {
      try {
        const WATCHLIST_NAME = "ProsEngine Watchlist";
        // Find or create the standing watchlist
        let [watchlist] = await db.select().from(leadListsTable)
          .where(eq(leadListsTable.name, WATCHLIST_NAME))
          .limit(1);
        if (!watchlist) {
          [watchlist] = await db.insert(leadListsTable).values({
            name: WATCHLIST_NAME,
            criteria: JSON.stringify({ sources: ["prosengine"], personTypes: [], industries: [], cities: [], revenueRange: "any", employeeMin: 0, employeeMax: 99999, compensationRange: "any", requiredPersonFields: [], requiredCompanyFields: [], maxLeads: 9999 }),
            status: "done",
            totalFound: 0,
            sourcesSearched: JSON.stringify(["prosengine"]),
          }).returning();
        }

        // Extract any available data from report for enriching the item
        let linkedin = linkedinUrl ?? null;
        let biography: string | null = null;
        try {
          const rpt = typeof report === "string" ? JSON.parse(report) : report as Record<string, unknown>;
          const prof = (rpt as Record<string, unknown>).profile as Record<string, unknown> | undefined;
          if (prof?.linkedin && typeof prof.linkedin === "string" && prof.linkedin !== "Not found") linkedin = prof.linkedin;
          biography = (rpt as Record<string, unknown>).executive_summary as string ?? null;
        } catch { /* non-fatal */ }

        await db.insert(leadListItemsTable).values({
          listId: watchlist.id,
          personName,
          personTitle: title ?? null,
          biography,
          linkedin,
          companyName: company ?? null,
          source: "prosengine",
          sourceId: `pe_${row.id}`,
          matchScore: 80,
          aiScore: 80,
          aiReasoning: "Manually added from ProsEngine Research — high-priority watchlist lead",
        });

        // Update total count
        const [cnt] = await db.select({ c: sql<number>`count(*)::int` }).from(leadListItemsTable).where(eq(leadListItemsTable.listId, watchlist.id));
        await db.update(leadListsTable).set({ totalFound: cnt?.c ?? 0, updatedAt: new Date() }).where(eq(leadListsTable.id, watchlist.id));
        console.log(`[PersonIntel] Auto-seeded ${personName} into "${WATCHLIST_NAME}" list`);
      } catch (seedErr) {
        console.warn("[PersonIntel] Watchlist seed error:", (seedErr as Error).message);
      }
    });
  } catch (err) {
    console.error("[PersonIntel] save error:", err);
    res.status(500).json({ error: "Failed to save research" });
  }
});

// ─── GET /person-intel/saved ──────────────────────────────────────────────────
router.get("/person-intel/saved", async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.select().from(prosengineResearchTable).orderBy(desc(prosengineResearchTable.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("[PersonIntel] list error:", err);
    res.status(500).json({ error: "Failed to load saved research" });
  }
});

// ─── POST /person-intel/quick — Fast Claude-only enrichment (for lead saving) ─
router.post("/person-intel/quick", async (req: Request, res: Response): Promise<void> => {
  const { name, company, title } = req.body as { name: string; company?: string; title?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `You are a Saudi B2B intelligence researcher. Generate a quick enrichment profile for this person based on your training knowledge.

Person: ${name}
${company ? `Company: ${company}` : ""}
${title ? `Title: ${title}` : ""}
Country: Saudi Arabia

Return ONLY a JSON object with these fields (use null for unknown):
{
  "email": "best-guess email pattern or null",
  "phone": "best-guess phone or null",
  "linkedin": "LinkedIn URL or null",
  "nationality": "nationality or null",
  "bio": "1-2 sentence professional bio based on role",
  "industry": "industry sector",
  "city": "likely city in Saudi Arabia or null",
  "seniority": "C-Level|VP|Director|Manager|Staff",
  "companySize": "estimated company size if known",
  "revenue": "estimated company revenue range if known"
}`,
      }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const profile = jsonMatch ? JSON.parse(jsonMatch[0]) as Record<string, unknown> : {};
    res.json({ ok: true, profile });
  } catch (err) {
    console.error("[PersonIntel/quick] error:", err);
    res.status(500).json({ error: "Quick enrichment failed" });
  }
});

// ─── DELETE /person-intel/saved/:id ──────────────────────────────────────────
router.delete("/person-intel/saved/:id", async (req: Request, res: Response): Promise<void> => {
  const rawId = req.params["id"];
  const id = parseInt(typeof rawId === "string" ? rawId : rawId[0]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(prosengineResearchTable).where(eq(prosengineResearchTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[PersonIntel] delete error:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
});

export default router;
