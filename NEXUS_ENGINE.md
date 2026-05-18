# NEXUS — Autonomous AI-Native Lead Intelligence Engine
## Full-Stack Technical Documentation

**Version:** 1.0.0  
**Platform:** ProspectSA (Saudi Arabia B2B Intelligence)  
**Replication Target:** Nexflow App  
**Build Date:** 2025-05-14

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Layer 1 — Multi-Model Inference Fabric](#3-layer-1--multi-model-inference-fabric)
4. [Layer 2 — Anti-Detection Browser Mesh](#4-layer-2--anti-detection-browser-mesh)
5. [Layer 3 — Evasion & Identity System](#5-layer-3--evasion--identity-system)
6. [Layer 4 — Autonomous Web Harvester](#6-layer-4--autonomous-web-harvester)
7. [Layer 5 — OSINT Enrichment Layer (Planned)](#7-layer-5--osint-enrichment-layer-planned)
8. [Layer 6 — Lead Orchestration (Activepieces)](#8-layer-6--lead-orchestration-activepieces)
9. [API Reference](#9-api-reference)
10. [Environment Variables](#10-environment-variables)
11. [Cost Model](#11-cost-model)
12. [Replication Guide for Nexflow](#12-replication-guide-for-nexflow)
13. [File Map](#13-file-map)

---

## 1. System Overview

NEXUS is the central intelligence engine powering every AI generation, web scraping, and data enrichment operation in ProspectSA. Every route, agent, and pipeline in the application routes through NEXUS — nothing calls AI providers or web scraping libraries directly.

**What it replaces:**

| Paid Service | Monthly Cost | NEXUS Equivalent |
|---|---|---|
| ZoomInfo | $1,250+/mo | Scrapy + ScrapeGraphAI + Sherlock (planned) |
| Clay | $300+/mo | TheHarvester + pattern engine + NEXUS extract |
| SignalHire | $200+/mo | OSINT + pattern matching + Apollo fallback |
| D&B Hoovers | $500+/mo | Crawl4AI + DeepSeek extraction |
| Bright Data | $500+/mo | IPRoyal + Camoufox + Undetected ChromeDriver |
| Oxylabs | $300+/mo | LunaProxy + SimplyNode PAYG |
| 2Captcha | $100+/mo | AZcaptcha $24.90/mo unlimited |
| OpenAI at $10/MTok | Variable | DeepSeek at $0.28/MTok + Groq (near-free) |
| Zapier Enterprise | $100+/mo | Activepieces self-hosted |
| **Total** | **$3,250+/mo** | **~$55/mo** |

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         NEXUS ENGINE v1.0                                    │
│                  Autonomous AI-Native Lead Intelligence                       │
├──────────────────────────────────────────────────────────────────────────────┤
│  LAYER 1: MULTI-MODEL INFERENCE FABRIC                                       │
│                                                                              │
│  LiteLLM-style task router                                                   │
│  ├── Tier: extraction → DeepSeek V3 ($0.28/MTok) via OpenRouter              │
│  ├── Tier: realtime   → Groq Llama 3.1 70B (800 tok/s, near-free)           │
│  ├── Tier: arabic     → Qwen 2.5 72B → Gemini 2.5 Flash                     │
│  ├── Tier: synthesis  → Gemini 2.5 Flash → Claude Sonnet → GPT-4o           │
│  └── Tier: bulk       → Ollama local (Llama 3, Mistral) — $0                │
│                                                                              │
│  All calls tracked: tokens, cost (USD), latency, provider                   │
├──────────────────────────────────────────────────────────────────────────────┤
│  LAYER 2: ANTI-DETECTION BROWSER MESH                                        │
│                                                                              │
│  PowerScraper — auto-escalating engine chain:                                │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ Cheerio  │→ │  Playwright  │→ │ Playwright+Stealth│→ │ BeautifulSoup  │  │
│  │ (static) │  │ (JS render)  │  │(200+ signals)    │  │ (Python/Arabic)│  │
│  └──────────┘  └──────────────┘  └──────────────────┘  └────────────────┘  │
│                                                                              │
│  NEXUS Session Manager (all layers):                                         │
│  • 5 UA profiles (Chrome/Edge/Safari/Linux/Mac)                              │
│  • Fingerprint hardening: webdriver=false, canvas noise, Chrome runtime     │
│  • Session warming: 2-3 benign pages before protected target                 │
│  • Human simulation: C++ mouse paths, realistic scroll, request jitter      │
│  • Header entropy: Accept, Accept-Language, Referrer rotation               │
├──────────────────────────────────────────────────────────────────────────────┤
│  LAYER 3: EVASION & IDENTITY SYSTEM                                          │
│                                                                              │
│  PROXY ROTATION (ProxyManager):                                              │
│  WebShare (free) → IPRoyal ($1.75/GB) → LunaProxy ($0.70/GB)                │
│  → SimplyNode 5G mobile ($2.50/GB)                                           │
│  Strategies: per-request | sticky-15min | sticky-30min | mobile             │
│                                                                              │
│  CAPTCHA SOLVING (CaptchaSolver):                                            │
│  NopeCHA (free/100d) → AZcaptcha ($24.90/mo) → CapMonster ($0.60/1K)        │
│  → DeathByCaptcha ($2.89/1K, human fallback)                                │
│  Types: reCAPTCHA v2/v3, hCaptcha, Turnstile, image, text                  │
├──────────────────────────────────────────────────────────────────────────────┤
│  LAYER 4: AUTONOMOUS WEB HARVESTER                                           │
│                                                                              │
│  web-seeder.ts → power-scraper.ts (BFS multi-page crawl)                    │
│  • Priority queue: about > team > board > contact > financials > news > *   │
│  • Pagination: ?page=N, /page/N, التالي, rel=next, numbered buttons         │
│  • Infinite scroll: Playwright auto-scroll + wait for new content           │
│  • Per-page: email extraction, Saudi phone, link graph, page classification  │
│                                                                              │
│  (Planned Layer 4 additions):                                                │
│  Scrapy (concurrent spiders) → Crawl4AI (LLM markdown) → ScrapeGraphAI     │
├──────────────────────────────────────────────────────────────────────────────┤
│  LAYER 5: OSINT ENRICHMENT (Planned)                                         │
│                                                                              │
│  TheHarvester → email discovery from domain (OSINT, DNS, search engines)    │
│  Sherlock → social profiles across 400+ platforms from username              │
│  Email Pattern Engine → format detection + Hunter.io free tier verify        │
│  Apollo / Explorium → fallback if OSINT insufficient                         │
├──────────────────────────────────────────────────────────────────────────────┤
│  LAYER 6: LEAD ORCHESTRATION (Planned)                                       │
│                                                                              │
│  Activepieces (self-hosted) — post-pipeline automation:                      │
│  • Lead score > 80 → push to HubSpot/CRM                                    │
│  • Job complete → Slack/email summary notification                           │
│  • New company → auto-trigger enrichment crawl                               │
│  • Weekly schedule → run saved Lead Factory jobs automatically              │
│  • Export → Google Sheets auto-update                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│  OUTPUT                                                                      │
│  Structured scored leads → PostgreSQL → Lead Factory UI → ProsEngine        │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Layer 1 — Multi-Model Inference Fabric

### File: `artifacts/api-server/src/lib/nexus/llm-router.ts`

### Concept

Every AI generation task has a cost-optimal model. The LLM router classifies tasks by tier and routes to the cheapest capable provider first, falling back through the chain until one succeeds.

### Task Tiers

| Tier | Use Case | Primary Model | Cost/MTok |
|---|---|---|---|
| `extraction` | Parse fields, classify, normalise | DeepSeek V3 via OpenRouter | $0.28 |
| `realtime` | Speed-critical, < 2s response needed | Groq Llama 3.1 70B | ~$0.00 |
| `arabic` | Bilingual Arabic+English tasks | Qwen 2.5 72B → Gemini 2.5 Flash | $0.40 |
| `synthesis` | Final dossier, complex reasoning | Gemini 2.5 Flash → Claude → GPT-4o | $0.15–5.00 |
| `bulk` | High volume, cost-sensitive, slow OK | Ollama local (Llama 3) | $0.00 |

### Provider Chain per Tier

```
extraction:  OpenRouter DeepSeek V3 → Groq Llama 70B → Qwen 72B → Gemini 2.5 Flash → GPT-4o-mini
realtime:    Groq Llama 70B → OpenRouter DeepSeek → Gemini 2.5 Flash
arabic:      Qwen 2.5 72B → Gemini 2.5 Flash → DeepSeek → Groq
synthesis:   Gemini 2.5 Flash → Claude Sonnet 4 → GPT-4o → DeepSeek (last resort)
bulk:        Ollama (local) → DeepSeek → Groq Llama 8B Instant
```

### OpenRouter Models Available

```
deepseek/deepseek-chat-v3-5          $0.28/MTok  — default cheap workhorse
meta-llama/llama-3.1-70b-instruct    $0.10/MTok  — strong reasoning
meta-llama/llama-3.3-70b-instruct    $0.12/MTok  — latest Llama
mistralai/mistral-large              $2.00/MTok  — strong structured JSON
qwen/qwen-2.5-72b-instruct           $0.40/MTok  — best Arabic+English
google/gemini-2.5-flash-preview      $0.15/MTok  — Google model via OpenRouter
anthropic/claude-sonnet-4-5          $3.00/MTok  — Claude via OpenRouter
openai/gpt-4o                        $5.00/MTok  — GPT-4o via OpenRouter
```

### API

```typescript
import { nexus, nexusGenerate, nexusExtract, nexusSynthesize } from "./lib/nexus/index.js";

// Auto-routed by tier
const result = await nexusGenerate(prompt, { tier: "extraction" });

// Extract structured JSON cheaply
const data = await nexusExtract(rawText, "Extract company name, phone, email as JSON");

// Final synthesis using frontier models  
const report = await nexusSynthesize(allData, "Write a Saudi B2B intelligence dossier");

// Real-time fast via Groq
const quick = await nexusRealtime("Classify this company: Saudi Aramco");

// Session cost tracking
const { totalCostUSD, records } = getSessionUsage();
```

### Cost Tracking

Every call is logged with: model, provider, prompt tokens, completion tokens, estimated USD cost, latency. Accessible via `getSessionUsage()` or `GET /api/nexus/llm/status`.

---

## 4. Layer 2 — Anti-Detection Browser Mesh

### Files
- `artifacts/api-server/src/lib/power-scraper.ts` — main engine
- `artifacts/api-server/src/lib/nexus/session-manager.ts` — fingerprint hardening
- `artifacts/api-server/src/lib/bs4_extract.py` — BeautifulSoup bridge

### Engine Escalation

```
Request for URL
      │
      ▼ Try Cheerio (fast, no browser, 0.2s)
      │ Sufficient content? → return result
      │ Blocked / thin content? ↓
      ▼ Try Playwright (full Chromium, executes JS, 3-5s)
      │ Sufficient content? → return result  
      │ Blocked? ↓
      ▼ Try Playwright + Stealth (puppeteer-extra-plugin-stealth, 5-15s)
      │ Sufficient content? → return result
      │ Arabic-heavy? → pipe HTML through BeautifulSoup (Python subprocess)
      │ All failed? ↓
      ▼ Error + fallback flag
```

### Fingerprint Signals Covered

| Signal | How Covered |
|---|---|
| `navigator.webdriver` | Overridden to `false` in `hardenPage()` |
| `navigator.platform` | Set to realistic OS string per UA profile |
| `navigator.vendor` | Set to Google Inc. / Apple / Microsoft |
| `navigator.languages` | Set from UA profile Accept-Language |
| Canvas fingerprint | `fillText` patched with 0.01-opacity pixel noise |
| WebGL fingerprint | Browser-level spoofing via stealth plugin |
| Audio context | Stealth plugin covers |
| Plugin enumeration | Stealth plugin covers |
| Chrome runtime object | Injected as realistic stub |
| Permissions API | `notifications` → returns `prompt` state |
| Mouse movement | `simulateMouseMovement()` — 4 random paths with micro-steps |
| Scroll patterns | `simulateScroll()` — 1-3 natural scrolls with smooth behaviour |
| Request timing | `lightJitter()` 0.5-1.5s + `humanJitter()` 2-8s between requests |
| Request headers | `buildRealisticHeaders()` — Accept, Accept-Language, Referrer, Sec-Fetch-* |
| Session history | `warmUpSession()` — 2-3 benign pages before target |

### Session Warming

For stealth mode, before navigating to the target page:
1. Visit 2 benign pages (Saudi news/Google for `.sa` targets, Wikipedia/Reuters for global)
2. Short delay per page with a simulated scroll
3. This builds realistic cookie profile and browsing history

### UA Profiles (5 total)

```
Chrome 138 Windows  | Accept-Language: en-US,en;q=0.9,ar;q=0.8
Chrome 137 Mac      | Accept-Language: en-GB,en;q=0.9,ar-SA;q=0.8
Edge 136 Windows    | Accept-Language: ar-SA,ar;q=0.9,en;q=0.8
Chrome 138 Linux    | Accept-Language: en-US,en;q=0.9
Safari 17 Mac       | Accept-Language: ar,en-US;q=0.9,en;q=0.8
```

### BFS Crawl Logic

```typescript
const result = await crawlSite("https://company.com", "Company Name", {
  maxPages: 20,      // max pages to visit
  maxDepth: 3,       // max link depth from root
  followPagination: true,
  scrollInfinite: false,
  priorityTypes: ["about", "team", "board", "contact", "financials"],
});
// Returns: pages[], allEmails[], allPhones[], engineUsage stats
```

Page priority scoring:
- about: 10, team: 9, board: 9, contact: 8, financials: 8
- investors: 7, services: 6, products: 6, news: 5
- blog: 4, projects: 4, careers: 3, general: 1

---

## 5. Layer 3 — Evasion & Identity System

### 5a. Proxy Manager

**File:** `artifacts/api-server/src/lib/nexus/proxy-manager.ts`

#### Provider Chain

```
1. WebShare    — Free. 10 residential proxies. Good for development/testing.
2. IPRoyal     — $1.75/GB PAYG. 32M+ IPs. Never-expiring bandwidth.
3. LunaProxy   — $0.70/GB. 200M+ IPs. Cheapest per-GB on market.
4. SimplyNode  — $2.50/GB. 50M+ IPs including 5G mobile. Most human-like.
```

#### Rotation Strategies

| Strategy | IP Changes | Use Case |
|---|---|---|
| `per-request` | Every HTTP request | Open web, directories, search results |
| `sticky-15` | Same IP for 15 min | Registry lookups, profile pages |
| `sticky-30` | Same IP for 30 min | Long auth sessions |
| `mobile` | 5G mobile IP (sticky) | LinkedIn-style, protected government portals |

#### Usage

```typescript
import { getProxy } from "./lib/nexus/proxy-manager.js";

const proxy = getProxy("per-request");
// proxy.proxyUrl          → "http://user:pass@host:port"
// proxy.playwrightProxy   → { server, username, password }
// proxy.axiosProxy        → { host, port, auth }

// Already integrated into:
// - scrapeWithCheerio()  → axios proxy
// - scrapeWithPlaywright() → Playwright context proxy
```

#### Gateway Proxy Username Format

For IPRoyal/LunaProxy/SimplyNode sticky sessions, the session token is embedded in the username:
- Per-request: `username` (plain)
- Sticky: `username-session-{8chartoken}`
- Mobile (SimplyNode): `username-type-mobile`

### 5b. CAPTCHA Solver

**File:** `artifacts/api-server/src/lib/nexus/captcha-solver.ts`

#### Escalation Chain

```
NopeCHA → AZcaptcha → CapMonster → DeathByCaptcha
```

| Provider | Cost | Method | Speed |
|---|---|---|---|
| NopeCHA | Free (100/day) | AI | 3-15s |
| AZcaptcha | $24.90/mo unlimited | AI | 5-30s |
| CapMonster | $0.60/1K | AI | < 1s |
| DeathByCaptcha | $2.89/1K (correct only) | Human+AI | 10-60s |

#### Supported CAPTCHA Types

- `recaptcha-v2` — Standard image grid challenge
- `recaptcha-v3` — Invisible score-based
- `hcaptcha` — hCaptcha image challenge
- `image` — Simple rendered text CAPTCHA
- `text` — Plain text CAPTCHA
- `turnstile` — Cloudflare Turnstile

#### Usage

```typescript
import { solveCaptcha } from "./lib/nexus/captcha-solver.js";

const result = await solveCaptcha({
  type: "recaptcha-v2",
  pageUrl: "https://mc.gov.sa/registration",
  siteKey: "6LcXXXXXXXXXXXXXXXXXXXXX",
  timeoutMs: 120000,
});
// result.token    → gRecaptchaResponse token to inject
// result.provider → which service solved it
// result.latencyMs → how long it took
```

---

## 6. Layer 4 — Autonomous Web Harvester

### Files
- `artifacts/api-server/src/lib/web-seeder.ts` — orchestration entry point
- `artifacts/api-server/src/lib/power-scraper.ts` — multi-engine crawler

### How Company Intel, Person Intel, and Masar Use It

```
Company Intel route
    └─ runWebSeeder(website, companyName, { maxPages: 8 })
         └─ crawlSite() from power-scraper
              └─ BFS queue → scrapePage() for each URL
                   └─ Cheerio → Playwright → Stealth → BS4 (auto-escalating)
                        + NEXUS proxy rotation on every request
                        + NEXUS session hardening on every stealth page
```

### crawlSite() Result Shape

```typescript
interface CrawlResult {
  rootUrl: string;
  pages: CrawlPage[];          // each page: url, pageType, text, emails, phones
  allEmails: string[];         // deduplicated across all pages
  allPhones: string[];         // deduplicated Saudi phone numbers
  allLinks: string[];          // complete link graph
  pagesAnalyzed: number;
  engineUsage: {               // how many pages each engine served
    cheerio?: number;
    playwright?: number;
    "playwright-stealth"?: number;
    beautifulsoup?: number;
  };
  paginationFollowed: number;
  durationMs: number;
  errors: string[];
}
```

---

## 7. Layer 5 — OSINT Enrichment Layer (Planned)

Will be implemented as a Python FastAPI microservice at `artifacts/nexus-osint/`.

### TheHarvester — Email Discovery
```
Input:  company domain (e.g. "aramco.com")
Output: all discoverable emails from Google, Bing, LinkedIn, 
        PGP servers, SHODAN, DNS/WHOIS, GitHub commits
```

### Sherlock — Social Profile Discovery
```
Input:  person name or username
Output: confirmed profiles across 400+ platforms
```

### Email Pattern Engine
```
Logic:
  1. TheHarvester discovers 3+ emails from domain
  2. Pattern detector: "f.lastname@company.com" format
  3. Engine generates emails for all executives using same pattern
  4. Hunter.io free tier (25/month) verifies deliverability
```

### Planned FastAPI Service API

```
POST /osint/harvest-emails   { domain }     → emails[]
POST /osint/sherlock         { username }   → profiles[]
POST /osint/pattern-email    { domain, firstName, lastName } → email, confidence
```

---

## 8. Layer 6 — Lead Orchestration (Activepieces)

### Why Activepieces over n8n

- Cleaner open-source governance (no commercial node limits)
- Simpler UI — non-technical users can build and edit flows
- Self-hosted with no execution restrictions
- First-class webhook and HTTP trigger support
- HubSpot, Google Sheets, Slack built-in natively

### Planned Flows

| Trigger | Action |
|---|---|
| NEXUS lead score > 80 | Push to HubSpot CRM |
| Lead Factory job completes | Send Slack summary (N leads found, M scored >80) |
| New company added to ProsEngine | Trigger auto-enrichment web crawl |
| Weekly schedule (Mon 8am) | Auto-run saved Lead Factory jobs |
| Lead export requested | Update Google Sheets |
| Lead enriched | Webhook to outreach tool |

### How it connects to the Express API

```
Express API (Lead Factory completes)
    └─ POST https://activepieces.internal/api/v1/webhooks/{flowId}
         { leadCount: 47, topLeads: [...], jobId: "..." }
              └─ Activepieces flow handles CRM + Slack + Sheets
```

---

## 9. API Reference

### NEXUS Status Endpoints

```
GET  /api/nexus/status           Full engine status (all 6 layers)
GET  /api/nexus/llm/status       LLM providers + session cost tracking
GET  /api/nexus/proxy/status     Proxy provider status + active sessions
GET  /api/nexus/captcha/status   CAPTCHA solver provider status
POST /api/nexus/llm/test         Test-fire LLM routing
DELETE /api/nexus/session/usage  Clear cost tracking + sticky sessions
```

### Test Endpoint Examples

```bash
# Full status
curl /api/nexus/status

# Test cheapest extraction model
curl -X POST /api/nexus/llm/test \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 2+2?", "tier": "extraction"}'

# Test Arabic tier
curl -X POST /api/nexus/llm/test \
  -d '{"prompt": "من هو مدير أرامكو؟", "tier": "arabic"}'

# Check cost this session
curl /api/nexus/llm/status | jq .costBreakdown
```

### Status Response Shape

```json
{
  "ok": true,
  "engine": "NEXUS",
  "version": "1.0.0",
  "llm": {
    "openrouter": { "configured": true, "models": ["deepseek/deepseek-chat-v3-5", "..."] },
    "groq": { "configured": false },
    "gemini": { "configured": true },
    "anthropic": { "configured": false },
    "openai": { "configured": false },
    "ollama": { "configured": true, "baseUrl": "http://localhost:11434" },
    "activeProviders": ["openrouter", "gemini", "ollama"]
  },
  "proxy": {
    "enabled": true,
    "providers": {
      "webshare": { "configured": false, "poolSize": 0 },
      "iproyal": { "configured": false },
      "lunaproxy": { "configured": false },
      "simplynode": { "configured": false }
    },
    "activeProviders": [],
    "activeStickySessionCount": 0
  },
  "captcha": {
    "enabled": true,
    "providers": { "nopecha": false, "azcaptcha": false, "capmonster": false, "deathbycaptcha": false },
    "activeProviders": [],
    "anyAvailable": false
  },
  "session": { "records": [], "totalCostUSD": 0 }
}
```

---

## 10. Environment Variables

### Required (already configured)
```
GEMINI_API_KEY         Google Gemini 2.5 Flash — primary LLM + grounded search
```

### High Priority (add these first — highest ROI)
```
OPENROUTER_API_KEY     One key → DeepSeek, Groq, Mistral, Qwen, 100+ models
                       Get at: https://openrouter.ai
                       Cuts AI costs 70-80%

GROQ_API_KEY           Groq direct access — 800 tok/s Llama, near-free
                       Get at: https://console.groq.com
```

### CAPTCHA Solving
```
NOPECHA_API_KEY        Free (100 solves/day)    https://nopecha.com
AZCAPTCHA_API_KEY      $24.90/mo unlimited      https://azcaptcha.com
CAPMONSTER_API_KEY     $0.60/1K, AI <1s         https://capmonster.cloud
DEATHBYCAPTCHA_USER    Human fallback            https://deathbycaptcha.com
DEATHBYCAPTCHA_PASS
```

### Proxy Rotation
```
WEBSHARE_PROXY_LIST    Free 10 proxies          https://webshare.io
                       Format: "host:port:user:pass,host:port:user:pass"

IPROYAL_USER           $1.75/GB PAYG            https://iproyal.com
IPROYAL_PASS
IPROYAL_ENDPOINT       Default: geo.iproyal.com:12321

LUNAPROXY_USER         $0.70/GB, 200M+ IPs      https://lunaproxy.com
LUNAPROXY_PASS
LUNAPROXY_ENDPOINT     Default: gate.lunaproxy.com:12233

SIMPLYNODE_USER        $2.50/GB, 5G mobile      https://simplynode.io
SIMPLYNODE_PASS
SIMPLYNODE_ENDPOINT    Default: gate.simplynode.io:9000
```

### Local Inference (Ollama)
```
OLLAMA_BASE_URL        Default: http://localhost:11434
OLLAMA_MODEL           Default: llama3.1
                       Install: curl https://ollama.ai/install.sh | sh
                       Models: ollama pull llama3.1 / mistral / qwen2.5
```

### Feature Flags
```
NEXUS_PROXY_ENABLED    Set "false" to disable all proxy rotation (default: enabled)
NEXUS_CAPTCHA_ENABLED  Set "false" to disable CAPTCHA solving (default: enabled)
OLLAMA_MODEL           Override Ollama model (default: llama3.1)
CHROMIUM_EXECUTABLE_PATH  Override Chromium binary path
```

### Existing (already used by app)
```
ANTHROPIC_API_KEY / AI_INTEGRATIONS_ANTHROPIC_API_KEY  — Claude
OPENAI_API_KEY / AI_INTEGRATIONS_OPENAI_API_KEY        — GPT-4o
PERPLEXITY_API_KEY                                      — Perplexity Sonar
APOLLO_API_KEY                                          — Apollo.io
EXPLORIUM_API_KEY                                       — Explorium
DATABASE_URL                                            — PostgreSQL
```

---

## 11. Cost Model

### Current (before NEXUS LLM routing)
Every extraction, parsing, synthesis call → Claude/GPT-4o/Gemini at frontier rates.

### With NEXUS (after routing)

| Task Type | Volume Example | Old Cost | NEXUS Cost | Savings |
|---|---|---|---|---|
| Field extraction from raw HTML | 100 pages | $1.50 (GPT-4o) | $0.02 (DeepSeek) | 98% |
| Arabic entity extraction | 50 pages | $0.75 | $0.02 (Qwen) | 97% |
| Final company dossier | 10 reports | $1.50 (Claude) | $0.15 (Gemini Flash) | 90% |
| Real-time classification | 200 items | $2.00 (GPT-4o) | ~$0 (Groq) | 99% |
| Bulk normalisation | 1000 records | $10.00 | $0 (Ollama) | 100% |
| **Monthly total** | Active usage | **$200+** | **~$5–15** | **93%** |

### Proxy + CAPTCHA (new costs)
```
AZcaptcha unlimited:  $24.90/mo flat  (eliminates government portal CAPTCHA walls)
IPRoyal PAYG:         ~$10–20/mo      (depends on scraping volume, $1.75/GB)
LunaProxy:            ~$5–10/mo       (overflow, $0.70/GB)
Total new spend:      ~$40–55/mo
```

### Net Position
```
Old: $2,000–5,000/mo (ZoomInfo + Clay + SignalHire + Bright Data + 2Captcha)
New: ~$55/mo (AZcaptcha + proxy data + OpenRouter cheap models)
Savings: $1,945–4,945/mo (97–99% reduction)
```

---

## 12. Replication Guide for Nexflow

To replicate NEXUS on the Nexflow app:

### Step 1: Copy the NEXUS module
```
Copy entire: artifacts/api-server/src/lib/nexus/
Contains:
  index.ts          — central facade
  llm-router.ts     — multi-model routing
  proxy-manager.ts  — proxy rotation
  captcha-solver.ts — CAPTCHA solving
  session-manager.ts — browser identity hardening
```

### Step 2: Copy PowerScraper
```
Copy: artifacts/api-server/src/lib/power-scraper.ts
Copy: artifacts/api-server/src/lib/bs4_extract.py
Copy: artifacts/api-server/src/lib/web-seeder.ts
```

### Step 3: Install dependencies
```bash
# Node.js packages
pnpm add playwright playwright-extra playwright-extra-plugin-stealth \
         puppeteer-extra-plugin-stealth puppeteer-extra openai axios cheerio

# Python packages
pip install beautifulsoup4 lxml requests

# Optional: Playwright browser
npx playwright install chromium
# Or use system Chromium (set CHROMIUM_EXECUTABLE_PATH)
```

### Step 4: Wire the NEXUS route
```typescript
// In your Express router index:
import nexusRouter from "./routes/nexus.js";
router.use(nexusRouter);
// Exposes: GET /api/nexus/status and related endpoints
```

### Step 5: Set environment variables
```
GEMINI_API_KEY         (required — existing)
OPENROUTER_API_KEY     (high priority — biggest ROI)
GROQ_API_KEY           (optional — speed tasks)
AZCAPTCHA_API_KEY      (optional — production CAPTCHA)
IPROYAL_USER + PASS    (optional — production proxy rotation)
```

### Step 6: Use in your routes
```typescript
import { nexus } from "../lib/nexus/index.js";

// Cheap extraction (DeepSeek, $0.28/MTok)
const extracted = await nexus.extract(rawHtml, "Extract company name, email, phone as JSON");

// Synthesis (Gemini → Claude fallback)
const report = await nexus.synthesize(allData, "Write an intelligence dossier for this company");

// Get proxy (gracefully null if not configured)
const proxy = nexus.getProxy("per-request");

// Solve CAPTCHA (gracefully throws if no provider configured)
const token = await nexus.solveCaptcha({ type: "recaptcha-v2", pageUrl, siteKey });
```

### Step 7: Optional — Add Activepieces for post-pipeline automation
```bash
# Docker (self-hosted)
docker run -d \
  -p 8080:80 \
  -e AP_ENCRYPTION_KEY=your-key \
  activepieces/activepieces:latest

# Then configure webhooks in your Express routes to POST to Activepieces flows
```

---

## 13. File Map

```
artifacts/api-server/src/
├── lib/
│   ├── nexus/
│   │   ├── index.ts            NEXUS central facade + exports
│   │   ├── llm-router.ts       Multi-Model Inference Fabric
│   │   ├── proxy-manager.ts    Proxy & Identity Rotation Manager
│   │   ├── captcha-solver.ts   CAPTCHA Solving Adapter
│   │   └── session-manager.ts  Browser Identity & Session Hardening
│   ├── power-scraper.ts        Anti-Detection Browser Mesh (Layers 1-4)
│   ├── bs4_extract.py          BeautifulSoup4 Python bridge
│   ├── web-seeder.ts           Autonomous Web Harvester entry point
│   └── ...other enrichment engines...
└── routes/
    ├── nexus.ts                NEXUS status & control API
    ├── company-intel.ts        Company Intelligence (uses NEXUS extract)
    ├── person-intel.ts         Person Intelligence (uses NEXUS extract)
    └── ...other routes...

NEXUS_ENGINE.md                 THIS FILE — full technical documentation
```

---

## Appendix: The "Pass Any Website" Checklist

For harvesting from maximally protected sites:

1. **Fingerprint rotation** — UA profile rotated per request (Cheerio) or per session (Playwright)
2. **Engine-level hardening** — `hardenPage()` overrides 200+ JS detection signals
3. **Behavioral mimicry** — `simulateMouseMovement()` + `simulateScroll()` + jitter delays
4. **Session warming** — `warmUpSession()` visits 2-3 benign pages before target
5. **Residential proxy** — IPRoyal or LunaProxy per-request rotation
6. **CAPTCHA pre-armed** — AZcaptcha unlimited ready to fire on any challenge
7. **Escalating engines** — if Cheerio blocked → Playwright → Stealth → BS4
8. **Request jitter** — random 0.5-8s delays between requests
9. **Header entropy** — realistic Accept, Accept-Language, Referrer, Sec-Fetch-* per profile
10. **Arabic support** — BS4 Python bridge handles RTL and malformed HTML perfectly
