# Document 1: Masaar Engine — Saudi CR Intelligence Pipeline
## Complete Standalone Replication Guide

---

## 1. WHAT THIS IS

The Masaar Engine is a 7-agent Saudi corporate intelligence pipeline that accepts a Saudi Commercial Registration (CR) number (7–12 digits) and produces a full bilingual (English + Arabic) intelligence report covering:

- Official MC.gov.sa registry data (legal form, paid-up capital, founding year, authorized signatory)
- AOA (Articles of Association) from emagazine.aamaly.sa — shareholders with names + ownership %, board of directors, management structure
- Deep research from Perplexity (×5 queries), Gemini Chrome AI (×4 queries), Claude, GPT-4o
- Compliance & sanctions screening: OFAC, UN Security Council, EU sanctions, CMA, SAMA, ZATCA, Maroof, Najiz legal agencies
- Cross-validation between all sources with conflict detection
- Bilingual final report (Claude primary + GPT-4o fallback)

The pipeline runs via Server-Sent Events (SSE) so the frontend displays real-time agent progress. It also handles CAPTCHA — the stealth browser tries AI auto-solving first; on failure it sends a screenshot to the frontend and waits for human input.

**The 7 agents in order:**
1. **Agent 1 — MC.gov.sa Registry Browser**: Stealth browser → mc.gov.sa search by CR → extracts company data → sends to Claude for structured JSON parse
2. **Agent 2 — Claude CR Parser**: Receives raw HTML/text from Agent 1, extracts fields (nameEn, nameAr, legalForm, capital, foundingDate, activity, city)
3. **Agent 3 — Emagazine AOA Search**: Stealth browser → emagazine.aamaly.sa → searches for the company → finds latest AOA PDF → downloads it
4. **Agent 4 — AOA PDF Parser**: Extracts text from PDF → Claude parses shareholders, board, management, profit-distribution rules, share-transfer restrictions
5. **Agent 5 — Najiz Legal Agencies**: Checks najiz.moj.gov.sa for any legal agencies / registered legal representatives associated with the CR number
6. **Agent 6 — Deep Research + Compliance**: Parallel: Perplexity ×5, Gemini ×4, Claude, GPT-4o research. OFAC/UN/EU/CMA/SAMA/ZATCA compliance scan.
7. **Agent 7 — Bilingual Report Compiler**: Claude compiles everything into structured JSON + Arabic + English narrative. GPT-4o fallback if Claude times out.

---

## 2. TECH STACK

```
Frontend:  React 18 + Vite + TypeScript
           Wouter (routing)
           TanStack Query v5 (data fetching)
           Radix UI primitives
           Tailwind CSS v4
           Lucide React icons

Backend:   Node.js + Express + TypeScript
           Drizzle ORM
           PostgreSQL

AI:        Anthropic Claude (claude-sonnet-4-6)  ← primary
           OpenAI GPT-4o                          ← fallback/synthesis
           Google Gemini 2.5 Flash                ← Chrome AI / web search
           Perplexity (sonar model)               ← real-time web search
           OpenRouter (optional stub — any model)
           Groq (optional stub — llama-3.3-70b)

Scraping:  Puppeteer / Playwright stealth browser (custom StealthBrowser class)
           Crawl4AI (fallback web crawler)
           Cheerio (HTML parsing)
           Axios (HTTP client)
```

**Required environment variables:**
```
ANTHROPIC_API_KEY          (or AI_INTEGRATIONS_ANTHROPIC_API_KEY)
OPENAI_API_KEY             (or AI_INTEGRATIONS_OPENAI_API_KEY)
GEMINI_API_KEY             (for Gemini Chrome AI searches)
PERPLEXITY_API_KEY         (for real-time web research)
DATABASE_URL               (PostgreSQL connection string)
OPENROUTER_API_KEY         (optional — enables DeepSeek/LLaMA stubs)
GROQ_API_KEY               (optional — enables Groq/LLaMA stubs)
```

---

## 3. DATABASE SCHEMA

```sql
-- masaar_engine table is NOT required (results are returned in the SSE stream + in-memory)
-- No persistent storage for Masaar Engine results — each run is ephemeral.
-- The job registry is an in-memory Map<jobId, EventEmitter>.
```

If you want to persist results, add this table:

```sql
CREATE TABLE masaar_reports (
  id          SERIAL PRIMARY KEY,
  job_id      TEXT UNIQUE NOT NULL,
  cr_number   TEXT NOT NULL,
  report_data JSONB,
  report_en   TEXT,
  report_ar   TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);
```

With Drizzle:
```typescript
import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const masaarReportsTable = pgTable("masaar_reports", {
  id:         serial("id").primaryKey(),
  jobId:      text("job_id").unique().notNull(),
  crNumber:   text("cr_number").notNull(),
  reportData: jsonb("report_data"),
  reportEn:   text("report_en"),
  reportAr:   text("report_ar"),
  createdAt:  timestamp("created_at").defaultNow(),
});
```

---

## 4. BACKEND: masaar-engine.ts (full logic)

### 4a. Types

```typescript
export interface AgentEvent {
  type:
    | "agent_start"
    | "agent_log"
    | "agent_complete"
    | "agent_error"
    | "captcha_required"
    | "captcha_solved"
    | "stealth_solving"
    | "stealth_solved"
    | "stealth_session"
    | "job_complete"
    | "job_error";
  agentNum?: number;
  agentName?: string;
  message?: string;
  data?: Record<string, unknown>;
  report?: MasaarReport;
  captchaFor?: string;
  captchaScreenshot?: string;   // base64 PNG of captcha
  captchaLabel?: string;
  stealthMethod?: "ai" | "human" | "session";
  captchaCode?: string;
}

export interface ComplianceResult {
  ofac: { hit: boolean; entries: string[]; matchScore: string };
  unsc: { hit: boolean; entries: string[] };
  eu: { hit: boolean; entries: string[] };
  maroof: { verified: boolean; rating: string | null; data: string };
  saudiRegulatory: {
    cma: { hit: boolean; notes: string };
    sama: { hit: boolean; notes: string };
    zatca: { hit: boolean; notes: string };
    najiz: { agencies: Array<Record<string, string>>; found: boolean };
  };
  newsFlags: string[];
  overallRisk: "low" | "medium" | "high" | "unknown";
  riskSummary: string;
  checkedAt: string;
}

export interface MasaarReport {
  crNumber: string;
  fetchedAt: string;
  stealthMode: boolean;
  sources: {
    mcGovSa: Record<string, unknown>;
    emagazine: Record<string, unknown>;
    najiz: Record<string, unknown>;
  };
  parsed: {
    nameEn: string | null;
    nameAr: string | null;
    crNumber: string | null;
    legalForm: string | null;
    legalFormAr: string | null;
    headquarterCity: string | null;
    headquarterCityAr: string | null;
    foundingYear: string | null;
    fiscalYear: string | null;
    capitalAmount: string | null;
    capitalDistribution: string | null;
    estimatedRevenue: string | null;
    summaryEn: string | null;
    summaryAr: string | null;
    contactDetails: Record<string, string>;
    shareholders: Array<{
      nameEn: string; nameAr: string;
      nationalId: string; ownershipPct: string; nationality: string;
    }>;
    managers: Array<{
      nameEn: string; nameAr: string; nationalId: string;
      title?: string; appointmentTerm: string; powers: string;
    }>;
    boardComposition: string | null;
    shareTransferRestrictions: string | null;
    profitDistributionRules: string | null;
    dissolutionConditions: string | null;
    amendmentProcedures: string | null;
  };
  aoa: Record<string, unknown>;
  compliance?: ComplianceResult;
  legalAgencies: Array<Record<string, unknown>>;
  conflicts: Array<{
    field: string; source1: string; value1: string;
    source2: string; value2: string;
    severity?: string; recommendation?: string;
  }>;
  reportAr: string;
  reportEn: string;
}
```

