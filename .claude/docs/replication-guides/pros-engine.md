# ProsEngine — Intelligence Suite

**Source files:**
- `artifacts/api-server/src/routes/company-intel.ts` — Company Intelligence + Web Seeder endpoint
- `artifacts/api-server/src/routes/person-intel.ts` — Person Intelligence
- `artifacts/api-server/src/lib/web-seeder.ts` — Shared Web Seeder library (used by all three tools + Masar enrichment)

ProsEngine has three completely independent intelligence tools. Each can be used on its own:

1. **Company Intelligence** — deep company dossier from 11 parallel sources
2. **Person Intelligence** — deep executive dossier from 20 parallel agents
3. **Web Seeder** — paginated multi-agent website crawler (one AI agent per page)

---

## Tool 1 — Company Intelligence

**Endpoint:** `POST /api/company-intel/profile`

Builds a comprehensive Saudi company dossier in 3 phases: parallel research across 11 sources → context compilation → AI synthesis.

---

### Phase 1 — 11 Parallel Research Sources

All 11 sources fire simultaneously using `Promise.allSettled()`:

| # | Source | Model / API | Query Focus |
|---|--------|------------|------------|
| 1 | **Web Seeder** | `lib/web-seeder.ts` — axios + Cheerio + Claude per-page agent | Multi-page crawl of the company website (up to 8 pages). Each page gets its own Claude agent. Returns structured: company overview, services, team, news, projects, B2B signals, emails, phones |
| 2 | Gemini A | `gemini-2.5-flash` + Google Search | Full profile: website, phone, address, founding year, legal form, CR number, capital, employees, revenue, activities |
| 3 | Gemini B | `gemini-2.5-flash` + Google Search | Ownership & shareholders: exact full names Arabic + English with ownership percentages. Searches mc.gov.sa + emagazine.aamaly.sa |
| 4 | Gemini C | `gemini-2.5-flash` + Google Search | Leadership & executives: CEO, chairman, GM, CFO, COO, board — full names AR+EN with exact titles. Searches LinkedIn + Saudi directories |
| 5 | Gemini D | `gemini-2.5-flash` + Google Search | Market intelligence: competitors, market share, key clients, revenue growth, ranking 2023–2025 |
| 6 | Perplexity 1 | sonar, 2000 tokens | General profile & contact: website, phone, email, address, revenue SAR, employees, activities |
| 7 | Perplexity 2 | sonar, 2000 tokens | Financial intelligence: annual revenue, profit, market share, paid-up capital (2022–2024) |
| 8 | Perplexity 3 | sonar, 2000 tokens | Ownership & AOA: shareholders with names AR+EN and percentages |
| 9 | Perplexity 4 | sonar, 2000 tokens | Leadership: full names AR+EN, all executives, board members 2024–2025 |
| 10 | Claude Sonnet | `claude-sonnet-4-6`, 2000 tokens | Comprehensive analysis: ownership structure, leadership, financials, market, contacts |
| 11 | GPT-4o | `gpt-4o`, max_completion_tokens: 1500 | Validation: ownership %, CEO+executives AR+EN, revenue, employees, key clients, competitors |

**Web search fallback:** Perplexity → Gemini Google Search. If `PERPLEXITY_API_KEY` is set and `DISABLE_PERPLEXITY !== "true"`, Perplexity runs first. If it returns fewer than 50 chars, Gemini with Google Search grounding runs as fallback.

**Web Seeder detail (Source 1):**
- Crawls up to 8 pages of the website (same domain, skips binary extensions)
- Link discovery runs on the first 5 pages visited to expand the queue
- User-Agent: Windows Chrome 121 with `Accept-Language: ar-SA,ar;q=0.9,en;q=0.5`
- Each page is classified by URL pattern (about / services / contact / team / news / careers / projects / general)
- Each qualifying page gets its own Claude Sonnet agent (1,024 tokens, 20s timeout) with a type-specific extraction prompt
- Aggregation agent (Claude Sonnet, 3,000 tokens, 45s timeout) merges all page intelligence into one structured profile
- Extracts per page: emails matching `[a-zA-Z0-9._%+-]+@...` and Saudi phones matching `(?:\+966|00966|0)[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{4}`

