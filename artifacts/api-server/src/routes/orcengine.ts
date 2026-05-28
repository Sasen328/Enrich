/**
 * OrcEngine Deep-Seed API
 * ─────────────────────────────────────────────────────────────────
 * POST /api/orcengine/scrape           — Start a multi-URL deep-research session
 * GET  /api/orcengine/scrape/:id       — Poll session status + results
 * POST /api/orcengine/scrape/:id/chat  — Chat with the scraped knowledge base
 * POST /api/orcengine/scrape/:id/seed  — Save profiles → builderCompaniesTable
 * POST /api/orcengine/export           — Export session data as JSON / CSV
 *
 * Research pipeline per URL (all parallel):
 *   StealthBrowser (Playwright + anti-detection)
 *   → crawl4ai (Playwright + AI extraction)
 *   → HTTP + cheerio fallback
 *   → 5 Perplexity threads
 *   → 3 Gemini Google-Search threads
 *   → Claude training-knowledge agent
 *   → GPT-4o training-knowledge agent
 *   → 6 sub-page crawls (about/team/leadership/contact)
 *   → Final 3-way synthesis (Gemini → Claude → GPT-4o)
 */

import { Router, type Request, type Response } from "express";
import { db, scrapeSessionsTable, builderCompaniesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { lazyAnthropic } from "../lib/llm-clients.js";
import OpenAI from "openai";
import { crawl4ai } from "../crawl4ai-engine.js";
import { StealthBrowser, HumanBehavior } from "../lib/stealth-browser.js";
import { deepResearchWithGemini, synthesizeWithGemini, isGeminiConfigured } from "../gemini-search.js";
import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";

const p = (x: string | string[]): string => Array.isArray(x) ? x[0] : x;

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = lazyAnthropic("OrcEngine");

// ── Perplexity web search ─────────────────────────────────────────────────────
async function perplexitySearch(query: string, maxTokens = 2000): Promise<string> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return "";
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: query }],
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(22000),
    });
    if (resp.ok) {
      const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content || "";
    }
  } catch { /* ignore */ }
  // Gemini fallback
  if (isGeminiConfigured()) {
    try {
      const r = await Promise.race([
        deepResearchWithGemini(query, "You are a Saudi Arabia B2B intelligence researcher.", "gemini-2.5-flash"),
        new Promise<null>(res => setTimeout(() => res(null), 30000)),
      ]);
      return (r as { text?: string } | null)?.text || "";
    } catch { return ""; }
  }
  return "";
}

// ── Full-stack website crawler: StealthBrowser → crawl4ai → HTTP ─────────────
async function fullStackCrawl(url: string, label = "page"): Promise<{
  text: string; html: string; emails: string[]; phones: string[];
}> {
  let text = "", html = "", emails: string[] = [], phones: string[] = [];
  const domain = url.replace(/^https?:\/\//, "").split("/")[0];

  const browser = new StealthBrowser((msg) => console.log(`[Orcengine:${label}] ${msg}`));
  try {
    await browser.start(domain);
    await browser.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    await HumanBehavior.idle(800, 2000);
    html = await browser.getContent() || "";
    if (html.length > 500) {
      const $ = cheerio.load(html);
      $("script, style, nav, footer").remove();
      text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 10000);
      emails = [...new Set(text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [])];
      phones = [...new Set(text.match(/(?:\+966|00966|0)\s?\d{2}\s?\d{3}\s?\d{4}/g) || [])];
      console.log(`[Orcengine:StealthBrowser] ${label} — ${text.length} chars`);
    }
  } catch (e) {
    console.warn(`[Orcengine:StealthBrowser] ${label} failed:`, (e as Error).message?.slice(0, 80));
  } finally {
    try { await browser.stop(); } catch { /* ignore */ }
  }

  if (text.length < 1000) {
    try {
      const r = await crawl4ai(url);
      if (r?.text && r.text.length > text.length) {
        text = r.text.slice(0, 10000);
        if (r.emails) emails = [...new Set([...emails, ...r.emails])];
        if (r.phones) phones = [...new Set([...phones, ...r.phones])];
      }
    } catch { /* ignore */ }
  }

  if (text.length < 300) {
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.8",
        },
      });
      if (resp.ok) {
        const rawHtml = await resp.text();
        const $ = cheerio.load(rawHtml);
        $("script, style, nav, footer, header").remove();
        const plain = $("body").text().replace(/\s+/g, " ").trim().slice(0, 10000);
        if (plain.length > text.length) { text = plain; html = rawHtml; }
        emails = [...new Set([...emails, ...(plain.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [])])];
        phones = [...new Set([...phones, ...(plain.match(/(?:\+966|00966|0)\s?\d{2}\s?\d{3}\s?\d{4}/g) || [])])];
      }
    } catch { /* ignore */ }
  }

  return { text, html, emails, phones };
}