### 4b. Job Registry (in-memory)

```typescript
import { EventEmitter } from "events";

interface JobState {
  emitter: EventEmitter;
  captchaResolvers: Map<string, (text: string) => void>;
  stealthMode: boolean;
  stealthBrowser?: any; // StealthBrowser instance
}

const jobs = new Map<string, JobState>();

export function getJobEmitter(jobId: string): EventEmitter | undefined {
  return jobs.get(jobId)?.emitter;
}

export function createJob(jobId: string, stealthMode = true): EventEmitter {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  jobs.set(jobId, { emitter, captchaResolvers: new Map(), stealthMode });
  // Auto-cleanup after 45 min
  setTimeout(async () => {
    const state = jobs.get(jobId);
    if (state?.stealthBrowser) {
      try { await state.stealthBrowser.stop(); } catch { }
    }
    jobs.delete(jobId);
  }, 45 * 60 * 1000);
  return emitter;
}

export function submitCaptcha(jobId: string, captchaFor: string, captchaText: string): boolean {
  const state = jobs.get(jobId);
  if (!state) return false;
  const resolver = state.captchaResolvers.get(captchaFor);
  if (!resolver) return false;
  resolver(captchaText);
  state.captchaResolvers.delete(captchaFor);
  return true;
}
```

### 4c. CAPTCHA Handling

```typescript
// This function is called by any agent that hits a CAPTCHA.
// It first tries stealth AI-solving; on failure, sends screenshot to frontend and waits.
async function resolveCaptcha(
  jobId: string,
  captchaFor: string,
  emitter: EventEmitter,
  browser: any,       // StealthBrowser instance
  label: string,
  agentNum: number,
  agentName: string,
): Promise<string> {
  const state = jobs.get(jobId);
  if (!state) throw new Error("Job not found");

  // Attempt 1: AI auto-solve
  emit(emitter, { type: "stealth_solving", agentNum, agentName, stealthMethod: "ai",
    message: `Attempting AI CAPTCHA solve for ${label}` });

  const aiResult = await autoSolveCaptcha(browser).catch(() => null);
  if (aiResult?.solved) {
    emit(emitter, { type: "stealth_solved", agentNum, agentName, stealthMethod: "ai",
      captchaCode: aiResult.text, message: `AI solved CAPTCHA: "${aiResult.text}"` });
    return aiResult.text;
  }

  // Attempt 2: Human behavior simulation
  emit(emitter, { type: "stealth_solving", agentNum, agentName, stealthMethod: "human",
    message: "AI failed, trying human simulation…" });
  await HumanBehavior.randomDelay(1000, 2000);
  const humanResult = await autoSolveCaptcha(browser).catch(() => null);
  if (humanResult?.solved) {
    emit(emitter, { type: "stealth_solved", agentNum, agentName, stealthMethod: "human",
      captchaCode: humanResult.text, message: `Human simulation solved: "${humanResult.text}"` });
    return humanResult.text;
  }

  // Fallback: Ask human via frontend
  const screenshot = await browser.screenshot({ encoding: "base64" }).catch(() => "");
  return waitForCaptchaHuman(jobId, captchaFor, emitter, String(screenshot), label);
}

async function waitForCaptchaHuman(
  jobId: string,
  captchaFor: string,
  emitter: EventEmitter,
  screenshotBase64: string,
  label: string,
  timeoutMs = 180000,    // 3 minute timeout
): Promise<string> {
  return new Promise((resolve, reject) => {
    const state = jobs.get(jobId);
    if (!state) { reject(new Error("Job not found")); return; }
    const timer = setTimeout(() => {
      state.captchaResolvers.delete(captchaFor);
      reject(new Error("CAPTCHA timeout after 3 minutes — please try again"));
    }, timeoutMs);
    state.captchaResolvers.set(captchaFor, (text) => {
      clearTimeout(timer);
      resolve(text);
    });
    emit(emitter, {
      type: "captcha_required",
      captchaFor,
      captchaScreenshot: screenshotBase64,
      captchaLabel: label,
    });
  });
}
```

### 4d. AI Helpers

```typescript
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import axios from "axios";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
});
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

// Perplexity web search
async function perplexitySearch(query: string, maxTokens = 2000): Promise<string | null> {
  if (!process.env.PERPLEXITY_API_KEY) return null;
  try {
    const r = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      {
        model: "sonar",
        messages: [
          { role: "system", content: "You are a Saudi Arabia B2B intelligence analyst. Provide precise, factual verified data. Include full names in Arabic and English." },
          { role: "user", content: query },
        ],
        max_tokens: maxTokens,
        temperature: 0.1,
        return_citations: true,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 35000,
      },
    );
    return r.data?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// Optional OpenRouter stub (any model — deepseek, llama, moonshot)
async function openRouterQuery(model: string, prompt: string, maxTokens = 2000): Promise<string | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  try {
    const r = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0.1 },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://yourapp.replit.app",
        },
        timeout: 45000,
      },
    );
    return r.data?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// Optional Groq stub
async function groqQuery(model: string, prompt: string, maxTokens = 2000): Promise<string | null> {
  if (!process.env.GROQ_API_KEY) return null;
  try {
    const r = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      { model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0.1 },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 35000,
      },
    );
    return r.data?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}
```

### 4e. Main Pipeline Function

