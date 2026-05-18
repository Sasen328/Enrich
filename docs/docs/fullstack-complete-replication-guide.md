# ProspectSA — Complete Full-Stack Replication Guide
## All Three Engines: Masaar · AI Database Builder · ProsEngine

> **Purpose:** This document is the single source of truth for replicating the entire ProspectSA platform in a new Replit project. It covers the complete stack — backend API routes, engine logic, database schema, AI orchestration, and frontend components — for every engine. Nothing is omitted.

---

## TABLE OF CONTENTS

1. [Technology Stack](#1-technology-stack)
2. [Project Structure](#2-project-structure)
3. [Database Schema — All Tables](#3-database-schema)
4. [Backend Entry Points & App Setup](#4-backend-entry-points)
5. [Shared Backend Utilities](#5-shared-backend-utilities)
6. [ENGINE 1 — Masaar: Saudi CR Registry Intelligence](#6-masaar-engine)
7. [ENGINE 2 — AI Database Builder (Masar)](#7-ai-database-builder)
8. [ENGINE 3 — ProsEngine: Company & Person Intelligence](#8-prosengine)
9. [ProsEngine Chat Assistant](#9-prosengine-chat)
10. [Web Prospecting (ORC Engine)](#10-web-prospecting)
11. [Frontend Architecture & Routing](#11-frontend-architecture)
12. [Frontend — Masaar Page](#12-frontend-masaar)
13. [Frontend — AI Database Builder Page](#13-frontend-builder)
14. [Frontend — ProsEngine Pages](#14-frontend-prosengine)
15. [Environment Variables](#15-environment-variables)
16. [Key Patterns & Gotchas](#16-key-patterns)

---

## 1. TECHNOLOGY STACK

### Backend
| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 (ESM) |
| Framework | Express 4 |
| ORM | Drizzle ORM |
| Database | PostgreSQL (via `DATABASE_URL`) |
| Language | TypeScript (strict) |
| Build | tsx (ts-node equivalent) |

### Frontend
| Layer | Technology |
|-------|-----------|
| Framework | React 18 |
| Build Tool | Vite |
| Router | Wouter |
| State/Fetch | TanStack Query v5 |
| UI Components | Radix UI primitives |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| Language | TypeScript |

### AI Stack (priority order)
1. **Gemini 2.5 Flash** — primary for web search (Google Search grounding + URL context)
2. **Claude Sonnet** (claude-sonnet-4-6) — primary for synthesis/structured output
3. **GPT-4o** — tertiary / fallback
4. **Perplexity Sonar** — real-time web search
5. **o4-mini** (DeepResearch) — optional deep research
6. **OpenRouter** — optional stubs (DeepSeek R1, Llama 3.3, Kimi)
7. **Groq** — optional stub (Llama 70B fast)

### Monorepo Layout
```
artifacts/
  api-server/          ← Express backend
    src/
      index.ts         ← binds to PORT env var
      app.ts           ← express app, mounts all routers
      routes/          ← route files per engine
      lib/             ← engine logic libraries
      prospecting/     ← web prospecting engine
      orcengine/       ← ORC scraping engine
      gemini-search.ts ← all Gemini functions
  prospect-sa/         ← React frontend (Vite)
    src/
      App.tsx          ← Wouter router with all routes
      pages/           ← one file per page/engine
      components/      ← shared UI components
lib/
  db/
    src/
      index.ts         ← re-exports db + all tables
      schema/          ← one file per table
```

---

## 2. PROJECT STRUCTURE

### Backend (`artifacts/api-server/src/`)

```
index.ts                     ← entry: import app, listen on process.env.PORT
app.ts                       ← express setup, CORS, JSON, mount all routers
gemini-search.ts             ← Gemini client (searchWithGemini, generateWithGemini, deepResearchWithGemini, etc.)
openai-client.ts             ← shared OpenAI client

routes/
  index.ts                   ← registers all sub-routers at /api
  health.ts                  ← GET /api/health
  masaar.ts                  ← 3 endpoints: start, captcha, stream
  masar-database.ts          ← 15+ endpoints for Masar DB
  builder.ts                 ← 30+ endpoints for AI Database Builder
  company-intel.ts           ← company intelligence (ProsEngine company)
  person-intel.ts            ← person intelligence (ProsEngine person)
  prosengine-chat.ts         ← AI chat assistant (REST + SSE)
  companies.ts               ← generic companies CRUD
  leads.ts                   ← leads CRUD
  lead-lists.ts              ← lead lists / watchlist
  meshbase.ts                ← Meshbase data source
  sa-market.ts               ← Saudi market data

lib/
  masaar-engine.ts           ← 5-agent Masaar pipeline (1945 lines)
  masar-harvester.ts         ← Masar harvest engine (2968 lines)
  builder-engine.ts          ← AI Database Builder engine (804 lines)
  web-seeder.ts              ← multi-page website crawler + Claude per-page AI
  stealth-browser.ts         ← Playwright stealth browser (anti-fingerprint + CAPTCHA)
  enrichment-engine.ts       ← company enrichment logic
  data-sources.ts            ← Saudi data source connectors
  blocklist.ts               ← deletion blocklist (never re-seed deleted companies)

prospecting/
  routes.ts                  ← registers prospecting routes on Express app
  engine.ts                  ← scan → extract → enrich pipeline (1610 lines)

orcengine/
  routes.ts                  ← ORC engine routes
  scraper.ts                 ← multi-agent scraper
```

### Frontend (`artifacts/prospect-sa/src/`)
```
main.tsx                     ← React DOM render
App.tsx                      ← Wouter <Switch> with all routes
pages/
  MasaarPage.tsx             ← Masaar CR lookup + SSE stream display
  MasarDatabasePage.tsx      ← Masar Database (harvest + company list)
  MasarCompanyDetailPage.tsx ← single company detail
  BuilderPage.tsx            ← AI Database Builder
  ProsEngineCompanyPage.tsx  ← Company Intelligence
  ProsEnginePersonPage.tsx   ← Person Intelligence
  ProspectingPage.tsx        ← Web Prospecting (ORC Engine)
  ...
components/
  Layout.tsx                 ← sidebar nav + main content wrapper
  ...
```

---

## 3. DATABASE SCHEMA

All tables use PostgreSQL with Drizzle ORM. The `@workspace/db` package re-exports all tables and the `db` Drizzle client.

### 3.1 `masar_companies` — Masaar / AI Database Builder company records
```typescript
export const masarCompaniesTable = pgTable("masar_companies", {
  id:                 serial("id").primaryKey(),
  nameEn:            text("name_en"),
  nameAr:            text("name_ar"),
  crNumber:          text("cr_number").unique(),
  legalForm:         text("legal_form"),
  legalFormAr:       text("legal_form_ar"),
  city:              text("city"),
  cityAr:            text("city_ar"),
  region:            text("region"),
  paidUpCapital:     text("paid_up_capital"),
  authorizedCapital: text("authorized_capital"),
  foundingDate:      text("founding_date"),
  foundingYear:      text("founding_year"),
  registrationDate:  text("registration_date"),
  expiryDate:        text("expiry_date"),
  authorizedSignatory: text("authorized_signatory"),
  // JSONB arrays for structured people data:
  shareholders:    jsonb("shareholders").$type<Array<{
    nameEn: string; nameAr: string; nationalId: string; ownershipPct: string; nationality: string;
  }>>().default([]),
  boardOfDirectors: jsonb("board_of_directors").$type<Array<{
    nameEn: string; nameAr: string; role: string; nationalId?: string;
  }>>().default([]),
  management: jsonb("management").$type<Array<{
    nameEn: string; nameAr: string; title: string; nationalId?: string; powers?: string;
  }>>().default([]),
  mainActivity:      text("main_activity"),
  mainActivityAr:    text("main_activity_ar"),
  registrationStatus: text("registration_status"),
  source:            text("source").notNull().default("open-data"),
  sourceUrl:         text("source_url"),
  enrichmentStatus:  text("enrichment_status").default("pending"),
  // enrichmentStatus values: "pending" | "enriching" | "enriched" | "failed"
  website:           text("website"),
  phone:             text("phone"),
  email:             text("email"),
  address:           text("address"),
  employeeCount:     text("employee_count"),
  revenueEstimate:   text("revenue_estimate"),
  revenueRationale:  text("revenue_rationale"),
  newsHeadlines: jsonb("news_headlines").$type<Array<{
    title: string; date: string; source?: string;
  }>>().default([]),
  enrichmentData:    jsonb("enrichment_data").$type<Record<string, unknown>>().default({}),
  analysisEn:        text("analysis_en"),     // AI-generated English intelligence report
  analysisAr:        text("analysis_ar"),     // AI-generated Arabic intelligence report
  analysisData:      jsonb("analysis_data").$type<Record<string, unknown>>().default({}),
  capitalDistribution: text("capital_distribution"),
  profitDistributionRules: text("profit_distribution_rules"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  enrichedAt:        timestamp("enriched_at", { withTimezone: true }),
});
```

### 3.2 `companies` — AI Database Builder company pool
```typescript
export const companiesTable = pgTable("companies", {
  id:              serial("id").primaryKey(),
  nameAr:          text("name_ar"),
  nameEn:          text("name_en"),
  industry:        text("industry"),
  subIndustry:     text("sub_industry"),
  industryAr:      text("industry_ar"),
  city:            text("city"),
  region:          text("region"),
  country:         text("country").notNull().default("Saudi Arabia"),
  website:         text("website"),
  phone:           text("phone"),
  email:           text("email"),
  description:     text("description"),
  descriptionAr:   text("description_ar"),
  employeeCount:   text("employee_count"),
  revenue:         text("revenue"),
  foundingYear:    integer("founding_year"),
  crNumber:        text("cr_number"),
  capitalAmount:   text("capital_amount"),
  entityType:      text("entity_type"),
  companyType:     text("company_type"),
  ownerName:       text("owner_name"),
  ownerNameAr:     text("owner_name_ar"),
  ownerTitle:      text("owner_title"),
  ownerPhone:      text("owner_phone"),
  ownerEmail:      text("owner_email"),
  ownerLinkedin:   text("owner_linkedin"),
  estimatedWealth: text("estimated_wealth"),
  shareholders:    text("shareholders"),       // JSON string
  keyExecutives:   text("key_executives"),    // JSON string
  marketPositioning: text("market_positioning"),
  recentNews:      text("recent_news"),
  linkedinUrl:     text("linkedin_url"),
  enrichmentScore: integer("enrichment_score"),
  enrichmentStatus: text("enrichment_status"),
  dataSource:      text("data_source"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
```

### 3.3 `prosengine_research` — Person Intelligence saved reports
```typescript
export const prosengineResearchTable = pgTable("prosengine_research", {
  id:              serial("id").primaryKey(),
  personName:      text("person_name").notNull(),
  company:         text("company"),
  title:           text("title"),
  linkedinUrl:     text("linkedin_url"),
  sellerContext:   text("seller_context"),    // JSON string
  intelligenceGoals: text("intelligence_goals"), // JSON string
  knownFacts:      text("known_facts"),
  report:          text("report"),            // JSON string (full intelligence dossier)
  tags:            text("tags"),
  notes:           text("notes"),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

### 3.4 `company_intel_research` — Company Intelligence saved reports
```typescript
export const companyIntelResearchTable = pgTable("company_intel_research", {
  id:              serial("id").primaryKey(),
  companyName:     text("company_name").notNull(),
  website:         text("website"),
  crNumber:        text("cr_number"),
  city:            text("city"),
  sellerContext:   text("seller_context"),    // JSON string
  intelligenceGoals: text("intelligence_goals"), // JSON string
  knownFacts:      text("known_facts"),
  report:          text("report"),            // JSON string (full intelligence report)
  tags:            text("tags"),
  notes:           text("notes"),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

### 3.5 `prospecting_jobs` — Web Prospecting scan/extract jobs
```typescript
export const prospectingJobsTable = pgTable("prospecting_jobs", {
  id:              serial("id").primaryKey(),
  targetUrl:       text("target_url").notNull(),
  status:          text("status").notNull().default("pending"),
  // status values: "pending" | "scanning" | "scanned" | "extracting" | "completed" | "failed"
  progress:        integer("progress").default(0),
  resultCount:     integer("result_count").default(0),
  totalCompaniesFound: integer("total_companies_found").default(0),
  totalEnriched:   integer("total_enriched").default(0),
  error:           text("error"),
  scanResult:      jsonb("scan_result"),
  scanSummary:     jsonb("scan_summary"),     // SiteScanSummary object
  pagesScanned:    integer("pages_scanned").default(0),
  settings:        jsonb("settings"),          // ProspectingSettings object
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  completedAt:     timestamp("completed_at", { withTimezone: true }),
});
```

### 3.6 `masar_harvest_jobs` — Masar harvest job tracking
Tracks harvest jobs (keyword search → company discovery → enrichment).
Fields: `id`, `jobId` (UUID), `keyword`, `status`, `companiesFound`, `companiesAdded`, `companiesDuplicate`, `log`, `createdAt`, `completedAt`.

### 3.7 `builder_companies` — AI Database Builder output
Same rich company fields as `companies` table, plus: `jobId`, `sourceId`, `sourceName`, `isDuplicate`.

### 3.8 `builder_jobs` — AI Database Builder job tracking
Fields: `id`, `legacyJobId`, `keyword`, `industry`, `city`, `status`, `sourceIndex`, `companiesFound`, `companiesAdded`, `companiesDuplicate`, `log`, `createdAt`, `completedAt`.

### 3.9 `lead_lists` / `lead_list_items`
Lead lists with criteria. Items have: `personName`, `personTitle`, `biography`, `linkedin`, `companyName`, `source`, `sourceId`, `matchScore`, `aiScore`, `aiReasoning`.

---

## 4. BACKEND ENTRY POINTS

### `src/index.ts`
```typescript
import app from "./app.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API Server running on port ${PORT}`);
});
```

### `src/app.ts`
```typescript
import express from "express";
import cors from "cors";
import router from "./routes";
import { registerOrcEngineRoutes } from "./orcengine/routes.js";
import { registerProspectingRoutes } from "./prospecting/routes.js";
import masarDatabaseRouter from "./routes/masar-database.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);           // mounts routes/index.ts
app.use("/api", masarDatabaseRouter);
registerOrcEngineRoutes(app);      // mounts /api/prospecting/* via function
registerProspectingRoutes(app);    // mounts /api/prospecting/* (scan, extract, etc.)

export default app;
```

### `src/routes/index.ts`
```typescript
import { Router } from "express";
import healthRouter from "./health";
import companiesRouter from "./companies";
import leadsRouter from "./leads";
import leadListsRouter from "./lead-lists";
import builderRouter from "./builder";
import meshbaseRouter from "./meshbase";
import masaarRouter from "./masaar";
import masarDatabaseRouter from "./masar-database";
import saMarketRouter from "./sa-market";
import personIntelRouter from "./person-intel";
import companyIntelRouter from "./company-intel";
import prosEngineChatRouter from "./prosengine-chat";
import orcengineRouter from "./orcengine";

const router = Router();
// All routers are use()'d here. They register at their own path prefixes.
// All endpoints are ultimately accessible at /api/<path>
router.use(healthRouter);
router.use(companiesRouter);
// ... all others
export default router;
```

---

## 5. SHARED BACKEND UTILITIES

### 5.1 Gemini Client (`src/gemini-search.ts`)

All Gemini functionality lives here. Key exports:

**`isGeminiConfigured()`** — returns `true` if `GEMINI_API_KEY` is set.

**`generateWithGemini(prompt, systemPrompt?, model?)`**
- Pure text generation, no web tools.
- Model: `"gemini-2.5-flash"` (default) or `"gemini-2.5-pro"`.
- Simulates system prompt via a `[user]/[model]` pattern (Gemini has no system role).
- Retries up to 3x on 503/overloaded errors.
- 55s timeout per attempt.
- Returns `string | null`.

**`searchWithGemini(query)`**
- Activates `googleSearch` + `urlContext` tools (Chrome AI mode — browses live pages).
- Fixed model: `gemini-2.5-flash`.
- Returns `string | null`.

**`deepResearchWithGemini(query, systemContext?, model?, useUrlContext?)`**
- Full web research with Google Search grounding.
- Returns `{ text: string; groundingChunks: string[] } | null`.
- `groundingChunks` = array of source URLs used.

**`synthesizeWithGemini(prompt, systemPrompt?, model?)`**
- Alias for `generateWithGemini`, uses `gemini-2.5-pro` by default.
- Used for JSON synthesis tasks.

**`extractCompaniesWithGemini(pageText, keyword)`**
- Extracts company entities from scraped page text.
- Returns array of company objects.

**`deepResearchTextWithGemini(query, systemContext?, model?)`**
- Like `deepResearchWithGemini` but returns just the text string.

### 5.2 StealthBrowser (`src/lib/stealth-browser.ts`)

Playwright-based stealth browser for anti-bot-protected sites.

**Anti-detection measures (injected JS `STEALTH_JS`):**
- `navigator.webdriver = undefined`
- Fake `navigator.plugins` array (3 Chrome plugins)
- `navigator.languages = ['ar-SA', 'ar', 'en-US', 'en']`
- `window.chrome` runtime mock
- Permissions API spoof (notifications)
- WebGL vendor/renderer spoof (Intel Inc.)
- Canvas fingerprint noise (random pixel XOR)
- Timing jitter (performance.now)

**`HumanBehavior` class:**
- `bezierPoint` / `generatePath` — smooth Bézier mouse paths (De Casteljau algorithm)
- `typingDelay()` — Gaussian ~N(90, 35ms) with thinking pauses (4%) and typo corrections (1.5%)
- `idle(minMs, maxMs)` — random human reading delay
- `scrollChunks(total)` — breaks scroll into human-size chunks (80–320px each)

**`SessionManager` class:**
- Saves/restores Playwright `storageState` (cookies + localStorage) per domain
- Stored as JSON files in `.agent_sessions/` directory

**`StealthBrowser` class:**
- `start(domain)` — launches Playwright Chromium, injects STEALTH_JS, loads saved session
- `goto(url, options)` — navigates with network idle wait
- `getContent()` — returns page HTML
- `stop()` — saves session, closes browser

**`autoSolveCaptcha(page, anthropic)`** — takes screenshot, sends to Claude Vision API to solve CAPTCHA.

### 5.3 Web Seeder (`src/lib/web-seeder.ts`)

Multi-page website crawler. Each page gets its own Claude AI analysis agent.

**`runWebSeeder(rootUrl, companyName?, options?)`**

Flow:
1. Fetches root URL with axios + cheerio
2. Extracts internal links (up to 100, filtered to same hostname)
3. For each page (up to `maxPages`, default 10, max 50):
   - Classifies page type: `about`, `services`, `contact`, `team`, `news`, `careers`, `projects`, `general`
   - Applies `seedMode` filter if set (`"all"` | `"content"` | `"products"` | `"contact"`)
   - Extracts emails/phones from page text (Saudi phone regex)
   - Sends page text to Claude (`claude-sonnet-4-6`) with page-type-specific extraction prompt
4. Aggregates all page intelligence via a final Claude call → structured JSON

**Returns `WebSeederResult`:**
```typescript
{
  success: boolean;
  rootUrl: string;
  pagesAnalyzed: number;
  seedMode: string;
  aggregated: {
    company: { nameEn, nameAr, description, founded, industry, website, phone, email, address };
    services: string[];
    team: Array<{ name, title, nameAr }>;
    news: Array<{ headline, date, summary }>;
    projects: Array<{ name, client, description }>;
    contacts: { emails, phones, offices, socialMedia };
    intelligence: { companySize, b2bSignals, techStack, keyClients, pagesCrawled, seedMode };
  };
  pages: PageIntelligence[];
  allEmails: string[];
  allPhones: string[];
}
```

**Used automatically by:**
- Company Intelligence (`/api/company-intel/profile`) — parallel source
- Person Intelligence (`/api/person-intel/profile`) — when `websiteUrl` provided
- Masar Database enrichment — background `setImmediate`
- `POST /api/company-intel/web-seed` — standalone on-demand

### 5.4 Perplexity Helper (inline in each engine)
Each engine file has its own `perplexitySearch(query, maxTokens)` function:
```typescript
async function perplexitySearch(query: string, maxTokens = 2000): Promise<string | null> {
  if (!process.env.PERPLEXITY_API_KEY) return null;
  const r = await axios.post("https://api.perplexity.ai/chat/completions", {
    model: "sonar",
    messages: [
      { role: "system", content: "Saudi Arabia B2B intelligence analyst..." },
      { role: "user", content: query },
    ],
    max_tokens: maxTokens,
    temperature: 0.1,
    return_citations: true,
  }, { headers: { Authorization: `Bearer ${key}` }, timeout: 35000 });
  return r.data?.choices?.[0]?.message?.content || null;
}
```

Fallback pattern: Perplexity → Gemini deepResearch (when `PERPLEXITY_API_KEY` absent but `GEMINI_API_KEY` set).

---

## 6. MASAAR ENGINE

**Purpose:** Given a Saudi CR (Commercial Registration) number, run a 5-agent pipeline to extract complete corporate intelligence from mc.gov.sa, Amaaly AOA (Articles of Association), and 12+ AI research engines.

### 6.1 API Endpoints (`routes/masaar.ts`)

#### `POST /api/masaar/start`
**Request body:**
```json
{ "crNumber": "1010123456", "stealthMode": true }
```
- Validates CR number: 7–12 digits
- Creates a `jobId` (UUID)
- Calls `createJob(jobId, stealthMode)` — registers EventEmitter in memory
- Returns immediately: `{ jobId, crNumber, stealthMode, message }`
- Fires `runMasaarPipeline(crNumber, jobId)` via `setImmediate` (non-blocking)

**Response:**
```json
{ "jobId": "uuid", "crNumber": "1010123456", "stealthMode": true, "message": "..." }
```

#### `POST /api/masaar/captcha/:jobId`
**Request body:**
```json
{ "captchaText": "A3B2C1", "captchaFor": "mc.gov.sa" }
```
- Calls `submitCaptcha(jobId, captchaFor, captchaText)` which resolves a waiting Promise in the pipeline
- Returns: `{ ok: true, message: "CAPTCHA submitted — pipeline resuming" }`

#### `GET /api/masaar/stream/:jobId`
- SSE endpoint (Server-Sent Events)
- Sets headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`
- Each event sent as: `data: ${JSON.stringify(event)}\n\n`
- Heartbeat every 15 seconds: `: heartbeat\n\n`
- Closes on `job_complete` or `job_error` events (with 2s delay)
- Also closes on request `close` / `error`

**SSE Event types (`AgentEvent`):**
```typescript
type: "agent_start" | "agent_log" | "agent_complete" | "agent_error"
    | "captcha_required" | "captcha_solved"
    | "stealth_solving" | "stealth_solved" | "stealth_session"
    | "job_complete" | "job_error"

// agent_start: { agentNum, agentName }
// agent_log: { agentNum, agentName, message }
// agent_complete: { agentNum, agentName, data: {...} }
// captcha_required: { captchaFor, captchaScreenshot (base64), captchaLabel }
// job_complete: { report: MasaarReport }
// job_error: { message }
```

### 6.2 Engine Architecture (`lib/masaar-engine.ts`)

#### Job Management
```typescript
const jobEmitters = new Map<string, EventEmitter>();

export function createJob(jobId: string, stealthMode: boolean) {
  jobEmitters.set(jobId, new EventEmitter());
}

export function getJobEmitter(jobId: string): EventEmitter | undefined {
  return jobEmitters.get(jobId);
}

export function submitCaptcha(jobId: string, captchaFor: string, text: string): boolean {
  // resolves a waiting Promise via a per-job captcha resolver map
}
```

#### `runMasaarPipeline(crNumber, jobId)`
Orchestrates all 5 agents. Runs Agent 1 first (blocks), then Agents 2-4 in parallel, then Agent 5.

```
Agent 1: mc.gov.sa Registry    → serial (needs stealth browser)
Agent 2: Amaaly AOA           → parallel with 3 & 4
Agent 3: Deep Research         → parallel with 2 & 4
Agent 4: Compliance & Sanctions → parallel with 2 & 3
Agent 5: Report Compiler       → serial (needs 1-4 results)
```

#### `runMasaarPipelineByName(nameAr, nameEn, jobId)`
Same pipeline but starts from Agent 2 (skips mc.gov.sa registry since no CR number).

### 6.3 Agent 1 — mc.gov.sa Registry

**Purpose:** Extracts CR data from Saudi Ministry of Commerce registry.

**Flow:**
1. Launch `StealthBrowser` on domain `mc.gov.sa`
2. Navigate to `https://mc.gov.sa/en/pages/cr.aspx`
3. Find input field, type CR number with `HumanBehavior.typingDelay()` delays
4. Submit form, wait for response
5. If CAPTCHA detected:
   a. Auto-solve with Claude Vision (`autoSolveCaptcha`)
   b. If that fails, emit `captcha_required` event with screenshot
   c. Wait for `submitCaptcha()` to be called by frontend
6. Extract HTML, send to Claude with structured extraction prompt
7. Claude returns JSON with all CR fields

**Extracted fields:**
- `nameEn`, `nameAr`, `crNumber`, `legalForm`, `legalFormAr`
- `headquarterCity`, `headquarterCityAr`, `foundingYear`, `fiscalYear`
- `capitalAmount`, `capitalDistribution`, `estimatedRevenue`
- `shareholders[]`: `{ nameEn, nameAr, nationalId, ownershipPct, nationality }`
- `managers[]`: `{ nameEn, nameAr, nationalId, appointmentTerm, powers }`
- `contactDetails`: `{ address, phone, email, website }`

### 6.4 Agent 2 — Amaaly AOA Intelligence

**Purpose:** Finds the latest Articles of Association (AOA) PDF on emagazine.aamaly.sa, OCRs it, and extracts governance structure.

**Flow:**
1. Navigate StealthBrowser to `https://emagazine.aamaly.sa/`
2. Search for company by name (Arabic preferred)
3. Find the most recent AOA publication
4. Download the PDF
5. If PDF found: base64-encode it, send to Claude with PDF contents for extraction
6. If no PDF: use CR data (from Agent 1) to infer AOA structure

**AOA extraction prompt asks Claude for:**
- `legalForm`, `registeredCapital`, `capitalDistribution`
- `shareholders[]` with names (EN+AR), nationalId, ownership %
- `managers[]` with names, title, term, powers
- `boardComposition`, `shareTransferRestrictions`
- `profitDistributionRules`, `dissolutionConditions`, `amendmentProcedures`
- `authorizedSignatory`, `estimatedRevenue`, `employees`
- `dataSource`: `"aoa-pdf"` | `"cr-inferred"`

### 6.5 Agent 3 — Deep Research Intelligence

**Purpose:** Fires 12+ AI engines simultaneously to gather comprehensive company intelligence.

**Engines fired (all via `Promise.allSettled`):**
1. Perplexity 1 — general profile & contact
2. Perplexity 2 — executive team & leadership
3. Perplexity 3 — shareholders & ownership
4. Perplexity 4 — financial profile
5. Perplexity 5 — news & recent developments (2024-2025)
6. Gemini 1 — shareholders & ownership (Google Search + URL context)
7. Gemini 2 — financial profile
8. Gemini 3 — latest news & developments
9. Gemini 4 — competitive & market intelligence
10. Claude — comprehensive bilingual corporate intelligence (max_tokens: 2500)
11. GPT-4o — financial & competitive intelligence (max_tokens: 2000)
12. OpenRouter DeepSeek R1 — stub (activates when `OPENROUTER_API_KEY` set)
13. OpenRouter Llama 3.3 70B — stub
14. OpenRouter Kimi — Arabic corporate research stub
15. Groq Llama 70B — stub (activates when `GROQ_API_KEY` set)

**Output:** Combined text string of all successful results, labeled by source.

### 6.6 Agent 4 — Compliance & Sanctions

**Purpose:** Checks company against 7 sanctions/compliance databases.

**Checks (all parallel via `Promise.allSettled`):**
1. **OFAC SDN** — `sanctionssearch.ofac.treas.gov` API (match score ≥80%)
2. **UN Security Council** — Perplexity search fallback
3. **EU Consolidated Sanctions** — `sanctionsmap.eu/api/v1/case` API
4. **Maroof.sa** — Saudi business verification API (`maroof.sa/api/v3.0/Establishments/Search`)
5. **Najiz.sa** — Saudi legal agencies (Playwright scrape of government site)
6. **Saudi Regulatory** (CMA, SAMA, ZATCA) — 3 parallel Perplexity searches
7. **News Flags** — Perplexity search for fraud/controversy mentions

**Returns `ComplianceResult`:**
```typescript
{
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
  checkedAt: string;  // ISO timestamp
}
```

### 6.7 Agent 5 — Bilingual Report Compiler

**Purpose:** Synthesizes all agent outputs into a final bilingual (EN+AR) intelligence report.

**Synthesis models (parallel):**
1. Claude Sonnet (primary, max_tokens: 4000)
2. GPT-4o (fallback)

**MasaarReport structure:**
```typescript
interface MasaarReport {
  crNumber: string;
  fetchedAt: string;
  stealthMode: boolean;
  sources: {
    mcGovSa: Record<string, unknown>;   // Agent 1 raw data
    emagazine: Record<string, unknown>; // Agent 2 raw data
    najiz: Record<string, unknown>;     // Agent 4 Najiz data
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
    shareholders: Array<{ nameEn, nameAr, nationalId, ownershipPct, nationality }>;
    managers: Array<{ nameEn, nameAr, nationalId, title?, appointmentTerm, powers }>;
    boardComposition: string | null;
    shareTransferRestrictions: string | null;
    profitDistributionRules: string | null;
  };
  aoa: Record<string, unknown>;           // Agent 2 AOA extraction
  deepResearch: string;                   // Agent 3 combined research text
  compliance: ComplianceResult;           // Agent 4 compliance data
  reportEn: string;                       // Agent 5 English report (markdown prose)
  reportAr: string;                       // Agent 5 Arabic report (markdown prose)
}
```

### 6.8 Masaar Data Persistence
On `job_complete`, the Masar Database route `POST /api/masar/database/companies/:id/pipeline-enrich` listens on the emitter and writes to `masar_companies` table:
- Maps `parsed.managers` → `management` array (with `title` from `appointmentTerm`)
- Maps AOA `boardOfDirectors` → `boardOfDirectors` array
- Filters out undisclosed/placeholder names before saving
- Only fills blank fields (does not overwrite existing good data)

---

## 7. AI DATABASE BUILDER

**Purpose:** Given a keyword/industry/sector, search 20+ Saudi data sources, discover companies, enrich each with AI, and populate a structured database.

### 7.1 API Endpoints (`routes/builder.ts`)

#### `POST /api/builder/harvest`
**Request:**
```json
{
  "keyword": "construction",
  "industry": "Construction",
  "city": "Riyadh",
  "enrichmentDepth": "standard",
  "sources": ["open-data", "custom"],
  "customUrls": ["https://example.com/directory"]
}
```
**Flow:**
1. Creates a builder job in `builder_jobs` table
2. Selects data sources based on `sources` array
3. Returns job info immediately
4. Fires `runBuilderHarvest(jobId, keyword, options)` in background

**Response:**
```json
{ "jobId": "abc123", "builderJobId": 42, "status": "running", "sourcesTotal": 15 }
```

#### `GET /api/builder/jobs`
Lists all builder jobs (ordered by id desc, limit 50).

#### `GET /api/builder/jobs/:id`
Gets single builder job status.

#### `DELETE /api/builder/jobs/:id/cancel`
Cancels a running builder job.

#### `GET /api/builder/companies`
Paginated list. Query params: `page`, `limit`, `search`, `jobId`, `city`, `industry`.

#### `GET /api/builder/companies/:id`
Single company detail.

#### `DELETE /api/builder/companies/:id`
Delete company + add to blocklist.

#### `DELETE /api/builder/companies/bulk`
Bulk delete + blocklist.

#### `POST /api/builder/companies/:id/enrich`
Re-enrich a single company.

#### `GET /api/builder/export`
Export companies as CSV, Excel, PDF, Word. Query params: `format`, `jobId`, `ids`, `search`.

#### `POST /api/builder/sources` / `GET /api/builder/sources`
Manage custom data sources (saved URLs).

#### Many more: `/stats`, `/deduplicate`, `/move-to-main`, `/merge-to-masar`, etc.

### 7.2 Builder Engine (`lib/builder-engine.ts`)

#### Source Types
The engine works with a list of `Source` objects:
```typescript
interface Source {
  id: string;
  name: string;
  type: "ai-generate" | "directory-scrape" | "api" | "custom-url";
  url?: string;
  description: string;
}
```

**Built-in sources include:**
- `open-data` — AI-generated Saudi company data using Gemini/Claude/GPT-4o
- `explorium` — Explorium API (firmographics)
- `apollo` — Apollo.io people/company API
- Custom URLs — user-provided directory URLs to scrape

#### `runBuilderHarvest(jobId, keyword, options)`

**High-level flow:**
```
For each source (in batches of 3 concurrent):
  1. Fetch raw company list (names, basic info)
  2. Check duplicates (vs existing companies + blocklist)
  3. Enrich each non-duplicate company with AI
  4. Insert into builder_companies table
  5. Update job progress
```

#### Company Discovery per Source
**`ai-generate` sources:**
- Sends keyword to Gemini/Claude/GPT-4o asking it to generate a list of Saudi companies
- Returns array: `{ nameEn, nameAr, city, industry, website, phone }`

**`directory-scrape` sources:**
- Fetches URL with axios + cheerio
- Sends page text to `extractCompaniesWithGemini(pageText, keyword)`
- Falls back to Claude extraction if Gemini unavailable

**`explorium` source:**
- POST to `https://app.explorium.ai/api/bundle/v1/companies`
- Filters to Saudi Arabia results

**`custom-url` sources:**
- Fetches the URL, extracts links with same-hostname filter
- For each page discovered, extracts company names with Gemini

#### AI Enrichment (`enrichCompanyWithAI`)
For each raw company, enriches with:
1. Perplexity search (2 parallel queries — general + financial)
2. Gemini search (2 parallel queries)
3. Explorium API (if configured)
4. Synthesis: Gemini → Claude → GPT-4o (first successful wins)

**Enrichment prompt returns JSON:**
```json
{
  "nameEn": "", "nameAr": "", "industry": "", "industryAr": "",
  "city": "", "region": "", "website": "", "phone": "", "email": "",
  "description": "", "descriptionAr": "", "employeeCount": "",
  "revenue": "", "foundingYear": 2005, "crNumber": "",
  "capitalAmount": "", "entityType": "LLC",
  "ownerName": "", "ownerNameAr": "", "ownerTitle": "",
  "ownerPhone": "", "ownerEmail": "", "ownerLinkedin": "",
  "estimatedWealth": "", "shareholders": "", "keyExecutives": "",
  "marketPositioning": "", "recentNews": "", "linkedinUrl": "",
  "enrichmentScore": 75, "enrichmentStatus": "enriched"
}
```

**Enrichment depth:**
- `"basic"` — name, city, industry, website, phone only
- `"standard"` — adds ownership, employees, revenue, executives
- `"deep"` — adds shareholders %, board, competitive intel, news

#### Duplicate Check
```typescript
async function checkDuplicate(nameEn, nameAr, jobId): Promise<boolean> {
  // Checks both builder_companies (same jobId) and companiesTable (global)
  // Uses ilike for fuzzy match on first significant word
}
```

#### Blocklist Check
```typescript
// lib/blocklist.ts
async function isBlocked({ nameEn, nameAr, crNumber, website }): Promise<boolean> {
  // Checks deleted_companies table
  // Companies the user deleted are NEVER re-seeded
}

async function addToBlocklist(companies[], source): Promise<void> {
  // Called on DELETE — adds to deleted_companies table
}
```

---

## 8. PROSENGINE — COMPANY & PERSON INTELLIGENCE

### 8.1 Company Intelligence API (`routes/company-intel.ts`)

#### `POST /api/company-intel/profile`
**Purpose:** Generate a comprehensive company intelligence dossier.

**Request:**
```json
{
  "companyName": "ACME Saudi Ltd",
  "website": "https://acme.sa",
  "crNumber": "1010123456",
  "city": "Riyadh",
  "sellerContext": {
    "companyName": "My Company",
    "product": "SaaS CRM",
    "objectives": ["book a meeting", "identify decision maker"]
  },
  "intelligenceGoals": ["profile", "financials", "ownership", "leadership", "market", "approach"],
  "knownFacts": "Company was founded in 2010 by Mohammed Al-Rashid"
}
```

**Phase 1 — Parallel Research (11 agents via `Promise.allSettled`):**
1. `runWebSeeder(website, companyName, { maxPages: 8 })` — multi-page website crawl
2. Gemini 1 — full company profile (Google Search + URL context)
3. Gemini 2 — ownership & shareholders (only if `goals.includes("ownership")`)
4. Gemini 3 — leadership & executives (only if `goals.includes("leadership")`)
5. Gemini 4 — competitive intelligence (only if `goals.includes("market")`)
6. Perplexity 1 — general profile & contact
7. Perplexity 2 — financial intelligence (only if `goals.includes("financials")`)
8. Perplexity 3 — ownership & AOA
9. Perplexity 4 — leadership
10. Claude Sonnet — comprehensive analysis (max_tokens: 2000)
11. GPT-4o — synthesis & validation (max_completion_tokens: 1500)

**Phase 2 — Context Assembly:**
Collects all successful results, truncates each to 2000-3000 chars, joins into `combinedContext` (max 14,000 chars).

**Phase 3 — Synthesis:**
Parallel: Claude Sonnet (primary, max_tokens: 4000) + Gemini Flash (secondary).
First valid parsed result wins. Falls back to GPT-4o direct if both fail.

**Response JSON structure:**
```json
{
  "profile": {
    "nameEn": "", "nameAr": "", "legalForm": "", "legalFormAr": "",
    "crNumber": "", "founded": "", "city": "", "address": "",
    "website": "", "phone": "", "email": "", "industry": "",
    "mainActivity": "", "mainActivityAr": ""
  },
  "financials": {
    "revenueEstimate": "", "revenueRange": "", "revenueRationale": "",
    "employeeCount": "", "paidUpCapital": "", "profitabilityIndicator": "",
    "growthSignals": [], "recentFinancialNews": ""
  },
  "ownership": {
    "structure": "Family-owned",
    "shareholders": [{ "nameEn": "", "nameAr": "", "ownershipPct": "50%", "nationality": "Saudi", "type": "Individual" }],
    "isPubliclyListed": false, "stockExchange": null, "ticker": null
  },
  "leadership": {
    "ceo": { "nameEn": "", "nameAr": "", "title": "CEO" },
    "boardChairman": { "nameEn": "", "nameAr": "" },
    "executives": [{ "nameEn": "", "nameAr": "", "title": "" }],
    "boardMembers": [{ "nameEn": "", "nameAr": "", "role": "Chairman" }]
  },
  "operations": {
    "activities": [], "products": [], "keyCients": [],
    "subsidiaries": [], "geographicPresence": []
  },
  "market": {
    "marketPosition": "", "marketShare": null,
    "competitors": [], "strengths": [], "weaknesses": [], "opportunities": []
  },
  "approach": {
    "bestChannel": "LinkedIn", "bestTiming": "", "entryPoint": "",
    "valueProp": "", "openingAngle": "",
    "potentialObjections": [], "culturalNotes": "", "sampleMessage": ""
  },
  "news": [{ "title": "", "date": "", "summary": "", "source": "" }],
  "intelligence": {
    "confidenceScore": 85, "dataQuality": "high",
    "verifiedFacts": [], "estimatedFacts": [], "caveats": "", "dataSources": []
  },
  "executiveSummary": "2-3 paragraph executive summary"
}
```

#### `POST /api/company-intel/save`
Saves a report to `company_intel_research` table.
**Request:** `{ companyName, website?, crNumber?, city?, sellerContext?, intelligenceGoals?, knownFacts?, report, tags?, notes? }`

#### `GET /api/company-intel/saved`
Returns all saved reports (desc by createdAt, limit 100).

#### `DELETE /api/company-intel/saved/:id`
Deletes a saved report.

#### `POST /api/company-intel/web-seed`
On-demand web seeder endpoint.
**Request:** `{ rootUrl, maxPages?, enableSeeder?, seedMode?, companyName? }`
**Response:** `WebSeederResult` (see section 5.3)

### 8.2 Person Intelligence API (`routes/person-intel.ts`)

#### `POST /api/person-intel/profile`
**Purpose:** Generate a comprehensive person intelligence dossier.

**Request:**
```json
{
  "name": "Mohammed Al-Rashid",
  "company": "ACME Saudi Ltd",
  "title": "CEO",
  "linkedinUrl": "https://linkedin.com/in/...",
  "websiteUrl": "https://acme.sa",
  "country": "Saudi Arabia",
  "sellerContext": { "companyName": "My Co", "product": "CRM", "objective": "book meeting" },
  "intelligenceGoals": ["career", "wealth", "approach"],
  "knownFacts": "Graduated from KFUPM in 2001"
}
```

**Phase 1 — Parallel Research (20 agents via `Promise.allSettled`):**

*Perplexity threads (9):*
1. Professional background & full career history
2. Company intelligence (if `company` provided)
3. Education & academic history
4. Wealth profile & financial indicators
5. Board memberships & advisory roles
6. Executive compensation benchmarks
7. Personal interests, philanthropy, public presence
8. Latest news & announcements (2024-2025)
9. LinkedIn URL discovery

*Crawl agents (2):*
10. LinkedIn profile page crawl (if `linkedinUrl` provided)
11. Company website crawl via `runWebSeeder` (if `websiteUrl` provided)

*External API agents (2):*
12. Apollo.io person lookup (`/v1/people/search`)
13. Explorium person lookup

*Gemini agents (4, all with Google Search grounding):*
14. Agent A — Career & professional history
15. Agent B — LinkedIn URL & social media discovery
16. Agent C — Company context & recent news
17. Agent D — Comprehensive deep dossier

*AI knowledge base agents (2):*
18. Claude Sonnet — training data knowledge
19. GPT-4o — training data knowledge

**Phase 2 — DeepResearch (sequential, after parallel batch):**
20. o4-mini DeepResearch (via `openai.responses.create` with `web_search_preview` tool)

**LinkedIn URL Discovery:**
Checks all 20 sources for LinkedIn URL pattern. Uses first found across: Perplexity 9, Gemini B, Gemini D, Claude, GPT-4o.

**Synthesis — Gemini Flash → Claude → GPT-4o (parallel, first valid wins):**

**Response JSON structure:**
```json
{
  "profile": {
    "fullName": "", "arabicName": "", "title": "", "company": "",
    "nationality": "", "location": "", "age": null, "linkedin": ""
  },
  "career": [
    { "company": "", "title": "", "period": "2020 – Present", "description": "" }
  ],
  "education": [
    { "institution": "", "degree": "", "year": "" }
  ],
  "company_analysis": {
    "name": "", "industry": "", "founded": "", "headquarters": "",
    "employees": "", "revenue_estimate": "", "performance": "",
    "market_position": "", "key_clients": [], "recent_developments": "",
    "competitors": [], "pain_points": []
  },
  "wealth_profile": {
    "estimated_net_worth": "", "income_estimate": "",
    "wealth_sources": [], "assets": "", "investments": "",
    "lifestyle_indicators": ""
  },
  "personal_profile": {
    "interests": [], "personality_traits": [], "communication_style": "",
    "languages": ["Arabic", "English"], "board_memberships": [],
    "publications": [], "awards": [], "social_presence": ""
  },
  "approach_strategy": {
    "best_channel": "", "best_timing": "", "opening_angle": "",
    "value_proposition": "", "potential_objections": [],
    "conversation_starters": [], "cultural_notes": "",
    "recommended_approach": "", "sample_message": ""
  },
  "intelligence_notes": {
    "confidence_level": "High",
    "data_sources": ["Perplexity: professional background", "..."],
    "verified_facts": [], "estimated_facts": [], "caveats": ""
  },
  "_pipelineStats": {
    "sourcesUsed": [], "hasRealData": true,
    "researchThreads": 14, "geminiAgents": 4,
    "discoveredLinkedIn": "https://..."
  }
}
```

#### `POST /api/person-intel/save`
Saves report to `prosengine_research` table. Also auto-seeds the person into "ProsEngine Watchlist" lead list via `setImmediate`.

#### `GET /api/person-intel/saved`
Returns all saved reports (desc by createdAt, limit 100).

#### `DELETE /api/person-intel/saved/:id`
Deletes a saved report.

---

## 9. PROSENGINE CHAT

### `POST /api/prosengine/chat`
**Purpose:** AI assistant that answers questions about a company or person, with autonomous live research.

**Request:**
```json
{
  "message": "What are the latest news about this company?",
  "context": "=== COMPANY INTELLIGENCE REPORT ===\n... (full report text)",
  "mode": "person",
  "model": "claude-sonnet",
  "messages": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }]
}
```
Note: `messages` (history array) OR `message` (single string) — both supported.

**Intent Classification (`classifyIntent`):**
```typescript
type ChatIntent = "answer_from_context" | "perplexity_search" | "crawl_url" | "deep_research";

// Deep research triggers: "go deeper", "research this", "investigate", "full dossier", etc.
// Perplexity triggers: "search for", "news about", "latest", "2024", "2025", etc.
// Crawl triggers: "crawl", "check their website", "extract from", etc.
// Default: "answer_from_context"
```

**Research execution based on intent:**
- `perplexity_search`: 2 parallel Perplexity queries
- `crawl_url`: extracts URL from message, calls `fullStackCrawl(url)` (StealthBrowser → crawl4ai → plain HTTP)
- `deep_research`: 2 Perplexity + o4-mini DeepResearch (fallback to Perplexity if o4-mini unavailable)

**Synthesis:**
- Claude Sonnet + GPT-4o in parallel — first valid wins (Claude preferred)
- System prompt instructs plain prose, no markdown, 3-6 paragraphs max
- Special `PROFILE_UPDATE:{json}` pattern at end of reply triggers field updates

**Response:**
```json
{
  "reply": "Prose answer...",
  "profileUpdate": { "fieldName": "newValue" },  // optional
  "researchSteps": ["Perplexity live search"]     // optional
}
```

### `POST /api/prosengine/chat/stream`
SSE streaming version of `/api/prosengine/chat`.

**SSE event flow:**
```
→ { event: "intent", data: { intent: "deep_research" } }
→ { event: "agent_start", data: { agent: "Perplexity search", description: "..." } }
→ { event: "agent_done", data: { agent: "Perplexity search", found: true, preview: "..." } }
→ { event: "agent_start", data: { agent: "Deep research", description: "..." } }
→ { event: "agent_done", data: { agent: "Deep research", found: true } }
→ { event: "synthesising", data: { researchSteps: [...] } }
→ { event: "reply", data: { reply: "...", profileUpdate: {...} } }
→ { event: "done", data: {} }
```

**`fullStackCrawl(url)` — 3-tier crawler:**
1. StealthBrowser (Playwright + anti-detection)
2. crawl4ai (headless Chromium + AI extraction)
3. Plain HTTP + cheerio (lightest fallback)

---

## 10. WEB PROSPECTING (ORC ENGINE)

**Purpose:** Given any website URL, scan it to detect structure, then extract and enrich company listings.

### 10.1 API Endpoints (`prospecting/routes.ts`)

All registered directly on Express app (not via the router middleware):

#### `POST /api/prospecting/scan`
**Request:** `{ "url": "https://chamber.sa/members" }`

Security validation before processing:
- Must be `http://https://` protocol
- Blocked: localhost, 0.0.0.0, private IP ranges (10.x, 192.168.x, 172.16-31.x, 169.254.x, ::1)
- DNS resolution checked — resolved IPs also validated against private ranges

**Flow (`scanWebsiteAsync`):**
1. Fetch homepage (plain HTTP → Playwright fallback → StealthBrowser fallback)
2. Detect content language (Arabic/English/mixed by char ratio)
3. Extract all internal links, filter irrelevant paths
4. Identify listing page candidates (URL pattern matching EN + AR patterns)
5. Sample up to 2 listing pages
6. Send all content to GPT-4o for structured analysis

**Returns (`ProspectingJob`):**
```json
{
  "id": 42,
  "targetUrl": "https://...",
  "status": "scanned",
  "scanSummary": {
    "totalPages": 5,
    "sampleCompanies": ["Company A", "Company B"],
    "categories": ["Construction", "IT"],
    "cities": ["Riyadh", "Jeddah"],
    "industries": ["Technology", "Finance"],
    "suggestedQuestions": [
      { "question": "Which city?", "options": ["All cities", "Riyadh", "Jeddah"] },
      { "question": "What level of detail?", "options": ["Basic", "Standard", "Deep"] },
      { "question": "How many companies?", "options": ["First 50", "First 100", "First 200", "All available"] }
    ],
    "paginationType": "numbered",
    "websiteType": "directory",
    "contentLanguage": "arabic"
  }
}
```

#### `POST /api/prospecting/:jobId/extract`
**Request:** `{ "settings": { "userAnswers": {...}, "maxPages": 100, "extractionFields": [], "enrichmentDepth": "standard", "extractionLanguage": "english" } }`

**Flow (`extractionAsync`):**
1. Re-fetch listing pages (pagination-aware)
2. For each page: extract company names with GPT-4o
3. Batch enrich companies (`fastEnrichSingle` per company)
4. Save to `prospecting_results` table

**`fastEnrichSingle` — 10 parallel data sources:**
1. Company website direct fetch (plain HTTP)
2. Company contact/about pages
3. Playwright JS-rendered website
4. crawl4ai (headless Chromium)
5. Perplexity search (focus-targeted)
6. Perplexity detail search (CR/financial)
7. Owner/shareholder Perplexity search
8. Internal database match (companiesTable)
9. Saudi government sources (Explorium)
10. Explorium firmographic API

**Synthesis:** GPT-4o (primary) → Claude (backup for missing fields)

**Returns 22-field enriched company record:**
```json
{
  "profileSummary": "", "industry": "", "employees": "", "revenue": "",
  "founded": "", "services": [], "keyPeople": [],
  "ownerName": "", "ownerDetails": "", "estimatedWealth": "",
  "shareholders": [{ "name": "", "percentage": "25%" }],
  "location": "", "landline": "", "email": "", "website": "",
  "socialMedia": { "linkedin": "", "twitter": "", "instagram": "" },
  "crNumber": "", "capital": "", "entityType": "",
  "registrationDate": "", "marketPositioning": "", "contactPerson": ""
}
```

#### `GET /api/prospecting/:jobId`
Returns job status and summary.

#### `GET /api/prospecting/:jobId/results`
Returns extracted + enriched company results.

#### `POST /api/prospecting/:jobId/export`
Export results. **Request:** `{ "format": "csv" | "json" | "excel" | "pdf" }`

#### `DELETE /api/prospecting/:jobId`
Deletes job and results.

#### `GET /api/prospecting`
Lists all jobs (ordered by createdAt desc).

#### `GET /api/prospecting/exports/history`
Lists export history.

---

## 11. FRONTEND ARCHITECTURE

### 11.1 Critical BASE_URL Pattern

**Every frontend file must use this pattern for API calls:**
```typescript
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
// Then all API calls:
const response = await fetch(`${BASE}/api/masaar/start`, { ... });
```

This is required because Replit serves the app at a path prefix (e.g., `/prospect-sa/`). Without this, API calls hit the wrong route.

### 11.2 Wouter Routing Rules

**Critical ordering rule:** More specific routes MUST appear before parent routes.

```tsx
// App.tsx — CORRECT order
<Switch>
  <Route path="/" component={HomePage} />
  <Route path="/masaar" component={MasaarPage} />
  <Route path="/masar-database/company/:id" component={MasarCompanyDetailPage} />
  <Route path="/masar-database" component={MasarDatabasePage} />
  <Route path="/builder" component={BuilderPage} />
  <Route path="/prosengine/company" component={ProsEngineCompanyPage} />
  <Route path="/prosengine/person" component={ProsEnginePersonPage} />
  <Route path="/prosengine" component={ProsEnginePage} />
  <Route path="/prospecting/company/:id" component={ProspectingCompanyDetailPage} />
  <Route path="/prospecting" component={ProspectingPage} />
</Switch>
```

If `/prosengine` comes before `/prosengine/company`, the company route will never match.

### 11.3 TanStack Query Setup

```tsx
// main.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
```

### 11.4 SSE (Server-Sent Events) Pattern on Frontend

Used by Masaar and Masar Database (harvest). Standard pattern:
```typescript
const eventSource = new EventSource(`${BASE}/api/masaar/stream/${jobId}`);

eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data) as AgentEvent;
  switch (event.type) {
    case "agent_start":
      // show agent starting
      break;
    case "agent_log":
      // append log message
      break;
    case "agent_complete":
      // show completion badge
      break;
    case "captcha_required":
      // show CAPTCHA UI with base64 screenshot
      break;
    case "job_complete":
      setReport(event.report!);
      eventSource.close();
      break;
    case "job_error":
      setError(event.message!);
      eventSource.close();
      break;
  }
};

eventSource.onerror = () => {
  eventSource.close();
};
```

---

## 12. FRONTEND — MASAAR PAGE

**File:** `pages/MasaarPage.tsx`
**Route:** `/masaar`
**Purpose:** Saudi CR Number intelligence lookup — 5-agent pipeline with real-time streaming.

### State
```typescript
const [crNumber, setCrNumber] = useState("");
const [jobId, setJobId] = useState<string | null>(null);
const [streaming, setStreaming] = useState(false);
const [agents, setAgents] = useState<AgentState[]>([]);
// AgentState: { num, name, status: "pending"|"running"|"complete"|"error", logs, data }
const [report, setReport] = useState<MasaarReport | null>(null);
const [captchaPending, setCaptchaPending] = useState<{ captchaFor, screenshot, label } | null>(null);
const [captchaInput, setCaptchaInput] = useState("");
```

### Key Functions

**`handleStart()`**
```typescript
async function handleStart() {
  const res = await fetch(`${BASE}/api/masaar/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ crNumber: crNumber.trim(), stealthMode: true }),
  });
  const data = await res.json();
  setJobId(data.jobId);
  startStreaming(data.jobId);
}
```

**`startStreaming(jobId)`**
Opens `EventSource` to `/api/masaar/stream/${jobId}`.
Updates agent states based on event types.
On `captcha_required`: shows CAPTCHA modal with `captchaScreenshot` (base64 image).

**`handleCaptchaSubmit()`**
```typescript
async function handleCaptchaSubmit() {
  await fetch(`${BASE}/api/masaar/captcha/${jobId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ captchaText: captchaInput, captchaFor: captchaPending.captchaFor }),
  });
  setCaptchaPending(null);
}
```

### Display Components
- **Agent Progress List:** Shows each of 5 agents with icon, name, status badge, and expandable log
- **CAPTCHA Modal:** Displays base64 image, text input for human answer
- **Report Tabs:** Profile | Shareholders | Management | Compliance | Deep Research | Full Report
- **Compliance Panel:** Shows OFAC/UN/EU/Maroof/CMA/SAMA/ZATCA results with colored risk badges
- **Export Button:** Downloads the report as PDF or JSON

---

## 13. FRONTEND — AI DATABASE BUILDER PAGE

**File:** `pages/BuilderPage.tsx`
**Route:** `/builder`
**Purpose:** Build a Saudi company database from keyword searches across 20+ sources.

### State
```typescript
const [keyword, setKeyword] = useState("");
const [industry, setIndustry] = useState("");
const [city, setCity] = useState("");
const [enrichmentDepth, setEnrichmentDepth] = useState<"basic"|"standard"|"deep">("standard");
const [selectedSources, setSelectedSources] = useState<string[]>(["open-data"]);
const [currentJob, setCurrentJob] = useState<BuilderJob | null>(null);
const [companies, setCompanies] = useState<Company[]>([]);
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
```

### Key Flows

**Starting a harvest:**
```typescript
async function startHarvest() {
  const res = await fetch(`${BASE}/api/builder/harvest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword, industry, city, enrichmentDepth, sources: selectedSources }),
  });
  const job = await res.json();
  setCurrentJob(job);
  // Start polling job status
  startPolling(job.builderJobId);
}
```

**Polling job status:**
```typescript
function startPolling(jobId: number) {
  const interval = setInterval(async () => {
    const res = await fetch(`${BASE}/api/builder/jobs/${jobId}`);
    const job = await res.json();
    setCurrentJob(job);
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      clearInterval(interval);
      fetchCompanies();
    }
  }, 3000);
}
```

### Display Components
- **Source Selector:** Checkbox grid for 20+ data sources
- **Job Progress Card:** Animated progress bar, found/added/duplicate counters, live log
- **Company Table:** Sortable columns, enrichment status badges, expandable rows
- **Bulk Actions Toolbar:** Select all, delete selected, export selected, move to Masar DB
- **Export Panel:** CSV | Excel | PDF | Word | PPTX format selector
- **Re-enrich Button:** Triggers `POST /api/builder/companies/:id/enrich`

---

## 14. FRONTEND — PROSENGINE PAGES

### 14.1 Company Intelligence Page
**File:** `pages/ProsEngineCompanyPage.tsx`
**Route:** `/prosengine/company`

**Form fields:**
- Company Name (required)
- Website URL (optional)
- CR Number (optional)
- City (optional)
- Seller Context: Your company name, product, objectives (multi-select)
- Intelligence Goals: profile, financials, ownership, leadership, market, approach (checkboxes)
- Known Facts (textarea)

**Loading state:**
Shows animated spinner with rotating messages about which agents are running.
Research typically takes 30-120 seconds.

**Report Display Tabs:**
1. **Profile** — company overview, contact details, legal form
2. **Financials** — revenue estimate, employees, capital, growth signals
3. **Ownership** — shareholders table with %, nationality, type
4. **Leadership** — CEO card, board members, executives list
5. **Market** — competitors, strengths, weaknesses, opportunities
6. **Approach** — outreach strategy, value prop, sample message, cultural notes
7. **News** — recent news items with date and source
8. **Intelligence** — confidence score, verified vs estimated facts, data sources

**Chat Integration:**
After report loads, shows `ProsEngineChat` component with the report as context.
```typescript
<ProsEngineChat
  context={formatReportAsText(report)}
  mode="website"
/>
```

**Save Flow:**
```typescript
await fetch(`${BASE}/api/company-intel/save`, {
  method: "POST",
  body: JSON.stringify({ companyName, website, crNumber, city, sellerContext, intelligenceGoals, knownFacts, report }),
});
```

### 14.2 Person Intelligence Page
**File:** `pages/ProsEnginePersonPage.tsx`
**Route:** `/prosengine/person`

**Form fields:**
- Person Name (required)
- Company (optional)
- Title (optional)
- LinkedIn URL (optional)
- Company Website URL (optional)
- Seller Context: Your company, product, objective
- Intelligence Goals: career, wealth, education, board, approach, company analysis

**Report Display Tabs:**
1. **Profile** — name (EN+AR), title, company, LinkedIn, nationality, location, age
2. **Career** — chronological career history with companies, roles, periods, descriptions
3. **Education** — institutions, degrees, years
4. **Company Analysis** — employer intel: revenue, employees, clients, market position
5. **Wealth Profile** — net worth estimate, income, wealth sources, investments
6. **Personal** — interests, personality traits, board memberships, awards
7. **Approach Strategy** — outreach channel, timing, opening angle, value prop, sample message

**Pipeline Stats Card:**
Shows which sources were used, how many Gemini agents fired, whether LinkedIn was discovered.

### 14.3 ProsEngine Chat Component
**File:** `components/ProsEngineChat.tsx`
**Used by:** Both Company and Person intelligence pages

```typescript
interface ProsEngineChatProps {
  context: string;  // Full report formatted as text
  mode: "person" | "website" | "seeder";
}
```

**Chat flow:**
- User types message
- Sends to `POST /api/prosengine/chat/stream` (SSE) or `POST /api/prosengine/chat` (REST)
- For SSE: shows live research agent progress (agent_start → agent_done badges)
- Displays "synthesising…" while LLM generates
- Shows final reply in formatted prose

**Profile Update handling:**
When `profileUpdate` present in response, the chat component calls parent's update function to patch specific fields in the displayed report.

---

## 15. ENVIRONMENT VARIABLES

### Required
```bash
DATABASE_URL=postgresql://...    # PostgreSQL connection string
GEMINI_API_KEY=AIza...           # Google Gemini (primary AI)
```

### Highly Recommended
```bash
ANTHROPIC_API_KEY=sk-ant-...     # Claude Sonnet (synthesis primary)
OPENAI_API_KEY=sk-...            # GPT-4o (fallback + prospecting extraction)
PERPLEXITY_API_KEY=pplx-...      # Real-time web search
```

### Optional (enable additional engines)
```bash
APOLLO_API_KEY=...               # Apollo.io person lookup
EXPLORIUM_API_KEY=...            # Explorium firmographics
OPENROUTER_API_KEY=...           # DeepSeek R1, Llama 3.3, Kimi
GROQ_API_KEY=...                 # Llama 70B fast inference
```

### AI Integration Alternatives (Replit-provided)
```bash
AI_INTEGRATIONS_ANTHROPIC_API_KEY=...  # Replit-managed Anthropic key
AI_INTEGRATIONS_OPENAI_API_KEY=...     # Replit-managed OpenAI key
```
The code checks these as fallbacks: `process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY`

### How Gemini is checked
```typescript
export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
```
All Gemini calls are gated on `isGeminiConfigured()`. If `false`, those agents are skipped silently and other engines fill the gap.

---

## 16. KEY PATTERNS & GOTCHAS

### 16.1 SSE Pattern (Backend)
Every SSE endpoint follows this exact structure:
```typescript
res.setHeader("Content-Type", "text/event-stream");
res.setHeader("Cache-Control", "no-cache");
res.setHeader("Connection", "keep-alive");
res.setHeader("X-Accel-Buffering", "no");  // Critical for Nginx proxies
res.flushHeaders();

const sendEvent = (event: SomeEvent) => {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  // Optional: flush for nginx
};

const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);

emitter.on("event", sendEvent);
req.on("close", () => {
  clearInterval(heartbeat);
  emitter.off("event", sendEvent);
});
```

### 16.2 Job Emitter Pattern
Masaar and Masar Harvester use an in-memory `Map<jobId, EventEmitter>`:
```typescript
const jobEmitters = new Map<string, EventEmitter>();

export function createJob(jobId: string) {
  jobEmitters.set(jobId, new EventEmitter());
  // Auto-expire after 10 minutes
  setTimeout(() => jobEmitters.delete(jobId), 10 * 60 * 1000);
}

export function getJobEmitter(jobId: string): EventEmitter | undefined {
  return jobEmitters.get(jobId);
}
```

The route handler starts the job via `setImmediate()` (non-blocking), responds immediately, then the frontend connects to the SSE stream separately.

### 16.3 AI Synthesis Priority
Across all engines, the synthesis priority is:
```
Gemini Flash (fast, cheap) → Claude Sonnet (best quality) → GPT-4o (fallback)
```
Run in parallel, use first valid parsed result. "Valid" means the JSON has the expected root key (e.g., `profile`, `parsed`, etc.).

```typescript
const [geminiResult, claudeResult, gptResult] = await Promise.allSettled([
  isGeminiConfigured() ? synthesizeWithGemini(prompt) : Promise.resolve(null),
  claudeCall(prompt),
  gptCall(prompt),
]);

const raw = (geminiResult.status === "fulfilled" && geminiResult.value)
  ?? (claudeResult.status === "fulfilled" && claudeResult.value)
  ?? (gptResult.status === "fulfilled" && gptResult.value)
  ?? "{}";
```

### 16.4 Blocklist Pattern
Any company the user deletes is added to `deleted_companies` table. Before inserting any company from any source, `isBlocked()` checks this table. This prevents deleted companies from reappearing on re-harvest.

### 16.5 CAPTCHA Handling (Masaar)
The pipeline pauses waiting for CAPTCHA resolution via a `Promise` held in a `Map<jobId, Map<captchaFor, resolver>>`:
```typescript
// In the engine:
const captchaText = await waitForCaptcha(jobId, "mc.gov.sa");
// waitForCaptcha creates a Promise, stores resolver in captchaResolvers map

// In submitCaptcha():
export function submitCaptcha(jobId, captchaFor, text): boolean {
  const resolver = captchaResolvers.get(jobId)?.get(captchaFor);
  if (!resolver) return false;
  resolver(text);  // resolves the waiting Promise
  return true;
}
```
First tries `autoSolveCaptcha` (Claude Vision). If that fails, emits `captcha_required` with base64 screenshot for human input.

### 16.6 Enrichment Semaphore
The Masar Database bulk enrichment uses a concurrency limiter:
```typescript
// At most 3 companies enriched simultaneously
const MAX_CONCURRENT = 3;
let activeCount = 0;

async function enrichWithSemaphore(id: number) {
  while (activeCount >= MAX_CONCURRENT) {
    await new Promise(r => setTimeout(r, 500));
  }
  activeCount++;
  try { await enrichMasarCompany(id); }
  finally { activeCount--; }
}
```

### 16.7 Phone Number Extraction (Saudi)
Used consistently across all scrapers:
```typescript
// Saudi mobile: 05X-XXX-XXXX
const mobileRegex = /05\d[\s.-]?\d{3}[\s.-]?\d{4}/g;

// Saudi landlines: +966-1/2/3/4/6/7-XXX-XXXX
const landlineRegex = /(?:\+966|00966|0)[\s.-]?(?:1|2|3|4|6|7)[\s.-]?\d{3}[\s.-]?\d{4}/g;

// Any Saudi number:
const anyPhone = /(?:\+966|00966|0)\s?\d{2}\s?\d{3}\s?\d{4}/g;

// Normalization:
const normalized = cleaned.startsWith('+') ? cleaned :
  cleaned.startsWith('00966') ? '+' + cleaned.substring(2) :
  cleaned.startsWith('0') ? '+966' + cleaned.substring(1) : cleaned;
```

### 16.8 Arabic Content Detection
```typescript
function detectContentLanguage(content: string): 'arabic' | 'english' | 'mixed' {
  const arabicChars = (content.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (content.match(/[a-zA-Z]/g) || []).length;
  const ratio = arabicChars / (arabicChars + latinChars);
  if (ratio > 0.7) return 'arabic';
  if (ratio > 0.4) return 'mixed';
  return 'english';
}
```

### 16.9 JSON Extraction from LLM Output
Every synthesis call uses this pattern to extract JSON from LLM output (which may contain markdown fences):
```typescript
function tryParseReport(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.profile ? parsed : null; // validate has expected root key
  } catch { return null; }
}
```

### 16.10 Timeout Pattern
All external API calls use `Promise.race` with a timeout:
```typescript
const result = await Promise.race([
  anthropic.messages.create({ ... }),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
]);
```

For `Promise.allSettled` (no rejection propagation), use `AbortSignal.timeout(ms)` in fetch calls instead:
```typescript
const resp = await fetch(url, { signal: AbortSignal.timeout(25000) });
```

### 16.11 Export Formats (Masar Database)
`GET /api/masar/database/export?format=csv|excel|word|pdf|pptx`

- **CSV:** UTF-8 BOM (`\uFEFF`) prepended for Excel compatibility with Arabic text
- **Excel (XLSX):** Multi-sheet: Companies sheet + Shareholders sheet + Management & Board sheet
- **Word (DOC):** HTML with Word XML namespace, company sections with full profile tables
- **PDF:** HTML with `@media print` CSS, served as `text/html` with print button
- **PPTX:** Using `pptxgenjs` library — one slide per company with field grid layout

### 16.12 WAF Detection
The prospecting engine detects when a site is blocking scraping:
```typescript
const WAF_INDICATORS = [
  'cloudflare', 'just a moment', 'ray id', 'captcha',
  'checking your browser', 'access denied', 'ddos protection',
  'sucuri', 'wordfence', 'security check', 'challenge-platform',
];

function isWafBlocked(html: string, text: string): boolean {
  const matchCount = WAF_INDICATORS.filter(i => html.toLowerCase().includes(i)).length;
  if (matchCount >= 2) return true;
  if (text.length < 200 && matchCount >= 1) return true;
  return false;
}
```

---

## COMPLETE API REFERENCE SUMMARY

| Method | Path | Engine | Description |
|--------|------|--------|-------------|
| POST | `/api/masaar/start` | Masaar | Start 5-agent CR pipeline |
| POST | `/api/masaar/captcha/:jobId` | Masaar | Submit manual CAPTCHA |
| GET | `/api/masaar/stream/:jobId` | Masaar | SSE stream of agent events |
| POST | `/api/masar/database/harvest` | Masar DB | Start harvest job |
| GET | `/api/masar/database/stream/:jobId` | Masar DB | SSE stream of harvest events |
| GET | `/api/masar/database/companies` | Masar DB | Paginated company list |
| GET | `/api/masar/database/companies/:id` | Masar DB | Single company detail |
| DELETE | `/api/masar/database/companies/:id` | Masar DB | Delete company |
| DELETE | `/api/masar/database/companies/bulk` | Masar DB | Bulk delete |
| POST | `/api/masar/database/companies/:id/re-enrich` | Masar DB | Re-enrich company |
| POST | `/api/masar/database/companies/:id/pipeline-enrich` | Masar DB | Run full Masaar pipeline on company |
| POST | `/api/masar/database/enrich-all` | Masar DB | Bulk enrich all pending |
| GET | `/api/masar/database/export` | Masar DB | Export (CSV/Excel/Word/PDF/PPTX) |
| POST | `/api/masar/database/deduplicate` | Masar DB | Remove duplicate companies |
| GET/POST | `/api/masar/database/sources` | Masar DB | Custom source management |
| POST | `/api/builder/harvest` | Builder | Start AI database builder job |
| GET | `/api/builder/jobs` | Builder | List all builder jobs |
| GET | `/api/builder/jobs/:id` | Builder | Job status |
| DELETE | `/api/builder/jobs/:id/cancel` | Builder | Cancel job |
| GET | `/api/builder/companies` | Builder | Paginated company list |
| GET | `/api/builder/companies/:id` | Builder | Single company |
| DELETE | `/api/builder/companies/:id` | Builder | Delete company |
| DELETE | `/api/builder/companies/bulk` | Builder | Bulk delete |
| POST | `/api/builder/companies/:id/enrich` | Builder | Re-enrich company |
| GET | `/api/builder/export` | Builder | Export companies |
| POST | `/api/company-intel/profile` | ProsEngine | Company intelligence report |
| POST | `/api/company-intel/save` | ProsEngine | Save company report |
| GET | `/api/company-intel/saved` | ProsEngine | List saved company reports |
| DELETE | `/api/company-intel/saved/:id` | ProsEngine | Delete saved report |
| POST | `/api/company-intel/web-seed` | ProsEngine | On-demand web seeder |
| POST | `/api/person-intel/profile` | ProsEngine | Person intelligence dossier |
| POST | `/api/person-intel/save` | ProsEngine | Save person report |
| GET | `/api/person-intel/saved` | ProsEngine | List saved person reports |
| DELETE | `/api/person-intel/saved/:id` | ProsEngine | Delete saved report |
| POST | `/api/prosengine/chat` | ProsEngine | AI chat assistant (REST) |
| POST | `/api/prosengine/chat/stream` | ProsEngine | AI chat assistant (SSE) |
| POST | `/api/prospecting/scan` | Prospecting | Scan website structure |
| POST | `/api/prospecting/:jobId/extract` | Prospecting | Extract & enrich companies |
| GET | `/api/prospecting/:jobId` | Prospecting | Job status |
| GET | `/api/prospecting/:jobId/results` | Prospecting | Extracted company results |
| POST | `/api/prospecting/:jobId/export` | Prospecting | Export results |
| DELETE | `/api/prospecting/:jobId` | Prospecting | Delete job |
| GET | `/api/prospecting` | Prospecting | List all jobs |
| GET | `/api/prospecting/exports/history` | Prospecting | Export history |

---

*Document generated from complete source code read of ProspectSA. All backend engine logic, API signatures, database schemas, and frontend patterns are documented from the actual implementation.*