// ── Deep-research a single URL → structured company profile JSON ──────────────
async function deepResearchUrl(url: string): Promise<Record<string, unknown>> {
  const domain = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const origin = `https://${domain}`;
  const companyQuery = domain.replace(/\.(com|sa|org|net|co)\.?(sa)?$/i, "").replace(/-/g, " ");

  const SUB_PAGE_URLS = [
    `${origin}/about`, `${origin}/about-us`, `${origin}/who-we-are`,
    `${origin}/team`, `${origin}/our-team`, `${origin}/management`, `${origin}/leadership`,
    `${origin}/contact`, `${origin}/contact-us`,
    `${origin}/en/about`, `${origin}/en/team`, `${origin}/ar/about`,
  ];

  // ── All agents fire simultaneously ────────────────────────────────────────
  const [
    crawlResult,
    pOwnership, pLeadership, pSocial, pFinancials, pNews,
    geminiPeople, geminiCompany, geminiDeep,
    claudeKnowledge, gptKnowledge,
    ...subPageResults
  ] = await Promise.allSettled([

    // AGENT 1: Full website crawl (StealthBrowser → crawl4ai → HTTP)
    fullStackCrawl(url, domain),

    // AGENTS 2-6: Perplexity — 5 parallel web-search threads
    perplexitySearch(`"${companyQuery}" Saudi Arabia shareholders founders owners equity investors ${domain}`, 2000),
    perplexitySearch(`"${companyQuery}" Saudi Arabia CEO managing director founder board directors executives ${domain}`, 2000),
    perplexitySearch(`"${companyQuery}" Saudi Arabia LinkedIn company Twitter Instagram YouTube social media ${domain}`, 1500),
    perplexitySearch(`"${companyQuery}" Saudi Arabia revenue employees capital funding valuation CR number ${domain}`, 1500),
    perplexitySearch(`"${companyQuery}" Saudi Arabia contracts news awards tenders expansion 2024 2025 ${domain}`, 1500),

    // AGENT 7: Gemini — key people (Google Search grounded)
    isGeminiConfigured()
      ? deepResearchWithGemini(
          `Find all key people at ${companyQuery} (${domain}) Saudi Arabia. CEO, founders, board, shareholders, C-suite. Full names, LinkedIn URLs, backgrounds.`,
          "Elite Saudi B2B intelligence analyst. Be specific — full names, exact titles, LinkedIn URLs.",
          "gemini-2.5-pro"
        ).then(r => r?.text ?? null)
      : Promise.resolve(null),

    // AGENT 8: Gemini — company intelligence (Google Search grounded)
    isGeminiConfigured()
      ? deepResearchWithGemini(
          `Company intelligence for ${companyQuery} (${url}) Saudi Arabia: CR number, paid-up capital, legal form, revenue, employees, offices, clients, Vision 2030 projects, all social media URLs.`,
          "Elite Saudi B2B intelligence analyst. Specific numbers, dates, verified data.",
          "gemini-2.5-flash"
        ).then(r => r?.text ?? null)
      : Promise.resolve(null),

    // AGENT 9: Gemini — comprehensive sweep (Google Search grounded)
    isGeminiConfigured()
      ? deepResearchWithGemini(
          `Full B2B intelligence profile for ${companyQuery} (${url}) Saudi Arabia: overview, all executives with LinkedIn URLs, all shareholders with %, financials, CR number, social media, news 2024-2025.`,
          "Elite Saudi B2B intelligence analyst. Exhaustive and specific.",
          "gemini-2.5-flash"
        ).then(r => r?.text ?? null)
      : Promise.resolve(null),

    // AGENT 10: Claude — training-data knowledge base
    (async () => {
      try {
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 3000,
          system: "Elite Saudi Arabia B2B intelligence analyst. Extract ALL facts you know about the requested company from your training data.",
          messages: [{
            role: "user",
            content: `From your training data, what do you know about the company at ${url} (domain: ${domain}, company: "${companyQuery}") in Saudi Arabia?\n\nList ALL known facts: full name in English and Arabic, founders, CEO with LinkedIn URL, all known executives, shareholders with ownership %, CR number, revenue, employees, HQ location, products/services, clients, social media URLs, recent news, Vision 2030 alignment.\n\nLabel uncertain information clearly.`,
          }],
        });
        return msg.content[0]?.type === "text" ? msg.content[0].text : null;
      } catch { return null; }
    })(),

    // AGENT 11: GPT-4o — training-data knowledge base
    (async () => {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "Elite Saudi Arabia B2B intelligence analyst. Extract ALL facts you know about the requested company from your training data." },
            { role: "user", content: `From your training data, what do you know about the company at ${url} (domain: ${domain}, company: "${companyQuery}") in Saudi Arabia?\n\nList ALL known facts: full name, founders, CEO with LinkedIn URL, executives, shareholders with %, CR number, revenue, employees, HQ, products/services, clients, social media URLs, recent news.\n\nLabel uncertain information clearly.` },
          ],
          max_completion_tokens: 3000,
        });
        return completion.choices[0]?.message?.content ?? null;
      } catch { return null; }
    })(),

    // AGENTS 12+: Sub-page crawls (about/team/leadership/contact)
    ...SUB_PAGE_URLS.slice(0, 6).map(async (subUrl) => {
      try {
        const r = await crawl4ai(subUrl);
        const text = (r?.text || "").slice(0, 3000);
        return text.length > 150 ? { url: subUrl, text } : null;
      } catch { return null; }
    }),
  ]);

  const mainCrawl = crawlResult.status === "fulfilled" ? crawlResult.value : { text: "", html: "", emails: [], phones: [] };
  const { text: websiteText, emails, phones } = mainCrawl;
  const gv = (r: PromiseSettledResult<string | null>) => (r.status === "fulfilled" && r.value ? r.value : "");

  const subPageContent = subPageResults
    .map(r => r.status === "fulfilled" && r.value ? `\n--- ${(r.value as { url: string; text: string }).url} ---\n${(r.value as { url: string; text: string }).text}` : "")
    .filter(Boolean).join("\n").slice(0, 10000);

  const subEmails = subPageResults.flatMap(r => r.status !== "fulfilled" || !r.value ? [] : ((r.value as { text: string }).text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []));
  const subPhones = subPageResults.flatMap(r => r.status !== "fulfilled" || !r.value ? [] : ((r.value as { text: string }).text.match(/(?:\+966|00966|0)\s?\d{2}\s?\d{3}\s?\d{4}/g) || []));
  const allEmails = [...new Set([...emails, ...subEmails])];
  const allPhones = [...new Set([...phones, ...subPhones])];

  const ownershipText   = gv(pOwnership as PromiseSettledResult<string | null>);
  const leadershipText  = gv(pLeadership as PromiseSettledResult<string | null>);
  const socialText      = gv(pSocial as PromiseSettledResult<string | null>);
  const financialsText  = gv(pFinancials as PromiseSettledResult<string | null>);
  const newsText        = gv(pNews as PromiseSettledResult<string | null>);
  const geminiPeopleText  = gv(geminiPeople);
  const geminiCompanyText = gv(geminiCompany);
  const geminiDeepText    = gv(geminiDeep);
  const claudeText        = gv(claudeKnowledge);
  const gptText           = gv(gptKnowledge);

  const pxHits = [ownershipText, leadershipText, socialText, financialsText, newsText].filter(Boolean).length;
  const gmHits = [geminiPeopleText, geminiCompanyText, geminiDeepText].filter(Boolean).length;
  console.log(`[Orcengine] ${domain} — website: ${websiteText.length}c, subpages: ${subPageContent.length}c, perplexity: ${pxHits}/5, gemini: ${gmHits}/3, claude: ${claudeText.length > 0 ? "yes" : "no"}, gpt4o: ${gptText.length > 0 ? "yes" : "no"}`);

  // ── 3-way synthesis: Gemini (1st) → Claude (2nd) → GPT-4o (3rd) ─────────
  const SYSTEM = "You are an elite Saudi Arabia B2B intelligence analyst. Synthesize ALL data sources into one comprehensive structured company profile. Extract EVERY fact, name, number, and URL. For missing data not in any source, use null.";

  const EXTRACT_PROMPT = `Company URL: ${url} | Domain: ${domain}
${allEmails.length ? `Emails: ${allEmails.join(", ")}` : ""}
${allPhones.length ? `Phones: ${allPhones.join(", ")}` : ""}

=== SOURCE 1: WEBSITE (crawled via StealthBrowser/Playwright) ===
${websiteText || "(site could not be crawled — rely on external intelligence)"}

=== SOURCE 2: SUB-PAGES (about/team/leadership/contact) ===
${subPageContent || "(no sub-page content)"}

${ownershipText ? `=== SOURCE 3: PERPLEXITY — SHAREHOLDERS/FOUNDERS/OWNERSHIP ===\n${ownershipText}` : ""}
${leadershipText ? `=== SOURCE 4: PERPLEXITY — CEO/MANAGEMENT/BOARD ===\n${leadershipText}` : ""}
${socialText ? `=== SOURCE 5: PERPLEXITY — SOCIAL MEDIA/LINKEDIN ===\n${socialText}` : ""}
${financialsText ? `=== SOURCE 6: PERPLEXITY — REVENUE/EMPLOYEES/CAPITAL ===\n${financialsText}` : ""}
${newsText ? `=== SOURCE 7: PERPLEXITY — NEWS/CONTRACTS/AWARDS 2024-2025 ===\n${newsText}` : ""}
${geminiPeopleText ? `=== SOURCE 8: GEMINI — KEY PEOPLE & LEADERSHIP (Google Search) ===\n${geminiPeopleText}` : ""}
${geminiCompanyText ? `=== SOURCE 9: GEMINI — COMPANY INTELLIGENCE (Google Search) ===\n${geminiCompanyText}` : ""}
${geminiDeepText ? `=== SOURCE 10: GEMINI — COMPREHENSIVE OVERVIEW (Google Search) ===\n${geminiDeepText}` : ""}
${claudeText ? `=== SOURCE 11: CLAUDE — TRAINING KNOWLEDGE BASE ===\n${claudeText}` : ""}
${gptText ? `=== SOURCE 12: GPT-4o — TRAINING KNOWLEDGE BASE ===\n${gptText}` : ""}

SYNTHESIS RULES:
1. keyPeople MUST have AT LEAST 2 people — search all 12 sources.
2. CR number is 10 digits — search all sources for "1xxxxxxxxx" patterns.
3. NEVER leave a field null if any source contains the info.
4. Cross-reference Sources 8-12 (AI agents) with live web search sources 3-7.

Return ONLY valid JSON, no markdown:
{
  "nameEn": "English name",
  "nameAr": "Arabic name or null",
  "industry": "Primary industry",
  "subIndustry": "Sub-sector or null",
  "description": "3-4 sentence description",
  "founded": "YYYY or null",
  "website": "${url}",
  "phone": "Primary phone or null",
  "email": "Primary email or null",
  "address": "Full address or null",
  "city": "City or null",
  "region": "Region or null",
  "employees": "Count or range or null",
  "revenue": "Annual revenue with year or null",
  "ceo": "CEO full name or null",
  "ceoAr": "CEO Arabic name or null",
  "founders": ["Founder 1", "Founder 2"],
  "crNumber": "10-digit CR or null",
  "legalForm": "LLC / JSC / etc or null",
  "paidUpCapital": "Capital in SAR or null",
  "regulator": "SAMA / CMA / etc or null",
  "keyPeople": [
    { "nameEn": "Full name", "nameAr": "Arabic or null", "role": "CEO/Founder/Chairman/etc", "title": "Exact title", "ownershipPct": "% or null", "linkedin": "LinkedIn URL or null", "background": "2-3 sentence background", "nationality": "Saudi/Other/null" }
  ],
  "shareholders": [{ "nameEn": "Name", "nameAr": "Arabic or null", "ownershipPct": "% or null", "nationality": "Saudi/other or null", "role": "Chairman/Director/etc" }],
  "management": [{ "nameEn": "Name", "nameAr": "Arabic or null", "title": "Exact title", "linkedin": "LinkedIn URL or null" }],
  "board": [{ "nameEn": "Name", "nameAr": "Arabic or null", "role": "Chairman/Member/etc" }],
  "offices": [{ "city": "City", "address": "Address or null", "phone": "Phone or null", "email": "Email or null", "label": "Head Office / Branch" }],
  "products": ["Product 1", "Product 2"],
  "clients": ["Client 1", "Client 2"],
  "socialMedia": { "linkedin": "URL or null", "twitter": "URL or null", "instagram": "URL or null", "youtube": "URL or null", "snapchat": "handle or null" },
  "strengths": ["Advantage 1", "Advantage 2"],
  "marketPosition": "Market position paragraph",
  "recentNews": "Most recent news with dates",
  "fundingHistory": "Funding rounds or null",
  "aiInsights": "4-5 sentence B2B intelligence: key decision maker, buying triggers, outreach approach"
}`;

  const [geminiSynth, claudeSynth, gptSynth] = await Promise.allSettled([
    isGeminiConfigured()
      ? synthesizeWithGemini(EXTRACT_PROMPT, SYSTEM, "gemini-2.5-pro")
      : Promise.resolve(null),
    (async () => {
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: "user", content: EXTRACT_PROMPT }],
      });
      return msg.content[0]?.type === "text" ? msg.content[0].text : null;
    })(),
    (async () => {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: EXTRACT_PROMPT }],
        max_completion_tokens: 8000,
      });
      return completion.choices[0]?.message?.content ?? null;
    })(),
  ]);

  const getVal = (r: PromiseSettledResult<string | null | { text: string } | null>) => {
    if (r.status !== "fulfilled" || !r.value) return null;
    if (typeof r.value === "string") return r.value;
    if (typeof r.value === "object" && "text" in r.value) return r.value.text;
    return null;
  };

  const raw = getVal(geminiSynth) ?? getVal(claudeSynth) ?? getVal(gptSynth) ?? "{}";

  let profile: Record<string, unknown>;
  try {
    const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
    profile = JSON.parse(s !== -1 ? raw.slice(s, e + 1) : raw);
  } catch {
    profile = { nameEn: domain, description: "Could not parse company data.", website: url };
  }

  const safeStr = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === "string" && v !== "null") return v;
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  profile.ceo = safeStr(profile.ceo);
  profile.aiInsights = safeStr(profile.aiInsights);
  profile.marketPosition = safeStr(profile.marketPosition);
  profile.description = safeStr(profile.description);
  profile.recentNews = safeStr(profile.recentNews);
  if (!profile.email && allEmails.length > 0) profile.email = allEmails[0];
  if (!profile.phone && allPhones.length > 0) profile.phone = allPhones[0];
  profile._sourceUrl = url;
  profile._crawledChars = websiteText.length;
  profile._subPageChars = subPageContent.length;
  profile._agentsUsed = { perplexity: pxHits, gemini: gmHits, claude: claudeText.length > 0, gptKnowledge: gptText.length > 0 };

  return profile;
}

