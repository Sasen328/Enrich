# ProsEngine — Full-Stack Replication Guide

> Complete technical documentation for replicating ProsEngine (Person Intelligence + Company Intelligence + AI Chat) in a new application. Covers every layer: infrastructure, backend, AI engines, frontend, data flow, and deployment.

---

## Table of Contents

1. [What is ProsEngine](#1-what-is-prosengine)
2. [Full Tech Stack](#2-full-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Environment Variables & Secrets](#4-environment-variables--secrets)
5. [Backend — Express Server Setup](#5-backend--express-server-setup)
6. [AI Module Architecture](#6-ai-module-architecture)
7. [Person Intelligence — Backend](#7-person-intelligence--backend)
8. [Company Intelligence — Backend](#8-company-intelligence--backend)
9. [ProsEngine Chat — Backend](#9-prosengine-chat--backend)
10. [Web Crawling Stack](#10-web-crawling-stack)
11. [Database Layer](#11-database-layer)
12. [Frontend — Application Shell](#12-frontend--application-shell)
13. [Person Intelligence — Frontend](#13-person-intelligence--frontend)
14. [Company Intelligence — Frontend](#14-company-intelligence--frontend)
15. [ProsEngineChat — Floating AI Assistant](#15-prosengine-chat--floating-ai-assistant)
16. [Complete API Reference](#16-complete-api-reference)
17. [Frontend ↔ Backend Communication Patterns](#17-frontend--backend-communication-patterns)
18. [Key Implementation Rules](#18-key-implementation-rules)

---

## 1. What is ProsEngine

ProsEngine is a Saudi Arabia B2B intelligence engine with two primary modules:

**Person Intelligence** — Given a person's name (+ optional company, title, LinkedIn URL), it fires 20 parallel research agents across Perplexity, Gemini Google Search, LinkedIn crawl, company website crawl, Apollo.io, Explorium, Claude training data, GPT-4o training data, and o4-mini DeepResearch. A three-way synthesis (Gemini → Claude → GPT-4o) produces a structured JSON dossier covering career, education, wealth, board memberships, and a personalized B2B approach strategy.

**Company Intelligence** — Given a company name (+ optional website, CR number, city), it fires 11 parallel research agents across stealth browser website crawl, 4 Gemini Google Search agents, 4 Perplexity web searches, Claude, and GPT-4o. Claude + Gemini synthesis produces a structured JSON report covering profile, financials, ownership, leadership, operations, market, and approach strategy.

**ProsEngine Chat** — A floating AI assistant that loads the generated report as context and responds to follow-up questions, live Perplexity searches, URL crawls, or o4-mini DeepResearch based on intent classification. Streams live research steps via SSE.

---

## 2. Full Tech Stack

### Backend

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ (ESM modules, `"type": "module"`) |
| Framework | Express 5 |
| Language | TypeScript (compiled with `tsx` for dev, `esbuild` for prod) |
| Database ORM | Drizzle ORM |
| Database | PostgreSQL |
| AI: Primary LLM | Anthropic Claude Sonnet (`claude-sonnet-4-6`) |
| AI: Secondary LLM | OpenAI GPT-4o + o4-mini DeepResearch |
| AI: Web Search (primary) | Google Gemini 2.5 Flash (`gemini-2.5-flash`) — `@google/genai` SDK |
| AI: Web Search (secondary) | Perplexity Sonar (`sonar` model) |
| Web Scraping | Playwright Chromium (headless + stealth) |
| Fallback Crawling | Playwright via `crawl4ai` wrapper + HTTP `fetch` + `cheerio` |
| HTML Parsing | `cheerio` |
| Markdown Conversion | `turndown` |
| People Data | Apollo.io REST API |
| Firmographic Data | Explorium REST API |
| HTTP Client | `axios` |

### Frontend

| Layer | Technology |
|---|---|
| Framework | React 18 |
| Build Tool | Vite |
| Language | TypeScript |
| Routing | `wouter` |
| State / Data Fetching | TanStack React Query |
| UI Components | Radix UI primitives |
| Styling | Tailwind CSS |
| Icons | `lucide-react` |
| Theme | `next-themes` (dark mode forced) |
| Notifications | Sonner (toast) |

---

## 3. Project Structure

```
project-root/
├── artifacts/
│   ├── api-server/                 ← Express backend
│   │   ├── src/
│   │   │   ├── index.ts            ← Entry point (starts server)
│   │   │   ├── app.ts              ← Express app (middleware, router registration)
│   │   │   ├── routes/
│   │   │   │   ├── index.ts        ← Main router (registers all sub-routes)
│   │   │   │   ├── person-intel.ts ← Person Intelligence pipeline + CRUD
│   │   │   │   ├── company-intel.ts← Company Intelligence pipeline + CRUD
│   │   │   │   └── prosengine-chat.ts ← AI Chat (non-streaming + SSE streaming)
│   │   │   ├── lib/
│   │   │   │   ├── stealth-browser.ts ← Playwright stealth wrapper
│   │   │   │   ├── apollo-service.ts  ← Apollo.io integration
│   │   │   │   └── explorium-service.ts ← Explorium integration
│   │   │   ├── gemini-search.ts    ← All Gemini functions
│   │   │   ├── perplexity-service.ts ← Perplexity service class
│   │   │   ├── crawl4ai-engine.ts  ← Playwright + turndown crawler
│   │   │   └── browser-helper.ts   ← Lightweight page content fetcher
│   │   └── package.json
│   │
│   └── prospect-sa/                ← React frontend
│       ├── src/
│       │   ├── main.tsx            ← React entry point
│       │   ├── App.tsx             ← Router setup + QueryClientProvider
│       │   ├── components/
│       │   │   ├── layout/
│       │   │   │   ├── Layout.tsx  ← Page shell (sidebar + content area)
│       │   │   │   └── AppSidebar.tsx ← Navigation sidebar
│       │   │   ├── ProsEngineChat.tsx ← Floating chat panel component
│       │   │   └── ui/             ← shadcn/Radix UI components
│       │   └── pages/
│       │       └── prospecting/
│       │           ├── index.tsx   ← ProsEngine module hub page
│       │           ├── person.tsx  ← Person Intelligence page (wizard + report)
│       │           └── company.tsx ← Company Intelligence page (wizard + report)
│       └── package.json
│
└── lib/
    └── db/
        ├── src/
        │   ├── index.ts            ← DB connection (Drizzle + postgres-js)
        │   └── schema/
        │       ├── prosengine_research.ts
        │       └── company_intel_research.ts
        └── package.json
```

---

## 4. Environment Variables & Secrets

All secrets are stored as environment variables. Never hardcode them.

### Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `GEMINI_API_KEY` | Google Gemini API (web search + generation) |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Anthropic proxy base URL |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Claude Sonnet access |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI proxy base URL |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | GPT-4o + o4-mini DeepResearch |
| `PERPLEXITY_API_KEY` | Perplexity Sonar web search |
| `PORT` | Server port (set by platform) |

### Optional

| Variable | Purpose |
|---|---|
| `APOLLO_API_KEY` | Apollo.io person lookup (person intel enrichment) |
| `EXPLORIUM_API_KEY` | Explorium firmographic data (person intel enrichment) |
| `DISABLE_PERPLEXITY` | Set to `"true"` to disable Perplexity (falls back to Gemini) |

### How Clients Are Initialized

```typescript
// Anthropic
import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || undefined,
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "dummy",
});

// OpenAI
import OpenAI from "openai";
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

// Gemini
import { GoogleGenAI } from "@google/genai";
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
```

---

## 5. Backend — Express Server Setup

### Entry Point (`index.ts`)

```typescript
import app from "./app";
const port = Number(process.env.PORT);
app.listen(port, () => console.log(`Server listening on port ${port}`));
```

### Express App (`app.ts`)

```typescript
import express from "express";
import cors from "cors";
import router from "./routes";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api", router);       // all routes mounted at /api
export default app;
```

### Routes Index (`routes/index.ts`)

```typescript
import { Router } from "express";
import personIntelRouter from "./person-intel.js";
import companyIntelRouter from "./company-intel.js";
import prosEngineChatRouter from "./prosengine-chat.js";

const router = Router();
router.use(personIntelRouter);     // /api/person-intel/*
router.use(companyIntelRouter);    // /api/company-intel/*
router.use(prosEngineChatRouter);  // /api/prosengine/*
export default router;
```

---

## 6. AI Module Architecture

### Gemini Functions (`gemini-search.ts`)

There are four distinct Gemini functions. Their return types are **not interchangeable**:

```typescript
// 1. Pure text generation — NO web search tools
// Returns: string | null
// Use for: synthesis, JSON generation, structured output
generateWithGemini(
  prompt: string,
  systemPrompt?: string,
  model?: "gemini-2.5-flash" | "gemini-2.5-pro"
): Promise<string | null>

// 2. Web-grounded search — has googleSearch + urlContext tools (browses live pages)
// Returns: string | null
// Use for: company profile queries, competitor lookups
searchWithGemini(query: string): Promise<string | null>

// 3. Deep research with grounding metadata — googleSearch + urlContext
// Returns: { text: string; groundingChunks: string[] } | null   ← NOT a string
// Use for: person research agents, named research queries
// CRITICAL: NEVER call .match() on the result — it's an object, not a string
deepResearchWithGemini(
  query: string,
  systemContext?: string,
  model?: "gemini-2.5-flash" | "gemini-2.5-pro",
  useUrlContext?: boolean
): Promise<{ text: string; groundingChunks: string[] } | null>

// 4. synthesis alias — same as generateWithGemini but with stronger defaults
// Returns: string | null
synthesizeWithGemini(
  prompt: string,
  systemPrompt?: string,
  model?: "gemini-2.5-flash" | "gemini-2.5-pro"
): Promise<string | null>
```

**Configuration guard — always check before using Gemini:**
```typescript
export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
```

**3-attempt retry with exponential backoff on 503:**
```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    // ... call Gemini
  } catch (e) {
    const is503 = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("overloaded");
    if (is503 && attempt < 2) {
      await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
      continue;
    }
    return null;
  }
}
```

### Perplexity (`perplexity-service.ts`)

```typescript
// Direct fetch pattern used throughout the codebase:
const resp = await fetch("https://api.perplexity.ai/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "sonar",
    messages: [
      { role: "system", content: "Saudi Arabia B2B intelligence analyst..." },
      { role: "user", content: query }
    ],
    max_tokens: 2000,
    temperature: 0.1,
    return_citations: true,
  }),
  signal: AbortSignal.timeout(25000),
});
const data = await resp.json();
const result = data.choices?.[0]?.message?.content || "";
```

**Always include Gemini fallback after Perplexity:**
```typescript
async function webSearch(query: string): Promise<string> {
  // 1. Try Perplexity
  if (process.env.PERPLEXITY_API_KEY) {
    try { /* Perplexity call */ const r = await ... ; if (r.length > 50) return r; }
    catch { /* fall through */ }
  }
  // 2. Fallback: Gemini with Google Search grounding
  if (isGeminiConfigured()) {
    const r = await deepResearchWithGemini(query, "...", "gemini-2.5-flash");
    if (r) return r.text;  // ← always use .text property
  }
  return "";
}
```

### OpenAI / o4-mini DeepResearch

```typescript
// Standard chat completion:
const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "system", content: "..." }, { role: "user", content: "..." }],
  max_completion_tokens: 2000,   // ← ALWAYS max_completion_tokens, NEVER max_tokens
});
const result = completion.choices[0]?.message?.content ?? null;

// DeepResearch (o4-mini with web_search_preview tool):
const resp = await openai.responses.create({
  model: "o4-mini-deep-research-2025-06-26",
  input: [
    { role: "developer", content: [{ type: "input_text", text: "System prompt..." }] },
    { role: "user", content: [{ type: "input_text", text: "Query..." }] },
  ],
  tools: [{ type: "web_search_preview" }],
});
// Extract text from response output
let text = "";
for (const item of resp.output) {
  if (item.type === "message" && Array.isArray(item.content)) {
    for (const block of item.content) {
      if (block.type === "output_text") text += block.text + "\n";
    }
  }
}
```

**AI Priority Order — always: Gemini first → Claude second → GPT-4o third**

---

## 7. Person Intelligence — Backend

File: `artifacts/api-server/src/routes/person-intel.ts`

### Input Schema

```typescript
POST /api/person-intel/profile
{
  name: string;                    // required — full name
  company?: string;               // employer
  title?: string;                 // job title
  linkedinUrl?: string;           // LinkedIn URL (if already known)
  websiteUrl?: string;            // company website (for team page crawl)
  country?: string;               // default "Saudi Arabia"
  sellerContext?: {
    companyName?: string;         // your company
    product?: string;             // what you're selling
    objective?: string;           // single objective
    objectives?: string[];        // multiple objectives (preferred)
  };
  intelligenceGoals?: string[];   // ["wealth","approach","company","career","personal","competitive"]
  knownFacts?: string;            // pre-known facts (treated as confirmed data)
}
```

### 20-Agent Research Pipeline

All 19 agents (+ 1 sequential DeepResearch) run via `Promise.allSettled`:

```typescript
const [
  perplexityProfile,      // Perplexity #1: career & background
  perplexityCompany,      // Perplexity #2: company intel (skipped if no company)
  perplexityEducation,    // Perplexity #3: education history
  perplexityWealth,       // Perplexity #4: wealth & financial profile
  perplexityBoard,        // Perplexity #5: board memberships
  perplexityCompensation, // Perplexity #6: exec compensation benchmarks
  perplexityInterests,    // Perplexity #7: personal profile & interests
  perplexityNews,         // Perplexity #8: recent news 2024-2025
  perplexityLinkedIn,     // Perplexity #9: LinkedIn URL discovery
  linkedinText,           // Crawl: LinkedIn profile page (if URL provided)
  companyWebsiteCrawl,    // Crawl: company website team/about pages
  apolloData,             // Apollo.io person lookup
  exploriumData,          // Explorium firmographic lookup
  geminiCareerResult,     // Gemini Agent A: career + professional history (deepResearchWithGemini)
  geminiLinkedInResult,   // Gemini Agent B: LinkedIn URL + social media (deepResearchWithGemini)
  geminiCompanyNewsResult,// Gemini Agent C: company context + recent news (deepResearchWithGemini)
  geminiDeepResearchResult,// Gemini Agent D: comprehensive deep dossier (deepResearchWithGemini)
  claudeKnowledgeResult,  // Claude Agent E: training data knowledge (18s timeout)
  gptKnowledgeResult,     // GPT-4o Agent F: training data knowledge (18s timeout)
] = await Promise.allSettled([...19 agents...]);

// Sequential — runs AFTER the parallel batch
const deepResearchText = await Promise.race([
  deepResearchPerson(name, company, title),  // o4-mini with web_search_preview
  new Promise<string>(r => setTimeout(() => r(""), 10000)),
]);
```

### Perplexity Query Templates

Each Perplexity thread has a specific focus query:

```typescript
// Thread #1 - Career
`Full professional background and career history of "${name}" at ${company} in Saudi Arabia.
Include: ALL current and past roles with company names, dates, responsibilities, achievements.`

// Thread #2 - Company (only if company provided)
`Detailed company intelligence for ${company} in Saudi Arabia: founding year, founders,
shareholders ownership structure, CEO and executive team, revenue estimate, employee count,
market position, key clients, recent contracts, competitors, Vision 2030 alignment.`

// Thread #3 - Education
`Complete education and academic history of "${name}" in Saudi Arabia: universities attended,
degrees earned with field, graduation years, scholarships, fellowships, international study.`

// Thread #4 - Wealth
`Wealth profile and financial indicators for "${name}" at ${company} Saudi Arabia:
estimated net worth, company equity stake, known property, investments, board compensation.`

// Thread #5 - Board
`All board memberships, advisory roles, and governance positions of "${name}": board director
of which companies, committee memberships, government advisory positions, non-profit boards.`

// Thread #6 - Compensation
`Executive compensation benchmarks for ${title} at ${company}: salary range, bonus structure,
long-term incentives, equity/stock, LTIP, total compensation. Saudi market benchmarks.`

// Thread #7 - Interests
`Personal profile and public presence of "${name}" Saudi Arabia: hobbies, sports,
philanthropic causes, public speeches, conference keynotes, media interviews, personality traits.`

// Thread #8 - News
`Latest news and public activities about "${name}" Saudi Arabia 2024-2025: business deals,
partnerships, conference appearances, LinkedIn posts, awards, promotions, company news.`

// Thread #9 - LinkedIn URL
`LinkedIn profile URL for "${name}" who works at ${company} as ${title} Saudi Arabia.
Return the full LinkedIn profile URL: linkedin.com/in/...`
```

### Gemini Agent Queries

```typescript
// Agent A — Career & Professional History
`Research the career and professional history of "${name}" at ${company}, ${title} in Saudi Arabia.
Find: ALL past and current job roles with exact company names, dates (month/year), responsibilities.
Education: universities, degrees, graduation years. Notable achievements, awards, promotions.
Public statements, speeches, interviews. Shareholding or ownership stakes. Board positions.
Government or advisory roles.`

// Agent B — LinkedIn URL + Social Media
`Find the LinkedIn profile URL and all social media accounts for "${name}" who works at ${company}
as ${title} in Saudi Arabia. Search for: LinkedIn URL (linkedin.com/in/...), Twitter/X profile URL,
any public social media accounts. Also find direct contact info if publicly available.`

// Agent C — Company Context & Recent News
`Research the latest news and business activities involving "${name}" from ${company}
in Saudi Arabia (2023-2025). Find: recent business deals, contracts, partnerships announced,
conference appearances, press releases, company performance news, Vision 2030 projects.`

// Agent D — Comprehensive Deep Dossier
`Comprehensive intelligence dossier on "${name}" at ${company}, ${title} in Saudi Arabia.
Provide everything you can find: full career history, education, board memberships, LinkedIn URL,
net worth estimate, family background if public, personal interests, philanthropy, recent news,
public statements, conferences, awards, relationships with government or Vision 2030.`
```

All 4 Gemini agents use `deepResearchWithGemini(...).then(r => r?.text ?? null)` — the `.text` property is extracted before adding to the parallel array.

### LinkedIn URL Discovery

After the parallel batch completes, the backend auto-discovers the LinkedIn URL:

```typescript
const linkedInDiscovery = val(perplexityLinkedIn) || geminiLinkedInText || claudeKnowledgeText || gptKnowledgeText;
const discoveredLinkedInUrl = !linkedinUrl
  ? (linkedInDiscovery.match(/linkedin\.com\/in\/[^\s"',>)]+/)?.[0] || "")
  : "";
const effectiveLinkedInUrl = linkedinUrl ||
  (discoveredLinkedInUrl ? `https://${discoveredLinkedInUrl.replace(/^https?:\/\//, "")}` : "");
```

### Synthesis (3-way parallel)

```typescript
const [geminiResult, claudeResult, gptResult] = await Promise.allSettled([
  // 1st: Gemini (synthesizeWithGemini — pure text generation, no web tools)
  isGeminiConfigured()
    ? synthesizeWithGemini(synthesisPrompt, INTEL_SYSTEM, "gemini-2.5-flash")
    : Promise.resolve(null),

  // 2nd: Claude (30s timeout, 4000 tokens)
  synthTimeout((async () => {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: INTEL_SYSTEM,
      messages: [{ role: "user", content: synthesisPrompt }],
    });
    return msg.content[0]?.type === "text" ? msg.content[0].text : null;
  })()),

  // 3rd: GPT-4o (30s timeout, 4000 tokens)
  synthTimeout((async () => {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: INTEL_SYSTEM }, { role: "user", content: synthesisPrompt }],
      max_completion_tokens: 4000,
    });
    return completion.choices[0]?.message?.content ?? null;
  })()),
]);

// Priority: Gemini → Claude → GPT-4o
const raw = getVal(geminiResult) ?? getVal(claudeResult) ?? getVal(gptResult) ?? "{}";
```

### Synthesis Prompt Structure

The synthesis prompt passes numbered sections to the AI for cross-referencing:

```
=== SOURCE 1: WEB SEARCH — Professional Background & Career ===
{perplexityProfile}

=== SOURCE 2: WEB SEARCH — Company Intelligence ===
{perplexityCompany}

... (up to SOURCE 20)

=== SOURCE 14: GEMINI AGENT A — Career & Professional History ===
{geminiCareerText}

=== SOURCE 18: CLAUDE AGENT E — Training Knowledge Base ===
{claudeKnowledgeText}

=== SOURCE 20: DEEP RESEARCH AGENT (o4-mini) ===
{deepResearchText}
```

**Synthesis Rules injected into every prompt:**
1. Cross-reference ALL sources — fact confirmed by 2+ sources = verified fact
2. LinkedIn URL: check Sources 9, 15, 17, 18, 19 — use any found URL
3. Confirmed facts: only facts present in research, cite source number
4. Estimates: label "Estimated:" in text AND in estimated_facts
5. Not found: only after checking ALL 20 sources. Never hallucinate.
6. Specificity: use exact numbers, dates, role titles from research
7. Never use generic phrases like "experienced executive" without evidence

### Person Intel Output Schema

```typescript
interface PersonIntelReport {
  profile: {
    fullName: string;         // full formal name
    arabicName: string;       // Arabic name or "Not found"
    title: string;            // current primary title
    company: string;          // current primary company
    nationality: string;      // nationality or "Not found"
    location: string;         // city, country
    age: number | null;
    linkedin: string;         // URL or "Not found"
  };
  career: Array<{
    company: string;
    title: string;
    period: string;           // "YYYY – YYYY" or "YYYY – Present"
    description: string;      // specific achievements, not generic
  }>;
  education: Array<{
    institution: string;
    degree: string;
    year: string;
  }>;
  company_analysis: {
    name: string;
    industry: string;
    founded: string;
    headquarters: string;
    employees: string;
    revenue_estimate: string;
    performance: string;
    market_position: string;
    key_clients: string[];
    recent_developments: string;
    competitors: string[];
    pain_points: string[];
  };
  wealth_profile: {
    estimated_net_worth: string;   // "Estimated: SAR X-Y million based on [reason]"
    income_estimate: string;
    wealth_sources: string[];
    assets: string;
    investments: string;
    lifestyle_indicators: string;
  };
  personal_profile: {
    interests: string[];
    personality_traits: string[];
    communication_style: string;
    languages: string[];
    board_memberships: string[];
    publications: string[];
    awards: string[];
    social_presence: string;
  };
  approach_strategy: {
    best_channel: string;
    best_timing: string;
    opening_angle: string;
    value_proposition: string;
    potential_objections: string[];
    conversation_starters: string[];
    cultural_notes: string;
    recommended_approach: string;  // 3-4 paragraphs
    sample_message: string;        // ready-to-send outreach
  };
  intelligence_notes: {
    confidence_level: "High" | "Medium" | "Low";
    data_sources: string[];
    verified_facts: string[];
    estimated_facts: string[];
    caveats: string;
  };
}
```

### Save + Retrieve

```typescript
// POST /api/person-intel/save
// Body: { personName, company, title, linkedinUrl, sellerContext, intelligenceGoals, knownFacts, report }
// Inserts into prosengine_research table

// GET /api/person-intel/saved
// Returns: all rows from prosengine_research ordered by created_at DESC, limit 100

// DELETE /api/person-intel/saved/:id
// Deletes row by id
```

---

## 8. Company Intelligence — Backend

File: `artifacts/api-server/src/routes/company-intel.ts`

### Input Schema

```typescript
POST /api/company-intel/profile
{
  companyName: string;             // required
  website?: string;               // company website URL
  crNumber?: string;              // 10-digit Saudi CR number
  city?: string;                  // city for location context
  sellerContext?: {
    companyName?: string;
    product?: string;
    objectives?: string[];
  };
  intelligenceGoals?: string[];   // ["profile","financials","ownership","leadership","market","approach"]
  knownFacts?: string;            // pre-known information
}
```

Default goals when not specified: all 6 — `["profile","financials","ownership","leadership","market","approach"]`

### 11-Agent Research Pipeline

```typescript
const [
  websiteCrawl,       // StealthBrowser → company website (falls back to crawl4ai)
  geminiProfile,      // Gemini #1: full company profile (searchWithGemini)
  geminiOwnership,    // Gemini #2: shareholders (searchWithGemini, only if "ownership" in goals)
  geminiLeadership,   // Gemini #3: executives & board (searchWithGemini, only if "leadership" in goals)
  geminiMarket,       // Gemini #4: competitive intelligence (searchWithGemini, only if "market" in goals)
  searchProfile,      // Perplexity #1: general profile & contact
  searchFinancials,   // Perplexity #2: financial data (only if "financials" in goals)
  searchOwnership,    // Perplexity #3: ownership & AOA (only if "ownership" in goals)
  searchLeadership,   // Perplexity #4: leadership & board (only if "leadership" in goals)
  claudeRes,          // Claude: comprehensive analysis (30s timeout, 2000 tokens)
  openaiRes,          // GPT-4o: synthesis & validation (25s timeout, 1500 tokens)
] = await Promise.allSettled([...11 agents...]);
```

### Gemini Query Templates

```typescript
// Gemini #1 — Full Company Profile (uses searchWithGemini — browses live pages)
`Saudi company "${companyName}"${crRef}${cityRef}: official website, phone, email, street address,
founding year, legal form, CR number, paid-up capital, employee count, revenue estimate SAR,
business activities, industry sector. Browse the company's website and Saudi commercial registry.`

// Gemini #2 — Ownership & Shareholders (uses searchWithGemini)
`"${companyName}" Saudi Arabia${crRef} shareholders owners ownership percentage مساهمون ملاك نسبة الملكية
— exact full names in Arabic and English with ownership percentages. Search Saudi commercial registry
(mc.gov.sa), emagazine.aamaly.sa, and news sources.`

// Gemini #3 — Leadership (uses searchWithGemini)
`"${companyName}" Saudi Arabia${cityRef} CEO chairman general manager CFO COO board of directors
executives مدير عام رئيس مجلس الإدارة — full verified names in Arabic and English with exact titles.
Search LinkedIn, news, Saudi business directories.`

// Gemini #4 — Competitive Intelligence (uses searchWithGemini)
`"${companyName}" Saudi Arabia market position competitors market share industry ranking strengths
weaknesses notable clients key projects revenue growth 2023 2024 2025.`
```

### Website Stealth Crawl

```typescript
async function stealthCrawlWebsite(url: string): Promise<{ text: string; emails: string[]; phones: string[] } | null> {
  let browser: StealthBrowser | null = null;
  try {
    browser = new StealthBrowser();
    const page = await browser.newPage();
    await HumanBehavior.idle(500, 1000);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 22000 });
    await HumanBehavior.idle(1500, 2500);
    await page.evaluate(() => window.scrollBy(0, 800));
    const html = await page.content();
    const $ = cheerio.load(html);
    $("script, style, noscript, nav, footer, header, aside").remove();
    const rawText = $("body").text().replace(/\s{3,}/g, "  ").trim();
    const emails = [...new Set(rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])];
    const phones = [...new Set(rawText.match(/(?:\+966|00966|0)[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{4}/g) || [])];
    return { text: rawText.slice(0, 6000), emails, phones };
  } catch {
    // Fallback to crawl4ai
    const r = await crawl4ai(url);
    if (r?.text) return { text: r.text.slice(0, 6000), emails: r.emails || [], phones: r.phones || [] };
    return null;
  } finally {
    if (browser) await browser.stop().catch(() => {});
  }
}
```

### Phase 2 — Context Assembly

After all 11 agents complete, their results are compiled into a single context string (max 14,000 chars) with labeled sections:

```
[Company Website Content]
...

[Emails from Website] email1@co.sa, ...
[Phones from Website] +966501234567, ...

[Gemini: Full Profile]
...

[Gemini: Ownership & Shareholders]
...

[Web Search: Profile]
...

[Claude Analysis]
...

[OpenAI Analysis]
...
```

### Phase 3 — Synthesis

Claude (primary, 90s, 6000 tokens) + Gemini (secondary, 60s, `generateWithGemini`) run in parallel:

```typescript
const [claudeSynthResult, geminiSynthResult] = await Promise.allSettled([
  // Claude (primary — most reliable for large structured output)
  anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 6000,
    messages: [{ role: "user", content: synthesisPrompt }],
    // 90s timeout via Promise.race
  }),

  // Gemini (secondary — pure text generation, generateWithGemini NOT deepResearch)
  generateWithGemini(
    synthesisPrompt,
    "You are a Saudi Arabia corporate intelligence analyst. Return ONLY valid JSON, no markdown fences.",
    "gemini-2.5-flash"
    // 60s timeout via Promise.race
  ),
]);

// Claude wins if successful; fall back to Gemini; then stub response
```

### Company Intel Output Schema

```typescript
interface CompanyIntelReport {
  profile: {
    nameEn: string;          // English name
    nameAr: string;          // Arabic name (اسم بالعربية)
    legalForm: string;       // "LLC" / "JSC" / etc
    legalFormAr: string;     // "ش.م.م" / "ش.م.س" / etc
    crNumber: string | null; // 10-digit CR
    founded: string | null;  // "YYYY"
    city: string | null;
    address: string | null;
    website: string | null;
    phone: string | null;    // "+966..."
    email: string | null;
    industry: string | null;
    mainActivity: string;
    mainActivityAr: string;  // Arabic description
  };
  financials: {
    revenueEstimate: string | null;  // "SAR X million"
    revenueRange: string | null;     // "SAR 10M-50M"
    revenueRationale: string;
    employeeCount: string | null;
    paidUpCapital: string | null;    // "SAR X,XXX,XXX"
    profitabilityIndicator: string;  // "Profitable" | "Loss-making" | "Break-even" | "Unknown"
    growthSignals: string[];
    recentFinancialNews: string | null;
  };
  ownership: {
    structure: string | null;        // "Family-owned" | "State-owned" | "Publicly-listed" | etc
    shareholders: Array<{
      nameEn: string;
      nameAr: string;
      ownershipPct: string;          // "50%"
      nationality: string;           // "Saudi" | "Other"
      type: string;                  // "Individual" | "Corporate"
    }>;
    isPubliclyListed: boolean;
    stockExchange: string | null;    // "Tadawul"
    ticker: string | null;
  };
  leadership: {
    ceo: { nameEn: string; nameAr: string; title: string };
    boardChairman: { nameEn: string; nameAr: string };
    executives: Array<{ nameEn: string; nameAr: string; title: string }>;
    boardMembers: Array<{ nameEn: string; nameAr: string; role: string }>;
  };
  operations: {
    activities: string[];
    products: string[];
    keyCients: string[];             // note: typo in codebase — "keyCients" not "keyClients"
    subsidiaries: string[];
    geographicPresence: string[];
  };
  market: {
    marketPosition: string;
    marketShare: string | null;
    competitors: string[];
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
  };
  approach: {
    bestChannel: string;
    bestTiming: string;
    entryPoint: string;              // name + title of best contact
    valueProp: string;
    openingAngle: string;
    potentialObjections: string[];
    culturalNotes: string;
    sampleMessage: string;
  };
  news: Array<{
    title: string;
    date: string;                    // "YYYY-MM" or approximate
    summary: string;
    source: string;
  }>;
  intelligence: {
    confidenceScore: number;         // 0-100
    dataQuality: "high" | "medium" | "low";
    verifiedFacts: string[];
    estimatedFacts: string[];
    caveats: string;
    dataSources: string[];
  };
  executiveSummary: string;          // 2-3 paragraph English summary
}
```

---

## 9. ProsEngine Chat — Backend

File: `artifacts/api-server/src/routes/prosengine-chat.ts`

### Two Endpoints

| Endpoint | Description |
|---|---|
| `POST /api/prosengine/chat` | Non-streaming — returns `{ reply, profileUpdate?, researchSteps? }` |
| `POST /api/prosengine/chat/stream` | SSE streaming — emits agent events + final reply |

### Request Body

```typescript
{
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  message?: string;                // single message shorthand (alternative to messages)
  context?: string;               // the full stringified report (passed from frontend)
  mode?: "person" | "website" | "seeder";
  model?: "claude-sonnet" | "claude-haiku" | "gpt-4o";
}
```

### Intent Classification

The backend classifies each message into one of four actions:

```typescript
type ChatIntent = "answer_from_context" | "perplexity_search" | "crawl_url" | "deep_research";

function classifyIntent(userMsg: string, hasContext: boolean): ChatIntent {
  const lower = userMsg.toLowerCase();

  // Deep research triggers: "go deeper", "research this", "dig deeper", "investigate",
  //   "full dossier", "comprehensive report", "more details", "use o4", "use claude", etc.
  if (deepTriggers.some(t => lower.includes(t))) return "deep_research";

  // Perplexity search triggers: "search for", "look up", "find ", "what is", "who is",
  //   "recent ", "latest ", "2024", "2025", "today", "update", "announcement", etc.
  if (perplexityTriggers.some(t => lower.includes(t))) return "perplexity_search";

  // URL crawl triggers: "crawl", "scrape", "check their website", "visit the site", etc.
  if (crawlTriggers.some(t => lower.includes(t))) return "crawl_url";

  // Default: use pre-loaded context only
  return "answer_from_context";
}
```

### Research Execution

Based on intent, the backend runs live research before answering:

```typescript
// perplexity_search or deep_research → 2 parallel Perplexity queries
const [p1, p2] = await Promise.allSettled([
  perplexitySearch(`Saudi Arabia B2B intelligence: ${target} — ${userMsg}. Specific verifiable facts...`, 2000),
  perplexitySearch(`${target} Saudi Arabia: latest developments, key decision makers 2024-2025.`, 1500),
]);

// crawl_url → extract URL from message, run fullStackCrawl
const urlMatch = (userMsg + context).match(/https?:\/\/[^\s"']+/);
if (urlMatch) { const result = await fullStackCrawl(urlMatch[0]); ... }

// deep_research → o4-mini DeepResearch (falls back to Perplexity if unavailable)
const drResp = await openai.responses.create({
  model: "o4-mini-deep-research-2025-06-26",
  input: [...],
  tools: [{ type: "web_search_preview" }],
});
```

### System Prompt

```typescript
const systemPrompt = `You are an elite Saudi Arabia B2B intelligence analyst embedded inside ProspectSA.

Mode: ${modeLabel}

${context ? `=== COMPANY INTELLIGENCE (authoritative data) ===\n${context}\n=== END ===\n` : "No pre-loaded context..."}
${liveResearchBlock}

RESPONSE RULES (STRICT):
- Write in plain prose. NO markdown: no #, ##, ###, **, *, \`, or bullet dashes.
- Use short paragraphs separated by blank lines for structure.
- For lists, use plain numbered lines: "1. Item" or "- Item" (single dash only, no bold).
- Keep responses focused and concise — 3 to 6 paragraphs maximum.
- Always ground answers in the context above. Label estimates explicitly as "Estimated:".
- When live research was gathered, synthesise those findings prominently and cite them.
- When the user asks to UPDATE or CORRECT a field, respond confirming AND return a JSON block:
  PROFILE_UPDATE:{"fieldName": "newValue"}`;
```

### Profile Update Parsing

If the AI response contains a `PROFILE_UPDATE:` block, it is extracted:

```typescript
const updateMatch = rawReply.match(/PROFILE_UPDATE:\s*(\{[\s\S]*?\})\s*$/);
if (updateMatch) {
  profileUpdate = JSON.parse(updateMatch[1]);
  reply = rawReply.slice(0, updateMatch.index).trim();
}
res.json({ reply, profileUpdate, researchSteps });
```

The frontend uses `profileUpdate` to patch specific fields in the displayed report.

### SSE Event Format (streaming endpoint)

```typescript
// Server emits:
res.write(`data: ${JSON.stringify({ event, data })}\n\n`);

// Events emitted:
{ event: "intent",       data: { intent: "perplexity_search" } }
{ event: "agent_start",  data: { agent: "Perplexity search", description: "Searching for..." } }
{ event: "agent_done",   data: { agent: "Perplexity search", found: true, preview: "..." } }
{ event: "synthesising", data: {} }
{ event: "reply",        data: { reply: "Full text answer..." } }
{ event: "done",         data: {} }
```

### Fullstack Crawler (used in chat for URL crawl intent)

```typescript
async function fullStackCrawl(url: string, label = "page") {
  // Agent 1: StealthBrowser (most powerful — handles JS, CAPTCHAs)
  // Agent 2: crawl4ai (headless Chromium + AI extraction) — if browser returned < 1000 chars
  // Agent 3: Plain HTTP + cheerio — if still < 300 chars
  // Returns: { text, html, emails, phones }
}
```

---

## 10. Web Crawling Stack

### crawl4ai (`crawl4ai-engine.ts`)

Playwright Chromium headless wrapper. Auto-detects browser availability on startup and falls back gracefully.

```typescript
interface CrawlResult {
  url: string;
  success: boolean;
  markdown: string;       // HTML converted to markdown via turndown
  text: string;           // plain text (max 50,000 chars)
  extractedText: string;  // same as text
  title: string;
  links: string[];
  emails: string[];
  phones: string[];
  tables: string[];
  headings: string[];
  images: string[];
  metadata: { wordCount: number; crawledAt: string };
}

// Usage:
const result = await crawl4ai(url, { waitMs?: 2000, concurrency?: 3 });
// Returns null if browser unavailable or page fails to load
```

Browser launch args: `["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]`

### StealthBrowser (`lib/stealth-browser.ts`)

Playwright Chromium with full anti-detection for sites with bot protection:

```typescript
class StealthBrowser {
  constructor(logger?: (msg: string) => void)

  // Key methods:
  start(domain?: string): Promise<void>         // launch browser, apply stealth patches
  goto(url, options?): Promise<void>            // navigate with Cloudflare detection
  getContent(): Promise<string>                 // full page HTML
  screenshot(base64?: boolean): Promise<string> // screenshot as base64 or file path
  humanType(selector, text): Promise<void>      // type with random inter-key delays
  fillFirst(selectors, value): Promise<boolean> // try selectors until one fills
  clickFirst(selectors): Promise<boolean>        // try selectors until one clicks
  detectChallenge(): Promise<"cloudflare" | "recaptcha" | "hcaptcha" | null>
  waitForCloudflare(timeoutMs?: number): Promise<void>
  newPage(): Promise<Page>                      // get raw Playwright page for custom use
  stop(): Promise<void>                         // close browser
}

class HumanBehavior {
  static idle(minMs: number, maxMs: number): Promise<void>  // random delay
}
```

Anti-detection patches applied on every page:
- `navigator.webdriver = false`
- Chrome plugin simulation (mimeTypes, plugins array)
- `navigator.languages`, `navigator.permissions`, `navigator.hardwareConcurrency` spoofing
- Canvas fingerprint randomization (`getImageData` override)
- WebGL vendor spoofing

---

## 11. Database Layer

### Setup

```typescript
// lib/db/src/index.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
export * from "./schema/index.js";
```

### prosengine_research Schema

```typescript
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const prosengineResearchTable = pgTable("prosengine_research", {
  id:                 serial("id").primaryKey(),
  personName:         text("person_name").notNull(),
  company:            text("company"),
  title:              text("title"),
  linkedinUrl:        text("linkedin_url"),
  sellerContext:      text("seller_context"),       // JSON.stringify(sellerContext)
  intelligenceGoals:  text("intelligence_goals"),   // JSON.stringify(goals[])
  knownFacts:         text("known_facts"),
  report:             text("report"),               // JSON.stringify(reportObject)
  tags:               text("tags"),
  notes:              text("notes"),
  createdAt:          timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

### company_intel_research Schema

```typescript
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const companyIntelResearchTable = pgTable("company_intel_research", {
  id:                 serial("id").primaryKey(),
  companyName:        text("company_name").notNull(),
  website:            text("website"),
  crNumber:           text("cr_number"),
  city:               text("city"),
  sellerContext:      text("seller_context"),       // JSON.stringify
  intelligenceGoals:  text("intelligence_goals"),   // JSON.stringify
  knownFacts:         text("known_facts"),
  report:             text("report"),               // JSON.stringify
  tags:               text("tags"),
  notes:              text("notes"),
  createdAt:          timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

### DB Push

```bash
cd lib/db && pnpm run push    # applies schema to database
```

---

## 12. Frontend — Application Shell

### Entry Point (`main.tsx`)

```typescript
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";  // Tailwind base styles

createRoot(document.getElementById("root")!).render(<App />);
```

### App.tsx — Provider Stack + Router

```typescript
function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="app-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

`QueryClient` configuration:
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});
```

### Route Definitions

```typescript
<Route path="/" component={Dashboard} />
<Route path="/prospecting/person" component={PersonIntelPage} />
<Route path="/prospecting/company" component={CompanyIntelPage} />
<Route path="/prospecting" component={ProspectingPage} />
```

### BASE_URL Pattern

Because the app is served at a path prefix (e.g. `/prospect-sa`), all API calls must prepend:

```typescript
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// API calls:
fetch(`${BASE}/api/person-intel/profile`, { ... })
fetch(`${BASE}/api/company-intel/profile`, { ... })
fetch(`${BASE}/api/prosengine/chat/stream`, { ... })
```

Vite config exposes `BASE_URL` automatically from `vite.config.ts → base` setting.

---

## 13. Person Intelligence — Frontend

File: `artifacts/prospect-sa/src/pages/prospecting/person.tsx`

### State

```typescript
const [step, setStep] = useState(1);               // 1-5 wizard steps
const [wizard, setWizard] = useState<WizardState>(DEFAULT_WIZARD);
const [profile, setProfile] = useState<PersonProfile | null>(null);
const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
const [saved, setSaved] = useState(false);
```

### WizardState Type

```typescript
interface WizardState {
  name: string;                                    // required
  title: string;
  company: string;
  linkedin: string;
  sellerContext: {
    companyName: string;
    product: string;
    objectives: string[];                          // multi-select
  };
  goals: string[];                                 // intelligence goal IDs
  knownFacts: string;                              // freeform textarea
}
```

### Intelligence Goals (Step 3)

```typescript
const INTELLIGENCE_GOALS = [
  { id: "wealth",      icon: DollarSign,  label: "Wealth & Financial Profile",    desc: "Net worth, income, assets, investments" },
  { id: "approach",    icon: Target,      label: "B2B Approach Strategy",         desc: "Best channel, opening, sample message" },
  { id: "company",     icon: Building2,   label: "Company Deep-Dive",             desc: "Revenue, performance, pain points, competitors" },
  { id: "career",      icon: Briefcase,   label: "Career & Education",            desc: "Career timeline, degrees, institutions" },
  { id: "personal",    icon: Heart,       label: "Personal Profile & Lifestyle",  desc: "Interests, traits, communication style" },
  { id: "competitive", icon: BarChart3,   label: "Competitive Intelligence",      desc: "Company's competitive landscape & weaknesses" },
];
```

Default goals: `["approach", "wealth", "company"]`

### 5-Step Wizard Flow

| Step | Content |
|---|---|
| 1 — Identity | Name (required), Title, Company, LinkedIn URL. Quick-fill buttons from Website Intel localStorage context |
| 2 — Seller Context | Your company name, product/service, objective (multi-select pill buttons) |
| 3 — Intelligence Goals | Checkbox cards for each goal module |
| 4 — Known Facts | Large textarea for pre-known information |
| 5 — Generate | Review summary card → trigger mutation → loading screen with rotating messages |

### Loading Screen

```typescript
const LOADING_MSGS = [
  "Scanning corporate registry data…",
  "Cross-referencing public filings…",
  "Estimating wealth profile from known positions…",
  "Mapping career trajectory…",
  "Analysing company performance & market position…",
  "Building personalized approach strategy…",
  "Compiling intelligence dossier…",
  "Finalising report…",
];

// Rotate every 2500ms during loading
const iv = setInterval(() => { idx = (idx + 1) % LOADING_MSGS.length; setLoadingMsgIdx(idx); }, 2500);
```

### API Call

```typescript
const generateMutation = useMutation({
  mutationFn: async () => {
    const r = await fetch(`${BASE}/api/person-intel/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: wizard.name,
        company: wizard.company || undefined,
        title: wizard.title || undefined,
        linkedinUrl: wizard.linkedin || undefined,
        sellerContext: wizard.sellerContext.companyName ? wizard.sellerContext : undefined,
        intelligenceGoals: wizard.goals,
        knownFacts: wizard.knownFacts || undefined,
      }),
    });
    if (!r.ok) throw new Error("Profile generation failed");
    return r.json() as Promise<PersonProfile>;
  },
  onSuccess: (data) => { setProfile(data); setSaved(false); },
});
```

### Report Rendering

When `profile` is set, the wizard is replaced by collapsible `Section` cards:

```typescript
function Section({ title, icon, color, badge, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="bg-card/60 border-white/8">
      <button className="w-full px-5 py-4 flex items-center gap-3" onClick={() => setOpen(!open)}>
        <Icon /><span>{title}</span>{badge && <Badge>{badge}</Badge>}
        <div className="ml-auto">{open ? <ChevronUp /> : <ChevronDown />}</div>
      </button>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}
```

Rendered sections:
1. Profile header (name, title, company, Arabic name, LinkedIn, nationality, location, age)
2. Career timeline (chronological list with company, title, period, description)
3. Education (institution, degree, year)
4. Company analysis (revenue, employees, market position, pain points, competitors)
5. Wealth profile (net worth, income, wealth sources, assets)
6. Personal profile (interests, personality, communication style, board memberships)
7. Approach strategy (channel, timing, opening angle, value prop, sample message)
8. Intelligence notes (confidence level badge, data sources, verified facts, caveats)

### URL Pre-fill

The page reads URL query params and localStorage to pre-fill the wizard:

```typescript
useEffect(() => {
  // Priority 1: URL params (?name=...&company=...&title=...&source=website-intel)
  const params = new URLSearchParams(window.location.search);
  if (params.get("name") || params.get("company")) { /* pre-fill from URL */ }

  // Priority 2: localStorage "websiteIntelContext" (set by Website Intel page)
  else {
    const raw = localStorage.getItem("websiteIntelContext");
    if (raw) {
      const ctx = JSON.parse(raw);  // { companyName, executives: [{name, title}], generatedAt }
      setWizard(w => ({ ...w, company: ctx.companyName }));
      setContextExecs(ctx.executives.slice(0, 12));  // quick-fill candidate buttons
    }
  }
}, []);
```

Quick-fill exec buttons appear in Step 1 if `contextExecs.length > 0 && !wizard.name`:
```tsx
{contextExecs.map((exec) => (
  <button onClick={() => setWizard(w => ({ ...w, name: exec.name, title: exec.title, company: exec.company }))}>
    <span>{exec.name}</span>
    <span>· {exec.title}</span>
  </button>
))}
```

### Save & Delete

```typescript
const saveMutation = useMutation({
  mutationFn: async () => {
    const r = await fetch(`${BASE}/api/person-intel/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personName: wizard.name, company: wizard.company, title: wizard.title,
        linkedinUrl: wizard.linkedin,
        sellerContext: wizard.sellerContext.companyName ? wizard.sellerContext : undefined,
        intelligenceGoals: wizard.goals, knownFacts: wizard.knownFacts, report: profile,
      }),
    });
    return r.json();
  },
  onSuccess: () => {
    setSaved(true);
    qc.invalidateQueries({ queryKey: ["prosengine-research"] });
  },
});
```

Confidence badge color logic:
```typescript
const confidenceColor = (c?: string) =>
  c === "High"   ? "bg-green-500/15 text-green-300 border-green-500/30" :
  c === "Medium" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
                   "bg-red-500/15 text-red-300 border-red-500/30";
```

---

## 14. Company Intelligence — Frontend

File: `artifacts/prospect-sa/src/pages/prospecting/company.tsx`

### State

```typescript
const [step, setStep] = useState(1);           // 1-5 wizard, 6 = report
const [wizard, setWizard] = useState<WizardState>(DEFAULT_WIZARD);
const [report, setReport] = useState<CompanyReport | null>(null);
```

### WizardState Type

```typescript
interface WizardState {
  companyName: string;           // required
  website: string;
  crNumber: string;              // 10-digit Saudi CR
  city: string;
  sellerContext: {
    companyName: string;
    product: string;
    objectives: string[];
  };
  goals: string[];               // intelligence module IDs
  knownFacts: string;
}
```

### Intelligence Goals

```typescript
const INTELLIGENCE_GOALS = [
  { id: "profile",    icon: Building2,  label: "Company Profile",          desc: "CR, legal form, address, contacts, activities" },
  { id: "financials", icon: DollarSign, label: "Financial Intelligence",   desc: "Revenue, capital, employees, growth signals" },
  { id: "ownership",  icon: Network,    label: "Ownership & Shareholders", desc: "Shareholder names, percentages, structure" },
  { id: "leadership", icon: Crown,      label: "Leadership & Board",       desc: "CEO, executives, board with bilingual names" },
  { id: "market",     icon: BarChart3,  label: "Market Intelligence",      desc: "Competitors, position, strengths, opportunities" },
  { id: "approach",   icon: Target,     label: "B2B Approach Strategy",    desc: "Entry point, value prop, opening message" },
];
```

Default goals: all 6

### API Call

```typescript
const profileMutation = useMutation({
  mutationFn: async () => {
    const resp = await fetch(`${BASE}/api/company-intel/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: wizard.companyName.trim(),
        website: wizard.website.trim() || undefined,
        crNumber: wizard.crNumber.trim() || undefined,
        city: wizard.city.trim() || undefined,
        sellerContext: wizard.sellerContext.companyName ? wizard.sellerContext : undefined,
        intelligenceGoals: wizard.goals,
        knownFacts: wizard.knownFacts.trim() || undefined,
      }),
      signal: AbortSignal.timeout(180000),   // 3 minute timeout
    });
    if (!resp.ok) throw new Error("Failed to generate report");
    return await resp.json() as CompanyReport;
  },
  onSuccess: (data) => { setReport(data); setStep(6); setSaved(false); },
});
```

### Report Rendering (Step 6)

Sections rendered when `step === 6 && report`:

1. **Header** — company name (EN + AR), legal form badge, industry badge, city badge, data quality badge
2. **Executive Summary** — gradient card with confidence score %
3. **Company Profile** — `InfoRow` components for legal form, CR, founded, city, address, industry, main activity. Contact buttons (website link, phone `tel:`, email `mailto:`)
4. **Financial Intelligence** — metric cards for revenue, employees, capital, profitability. Growth signals list.
5. **Ownership & Shareholders** — structure label. Shareholder rows with ownership % circle, EN/AR name, nationality tag.
6. **Leadership & Board** — CEO card, Board Chairman card. Executive and board member grids.
7. **Operations** — tagged lists for activities, products, clients, subsidiaries, geographic presence.
8. **Market Intelligence** — market position text, competitor tags, strengths/weaknesses/opportunities.
9. **B2B Approach Strategy** — best channel, timing, entry point, value prop, opening angle, cultural notes, sample message (with copy button).
10. **Recent News** — news cards with title, date, summary, source.
11. **Intelligence Notes** — confidence score, data sources, verified/estimated facts, caveats.

### Utility Components

```typescript
// InfoRow — skips rendering if value is null, "Not found", or "Unknown"
function InfoRow({ label, value, copyable }: { label: string; value?: string | null; copyable?: boolean }) {
  if (!value || value === "null" || value === "Not found" || value === "Unknown") return null;
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
      <span className="text-xs text-white flex-1">{value}</span>
      {copyable && <CopyBtn text={value} />}
    </div>
  );
}

// Tag pill
function Tag({ text, color = "bg-primary/10 text-primary border-primary/20" }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border ${color}`}>{text}</span>;
}

// Copy button with 1.5s "copied" state
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}
```

---

## 15. ProsEngineChat — Floating AI Assistant

File: `artifacts/prospect-sa/src/components/ProsEngineChat.tsx`

### Props

```typescript
interface Props {
  mode: "person" | "website" | "seeder";
  context: string;            // stringified report (passed as context to AI)
  initialSuggestions?: string[];
  autoOpen?: boolean;         // auto-opens when context becomes available
}
```

### Usage in Person Intel Page

```tsx
<ProsEngineChat
  mode="person"
  context={JSON.stringify(profile)}    // the full report object
  autoOpen={true}
/>
```

### Model Selector

Three models available via pill buttons in the chat header:

```typescript
const MODELS = [
  { id: "claude-sonnet", label: "Claude Sonnet", badge: "Sonnet" },
  { id: "claude-haiku",  label: "Claude Haiku",  badge: "Haiku" },
  { id: "gpt-4o",        label: "GPT-4o",        badge: "GPT-4o" },
];
```

### Message Send Flow (SSE streaming)

```typescript
const send = async (text?: string) => {
  const msg = text ?? input;
  const newMessages = [...messages, { role: "user", content: msg }];

  // 1. Try SSE streaming endpoint
  const resp = await fetch(`${BASE}/api/prosengine/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: newMessages, context, mode, model: selectedModel }),
    signal: abortController.signal,
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const { event, data } = JSON.parse(line.slice(6));

      if (event === "agent_start") {
        setLiveSteps(prev => [...prev, { agent: data.agent, status: "running" }]);
      } else if (event === "agent_done") {
        setLiveSteps(prev => prev.map(s => s.agent === data.agent
          ? { ...s, status: data.found ? "done" : "failed", preview: data.preview }
          : s));
      } else if (event === "synthesising") {
        setLiveSteps(prev => [...prev, { agent: "Synthesising", status: "running" }]);
      } else if (event === "reply") {
        const reply = data.reply;
        setMessages(prev => [...prev, { role: "assistant", content: reply }]);
      } else if (event === "done") {
        setLiveSteps([]);
      }
    }
  }

  // 2. On stream failure, fall back to non-streaming endpoint
  // fetch(`${BASE}/api/prosengine/chat`, { method: "POST", ... })
};
```

### Live Step UI

During streaming, active agent steps are shown:

```tsx
{liveSteps.map((step, i) => (
  <div key={i} className="flex items-center gap-2 text-[11px]">
    <span className={step.status === "running" ? "text-amber-400" : step.status === "done" ? "text-emerald-400" : "text-red-400"}>
      {step.status === "running" ? <Loader2 className="animate-spin" /> : AGENT_ICONS[step.agent]}
    </span>
    <span>{step.agent}{step.status === "done" ? " ✓" : step.status === "failed" ? " ✗" : "…"}</span>
  </div>
))}
```

### Inline Markdown Renderer

The chat includes a custom markdown renderer (no external deps) that handles:
- `# H1`, `## H2`, `### H3`
- `**bold**`, `*italic*`, `` `code` ``
- `- bullet` lists and `1. numbered` lists
- `---` horizontal rules
- ` ```code blocks``` `

