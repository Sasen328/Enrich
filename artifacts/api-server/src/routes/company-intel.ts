import { Router, type Request, type Response } from "express";
import { db, companyIntelResearchTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { searchWithGemini, generateWithGemini, isGeminiConfigured, deepResearchWithGemini } from "../gemini-search.js";
import { runWebSeeder, type WebSeederResult } from "../lib/web-seeder.js";
import { nexusGenerate, getLLMStatus } from "../lib/nexus/index.js";
import { onProsEngineComplete } from "../lib/activepieces-client.js";

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "dummy",
});

// ── Web search with Perplexity → Gemini fallback ─────────────────────────────
async function webSearch(query: string): Promise<string> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (key && process.env.DISABLE_PERPLEXITY !== "true") {
    try {
      const resp = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar",
          messages: [
            { role: "system", content: "You are a Saudi Arabia B2B intelligence analyst. Provide verified, factual information with specific numbers, names, and dates. Never hallucinate." },
            { role: "user", content: query },
          ],
          max_tokens: 2000,
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
    } catch { /* fall through */ }
  }
  if (isGeminiConfigured()) {
    const r = await deepResearchWithGemini(query, "You are a Saudi Arabia B2B intelligence analyst. Search the web and return accurate, specific, current information.", "gemini-2.5-flash").catch(() => null);
    if (r?.text) return r.text;
  }
  return "";
}