// ── POST /api/orcengine/scrape — Start deep-seed scraping session ─────────────
router.post("/orcengine/scrape", async (req: Request, res: Response): Promise<void> => {
  const { urls } = req.body as { urls?: string[] };
  if (!urls?.length) { res.status(400).json({ error: "urls array required" }); return; }

  const validUrls = urls.filter(u => {
    try { new URL(u); return true; } catch { return false; }
  });
  if (!validUrls.length) { res.status(400).json({ error: "No valid URLs provided" }); return; }

  try {
    // Create session record in DB
    const [session] = await db.insert(scrapeSessionsTable).values({
      urls: validUrls,
      knowledgeBase: [],
      chatHistory: [],
      status: "scraping",
      progress: 0,
    }).returning();

    console.log(`[Orcengine] Session #${session.id} — scraping ${validUrls.length} URLs`);

    // Start async deep research (fire and forget — polling via GET)
    (async () => {
      const results: Record<string, unknown>[] = [];
      for (let i = 0; i < validUrls.length; i++) {
        const url = validUrls[i];
        console.log(`[Orcengine] Session #${session.id} — researching (${i + 1}/${validUrls.length}): ${url}`);
        try {
          const profile = await deepResearchUrl(url);
          results.push(profile);
        } catch (err) {
          console.error(`[Orcengine] Session #${session.id} — failed: ${url}:`, (err as Error).message?.slice(0, 100));
          results.push({ _sourceUrl: url, nameEn: url, description: "Research failed", website: url });
        }
        const progress = Math.round(((i + 1) / validUrls.length) * 100);
        await db.update(scrapeSessionsTable)
          .set({
            knowledgeBase: results,
            progress,
            status: i === validUrls.length - 1 ? "ready" : "scraping",
          })
          .where(eq(scrapeSessionsTable.id, session.id));
      }
      console.log(`[Orcengine] Session #${session.id} — complete. ${results.length} profiles.`);
    })().catch(err => {
      console.error(`[Orcengine] Session #${session.id} — fatal error:`, (err as Error).message);
      db.update(scrapeSessionsTable).set({ status: "error" }).where(eq(scrapeSessionsTable.id, session.id)).catch(() => {});
    });

    res.json({ id: session.id });
  } catch (err) {
    console.error("[Orcengine] scrape error:", err);
    res.status(500).json({ error: "Failed to start scrape session" });
  }
});