```typescript
function MarkdownMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  // ... parse each line into React elements
}
```

### Default Suggestions by Mode

```typescript
mode === "person" ? [
  "What's the best way to approach this person?",
  "What are their likely pain points?",
  "Suggest 3 more people like this",
  "What should I know before the first meeting?",
] : mode === "website" ? [
  "Summarise the top 5 companies found",
  "Which companies are the best prospects?",
  "What industries were most common?",
  "Export a ranked shortlist",
] : /* seeder */ [
  "Which records look most promising?",
  "Identify the decision-makers",
  "What's the typical revenue range here?",
  "Suggest an outreach sequence for this sector",
]
```

---

## 16. Complete API Reference

### Person Intelligence

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/person-intel/profile` | `{ name, company?, title?, linkedinUrl?, websiteUrl?, country?, sellerContext?, intelligenceGoals?, knownFacts? }` | `PersonIntelReport` object |
| `POST` | `/api/person-intel/save` | `{ personName, company?, title?, linkedinUrl?, sellerContext?, intelligenceGoals?, knownFacts?, report }` | Saved DB row |
| `GET` | `/api/person-intel/saved` | — | `Array<prosengine_research row>` |
| `DELETE` | `/api/person-intel/saved/:id` | — | `{ success: true }` |

### Company Intelligence

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/company-intel/profile` | `{ companyName, website?, crNumber?, city?, sellerContext?, intelligenceGoals?, knownFacts? }` | `CompanyIntelReport` object |
| `POST` | `/api/company-intel/save` | `{ companyName, website?, crNumber?, city?, sellerContext?, intelligenceGoals?, knownFacts?, report }` | Saved DB row |
| `GET` | `/api/company-intel/saved` | — | `Array<company_intel_research row>` |
| `DELETE` | `/api/company-intel/saved/:id` | — | `{ success: true }` |

