# Masaar & ProsEngine — Technical Reference

> Full implementation documentation for the Saudi B2B Intelligence engines.
> Target audience: engineers implementing these modules in a new application.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [AI Stack & Required Environment Variables](#2-ai-stack--required-environment-variables)
3. [Masaar — 7-Agent CR Lookup Pipeline](#3-masaar--7-agent-cr-lookup-pipeline)
4. [Masaar — Database Harvester](#4-masaar--database-harvester)
5. [ProsEngine — Person Intelligence](#5-prosengine--person-intelligence)
6. [ProsEngine — Company Intelligence](#6-prosengine--company-intelligence)
7. [Database Schemas](#7-database-schemas)
8. [Complete API Reference](#8-complete-api-reference)
9. [SSE Streaming Protocol](#9-sse-streaming-protocol)
10. [CAPTCHA Handling Architecture](#10-captcha-handling-architecture)
11. [Stealth Browser Architecture](#11-stealth-browser-architecture)
12. [Key Engineering Rules & Invariants](#12-key-engineering-rules--invariants)

---

## 1. Architecture Overview

The platform has four independent engines sharing a PostgreSQL database:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ProspectSA Backend                          │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────────────────────────┐   │
│  │     Masaar       │    │              ProsEngine               │   │
│  │                  │    │                                      │   │
│  │ 7-Agent CR       │    │  Person Intel  │  Company Intel      │   │
│  │ Lookup Pipeline  │    │  (20 sources)  │  (11 sources)       │   │
│  │                  │    │                                      │   │
│  │ + DB Harvester   │    └──────────────────────────────────────┘   │
│  │   (2 agents +    │                                               │
│  │    enrichment)   │    ┌──────────────────────────────────────┐   │
│  └──────────────────┘    │          OrcBase (companies)          │   │
│                           │  (NEVER written by Masaar/Builder)   │   │
│                           └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         ↕ SSE streaming            ↕ JSON REST
      Real-time event bus      Standard request/response
```

**Critical Rule**: `companiesTable` (OrcBase, the `companies` Postgres table) must **never** be written to by Masaar, the Database Builder, Prospecting, or Company Intel. Each engine writes exclusively to its own table.

---

## 2. AI Stack & Required Environment Variables

### AI Providers (priority order: Gemini → Claude → GPT-4o)

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini — grounded Google Search, text generation |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Anthropic proxy base URL |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Claude Sonnet (synthesis, parsing, analysis) |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI proxy base URL |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | GPT-4o (synthesis fallback, DeepResearch o4-mini) |
| `PERPLEXITY_API_KEY` | Perplexity Sonar (live web search — primary search engine) |

### Optional Enrichment APIs

| Variable | Purpose |
|---|---|
| `APOLLO_API_KEY` | Apollo.io person/company lookup |
| `EXPLORIUM_API_KEY` | Explorium firmographic data |

### Gemini Usage Patterns

There are three distinct Gemini functions — **never** confuse their return types:

```typescript
// 1. Web-grounded search — returns string | null
searchWithGemini(query: string): Promise<string | null>

// 2. Deep research with grounding — returns { text, groundingChunks } | null
deepResearchWithGemini(
  query: string,
  systemPrompt: string,
  model?: string,
  enableGrounding?: boolean
): Promise<{ text: string; groundingChunks: string[] } | null>

// 3. Pure text generation (no web tools) — returns string | null
generateWithGemini(
  prompt: string,
  systemPrompt: string,
  model?: string
): Promise<string | null>
```

> **Rule**: For final synthesis/JSON generation (when you already have all context collected), always use `generateWithGemini`. Never call `.match()` on the result of `deepResearchWithGemini` — it is NOT a string.

---

## 3. Masaar — 7-Agent CR Lookup Pipeline

### Purpose

Given a Saudi Commercial Registration (CR) number, the pipeline extracts complete company intelligence from official government sources, the Articles of Association (AOA) registry, and the legal system. It produces a bilingual (Arabic + English) intelligence report.

### Pipeline Diagram

```
CR Number Input
      │
      ▼
┌─────────────┐
│  Agent 1    │  Stealth browser → mc.gov.sa (Ministry of Commerce)
│  MC.gov.sa  │  AI CAPTCHA solve → Extract raw CR registry text
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Agent 2    │  Claude Sonnet → Parse CR fields from raw text
│  CR Parser  │  Fallback: Perplexity CR lookup if rawText empty
└──────┬──────┘
       │ (nameAr, nameEn extracted)
       ├─────────────────────────────────────┐
       ▼                                     ▼
┌─────────────┐                    ┌──────────────────┐
│  Agent 3    │                    │  Deep Research   │
│  Aamaly     │                    │  Compound Query  │
│  emagazine  │                    │  Gemini ×3       │
│  AOA search │                    │  Perplexity ×3   │
│  (stealth   │                    │  Claude ×1       │
│   browser + │                    │  OpenAI ×1       │
│   fallback) │                    │  (8 parallel)    │
└──────┬──────┘                    └────────┬─────────┘
       │ (AOA PDF URLs, articles)           │ (extraResearch text)
       └─────────────┬───────────────────────┘
                     ▼
              ┌─────────────┐
              │  Agent 4    │  Download + parse AOA PDF (pdf-parse)
              │  AOA Parser │  Claude extracts structured fields
              │             │  Falls back to deep research if no PDF
              └──────┬──────┘
                     │
                     ▼
              ┌─────────────┐
              │  Agent 5    │  HTTP → najiz.sa legal agency lookup
              │  Najiz.sa   │
              └──────┬──────┘
                     │
                     ▼
              ┌─────────────┐
              │  Agent 6    │  Claude → Cross-validate conflicts between
              │  Validator  │  MC.gov.sa, AOA, and Najiz data
              └──────┬──────┘
                     │
                     ▼
              ┌─────────────┐
              │  Agent 7    │  Claude (primary) + OpenAI (secondary)
              │  Bilingual  │  → Compile full EN + AR intelligence report
              │  Report     │
              └──────┬──────┘
                     │
                     ▼
              MasaarReport (streamed via SSE)
```

### MasaarReport Type

```typescript
interface MasaarReport {
  crNumber: string;
  fetchedAt: string;           // ISO timestamp
  stealthMode: boolean;        // true = AI CAPTCHA, false = manual
  sources: {
    mcGovSa: Record<string, unknown>;    // raw agent1 output
    emagazine: Record<string, unknown>;  // raw agent3 output
    najiz: Record<string, unknown>;      // raw agent5 output
  };
  parsed: {
    nameEn: string | null;
    nameAr: string | null;
    crNumber: string | null;
    legalForm: string | null;            // e.g. "LLC"
    legalFormAr: string | null;          // e.g. "ش.م.م"
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
      nameEn: string;
      nameAr: string;
      nationalId: string;
      ownershipPct: string;
      nationality: string;
    }>;
    managers: Array<{
      nameEn: string;
      nameAr: string;
      nationalId: string;
      appointmentTerm: string;
      powers: string;
    }>;
    boardComposition: string | null;
    shareTransferRestrictions: string | null;
    profitDistributionRules: string | null;
    dissolutionConditions: string | null;
    amendmentProcedures: string | null;
  };
  aoa: Record<string, unknown>;          // full raw AOA extraction
  legalAgencies: Array<Record<string, unknown>>;
  conflicts: Array<{
    field: string;
    source1: string; value1: string;
    source2: string; value2: string;
    severity?: string;           // "high" | "medium" | "low"
    recommendation?: string;
  }>;
  reportEn: string;             // Full markdown English report
  reportAr: string;             // Full markdown Arabic report
}
```

### Agent 2 — CR Field Parser (Claude)

Parses raw text from mc.gov.sa into structured fields. When `rawText` is empty (browser failed):
1. **Fallback 1**: Perplexity search for `"CR number XXXXXXXXXX Saudi Arabia company name"`
2. If both fail, Claude is asked to infer from the CR number alone

The parsed output populates `nameAr`/`nameEn` which gate all subsequent agents. If names are empty, `deepResearchCompany` queries fire against `"CR-XXXXXXXXXX"` (useless queries) — this is why the browser fallback is critical.

### Agent 3 — Aamaly Emagazine Search

Searches `emagazine.aamaly.sa` for the company's Articles of Association PDF.

**Fallback chain** (in order):
1. Stealth browser with human-behavior simulation, Cloudflare bypass
2. HTTP axios with Arabic browser headers to `https://emagazine.aamaly.sa/search?q=COMPANY_NAME`
3. Perplexity search for `site:emagazine.aamaly.sa "COMPANY_NAME" عقد تأسيس`

**Article scoring** (for AOA priority filtering):
- Score ≥ 4 → classified as AOA priority article
- Keywords that raise score: عقد تأسيس, نظام أساسي, مساهمون, shareholders, articles of association, founding contract

### Agent 4 — AOA PDF Parser

1. Downloads PDF from emagazine.aamaly.sa using axios
2. Parses Arabic text using `pdf-parse`
3. Sends up to 18,000 chars to Claude Sonnet for structured extraction
4. When no PDF found, uses `deepResearch` as primary source instead
5. Extracts: shareholders, managers, capital, legal form, fiscal year, transfer restrictions, dissolution conditions, profit rules

### Deep Research (runs in parallel with Agent 3)

8 parallel queries across all AI engines:

```
Gemini #1: Shareholders & ownership structure (Google Search grounding)
Gemini #2: Revenue, employees, founding year, capital (Google Search)
Gemini #3: Latest news 2024-2025 (Google Search)
Perplexity #1: General profile — website, phone, address, revenue
Perplexity #2: Executives — CEO, GM, CFO, board (EN+AR names)
Perplexity #3: Shareholders — names and ownership percentages
Claude: Comprehensive intelligence from training data
OpenAI GPT-4o: Financial & competitive intelligence
```

All 8 run via `Promise.allSettled`. Results are concatenated into a single string with section headers and passed to Agents 4 and 7.

### Name-Based Pipeline

When no CR number is available, `runMasaarPipelineByName(nameAr, nameEn, jobId)` skips Agents 1 and 2, using provided names to feed Agents 3–7 directly. Used when Masaar Database enriches a company that has no CR number.

---

## 4. Masaar — Database Harvester

### Purpose

Discovers and seeds Saudi companies from multiple data sources into the `masar_companies` table, then enriches each company with web data, financial estimates, and bilingual analysis.

### Harvester Architecture

```
POST /api/masar/database/harvest
{ keyword, sector, sources, customUrls }
         │
         ▼
  createHarvestJob(jobId)
         │
         ▼
  runHarvest(jobId, keyword, sources, customUrls, options)
         │
         ├─── "open-data" source ──────────────────────────────────────────┐
         │    harvestFromOpenData()                                         │
         │    • data.gov.sa CKAN API (Saudi Open Data)                     │
         │    • Wikipedia Categories (5 category pages)                     │
         │    • Wikipedia article extraction (infobox + intro text)         │
         │    • Custom URLs (user-provided external data sources)           │
         │    • GPT-4o → Claude → regex fallback for company extraction     │
         │    → upsert to masar_companies                                   │
         │                                                                  │
         └─── "amaaly-aoa" source ─────────────────────────────────────────┘
              harvestFromAmaaly()
              • Stealth browser → emagazine.aamaly.sa
              • HTTP fallback → axios with Arabic headers
              • Multi-page scraping (up to N pages)
              • AOA PDF download + pdf-parse
              • Claude → extract company name, shareholders, capital
              → upsert to masar_companies
```

### Data Sources

| Source ID | Target | Method |
|---|---|---|
| `open-data` | data.gov.sa CKAN API | JSON API → Claude parse |
| `open-data` | Wikipedia categories | HTML scrape + infobox parse |
| `amaaly-aoa` | emagazine.aamaly.sa | Stealth browser + PDF parse |
| Custom URL | User-supplied URLs | HTML fetch → GPT-4o/Claude parse |

### Company Extraction Flow (AI Parse Chain)

For each raw HTML/text page:
1. **Gemini** (if configured): `extractCompaniesWithGemini(text, keyword)` → JSON array
2. **Claude fallback**: `parseCompaniesWithClaude(text, keyword)` → JSON array
3. **Regex fallback**: `extractCompaniesViaRegex(text, keyword)` → basic name extraction

All results pass through `isValidCompanyName()` filter to reject CSS artifacts, sentences, and non-company strings.

### Enrichment Engine

After seeding, `enrichMasarCompany(companyId)` runs on each company:

```
enrichMasarCompany(id)
       │
       ├── 1. Crawl4AI → company website (JS-rendered, async)
       │       → Extract text, emails, phones
       │
       ├── 2. Perplexity search (4 parallel queries):
       │       → General profile (website, phone, address)
       │       → Financial data (revenue SAR, employees, capital)
       │       → Ownership (shareholders, AOA data)
       │       → Leadership (CEO, board, executives)
       │
       ├── 3. GPT-4o synthesis:
       │       → Structured enrichment JSON
       │       → Revenue estimate + rationale
       │       → Employee count, industry, contacts
       │
       └── 4. Claude bilingual analysis:
               → Markdown English report (analysisEn)
               → Markdown Arabic report (analysisAr)
               → Risk factors, growth indicators, data quality score
```

A semaphore limits concurrent enrichment to max 3 parallel jobs to avoid API rate limits.

### Upsert Logic

```
If crNumber present:
  → INSERT ... ON CONFLICT (cr_number) DO UPDATE
    (uses COALESCE to keep existing non-null values)

If no crNumber:
  → Check for existing row by nameEn OR nameAr
  → If found: return existing id (no duplicate)
  → If not found: INSERT fresh
```

**Deletion blocklist**: When a user deletes a company, it's added to a blocklist (`deleted_companies` table). `isBlocked()` prevents re-seeding deleted companies during subsequent harvests.

### Harvest Job Events (SSE)

```typescript
interface HarvestEvent {
  type: "log" | "company_found" | "company_enriched" | "progress" | "complete" | "error";
  message?: string;
  level?: "info" | "success" | "warn" | "error";
  company?: CompanyData;
  count?: number;
  total?: number;
  error?: string;
}
```

### Pipeline Enrichment (7-Agent on existing companies)

`POST /api/masar/database/companies/:id/pipeline-enrich` runs the full 7-agent Masaar pipeline on a company already in the database:

1. Reads the company's CR number (or asks Claude to find it from the name)
2. Creates a pipeline job
3. Chooses CR-based (`runMasaarPipeline`) or name-based (`runMasaarPipelineByName`) mode
4. On `job_complete`: maps pipeline data back into `masar_companies` (only fills blank fields — never overwrites existing data)
5. Filters out undisclosed/placeholder names before saving shareholders and management

---

## 5. ProsEngine — Person Intelligence

### Purpose

Given a person's name (and optionally company, title, LinkedIn URL), builds a comprehensive intelligence dossier with career, education, wealth, board memberships, and approach strategy.

### Research Engine (20 Parallel Agents)

All 20 agents fire simultaneously via `Promise.allSettled`:

```
PERPLEXITY (9 web search threads):
  #1  Professional background & career history
  #2  Company intelligence (deep-dive on employer)
  #3  Education & academic history
  #4  Wealth profile & financial indicators
  #5  Board memberships & advisory roles
  #6  Executive compensation benchmarks
  #7  Personal profile & interests
  #8  Latest news 2024-2025
  #9  LinkedIn URL discovery

CRAWL AGENTS (2):
  #10  LinkedIn profile page crawl (if URL provided)
  #11  Company website team/about/leadership pages

EXTERNAL API AGENTS (2):
  #12  Apollo.io person lookup (name, company, title)
  #13  Explorium firmographic lookup

GEMINI AGENTS (4 — Google Search grounded):
  Agent A  Career & professional history
  Agent B  LinkedIn URL + social media discovery
  Agent C  Company context & recent news
  Agent D  Comprehensive deep dossier

AI KNOWLEDGE AGENTS (2):
  Agent E  Claude Sonnet — training data knowledge
  Agent F  GPT-4o — training data knowledge

DEEP RESEARCH (sequential, after parallel batch):
  o4-mini DeepResearch — web search with tool use
```

### Synthesis

After all 20 agents complete, synthesis runs **in parallel**:

1. **Gemini** (`synthesizeWithGemini` — grounded search synthesis) — primary
2. **Claude Sonnet** (30s timeout, 4000 tokens) — secondary
3. **GPT-4o** (30s timeout, 4000 tokens) — tertiary

First valid JSON result wins (Gemini → Claude → GPT-4o).

### Person Intel Report Structure

```typescript
{
  profile: {
    fullName: string;
    arabicName: string;         // Arabic name or "Not found"
    title: string;
    company: string;
    nationality: string;
    location: string;
    age: number | null;
    linkedin: string;           // LinkedIn URL or "Not found"
  };
  career: Array<{
    company: string;
    title: string;
    period: string;             // "YYYY – YYYY" or "YYYY – Present"
    description: string;        // specific achievements from research
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
    estimated_net_worth: string;
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
    recommended_approach: string;  // 3-4 paragraph tailored strategy
    sample_message: string;         // ready-to-send first outreach
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

### Storage Schema (prosengine_research)

```sql
CREATE TABLE prosengine_research (
  id            SERIAL PRIMARY KEY,
  person_name   TEXT NOT NULL,
  company       TEXT,
  title         TEXT,
  linkedin_url  TEXT,
  seller_context    TEXT,       -- JSON string
  intelligence_goals TEXT,      -- JSON string
  known_facts   TEXT,
  report        TEXT,           -- JSON string of full report
  tags          TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### API Endpoints — Person Intelligence

```
POST   /api/person-intel/profile          Run full intelligence pipeline
POST   /api/person-intel/save             Save report to database
GET    /api/person-intel/saved            List saved reports (desc order)
DELETE /api/person-intel/saved/:id        Delete saved report
```

#### POST /api/person-intel/profile

**Request body:**
```typescript
{
  name: string;                           // required
  company?: string;
  title?: string;
  linkedinUrl?: string;                   // if known, crawled directly
  websiteUrl?: string;                    // company website for team page crawl
  country?: string;                       // default "Saudi Arabia"
  sellerContext?: {
    companyName?: string;
    product?: string;
    objective?: string;
    objectives?: string[];
  };
  intelligenceGoals?: string[];           // e.g. ["wealth", "career"]
  knownFacts?: string;                    // pre-known information to include
}
```

**Response:** Full person intelligence JSON object (structure above).

---

## 6. ProsEngine — Company Intelligence

### Purpose

Given a company name (and optionally website, CR number, city), builds a structured company intelligence dossier covering profile, financials, ownership, leadership, operations, market position, approach strategy, and recent news.

### Research Engine (11 Parallel Agents)

```
STEALTH CRAWL:
  Stealth browser → company website (StealthBrowser + crawl4ai fallback)
  Extracts text (6000 chars), emails, phone numbers

GEMINI (4 — Google Search grounded):
  #1  Full company profile (website, contacts, CR, capital, employees)
  #2  Ownership & shareholders (mc.gov.sa, emagazine.aamaly.sa, news)
  #3  Leadership & executives (CEO, board, EN+AR names)
  #4  Competitive intelligence (market share, clients, news)

PERPLEXITY (4 web searches):
  #1  General profile & contact
  #2  Financial intelligence (revenue, profit, capital)
  #3  Ownership & AOA data
  #4  Leadership

AI KNOWLEDGE:
  Claude Sonnet (30s timeout, 2000 tokens)
  GPT-4o (25s timeout, 1500 tokens)
```

### Synthesis

Runs Claude and Gemini (`generateWithGemini` — pure text generation) **in parallel**:
- Claude: 90-second timeout, 6000 tokens — primary
- Gemini: 60-second timeout — secondary

First valid JSON wins. Both can fail gracefully — returns a minimal stub report with `executiveSummary` explaining the failure.

### Company Intel Report Structure

```typescript
{
  profile: {
    nameEn: string;
    nameAr: string;
    legalForm: string;         // "LLC" / "JSC" / etc
    legalFormAr: string;       // "ش.م.م" / etc
    crNumber: string | null;
    founded: string | null;
    city: string | null;
    address: string | null;
    website: string | null;
    phone: string | null;
    email: string | null;
    industry: string | null;
    mainActivity: string;
    mainActivityAr: string;
  };
  financials: {
    revenueEstimate: string | null;   // "SAR X million"
    revenueRange: string | null;      // "SAR 10M-50M"
    revenueRationale: string;         // how estimate was derived
    employeeCount: string | null;
    paidUpCapital: string | null;
    profitabilityIndicator: string;   // "Profitable" / "Loss-making" / etc
    growthSignals: string[];
    recentFinancialNews: string | null;
  };
  ownership: {
    structure: string | null;         // "Family-owned" / "State-owned" / etc
    shareholders: Array<{
      nameEn: string;
      nameAr: string;
      ownershipPct: string;
      nationality: string;
      type: string;                   // "Individual" / "Corporate"
    }>;
    isPubliclyListed: boolean;
    stockExchange: string | null;
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
    keyClients: string[];
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
    entryPoint: string;
    valueProp: string;
    openingAngle: string;
    potentialObjections: string[];
    culturalNotes: string;
    sampleMessage: string;
  };
  news: Array<{
    title: string;
    date: string;
    summary: string;
    source: string;
  }>;
  intelligence: {
    confidenceScore: number;        // 0-100
    dataQuality: "high" | "medium" | "low";
    verifiedFacts: string[];
    estimatedFacts: string[];
    caveats: string;
    dataSources: string[];
  };
  executiveSummary: string;         // 2-3 paragraph English summary
}
```

### Storage Schema (company_intel_research)

```sql
CREATE TABLE company_intel_research (
  id                SERIAL PRIMARY KEY,
  company_name      TEXT NOT NULL,
  website           TEXT,
  cr_number         TEXT,
  city              TEXT,
  seller_context    TEXT,           -- JSON string
  intelligence_goals TEXT,          -- JSON string
  known_facts       TEXT,
  report            TEXT,           -- JSON string of full report
  tags              TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### API Endpoints — Company Intelligence

```
POST   /api/company-intel/profile         Run full intelligence pipeline
POST   /api/company-intel/save            Save report to database
GET    /api/company-intel/saved           List saved reports
DELETE /api/company-intel/saved/:id       Delete saved report
```

#### POST /api/company-intel/profile

**Request body:**
```typescript
{
  companyName: string;                    // required
  website?: string;                       // company website URL
  crNumber?: string;                      // 10-digit Saudi CR number
  city?: string;
  sellerContext?: {
    companyName?: string;
    product?: string;
    objectives?: string[];
  };
  intelligenceGoals?: string[];           // ["profile","financials","ownership","leadership","market","approach"]
  knownFacts?: string;                    // pre-known information
}
```

**Response:** Full company intelligence JSON object (structure above).

---

## 7. Database Schemas

### masar_companies

The core Masaar database. Never written by OrcBase, Prospecting, Builder, or Company Intel.

```sql
CREATE TABLE masar_companies (
  id                  SERIAL PRIMARY KEY,
  name_en             TEXT,
  name_ar             TEXT,
  cr_number           TEXT UNIQUE,          -- 10-digit CR, DB-level conflict key
  legal_form          TEXT,                 -- "Limited Liability Company" etc
  legal_form_ar       TEXT,                 -- "ش.م.م" etc
  city                TEXT,
  city_ar             TEXT,
  region              TEXT,
  paid_up_capital     TEXT,                 -- "5,000,000 SAR"
  authorized_capital  TEXT,
  founding_date       TEXT,
  founding_year       TEXT,                 -- "YYYY"
  registration_date   TEXT,
  expiry_date         TEXT,
  authorized_signatory TEXT,
  shareholders        JSONB DEFAULT '[]',   -- Array<{ nameEn, nameAr, nationalId, ownershipPct, nationality }>
  board_of_directors  JSONB DEFAULT '[]',   -- Array<{ nameEn, nameAr, role, nationalId? }>
  management          JSONB DEFAULT '[]',   -- Array<{ nameEn, nameAr, title, nationalId?, powers? }>
  main_activity       TEXT,
  main_activity_ar    TEXT,
  registration_status TEXT,
  source              TEXT DEFAULT 'open-data',
  source_url          TEXT,
  enrichment_status   TEXT DEFAULT 'pending',  -- "pending"|"enriching"|"enriched"|"failed"
  website             TEXT,
  phone               TEXT,
  email               TEXT,
  address             TEXT,
  employee_count      TEXT,
  revenue_estimate    TEXT,
  revenue_rationale   TEXT,
  news_headlines      JSONB DEFAULT '[]',   -- Array<{ title, date, source? }>
  enrichment_data     JSONB DEFAULT '{}',
  analysis_en         TEXT,                 -- Full markdown English analysis
  analysis_ar         TEXT,                 -- Full markdown Arabic analysis
  analysis_data       JSONB DEFAULT '{}',   -- { riskFactors, growthIndicators, dataQuality, confidenceScore }
  capital_distribution TEXT,
  profit_distribution_rules TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  enriched_at         TIMESTAMPTZ
);
```

### masar_harvest_jobs

```sql
CREATE TABLE masar_harvest_jobs (
  id                SERIAL PRIMARY KEY,
  job_id            TEXT NOT NULL UNIQUE,
  keyword           TEXT NOT NULL,
  source            TEXT NOT NULL,
  status            TEXT DEFAULT 'running',    -- "running"|"complete"|"failed"
  companies_found   INTEGER DEFAULT 0,
  companies_enriched INTEGER DEFAULT 0,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);
```

### prosengine_research

```sql
CREATE TABLE prosengine_research (
  id                SERIAL PRIMARY KEY,
  person_name       TEXT NOT NULL,
  company           TEXT,
  title             TEXT,
  linkedin_url      TEXT,
  seller_context    TEXT,       -- JSON string
  intelligence_goals TEXT,      -- JSON string
  known_facts       TEXT,
  report            TEXT,       -- JSON string
  tags              TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### company_intel_research

```sql
CREATE TABLE company_intel_research (
  id                SERIAL PRIMARY KEY,
  company_name      TEXT NOT NULL,
  website           TEXT,
  cr_number         TEXT,
  city              TEXT,
  seller_context    TEXT,       -- JSON string
  intelligence_goals TEXT,      -- JSON string
  known_facts       TEXT,
  report            TEXT,       -- JSON string
  tags              TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### masar_custom_sources

```sql
CREATE TABLE masar_custom_sources (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 8. Complete API Reference

### Masaar Pipeline

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/masaar/start` | Start 7-agent pipeline by CR number |
| `GET` | `/api/masaar/stream/:jobId` | SSE stream of agent events |
| `POST` | `/api/masaar/captcha/:jobId` | Submit CAPTCHA solution (manual mode) |

#### POST /api/masaar/start

```typescript
// Request
{ crNumber: string; stealthMode?: boolean }  // stealthMode defaults to true

// Response
{ jobId: string; crNumber: string; stealthMode: boolean; message: string }
```

#### POST /api/masaar/captcha/:jobId

```typescript
// Request
{ captchaText: string; captchaFor: "mc_gov_sa" | "emagazine" }

// Response
{ ok: true; message: string }
```

### Masaar Database

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/masar/database/harvest` | Start harvest job |
| `GET` | `/api/masar/database/stream/:jobId` | SSE stream of harvest events |
| `GET` | `/api/masar/database/companies` | Paginated company list with filters |
| `GET` | `/api/masar/database/companies/:id` | Single company detail |
| `DELETE` | `/api/masar/database/companies/:id` | Delete company (adds to blocklist) |
| `DELETE` | `/api/masar/database/companies/bulk` | Bulk delete (body: `{ ids: number[] }`) |
| `POST` | `/api/masar/database/companies/:id/re-enrich` | Lightweight re-enrichment |
| `POST` | `/api/masar/database/companies/:id/pipeline-enrich` | Full 7-agent pipeline enrichment |
| `POST` | `/api/masar/database/enrich-all` | Bulk enrich (body: `{ mode: "pending"|"all" }`) |
| `GET` | `/api/masar/database/export` | Export (CSV/Excel/HTML) |

#### POST /api/masar/database/harvest

```typescript
// Request
{
  companyName?: string;
  keyword?: string;
  sector?: string;
  instructions?: string;
  parameters?: { city?: string; legalForm?: string; size?: string; revenue?: string };
  sources?: string[];         // ["open-data", "amaaly-aoa"] — default ["open-data"]
  source?: string;            // legacy single source
  customUrls?: string[];      // direct URLs to scrape
}

// Response
{ jobId: string; keyword: string; sources: string[]; customUrls: string[] }
```

#### GET /api/masar/database/companies

Query params: `page`, `limit`, `search`, `city`, `enrichmentStatus`, `source`, `legalForm`

Response:
```typescript
{
  companies: MasaarCompany[];
  pagination: { page: number; limit: number; total: number; pages: number };
}
```

#### GET /api/masar/database/export

Query params: `format` (`csv` | `xlsx` | `html`), `search`, `ids` (comma-separated)

### Person Intelligence

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/person-intel/profile` | Run full 20-agent pipeline |
| `POST` | `/api/person-intel/save` | Save report to DB |
| `GET` | `/api/person-intel/saved` | List saved reports |
| `DELETE` | `/api/person-intel/saved/:id` | Delete saved report |

### Company Intelligence

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/company-intel/profile` | Run full 11-agent pipeline |
| `POST` | `/api/company-intel/save` | Save report to DB |
| `GET` | `/api/company-intel/saved` | List saved reports |
| `DELETE` | `/api/company-intel/saved/:id` | Delete saved report |

---

## 9. SSE Streaming Protocol

Both the Masaar pipeline and the Harvester use Server-Sent Events (SSE) for real-time progress.

### SSE Connection Setup (Client)

```typescript
const eventSource = new EventSource(`/api/masaar/stream/${jobId}`);

eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data) as AgentEvent;

  switch (event.type) {
    case "agent_start":
      // event.agentNum, event.agentName
      break;
    case "agent_log":
      // event.agentNum, event.agentName, event.message
      break;
    case "agent_complete":
      // event.agentNum, event.agentName, event.data
      break;
    case "captcha_required":
      // event.captchaFor, event.captchaScreenshot (base64), event.captchaLabel
      // Show image to user, collect text, POST to /api/masaar/captcha/:jobId
      break;
    case "stealth_solving":
      // AI is attempting to solve the CAPTCHA
      break;
    case "stealth_solved":
      // event.stealthMethod ("ai" | "human"), event.captchaCode
      break;
    case "job_complete":
      // event.report — full MasaarReport object
      eventSource.close();
      break;
    case "job_error":
      // event.message
      eventSource.close();
      break;
  }
};
```

### AgentEvent Type

```typescript
interface AgentEvent {
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
  agentNum?: number;         // 1-7
  agentName?: string;
  message?: string;
  data?: Record<string, unknown>;
  report?: MasaarReport;     // populated on job_complete
  captchaFor?: string;       // "mc_gov_sa" | "emagazine"
  captchaScreenshot?: string;// base64 PNG
  captchaLabel?: string;
  stealthMethod?: "ai" | "human" | "session";
  captchaCode?: string;
}
```

### Job Lifecycle

- Jobs are held in memory (`Map<jobId, JobState>`) with 45-minute TTL
- Heartbeat `: heartbeat\n\n` sent every 15 seconds to keep connection alive
- On `job_complete` or `job_error`, a 2-second delay before cleanup (ensures client receives final event)
- Job IDs are `randomUUID()` — generate on client, pass in POST response

---

## 10. CAPTCHA Handling Architecture

### Two Modes

**Stealth Mode** (default, `stealthMode: true`):
1. AI Vision (Claude) reads the CAPTCHA image — up to 3 attempts
2. If AI fails after 3 attempts, falls back to manual human input
3. Browser screenshot is sent via SSE as `captchaScreenshot` (base64 PNG)

**Manual Mode** (`stealthMode: false`):
1. CAPTCHA screenshot sent via SSE immediately
2. Frontend displays image, user types the code
3. Client POSTs to `/api/masaar/captcha/:jobId` with `{ captchaText, captchaFor }`

### CAPTCHA Resolver Pattern

```typescript
// Server creates a promise, resolver stored in Map
state.captchaResolvers.set(captchaFor, (text) => resolve(text));

// SSE fires captcha_required event with screenshot
emit(emitter, { type: "captcha_required", captchaFor, captchaScreenshot, captchaLabel });

// Client POSTs the solution → server calls resolver
submitCaptcha(jobId, captchaFor, captchaText)
// → resolver(text) is called → promise resolves → pipeline continues
```

Timeout: 3 minutes (180,000ms). After timeout, the resolver is cleaned up and an error is thrown.

---

## 11. Stealth Browser Architecture

`StealthBrowser` wraps Playwright Chromium with anti-detection measures:

### Browser Launch Priority

```
1. which chromium (system binary found via PATH)
2. Playwright bundled Chromium (executablePath())
```

### Anti-Detection Features

- Random user agent rotation
- `navigator.webdriver = false` injection
- Chrome plugin simulation (mimeTypes, plugins)
- `navigator.languages`, `navigator.permissions`, `navigator.hardwareConcurrency` spoofing
- Canvas fingerprint randomization
- WebGL vendor spoofing

### HumanBehavior Simulation

```typescript
HumanBehavior.idle(minMs, maxMs)  // random delay between min and max
// Used throughout pipeline to simulate human reading/thinking time
```

### Cloudflare Detection & Bypass

```typescript
await stealthBrowser.detectChallenge()  // returns "cloudflare" | "recaptcha" | "hcaptcha" | null
await stealthBrowser.waitForCloudflare(timeoutMs)  // waits up to 25s for challenge to clear
```

### Key Methods

```typescript
class StealthBrowser {
  start(domain?: string): Promise<void>      // launch + setup + optional domain navigate
  goto(url, options?): Promise<void>         // navigate with Cloudflare detection
  getContent(): Promise<string>              // full page HTML
  screenshot(returnBase64?: boolean): Promise<string>
  humanType(selector, text): Promise<void>  // type with random delays
  fillFirst(selectors, value): Promise<boolean>
  clickFirst(selectors): Promise<boolean>
  detectChallenge(): Promise<string | null>
  waitForCloudflare(timeoutMs?): Promise<void>
  stop(): Promise<void>
  newPage(): Promise<Page>                  // for Company Intel website crawl
  page?: Page                               // direct Playwright page access
}
```

### Browser Unavailability Fallback

When the browser fails to launch (Playwright Chromium has runtime issues in some environments), agents fall back automatically:

- **Agent 3 (Aamaly)**: HTTP axios → Perplexity
- **Agent 1 (mc.gov.sa)**: Perplexity CR lookup in Agent 2

---

## 12. Key Engineering Rules & Invariants

### Table Ownership

| Table | Owned by | Never written by |
|---|---|---|
| `companies` | OrcBase | Masaar, Builder, Prospecting, Company Intel |
| `masar_companies` | Masaar Harvester | OrcBase, Prospecting, Company Intel |
| `prosengine_research` | ProsEngine / Person Intel | Anyone else |
| `company_intel_research` | Company Intel | Anyone else |

### AI Priority Order

Always: **Gemini first → Claude second → GPT-4o third**

### OpenAI Token Param

Always use `max_completion_tokens`. **Never** use `max_tokens` with OpenAI.

### Gemini Return Types

```
searchWithGemini()       → string | null          ✓ can call .match()
generateWithGemini()     → string | null          ✓ can call .match()
deepResearchWithGemini() → {text, groundingChunks} | null  ✗ NEVER call .match() directly
synthesizeWithGemini()   → string | null          ✓ can call .match()
```

### Enrichment Status Flow

```
"pending" → "enriching" → "enriched"
                       ↘ "failed"
```

Bulk enrich in `"pending"` mode also picks up `"failed"` and `"enriched"` companies with no shareholders (empty array check).

### Blocklist

Deleted companies are written to `deleted_companies` table. `isBlocked()` is checked in `upsertMasarCompany` before any insert — deleted companies are never re-seeded.

### CR Number Format

Saudi CR numbers are 10-digit numbers starting with `1` (e.g. `1010123456`). The validation regex: `/^\d{7,12}$/`. For pipeline-enrich CR lookup via Claude, the extraction regex is `/\b1\d{9}\b/`.

### SSE Headers (required)

```typescript
res.setHeader("Content-Type", "text/event-stream");
res.setHeader("Cache-Control", "no-cache");
res.setHeader("Connection", "keep-alive");
res.setHeader("X-Accel-Buffering", "no");  // required for Nginx proxy
res.flushHeaders();
```

### Job Timeout

Masaar pipeline jobs expire after **45 minutes**. Harvest jobs expire after **30 minutes**. Both use `setTimeout` + `Map.delete` for cleanup.

### Perplexity Search Configuration

```typescript
{
  model: "sonar",
  temperature: 0.1,
  return_citations: true,
  max_tokens: 2000,         // configurable per call
}
```

System prompt for all Masaar/ProsEngine Perplexity calls: `"You are a Saudi Arabia B2B intelligence analyst specializing in corporate data mining. Provide precise, factual verified data. Include full names in both Arabic and English."`