---

### Phase 2 — Context Compilation

All 11 source results are assembled into a single labeled context string (up to 14,000 chars). Each source is clearly labeled:
```
[Company Website — Multi-Page Intelligence (N pages crawled)]
[Emails from Website]
[Phones from Website]
[Gemini: Full Profile]
[Gemini: Ownership & Shareholders]
[Gemini: Executives & Board]
[Gemini: Market Intelligence]
[Web Search: Profile]
[Web Search: Financials]
[Web Search: Ownership]
[Web Search: Leadership]
[Claude Analysis]
[OpenAI Analysis]
```
Any source that returned empty or failed is silently omitted. The Web Seeder label includes the number of pages actually crawled.

---

### Phase 3 — Synthesis

**Claude Sonnet** (primary, `max_tokens: 4000`) and **Gemini generation** (secondary, `gemini-2.5-flash` text generation — no web tools in synthesis step) run simultaneously. Claude wins if both succeed. **GPT-4o** (`gpt-4o`, `max_completion_tokens: 4000`) is the final fallback if both Claude and Gemini fail.

---

### Request Body

```json
{
  "companyName": "Saudi Aramco",
  "website": "https://aramco.com",
  "crNumber": "2052101150",
  "city": "Dhahran",
  "intelligenceGoals": ["profile", "financials", "ownership", "leadership", "market", "approach"],
  "knownFacts": "Founded 1933. Listed on Tadawul 2019.",
  "sellerContext": {
    "companyName": "Your Company",
    "product": "ERP Software",
    "objectives": ["book a demo", "introduce our product"]
  }
}
```

`intelligenceGoals` controls which Gemini/Perplexity threads fire. Default: all 6 goals. Omitting a goal skips the corresponding research thread.

`knownFacts` are prepended to the context as `[Known Facts Provided]` — treated as confirmed data.

---

### Response Schema

```json
{
  "profile": {
    "nameEn": "...", "nameAr": "...",
    "legalForm": "...", "legalFormAr": "...",
    "crNumber": "...", "founded": "...",
    "city": "...", "address": "...",
    "website": "...", "phone": "...", "email": "...",
    "industry": "...", "mainActivity": "...", "mainActivityAr": "..."
  },
  "financials": {
    "revenueEstimate": "SAR X million",
    "revenueRange": "SAR 10M–50M",
    "revenueRationale": "...",
    "employeeCount": "...",
    "paidUpCapital": "SAR X,XXX,XXX",
    "profitabilityIndicator": "Profitable | Loss-making | Break-even | Unknown",
    "growthSignals": ["..."],
    "recentFinancialNews": "..."
  },
  "ownership": {
    "structure": "Family-owned | State-owned | Publicly-listed | Private",
    "shareholders": [
      { "nameEn": "...", "nameAr": "...", "ownershipPct": "XX%", "nationality": "Saudi", "type": "Individual | Corporate" }
    ],
    "isPubliclyListed": false,
    "stockExchange": "Tadawul",
    "ticker": "..."
  },
  "leadership": {
    "ceo": { "nameEn": "...", "nameAr": "...", "title": "CEO | GM | Managing Director" },
    "boardChairman": { "nameEn": "...", "nameAr": "..." },
    "executives": [{ "nameEn": "...", "nameAr": "...", "title": "..." }],
    "boardMembers": [{ "nameEn": "...", "nameAr": "...", "role": "Chairman | Member | Independent" }]
  },
  "operations": {
    "activities": ["..."],
    "products": ["..."],
    "keyClients": ["..."],
    "subsidiaries": ["..."],
    "geographicPresence": ["..."]
  },
  "market": {
    "marketPosition": "...",
    "marketShare": "...",
    "competitors": ["..."],
    "strengths": ["..."],
    "weaknesses": ["..."],
    "opportunities": ["..."]
  },
  "approach": {
    "bestChannel": "LinkedIn | Phone | Email | Referral",
    "bestTiming": "...",
    "entryPoint": "Name and title of best contact",
    "valueProp": "...",
    "openingAngle": "...",
    "potentialObjections": ["..."],
    "culturalNotes": "...",
    "sampleMessage": "1–2 sentence opening message"
  },
  "news": [
    { "title": "...", "date": "YYYY-MM", "summary": "...", "source": "..." }
  ],
  "intelligence": {
    "confidenceScore": 0,
    "dataQuality": "high | medium | low",
    "verifiedFacts": ["..."],
    "estimatedFacts": ["..."],
    "caveats": "...",
    "dataSources": ["..."]
  },
  "executiveSummary": "2–3 paragraph English executive summary"
}
```

