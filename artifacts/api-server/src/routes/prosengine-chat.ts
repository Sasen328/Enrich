import { Router, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { crawl4ai } from "../crawl4ai-engine.js";
import { StealthBrowser, HumanBehavior } from "../lib/stealth-browser.js";
import { deepResearchWithGemini, synthesizeWithGemini, isGeminiConfigured } from "../gemini-search.js";
import { canSpend, recordSpend, enterJob } from "../lib/paid-api-guard.js";
import * as cheerio from "cheerio";
import { nexusGenerate } from "../lib/nexus/index.js";

import { scrapePage } from "../lib/power-scraper.js";

const p = (x: string | string[]): string => Array.isArray(x) ? x[0] : x;

// ── Shared full-stack crawler: NEXUS power-scraper (layers 1–4) ─────────────
async function fullStackCrawl(url: string, label = "page"): Promise<{
  text: string; html: string; emails: string[]; phones: string[];
}> {
  try {
    const result = await scrapePage(url, {
      engines: ["cheerio", "playwright", "playwright-stealth"],
      minContentLength: 400,
      timeoutMs: 20000,
    });

    return {
      text: result.text || "",
      html: result.html || "",
      emails: result.emails || [],
      phones: result.phones || [],
    };
  } catch (e) {
    console.warn(`[fullStackCrawl:${label}] power-scraper failed:`, e instanceof Error ? e.message : String(e));
    return { text: "", html: "", emails: [], phones: [] };
  }
}

// ── Web search: Perplexity → Gemini Google Search fallback ───────────────────
async function perplexitySearch(query: string, maxTokens = 2000): Promise<string> {
  const key = process.env.PERPLEXITY_API_KEY;

  // ── Primary: Perplexity (only inside a job + under budget) ────────────────
  if (key && canSpend("perplexity")) {
    try {
      const resp = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar",
          messages: [{ role: "user", content: query }],
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (resp.ok) {
        recordSpend("perplexity");
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
        "You are a Saudi Arabia B2B intelligence researcher. Search the web and provide accurate, current, specific information. Include names, numbers, dates, URLs where available.",
        "gemini-2.5-flash"
      );
      const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), 35000));
      const result = await Promise.race([geminiPromise, timeoutPromise]);
      return result?.text || "";
    } catch { return ""; }
  }

  return "";
}

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "dummy",
});

// ── Intent classifier: decides what research actions are needed ──────────────
type ChatIntent =
  | "answer_from_context"
  | "perplexity_search"
  | "crawl_url"
  | "deep_research";

function classifyIntent(userMsg: string, hasContext: boolean): ChatIntent {
  const lower = userMsg.toLowerCase();

  // Explicit deep-research triggers
  const deepTriggers = [
    "go deeper", "research this", "research further", "find more about",
    "use perplexity", "use claude", "use chatgpt", "use gpt", "use o4", "use o3",
    "deep research", "deep-research", "full research", "investigate", "dig deeper",
    "more details", "more information", "find out more", "tell me more about",
    "comprehensive report", "full dossier", "full profile",
  ];
  if (deepTriggers.some(t => lower.includes(t))) return "deep_research";

  // Perplexity search triggers
  const perplexityTriggers = [
    "search for", "look up", "find ", "what is", "who is", "news about",
    "recent ", "latest ", "current ", "2024", "2025", "today", "this year",
    "update", "new development", "announcement", "press release",
  ];
  if (perplexityTriggers.some(t => lower.includes(t))) return "perplexity_search";

  // URL crawl triggers
  const crawlTriggers = [
    "crawl", "scrape", "check their website", "visit the site", "extract from",
    "look at", "analyse the website", "analyze the website",
  ];
  if (crawlTriggers.some(t => lower.includes(t))) return "crawl_url";

  // Default: answer from pre-loaded context
  return "answer_from_context";
}

// ── Extract company name / website from context string ──────────────────────
function extractContextMeta(context: string): { companyName: string; websiteUrl: string } {
  const websiteMatch = context.match(/(?:Website|website|URL|url):\s*(https?:\/\/[^\s\n]+)/);
  const nameEnMatch = context.match(/Name \(EN\):\s*([^\n]+)/);
  const nameMatch = context.match(/(?:COMPANY INTELLIGENCE REPORT|Company:|companyName)[^\n]*\n[^\n]*?([\w][\w\s&'.-]{2,60})/i);
  const companyName = (nameEnMatch?.[1] || nameMatch?.[1] || "").trim();
  const websiteUrl = (websiteMatch?.[1] || "").trim();
  return { companyName, websiteUrl };
}

// ─── POST /prosengine/chat ─────────────────────────────────────────────────────
// Proactive AI assistant — classifies intent, then autonomously launches
// Perplexity searches, crawls, or DeepResearch before synthesising the answer.
// Accepts both { messages: [...] } (old) and { message: "string" } (new inline chat)
router.post("/prosengine/chat", async (req: Request, res: Response): Promise<void> => {
  const { messages, message, context, mode, model } = req.body as {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
    message?: string;
    context?: string;
    mode?: "person" | "website" | "seeder";
    model?: "claude-sonnet" | "claude-haiku" | "gpt-4o";
  };

  // Support both formats: single `message` string or full `messages` array
  const msgHistory: Array<{ role: "user" | "assistant"; content: string }> =
    messages?.length ? messages :
    message ? [{ role: "user", content: message }] :
    [];

  if (!msgHistory.length) { res.status(400).json({ error: "message or messages required" }); return; }

  // Explicit user-initiated research chat → permit paid APIs within budget.
  enterJob(`prosengine-chat:${Date.now()}`);

  const latestUserMsg = [...msgHistory].reverse().find(m => m.role === "user")?.content || "";

  // ── Classify intent ────────────────────────────────────────────────────────
  const intent = classifyIntent(latestUserMsg, !!context);
  console.log(`[ProsEngineChat] intent=${intent} msg="${latestUserMsg.slice(0, 60)}"`);

  // ── Gather live intelligence if needed ───────────────────────────────────
  const researchChunks: string[] = [];
  const researchSteps: string[] = [];

  if (intent === "perplexity_search" || intent === "deep_research") {
    const { companyName, websiteUrl } = extractContextMeta(context || "");
    const searchTarget = companyName || websiteUrl || latestUserMsg.slice(0, 100);

    // 2-query Perplexity in parallel
    const [p1, p2] = await Promise.allSettled([
      perplexitySearch(
        `Saudi Arabia B2B intelligence: ${searchTarget} — ${latestUserMsg}. Provide specific, verifiable facts, recent news, key executives, financial data.`,
        2000
      ),
      perplexitySearch(
        `${searchTarget} Saudi Arabia: latest developments, market position, key decision makers, contact info, business activities 2024-2025.`,
        1500
      ),
    ]);

    const px1 = p1.status === "fulfilled" ? p1.value : "";
    const px2 = p2.status === "fulfilled" ? p2.value : "";
    if (px1 || px2) {
      researchChunks.push(`=== LIVE PERPLEXITY RESEARCH ===\n${px1}\n\n${px2}`);
      researchSteps.push("Perplexity live search");
    }
  }

  if (intent === "crawl_url") {
    // Extract URL from the message or context
    const urlMatch = (latestUserMsg + (context || "")).match(/https?:\/\/[^\s"']+/);
    if (urlMatch) {
      const crawlRes = await fullStackCrawl(urlMatch[0], "chat-crawl");
      if (crawlRes.text) {
        researchChunks.push(`=== LIVE CRAWL: ${urlMatch[0]} ===\n${crawlRes.text.slice(0, 5000)}`);
        researchSteps.push(`Crawled ${urlMatch[0]}`);
      }
    }
  }

  if (intent === "deep_research") {
    const { companyName } = extractContextMeta(context || "");
    if (companyName || latestUserMsg) {
      const target = companyName || latestUserMsg.slice(0, 80);
      try {
        const drResp = await openai.responses.create({
          model: "o4-mini-deep-research-2025-06-26",
          input: [
            {
              role: "developer",
              content: [{ type: "input_text", text: "You are a Saudi Arabia B2B intelligence analyst. Provide comprehensive, verifiable data with sources." }],
            },
            {
              role: "user",
              content: [{ type: "input_text", text: `Deep research for Saudi Arabia B2B intelligence platform: ${target}\n\nSpecific question: ${latestUserMsg}\n\nProvide: verified facts, key people, financials, recent news, strategic intel. Be specific and cite sources.` }],
            },
          ],
          tools: [{ type: "web_search_preview" }],
        } as Parameters<typeof openai.responses.create>[0]);

        let drText = "";
        const output = ((drResp as unknown) as Record<string, unknown>).output as unknown[] || [];
        for (const item of output) {
          const i = item as Record<string, unknown>;
          if (i.type === "message" && Array.isArray(i.content)) {
            for (const block of i.content as Record<string, unknown>[]) {
              if (block.type === "output_text") drText += (block.text as string) + "\n";
            }
          }
        }
        if (drText) {
          researchChunks.push(`=== DEEP RESEARCH (o4-mini) ===\n${drText.slice(0, 6000)}`);
          researchSteps.push("DeepResearchAgent (o4-mini)");
        }
      } catch (drErr) {
        console.warn("[ProsEngineChat] DeepResearch fallback to GPT-4o:", (drErr as Error).message?.slice(0, 80));
        // Fallback: extended GPT-4o + Perplexity
        const fallback = await perplexitySearch(`Comprehensive intelligence: ${companyName || latestUserMsg}. All known facts, financials, leadership, strategic moves.`, 3000);
        if (fallback) {
          researchChunks.push(`=== DEEP RESEARCH (GPT-4o fallback) ===\n${fallback}`);
          researchSteps.push("Deep research (fallback)");
        }
      }
    }
  }

  const modeLabel =
    mode === "person" ? "Person Intelligence" :
    mode === "website" ? "Website Intelligence (Saudi company research)" :
    mode === "seeder" ? "Data Seeder (AI-powered Saudi company data generation)" :
    "Saudi B2B Intelligence";

  const liveResearchBlock = researchChunks.length > 0
    ? `\n=== LIVE RESEARCH GATHERED FOR THIS QUERY ===\n${researchChunks.join("\n\n")}\n=== END LIVE RESEARCH ===\n`
    : "";

  const systemPrompt = `You are an elite Saudi Arabia B2B intelligence analyst embedded inside ProspectSA.

Mode: ${modeLabel}

${context ? `=== COMPANY INTELLIGENCE (authoritative data) ===\n${context}\n=== END ===\n` : "No pre-loaded context — use Saudi market knowledge and label estimates clearly."}
${liveResearchBlock}

RESPONSE RULES (STRICT):
- Write in plain prose. NO markdown: no #, ##, ###, **, *, \`, or bullet dashes.
- Use short paragraphs separated by blank lines for structure.
- For lists, use plain numbered lines: "1. Item" or "- Item" (single dash only, no bold).
- Keep responses focused and concise — 3 to 6 paragraphs maximum.
- Always ground answers in the context above. Label estimates explicitly as "Estimated:".
- When live research was gathered, synthesise those findings prominently and cite them.
- When the user asks you to UPDATE or CORRECT a field (e.g. "change the CEO to X"), respond confirming the update AND return a JSON block at the very end of your reply in exactly this format (no other JSON):
  PROFILE_UPDATE:{"fieldName": "newValue"}
- Only include PROFILE_UPDATE when explicitly updating a specific field.

YOUR ROLE:
- Answer questions about this company with precision and depth
- Surface actionable sales/outreach insights and cultural context
- Identify key decision makers, growth signals, and competitive positioning
- Provide Saudi market intelligence and regulatory context
- Suggest outreach strategy and conversation angles`;

  let rawReply = "I couldn't generate a response. Please try again.";

  try {
    const latestMsg = msgHistory[msgHistory.length - 1]?.content as string || "";
    const [claudeResult, gptResult, nexusResult] = await Promise.allSettled([
      (async () => {
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          system: systemPrompt,
          messages: msgHistory,
        });
        return msg.content[0]?.type === "text" ? msg.content[0].text : null;
      })(),
      (async () => {
        if (model === "gpt-4o" || !process.env.ANTHROPIC_API_KEY) {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: systemPrompt }, ...msgHistory],
            max_completion_tokens: 2000,
          });
          return completion.choices[0]?.message?.content ?? null;
        }
        return null;
      })(),
      // NEXUS synthesis tier as 3rd parallel provider (Gemini → Claude → GPT-4o → DeepSeek)
      nexusGenerate(latestMsg, { tier: "synthesis", systemPrompt, maxTokens: 2000 }),
    ]);

    rawReply =
      (claudeResult.status === "fulfilled" && claudeResult.value) ||
      (gptResult.status === "fulfilled" && gptResult.value) ||
      (nexusResult.status === "fulfilled" && nexusResult.value.text) ||
      rawReply;
  } catch (e) {
    console.warn("[ProsEngineChat] error:", (e as Error).message?.substring(0, 80));
  }

  // Parse optional PROFILE_UPDATE block
  let profileUpdate: Record<string, unknown> | undefined;
  let reply = rawReply;
  const updateMatch = rawReply.match(/PROFILE_UPDATE:\s*(\{[\s\S]*?\})\s*$/);
  if (updateMatch) {
    try {
      profileUpdate = JSON.parse(updateMatch[1]);
      reply = rawReply.slice(0, updateMatch.index).trim();
    } catch { /* ignore parse errors */ }
  }

  res.json({ reply, profileUpdate, researchSteps: researchSteps.length > 0 ? researchSteps : undefined });
});

