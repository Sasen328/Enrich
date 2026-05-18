# Masaar Engine — 5-Agent Corporate Intelligence Pipeline

**Source file:** `artifacts/api-server/src/lib/masaar-engine.ts` (1,782 lines)

The Masaar Engine is a fully autonomous 5-agent pipeline. Give it a Saudi CR number or Arabic company name — it runs every agent in sequence/parallel, auto-solves CAPTCHAs, scrapes AOA PDFs, fires 12 research engines simultaneously, checks 9 compliance databases, and compiles a full bilingual report in English and Arabic.

---

## Pipeline Diagram

```
Input: CR Number
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENT 1  —  MC.gov.sa Registry                                        │
│                                                                         │
│  Sub-step 1a: Stealth browser → mc.gov.sa                              │
│    Playwright + full human fingerprint (random UA, viewport, typing)    │
│    CAPTCHA detection → 3 attempts:                                      │
│      Stealth mode:  screenshot → base64 → Claude Vision solves → types │
│      Manual mode:  emits captcha_required → waits submitCaptcha()       │
│    Fallback after 3 failures: emits captcha_required for human          │
│    Human timeout: 120 seconds before pipeline aborts                    │
│                                                                         │
│  Sub-step 1b: Claude Sonnet parses raw HTML → structured fields        │
│    Outputs: nameAr ← PRIMARY (feeds Agents 2 & 3)                     │
│    Also: nameEn, legalForm, legalFormAr, headquarterCity,              │
│           foundingYear, capitalAmount, mainActivity,                    │
│           managers[], shareholders[], registrationDate,                 │
│           expiryDate, registrationStatus, authorizedSignatory           │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │  nameAr + nameEn
                         ┌───────────┴───────────┐  ← run in PARALLEL
                         ▼                       ▼
┌─────────────────────────────┐   ┌──────────────────────────────────────┐
│  AGENT 2                    │   │  AGENT 3                             │
│  Amaaly AOA Intelligence    │   │  Deep Research Intelligence           │
│                             │   │  ALWAYS fires — even when AOA found  │
│  1. Stealth browser on      │   │                                      │
│     emagazine.aamaly.sa     │   │  12 engines in parallel:             │
│  2. Search using nameAr     │   │                                      │
│  3. Traverse up to 6 pages  │   │  Perplexity × 5 (sonar):            │
│  4. Score each result by    │   │    P1 – Company overview             │
│     name match + recency    │   │    P2 – Ownership + shareholders     │
│  5. Select highest-scored   │   │    P3 – Leadership (CEO/board EN+AR) │
│     AOA PDF                 │   │    P4 – Market + financials          │
│  6. Download PDF bytes      │   │    P5 – Legal + news flags           │
│  7. OCR Arabic text         │   │                                      │
│     (pdf.js / raw bytes)    │   │  Gemini × 4 (gemini-2.5-flash       │
│  8. Claude translates &     │   │    + Google Search grounded):        │
│     structures all fields   │   │    GA – Full profile                 │
│                             │   │    GB – Ownership & AOA              │
│  Output fields:             │   │    GC – Leadership                   │
│  shareholders[]             │   │    GD – News & activity 2023-2025    │
│  managers[]                 │   │                                      │
│  boardOfDirectors[]         │   │  Claude Sonnet — training knowledge  │
│  capitalAmount              │   │  GPT-4o — financial intelligence     │
│  capitalDistribution        │   │    (max_completion_tokens)           │
│  boardComposition           │   │                                      │
│  shareTransferRestrictions  │   │  Stub agents (env var activates):    │
│  profitDistributionRules    │   │    OPENROUTER_API_KEY → DeepSeek-R1  │
│  dissolutionConditions      │   │    OPENROUTER_API_KEY → Llama-3.3    │
│  amendmentProcedures        │   │    OPENROUTER_API_KEY → Kimi         │
│  contactDetails             │   │    GROQ_API_KEY → Llama-3.3-70B-V   │
└──────────────┬──────────────┘   └────────────────────────┬─────────────┘
               └────────────────────────┬───────────────────┘
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENT 4  —  Compliance & Sanctions                                    │
│                                                                         │
│  International Sanctions (3 checks):                                   │
│    OFAC SDN      → US Treasury REST API → Perplexity fallback          │
│    UN SC         → Perplexity search                                   │
│    EU Cons. List → sanctionsmap.eu API → Perplexity fallback           │
│                                                                         │
│  Saudi Regulatory (5 checks):                                          │
│    CMA   → Perplexity (capital market violations)                      │
│    SAMA  → Perplexity (banking/insurance penalties)                    │
│    ZATCA → Perplexity (tax violations)                                 │
│    Maroof.sa → HTTP verification API (active business registry)        │
│    Najiz.sa  → HTTP scrape (legal agency records, court filings)       │
│                                                                         │
│  News Flags (1 check):                                                 │
│    Gemini (primary) + Perplexity (secondary)                           │
│    Queries: fraud, corruption, lawsuits, blacklisting, sanctions       │
│                                                                         │
│  Output: overallRisk (low|medium|high|unknown)                         │
│          riskSummary + per-source structured results                   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENT 5  —  Bilingual Report Compiler                                 │
│                                                                         │
│  11 sections in both English and Arabic:                               │
│    1. Company Overview          7. Deep Research Intelligence           │
│    2. Registration Details      8. Compliance & Risk                   │
│    3. Capital Structure         9. Market Intelligence                 │
│    4. Shareholders & Ownership  10. Contact Information                │
│    5. Management & Board        11. Executive Summary                  │
│    6. AOA Governance                                                    │
│                                                                         │
│  Synthesis:  Claude Sonnet (primary, max_tokens: 8192)                 │
│              GPT-4o (fallback, max_completion_tokens: 8192)            │
└─────────────────────────────────────────────────────────────────────────┘
                     │
                     ▼
         emit { type: "job_complete", report: MasaarReport }
```