---

### Save & Retrieve

```
POST /api/company-intel/save
{ "companyName": "...", "website": "...", "crNumber": "...", "city": "...",
  "sellerContext": {...}, "intelligenceGoals": [...], "knownFacts": "...",
  "report": {...}, "tags": "...", "notes": "..." }
→ saved row

GET /api/company-intel/saved
→ all saved reports, newest first (limit 100)

DELETE /api/company-intel/saved/:id
→ { success: true }
```

---

## Tool 2 — Person Intelligence

**Endpoint:** `POST /api/person-intel/profile`

The most comprehensive individual executive dossier available. Fires **20 parallel agents** — 9 Perplexity threads + 4 Gemini Google Search agents + LinkedIn crawl + company website crawl + Apollo API + Explorium API + Claude Sonnet + GPT-4o knowledge base + o4-mini DeepResearch (with live web search tool).

---

### Phase 1 — 20 Parallel Agents (all fire simultaneously)

**Perplexity Web Search — 9 threads (model: sonar):**

| Agent | Max Tokens | Query Focus |
|-------|-----------|------------|
| P1 | 2,500 | Full career history — ALL roles, companies, dates, responsibilities, achievements, key decisions |
| P2 | 2,500 | Company intelligence for their employer — structure, shareholders, CEO team, revenue, clients, Vision 2030, news 2024–2025 |
| P3 | 1,500 | Education — universities, degrees with field of study, graduation years, international study, scholarships, fellowships |
| P4 | 1,500 | Wealth profile — estimated net worth, equity stake %, known real estate, investments, financial disclosures |
| P5 | 1,500 | Board memberships — ALL director roles, committee memberships (audit/risk/compensation), government advisory, non-profit boards |
| P6 | 1,000 | Compensation benchmarks — salary range, bonus structure, LTI, equity/stock, LTIP, Saudi market benchmarks for this role level |
| P7 | 1,000 | Personal profile — hobbies, sports, philanthropy, conferences, personality traits, social media activity |
| P8 | 1,500 | Latest news 2024–2025 — deals, awards, promotions, keynotes, LinkedIn posts, controversies, company news |
| P9 | 500 | LinkedIn URL discovery — returns full `linkedin.com/in/...` URL |

**Gemini Google Search — 4 agents (model: gemini-2.5-flash, 35-second timeout each):**

| Agent | Focus |
|-------|-------|
| GA — Career & Professional History | ALL past and current roles with exact company names, dates, responsibilities. Education. Achievements, awards, promotions. Shareholding/ownership stakes. Board positions. Government/advisory roles. |
| GB — LinkedIn & Social Media Discovery | LinkedIn profile URL (`https://linkedin.com/in/...`). Twitter/X. All public social media. Personal website/blog. Direct contact info if publicly available. |
| GC — Company Context & Recent News 2023–2025 | Business deals, contracts, tenders won. Partnerships/JVs. Conference appearances. Press releases. Controversies. Company performance. Vision 2030 projects. Investment/funding activity. |
| GD — Comprehensive Deep Dossier | Full career + education + board + LinkedIn URL + net worth estimate + family background (public) + personal interests + news 2024–2025 + government relationships. |

**Crawl agents — 2:**

| Agent | Behavior |
|-------|---------|
| LinkedIn crawl | crawl4ai on provided `linkedinUrl`. Returns up to 5,000 chars. Skipped if no URL provided. |
| Company website crawl | **Full Web Seeder** (`lib/web-seeder.ts`). When `websiteUrl` is provided, crawls up to 8 pages. Each page gets its own Claude agent. Serialized output passed as context: company overview, team & leadership, services, recent news, projects, B2B signals, emails, phones. |