// ─── POST /prosengine/chat/stream ─────────────────────────────────────────────
// SSE streaming endpoint — emits { event, data } newline-delimited JSON events
// as research agents and the final LLM reply complete in real time.
router.post("/prosengine/chat/stream", async (req: Request, res: Response): Promise<void> => {
  const { messages, message, context, mode, model } = req.body as {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
    message?: string;
    context?: string;
    mode?: "person" | "website" | "seeder";
    model?: "claude-sonnet" | "claude-haiku" | "gpt-4o";
  };

  const msgHistory: Array<{ role: "user" | "assistant"; content: string }> =
    messages?.length ? messages :
    message ? [{ role: "user", content: message }] :
    [];

  if (!msgHistory.length) { res.status(400).json({ error: "message or messages required" }); return; }

  // ── Set up SSE ────────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const emit = (event: string, data: unknown) => {
    res.write(`data: ${JSON.stringify({ event, data })}\n\n`);
  };

  const latestUserMsg = [...msgHistory].reverse().find(m => m.role === "user")?.content || "";

  const intent = classifyIntent(latestUserMsg, !!context);
  emit("intent", { intent });

  const researchChunks: string[] = [];
  const researchSteps: string[] = [];

  // ── Live research agents (streamed progress) ──────────────────────────────
  if (intent === "perplexity_search" || intent === "deep_research") {
    const { companyName, websiteUrl } = extractContextMeta(context || "");
    const searchTarget = companyName || websiteUrl || latestUserMsg.slice(0, 100);

    emit("agent_start", { agent: "Perplexity search", description: `Searching for: ${searchTarget.slice(0, 60)}` });

    const [p1, p2] = await Promise.allSettled([
      perplexitySearch(`Saudi Arabia B2B intelligence: ${searchTarget} — ${latestUserMsg}. Specific verifiable facts, news, executives, financial data.`, 2000),
      perplexitySearch(`${searchTarget} Saudi Arabia: latest developments, market position, key decision makers 2024-2025.`, 1500),
    ]);

    const px1 = p1.status === "fulfilled" ? p1.value : "";
    const px2 = p2.status === "fulfilled" ? p2.value : "";

    if (px1 || px2) {
      emit("agent_done", { agent: "Perplexity search", found: true, preview: (px1 || px2).slice(0, 200) });
      researchChunks.push(`=== LIVE PERPLEXITY RESEARCH ===\n${px1}\n\n${px2}`);
      researchSteps.push("Perplexity live search");
    } else {
      emit("agent_done", { agent: "Perplexity search", found: false });
    }
  }

  if (intent === "crawl_url") {
    const urlMatch = (latestUserMsg + (context || "")).match(/https?:\/\/[^\s"']+/);
    if (urlMatch) {
      emit("agent_start", { agent: "URL crawl", description: `Crawling: ${urlMatch[0].slice(0, 60)}` });
      const crawlRes = await fullStackCrawl(urlMatch[0], "chat-crawl");
      if (crawlRes.text) {
        emit("agent_done", { agent: "URL crawl", found: true, preview: crawlRes.text.slice(0, 200) });
        researchChunks.push(`=== LIVE CRAWL: ${urlMatch[0]} ===\n${crawlRes.text.slice(0, 5000)}`);
        researchSteps.push(`Crawled ${urlMatch[0]}`);
      } else {
        emit("agent_done", { agent: "URL crawl", found: false });
      }
    }
  }

  if (intent === "deep_research") {
    const { companyName } = extractContextMeta(context || "");
    const target = companyName || latestUserMsg.slice(0, 80);
    emit("agent_start", { agent: "Deep research", description: `Deep research on: ${target.slice(0, 60)}` });
    try {
      const drResp = await openai.responses.create({
        model: "o4-mini-deep-research-2025-06-26",
        input: [
          { role: "developer", content: [{ type: "input_text", text: "Saudi Arabia B2B intelligence analyst. Factual, verifiable data with sources." }] },
          { role: "user", content: [{ type: "input_text", text: `Deep research: ${target}\n\nQuestion: ${latestUserMsg}\n\nProvide: verified facts, key people, financials, recent news, strategic intel.` }] },
        ],
        tools: [{ type: "web_search_preview" }],
      } as Parameters<typeof openai.responses.create>[0]);

      let drText = "";
      const output = ((drResp as unknown) as Record<string, unknown>).output as unknown[] || [];
      for (const item of output) {
        const i = item as Record<string, unknown>;
        if (i.type === "message" && Array.isArray(i.content)) {
          for (const block of i.content as Record<string, unknown>[]) {
            if (block.type === "output_text") drText += (block.text as string) + "\n";
          }
        }
      }
      if (drText) {
        emit("agent_done", { agent: "Deep research", found: true, preview: drText.slice(0, 200) });
        researchChunks.push(`=== DEEP RESEARCH (o4-mini) ===\n${drText.slice(0, 6000)}`);
        researchSteps.push("DeepResearchAgent (o4-mini)");
      } else {
        emit("agent_done", { agent: "Deep research", found: false });
      }
    } catch (drErr) {
      emit("agent_done", { agent: "Deep research", found: false, error: (drErr as Error).message?.slice(0, 80) });
      // Perplexity fallback
      const fallback = await perplexitySearch(`Comprehensive intelligence: ${target}. All known facts, financials, leadership, strategic moves.`, 3000);
      if (fallback) {
        researchChunks.push(`=== DEEP RESEARCH (fallback) ===\n${fallback}`);
        researchSteps.push("Deep research (fallback)");
      }
    }
  }

  // ── LLM synthesis ────────────────────────────────────────────────────────
  emit("synthesising", { researchSteps });

  const modeLabel =
    mode === "person" ? "Person Intelligence" :
    mode === "website" ? "Website Intelligence (Saudi company research)" :
    mode === "seeder" ? "Data Seeder (AI-powered Saudi company data generation)" :
    "Saudi B2B Intelligence";

  const liveResearchBlock = researchChunks.length > 0
    ? `\n=== LIVE RESEARCH GATHERED FOR THIS QUERY ===\n${researchChunks.join("\n\n")}\n=== END LIVE RESEARCH ===\n`
    : "";

  const systemPrompt = `You are an elite Saudi Arabia B2B intelligence analyst embedded inside ProspectSA.

Mode: ${modeLabel}

${context ? `=== COMPANY INTELLIGENCE (authoritative data) ===\n${context}\n=== END ===\n` : "No pre-loaded context — use Saudi market knowledge and label estimates clearly."}
${liveResearchBlock}

RESPONSE RULES (STRICT):
- Write in plain prose. NO markdown: no #, ##, ###, **, *, or bullet dashes.
- Use short paragraphs separated by blank lines for structure.
- For lists, use plain numbered lines: "1. Item" or "- Item" (single dash only, no bold).
- Keep responses focused and concise — 3 to 6 paragraphs maximum.
- Always ground answers in the context above. Label estimates explicitly as "Estimated:".
- When live research was gathered, synthesise those findings prominently and cite them.
- When the user asks you to UPDATE or CORRECT a field, respond confirming the update AND return a JSON block at the very end of your reply in exactly this format:
  PROFILE_UPDATE:{"fieldName": "newValue"}

YOUR ROLE:
- Answer questions about this company with precision and depth
- Surface actionable sales/outreach insights and cultural context
- Identify key decision makers, growth signals, and competitive positioning
- Provide Saudi market intelligence and regulatory context
- Suggest outreach strategy and conversation angles`;

  let rawReply = "I couldn't generate a response. Please try again.";
  try {
    const [claudeResult, gptResult] = await Promise.allSettled([
      (async () => {
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          system: systemPrompt,
          messages: msgHistory,
        });
        return msg.content[0]?.type === "text" ? msg.content[0].text : null;
      })(),
      (async () => {
        if (model === "gpt-4o" || !process.env.ANTHROPIC_API_KEY) {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: systemPrompt }, ...msgHistory],
            max_completion_tokens: 2000,
          });
          return completion.choices[0]?.message?.content ?? null;
        }
        return null;
      })(),
    ]);

    rawReply =
      (claudeResult.status === "fulfilled" && claudeResult.value) ||
      (gptResult.status === "fulfilled" && gptResult.value) ||
      rawReply;
  } catch (e) {
    console.warn("[ProsEngineChat/stream] error:", (e as Error).message?.substring(0, 80));
  }

  // Parse optional PROFILE_UPDATE block
  let profileUpdate: Record<string, unknown> | undefined;
  let reply = rawReply;
  const updateMatch = rawReply.match(/PROFILE_UPDATE:\s*(\{[\s\S]*?\})\s*$/);
  if (updateMatch) {
    try {
      profileUpdate = JSON.parse(updateMatch[1]);
      reply = rawReply.slice(0, updateMatch.index).trim();
    } catch { /* ignore */ }
  }

  emit("reply", { reply, profileUpdate, researchSteps });
  emit("done", {});
  res.end();
});