### ProsEngine Chat

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/prosengine/chat` | `{ messages?, message?, context?, mode?, model? }` | `{ reply: string, profileUpdate?: object, researchSteps?: string[] }` |
| `POST` | `/api/prosengine/chat/stream` | `{ messages?, message?, context?, mode?, model? }` | SSE stream of `{ event, data }` objects |

---

## 17. Frontend ↔ Backend Communication Patterns

### Standard Mutation Pattern (TanStack React Query)

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";

const qc = useQueryClient();

const saveMutation = useMutation({
  mutationFn: async () => {
    const r = await fetch(`${BASE}/api/person-intel/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ /* payload */ }),
    });
    if (!r.ok) throw new Error("Save failed");
    return r.json();
  },
  onSuccess: () => {
    setSaved(true);
    qc.invalidateQueries({ queryKey: ["prosengine-research"] });
  },
});

// Trigger:
<Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
  {saveMutation.isPending ? <Loader2 className="animate-spin" /> : "Save"}
</Button>
```

### Long-Running Fetch with Rotating Loading Messages

```typescript
const generateMutation = useMutation({
  mutationFn: async () => {
    let idx = 0;
    const iv = setInterval(() => {
      idx = (idx + 1) % LOADING_MSGS.length;
      setLoadingMsgIdx(idx);
    }, 2500);
    try {
      const r = await fetch(...);
      return r.json();
    } finally {
      clearInterval(iv);  // always clear on success or error
    }
  },
});
```

### SSE Streaming (Chat)

```typescript
const resp = await fetch(url, { method: "POST", body: JSON.stringify(...), signal: controller.signal });
const reader = resp.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";          // keep incomplete last line in buffer
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = JSON.parse(line.slice(6));
    // handle payload.event + payload.data
  }
}
```

### Abort Controller Pattern

```typescript
const abortRef = useRef<AbortController | null>(null);