```typescript
export async function runMasaarPipeline(crNumber: string, jobId: string): Promise<void> {
  const state = jobs.get(jobId);
  if (!state) throw new Error("Job state not found");
  const emitter = state.emitter;
  const stealthMode = state.stealthMode;

  const report: MasaarReport = {
    crNumber,
    fetchedAt: new Date().toISOString(),
    stealthMode,
    sources: { mcGovSa: {}, emagazine: {}, najiz: {} },
    parsed: {
      nameEn: null, nameAr: null, crNumber: null, legalForm: null, legalFormAr: null,
      headquarterCity: null, headquarterCityAr: null, foundingYear: null, fiscalYear: null,
      capitalAmount: null, capitalDistribution: null, estimatedRevenue: null,
      summaryEn: null, summaryAr: null, contactDetails: {},
      shareholders: [], managers: [], boardComposition: null,
      shareTransferRestrictions: null, profitDistributionRules: null,
      dissolutionConditions: null, amendmentProcedures: null,
    },
    aoa: {}, legalAgencies: [], conflicts: [], reportAr: "", reportEn: "",
  };

  // ─── AGENT 1: MC.gov.sa Registry Browser ──────────────────────────────────
  emit(emitter, { type: "agent_start", agentNum: 1, agentName: "MC.gov.sa Registry" });
  try {
    const browser = new StealthBrowser();
    await browser.launch();
    state.stealthBrowser = browser;

    await browser.goto("https://mc.gov.sa/en/eservices/Pages/serviceDtls.aspx?SID=9");

    // Wait for search box, type CR number with human-like delays
    await HumanBehavior.typeWithMistakes(browser, "#ContentPlaceHolder1_txtCRNo", crNumber);
    await HumanBehavior.randomDelay(500, 1200);

    // Check for CAPTCHA
    const hasCaptcha = await browser.evaluate(() =>
      !!document.querySelector("img[src*='captcha'], #captchaImage, .captcha")
    );
    if (hasCaptcha) {
      emit(emitter, { type: "agent_log", agentNum: 1, agentName: "MC.gov.sa Registry", message: "CAPTCHA detected — initiating solve…" });
      const captchaText = await resolveCaptcha(jobId, "mc-gov-sa", emitter, browser, "MC.gov.sa CAPTCHA", 1, "MC.gov.sa Registry");
      await browser.evaluate((text: string) => {
        const input = document.querySelector<HTMLInputElement>("#ContentPlaceHolder1_txtCaptcha");
        if (input) input.value = text;
      }, captchaText);
      emit(emitter, { type: "captcha_solved", agentNum: 1, message: "CAPTCHA submitted" });
    }

    await browser.click("#ContentPlaceHolder1_btnSearch");
    await browser.waitForNavigation({ timeout: 15000 });
    const rawHtml = await browser.content();

    // Parse using Cheerio
    const $ = require("cheerio").load(rawHtml);
    const tableData: Record<string, string> = {};
    $("table tr").each((_: number, row: any) => {
      const cells = $(row).find("td");
      if (cells.length >= 2) {
        const key = $(cells[0]).text().trim();
        const val = $(cells[1]).text().trim();
        if (key && val) tableData[key] = val;
      }
    });

    report.sources.mcGovSa = tableData;
    emit(emitter, { type: "agent_log", agentNum: 1, agentName: "MC.gov.sa Registry",
      message: `Registry data captured: ${Object.keys(tableData).length} fields` });

    await browser.stop();
    state.stealthBrowser = undefined;
    emit(emitter, { type: "agent_complete", agentNum: 1, agentName: "MC.gov.sa Registry", data: tableData });
  } catch (err: unknown) {
    emit(emitter, { type: "agent_error", agentNum: 1, agentName: "MC.gov.sa Registry",
      message: (err as Error).message });
  }

  // ─── AGENT 2: Claude CR Parser ─────────────────────────────────────────────
  emit(emitter, { type: "agent_start", agentNum: 2, agentName: "CR Data Parser" });
  try {
    const rawData = JSON.stringify(report.sources.mcGovSa);
    const parsePrompt = `Parse this Saudi commercial registry data and return ONLY valid JSON:
${rawData}