// ── GET /api/orcengine/scrape/:id — Poll session status ──────────────────────
router.get("/orcengine/scrape/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(p(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session id" }); return; }

  const [session] = await db.select().from(scrapeSessionsTable).where(eq(scrapeSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  res.json({
    id: session.id,
    status: session.status,
    progress: session.progress,
    urls: session.urls,
    knowledgeBase: session.knowledgeBase || [],
    chatHistory: session.chatHistory || [],
    summary: session.summary,
    createdAt: session.createdAt,
  });
});

// ── POST /api/orcengine/scrape/:id/chat — Chat with scraped profiles ──────────
router.post("/orcengine/scrape/:id/chat", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(p(req.params.id));
  const { message } = req.body as { message?: string };
  if (isNaN(id) || !message?.trim()) { res.status(400).json({ error: "id and message required" }); return; }

  const [session] = await db.select().from(scrapeSessionsTable).where(eq(scrapeSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const profiles = (session.knowledgeBase || []) as Record<string, unknown>[];
  const context = profiles.map((p, i) => `=== COMPANY ${i + 1}: ${p.nameEn || p._sourceUrl} ===\n${JSON.stringify(p, null, 2).slice(0, 4000)}`).join("\n\n");

  const chatHistory = ((session.chatHistory || []) as Array<{ role: string; content: string }>);

  const systemPrompt = `You are an elite Saudi Arabia B2B intelligence analyst embedded inside ProspectSA.

The user has deep-scraped ${profiles.length} company website(s) using our multi-agent research system (StealthBrowser, Playwright, Perplexity, Gemini, Claude, GPT-4o). You have access to the full structured intelligence profiles below.

${context ? `=== SCRAPED COMPANY INTELLIGENCE ===\n${context}\n=== END ===` : "No company data available yet."}

RESPONSE RULES:
- Write in plain prose. No markdown formatting (#, **, *, backticks).
- Use short paragraphs. Be specific — names, numbers, dates.
- Ground everything in the intelligence above.
- Label estimates as "Estimated:".
- For sales outreach suggestions, be actionable and culturally sensitive to Saudi business culture.`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [...chatHistory.map(m => ({ role: m.role as "user" | "assistant", content: m.content })), { role: "user", content: message }],
    });
    const answer = msg.content[0]?.type === "text" ? msg.content[0].text : "I could not generate a response.";

    // Persist chat history
    const updated = [...chatHistory, { role: "user", content: message }, { role: "assistant", content: answer }];
    await db.update(scrapeSessionsTable).set({ chatHistory: updated }).where(eq(scrapeSessionsTable.id, id));

    res.json({ answer });
  } catch (err) {
    console.error("[Orcengine:chat] error:", err);
    // Fallback to GPT-4o
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: systemPrompt }, ...chatHistory.map(m => ({ role: m.role as "user" | "assistant", content: m.content })), { role: "user", content: message }],
        max_completion_tokens: 2000,
      });
      const answer = completion.choices[0]?.message?.content || "I could not generate a response.";
      res.json({ answer });
    } catch {
      res.status(500).json({ error: "Chat failed" });
    }
  }
});