**External API agents — 2:**

| Agent | API | What it returns |
|-------|-----|----------------|
| Apollo.io | `/v1/people/search` | name, title, email, phone, LinkedIn URL, city, country, seniority, departments, employment history (last 5 roles) |
| Explorium | `/api/bundle/v1/people` | enriched people intelligence for Saudi Arabia |

**AI knowledge base agents — 2 (run in parallel, 18-second timeout each):**

| Agent | Model | Instructions |
|-------|-------|-------------|
| Claude Agent E | `claude-sonnet-4-6`, 2,000 tokens | Extract ALL facts from training data: full name EN+AR, career history with dates, education, LinkedIn URL, Twitter, board memberships, ownership stakes, net worth estimate, achievements, conferences, publications, personal interests, family background (if public). Label uncertain info clearly. |
| GPT-4o Agent F | `gpt-4o`, max_completion_tokens: 2,000 | Same structure as Claude — career, education, LinkedIn URL, board memberships, ownership, achievements, conferences, publications, interests. |

**DeepResearch agent — 1 (runs AFTER the parallel batch, 10-second timeout):**

| Agent | Model | What it does |
|-------|-------|-------------|
| o4-mini DeepResearch | `o4-mini-deep-research-2025-06-26` | Live web search tool enabled. Researches: career history, education, board memberships, wealth/equity, compensation, personal interests, public activities, publications, awards, recent 2024–2025 news, Vision 2030 involvement. |

---

### LinkedIn URL Discovery

After all agents complete, a LinkedIn URL is assembled from multiple sources (in priority order):
1. User-provided `linkedinUrl` in request
2. Perplexity P9 result
3. Gemini GB result
4. Claude Agent E training knowledge
5. GPT-4o Agent F training knowledge

The discovered URL is injected into the synthesis prompt and into the final report's `profile.linkedin` field (even if the AI synthesis missed it).

---

### Phase 2 — Context Assembly

All non-empty source results are labeled and concatenated:
```
=== SOURCE 1: WEB SEARCH — Professional Background & Career ===
=== SOURCE 2: WEB SEARCH — Company Intelligence ===
...
=== SOURCE 14: GEMINI AGENT A — Career & Professional History (Google Search) ===
=== SOURCE 15: GEMINI AGENT B — LinkedIn & Social Media Discovery (Google Search) ===
=== SOURCE 16: GEMINI AGENT C — Company Context & Recent News (Google Search) ===
=== SOURCE 17: GEMINI AGENT D — Comprehensive Deep Dossier (Google Search) ===
=== SOURCE 18: CLAUDE AGENT E — Training Knowledge Base ===
=== SOURCE 19: GPT-4o AGENT F — Training Knowledge Base ===
=== SOURCE 20: DEEP RESEARCH AGENT (o4-mini) ===
```
Total context capped at 20,000 chars before synthesis.

---

### Phase 3 — Synthesis

Three synthesis engines run simultaneously (30-second timeout each). Priority: **Gemini first → Claude second → GPT-4o third**:

| Engine | Model | Tokens |
|--------|-------|--------|
| Gemini (1st priority) | `gemini-2.5-flash` text generation | — |
| Claude Sonnet (2nd priority) | `claude-sonnet-4-6` | 4,000 |
| GPT-4o (3rd priority / fallback) | `gpt-4o` | max_completion_tokens: 4,000 |

**Synthesis rules enforced in the prompt:**
1. A fact confirmed by TWO OR MORE sources is a **verified fact** — always cite the source number
2. LinkedIn URL: check Sources 9, 15, 17, 18, 19 — use it if found in ANY source
3. Use "Not found" only after checking all 20 sources — never hallucinate
4. All inferences labeled "Estimated:" in text AND added to `estimated_facts`
5. Career array must use ALL sources (Sources 1, 14, 17, 18, 19)
6. Generic phrases ("experienced executive") without a specific source citation are rejected

---

### Request Body