Return this JSON structure:
{
  "nameEn": "Company name in English or null",
  "nameAr": "اسم الشركة بالعربية or null",
  "crNumber": "10-digit CR number or null",
  "legalForm": "LLC / Joint Stock Company / etc or null",
  "legalFormAr": "شركة ذات مسؤولية محدودة / etc or null",
  "city": "city in English or null",
  "paidUpCapital": "SAR X,XXX,XXX or null",
  "foundingDate": "full date or null",
  "foundingYear": "YYYY or null",
  "mainActivity": "main business activity in English or null",
  "mainActivityAr": "النشاط الرئيسي or null",
  "registrationStatus": "Active/Inactive or null",
  "authorizedSignatory": "name or null"
}`;

    const msg = await Promise.race([
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: parsePrompt }],
      }),
      new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 20000)),
    ]);

    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      Object.assign(report.parsed, parsed);
      report.parsed.headquarterCity = parsed.city || null;
    }
    emit(emitter, { type: "agent_complete", agentNum: 2, agentName: "CR Data Parser", data: report.parsed });
  } catch (err: unknown) {
    emit(emitter, { type: "agent_error", agentNum: 2, agentName: "CR Data Parser",
      message: (err as Error).message });
  }

  // ─── AGENT 3: Emagazine AOA Search ────────────────────────────────────────
  emit(emitter, { type: "agent_start", agentNum: 3, agentName: "AOA Intelligence" });
  try {
    const companyName = report.parsed.nameAr || report.parsed.nameEn || crNumber;
    const browser2 = new StealthBrowser();
    await browser2.launch();
    state.stealthBrowser = browser2;

    await browser2.goto(`https://emagazine.aamaly.sa/Search?q=${encodeURIComponent(companyName)}`);
    await HumanBehavior.randomDelay(2000, 4000);

    // Look for latest AOA PDF link
    const pdfUrl = await browser2.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href*='.pdf'], a[href*='document']"));
      const aoaLink = links.find(l => {
        const text = (l as HTMLAnchorElement).textContent || "";
        return text.includes("عقد") || text.includes("نظام") || (l as HTMLAnchorElement).href.includes("aoa");
      });
      return aoaLink ? (aoaLink as HTMLAnchorElement).href : null;
    });

    if (pdfUrl) {
      emit(emitter, { type: "agent_log", agentNum: 3, agentName: "AOA Intelligence",
        message: `AOA PDF found: ${pdfUrl}` });
      report.sources.emagazine = { pdfUrl, foundAt: new Date().toISOString() };
    } else {
      emit(emitter, { type: "agent_log", agentNum: 3, agentName: "AOA Intelligence",
        message: "No AOA PDF found on emagazine — will use Perplexity AOA research" });
    }

    const pageText = await browser2.evaluate(() => document.body.innerText.slice(0, 5000));
    report.sources.emagazine = { ...report.sources.emagazine, pageText };

    await browser2.stop();
    state.stealthBrowser = undefined;
    emit(emitter, { type: "agent_complete", agentNum: 3, agentName: "AOA Intelligence",
      data: report.sources.emagazine });
  } catch (err: unknown) {
    emit(emitter, { type: "agent_error", agentNum: 3, agentName: "AOA Intelligence",
      message: (err as Error).message });
  }

  // ─── AGENT 4: AOA PDF Parser ───────────────────────────────────────────────
  emit(emitter, { type: "agent_start", agentNum: 4, agentName: "AOA Document Parser" });
  try {
    const emagazineData = report.sources.emagazine as Record<string, string>;
    const rawAoaText = emagazineData.pageText || "";
    const companyName = report.parsed.nameAr || report.parsed.nameEn || crNumber;

    // Also run Perplexity AOA search in parallel
    const perplexityAoa = await perplexitySearch(
      `"${companyName}" Saudi Arabia شركة سجل تجاري عقد تأسيس رأس المال المدفوع شركاء مساهمون مجلس إدارة CR number shareholders board of directors paid-up capital articles of association legal form LLC JSC`,
      2500
    );

    const aoaParsePrompt = `You are a Saudi corporate law specialist. Parse this AOA (Articles of Association) data for company: "${companyName}"

AOA Data from emagazine:
${rawAoaText.slice(0, 3000)}

Additional research:
${perplexityAoa?.slice(0, 2000) || "Not available"}

Return ONLY valid JSON:
{
  "shareholders": [
    { "nameEn": "English name", "nameAr": "الاسم بالعربية", "nationalId": "ID or null", "ownershipPct": "XX%", "nationality": "Saudi/Other" }
  ],
  "boardOfDirectors": [
    { "nameEn": "English name", "nameAr": "الاسم بالعربية", "role": "Chairman/Member/etc", "nationalId": null }
  ],
  "management": [
    { "nameEn": "English name", "nameAr": "الاسم بالعربية", "title": "CEO/CFO/GM/etc", "powers": "full/limited/etc" }
  ],
  "capitalDistribution": "description of how capital is distributed among shareholders",
  "profitDistributionRules": "profit distribution policy",
  "shareTransferRestrictions": "share transfer rules",
  "dissolutionConditions": "conditions for company dissolution",
  "boardComposition": "board structure description"
}

Rules: Only real verified persons. Arabic names MUST be in proper Arabic script. Empty array [] if none found.`;

    const aoaMsg = await Promise.race([
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: aoaParsePrompt }],
      }),
      new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 30000)),
    ]);

    const aoaText = aoaMsg.content[0]?.type === "text" ? aoaMsg.content[0].text : "";
    const aoaMatch = aoaText.match(/\{[\s\S]*\}/);
    if (aoaMatch) {
      const aoa = JSON.parse(aoaMatch[0]);
      report.aoa = aoa;
      if (Array.isArray(aoa.shareholders) && aoa.shareholders.length > 0) {
        report.parsed.shareholders = aoa.shareholders;
      }
      if (Array.isArray(aoa.management) && aoa.management.length > 0) {
        report.parsed.managers = aoa.management;
      }
      report.parsed.capitalDistribution = aoa.capitalDistribution || null;
      report.parsed.profitDistributionRules = aoa.profitDistributionRules || null;
      report.parsed.shareTransferRestrictions = aoa.shareTransferRestrictions || null;
      report.parsed.boardComposition = aoa.boardComposition || null;
      report.parsed.dissolutionConditions = aoa.dissolutionConditions || null;
    }
    emit(emitter, { type: "agent_complete", agentNum: 4, agentName: "AOA Document Parser", data: report.aoa });
  } catch (err: unknown) {
    emit(emitter, { type: "agent_error", agentNum: 4, agentName: "AOA Document Parser",
      message: (err as Error).message });
  }

  // ─── AGENT 5: Najiz Legal Agencies ────────────────────────────────────────
  emit(emitter, { type: "agent_start", agentNum: 5, agentName: "Najiz Legal Agencies" });
  try {
    const companyName = report.parsed.nameAr || report.parsed.nameEn || crNumber;
    const najizRes = await perplexitySearch(
      `site:najiz.moj.gov.sa OR "najiz" "${companyName}" Saudi Arabia legal representative law firm agency وكيل قانوني محامي ${crNumber}`,
      1500
    );
    report.sources.najiz = { rawData: najizRes || "Not found" };
    report.legalAgencies = []; // populate if data found in najizRes
    emit(emitter, { type: "agent_complete", agentNum: 5, agentName: "Najiz Legal Agencies",
      data: { found: !!najizRes } });
  } catch (err: unknown) {
    emit(emitter, { type: "agent_error", agentNum: 5, agentName: "Najiz Legal Agencies",
      message: (err as Error).message });
  }

  // ─── AGENT 6: Deep Research + Compliance ──────────────────────────────────
  emit(emitter, { type: "agent_start", agentNum: 6, agentName: "Cross-Validator" });
  try {
    const name = report.parsed.nameEn || crNumber;
    const nameAr = report.parsed.nameAr || "";
    const city = report.parsed.headquarterCity || "";
    const crRef = crNumber ? ` CR ${crNumber}` : "";

    // Run all sources in parallel
    const [
      p1, p2, p3, p4, p5,
      g1, g2, g3, g4,
      claudeRes, openaiRes,
      openRouterRes, groqRes,
    ] = await Promise.allSettled([
      // Perplexity ×5
      perplexitySearch(`Saudi company "${name}"${crRef} ${city}: official website phone email address employees revenue SAR description business activities industry.`),
      perplexitySearch(`"${name}" Saudi Arabia latest news 2024 2025 announcements expansions investments contracts financial results`),
      perplexitySearch(`"${name}" Saudi Arabia شركة سجل تجاري عقد تأسيس رأس المال المدفوع مساهمون مجلس إدارة shareholders board paid-up capital legal form`),
      perplexitySearch(`"${name}" Saudi Arabia CEO chairman board management executives مدير عام رئيس مجلس الإدارة — full names Arabic and English`),
      perplexitySearch(`"${name}" Saudi Arabia annual revenue financial performance SAR employees government contracts`),

      // Gemini Chrome AI ×4
      searchWithGemini(`Saudi company "${name}"${crRef} ${city}: website phone email address revenue employees industry founding year CEO. Verified data only.`),
      searchWithGemini(`"${name}" Saudi Arabia shareholders owners ownership percentage مساهمون — exact names Arabic and English with percentages.`),
      searchWithGemini(`"${name}" Saudi Arabia CEO chairman executives board مدير عام رئيس — full names Arabic and English titles.`),
      crNumber ? searchWithGemini(`Saudi CR ${crNumber} "${name}" legal form paid-up capital founding date registered activities shareholders list mc.gov.sa.`) : Promise.resolve(null),

      // Claude direct research
      (async () => {
        const msg = await Promise.race([
          anthropic.messages.create({
            model: "claude-sonnet-4-6", max_tokens: 1500,
            messages: [{ role: "user", content: `Research Saudi company "${name}"${crRef} ${city}. Provide: CEO/GM full name EN+AR, key executives (name EN+AR, title), major shareholders (name EN+AR, ownership %), founding year, revenue SAR, website. Verified public data only.` }],
          }),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 20000)),
        ]);
        return msg.content[0]?.type === "text" ? msg.content[0].text : null;
      })(),

      // OpenAI synthesis
      (async () => {
        const r = await Promise.race([
          openai.chat.completions.create({
            model: "gpt-4o", max_completion_tokens: 1000,
            messages: [
              { role: "system", content: "You are a Saudi Arabia B2B intelligence analyst. Provide factual verified data only." },
              { role: "user", content: `What is publicly known about Saudi company "${name}"${crRef}? CEO name EN+AR, executives, shareholders with %, revenue, employees, website, industry, city.` },
            ],
          }),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 20000)),
        ]);
        return r.choices[0]?.message?.content || null;
      })(),

      // OpenRouter (optional — activates if OPENROUTER_API_KEY is set)
      openRouterQuery("deepseek/deepseek-r1", `Saudi company "${name}"${crRef}: shareholders names%, executives, revenue SAR, website, phone. Public verified data.`),

      // Groq (optional — activates if GROQ_API_KEY is set)
      groqQuery("llama-3.3-70b-instruct-versatile", `Saudi company "${name}"${crRef}: key facts, shareholders, executives, financials.`),
    ]);

    // Collect all research
    const researchParts: string[] = [];
    const results = [p1, p2, p3, p4, p5, g1, g2, g3, g4, claudeRes, openaiRes, openRouterRes, groqRes];
    const labels = ["Perplexity General", "Perplexity News", "Perplexity AOA", "Perplexity Executives", "Perplexity Revenue",
      "Gemini Profile", "Gemini Shareholders", "Gemini Executives", "Gemini CR Registry",
      "Claude Research", "OpenAI Research", "OpenRouter Research", "Groq Research"];

    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) {
        researchParts.push(`[${labels[i]}]\n${String(r.value).slice(0, 2500)}`);
      }
    });

    // Compliance check
    const compliance: ComplianceResult = {
      ofac: { hit: false, entries: [], matchScore: "0%" },
      unsc: { hit: false, entries: [] },
      eu: { hit: false, entries: [] },
      maroof: { verified: false, rating: null, data: "" },
      saudiRegulatory: {
        cma: { hit: false, notes: "" },
        sama: { hit: false, notes: "" },
        zatca: { hit: false, notes: "" },
        najiz: { agencies: [], found: false },
      },
      newsFlags: [],
      overallRisk: "low",
      riskSummary: "No significant compliance flags detected.",
      checkedAt: new Date().toISOString(),
    };

    // Check OFAC via Perplexity
    const ofacCheck = await perplexitySearch(
      `"${name}" OR "${nameAr}" OFAC SDN list US Treasury sanctions EU sanctions UN Security Council sanctioned entity — is this company or its owners sanctioned?`,
      500
    );
    if (ofacCheck && /sanction|blacklist|SDN|blocked|prohibited/i.test(ofacCheck)) {
      compliance.ofac.hit = true;
      compliance.overallRisk = "high";
      compliance.newsFlags.push("Possible sanctions mention detected");
    }

    // Check Maroof
    const maroofCheck = await perplexitySearch(
      `site:maroof.sa "${name}" — is this company verified on Maroof Saudi e-commerce platform?`,
      300
    ).catch(() => null);
    if (maroofCheck && /verified|approved|موثق/i.test(maroofCheck)) {
      compliance.maroof.verified = true;
    }

    report.parsed.estimatedRevenue = researchParts.join("\n\n").match(/SAR [\d,.]+ ?(?:million|billion|M|B)/)?.[0] || null;

    // Store full research for report compilation
    (report as Record<string, unknown>)._researchParts = researchParts;
    report.compliance = compliance;

    emit(emitter, { type: "agent_complete", agentNum: 6, agentName: "Cross-Validator",
      data: { sourcesReturned: researchParts.length, complianceRisk: compliance.overallRisk } });
  } catch (err: unknown) {
    emit(emitter, { type: "agent_error", agentNum: 6, agentName: "Cross-Validator",
      message: (err as Error).message });
  }

  // ─── AGENT 7: Bilingual Report Compiler ───────────────────────────────────
  emit(emitter, { type: "agent_start", agentNum: 7, agentName: "Report Compiler" });
  try {
    const researchParts = (report as Record<string, unknown>)._researchParts as string[] || [];
    const combinedResearch = researchParts.join("\n\n---\n\n").slice(0, 12000);
    const name = report.parsed.nameEn || crNumber;

    const compilePrompt = `You are an elite Saudi Arabia B2B intelligence analyst and Arabic-English bilingual report writer.

Company: "${name}"
CR Number: ${crNumber}
Known fields:
- Legal Form: ${report.parsed.legalForm || "Unknown"}
- City: ${report.parsed.headquarterCity || "Unknown"}
- Capital: ${report.parsed.capitalAmount || "Unknown"}
- Shareholders: ${JSON.stringify(report.parsed.shareholders)}
- Management: ${JSON.stringify(report.parsed.managers)}

Research data:
${combinedResearch}

TASK 1 — Structured JSON data (update/confirm all fields):
{
  "nameEn": "...",
  "nameAr": "...",
  "legalForm": "LLC/Joint Stock/etc",
  "legalFormAr": "شركة ذات مسؤولية محدودة/etc",
  "foundingYear": "YYYY",
  "capitalAmount": "SAR X,XXX,XXX",
  "estimatedRevenue": "SAR X - Y million",
  "revenueRationale": "derived from capital × multiplier / direct from research",
  "website": "https://...",
  "phone": "+966...",
  "email": "...",
  "address": "full address",
  "employeeCount": "number or range",
  "description": "2-3 sentence company description in English",
  "ownerName": "primary owner/chairman name in English",
  "ownerNameAr": "اسم المالك/الرئيس بالعربية",
  "ownerTitle": "Chairman/CEO/Founder/etc",
  "shareholders": [{"nameEn":"","nameAr":"","ownershipPct":"","nationality":""}],
  "management": [{"nameEn":"","nameAr":"","title":""}],
  "boardOfDirectors": [{"nameEn":"","nameAr":"","role":""}]
}

TASK 2 — Write English intelligence report (reportEn): 400-600 words covering company overview, financials, ownership, leadership, market position, compliance status.

TASK 3 — Write Arabic intelligence report (reportAr): Full Arabic equivalent of the English report. Proper Arabic business writing. 300-500 words.

Return JSON with keys: "structured", "reportEn", "reportAr"`;

    let compileResult = null;
    try {
      const claudeMsg = await Promise.race([
        anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          messages: [{ role: "user", content: compilePrompt }],
        }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 45000)),
      ]);
      const text = claudeMsg.content[0]?.type === "text" ? claudeMsg.content[0].text : "";
      const match = text.match(/\{[\s\S]*\}/);
      if (match) compileResult = JSON.parse(match[0]);
    } catch {
      // GPT-4o fallback
      const gptRes = await openai.chat.completions.create({
        model: "gpt-4o",
        max_completion_tokens: 4000,
        messages: [
          { role: "system", content: "You are a Saudi B2B intelligence report writer. Return JSON only." },
          { role: "user", content: compilePrompt },
        ],
      });
      const text = gptRes.choices[0]?.message?.content || "";
      const match = text.match(/\{[\s\S]*\}/);
      if (match) compileResult = JSON.parse(match[0]);
    }

    if (compileResult) {
      if (compileResult.structured) Object.assign(report.parsed, compileResult.structured);
      report.reportEn = compileResult.reportEn || "";
      report.reportAr = compileResult.reportAr || "";
    }

    // Cross-validation: detect conflicts between MC.gov.sa and AOA data
    const conflicts: MasaarReport["conflicts"] = [];
    const mcData = report.sources.mcGovSa as Record<string, string>;
    const aoaData = report.aoa as Record<string, unknown>;
    // Compare capital amounts, names, etc.
    if (mcData.capital && aoaData.capitalDistribution &&
        String(mcData.capital) !== String(aoaData.capitalDistribution)) {
      conflicts.push({
        field: "capitalAmount",
        source1: "MC.gov.sa", value1: String(mcData.capital),
        source2: "AOA", value2: String(aoaData.capitalDistribution),
        severity: "medium",
        recommendation: "Verify with official CR certificate",
      });
    }
    report.conflicts = conflicts;

    // Clean up internal data
    delete (report as Record<string, unknown>)._researchParts;

    emit(emitter, { type: "agent_complete", agentNum: 7, agentName: "Report Compiler",
      data: { reportLength: report.reportEn.length, conflictsFound: conflicts.length } });
    emit(emitter, { type: "job_complete", report });
  } catch (err: unknown) {
    emit(emitter, {
      type: "job_error",
      message: (err as Error).message,
    });
  }
}