---

## Two Pipeline Entry Points

### CR-Based (standard)
```typescript
runMasaarPipeline(crNumber: string, jobId: string): Promise<void>
```
All 5 agents run in full. Agent 1 browsers mc.gov.sa using the CR number. `nameAr` from Agent 1 is passed to Agents 2 and 3.

### Name-Based (no CR number)
```typescript
runMasaarPipelineByName(nameAr: string, nameEn: string, jobId: string): Promise<void>
```
Skips the mc.gov.sa browser. Agent 1 emits a stub (agent_start + agent_complete) so the UI pipeline remains consistent. Agents 2–5 run identically. Used by `pipeline-enrich` when a company in the database has no CR number.

---

## Job Management API

### Create job
```typescript
createJob(jobId: string, stealthMode = true): EventEmitter
```
Creates an in-memory job entry. Returns an EventEmitter. Jobs auto-expire after 30 minutes.
- `stealthMode = true` → Claude Vision auto-solves CAPTCHAs (default in all DB pipeline enrichment calls)
- `stealthMode = false` → pipeline pauses and emits `captcha_required` for human input

### Get event emitter
```typescript
getJobEmitter(jobId: string): EventEmitter | undefined
```
Returns the job's EventEmitter. Use `emitter.on("event", handler)` to subscribe to pipeline events.

### Submit human CAPTCHA
```typescript
submitCaptcha(jobId: string, captchaFor: string, captchaText: string): boolean
```
Called by the UI when a human solves the CAPTCHA. Unblocks the pipeline. Returns `false` if the job is not found.

---

## SSE Event Stream

**Route:** `GET /api/masaar/stream/:jobId`
**Content-Type:** `text/event-stream`
**Heartbeat:** `: heartbeat` every 15 seconds to keep connection alive

### AgentEvent type
```typescript
interface AgentEvent {
  type:
    | "agent_start"        // { agentNum: number, agentName: string }
    | "agent_log"          // { agentNum?: number, agentName?: string, message: string }
    | "agent_complete"     // { agentNum: number, agentName: string, data: Record<string,unknown> }
    | "agent_error"        // { agentNum: number, agentName: string, error: string }
    | "captcha_required"   // { captchaFor: string, imageBase64: string }
    | "captcha_solved"     // { captchaFor: string }
    | "job_complete"       // { report: MasaarReport }
    | "job_error";         // { message: string }
  agentNum?: number;
  agentName?: string;
  message?: string;
  error?: string;
  report?: MasaarReport;
  data?: Record<string, unknown>;
  captchaFor?: string;
  imageBase64?: string;
}
```

### Pipeline event sequence (happy path)
```
agent_start       agentNum:1  "MC.gov.sa Registry"
agent_log         agentNum:1  "Navigating to mc.gov.sa..."
agent_log         agentNum:1  "CAPTCHA detected..."
agent_log         agentNum:1  "Claude Vision solved CAPTCHA: XXXX"
agent_log         agentNum:1  "Claude parsing CR fields..."
agent_complete    agentNum:1  data: { nameAr, nameEn, crNumber, ... }
agent_start       agentNum:2  "Amaaly AOA Intelligence"
agent_start       agentNum:3  "Deep Research Intelligence"
  ...logs from both agents firing in parallel...
agent_complete    agentNum:2  data: { shareholders, managers, ... }
agent_complete    agentNum:3  data: { researchSummary }
agent_start       agentNum:4  "Compliance & Sanctions"
  ...compliance check logs...
agent_complete    agentNum:4  data: { overallRisk: "low", ... }
agent_start       agentNum:5  "Bilingual Report Compiler"
agent_log         agentNum:5  "Compiling 11-section EN+AR report..."
agent_complete    agentNum:5  data: { reportEn, reportAr }
job_complete                  report: MasaarReport (full)
```

### CAPTCHA flow (manual mode)
```
agent_log         agentNum:1  "CAPTCHA detected — emitting for human input"
captcha_required              { captchaFor: "mc.gov.sa", imageBase64: "..." }
  ... UI shows CAPTCHA image, user types solution ...
  ... UI calls POST /api/masaar/captcha { jobId, captchaFor, captchaText } ...
captcha_solved                { captchaFor: "mc.gov.sa" }
agent_log         agentNum:1  "CAPTCHA submitted, resuming..."
```