// ─── POST /api/company-intel/profile ──────────────────────────────────────────
router.post("/company-intel/profile", async (req: Request, res: Response): Promise<void> => {
  const { companyName, website, crNumber, city, sellerContext, intelligenceGoals, knownFacts } = req.body as {
    companyName: string;
    website?: string;
    crNumber?: string;
    city?: string;
    sellerContext?: { companyName?: string; product?: string; objectives?: string[] };
    intelligenceGoals?: string[];
    knownFacts?: string;
  };

  if (!companyName?.trim()) { res.status(400).json({ error: "companyName is required" }); return; }

  const crRef = crNumber ? ` (CR: ${crNumber})` : "";
  const cityRef = city ? `, ${city}` : "";
  const goals = intelligenceGoals || ["profile", "financials", "ownership", "leadership", "market", "approach"];

  try {
    // ── Phase 1: Parallel research across all sources ─────────────────────────
    const [
      websiteCrawl,
      geminiProfile, geminiOwnership, geminiLeadership, geminiMarket, geminiFinancials,
      searchProfile, searchFinancials, searchOwnership, searchLeadership,
      claudeRes, openaiRes,
    ] = await Promise.allSettled([
      // Web Seeder: multi-page paginated crawler (if URL provided)
      website ? runWebSeeder(website, companyName, { maxPages: 8 }) : Promise.resolve(null),

      // Gemini Chrome AI #1 — full company profile (browses live pages)
      isGeminiConfigured()
        ? searchWithGemini(`Saudi company "${companyName}"${crRef}${cityRef}: official website, phone, email, street address, founding year, legal form, CR number, paid-up capital, employee count, revenue estimate SAR, business activities, industry sector. Browse the company's website and Saudi commercial registry. Verified data only.`)
        : Promise.resolve(null),

      // Gemini Chrome AI #2 — ownership & shareholders
      goals.includes("ownership") && isGeminiConfigured()
        ? searchWithGemini(`"${companyName}" Saudi Arabia${crRef} shareholders owners ownership percentage مساهمون ملاك نسبة الملكية — exact full names in Arabic and English with ownership percentages. Search Saudi commercial registry (mc.gov.sa), emagazine.aamaly.sa, and news sources.`)
        : Promise.resolve(null),

      // Gemini Chrome AI #3 — leadership & executives
      goals.includes("leadership") && isGeminiConfigured()
        ? searchWithGemini(`"${companyName}" Saudi Arabia${cityRef} CEO chairman general manager CFO COO board of directors executives مدير عام رئيس مجلس الإدارة — full verified names in Arabic and English with exact titles. Search LinkedIn, news, Saudi business directories.`)
        : Promise.resolve(null),

      // Gemini Chrome AI #4 — competitive intelligence
      goals.includes("market") && isGeminiConfigured()
        ? searchWithGemini(`"${companyName}" Saudi Arabia market position competitors market share industry ranking strengths weaknesses notable clients key projects revenue growth 2023 2024 2025.`)
        : Promise.resolve(null),

      // Gemini Chrome AI #5 — dedicated financial intelligence (always runs when Gemini is configured)
      isGeminiConfigured()
        ? searchWithGemini(`"${companyName}" Saudi Arabia${crRef}${cityRef} financial data: annual revenue إيرادات سنوية, net profit صافي الربح, paid-up capital رأس المال المدفوع, total assets, employee headcount, executive compensation, salary range, last audited financials 2022 2023 2024. Search Tadawul, Argaam, Mubasher, Aamaly, Saudi Gazette, and company annual reports.`)
        : Promise.resolve(null),

      // Perplexity #1 — general profile & contact
      webSearch(`Saudi company "${companyName}"${crRef}${cityRef}: official website, phone number, email, physical address, revenue estimate SAR, employee count, description, main business activities, founding year.`),

      // Perplexity #2 — financial intelligence
      goals.includes("financials")
        ? webSearch(`"${companyName}" Saudi Arabia annual revenue financial performance profit market share paid-up capital رأس المال paid capital إيرادات أرباح — most recent available data 2022 2023 2024.`)
        : Promise.resolve(""),

      // Perplexity #3 — ownership & AOA
      goals.includes("ownership")
        ? webSearch(`"${companyName}" Saudi Arabia shareholders مساهمون عقد التأسيس النظام الأساسي owners ownership percentage board composition — names in Arabic and English with percentages.`)
        : Promise.resolve(""),

      // Perplexity #4 — leadership
      goals.includes("leadership")
        ? webSearch(`"${companyName}" Saudi Arabia CEO managing director chairman executives board أعضاء مجلس الإدارة مدير عام رئيس تنفيذي — full names Arabic and English with titles 2024 2025.`)
        : Promise.resolve(""),

      // Claude — comprehensive analysis
      (async () => {
        try {
          const msg = await Promise.race([
            anthropic.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 2000,
              messages: [{
                role: "user",
                content: `Research the Saudi company "${companyName}"${crRef}${cityRef}. Provide ALL of the following verified public information:
1. Company overview: legal form, founding year, main activities
2. Ownership: shareholders with names (EN+AR) and ownership percentages
3. Leadership: CEO/GM, board chairman, key executives (names EN+AR, titles)
4. Financials: revenue estimate SAR, employee count, paid-up capital
5. Market: main competitors, notable clients/projects, market position
6. Contact: website, phone, email, address
Only include real verified data. Do not invent data.`
              }],
            }),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 30000)),
          ]);
          return (msg as { content: Array<{ type: string; text?: string }> }).content[0]?.type === "text"
            ? (msg as { content: Array<{ type: string; text?: string }> }).content[0].text!
            : null;
        } catch { return null; }
      })(),

      // OpenAI — synthesis & validation
      (async () => {
        try {
          const r = await Promise.race([
            openai.chat.completions.create({
              model: "gpt-4o",
              max_completion_tokens: 1500,
              messages: [
                { role: "system", content: "You are a Saudi Arabia B2B corporate intelligence analyst. Provide factual, verified data only. Never hallucinate." },
                { role: "user", content: `What is publicly known about Saudi company "${companyName}"${crRef}${cityRef}? Provide: ownership structure (shareholders with %), CEO & executives (EN+AR names), revenue, employees, website, key clients, competitors, and market position.` },
              ],
            }),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 25000)),
          ]);
          return (r as { choices: Array<{ message: { content?: string | null } }> }).choices[0]?.message?.content || null;
        } catch { return null; }
      })(),
    ]);

    // ── Phase 2: Compile context ───────────────────────────────────────────────
    const contextParts: string[] = [];
    if (knownFacts) contextParts.push(`[Known Facts Provided]\n${knownFacts}`);
    if (websiteCrawl.status === "fulfilled" && websiteCrawl.value) {
      const ws = websiteCrawl.value as WebSeederResult;
      if (ws.success && ws.aggregated) {
        const agg = ws.aggregated as Record<string, unknown>;
        const parts: string[] = [];
        if (agg.company) parts.push(`Company overview: ${JSON.stringify(agg.company)}`);
        if (Array.isArray(agg.services) && (agg.services as unknown[]).length > 0)
          parts.push(`Services/products: ${(agg.services as string[]).join(", ")}`);
        if (Array.isArray(agg.team) && (agg.team as unknown[]).length > 0)
          parts.push(`Team & leadership: ${JSON.stringify(agg.team)}`);
        if (Array.isArray(agg.news) && (agg.news as unknown[]).length > 0)
          parts.push(`Recent news: ${JSON.stringify(agg.news)}`);
        if (Array.isArray(agg.projects) && (agg.projects as unknown[]).length > 0)
          parts.push(`Projects: ${JSON.stringify(agg.projects)}`);
        if (agg.intelligence) parts.push(`B2B intelligence: ${JSON.stringify(agg.intelligence)}`);
        if (parts.length > 0)
          contextParts.push(`[Company Website — Multi-Page Intelligence (${ws.pagesAnalyzed} pages crawled)]\n${parts.join("\n")}`);
        if (ws.allEmails?.length) contextParts.push(`[Emails from Website] ${ws.allEmails.join(", ")}`);
        if (ws.allPhones?.length) contextParts.push(`[Phones from Website] ${ws.allPhones.join(", ")}`);
      }
    }
    if (geminiProfile.status === "fulfilled" && geminiProfile.value)
      contextParts.push(`[Gemini: Full Profile]\n${String(geminiProfile.value).slice(0, 3000)}`);
    if (geminiOwnership.status === "fulfilled" && geminiOwnership.value)
      contextParts.push(`[Gemini: Ownership & Shareholders]\n${String(geminiOwnership.value).slice(0, 2500)}`);
    if (geminiLeadership.status === "fulfilled" && geminiLeadership.value)
      contextParts.push(`[Gemini: Executives & Board]\n${String(geminiLeadership.value).slice(0, 2500)}`);
    if (geminiMarket.status === "fulfilled" && geminiMarket.value)
      contextParts.push(`[Gemini: Market Intelligence]\n${String(geminiMarket.value).slice(0, 2500)}`);
    if (geminiFinancials.status === "fulfilled" && geminiFinancials.value)
      contextParts.push(`[Gemini: Financial Intelligence — Revenue, Capital, Compensation]\n${String(geminiFinancials.value).slice(0, 2500)}`);
    if (searchProfile.status === "fulfilled" && searchProfile.value)
      contextParts.push(`[Web Search: Profile]\n${searchProfile.value.slice(0, 2500)}`);
    if (searchFinancials.status === "fulfilled" && searchFinancials.value)
      contextParts.push(`[Web Search: Financials]\n${(searchFinancials.value as string).slice(0, 2000)}`);
    if (searchOwnership.status === "fulfilled" && searchOwnership.value)
      contextParts.push(`[Web Search: Ownership]\n${(searchOwnership.value as string).slice(0, 2000)}`);
    if (searchLeadership.status === "fulfilled" && searchLeadership.value)
      contextParts.push(`[Web Search: Leadership]\n${(searchLeadership.value as string).slice(0, 2000)}`);
    if (claudeRes.status === "fulfilled" && claudeRes.value)
      contextParts.push(`[Claude Analysis]\n${claudeRes.value.slice(0, 2500)}`);
    if (openaiRes.status === "fulfilled" && openaiRes.value)
      contextParts.push(`[OpenAI Analysis]\n${openaiRes.value.slice(0, 2000)}`);

    const combinedContext = contextParts.join("\n\n---\n\n").slice(0, 14000);
    const sellerCtxText = sellerContext
      ? `\nSeller Context: We are from "${sellerContext.companyName || ""}", selling "${sellerContext.product || ""}", objective: ${sellerContext.objectives?.join(", ") || "business development"}.`
      : "";

    // ── Phase 3: Gemini synthesis → structured report ─────────────────────────
    const synthesisPrompt = `You are a senior Saudi Arabia corporate intelligence analyst. Generate a comprehensive company intelligence dossier for "${companyName}"${crRef}${cityRef}.${sellerCtxText}

Use ALL research data below. Do NOT invent data — if something is unknown, say "Not found" or "Unknown".

RESEARCH DATA:
${combinedContext}

Return ONLY valid JSON in this exact structure:
{
  "profile": {
    "nameEn": "Company name in English",
    "nameAr": "اسم الشركة بالعربية",
    "legalForm": "LLC/JSC/Partnership/etc",
    "legalFormAr": "شركة ذات مسؤولية محدودة / etc",
    "crNumber": "10-digit CR or null",
    "founded": "YYYY or null",
    "city": "city name or null",
    "address": "full address or null",
    "website": "https://... or null",
    "phone": "+966... or null",
    "email": "email or null",
    "industry": "main industry or null",
    "mainActivity": "primary business activity description",
    "mainActivityAr": "وصف النشاط الرئيسي"
  },
  "financials": {
    "revenueEstimate": "SAR X million or null",
    "revenueRange": "e.g. SAR 10M-50M or null",
    "revenueRationale": "brief explanation of how estimate was derived",
    "employeeCount": "number or range e.g. 50-200 or null",
    "paidUpCapital": "SAR X,XXX,XXX or null",
    "profitabilityIndicator": "Profitable/Loss-making/Break-even/Unknown",
    "growthSignals": ["list of 2-3 growth signals or empty array"],
    "recentFinancialNews": "any recent financial news or null"
  },
  "ownership": {
    "structure": "Family-owned/State-owned/Publicly-listed/Private/etc or null",
    "shareholders": [
      {"nameEn": "", "nameAr": "", "ownershipPct": "XX%", "nationality": "Saudi/Other", "type": "Individual/Corporate"}
    ],
    "isPubliclyListed": false,
    "stockExchange": "Tadawul/etc or null",
    "ticker": "stock ticker or null"
  },
  "leadership": {
    "ceo": {"nameEn": "", "nameAr": "", "title": "CEO/GM/Managing Director"},
    "boardChairman": {"nameEn": "", "nameAr": ""},
    "executives": [
      {"nameEn": "", "nameAr": "", "title": ""}
    ],
    "boardMembers": [
      {"nameEn": "", "nameAr": "", "role": "Chairman/Member/Independent"}
    ]
  },
  "operations": {
    "activities": ["list of business activities"],
    "products": ["key products or services"],
    "keyCients": ["notable clients or partners"],
    "subsidiaries": ["subsidiaries or affiliates"],
    "geographicPresence": ["cities or regions where active"]
  },
  "market": {
    "marketPosition": "description of market position",
    "marketShare": "estimated % or null",
    "competitors": ["list of competitor company names"],
    "strengths": ["2-3 key strengths"],
    "weaknesses": ["2-3 potential weaknesses or risks"],
    "opportunities": ["2-3 growth opportunities"]
  },
  "approach": {
    "bestChannel": "LinkedIn/Phone/Email/Referral/etc",
    "bestTiming": "suggested outreach timing",
    "entryPoint": "name and title of best person to contact",
    "valueProp": "tailored value proposition for this company",
    "openingAngle": "specific conversation opener",
    "potentialObjections": ["2-3 likely objections"],
    "culturalNotes": "Saudi business culture notes",
    "sampleMessage": "1-2 sentence opening message"
  },
  "news": [
    {"title": "headline", "date": "YYYY-MM or approx", "summary": "brief summary", "source": "source name"}
  ],
  "intelligence": {
    "confidenceScore": 0,
    "dataQuality": "high/medium/low",
    "verifiedFacts": ["list of facts confirmed by multiple sources"],
    "estimatedFacts": ["list of facts that are estimates or single-source"],
    "caveats": "any important caveats or limitations",
    "dataSources": ["list of sources used"]
  },
  "executiveSummary": "2-3 paragraph English executive summary of the company for B2B sales intelligence"
}`;

    // ── Phase 3: Claude (primary) + Gemini (secondary) synthesis in parallel ──
    // NOTE: generateWithGemini returns string|null (pure text generation, no tools)
    //       deepResearchWithGemini returns {text,groundingChunks}|null — NEVER use for synthesis
    let report: Record<string, unknown> = {};

    function tryParseReport(raw: string | null | undefined): Record<string, unknown> | null {
      if (!raw) return null;
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        return parsed.profile ? parsed : null;
      } catch { return null; }
    }

    const [claudeSynthResult, geminiSynthResult] = await Promise.allSettled([
      // Claude (primary — most reliable for large structured output)
      (async () => {
        try {
          const msg = await Promise.race([
            anthropic.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 4000,
              messages: [{ role: "user", content: synthesisPrompt }],
            }),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 120000)),
          ]);
          const text = (msg as { content: Array<{ type: string; text?: string }> }).content[0]?.type === "text"
            ? (msg as { content: Array<{ type: string; text?: string }> }).content[0].text!
            : null;
          return tryParseReport(text);
        } catch { return null; }
      })(),
      // Gemini (secondary — pure text generation, no web tools)
      isGeminiConfigured()
        ? (async () => {
          try {
            const text = await generateWithGemini(
              synthesisPrompt,
              "You are a Saudi Arabia corporate intelligence analyst. Return ONLY valid JSON, no markdown fences.",
              "gemini-2.5-flash"
            );
            return tryParseReport(text);
          } catch { return null; }
        })()
        : Promise.resolve(null),
    ]);

    // Use first valid result: Claude wins if both succeed
    if (claudeSynthResult.status === "fulfilled" && claudeSynthResult.value) {
      report = claudeSynthResult.value;
    } else if (geminiSynthResult.status === "fulfilled" && geminiSynthResult.value) {
      report = geminiSynthResult.value;
    } else {
      // Both failed — try OpenAI directly as final fallback
      console.warn("[CompanyIntel] Claude+Gemini failed — trying OpenAI GPT-4o fallback");
      try {
        const openaiDirectKey = process.env.OPENAI_API_KEY;
        if (openaiDirectKey) {
          const OpenAIDirect = (await import("openai")).default;
          const directClient = new OpenAIDirect({ apiKey: openaiDirectKey });
          const r = await Promise.race([
            directClient.chat.completions.create({
              model: "gpt-4o",
              max_completion_tokens: 4000,
              messages: [
                { role: "system", content: "You are a Saudi Arabia corporate intelligence analyst. Return ONLY valid JSON matching the schema exactly. No markdown." },
                { role: "user", content: synthesisPrompt },
              ],
            }),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 90000)),
          ]);
          const oaText = r.choices[0]?.message?.content || null;
          const oaReport = tryParseReport(oaText);
          if (oaReport) {
            report = oaReport;
          } else {
            throw new Error("GPT-4o parse failed");
          }
        } else {
          throw new Error("no direct key");
        }
      } catch {
        // NEXUS Fallback: try OpenRouter (DeepSeek/Qwen) when all primary engines fail
        const nexusStatus = getLLMStatus();
        if (nexusStatus.openrouter.configured || nexusStatus.groq.configured) {
          console.warn("[CompanyIntel] Trying NEXUS OpenRouter fallback synthesis...");
          try {
            const nexusResult = await nexusGenerate(synthesisPrompt, {
              tier: "synthesis",
              systemPrompt: "You are a Saudi Arabia corporate intelligence analyst. Return ONLY valid JSON matching the schema exactly. No markdown fences.",
              maxTokens: 4000,
              timeoutMs: 90000,
            });
            const nexusReport = tryParseReport(nexusResult.text);
            if (nexusReport) {
              console.info(`[CompanyIntel] NEXUS fallback succeeded via ${nexusResult.provider}/${nexusResult.model}`);
              report = nexusReport;
            } else {
              throw new Error("NEXUS parse failed");
            }
          } catch {
            console.error("[CompanyIntel] All synthesis engines including NEXUS failed");
            report = {
              profile: { nameEn: companyName, nameAr: null, city: city || null, crNumber: crNumber || null },
              financials: {}, ownership: { shareholders: [] },
              leadership: { executives: [] }, operations: {}, market: {},
              approach: {}, news: [],
              intelligence: { confidenceScore: 0, dataQuality: "low", caveats: "All synthesis engines were temporarily unavailable. Please try again in a moment.", dataSources: [] },
              executiveSummary: `Research for "${companyName}" was initiated but synthesis could not complete. Please retry — this is typically a temporary API load issue.`,
            };
          }
        } else {
          console.error("[CompanyIntel] All three synthesis engines failed — NEXUS not configured");
          report = {
            profile: { nameEn: companyName, nameAr: null, city: city || null, crNumber: crNumber || null },
            financials: {}, ownership: { shareholders: [] },
            leadership: { executives: [] }, operations: {}, market: {},
            approach: {}, news: [],
            intelligence: { confidenceScore: 0, dataQuality: "low", caveats: "Synthesis engines were temporarily unavailable. Please try again in a moment.", dataSources: [] },
            executiveSummary: `Research for "${companyName}" was initiated but synthesis could not complete. Please retry — this is typically a temporary API load issue.`,
          };
        }
      }
    }

    // Layer 6 — Activepieces (non-blocking)
    const rpt = report as Record<string, unknown>;
    const executives = (rpt.leadership as Record<string, unknown>)?.executives as unknown[];
    onProsEngineComplete({
      mode: "company",
      subject: companyName,
      agentsRun: ((rpt.intelligence as Record<string, unknown>)?.dataSources as unknown[])?.length || 7,
      insightsGenerated: Object.keys(rpt).length,
      hasContacts: !!(executives?.length),
    }).catch(() => {});

    res.json(report);
  } catch (err) {
    console.error("[CompanyIntel] profile error:", err);
    res.status(500).json({ error: "Failed to generate company intelligence report" });
  }
});