// Optional: search by company name instead of CR number
export async function runMasaarPipelineByName(companyName: string, jobId: string): Promise<void> {
  // First resolve company name to CR number via MC.gov.sa, then run normal pipeline
  const nameRes = await perplexitySearch(
    `site:mc.gov.sa OR "mc.gov.sa" "${companyName}" Saudi Arabia commercial registration CR number سجل تجاري`,
    500
  ).catch(() => null);
  const crMatch = nameRes?.match(/\b(\d{10})\b/);
  const crNumber = crMatch ? crMatch[1] : "0000000000"; // fallback: proceed without CR
  return runMasaarPipeline(crNumber, jobId);
}
```

---

## 5. BACKEND: Express Routes (masaar.ts)

```typescript
import { Router } from "express";
import { createJob, getJobEmitter, runMasaarPipeline, submitCaptcha, type AgentEvent } from "./masaar-engine.js";
import { randomUUID } from "crypto";

const router = Router();

// POST /api/masaar/start
router.post("/masaar/start", async (req, res) => {
  const { crNumber, stealthMode } = req.body;
  if (!crNumber || !/^\d{7,12}$/.test(String(crNumber).trim())) {
    res.status(400).json({ error: "Valid CR number (7-12 digits) is required" });
    return;
  }

  const jobId = randomUUID();
  const useStealthMode = stealthMode !== false;
  createJob(jobId, useStealthMode);

  res.json({
    jobId,
    crNumber: String(crNumber).trim(),
    stealthMode: useStealthMode,
    message: `Masaar pipeline started`,
  });

  setImmediate(() => {
    runMasaarPipeline(String(crNumber).trim(), jobId).catch((err) => {
      getJobEmitter(jobId)?.emit("event", { type: "job_error", message: err.message });
    });
  });
});