---

## MasaarReport — Full Type Definition

```typescript
interface MasaarReport {
  crNumber: string;
  fetchedAt: string;           // ISO 8601 timestamp
  stealthMode: boolean;

  sources: {
    mcGovSa: Record<string, unknown>;    // Raw Agent 1 CR fields
    emagazine: Record<string, unknown>;  // Raw Agent 2 AOA result
    najiz: {
      agencies: unknown[];
      found: boolean;
    };
  };

  parsed: {
    nameEn: string;
    nameAr: string;
    crNumber: string;
    legalForm: string;
    legalFormAr: string;
    headquarterCity: string;
    headquarterCityAr: string;
    foundingYear: string;
    fiscalYear: string;
    capitalAmount: string;
    capitalDistribution: string;
    estimatedRevenue: string;
    summaryEn: string;
    summaryAr: string;
    contactDetails: Record<string, string>;  // phone, email, website, address
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
    boardComposition: string;
    shareTransferRestrictions: string;
    profitDistributionRules: string;
    dissolutionConditions: string;
    amendmentProcedures: string;
  };

  aoa: Record<string, unknown>;   // Full raw AOA extracted fields from Agent 2 OCR

  compliance: ComplianceResult;   // Full Agent 4 result

  legalAgencies: Array<Record<string, unknown>>;  // Najiz court/agency records
  conflicts: unknown[];

  reportEn: string;               // Full English narrative report (Agent 5)
  reportAr: string;               // Full Arabic narrative report (Agent 5)
}
```

---

## ComplianceResult — Full Type Definition

```typescript
interface ComplianceResult {
  overallRisk: "low" | "medium" | "high" | "unknown";
  riskSummary: string;

  internationalSanctions: {
    ofac: {
      listed: boolean;
      matches: unknown[];
      source: string;     // "treasury-api" | "perplexity-fallback"
    };
    unSecurityCouncil: {
      listed: boolean;
      details: string;
    };
    euConsolidated: {
      listed: boolean;
      details: string;
    };
  };

  saudiRegulatory: {
    cma:   { compliant: boolean; details: string };
    sama:  { compliant: boolean; details: string };
    zatca: { compliant: boolean; details: string };
    maroof: {
      verified: boolean;
      rating: string;
      details: string;
    };
    najiz: {
      found: boolean;
      agencies: unknown[];
      details: string;
    };
  };

  newsFlags: {
    flagged: boolean;
    findings: string[];
    summary: string;
  };
}
```

### Risk scoring logic
| Overall Risk | Conditions |
|-------------|-----------|
| `"high"` | Any sanctions list match OR ≥2 negative news findings |
| `"medium"` | Any Saudi regulatory issue OR 1 news flag |
| `"low"` | All 9 checks clean |
| `"unknown"` | All checks returned no data or failed |

---

## API Routes

```
POST /api/masaar/start
  Body: { crNumber: string, stealthMode?: boolean }
  Returns: { jobId: string, message: string }

POST /api/masaar/captcha
  Body: { jobId: string, captchaFor: string, captchaText: string }
  Returns: { ok: boolean }

GET /api/masaar/stream/:jobId
  Returns: text/event-stream of AgentEvent objects

POST /api/masar/database/companies/:id/pipeline-enrich
  (Triggers the pipeline on a company already in the database)
  Returns: { ok: true, jobId: string, crNumber: string|null, nameMode: boolean }
```

---

## Exported Symbols

All used by `masaar.ts` and `masar-database.ts` route files:

```typescript
export function createJob(jobId: string, stealthMode?: boolean): EventEmitter
export function getJobEmitter(jobId: string): EventEmitter | undefined
export function submitCaptcha(jobId: string, captchaFor: string, captchaText: string): boolean
export async function runMasaarPipeline(crNumber: string, jobId: string): Promise<void>
export async function runMasaarPipelineByName(nameAr: string, nameEn: string, jobId: string): Promise<void>
export interface AgentEvent { ... }
export interface MasaarReport { ... }
export interface ComplianceResult { ... }
```

---

## Environment Variables

| Variable | Used By | Status |
|----------|---------|--------|
| `ANTHROPIC_API_KEY` | Agent 1b (parse), Agent 2 (OCR translate), Agent 3 (knowledge), Agent 5 (report) | Required |
| `OPENAI_API_KEY` | Agent 3 (GPT-4o knowledge), Agent 5 (fallback report) | Required |
| `GEMINI_API_KEY` | Agent 3 (4 Gemini threads) | Required |
| `PERPLEXITY_API_KEY` | Agent 3 (5 Perplexity threads), Agent 4 (compliance checks) | Required |
| `OPENROUTER_API_KEY` | Agent 3 DeepSeek-R1, Llama-3.3, Kimi stubs | Optional — stubs activate automatically |
| `GROQ_API_KEY` | Agent 3 Groq Llama stub | Optional — stub activates automatically |