// ─── POST /api/company-intel/save ─────────────────────────────────────────────
router.post("/company-intel/save", async (req: Request, res: Response): Promise<void> => {
  const { companyName, website, crNumber, city, sellerContext, intelligenceGoals, knownFacts, report, tags, notes } = req.body as {
    companyName: string; website?: string; crNumber?: string; city?: string;
    sellerContext?: object; intelligenceGoals?: string[]; knownFacts?: string;
    report: object; tags?: string; notes?: string;
  };
  if (!companyName || !report) { res.status(400).json({ error: "companyName and report required" }); return; }
  try {
    const [row] = await db.insert(companyIntelResearchTable).values({
      companyName,
      website: website ?? null,
      crNumber: crNumber ?? null,
      city: city ?? null,
      sellerContext: sellerContext ? JSON.stringify(sellerContext) : null,
      intelligenceGoals: intelligenceGoals ? JSON.stringify(intelligenceGoals) : null,
      knownFacts: knownFacts ?? null,
      report: JSON.stringify(report),
      tags: tags ?? null,
      notes: notes ?? null,
    }).returning();
    res.json(row);
  } catch (err) {
    console.error("[CompanyIntel] save error:", err);
    res.status(500).json({ error: "Failed to save company intelligence" });
  }
});

// ─── GET /api/company-intel/saved ─────────────────────────────────────────────
router.get("/company-intel/saved", async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.select().from(companyIntelResearchTable).orderBy(desc(companyIntelResearchTable.createdAt)).limit(100);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch saved company intelligence" });
  }
});