// On send:
abortRef.current = new AbortController();
const resp = await fetch(url, { signal: abortRef.current.signal });

// To cancel:
abortRef.current?.abort();
```

---

## 18. Key Implementation Rules

### 1. AI Priority Order
Always: **Gemini first → Claude second → GPT-4o third**

### 2. OpenAI Token Parameter
Always `max_completion_tokens`. **Never** `max_tokens` with OpenAI calls.

### 3. Gemini Return Types
```
generateWithGemini()     → string | null           ← safe for .match(), JSON.parse()
synthesizeWithGemini()   → string | null           ← same
searchWithGemini()       → string | null           ← safe for .match()
deepResearchWithGemini() → { text, groundingChunks } | null   ← NEVER call .match() directly
                           always use r?.text or r?.text ?? null
```

### 4. Synthesis Use deepResearchWithGemini ONLY for research; generateWithGemini for synthesis
```typescript
// WRONG — deepResearch returns an object
const r = await deepResearchWithGemini(synthesisPrompt, system, model);
const parsed = JSON.parse(r.match(/\{...}/)[0]);  // ❌ TypeError

// CORRECT — use generateWithGemini for synthesis
const text = await generateWithGemini(synthesisPrompt, system, model);
const parsed = JSON.parse(text?.match(/\{...}/)?.[0] || "{}");  // ✅
```

### 5. Timeout Pattern
Wrap long-running calls in `Promise.race` with a timeout:
```typescript
const result = await Promise.race([
  longRunningCall(),
  new Promise<null>(r => setTimeout(() => r(null), 30000)),
]);
```

### 6. Never Block on Optional Sources
All research agents use `Promise.allSettled`. Never `Promise.all` — a single failed agent must not crash the pipeline.

### 7. BASE_URL in Frontend
```typescript
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
// All API calls: fetch(`${BASE}/api/...`)
```

### 8. AbortSignal.timeout for External APIs
```typescript
signal: AbortSignal.timeout(25000)   // 25 second hard timeout on all external API calls
```

### 9. Perplexity Auto-Disable
The `PerplexityService` class tracks a module-level `_blocked` flag. If it receives a 401 or 403, it disables itself for the session without crashing the app.

### 10. Graceful Synthesis Failure
Company Intel returns a minimal stub (not a 500 error) when both synthesis engines fail:
```typescript
report = {
  profile: { nameEn: companyName, city: city || null, crNumber: crNumber || null },
  executiveSummary: `Research was initiated for "${companyName}" but synthesis could not complete. Please try again.`,
  intelligence: { confidenceScore: 0, dataQuality: "low", caveats: "Synthesis unavailable" },
};
res.json(report);  // 200 with stub, not 500
```

### 11. Report Stored as JSON String
Both `prosengine_research.report` and `company_intel_research.report` are `TEXT` columns storing `JSON.stringify(reportObject)`. Parse on read with `JSON.parse(row.report)`.

### 12. Arabic Text in Reports
All name fields have English (`nameEn`) and Arabic (`nameAr`) variants. Arabic text is rendered with `font-arabic` class in the frontend (needs Arabic font in your Tailwind config).

---

## Appendix A — npm Package List

### Backend (`@workspace/api-server`)

```json
{
  "@anthropic-ai/sdk": "^0.78.0",
  "@google/genai": "^1.47.0",
  "axios": "^1.13.6",
  "cheerio": "^1.2.0",
  "cors": "^2",
  "drizzle-orm": "*",
  "express": "^5",
  "openai": "^6.29.0",
  "pdf-parse": "^2.4.5",
  "playwright": "^1.58.2",
  "turndown": "^7.2.2"
}
```

### Frontend (`@workspace/prospect-sa`)

```json
{
  "@tanstack/react-query": "*",
  "lucide-react": "*",
  "next-themes": "^0.4.6",
  "react": "*",
  "react-dom": "*",
  "sonner": "^2.0.7",
  "tailwindcss": "*",
  "wouter": "^3.3.5",
  "zod": "*"
}
```

Radix UI components (install individually as needed):
```
@radix-ui/react-dialog, @radix-ui/react-dropdown-menu,
@radix-ui/react-select, @radix-ui/react-tabs,
@radix-ui/react-tooltip, @radix-ui/react-badge, etc.
```

---

## Appendix B — Vite Config Key Settings

```typescript
// vite.config.ts
export default defineConfig({
  base: "/prospect-sa/",      // path prefix — must match BASE_URL in frontend
  server: {
    port: Number(process.env.PORT) || 5173,
    host: "0.0.0.0",
    allowedHosts: true,       // required for proxy environments
  },
  plugins: [react()],
});
```

---

## Appendix C — Apollo.io Integration

```typescript
async function apolloPersonLookup(name: string, company?: string): Promise<string> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return "";
  const resp = await fetch("https://api.apollo.io/v1/people/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": key },
    body: JSON.stringify({
      q_person_name: name,
      q_organization_name: company,
      per_page: 5,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await resp.json();
  const p = data.people?.[0];
  return JSON.stringify({
    name: p.name, title: p.title, email: p.email,
    phone: p.phone_numbers?.[0]?.sanitized_number,
    linkedin: p.linkedin_url, city: p.city, country: p.country,
    seniority: p.seniority, departments: p.departments,
    employment_history: p.employment_history?.slice(0, 5),
  });
}
```

---

## Appendix D — Explorium Integration

```typescript
async function exploriumPersonLookup(name: string, company?: string): Promise<string> {
  const key = process.env.EXPLORIUM_API_KEY;
  if (!key) return "";
  const resp = await fetch("https://app.explorium.ai/api/bundle/v1/people", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ full_name: name, company_name: company, country: "Saudi Arabia" }),
    signal: AbortSignal.timeout(15000),
  });
  return JSON.stringify(await resp.json());
}
```