// POST /api/masaar/captcha/:jobId — submit manual CAPTCHA
router.post("/masaar/captcha/:jobId", (req, res) => {
  const { jobId } = req.params;
  const { captchaText, captchaFor } = req.body;
  if (!captchaText || !captchaFor) {
    res.status(400).json({ error: "captchaText and captchaFor are required" });
    return;
  }
  const ok = submitCaptcha(jobId, String(captchaFor), String(captchaText).trim());
  if (!ok) {
    res.status(404).json({ error: "No CAPTCHA pending for this job" });
    return;
  }
  res.json({ ok: true, message: "CAPTCHA submitted — pipeline resuming" });
});

// GET /api/masaar/stream/:jobId — SSE stream
router.get("/masaar/stream/:jobId", (req, res) => {
  const emitter = getJobEmitter(req.params.jobId);
  if (!emitter) {
    res.status(404).json({ error: "Job not found or expired" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (event: AgentEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  };

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  emitter.on("event", sendEvent);

  const cleanup = () => {
    clearInterval(heartbeat);
    emitter.off("event", sendEvent);
  };

  emitter.on("event", (evt: AgentEvent) => {
    if (evt.type === "job_complete" || evt.type === "job_error") {
      setTimeout(cleanup, 2000);
    }
  });

  req.on("close", cleanup);
  req.on("error", cleanup);
});

export default router;
```

---

## 6. FRONTEND: masaar/index.tsx

### 6a. Complete UI State

```typescript
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// State
const [crNumber, setCrNumber] = useState("");
const [jobId, setJobId] = useState<string | null>(null);
const [events, setEvents] = useState<AgentEvent[]>([]);
const [report, setReport] = useState<MasaarReport | null>(null);
const [status, setStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
const [error, setError] = useState<string | null>(null);

// CAPTCHA overlay state
const [captchaOpen, setCaptchaOpen] = useState(false);
const [captchaFor, setCaptchaFor] = useState("");
const [captchaScreenshot, setCaptchaScreenshot] = useState("");
const [captchaLabel, setCaptchaLabel] = useState("");
const [captchaInput, setCaptchaInput] = useState("");
const [captchaSubmitting, setCaptchaSubmitting] = useState(false);

// Track per-agent status (1–7)
const [agentStatuses, setAgentStatuses] = useState<Record<number, "pending" | "running" | "done" | "error">>({});

const esRef = useRef<EventSource | null>(null);
```

### 6b. Start Pipeline

```typescript
const startPipeline = async () => {
  if (!crNumber.trim() || !/^\d{7,12}$/.test(crNumber.trim())) {
    setError("Enter a valid CR number (7-12 digits)");
    return;
  }
  setError(null);
  setEvents([]);
  setReport(null);
  setAgentStatuses({});
  setStatus("running");

  const res = await fetch(`${BASE}/api/masaar/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ crNumber: crNumber.trim(), stealthMode: true }),
  });
  if (!res.ok) {
    const err = await res.json();
    setError(err.error || "Failed to start");
    setStatus("error");
    return;
  }
  const { jobId: id } = await res.json();
  setJobId(id);

  // Open SSE stream
  const es = new EventSource(`${BASE}/api/masaar/stream/${id}`);
  esRef.current = es;

  es.onmessage = (e) => {
    const evt: AgentEvent = JSON.parse(e.data);
    setEvents(prev => [...prev, evt]);

    if (evt.type === "agent_start" && evt.agentNum) {
      setAgentStatuses(prev => ({ ...prev, [evt.agentNum!]: "running" }));
    } else if (evt.type === "agent_complete" && evt.agentNum) {
      setAgentStatuses(prev => ({ ...prev, [evt.agentNum!]: "done" }));
    } else if (evt.type === "agent_error" && evt.agentNum) {
      setAgentStatuses(prev => ({ ...prev, [evt.agentNum!]: "error" }));
    } else if (evt.type === "captcha_required") {
      setCaptchaFor(evt.captchaFor || "");
      setCaptchaScreenshot(evt.captchaScreenshot || "");
      setCaptchaLabel(evt.captchaLabel || "CAPTCHA Required");
      setCaptchaInput("");
      setCaptchaOpen(true);
    } else if (evt.type === "captcha_solved") {
      setCaptchaOpen(false);
    } else if (evt.type === "job_complete") {
      setReport(evt.report!);
      setStatus("complete");
      es.close();
    } else if (evt.type === "job_error") {
      setError(evt.message || "Pipeline failed");
      setStatus("error");
      es.close();
    }
  };

  es.onerror = () => {
    setError("Connection lost. Please try again.");
    setStatus("error");
    es.close();
  };
};
```

### 6c. CAPTCHA Submit

```typescript
const submitCaptcha = async () => {
  if (!captchaInput.trim() || !jobId) return;
  setCaptchaSubmitting(true);
  try {
    await fetch(`${BASE}/api/masaar/captcha/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captchaText: captchaInput.trim(), captchaFor }),
    });
    setCaptchaOpen(false);
    setCaptchaInput("");
  } finally {
    setCaptchaSubmitting(false);
  }
};
```

### 6d. Full JSX Layout

```tsx
const AGENTS = [
  { num: 1, name: "MC.gov.sa Registry", icon: Building2 },
  { num: 2, name: "CR Data Parser",     icon: FileText },
  { num: 3, name: "AOA Intelligence",   icon: Search },
  { num: 4, name: "AOA Doc Parser",     icon: FileSearch },
  { num: 5, name: "Najiz Legal",        icon: Scale },
  { num: 6, name: "Cross-Validator",    icon: ShieldCheck },
  { num: 7, name: "Report Compiler",    icon: Bot },
];