// ─── DELETE /api/company-intel/saved/:id ──────────────────────────────────────
router.delete("/company-intel/saved/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    await db.delete(companyIntelResearchTable).where(eq(companyIntelResearchTable.id, Number(req.params.id)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete" });
  }
});

// ─── POST /api/company-intel/web-seed ─────────────────────────────────────────
// ProsEngine Paginated Multi-Agent Web Seeder — on-demand endpoint.
// Delegates entirely to the shared runWebSeeder() library in lib/web-seeder.ts.
// The seeder also runs automatically in the background for every Company Intel
// profile request, every Person Intel request with a websiteUrl, and every
// Masar Database enrichment — no manual invocation needed.
// ──────────────────────────────────────────────────────────────────────────────
router.post("/company-intel/web-seed", async (req: Request, res: Response): Promise<void> => {
  const {
    rootUrl,
    maxPages = 10,
    enableSeeder = true,
    seedMode = "all",
    companyName = "",
  } = req.body as {
    rootUrl: string;
    maxPages?: number;
    enableSeeder?: boolean;
    seedMode?: "all" | "content" | "products" | "contact";
    companyName?: string;
  };

  if (!rootUrl?.trim()) { res.status(400).json({ error: "rootUrl is required" }); return; }
  if (!enableSeeder) { res.json({ skipped: true, reason: "Seeder disabled (enableSeeder: false)" }); return; }

  try {
    const result = await runWebSeeder(rootUrl.trim(), companyName, { maxPages, seedMode });
    if (!result.success) {
      res.status(422).json({ error: "No pages could be crawled from the provided URL", rootUrl });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error("[ProsEngine/web-seed] error:", err);
    res.status(500).json({ error: "Web seeder failed", details: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;