// ─── POST /prosengine/seed ─────────────────────────────────────────────────────
router.post("/prosengine/seed", async (req: Request, res: Response): Promise<void> => {
  const {
    prompt, industry, city, recordType = "companies", count = 20,
    fields, extraContext,
  } = req.body as {
    prompt: string;
    industry?: string;
    city?: string;
    recordType?: "companies" | "executives" | "both";
    count?: number;
    fields?: string[];
    extraContext?: string;
  };

  if (!prompt?.trim() && !industry) { res.status(400).json({ error: "prompt or industry required" }); return; }

  const safeCount = Math.min(count ?? 20, 50);

  const fieldsList = fields && fields.length > 0
    ? fields
    : recordType === "executives"
      ? ["fullName", "title", "company", "industry", "city", "email", "phone", "linkedin", "bio"]
      : recordType === "both"
        ? ["companyName", "industry", "city", "address", "website", "phone", "email", "ceoName", "ceoTitle", "employees", "revenue"]
        : ["companyName", "industry", "city", "address", "website", "phone", "email", "description", "employees", "revenue", "founded"];

  const systemPrompt = `You are a Saudi Arabia business intelligence data specialist. Generate realistic, plausible Saudi ${recordType} data. Use real Saudi company name patterns, real city names, and realistic Saudi market data. All generated data should be internally consistent and plausible for the Saudi market.`;

  const userPrompt = `Generate exactly ${safeCount} Saudi Arabia ${recordType} records.

REQUEST: ${prompt || `${industry || "general"} ${recordType} in ${city || "Saudi Arabia"}`}
${industry ? `Industry focus: ${industry}` : ""}
${city ? `City/region focus: ${city}` : ""}
${extraContext ? `Additional context: ${extraContext}` : ""}

Return a JSON object with EXACTLY this structure:
{
  "records": [
    {
      ${fieldsList.map(f => `"${f}": "value"`).join(",\n      ")}
    }
  ],
  "summary": "Brief description of what was generated",
  "market_insight": "One key Saudi market insight relevant to this data"
}

Rules:
- Use realistic Arabic/Saudi names following Saudi naming conventions
- Use real Saudi cities: Riyadh, Jeddah, Dammam, Khobar, Mecca, Medina, Tabuk, Abha, etc.
- Generate realistic Saudi phone numbers (+966 format)
- Use .sa or .com.sa domains where appropriate
- Revenue/employees should be realistic for Saudi SMEs to large corporations
- Include physical addresses in Saudi Arabia with district/street info
- All ${safeCount} records must have all fields populated (use "N/A" if genuinely unknown)
- Return valid JSON only, no markdown`;

  try {
    const [claudeResult, gptResult] = await Promise.allSettled([
      (async () => {
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 6000,
          messages: [
            { role: "user", content: `${systemPrompt}\n\n${userPrompt}` },
          ],
        });
        return msg.content[0]?.type === "text" ? msg.content[0].text : null;
      })(),
      (async () => {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_completion_tokens: 6000,
        });
        return completion.choices[0]?.message?.content ?? null;
      })(),
    ]);

    const raw = (claudeResult.status === "fulfilled" && claudeResult.value) ||
                (gptResult.status === "fulfilled" && gptResult.value) || "{}";

    let parsed: { records: unknown[]; summary: string; market_insight?: string };
    try {
      const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
      parsed = JSON.parse(s !== -1 ? raw.slice(s, e + 1) : raw);
    } catch {
      parsed = { records: [], summary: "Parsing error — please retry." };
    }
    res.json({ ...parsed, count: (parsed.records || []).length, fields: fieldsList });
  } catch (err) {
    console.error("[ProsEngineSeed] error:", err);
    res.status(500).json({ error: "Data generation failed" });
  }
});

// ─── POST /prosengine/analyze-url ─────────────────────────────────────────────
// Step 1 of URL Seeder: full-stack fetch URL content + Perplexity + generate questionnaire
router.post("/prosengine/analyze-url", async (req: Request, res: Response): Promise<void> => {
  const { url, description } = req.body as { url?: string; description?: string };
  if (!url) { res.status(400).json({ error: "url required" }); return; }

  // StealthBrowser → crawl4ai → plain HTTP in parallel with Perplexity
  const [crawlResult, perplexityContext] = await Promise.all([
    fullStackCrawl(url, "analyze-url"),
    perplexitySearch(
      `What kind of website or directory is ${url}? What Saudi companies are listed or linked from it? Provide names, industries, and contact details of any companies found.`,
      1000
    ),
  ]);

  const { text: pageText, html } = crawlResult;
  let pageTitle = "";
  if (html) {
    try { const $ = cheerio.load(html); pageTitle = $("title").text().trim(); } catch { /* ignore */ }
  }

  const contextBlock = [
    description ? `User description: ${description}` : "",
    pageTitle ? `Page title: ${pageTitle}` : "",
    pageText ? `Page content (StealthBrowser + crawl4ai + HTTP):\n${pageText.slice(0, 7000)}` : "",
    perplexityContext ? `Web search context (Perplexity):\n${perplexityContext}` : "",
  ].filter(Boolean).join("\n\n");

  const analysisPrompt = `You are analyzing a web page to help extract Saudi Arabian companies listed or referenced on it.

${contextBlock || `URL: ${url} (could not fetch content)`}

Based on this page, generate:
1. A brief assessment: what kind of page is this? What companies might be listed here?
2. A short questionnaire (3-5 targeted questions) to understand EXACTLY what the user wants to extract from it.

Questions should be specific to what you found on the page. For example:
- "This looks like a contractor registry — should I extract all listed contractors, or filter by city/sector?"
- "I see both companies and individuals — do you want companies only, or also executives?"
- "Do you want me to also follow sub-pages linked from this directory?"

Return ONLY valid JSON:
{
  "siteType": "Brief description of what this page/site is",
  "companiesDetected": "Estimated number of companies visible or linked",
  "questions": [
    { "id": "q1", "question": "Question text", "type": "choice", "options": ["Option A", "Option B", "Option C"] },
    { "id": "q2", "question": "Question text", "type": "boolean" },
    { "id": "q3", "question": "Question text", "type": "text", "placeholder": "e.g. healthcare, technology" }
  ]
}

Question types: "choice" (pick one from options), "boolean" (yes/no), "text" (free input).`;

  try {
    const [claudeResult, gptResult] = await Promise.allSettled([
      (async () => {
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          messages: [{ role: "user", content: analysisPrompt }],
        });
        return msg.content[0]?.type === "text" ? msg.content[0].text : null;
      })(),
      (async () => {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: analysisPrompt }],
          max_completion_tokens: 1500,
        });
        return completion.choices[0]?.message?.content ?? null;
      })(),
    ]);

    const raw = (claudeResult.status === "fulfilled" && claudeResult.value) ||
                (gptResult.status === "fulfilled" && gptResult.value) || "{}";

    let analysis: { siteType: string; companiesDetected: string; questions: unknown[] };
    try {
      const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
      analysis = JSON.parse(s !== -1 ? raw.slice(s, e + 1) : raw);
    } catch {
      analysis = {
        siteType: "Web directory or listing page",
        companiesDetected: "Multiple",
        questions: [
          { id: "q1", question: "What types of companies should I extract?", type: "choice", options: ["All companies listed", "Only companies with contact info", "Only Saudi-registered companies"] },
          { id: "q2", question: "Should I follow links to sub-pages to find more companies?", type: "boolean" },
          { id: "q3", question: "Any specific industry or sector to focus on?", type: "text", placeholder: "e.g. construction, healthcare (leave blank for all)" },
        ],
      };
    }

    res.json({ ...analysis, url, pageTitle });
  } catch (err) {
    console.error("[ProsEngineAnalyzeUrl] error:", err);
    res.status(500).json({ error: "URL analysis failed" });
  }
});