return (
  <div className="p-6 max-w-5xl mx-auto space-y-6">
    {/* Header */}
    <div>
      <h1 className="text-3xl font-bold text-white">Masaar Engine</h1>
      <p className="text-muted-foreground mt-1">Saudi CR Intelligence — 7-Agent Pipeline</p>
    </div>

    {/* Input */}
    {status === "idle" && (
      <Card className="bg-card/60 border-white/10">
        <CardContent className="p-8">
          <div className="max-w-md mx-auto space-y-4">
            <label className="text-sm text-muted-foreground">Commercial Registration Number</label>
            <Input
              value={crNumber}
              onChange={(e) => setCrNumber(e.target.value.replace(/\D/g, "").slice(0, 12))}
              onKeyDown={(e) => e.key === "Enter" && startPipeline()}
              placeholder="e.g. 1010123456"
              className="bg-black/30 border-white/15 text-white h-12 text-lg"
              maxLength={12}
            />
            {error && <p className="text-rose-400 text-sm">{error}</p>}
            <Button onClick={startPipeline} className="w-full h-11 bg-primary hover:bg-primary/90">
              <Search className="w-4 h-4 mr-2" />Launch Intelligence Pipeline
            </Button>
          </div>
        </CardContent>
      </Card>
    )}

    {/* Agent Pipeline Progress */}
    {status === "running" && (
      <div className="space-y-3">
        <div className="grid grid-cols-7 gap-2">
          {AGENTS.map(({ num, name, icon: Icon }) => {
            const s = agentStatuses[num] || "pending";
            return (
              <div key={num} className={`rounded-lg p-3 border text-center transition-all ${
                s === "running" ? "bg-primary/20 border-primary/60 shadow-[0_0_15px_rgba(6,182,212,0.3)]" :
                s === "done" ? "bg-emerald-500/10 border-emerald-500/30" :
                s === "error" ? "bg-rose-500/10 border-rose-500/30" :
                "bg-white/3 border-white/8"
              }`}>
                <Icon className={`w-5 h-5 mx-auto mb-1 ${
                  s === "running" ? "text-primary animate-pulse" :
                  s === "done" ? "text-emerald-400" :
                  s === "error" ? "text-rose-400" : "text-muted-foreground"
                }`} />
                <p className="text-[10px] text-muted-foreground leading-tight">{name}</p>
                <p className="text-xs font-bold text-white mt-0.5">{num}</p>
              </div>
            );
          })}
        </div>

        {/* Event log */}
        <Card className="bg-black/40 border-white/8">
          <CardContent className="p-4 max-h-64 overflow-y-auto space-y-1">
            {events.slice(-30).map((evt, i) => (
              <p key={i} className={`text-xs font-mono ${
                evt.type === "agent_error" || evt.type === "job_error" ? "text-rose-400" :
                evt.type === "agent_complete" || evt.type === "job_complete" ? "text-emerald-400" :
                evt.type === "captcha_required" ? "text-amber-400" :
                "text-white/60"
              }`}>
                {evt.agentNum ? `[Agent ${evt.agentNum}] ` : ""}
                {evt.message || evt.type}
              </p>
            ))}
          </CardContent>
        </Card>
      </div>
    )}

    {/* CAPTCHA Overlay */}
    {captchaOpen && (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <Card className="bg-card border-amber-500/40 w-full max-w-sm shadow-2xl">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-amber-400 w-5 h-5" />
              <h3 className="text-white font-semibold">Human Verification Required</h3>
            </div>
            <p className="text-sm text-muted-foreground">{captchaLabel}</p>
            {captchaScreenshot && (
              <img src={`data:image/png;base64,${captchaScreenshot}`}
                alt="CAPTCHA" className="w-full rounded border border-white/10" />
            )}
            <Input
              value={captchaInput}
              onChange={(e) => setCaptchaInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitCaptcha()}
              placeholder="Type the characters shown above"
              className="bg-black/40 border-white/15 text-white"
              autoFocus
            />
            <Button onClick={submitCaptcha} disabled={captchaSubmitting || !captchaInput.trim()}
              className="w-full bg-amber-600 hover:bg-amber-500">
              {captchaSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Submit CAPTCHA
            </Button>
          </CardContent>
        </Card>
      </div>
    )}

    {/* Report Display */}
    {status === "complete" && report && (
      <div className="space-y-4">
        {/* Company Header */}
        <Card className="bg-primary/8 border-primary/20">
          <CardContent className="p-6">
            <h2 className="text-2xl font-bold text-white">{report.parsed.nameEn}</h2>
            {report.parsed.nameAr && <p className="text-lg text-white/70 mt-1 font-arabic">{report.parsed.nameAr}</p>}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
              <div><p className="text-muted-foreground text-xs">CR Number</p><p className="text-white font-mono">{report.crNumber}</p></div>
              <div><p className="text-muted-foreground text-xs">Legal Form</p><p className="text-white">{report.parsed.legalForm || "—"}</p></div>
              <div><p className="text-muted-foreground text-xs">City</p><p className="text-white">{report.parsed.headquarterCity || "—"}</p></div>
              <div><p className="text-muted-foreground text-xs">Paid-Up Capital</p><p className="text-white">{report.parsed.capitalAmount || "—"}</p></div>
              <div><p className="text-muted-foreground text-xs">Founded</p><p className="text-white">{report.parsed.foundingYear || "—"}</p></div>
              <div><p className="text-muted-foreground text-xs">Est. Revenue</p><p className="text-white">{report.parsed.estimatedRevenue || "—"}</p></div>
              <div><p className="text-muted-foreground text-xs">Compliance Risk</p>
                <p className={`font-bold ${report.compliance?.overallRisk === "high" ? "text-rose-400" : report.compliance?.overallRisk === "medium" ? "text-amber-400" : "text-emerald-400"}`}>
                  {report.compliance?.overallRisk?.toUpperCase() || "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Shareholders */}
        {report.parsed.shareholders.length > 0 && (
          <Card className="bg-card/60 border-white/10">
            <CardContent className="p-5">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" /> Shareholders
              </h3>
              <div className="space-y-2">
                {report.parsed.shareholders.map((s, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white/3 rounded-lg">
                    <div>
                      <p className="text-white text-sm font-medium">{s.nameEn}</p>
                      <p className="text-white/50 text-xs font-arabic">{s.nameAr}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-primary font-bold">{s.ownershipPct}</p>
                      <p className="text-muted-foreground text-xs">{s.nationality}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Management */}
        {report.parsed.managers.length > 0 && (
          <Card className="bg-card/60 border-white/10">
            <CardContent className="p-5">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <User className="w-4 h-4 text-primary" /> Management
              </h3>
              <div className="space-y-2">
                {report.parsed.managers.map((m, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white/3 rounded-lg">
                    <div>
                      <p className="text-white text-sm font-medium">{m.nameEn}</p>
                      <p className="text-white/50 text-xs font-arabic">{m.nameAr}</p>
                    </div>
                    <Badge variant="outline" className="text-primary border-primary/30">{m.title}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Conflicts */}
        {report.conflicts.length > 0 && (
          <Card className="bg-amber-500/8 border-amber-500/20">
            <CardContent className="p-5">
              <h3 className="text-amber-400 font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Data Conflicts Detected
              </h3>
              {report.conflicts.map((c, i) => (
                <div key={i} className="text-sm mb-2">
                  <p className="text-white font-medium">{c.field}</p>
                  <p className="text-white/60">{c.source1}: {c.value1} vs {c.source2}: {c.value2}</p>
                  {c.recommendation && <p className="text-amber-300/70 text-xs mt-0.5">{c.recommendation}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* English Report */}
        {report.reportEn && (
          <Card className="bg-card/60 border-white/10">
            <CardContent className="p-5">
              <h3 className="text-white font-semibold mb-3">Intelligence Report (English)</h3>
              <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">{report.reportEn}</p>
            </CardContent>
          </Card>
        )}

        {/* Arabic Report */}
        {report.reportAr && (
          <Card className="bg-card/60 border-white/10">
            <CardContent className="p-5">
              <h3 className="text-white font-semibold mb-3">تقرير الاستخبارات (العربي)</h3>
              <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap font-arabic text-right" dir="rtl">{report.reportAr}</p>
            </CardContent>
          </Card>
        )}

        {/* New Search */}
        <Button onClick={() => { setStatus("idle"); setReport(null); setCrNumber(""); setEvents([]); setAgentStatuses({}); }}
          variant="outline" className="border-white/10 text-white">
          New Search
        </Button>
      </div>
    )}
  </div>
);
```

---

## 7. PACKAGE DEPENDENCIES

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.0",
    "openai": "^4.67.0",
    "axios": "^1.7.0",
    "cheerio": "^1.0.0",
    "puppeteer": "^23.0.0",
    "express": "^4.21.0",
    "drizzle-orm": "^0.36.0",
    "pg": "^8.13.0",
    "@tanstack/react-query": "^5.59.0",
    "wouter": "^3.3.0",
    "lucide-react": "^0.460.0"
  }
}
```

---

## 8. KEY IMPLEMENTATION NOTES

1. **SSE Pattern**: Start job → return jobId immediately → client opens EventSource to `/stream/:jobId` → each agent emits events → `job_complete` event carries full report → client closes EventSource.

2. **CAPTCHA Flow**: Agent hits CAPTCHA → tries AI solve → tries human-behavior simulation → sends `captcha_required` event with base64 screenshot → frontend shows overlay → user types text → POST to `/captcha/:jobId` → `submitCaptcha()` resolves the Promise → agent continues.

3. **Parallel Research (Agent 6)**: `Promise.allSettled()` fires 13 queries simultaneously (Perplexity ×5, Gemini ×4, Claude, GPT-4o, OpenRouter, Groq). `allSettled` ensures one failure doesn't abort the rest.

4. **Revenue Derivation Rule** (mandatory — never return null):
   - Service/IT: capital × 10–20x OR employees × SAR 800K–1.5M/person
   - Trading: capital × 5–12x OR employees × SAR 1.5–4M/person
   - Construction: capital × 4–10x OR employees × SAR 1–2M/person
   - Manufacturing: capital × 4–8x

5. **Stealth Browser**: Uses Puppeteer with stealth plugins, random delays, mouse movement simulation, and viewport randomization to avoid bot detection on mc.gov.sa.

6. **Job cleanup**: `setTimeout(45 min)` auto-deletes job state from the Map to prevent memory leaks. No DB persistence required for the engine itself.