```json
{
  "name": "Ahmed Al-Ghamdi",
  "company": "Saudi Aramco",
  "title": "Chief Financial Officer",
  "linkedinUrl": "https://linkedin.com/in/...",
  "websiteUrl": "https://aramco.com",
  "country": "Saudi Arabia",
  "intelligenceGoals": ["wealth", "career", "board", "approach"],
  "knownFacts": "Board member of Saudi Telecom since 2020.",
  "sellerContext": {
    "companyName": "Your Company",
    "product": "Treasury Management Software",
    "objectives": ["book a demo", "get introduced to CFO team"]
  }
}
```

`intelligenceGoals` accepted values: `wealth`, `career`, `education`, `board`, `approach`, `company`, `compensation`, `personal`, `news`. If omitted, all goals are researched.

`sellerContext` customizes the `approach_strategy` section — the `recommended_approach` and `sample_message` fields are personalized to your product and company.

---

### Response Schema

```json
{
  "profile": {
    "fullName": "...",
    "arabicName": "...",
    "title": "...",
    "company": "...",
    "nationality": "...",
    "location": "City, Country",
    "age": null,
    "linkedin": "https://linkedin.com/in/..."
  },
  "career": [
    { "company": "...", "title": "...", "period": "YYYY – Present", "description": "Specific achievements from research" }
  ],
  "education": [
    { "institution": "...", "degree": "...", "field": "...", "year": "..." }
  ],
  "company_analysis": {
    "name": "...", "industry": "...", "founded": "...", "headquarters": "...",
    "employees": "...", "revenue_estimate": "...",
    "performance": "...", "market_position": "...",
    "key_clients": ["..."], "recent_developments": "...",
    "competitors": ["..."], "pain_points": ["..."]
  },
  "wealth_profile": {
    "estimated_net_worth": "From research OR Estimated: [range] based on [reasoning]",
    "income_estimate": "...",
    "wealth_sources": ["..."],
    "assets": "...",
    "investments": "...",
    "lifestyle_indicators": "..."
  },
  "personal_profile": {
    "interests": ["..."],
    "personality_traits": ["..."],
    "communication_style": "...",
    "languages": ["Arabic", "English"],
    "board_memberships": ["..."],
    "publications": ["..."],
    "awards": ["..."],
    "social_presence": "..."
  },
  "approach_strategy": {
    "best_channel": "...",
    "best_timing": "...",
    "opening_angle": "Specific and personalized — grounded in research data",
    "value_proposition": "Precisely tailored to their role and company",
    "potential_objections": ["..."],
    "conversation_starters": ["Topic grounded in research"],
    "cultural_notes": "Saudi business culture considerations specific to this person",
    "recommended_approach": "Full 3–4 paragraph tailored outreach strategy",
    "sample_message": "Ready-to-send, personalized first outreach message"
  },
  "intelligence_notes": {
    "confidence_level": "High | Medium | Low",
    "data_sources": ["Perplexity: professional background", "Gemini Agent A: Career...", "..."],
    "verified_facts": ["Fact confirmed in Sources X and Y"],
    "estimated_facts": ["Estimated: net worth ~SAR 50M based on equity stake"],
    "caveats": "..."
  },
  "_pipelineStats": {
    "sourcesUsed": ["..."],
    "hasRealData": true,
    "researchThreads": 14,
    "geminiAgents": 4,
    "discoveredLinkedIn": "https://linkedin.com/in/..."
  }
}
```

---

### Quick Enrichment (lightweight, for lead saving)
```
POST /api/person-intel/quick
{ "name": "...", "company": "...", "title": "..." }
→ {
    ok: true,
    profile: {
      email: "...", phone: "...", linkedin: "...", nationality: "...",
      bio: "1–2 sentence professional bio",
      industry: "...", city: "...", seniority: "C-Level|VP|Director|Manager|Staff",
      companySize: "...", revenue: "..."
    }
  }
```
Claude Sonnet only (no web search). Returns in under 5 seconds. Used by the lead-saving flow to instantly enrich a person before adding them to a list.

---

### Save, Retrieve & Auto-Watchlist