// ─── POST /prosengine/seed-from-url ───────────────────────────────────────────
// Step 2 of URL Seeder: FULL 11-agent company extraction from a URL (NO DB writes)
// Agents: StealthBrowser + crawl4ai + HTTP + 5 Perplexity + 3 Gemini (Google Search) + Claude + GPT-4o
router.post("/prosengine/seed-from-url", async (req: Request, res: Response): Promise<void> => {
  const { url, answers, description } = req.body as {
    url?: string;
    answers?: Record<string, string>;
    description?: string;
  };
  if (!url) { res.status(400).json({ error: "url required" }); return; }

  const answerContext = answers
    ? Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join("\n")
    : "";

  const domain = url.replace(/^https?:\/\//, "").split("/")[0];
  const origin = `https://${domain}`;
  const userFilters = answerContext ? `\n\nUser preferences: ${answerContext}` : "";
  const userDesc = description ? `\n\nUser description: ${description}` : "";

  // Discover sub-pages that may list more companies (pagination, categories, member lists)
  const SUB_URLS = [
    `${origin}/members`, `${origin}/companies`, `${origin}/directory`,
    `${origin}/suppliers`, `${origin}/partners`, `${origin}/contractors`,
    `${origin}/clients`, `${origin}/portfolio`, `${origin}/page/2`,
    `${origin}/ar/members`, `${origin}/en/companies`,
  ];

  console.log(`[SeedFromUrl] Full 11-agent extraction: ${url}`);

  // ── ALL 11 AGENTS FIRE IN PARALLEL ────────────────────────────────────────
  const [
    crawlResult,
    px1, px2, px3, px4, px5,
    gemini1, gemini2, gemini3,
    ...subPageResults
  ] = await Promise.allSettled([

    // AGENT 1: StealthBrowser → crawl4ai → HTTP (fullStackCrawl)
    fullStackCrawl(url, "seed-from-url"),

    // AGENTS 2-6: 5 Perplexity web-search threads
    perplexitySearch(
      `What Saudi companies are listed on ${domain}? Give company names in English and Arabic, phone, email, city, industry, website.`,
      2000
    ),
    perplexitySearch(
      `Companies at ${url} Saudi Arabia: full list with contact details (phone, email), addresses, CR numbers, CEOs, founding years.${userFilters}`,
      2000
    ),
    perplexitySearch(
      `${domain} Saudi Arabia company directory members suppliers clients: all names, industries, cities, websites, contacts.`,
      2000
    ),
    perplexitySearch(
      `Who are the companies listed on or associated with ${domain}? Names, sectors, executives, Saudi Arabia.`,
      1500
    ),
    perplexitySearch(
      `${domain} Saudi Arabia 2024 2025 member companies registered suppliers contractors — full list with details.`,
      1500
    ),

    // AGENTS 7-9: 3 Gemini Google-Search grounded threads
    isGeminiConfigured()
      ? deepResearchWithGemini(
          `List ALL companies found on ${url} Saudi Arabia. Include for each: company name EN + AR, industry, city, phone, email, website, CR number, CEO/owner.${userFilters}`,
          "Elite Saudi B2B intelligence analyst. Extract maximum company records. Be specific with names and contacts.",
          "gemini-2.5-flash"
        ).then(r => r?.text ?? null)
      : Promise.resolve(null),
    isGeminiConfigured()
      ? deepResearchWithGemini(
          `${domain} Saudi Arabia: complete company directory. All member companies, suppliers, or clients listed on this site. Names, sectors, contacts, leadership.`,
          "Elite Saudi B2B intelligence analyst. Comprehensive company extraction.",
          "gemini-2.5-flash"
        ).then(r => r?.text ?? null)
      : Promise.resolve(null),
    isGeminiConfigured()
      ? deepResearchWithGemini(
          `Extract all Saudi companies from ${url}: company names Arabic and English, industry sectors, cities, phone numbers, emails, CR registration numbers, owner/CEO names.${userDesc}`,
          "Elite Saudi B2B intelligence analyst. Return structured data.",
          "gemini-2.5-pro"
        ).then(r => r?.text ?? null)
      : Promise.resolve(null),

    // AGENTS 10+: Sub-page crawls (pagination, categories, member lists)
    ...SUB_URLS.slice(0, 5).map(async (subUrl) => {
      try {
        const r = await crawl4ai(subUrl);
        const text = (r?.text || "").slice(0, 3000);
        return text.length > 150 ? { url: subUrl, text } : null;
      } catch { return null; }
    }),
  ]);

  // ── Collect all gathered intelligence ─────────────────────────────────────
  const { text: pageText, html: pageHtml } = (crawlResult.status === "fulfilled" ? crawlResult.value : { text: "", html: "" }) as any;

  // Extract all anchor texts from HTML as company name clues
  const links: string[] = [];
  if (pageHtml) {
    try {
      const $ = cheerio.load(pageHtml);
      $("a[href]").each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 3 && text.length < 100) links.push(text);
      });
    } catch { /* ignore */ }
  }

  const gv = (r: PromiseSettledResult<string | null>) => (r.status === "fulfilled" && r.value ? r.value : "");

  const subPageContent = subPageResults
    .map(r => r.status === "fulfilled" && r.value ? `\n--- ${(r.value as { url: string; text: string }).url} ---\n${(r.value as { url: string; text: string }).text}` : "")
    .filter(Boolean).join("\n").slice(0, 8000);

  const px1t = gv(px1 as PromiseSettledResult<string | null>);
  const px2t = gv(px2 as PromiseSettledResult<string | null>);
  const px3t = gv(px3 as PromiseSettledResult<string | null>);
  const px4t = gv(px4 as PromiseSettledResult<string | null>);
  const px5t = gv(px5 as PromiseSettledResult<string | null>);
  const g1t  = gv(gemini1);
  const g2t  = gv(gemini2);
  const g3t  = gv(gemini3);

  const pxHits = [px1t, px2t, px3t, px4t, px5t].filter(Boolean).length;
  const gmHits = [g1t, g2t, g3t].filter(Boolean).length;
  console.log(`[SeedFromUrl] ${domain} — crawl: ${pageText.length}c, subpages: ${subPageContent.length}c, perplexity: ${pxHits}/5, gemini: ${gmHits}/3`);

  const aggregatedContext = [
    pageText ? `=== SOURCE 1: STEALTHBROWSER + CRAWL4AI + HTTP ===\n${pageText.slice(0, 5000)}` : "",
    subPageContent ? `=== SOURCE 2: LINKED SUB-PAGES (categories/members/page 2) ===\n${subPageContent}` : "",
    links.length ? `=== SOURCE 3: PAGE LINKS (company name clues) ===\n${links.slice(0, 100).join("\n")}` : "",
    px1t ? `=== SOURCE 4: PERPLEXITY — COMPANY LIST ===\n${px1t}` : "",
    px2t ? `=== SOURCE 5: PERPLEXITY — CONTACT DETAILS ===\n${px2t}` : "",
    px3t ? `=== SOURCE 6: PERPLEXITY — DIRECTORY SWEEP ===\n${px3t}` : "",
    px4t ? `=== SOURCE 7: PERPLEXITY — MEMBER COMPANIES ===\n${px4t}` : "",
    px5t ? `=== SOURCE 8: PERPLEXITY — 2024-2025 MEMBERS ===\n${px5t}` : "",
    g1t  ? `=== SOURCE 9: GEMINI (Google Search) — COMPANY EXTRACTION ===\n${g1t}` : "",
    g2t  ? `=== SOURCE 10: GEMINI (Google Search) — DIRECTORY SWEEP ===\n${g2t}` : "",
    g3t  ? `=== SOURCE 11: GEMINI PRO (Google Search) — DEEP EXTRACTION ===\n${g3t}` : "",
    answerContext ? `=== USER PREFERENCES ===\n${answerContext}` : "",
    description ? `=== USER DESCRIPTION ===\n${description}` : "",
  ].filter(Boolean).join("\n\n");

  const extractPrompt = `You are an elite Saudi Arabia B2B intelligence analyst. Extract EVERY company found across all intelligence sources below.

SOURCE URL: ${url}

AGGREGATED INTELLIGENCE FROM 11 AGENTS:
${aggregatedContext || "(Could not fetch content — use Gemini/Perplexity data only)"}

EXTRACTION RULES:
1. Include EVERY company mentioned across ALL sources — do not skip any.
2. Cross-reference sources to fill in missing fields (e.g. phone from Perplexity, city from Gemini).
3. Companies MUST be real entities — skip government ministries (unless they are registered commercial entities), individuals, and duplicates.
4. Merge duplicate companies (same name in different sources) into one enriched record.
5. If a field is unknown across ALL sources, use null — never invent data.

Return ONLY valid JSON, no markdown:
{
  "records": [
    {
      "companyName": "Company name in English",
      "companyNameAr": "اسم الشركة بالعربية or null",
      "industry": "Industry/sector or null",
      "city": "Saudi city or null",
      "address": "Physical address or null",
      "website": "Website URL or null",
      "phone": "Phone +966... or null",
      "email": "Email address or null",
      "description": "What this company does (1-2 sentences)",
      "employees": "Employee count or range or null",
      "revenue": "Revenue estimate or null",
      "founded": "Founding year YYYY or null",
      "crNumber": "10-digit CR number or null",
      "ceoName": "CEO / owner full name or null",
      "legalForm": "LLC / JSC / EST / other or null",
      "sourceNote": "Which source(s) this company was found in"
    }
  ],
  "summary": "Brief description of what was extracted from this source",
  "market_insight": "One key Saudi Arabia market insight from this intelligence"
}`;

  try {
    // ── 3-WAY SYNTHESIS: Gemini (1st) → Claude (2nd) → GPT-4o (3rd) ────────
    const [geminiSynth, claudeResult, gptResult] = await Promise.allSettled([
      isGeminiConfigured()
        ? synthesizeWithGemini(extractPrompt, "Elite Saudi B2B intelligence analyst. Extract maximum company records. Return valid JSON only.", "gemini-2.5-flash")
        : Promise.resolve(null),
      (async () => {
        try {
          const msg = await Promise.race([
            anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 6000, messages: [{ role: "user", content: extractPrompt }] }),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 45000)),
          ]);
          return (msg as { content: Array<{ type: string; text?: string }> }).content[0]?.type === "text" ? (msg as { content: Array<{ type: string; text?: string }> }).content[0].text! : null;
        } catch { return null; }
      })(),
      (async () => {
        try {
          const completion = await Promise.race([
            openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: extractPrompt }], max_completion_tokens: 6000 }),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 45000)),
          ]);
          return (completion as { choices: Array<{ message: { content?: string | null } }> }).choices[0]?.message?.content ?? null;
        } catch { return null; }
      })(),
    ]);

    const getVal = (r: PromiseSettledResult<string | null | { text: string } | null>) => {
      if (r.status !== "fulfilled" || !r.value) return null;
      if (typeof r.value === "string") return r.value;
      if (typeof r.value === "object" && "text" in r.value) return (r.value as { text: string }).text;
      return null;
    };

    const rawGemini = getVal(geminiSynth);
    const rawClaude = getVal(claudeResult);
    const rawGPT    = getVal(gptResult);

    // Primary: pick the source with most records (Gemini first if tied)
    const parseRecords = (raw: string | null): unknown[] => {
      if (!raw) return [];
      try {
        const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
        const p = JSON.parse(s !== -1 ? raw.slice(s, e + 1) : raw);
        return Array.isArray(p.records) ? p.records : [];
      } catch { return []; }
    };

    const geminiRecords = parseRecords(rawGemini);
    const claudeRecords = parseRecords(rawClaude);
    const gptRecords    = parseRecords(rawGPT);

    // Start with the biggest set, then supplement unique companies from others
    let primaryRecords = geminiRecords.length >= claudeRecords.length ? geminiRecords : claudeRecords;
    const primaryRaw = geminiRecords.length >= claudeRecords.length ? rawGemini : rawClaude;

    let parsed: { records: unknown[]; summary: string; market_insight?: string };
    try {
      const s = (primaryRaw || "").indexOf("{"); const e = (primaryRaw || "").lastIndexOf("}");
      const candidate = JSON.parse(s !== -1 ? (primaryRaw || "{}").slice(s, e + 1) : (primaryRaw || "{}")) as { records?: unknown[]; summary?: string };
      parsed = Array.isArray(candidate.records)
        ? (candidate as { records: unknown[]; summary: string; market_insight?: string })
        : { records: primaryRecords, summary: candidate.summary || "Extracted from multi-agent research." };
    } catch {
      parsed = { records: primaryRecords, summary: "Extracted from multi-agent research." };
    }

    // Supplement: add unique companies from other synthesis sources
    for (const extraRecords of [claudeRecords, gptRecords, geminiRecords]) {
      if (extraRecords === primaryRecords) continue;
      const existingNames = new Set(
        (parsed.records as Record<string, string>[]).map(r => (r.companyName || "").toLowerCase().trim())
      );
      const newRecords = (extraRecords as Record<string, string>[]).filter(
        r => r.companyName && !existingNames.has(r.companyName.toLowerCase().trim())
      );
      if (newRecords.length > 0) parsed.records = [...parsed.records, ...newRecords];
    }

    console.log(`[SeedFromUrl] ${domain} — extracted ${(parsed.records || []).length} companies`);
    res.json({ ...parsed, count: (parsed.records || []).length, url });
  } catch (err) {
    console.error("[ProsEngineSeedFromUrl] error:", err);
    res.status(500).json({ error: "Company extraction failed" });
  }
});