// ── POST /api/orcengine/scrape/:id/seed — Save profiles to AI Database Builder ─
router.post("/orcengine/scrape/:id/seed", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(p(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid session id" }); return; }

  const [session] = await db.select().from(scrapeSessionsTable).where(eq(scrapeSessionsTable.id, id));
  if (!session || session.status !== "ready") { res.status(400).json({ error: "Session not ready" }); return; }

  const profiles = (session.knowledgeBase || []) as Record<string, unknown>[];
  if (!profiles.length) { res.status(400).json({ error: "No profiles to seed" }); return; }

  const jobId = `orcengine-seed-${uuidv4().slice(0, 8)}`;
  let seeded = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of profiles) {
    try {
      const nameEn = typeof p.nameEn === "string" ? p.nameEn.trim() : null;
      const nameAr = typeof p.nameAr === "string" ? p.nameAr.trim() : null;

      // Parse employee count
      let employeeCount: number | null = null;
      if (typeof p.employees === "string") {
        const num = parseInt(p.employees.replace(/[^0-9]/g, ""));
        if (!isNaN(num)) employeeCount = num;
      } else if (typeof p.employees === "number") {
        employeeCount = p.employees;
      }

      // Parse founding year
      let foundingYear: number | null = null;
      if (typeof p.founded === "string") {
        const yr = parseInt(p.founded);
        if (!isNaN(yr) && yr > 1900 && yr <= new Date().getFullYear()) foundingYear = yr;
      }

      // Serialize key executives and shareholders
      const keyExecutives = Array.isArray(p.keyPeople)
        ? JSON.stringify(p.keyPeople)
        : Array.isArray(p.management)
          ? JSON.stringify(p.management)
          : null;
      const shareholders = Array.isArray(p.shareholders) ? JSON.stringify(p.shareholders) : null;

      await db.insert(builderCompaniesTable).values({
        jobId,
        sourceId: `orcengine-${id}-${seeded + 1}`,
        sourceName: "OrcEngine Deep Seed",
        nameEn,
        nameAr,
        industry: typeof p.industry === "string" ? p.industry : null,
        city: typeof p.city === "string" ? p.city : null,
        region: typeof p.region === "string" ? p.region : null,
        website: typeof p.website === "string" ? p.website : (typeof p._sourceUrl === "string" ? p._sourceUrl : null),
        phone: typeof p.phone === "string" ? p.phone : null,
        email: typeof p.email === "string" ? p.email : null,
        address: typeof p.address === "string" ? p.address : null,
        description: typeof p.description === "string" ? p.description : null,
        employeeCount,
        revenue: typeof p.revenue === "string" ? p.revenue : null,
        foundingYear,
        crNumber: typeof p.crNumber === "string" ? p.crNumber : null,
        capitalAmount: typeof p.paidUpCapital === "string" ? p.paidUpCapital : null,
        entityType: typeof p.legalForm === "string" ? p.legalForm : null,
        ownerName: typeof p.ceo === "string" ? p.ceo : null,
        ownerNameAr: typeof p.ceoAr === "string" ? p.ceoAr : null,
        ownerTitle: "CEO / Managing Director",
        linkedinUrl: (p.socialMedia as Record<string, unknown>)?.linkedin as string | null ?? null,
        shareholders,
        keyExecutives,
        marketPositioning: typeof p.marketPosition === "string" ? p.marketPosition : null,
        recentNews: typeof p.recentNews === "string" ? p.recentNews : null,
        enrichmentStatus: "ai-enriched",
        enrichmentScore: 85,
        isValidated: false,
        isDuplicate: false,
      });
      seeded++;
    } catch (err) {
      errors.push(`${p._sourceUrl || p.nameEn}: ${(err as Error).message?.slice(0, 80)}`);
      skipped++;
    }
  }

  console.log(`[Orcengine] Session #${id} seeded — ${seeded} saved, ${skipped} skipped, job: ${jobId}`);
  res.json({ seeded, skipped, jobId, errors: errors.length > 0 ? errors : undefined });
});

// ── POST /api/orcengine/export — Export session data ─────────────────────────
router.post("/orcengine/export", async (req: Request, res: Response): Promise<void> => {
  const { title, type, data, format = "json" } = req.body as {
    title?: string;
    type?: string;
    data?: Record<string, unknown>;
    format?: "json" | "csv";
  };

  const records = (data?.records || []) as Record<string, unknown>[];

  if (format === "csv") {
    if (!records.length) { res.status(400).json({ error: "No records to export" }); return; }
    const keys = Object.keys(records[0]).filter(k => !k.startsWith("_"));
    const escape = (v: unknown) => {
      const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = [keys.join(","), ...records.map(r => keys.map(k => escape(r[k])).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${(title || "orcengine-export").replace(/[^a-z0-9]/gi, "_")}.csv"`);
    res.send(csv);
    return;
  }

  // JSON default
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${(title || "orcengine-export").replace(/[^a-z0-9]/gi, "_")}.json"`);
  res.json({ title, type, exportedAt: new Date().toISOString(), records });
});

export default router;