```
POST /api/person-intel/save
{ "personName": "...", "company": "...", "title": "...", "linkedinUrl": "...",
  "sellerContext": {...}, "intelligenceGoals": [...], "knownFacts": "...",
  "report": {...}, "tags": "...", "notes": "..." }
→ saved row

Side effect: person is auto-seeded into the "ProsEngine Watchlist" lead list.
The watchlist is created automatically if it doesn't exist.
LinkedIn URL is extracted from the report and stored in the watchlist entry.

GET /api/person-intel/saved
→ all saved profiles, newest first

DELETE /api/person-intel/saved/:id
→ { ok: true }
```

---

## Tool 3 — Web Seeder (Paginated Multi-Agent Crawler)

**Endpoint:** `POST /api/company-intel/web-seed`

**Shared library:** `artifacts/api-server/src/lib/web-seeder.ts` — `runWebSeeder(rootUrl, companyName, options)`

The Web Seeder is a background-default feature. It runs automatically inside every ProspectSA tool whenever a website URL is available — no manual trigger required:

| Context | Behavior |
|---------|---------|
| **Company Intelligence** (`/profile`) | Runs as Source 1 in the 11 parallel sources. Up to 8 pages crawled. Full structured output fed into the synthesis context. |
| **Person Intelligence** (`/profile`) | Runs as the company website crawl agent when `websiteUrl` is provided. Serialized output (team, services, news, B2B signals) fed into synthesis context. |
| **Masar Database enrichment** | Fires as a detached `setImmediate()` background task after every `enrichMasarCompany()` DB write. Supplements DB record: fills `email`/`phone` if blank, populates `management[]` if empty, stores `enrichmentData.webSeeder` (services, b2bSignals, techStack, keyClients). |
| **Standalone endpoint** | `POST /api/company-intel/web-seed` — on-demand call for direct web seeding of any URL. |

The route handler delegates entirely to `runWebSeeder()` in the shared library. No duplicated crawling logic.

---

### How it works (4 phases)

```
Phase 1 — Page Discovery
  GET rootUrl → parse all internal links (same domain, no binary extensions)
  Add to crawl queue. Repeat link discovery for first 5 pages visited.
  Cap at maxPages (default 10, max 50)
  User-Agent: Windows Chrome 121 with Arabic language preference

Phase 2 — Page Classification (per URL, regex-based, Arabic+English)
  URL pattern matching → page type:
    about     → /about|من-نحن|about-us/
    services  → /service|خدمات|product|منتج/
    contact   → /contact|اتصل|reach/
    team      → /team|فريق|leadership|مدير/
    news      → /news|أخبار|blog|مدونة|press/
    careers   → /careers|وظائف|jobs/
    projects  → /project|مشروع|portfolio/
    general   → anything else
  seedMode filter applied after classification (see below)

Phase 3 — Per-Page AI Agent
  Each qualifying page → Claude Sonnet (claude-sonnet-4-6, 1,024 tokens, 20s timeout)
  Type-specific extraction prompt:
    about    → founding story, mission, vision, values, history, size, differentiators
    services → all services/products, descriptions, pricing signals, tech used, target customers
    contact  → physical addresses, phones, emails, offices, working hours, social media links
    team     → ALL named executives and titles (Arabic and English names)
    news     → recent announcements, contracts won, partnerships, expansions (last 3 items)
    careers  → open positions count, departments hiring, office locations, culture signals
    projects → key projects, client names, project values, sectors, achievements
    general  → company description, services, contact info, team names, key facts
  + regex extraction on raw page text (all pages regardless of AI result):
    Emails:  [a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}
    Phones:  (?:\+966|00966|0)[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{4}

Phase 4 — Aggregation Agent
  Claude Sonnet (claude-sonnet-4-6, 3,000 tokens, 45s timeout) merges all page intelligence
  Input: array of all page objects (url, type, title, extractedData) + all emails + all phones
  Output: unified structured profile (see response schema below)
  Fallback: if Claude times out, returns raw contacts + basic company stub + all page data
```

---

### seedMode Filter