// ─── POST /prosengine/research-url ─────────────────────────────────────────────
// Full-depth company research: website crawl + 5 Perplexity queries + Gemini deep research → 3-way synthesis
router.post("/prosengine/research-url", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body as { url?: string };
  if (!url) { res.status(400).json({ error: "url required" }); return; }

  try {
    const domain = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const origin = `https://${domain}`;
    const companyQuery = domain.replace(/\.(com|sa|org|net|co)\.?(sa)?$/i, "").replace(/-/g, " ");
    console.log(`[ResearchUrl] Full deep research: ${url}`);

    // Key sub-pages to crawl — prioritise team, about, leadership, contact, legal
    const SUB_PAGE_URLS = [
      `${origin}/about`, `${origin}/about-us`, `${origin}/who-we-are`,
      `${origin}/team`, `${origin}/our-team`, `${origin}/management`, `${origin}/leadership`,
      `${origin}/contact`, `${origin}/contact-us`,
      `${origin}/en/about`, `${origin}/en/team`, `${origin}/en/leadership`,
      `${origin}/ar/about`, `${origin}/investors`, `${origin}/board`,
    ];

    // ── PARALLEL RESEARCH ENGINE — all sources fire simultaneously ───────────────
    // Sources: website crawl + sub-pages + 5 Perplexity threads + 3 Gemini Google Search threads + Claude + GPT-4o
    const [
      crawlResult,
      pOwnership, pLeadership, pSocial, pFinancials, pNews,
      geminiPeopleResult,
      geminiCompanyResult,
      geminiDeepResult,
      claudeKnowledgeResult,
      gptKnowledgeResult,
      ...subPageResults
    ] = await Promise.allSettled([

      // ── AGENT 1: Full website crawl (StealthBrowser → crawl4ai → HTTP) ──────
      fullStackCrawl(url, "research-url"),

      // ── AGENTS 2-6: Perplexity web search — 5 parallel threads ──────────────
      perplexitySearch(`"${companyQuery}" Saudi Arabia shareholders founders owners ownership equity investors stake ${domain}`, 2000),
      perplexitySearch(`"${companyQuery}" Saudi Arabia CEO managing director founder board directors executive management team ${domain}`, 2000),
      perplexitySearch(`"${companyQuery}" Saudi Arabia LinkedIn company page Twitter Instagram Snapchat YouTube social media profile ${domain}`, 1500),
      perplexitySearch(`"${companyQuery}" Saudi Arabia revenue employees headcount registered capital funding valuation CR number سجل تجاري ${domain}`, 1500),
      perplexitySearch(`"${companyQuery}" Saudi Arabia contracts news awards tenders expansion 2024 2025 growth announcement ${domain}`, 1500),

      // ── AGENT 7: Gemini Google Search — PEOPLE FOCUS ─────────────────────────
      // Always runs in parallel with Perplexity (not a fallback — a separate source)
      isGeminiConfigured()
        ? deepResearchWithGemini(
            `Find key people at ${companyQuery} (${domain}), a company in Saudi Arabia.\n\nI need at minimum 2-3 key people. Search for:\n1. CEO or Managing Director — full name in English and Arabic, LinkedIn URL, background\n2. Founders — full names, backgrounds, equity stake if known\n3. Board of Directors — chairman and members with full names\n4. Major shareholders with ownership percentages\n5. Other C-suite: CFO, COO, CTO, VP etc — full names and LinkedIn profiles\n\nFor each person found, provide: full name, job title, LinkedIn profile URL, educational background, career history summary, any media coverage or public statements.`,
            "You are an elite Saudi Arabia B2B intelligence analyst. Use Google Search to find real current information about company executives and key people. Be specific — provide full names, exact titles, LinkedIn URLs.",
            "gemini-2.5-flash"
          ).then(r => r?.text ?? null)
        : Promise.resolve(null),

      // ── AGENT 8: Gemini Google Search — COMPANY INTELLIGENCE FOCUS ───────────
      // Always runs in parallel — dedicated to company data (not people)
      isGeminiConfigured()
        ? deepResearchWithGemini(
            `Comprehensive company intelligence for ${companyQuery} (website: ${url}) in Saudi Arabia.\n\nFind:\n- CR (Commercial Registration) number — exact 10-digit number\n- Paid-up capital in SAR\n- Legal form (LLC/JSC/Establishment/etc)\n- Annual revenue estimate and year\n- Total employee count\n- All office locations with addresses\n- Key clients and major contracts\n- Recent news and developments in 2024-2025\n- Vision 2030 projects or government contracts\n- Competitive positioning and market share\n- Funding history and investors\n- Regulatory body (SAMA/CMA/CCHI/MCI/etc)\n- All social media: LinkedIn company page URL, Twitter/X URL, Instagram URL, YouTube channel`,
            "You are an elite Saudi Arabia B2B intelligence analyst. Use Google Search to find real, verified company data. Include specific numbers, dates, and sources.",
            "gemini-2.5-flash"
          ).then(r => r?.text ?? null)
        : Promise.resolve(null),

      // ── AGENT 9: Gemini Google Search — COMPREHENSIVE OVERVIEW ───────────────
      // Full intelligence sweep — broad and deep
      isGeminiConfigured()
        ? deepResearchWithGemini(
            `Full B2B intelligence profile for ${companyQuery} (${url}), Saudi Arabia:\n\n- Company overview: industry, founded, description, headquarters\n- All known executives with full names and LinkedIn URLs\n- All known shareholders and ownership percentages\n- Financial profile: revenue, employees, capital, valuation\n- Commercial Registration (CR) number\n- Government relationships and Vision 2030 alignment\n- Key products and services\n- Major clients and partners\n- Recent contracts, tenders, awards, expansions 2024-2025\n- Social media presence with full URLs\n- Competitive landscape`,
            "You are an elite Saudi Arabia B2B intelligence analyst. Perform a comprehensive Google Search research. Be exhaustive and specific.",
            "gemini-2.5-flash"
          ).then(r => r?.text ?? null)
        : Promise.resolve(null),

      // ── AGENT 10: Claude — Knowledge Base Research ────────────────────────────
      Promise.race([
        (async () => {
          try {
            const msg = await anthropic.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 2000,
              system: "You are an elite Saudi Arabia B2B intelligence analyst with deep knowledge of the Saudi business ecosystem. Extract and list ALL facts you know about the requested company from your training data. Be specific with names, titles, dates, numbers, and LinkedIn URLs.",
              messages: [{
                role: "user",
                content: `From your training data, what do you know about the company at ${url} (domain: ${domain}, likely company name: "${companyQuery}") in Saudi Arabia?\n\nList ALL known facts including:\n- Company full name in English and Arabic\n- Founders and their backgrounds\n- CEO / Managing Director full name and LinkedIn URL\n- All known executives: CFO, COO, CTO, VP — full names and LinkedIn URLs\n- All known shareholders with ownership percentages\n- Board of directors members\n- Commercial Registration (CR) number (10-digit Saudi number)\n- Annual revenue estimate and headcount\n- Headquarters location and all office addresses\n- Key products and services\n- Major clients, partners, and government contracts\n- Vision 2030 projects\n- LinkedIn company page URL, Twitter/X, Instagram, YouTube\n- Any recent news, awards, partnerships, or expansions\n- Competitive positioning in the Saudi market\n\nProvide everything you know — even partial facts are useful. Label uncertain information clearly.`,
              }],
            });
            return msg.content[0]?.type === "text" ? msg.content[0].text : null;
          } catch { return null; }
        })(),
        new Promise<null>(r => setTimeout(() => r(null), 18000)),
      ]),

      // ── AGENT 11: GPT-4o — Knowledge Base Research ───────────────────────────
      Promise.race([
        (async () => {
          try {
            const completion = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [
                {
                  role: "system",
                  content: "You are an elite Saudi Arabia B2B intelligence analyst with deep knowledge of the Saudi business ecosystem. Extract and list ALL facts you know about the requested company from your training data. Be specific with names, titles, dates, numbers, and LinkedIn URLs.",
                },
                {
                  role: "user",
                  content: `From your training data, what do you know about the company at ${url} (domain: ${domain}, likely company name: "${companyQuery}") in Saudi Arabia?\n\nList ALL known facts including:\n- Company full name in English and Arabic\n- Founders and their backgrounds\n- CEO / Managing Director full name and LinkedIn URL\n- All known executives: CFO, COO, CTO, VP — full names and LinkedIn URLs\n- All known shareholders with ownership percentages\n- Board of directors members\n- Commercial Registration (CR) number\n- Annual revenue estimate and headcount\n- Headquarters location\n- Key products and services\n- Major clients and government contracts\n- LinkedIn company page URL, Twitter/X, Instagram, YouTube\n- Any recent news, awards, or expansions\n\nProvide everything you know. Label uncertain information clearly.`,
                },
              ],
              max_completion_tokens: 2000,
            });
            return completion.choices[0]?.message?.content ?? null;
          } catch { return null; }
        })(),
        new Promise<null>(r => setTimeout(() => r(null), 18000)),
      ]),

      // ── AGENTS 12+: Sub-page crawls ──────────────────────────────────────────
      ...SUB_PAGE_URLS.slice(0, 6).map(async (subUrl) => {
        try {
          const result = await crawl4ai(subUrl);
          const text = (result?.text || "").slice(0, 3000);
          return text.length > 150 ? { url: subUrl, text } : null;
        } catch { return null; }
      }),
    ]);

    const mainCrawl = crawlResult.status === "fulfilled" ? crawlResult.value : { text: "", html: "", emails: [], phones: [] };
    const { text: websiteText, emails, phones } = mainCrawl;

    // Sub-page text aggregation
    const subPageContent = subPageResults
      .map(r => r.status === "fulfilled" && r.value ? `\n--- ${(r.value as { url: string; text: string }).url} ---\n${(r.value as { url: string; text: string }).text}` : "")
      .filter(Boolean).join("\n").slice(0, 10000);

    // Extract contacts from sub-pages
    const subEmails = subPageResults.flatMap(r => {
      if (r.status !== "fulfilled" || !r.value) return [];
      return ((r.value as { text: string }).text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []);
    });
    const subPhones = subPageResults.flatMap(r => {
      if (r.status !== "fulfilled" || !r.value) return [];
      return ((r.value as { text: string }).text.match(/(?:\+966|00966|0)\s?\d{2}\s?\d{3}\s?\d{4}/g) || []);
    });
    const allEmails = [...new Set([...emails, ...subEmails])];
    const allPhones = [...new Set([...phones, ...subPhones])];

    const ownershipText    = pOwnership.status === "fulfilled"  ? pOwnership.value  : "";
    const leadershipText   = pLeadership.status === "fulfilled" ? pLeadership.value : "";
    const socialText       = pSocial.status === "fulfilled"     ? pSocial.value     : "";
    const financialsText   = pFinancials.status === "fulfilled" ? pFinancials.value : "";
    const newsText         = pNews.status === "fulfilled"       ? pNews.value       : "";
    const geminiPeopleText  = geminiPeopleResult.status === "fulfilled" && geminiPeopleResult.value ? geminiPeopleResult.value : "";
    const geminiCompanyText = geminiCompanyResult.status === "fulfilled" && geminiCompanyResult.value ? geminiCompanyResult.value : "";
    const geminiText        = geminiDeepResult.status === "fulfilled" && geminiDeepResult.value ? geminiDeepResult.value : "";
    const claudeKnowledgeText = claudeKnowledgeResult.status === "fulfilled" && claudeKnowledgeResult.value ? claudeKnowledgeResult.value : "";
    const gptKnowledgeText    = gptKnowledgeResult.status === "fulfilled" && gptKnowledgeResult.value ? gptKnowledgeResult.value : "";

    const perplexityHits = [ownershipText,leadershipText,socialText,financialsText,newsText].filter(Boolean).length;
    const geminiHits = [geminiPeopleText, geminiCompanyText, geminiText].filter(Boolean).length;
    const aiKnowledgeHits = [claudeKnowledgeText, gptKnowledgeText].filter(Boolean).length;
    console.log(`[ResearchUrl] Data collected — website: ${websiteText.length} chars, subpages: ${subPageContent.length} chars, emails: ${allEmails.length}, phones: ${allPhones.length}, perplexity: ${perplexityHits}/5, gemini: ${geminiHits}/3, aiKnowledge: ${aiKnowledgeHits}/2 (claude:${claudeKnowledgeText.length} gpt:${gptKnowledgeText.length} chars)`);

    // Step 3: Full synthesis from ALL gathered data — Gemini (1st) + Claude (2nd) + GPT-4o (3rd)
    const ANALYST_SYSTEM = "You are an elite Saudi Arabia B2B intelligence analyst. Your job is to synthesize ALL available data sources into one comprehensive structured company profile. Extract EVERY fact, name, number, and URL present across ALL data sources. CRITICAL: You MUST identify at least 2 key people (executives, founders, shareholders, or board members) with as much detail as possible. Never say 'not found' if the data exists in any source. For missing data not in any source, use null.";

    const cap = (s: string, n: number) => s.slice(0, n);
    const extractPrompt = `Company website: ${url} | Domain: ${domain}
${allEmails.length > 0 ? `Verified emails: ${allEmails.join(", ")}` : ""}
${allPhones.length > 0 ? `Verified phones: ${allPhones.join(", ")}` : ""}

=== SOURCE 1: WEBSITE HOMEPAGE (crawled) ===
${cap(websiteText, 2500) || "(JS-rendered site — minimal content, rely heavily on external intelligence below)"}

=== SOURCE 2: WEBSITE SUB-PAGES (About / Team / Leadership / Contact) ===
${cap(subPageContent, 2500) || "(no sub-page content retrieved)"}

${ownershipText ? `=== SOURCE 3: WEB SEARCH — SHAREHOLDERS / OWNERSHIP / FOUNDERS ===\n${cap(ownershipText, 2000)}` : ""}
${leadershipText ? `=== SOURCE 4: WEB SEARCH — CEO / MANAGEMENT / BOARD / EXECUTIVES ===\n${cap(leadershipText, 2000)}` : ""}
${socialText ? `=== SOURCE 5: WEB SEARCH — SOCIAL MEDIA / LINKEDIN / TWITTER ===\n${cap(socialText, 1500)}` : ""}
${financialsText ? `=== SOURCE 6: WEB SEARCH — REVENUE / EMPLOYEES / CAPITAL / FUNDING ===\n${cap(financialsText, 1500)}` : ""}
${newsText ? `=== SOURCE 7: WEB SEARCH — NEWS / CONTRACTS / AWARDS 2024-2025 ===\n${cap(newsText, 1500)}` : ""}
${geminiPeopleText ? `=== SOURCE 8: GEMINI DEEP RESEARCH — KEY PEOPLE & LEADERSHIP (Google Search grounded) ===\n${cap(geminiPeopleText, 3000)}` : ""}
${geminiCompanyText ? `=== SOURCE 9: GEMINI DEEP RESEARCH — COMPANY INTELLIGENCE (Google Search grounded) ===\n${cap(geminiCompanyText, 3000)}` : ""}
${geminiText ? `=== SOURCE 10: GEMINI DEEP RESEARCH — COMPREHENSIVE OVERVIEW (Google Search grounded) ===\n${cap(geminiText, 3000)}` : ""}
${claudeKnowledgeText ? `=== SOURCE 11: CLAUDE AI — TRAINING KNOWLEDGE BASE (Company Intelligence) ===\n${cap(claudeKnowledgeText, 2500)}` : ""}
${gptKnowledgeText ? `=== SOURCE 12: GPT-4o — TRAINING KNOWLEDGE BASE (Company Intelligence) ===\n${cap(gptKnowledgeText, 2000)}` : ""}

SYNTHESIS RULES — MANDATORY:
1. You MUST populate keyPeople with AT LEAST 2 people — search ALL sources above (1-12) for any person names, titles, or LinkedIn URLs. If only 1 person found, still include them and note the role.
2. For every person in keyPeople: combine data from ALL sources — a name from Source 4, LinkedIn from Source 8, background from Sources 10/11/12.
3. For management/board/shareholders: cross-reference ALL 12 sources and deduplicate — the same person may appear differently in different sources.
4. CR number is exactly 10 digits — search ALL 12 sources carefully for "1xxxxxxxxx" patterns.
5. Social media: search ALL 12 sources for LinkedIn, Twitter/X, Instagram, YouTube URLs — not just the website.
6. NEVER leave a field as null if ANY of the 12 sources above contains the information. If uncertain, include it with a confidence note.
7. For the CEO field: use the most authoritative/recent source. Cross-check all Gemini, Claude, and GPT-4o data (Sources 8-12).
8. Sources 11 and 12 (Claude and GPT-4o training knowledge) may contain accurate facts about well-known Saudi companies — treat them as supplementary intelligence and cross-reference with live web search sources.

Return ONLY a valid JSON object — no markdown, no explanation, no extra text:
{
  "nameEn": "Company name in English",
  "nameAr": "اسم الشركة بالعربية or null",
  "industry": "Primary industry / sector",
  "subIndustry": "Specific sub-sector or null",
  "description": "Comprehensive 3-4 sentence company description including market position and Vision 2030 relevance",
  "founded": "YYYY or null",
  "website": "${url}",
  "phone": "Primary phone +966... or null",
  "email": "Primary business email or null",
  "address": "Full HQ address: street, district, city or null",
  "city": "City or null",
  "region": "Region/province or null",
  "employees": "Exact count or range e.g. 500-1000 or null",
  "revenue": "Annual revenue in SAR or USD with year or null",
  "ceo": "CEO/GM/Managing Director full name in English or null",
  "ceoAr": "CEO full name in Arabic or null",
  "founders": ["Full name of each founder — MUST include if any founder mentioned in any source"],
  "crNumber": "10-digit Saudi CR number or null",
  "legalForm": "LLC / JSC / Establishment / Foreign Branch / other or null",
  "paidUpCapital": "Capital in SAR with currency or null",
  "regulator": "SAMA / CMA / CCHI / MCI / other regulatory body or null",
  "licenseNumber": "License or permit number if found or null",
  "keyPeople": [
    {
      "nameEn": "Full name in English — REQUIRED",
      "nameAr": "Full name in Arabic or null",
      "role": "CEO / Founder / Chairman / Shareholder / CFO / COO / Board Member / etc",
      "title": "Exact job title",
      "ownershipPct": "Ownership percentage if shareholder or null",
      "linkedin": "Full LinkedIn profile URL e.g. https://linkedin.com/in/username or null",
      "background": "2-3 sentence background: education, career history, notable achievements",
      "nationality": "Saudi / Other / null"
    }
  ],
  "shareholders": [{"nameEn": "Full name", "nameAr": "Arabic name or null", "ownershipPct": "% or null", "nationality": "Saudi/other or null", "role": "Chairman/Director/Founder/Investor etc"}],
  "management": [{"nameEn": "Full name", "nameAr": "Arabic or null", "title": "Exact title", "linkedin": "LinkedIn URL or null"}],
  "board": [{"nameEn": "Full name", "nameAr": "Arabic or null", "role": "Chairman/Member/Independent etc"}],
  "offices": [{"city": "City", "address": "Full address or null", "phone": "Phone or null", "email": "Email or null", "label": "Head Office / Branch / Regional Office"}],
  "products": ["Specific product or service 1", "Specific product or service 2"],
  "clients": ["Key client or partner 1", "Key client 2"],
  "socialMedia": {
    "linkedin": "Full LinkedIn company page URL or null",
    "twitter": "Full Twitter/X profile URL or null",
    "instagram": "Full Instagram URL or null",
    "youtube": "Full YouTube channel URL or null",
    "snapchat": "Snapchat handle or null"
  },
  "strengths": ["Specific competitive advantage 1", "Competitive advantage 2"],
  "marketPosition": "Detailed paragraph: market position, key differentiators, competitive standing, Vision 2030 alignment",
  "recentNews": "Most recent significant news with dates: contracts, partnerships, expansions, awards, funding, leadership changes",
  "fundingHistory": "Funding rounds with investors, amounts, and dates if found — or null",
  "aiInsights": "4-5 sentence actionable B2B intelligence: who is the key decision maker and how to reach them, what are the buying triggers, best timing and approach angle, key pain points to address, recommended pitch"
}`;

    const cappedPrompt = extractPrompt.slice(0, 28000);
    const synthTimeout = (p: Promise<string | null>) =>
      Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), 30000))]);

    const [geminiSynthResult, claudeSynthResult, gptSynthResult] = await Promise.allSettled([
      isGeminiConfigured()
        ? synthesizeWithGemini(cappedPrompt, ANALYST_SYSTEM, "gemini-2.5-flash")
        : Promise.resolve(null),
      synthTimeout((async () => {
        try {
          const msg = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4000,
            system: ANALYST_SYSTEM,
            messages: [{ role: "user", content: cappedPrompt }],
          });
          return msg.content[0]?.type === "text" ? msg.content[0].text : null;
        } catch { return null; }
      })()),
      synthTimeout((async () => {
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: ANALYST_SYSTEM },
              { role: "user", content: cappedPrompt },
            ],
            max_completion_tokens: 4000,
          });
          return completion.choices[0]?.message?.content ?? null;
        } catch { return null; }
      })()),
    ]);

    // Pick best result: Gemini (1st) → Claude (2nd) → GPT-4o (3rd)
    const getVal = (r: PromiseSettledResult<string | null>) =>
      r.status === "fulfilled" && r.value ? r.value : null;
    const raw = getVal(geminiSynthResult) ?? getVal(claudeSynthResult) ?? getVal(gptSynthResult) ?? "{}";

    let profile: Record<string, unknown>;
    try {
      const s = raw.indexOf("{"); const e = raw.lastIndexOf("}");
      profile = JSON.parse(s !== -1 ? raw.slice(s, e + 1) : raw);
    } catch {
      profile = { nameEn: domain, description: "Could not parse company data.", website: url };
    }

    // Ensure safe primitive types for display fields
    const safeStr = (v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      if (typeof v === "string" && v !== "null") return v;
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    };
    profile.ceo = safeStr(profile.ceo);
    profile.aiInsights = safeStr(profile.aiInsights);
    profile.marketPosition = safeStr(profile.marketPosition);
    profile.description = safeStr(profile.description);
    profile.recentNews = safeStr(profile.recentNews);
    profile.fundingHistory = safeStr(profile.fundingHistory);
    // Inject verified contacts from crawl if AI missed them
    if (!profile.email && allEmails.length > 0) profile.email = allEmails[0];
    if (!profile.phone && allPhones.length > 0) profile.phone = allPhones[0];

    console.log(`[ResearchUrl] Done — company: ${profile.nameEn || "?"}, CEO: ${profile.ceo || "not found"}, keyPeople: ${Array.isArray(profile.keyPeople) ? profile.keyPeople.length : 0}, shareholders: ${Array.isArray(profile.shareholders) ? profile.shareholders.length : 0}`);
    res.json({ profile, url, crawledChars: websiteText.length });
  } catch (err) {
    console.error("[ProsEngineResearchUrl] error:", err);
    res.status(500).json({ error: "Research failed" });
  }
});

// ─── POST /prosengine/export-ppt — Generate PPTX for single company profile ────
router.post("/prosengine/export-ppt", async (req: Request, res: Response): Promise<void> => {
  const { profile, sourceUrl } = req.body as { profile: Record<string, unknown>; sourceUrl?: string };
  if (!profile) { res.status(400).json({ error: "profile required" }); return; }

  try {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";

    const str = (v: unknown) => (v == null || v === "" || v === "null" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
    const arr = (v: unknown): Array<Record<string, string>> => (Array.isArray(v) ? v as Array<Record<string, string>> : []);
    const companyName = str(profile.nameEn) || "Company";

    // Slide 1: Cover
    const slide1 = pptx.addSlide();
    slide1.background = { color: "0a1628" };
    slide1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.08, fill: { color: "06b6d4" } });
    slide1.addText(companyName, { x: 0.5, y: 1.5, w: 12, h: 1.2, color: "ffffff", fontSize: 36, bold: true, fontFace: "Arial" });
    if (profile.nameAr) slide1.addText(str(profile.nameAr), { x: 0.5, y: 2.8, w: 12, h: 0.7, color: "6ee7b7", fontSize: 20, fontFace: "Arial" });
    slide1.addText([
      str(profile.industry),
      str(profile.city) !== "—" ? str(profile.city) + ", KSA" : "Saudi Arabia",
    ].filter(s => s !== "—").join("  ·  "), { x: 0.5, y: 3.6, w: 12, h: 0.5, color: "94a3b8", fontSize: 14, fontFace: "Arial" });
    slide1.addText(`ProspectSA Intelligence Report  ·  ${new Date().toLocaleDateString()}`, { x: 0.5, y: 5.5, w: 12, h: 0.4, color: "475569", fontSize: 11, fontFace: "Arial" });

    // Slide 2: Company Overview
    const slide2 = pptx.addSlide();
    slide2.background = { color: "0a1628" };
    slide2.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.08, fill: { color: "06b6d4" } });
    slide2.addText("Company Overview", { x: 0.5, y: 0.2, w: 12, h: 0.6, color: "06b6d4", fontSize: 18, bold: true, fontFace: "Arial" });
    slide2.addText(companyName, { x: 0.5, y: 0.9, w: 12, h: 0.6, color: "ffffff", fontSize: 22, bold: true, fontFace: "Arial" });
    const fields = [
      { l: "CR Number", v: str(profile.crNumber) },
      { l: "Legal Form", v: str(profile.legalForm) },
      { l: "Founded", v: str(profile.founded) },
      { l: "City / Region", v: [str(profile.city), str(profile.region)].filter(s => s !== "—").join(", ") || "—" },
      { l: "Industry", v: str(profile.industry) },
      { l: "CEO / GM", v: str(profile.ceo) + (str(profile.ceoAr) !== "—" ? ` (${str(profile.ceoAr)})` : "") },
      { l: "Employees", v: str(profile.employees) },
      { l: "Revenue (est.)", v: str(profile.revenue) },
      { l: "Paid-Up Capital", v: str(profile.paidUpCapital) },
      { l: "Phone", v: str(profile.phone) },
      { l: "Email", v: str(profile.email) },
      { l: "Website", v: sourceUrl || "—" },
    ];
    const col1 = fields.slice(0, 6);
    const col2 = fields.slice(6, 12);
    col1.forEach((f, i) => {
      if (f.v === "—") return;
      slide2.addText(f.l + ":", { x: 0.5, y: 1.7 + i * 0.55, w: 2.5, h: 0.45, color: "94a3b8", fontSize: 10, fontFace: "Arial" });
      slide2.addText(f.v, { x: 3.0, y: 1.7 + i * 0.55, w: 3.2, h: 0.45, color: "e2e8f0", fontSize: 11, bold: true, fontFace: "Arial" });
    });
    col2.forEach((f, i) => {
      if (f.v === "—") return;
      slide2.addText(f.l + ":", { x: 6.8, y: 1.7 + i * 0.55, w: 2.5, h: 0.45, color: "94a3b8", fontSize: 10, fontFace: "Arial" });
      slide2.addText(f.v, { x: 9.3, y: 1.7 + i * 0.55, w: 3.2, h: 0.45, color: "e2e8f0", fontSize: 11, bold: true, fontFace: "Arial" });
    });

    // Slide 3: Shareholders (if present)
    const shareholders = arr(profile.shareholders).filter(s => s.nameEn);
    if (shareholders.length > 0) {
      const slide3 = pptx.addSlide();
      slide3.background = { color: "0a1628" };
      slide3.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.08, fill: { color: "f59e0b" } });
      slide3.addText("Shareholders", { x: 0.5, y: 0.2, w: 12, h: 0.6, color: "f59e0b", fontSize: 18, bold: true, fontFace: "Arial" });
      const rows = [
        [{ text: "Name", options: { color: "94a3b8", bold: true, fontSize: 10 } }, { text: "Arabic Name", options: { color: "94a3b8", bold: true, fontSize: 10 } }, { text: "Ownership %", options: { color: "94a3b8", bold: true, fontSize: 10 } }, { text: "Nationality", options: { color: "94a3b8", bold: true, fontSize: 10 } }],
        ...shareholders.slice(0, 10).map(s => [
          { text: s.nameEn || "—", options: { color: "e2e8f0", fontSize: 11 } },
          { text: s.nameAr || "—", options: { color: "6ee7b7", fontSize: 11 } },
          { text: s.ownershipPct || "—", options: { color: "fbbf24", fontSize: 11, bold: true } },
          { text: s.nationality || "—", options: { color: "94a3b8", fontSize: 11 } },
        ]),
      ];
      slide3.addTable(rows as Parameters<typeof slide3.addTable>[0], { x: 0.5, y: 1.0, w: 12.5, colW: [3, 3, 2, 2], border: { type: "solid", color: "1e3a5f" }, fill: { color: "0d1f35" }, fontFace: "Arial", rowH: 0.38 });
    }

    // Slide 4: Management (if present)
    const management = arr(profile.management).filter(m => m.nameEn);
    if (management.length > 0) {
      const slide4 = pptx.addSlide();
      slide4.background = { color: "0a1628" };
      slide4.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.08, fill: { color: "8b5cf6" } });
      slide4.addText("Management Team", { x: 0.5, y: 0.2, w: 12, h: 0.6, color: "a78bfa", fontSize: 18, bold: true, fontFace: "Arial" });
      const rows = [
        [{ text: "Name", options: { color: "94a3b8", bold: true, fontSize: 10 } }, { text: "Arabic Name", options: { color: "94a3b8", bold: true, fontSize: 10 } }, { text: "Title / Role", options: { color: "94a3b8", bold: true, fontSize: 10 } }],
        ...management.slice(0, 12).map(m => [
          { text: m.nameEn || "—", options: { color: "e2e8f0", fontSize: 11, bold: true } },
          { text: m.nameAr || "—", options: { color: "6ee7b7", fontSize: 11 } },
          { text: m.title || "—", options: { color: "a78bfa", fontSize: 11 } },
        ]),
      ];
      slide4.addTable(rows as Parameters<typeof slide4.addTable>[0], { x: 0.5, y: 1.0, w: 12.5, colW: [4, 4, 4.5], border: { type: "solid", color: "1e3a5f" }, fill: { color: "0d1f35" }, fontFace: "Arial", rowH: 0.38 });
    }

    // Slide 5: AI Insights (if present)
    if (profile.aiInsights) {
      const slide5 = pptx.addSlide();
      slide5.background = { color: "0a1628" };
      slide5.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.08, fill: { color: "06b6d4" } });
      slide5.addText("AI Intelligence Insights", { x: 0.5, y: 0.2, w: 12, h: 0.6, color: "06b6d4", fontSize: 18, bold: true, fontFace: "Arial" });
      slide5.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.9, w: 12.5, h: 4.5, fill: { color: "0d1f35" }, line: { color: "1e3a5f" } });
      slide5.addText(str(profile.aiInsights), { x: 0.9, y: 1.1, w: 11.5, h: 4.1, color: "cbd5e1", fontSize: 13, fontFace: "Arial", valign: "top", paraSpaceAfter: 6 });
    }

    const buffer = await pptx.write({ outputType: "nodebuffer" });
    const filename = `${(str(profile.nameEn) || "company").replace(/[^a-z0-9]/gi, "-").toLowerCase()}-intel.pptx`;
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  } catch (err) {
    console.error("[ExportPPT] error:", err);
    res.status(500).json({ error: "PPT generation failed" });
  }
});

export default router;