| Value | Pages included |
|-------|---------------|
| `"all"` | All discovered pages (default) |
| `"content"` | about, services, team, news, projects — skips contact and careers |
| `"products"` | services and projects only |
| `"contact"` | contact and general only |

Pages that don't match the filter are skipped before the AI agent step (saves tokens).

---

### Request Body

```json
{
  "rootUrl": "https://company.com.sa",
  "maxPages": 10,
  "enableSeeder": true,
  "seedMode": "all",
  "companyName": "Optional company name hint for AI agents"
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `rootUrl` | string | required | Must include protocol (https://) |
| `maxPages` | number | 10 | Capped at 50 |
| `enableSeeder` | boolean | true | Set to false to skip entirely |
| `seedMode` | string | `"all"` | `"all"` \| `"content"` \| `"products"` \| `"contact"` |
| `companyName` | string | `""` | Passed to each page AI agent as context |

---

### Response Schema

```json
{
  "success": true,
  "rootUrl": "https://...",
  "pagesAnalyzed": 8,
  "seedMode": "all",
  "aggregated": {
    "company": {
      "nameEn": "...", "nameAr": "...",
      "description": "2–3 sentence description",
      "founded": "...", "industry": "...",
      "website": "https://...",
      "phone": "...", "email": "...", "address": "..."
    },
    "services": ["Service 1", "Service 2"],
    "team": [
      { "name": "Full Name", "title": "Title", "nameAr": "Arabic name" }
    ],
    "news": [
      { "headline": "...", "date": "approx YYYY-MM", "summary": "..." }
    ],
    "projects": [
      { "name": "...", "client": "...", "description": "..." }
    ],
    "contacts": {
      "emails": ["..."],
      "phones": ["..."],
      "offices": ["..."],
      "socialMedia": { "linkedin": "...", "twitter": "...", "instagram": "..." }
    },
    "intelligence": {
      "companySize": "1-10 | 11-50 | 51-200 | 201-500 | 500+ | unknown",
      "b2bSignals": ["Hiring aggressively", "New office opened", "..."],
      "techStack": ["SAP", "Salesforce", "..."],
      "keyClients": ["..."],
      "pagesCrawled": 8,
      "seedMode": "all"
    }
  },
  "pages": [
    {
      "url": "https://...",
      "pageType": "about | services | contact | team | news | careers | projects | general",
      "title": "Page title",
      "extractedData": { ... },
      "emails": ["..."],
      "phones": ["..."],
      "confidence": "high | low"
    }
  ],
  "allEmails": ["info@company.com", "sales@company.com"],
  "allPhones": ["+966 11 234 5678"]
}
```

`confidence` is `"high"` when the page returned more than 500 characters of content, `"low"` otherwise.

**Error response (no pages crawled):**
```json
{ "error": "No pages could be crawled from the provided URL", "rootUrl": "..." }
```

---

## Environment Variables

| Variable | Used By | Required |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | Company Intel synthesis, Person Intel synthesis + all agents, Web Seeder per-page agents + aggregation | Yes |
| `OPENAI_API_KEY` | Company Intel (GPT-4o fallback), Person Intel (GPT-4o agent F + synthesis fallback) | Yes |
| `GEMINI_API_KEY` | Company Intel (4 Gemini threads + synthesis), Person Intel (4 Gemini agents + synthesis) | Yes |
| `PERPLEXITY_API_KEY` | Company Intel (4 threads), Person Intel (9 threads) | Yes (graceful degradation to Gemini if absent) |
| `APOLLO_API_KEY` | Person Intel Agent 12 | Optional |
| `EXPLORIUM_API_KEY` | Person Intel Agent 13 | Optional |

---

## Key Files

| File | Contents |
|------|---------|
| `artifacts/api-server/src/routes/company-intel.ts` | Company Intelligence (profile, save, list, delete) + Web Seeder |
| `artifacts/api-server/src/routes/person-intel.ts` | Person Intelligence (profile, save, list, delete, quick) |
| `artifacts/prospect-sa/src/pages/company-intel/` | Company Intel UI |
| `artifacts/prospect-sa/src/pages/person-intel/` | Person Intel UI |
