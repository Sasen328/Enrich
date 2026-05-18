# Document 3: ProsEngine — 4-Tool Saudi Intelligence Suite
## Complete Standalone Replication Guide

---

## 1. WHAT THIS IS

ProsEngine is a suite of 4 AI-powered prospecting tools:

1. **Company Intel** (`/prospecting/company`) — 5-step wizard that generates a full B2B intelligence report on any Saudi company: profile, financials, ownership, leadership, market position, and sales approach
2. **Person Intel** (`/prospecting/person`) — 5-step wizard that generates a deep profile on a Saudi business executive: wealth estimate, background, company role, career, personal interests, competitive intel
3. **Website Intelligence** (`/prospecting/website`) — 3-phase pipeline: scan any website (directory or single company), extract companies/data, enrich each record. Also has a "Single Company" mode that researches one company from its own website URL
4. **Data Seeder** (`/prospecting/seeder`) — generates or extracts Saudi company/executive records via text prompt OR by scraping a URL

All 4 tools include an integrated AI chat (ProsEngineChat component) that appears after generation, letting users ask follow-up questions about the results.

**Cross-module context sharing**: Website Intel saves results to `localStorage["websiteIntelContext"]`. Person Intel and Data Seeder auto-read this on load to pre-fill their forms.

---

## 2. TECH STACK

Same as Documents 1 & 2. Additional:
```
xlsx / pptxgenjs  — for export in Website Intel
```

**Required env vars:**
```
ANTHROPIC_API_KEY   (or AI_INTEGRATIONS_ANTHROPIC_API_KEY)
OPENAI_API_KEY      (or AI_INTEGRATIONS_OPENAI_API_KEY)
GEMINI_API_KEY
PERPLEXITY_API_KEY
DATABASE_URL
```

---

## 3. DATABASE SCHEMA

```sql
-- ProsEngine Company Intel — saved reports
CREATE TABLE company_intel_research (
  id           SERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  report_data  JSONB,
  tags         TEXT,
  notes        TEXT,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- ProsEngine Person Intel — saved research profiles
CREATE TABLE prosengine_research (
  id           SERIAL PRIMARY KEY,
  person_name  TEXT NOT NULL,
  company      TEXT,
  title        TEXT,
  report       JSONB,
  tags         TEXT,
  notes        TEXT,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- Website Prospecting Jobs
CREATE TABLE prospecting_jobs (
  id                    SERIAL PRIMARY KEY,
  target_url            TEXT NOT NULL,
  status                TEXT DEFAULT 'pending',
  progress              INTEGER,
  result_count          INTEGER,
  total_companies_found INTEGER,
  total_enriched        INTEGER,
  error_message         TEXT,
  error                 TEXT,
  scan_result           JSONB,
  scan_summary          JSONB,
  pages_scanned         INTEGER,
  settings              JSONB,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW(),
  completed_at          TIMESTAMP
);

-- Website Prospecting Results (companies found per job)
CREATE TABLE prospecting_results (
  id                SERIAL PRIMARY KEY,
  job_id            INTEGER REFERENCES prospecting_jobs(id) ON DELETE CASCADE,
  company_data      JSONB,
  enrichment_status TEXT DEFAULT 'pending',
  source_url        TEXT,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Export history
CREATE TABLE export_history (
  id           SERIAL PRIMARY KEY,
  job_id       INTEGER REFERENCES prospecting_jobs(id) ON DELETE CASCADE,
  format       TEXT NOT NULL,
  filename     TEXT NOT NULL,
  record_count INTEGER DEFAULT 0,
  file_size    INTEGER DEFAULT 0,
  target_url   TEXT,
  created_at   TIMESTAMP DEFAULT NOW()
);
```

Drizzle ORM:
```typescript
import { pgTable, serial, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

export const companyIntelResearchTable = pgTable("company_intel_research", {
  id:          serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  reportData:  jsonb("report_data"),
  tags:        text("tags"),
  notes:       text("notes"),
  createdAt:   timestamp("created_at").defaultNow(),
});

export const prosengineResearchTable = pgTable("prosengine_research", {
  id:         serial("id").primaryKey(),
  personName: text("person_name").notNull(),
  company:    text("company"),
  title:      text("title"),
  report:     jsonb("report"),
  tags:       text("tags"),
  notes:      text("notes"),
  createdAt:  timestamp("created_at").defaultNow(),
});

export const prospectingJobsTable = pgTable("prospecting_jobs", {
  id:                  serial("id").primaryKey(),
  targetUrl:           text("target_url").notNull(),
  status:              text("status").default("pending"),
  progress:            integer("progress"),
  resultCount:         integer("result_count"),
  totalCompaniesFound: integer("total_companies_found"),
  totalEnriched:       integer("total_enriched"),
  errorMessage:        text("error_message"),
  error:               text("error"),
  scanResult:          jsonb("scan_result"),
  scanSummary:         jsonb("scan_summary"),
  pagesScanned:        integer("pages_scanned"),
  settings:            jsonb("settings"),
  createdAt:           timestamp("created_at").defaultNow(),
  updatedAt:           timestamp("updated_at").defaultNow(),
  completedAt:         timestamp("completed_at"),
});

export const prospectingResultsTable = pgTable("prospecting_results", {
  id:               serial("id").primaryKey(),
  jobId:            integer("job_id").references(() => prospectingJobsTable.id, { onDelete: "cascade" }),
  companyData:      jsonb("company_data"),
  enrichmentStatus: text("enrichment_status").default("pending"),
  sourceUrl:        text("source_url"),
  createdAt:        timestamp("created_at").defaultNow(),
});
```

---

## 4. TOOL 1: COMPANY INTEL

### 4a. Frontend Wizard — 5 Steps

**Step 1 — Company**: Company name (text), website URL (optional), CR number (optional), city (dropdown)

**Step 2 — Your Context**: Your company name, your product/service you're selling

**Step 3 — Intelligence Goals** (multi-select checkboxes):
- `profile` — Company overview & history
- `financials` — Revenue, capital & financial health
- `ownership` — Shareholders & ownership structure
- `leadership` — Executives & board of directors
- `market` — Competitive positioning & market share
- `approach` — Sales approach & contact strategy

**Step 4 — Research Objectives** (multi-select):
- Identify key decision makers
- Understand ownership structure
- Assess financial capacity
- Map competitive landscape
- Find entry point for sales
- Evaluate partnership potential
- Assess compliance & reputation

**Step 5 — Known Facts**: Free-text textarea for any additional context

```typescript
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CompanyWizardForm {
  companyName: string;
  website: string;
  crNumber: string;
  city: string;
  sellerCompany: string;
  sellerProduct: string;
  intelligenceGoals: string[];
  objectives: string[];
  knownFacts: string;
}

const GOALS = [
  { id: "profile",    label: "Company Profile",     icon: Building2,   desc: "Overview, history, legal form" },
  { id: "financials", label: "Financial Health",     icon: DollarSign,  desc: "Revenue, capital, performance" },
  { id: "ownership",  label: "Ownership Structure",  icon: Users,       desc: "Shareholders, ownership %" },
  { id: "leadership", label: "Leadership & Board",   icon: User,        desc: "Executives, board members" },
  { id: "market",     label: "Market Intelligence",  icon: BarChart3,   desc: "Competitors, market position" },
  { id: "approach",   label: "Sales Approach",       icon: Target,      desc: "How to engage & sell" },
];

const OBJECTIVES = [
  "Identify key decision makers",
  "Understand ownership structure",
  "Assess financial capacity",
  "Map competitive landscape",
  "Find entry point for sales",
  "Evaluate partnership potential",
  "Assess compliance & reputation",
];

const SAUDI_CITIES = [
  "Riyadh", "Jeddah", "Dammam", "Khobar", "Mecca", "Medina",
  "Tabuk", "Abha", "Taif", "Jubail", "Yanbu", "Najran",
  "Hail", "Qassim / Buraydah", "Other",
];

// Generate report
const generateReport = async (form: CompanyWizardForm) => {
  const res = await fetch(`${BASE}/api/company-intel/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName: form.companyName,
      website: form.website || undefined,
      crNumber: form.crNumber || undefined,
      city: form.city || undefined,
      sellerContext: {
        companyName: form.sellerCompany || undefined,
        product: form.sellerProduct || undefined,
        objectives: form.objectives,
      },
      intelligenceGoals: form.intelligenceGoals,
      knownFacts: form.knownFacts || undefined,
    }),
  });
  if (!res.ok) throw new Error("Generation failed");
  return res.json();
};

// Save report
const saveReport = async (companyName: string, reportData: unknown, notes?: string) => {
  await fetch(`${BASE}/api/company-intel/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyName, reportData, notes }),
  });
};
```

### 4b. Backend — company-intel.ts

```typescript
// POST /api/company-intel/profile
router.post("/company-intel/profile", async (req, res) => {
  const { companyName, website, crNumber, city, sellerContext, intelligenceGoals, knownFacts } = req.body;

  if (!companyName?.trim()) { res.status(400).json({ error: "companyName is required" }); return; }

  const crRef = crNumber ? ` (CR: ${crNumber})` : "";
  const cityRef = city ? `, ${city}` : "";
  const goals = intelligenceGoals || ["profile", "financials", "ownership", "leadership", "market", "approach"];

  // ── Phase 1: Parallel research across all AI sources ──────────────────────
  const [
    websiteCrawl,
    geminiProfile, geminiOwnership, geminiLeadership, geminiMarket,
    searchProfile, searchFinancials, searchOwnership, searchLeadership,
    claudeRes, openaiRes,
  ] = await Promise.allSettled([
    // Web Seeder: multi-page crawler (if URL provided)
    website ? runWebSeeder(website, companyName, { maxPages: 8 }) : Promise.resolve(null),

    // Gemini Chrome AI ×4
    isGeminiConfigured()
      ? searchWithGemini(`Saudi company "${companyName}"${crRef}${cityRef}: official website, phone, email, street address, founding year, legal form, CR number, paid-up capital, employees, revenue estimate SAR, business activities, industry. Browse company website and Saudi commercial registry. Verified data only.`)
      : Promise.resolve(null),
    goals.includes("ownership") && isGeminiConfigured()
      ? searchWithGemini(`"${companyName}" Saudi Arabia${crRef} shareholders owners ownership percentage مساهمون ملاك نسبة الملكية — exact full names in Arabic and English with ownership percentages. Search Saudi commercial registry mc.gov.sa, emagazine.aamaly.sa, and news.`)
      : Promise.resolve(null),
    goals.includes("leadership") && isGeminiConfigured()
      ? searchWithGemini(`"${companyName}" Saudi Arabia${cityRef} CEO chairman GM CFO COO board executives مدير عام رئيس مجلس الإدارة — full verified names Arabic and English with exact titles. Check LinkedIn, news, Saudi business directories.`)
      : Promise.resolve(null),
    goals.includes("market") && isGeminiConfigured()
      ? searchWithGemini(`"${companyName}" Saudi Arabia market position competitors market share strengths weaknesses notable clients key projects revenue growth 2023 2024 2025.`)
      : Promise.resolve(null),

    // Perplexity ×4
    webSearch(`Saudi company "${companyName}"${crRef}${cityRef}: official website, phone, email, address, revenue SAR, employees, description, business activities, founding year.`),
    goals.includes("financials")
      ? webSearch(`"${companyName}" Saudi Arabia annual revenue financial performance paid-up capital إيرادات أرباح رأس المال — most recent 2022 2023 2024.`)
      : Promise.resolve(""),
    goals.includes("ownership")
      ? webSearch(`"${companyName}" Saudi Arabia shareholders مساهمون عقد التأسيس owners ownership percentage board composition — names Arabic and English with percentages.`)
      : Promise.resolve(""),
    goals.includes("leadership")
      ? webSearch(`"${companyName}" Saudi Arabia CEO managing director chairman executives board أعضاء مجلس الإدارة مدير عام رئيس تنفيذي — full names Arabic and English 2024 2025.`)
      : Promise.resolve(""),

    // Claude
    (async () => {
      const msg = await Promise.race([
        anthropic.messages.create({
          model: "claude-sonnet-4-6", max_tokens: 2000,
          messages: [{ role: "user", content: `Research Saudi company "${companyName}"${crRef}${cityRef}. Provide ALL verified public information:
1. Company overview: legal form, founding year, main activities
2. Ownership: shareholders with names EN+AR and ownership %
3. Leadership: CEO/GM, board chairman, key executives (names EN+AR, titles)
4. Financials: revenue estimate SAR, employees, paid-up capital
5. Market: competitors, notable clients, market position
6. Contact: website, phone, email, address
Only real verified data.` }],
        }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 30000)),
      ]);
      return msg.content[0]?.type === "text" ? msg.content[0].text : null;
    })(),

    // OpenAI
    (async () => {
      const r = await Promise.race([
        openai.chat.completions.create({
          model: "gpt-4o", max_completion_tokens: 1000,
          messages: [
            { role: "system", content: "You are a Saudi Arabia B2B intelligence analyst." },
            { role: "user", content: `Research Saudi company "${companyName}"${crRef}. Provide: CEO name EN+AR, shareholders, revenue, employees, website, industry, city, key executives.` },
          ],
        }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 25000)),
      ]);
      return r.choices[0]?.message?.content || null;
    })(),
  ]);

  // Collect research
  const parts: string[] = [];
  const websiteData = websiteCrawl.status === "fulfilled" ? websiteCrawl.value : null;
  if (websiteData?.text) parts.push(`[Website Content]\n${websiteData.text.slice(0, 5000)}`);
  const allResults = [geminiProfile, geminiOwnership, geminiLeadership, geminiMarket, searchProfile, searchFinancials, searchOwnership, searchLeadership, claudeRes, openaiRes];
  const labels = ["Gemini Profile", "Gemini Ownership", "Gemini Leadership", "Gemini Market", "Perplexity Profile", "Perplexity Financials", "Perplexity Ownership", "Perplexity Leadership", "Claude Research", "OpenAI Research"];
  allResults.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      const text = String(r.value);
      if (text.length > 50) parts.push(`[${labels[i]}]\n${text.slice(0, 3000)}`);
    }
  });

  // ── Phase 2: Synthesis with Claude ───────────────────────────────────────
  const combinedResearch = parts.join("\n\n---\n\n").slice(0, 14000);
  const sellerInfo = sellerContext?.companyName
    ? `\nSeller Context: ${sellerContext.companyName} is selling "${sellerContext.product || "their product/service"}". Objectives: ${(sellerContext.objectives || []).join(", ")}.`
    : "";
  const knownFactsSection = knownFacts ? `\nKnown Facts (provided by user): ${knownFacts}` : "";

  const synthesisPrompt = `You are an elite Saudi Arabia B2B intelligence analyst. Generate a complete intelligence report for: "${companyName}"${crRef}${cityRef}.
${sellerInfo}${knownFactsSection}

Research data (14 sources):
${combinedResearch}

Return ONLY valid JSON matching this exact structure:
{
  "nameEn": "Company name in English",
  "nameAr": "اسم الشركة بالعربية",
  "legalForm": "LLC/Joint Stock/etc",
  "legalFormAr": "شركة ذات مسؤولية محدودة/etc",
  "crNumber": "10-digit CR or null",
  "founded": "YYYY",
  "city": "city",
  "region": "region",
  "industry": "primary industry",
  "subIndustry": "sub-sector or null",
  "paidUpCapital": "SAR X,XXX,XXX",
  "revenue": "SAR X - Y million",
  "revenueRationale": "basis for estimate",
  "employees": "number or range",
  "website": "https://...",
  "phone": "+966...",
  "email": "...",
  "address": "full address",
  "ceo": "CEO/GM name in English",
  "ceoAr": "اسم المدير العام بالعربية",
  "regulator": "SAMA/CMA/MOH/etc or null",
  "description": "2-3 sentence company description",
  "shareholders": [{"nameEn":"","nameAr":"","ownershipPct":"","nationality":""}],
  "management": [{"nameEn":"","nameAr":"","title":""}],
  "board": [{"nameEn":"","nameAr":"","role":""}],
  "products": ["main products/services"],
  "clients": ["notable clients if known"],
  "competitors": ["main competitors"],
  "strengths": ["key competitive strengths"],
  "marketPosition": "market position description",
  "recentNews": "recent news or developments",
  "aiInsights": "actionable intelligence for a B2B salesperson${sellerContext?.companyName ? ` from ${sellerContext.companyName}` : ""}",
  "salesApproach": "recommended sales approach and talking points${sellerContext?.product ? ` for ${sellerContext.product}` : ""}",
  "decisionMakers": [{"name":"","title":"","influence":"high/medium/low","notes":""}],
  "procurementStyle": "how this company typically buys",
  "redFlags": ["any concerns or risks"],
  "overallScore": "1-10 attractiveness as a prospect"
}`;

  const synthesisResult = await Promise.race([
    anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: synthesisPrompt }],
    }),
    new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 50000)),
  ]);

  const synthesisText = synthesisResult.content[0]?.type === "text" ? synthesisResult.content[0].text : "";
  const match = synthesisText.match(/\{[\s\S]*\}/);
  const report = match ? JSON.parse(match[0]) : { nameEn: companyName, description: "Research completed", aiInsights: parts.join("\n").slice(0, 1000) };

  res.json(report);
});

// POST /api/company-intel/save
router.post("/company-intel/save", async (req, res) => {
  const { companyName, reportData, tags, notes } = req.body;
  const [saved] = await db.insert(companyIntelResearchTable).values({
    companyName, reportData, tags, notes,
  }).returning();
  res.json({ id: saved.id, success: true });
});

// GET /api/company-intel/saved
router.get("/company-intel/saved", async (req, res) => {
  const records = await db.select().from(companyIntelResearchTable).orderBy(desc(companyIntelResearchTable.createdAt)).limit(50);
  res.json(records);
});
```

---

## 5. TOOL 2: PERSON INTEL

### 5a. Frontend Wizard — 5 Steps

**Step 1 — Identity**: Full name (required), Arabic name (optional), company, title

**Step 2 — Your Context**: Your company, your product/service

**Step 3 — Intelligence Goals** (multi-select):
- `wealth` — Net worth & wealth estimation
- `approach` — How to approach & engage this person
- `company` — Their role in the company
- `career` — Career background & trajectory
- `personal` — Personal interests & background
- `competitive` — Their relationship with competitors

**Step 4 — Known Facts**: Free-text for additional context

**Step 5 — Generate**

**Auto-hydration from Website Intelligence** (runs on mount):
```typescript
useEffect(() => {
  try {
    const raw = localStorage.getItem("websiteIntelContext");
    if (!raw) return;
    const ctx = JSON.parse(raw) as {
      companyName?: string;
      executives?: Array<{ name: string; title?: string }>;
      industry?: string;
      city?: string;
      generatedAt?: string;
    };
    if (ctx.executives?.length > 0 && !form.name) {
      const exec = ctx.executives[0];
      setForm(f => ({
        ...f,
        name: exec.name || f.name,
        title: exec.title || f.title,
        company: ctx.companyName || f.company,
      }));
      const age = ctx.generatedAt
        ? Math.round((Date.now() - new Date(ctx.generatedAt).getTime()) / 60000)
        : null;
      setContextBanner(`Auto-filled from Website Intelligence: ${ctx.companyName}${age !== null && age < 60 ? ` (${age}m ago)` : ""}`);
    }
  } catch { /* ignore */ }
}, []);
```

```typescript
const PERSON_GOALS = [
  { id: "wealth",      label: "Wealth Profile",       icon: DollarSign, desc: "Net worth, assets, business holdings" },
  { id: "approach",    label: "Engagement Approach",  icon: Target,     desc: "How to approach and build rapport" },
  { id: "company",     label: "Company Role",         icon: Building2,  desc: "Role, influence, decision authority" },
  { id: "career",      label: "Career Background",    icon: Briefcase,  desc: "Career history and trajectory" },
  { id: "personal",    label: "Personal Background",  icon: User,       desc: "Interests, education, family" },
  { id: "competitive", label: "Competitive Intel",    icon: Shield,     desc: "Relationships with competitors" },
];

// Generate person profile
const generatePersonProfile = async (form: PersonForm) => {
  const res = await fetch(`${BASE}/api/person-intel/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: form.name,
      nameAr: form.nameAr || undefined,
      company: form.company || undefined,
      title: form.title || undefined,
      sellerContext: {
        companyName: form.sellerCompany || undefined,
        product: form.sellerProduct || undefined,
      },
      intelligenceGoals: form.goals,
      knownFacts: form.knownFacts || undefined,
    }),
  });
  if (!res.ok) throw new Error("Generation failed");
  return res.json();
};
```

### 5b. Backend — person-intel.ts

```typescript
// POST /api/person-intel/profile
router.post("/person-intel/profile", async (req, res) => {
  const { name, nameAr, company, title, sellerContext, intelligenceGoals, knownFacts } = req.body;

  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  const companyRef = company ? ` at ${company}` : "";
  const titleRef = title ? `, ${title}` : "";
  const goals = intelligenceGoals || ["wealth", "approach", "company", "career", "personal"];

  // Parallel research
  const [
    geminiProfile, geminiWealth, geminiCareer,
    perplexityProfile, perplexityWealth,
    claudeRes, openaiRes,
  ] = await Promise.allSettled([
    // Gemini — personal profile
    isGeminiConfigured()
      ? searchWithGemini(`"${name}"${titleRef}${companyRef} Saudi Arabia — LinkedIn profile, career history, education, board memberships, business ventures, public speaking, awards. Verified data only.`)
      : Promise.resolve(null),

    // Gemini — wealth & assets
    goals.includes("wealth") && isGeminiConfigured()
      ? searchWithGemini(`"${name}" Saudi Arabia${companyRef} net worth wealth estimate SAR personal assets company ownership percentage property investments. Business holdings.`)
      : Promise.resolve(null),

    // Gemini — career
    goals.includes("career") && isGeminiConfigured()
      ? searchWithGemini(`"${name}" Saudi Arabia career history previous companies roles experience education university background industry expertise.`)
      : Promise.resolve(null),

    // Perplexity — general profile
    webSearch(`"${name}"${titleRef}${companyRef} Saudi Arabia profile background career education LinkedIn news.`),

    // Perplexity — wealth
    goals.includes("wealth")
      ? webSearch(`"${name}" Saudi Arabia net worth wealth assets company ownership property investments SAR estimated value.`)
      : Promise.resolve(""),

    // Claude
    (async () => {
      const msg = await Promise.race([
        anthropic.messages.create({
          model: "claude-sonnet-4-6", max_tokens: 2000,
          messages: [{ role: "user", content: `Research the Saudi business executive "${name}"${titleRef}${companyRef}. Provide:
1. Career background: previous roles, companies, career trajectory
2. Education: university, degrees, specializations
3. Board memberships and business ventures
4. Public profile: news mentions, speeches, industry role
5. Personal: known interests, charity work, public activities
6. At their company: decision-making authority, team size, budget influence
7. How to approach them: preferred communication style, interests alignment
Only verified public data.` }],
        }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 30000)),
      ]);
      return msg.content[0]?.type === "text" ? msg.content[0].text : null;
    })(),

    // OpenAI
    (async () => {
      const r = await Promise.race([
        openai.chat.completions.create({
          model: "gpt-4o", max_completion_tokens: 1000,
          messages: [
            { role: "system", content: "You are a Saudi Arabia executive intelligence analyst." },
            { role: "user", content: `What is publicly known about "${name}"${titleRef} at ${company || "their company"} in Saudi Arabia? Career, education, business ventures, network.` },
          ],
        }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 25000)),
      ]);
      return r.choices[0]?.message?.content || null;
    })(),
  ]);

  // Collect research
  const parts: string[] = [];
  const allResults = [geminiProfile, geminiWealth, geminiCareer, perplexityProfile, perplexityWealth, claudeRes, openaiRes];
  const labels = ["Gemini Profile", "Gemini Wealth", "Gemini Career", "Perplexity Profile", "Perplexity Wealth", "Claude Research", "OpenAI Research"];
  allResults.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      const text = String(r.value);
      if (text.length > 30) parts.push(`[${labels[i]}]\n${text.slice(0, 3000)}`);
    }
  });

  const combinedResearch = parts.join("\n\n---\n\n").slice(0, 10000);
  const sellerInfo = sellerContext?.companyName
    ? `\nSeller Context: ${sellerContext.companyName} selling "${sellerContext.product || "product/service"}"`
    : "";
  const knownSection = knownFacts ? `\nKnown Facts: ${knownFacts}` : "";

  const synthesisPrompt = `You are an elite Saudi Arabia executive intelligence analyst. Build a complete profile for: "${name}"${titleRef}${companyRef}.
${sellerInfo}${knownSection}

Research data:
${combinedResearch}

Return ONLY valid JSON:
{
  "nameEn": "Full name in English",
  "nameAr": "الاسم الكامل بالعربية",
  "title": "Current title",
  "company": "${company || ""}",
  "nationality": "Saudi/Other",
  "age": "estimated age or null",
  "education": "degrees and universities",
  "careerSummary": "2-3 sentence career summary",
  "careerHistory": [{"company":"","role":"","years":"","notes":""}],
  "boardMemberships": ["company name — role"],
  "businessVentures": ["other companies owned or invested"],
  "netWorthEstimate": "SAR X - Y million estimated",
  "wealthSources": ["main sources of wealth"],
  "assets": ["known assets: property, companies, investments"],
  "personalInterests": ["known personal interests"],
  "publicProfile": "LinkedIn URL or other public profile if known",
  "newsHighlights": [{"headline":"","date":"","source":""}],
  "decisionAuthority": "high/medium/limited — description",
  "budgetInfluence": "estimated budget authority SAR",
  "reportingTo": "who they report to if known",
  "teamSize": "team/department size if known",
  "communicationStyle": "how they prefer to communicate",
  "bestApproachTime": "best time/method to reach",
  "valueDrivers": ["what they care about professionally"],
  "engagementStrategy": "recommended strategy for ${sellerContext?.companyName || "a salesperson"} approaching this executive",
  "talkingPoints": ["specific talking points for approach"],
  "commonConnections": ["mutual connections or common ground if found"],
  "competitorRelationships": ["known relationships with competitors"],
  "redFlags": ["any concerns"],
  "overallScore": "1-10 as a potential business contact"
}`;

  const synthesisResult = await Promise.race([
    anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3500,
      messages: [{ role: "user", content: synthesisPrompt }],
    }),
    new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 45000)),
  ]);

  const synthesisText = synthesisResult.content[0]?.type === "text" ? synthesisResult.content[0].text : "";
  const match = synthesisText.match(/\{[\s\S]*\}/);
  const report = match ? JSON.parse(match[0]) : { nameEn: name, careerSummary: "Research completed" };

  res.json(report);
});

// POST /api/person-intel/save
router.post("/person-intel/save", async (req, res) => {
  const { personName, company, title, report, tags, notes } = req.body;
  const [saved] = await db.insert(prosengineResearchTable).values({
    personName, company, title, report, tags, notes,
  }).returning();
  res.json({ id: saved.id, success: true });
});
```

---

## 6. TOOL 3: WEBSITE INTELLIGENCE

### 6a. Architecture

Website Intel has two sub-modes:

**Directory Scan Mode** (5-step):
1. Enter URL of a company directory/listing website
2. Backend scans the site (scans pages, detects data type, generates tailored questions) → SSE polling
3. User configures extraction: fields to extract, max pages, enrichment depth, language, answers to tailored questions
4. Backend extracts + enriches all companies
5. Results view with expandable company cards + export

**Single Company Mode** (3-step):
1. Enter the company's own website URL
2. Backend researches that single company → POST to `/api/prosengine/research-url`
3. Full company profile displayed with AI chat sidebar + save to leads

### 6b. API Routes (prospecting.ts + prosengine-chat.ts)

```typescript
// ── Directory Scan Routes ──────────────────────────────────────────────────

// POST /api/prospecting/scan — initiate site scan
router.post("/prospecting/scan", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  const [job] = await db.insert(prospectingJobsTable).values({
    targetUrl: url,
    status: "scanning",
  }).returning();

  res.json(job);

  // Background: scan site, detect data type, generate questions
  setImmediate(async () => {
    try {
      const scanData = await scanWebsite(url);

      // Use Gemini to analyze site and generate tailored questions
      const analysisPrompt = `Analyze this website: ${url}
Page samples: ${JSON.stringify(scanData.samples).slice(0, 3000)}

Return JSON:
{
  "dataType": "company-directory / product-catalog / news-site / etc",
  "siteDescription": "what kind of data this site contains",
  "sampleCompanies": ["up to 5 company names you can see"],
  "suggestedFields": ["name", "phone", "email", "address", "industry", "city", "website", "crNumber", "description"],
  "categories": ["categories of listings if present"],
  "cities": ["cities mentioned"],
  "industries": ["industries present"],
  "paginationType": "page-numbers / load-more / infinite-scroll",
  "websiteType": "saudi-chamber / yellow-pages / trade-directory / professional-association / etc",
  "contentLanguage": "arabic / english / bilingual",
  "totalPages": estimated_number_or_null,
  "suggestedQuestions": [
    {"question": "Do you want to filter by city?", "options": ["Yes - specific city", "No - all cities"]},
    {"question": "Which data fields are most important?", "options": ["Contact info", "Financial data", "Company profile", "All available"]}
  ]
}`;

      const analysisRes = await searchWithGemini(analysisPrompt).catch(() => null)
        || await openai.chat.completions.create({ model: "gpt-4o", max_completion_tokens: 1000, messages: [{ role: "user", content: analysisPrompt }] })
          .then(r => r.choices[0]?.message?.content || null).catch(() => null);

      let scanSummary = null;
      if (analysisRes) {
        const match = String(analysisRes).match(/\{[\s\S]*\}/);
        if (match) scanSummary = JSON.parse(match[0]);
      }

      await db.update(prospectingJobsTable).set({
        status: "scanned",
        scanSummary,
        scanResult: { progressMessage: "Site analyzed — ready to configure extraction" },
        pagesScanned: scanData.pagesScanned || 1,
        updatedAt: new Date(),
      }).where(eq(prospectingJobsTable.id, job.id));
    } catch (err) {
      await db.update(prospectingJobsTable).set({
        status: "failed",
        error: (err as Error).message,
        updatedAt: new Date(),
      }).where(eq(prospectingJobsTable.id, job.id));
    }
  });
});

// POST /api/prospecting/:jobId/extract — start extraction with user settings
router.post("/prospecting/:jobId/extract", async (req, res) => {
  const jobId = parseInt(req.params.jobId);
  const { settings } = req.body as {
    settings: {
      maxPages: number;
      enrichmentDepth: string;
      extractionLanguage: string;
      extractionFields: string[];
      userAnswers: Record<string, string | string[]>;
    }
  };

  const [job] = await db.select().from(prospectingJobsTable)
    .where(eq(prospectingJobsTable.id, jobId)).limit(1);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const updated = await db.update(prospectingJobsTable).set({
    status: "extracting",
    settings,
    updatedAt: new Date(),
  }).where(eq(prospectingJobsTable.id, jobId)).returning();

  res.json(updated[0]);

  // Background: extract all companies from the site
  setImmediate(async () => {
    try {
      const targetUrl = job.targetUrl;
      let allCompanies: CompanyData[] = [];
      let pagesScanned = 0;

      // Use the prospecting engine to crawl with Puppeteer + AI extraction
      for (let page = 1; page <= (settings.maxPages || 50); page++) {
        const pageUrl = buildPageUrl(targetUrl, page);
        const pageData = await crawlPageWithAI(pageUrl, settings.extractionFields, settings.userAnswers);
        if (!pageData || pageData.companies.length === 0) break;

        allCompanies.push(...pageData.companies);
        pagesScanned++;

        await db.update(prospectingJobsTable).set({
          totalCompaniesFound: allCompanies.length,
          pagesScanned,
          updatedAt: new Date(),
          scanResult: { progressMessage: `Page ${page}: found ${pageData.companies.length} companies` },
        }).where(eq(prospectingJobsTable.id, jobId));

        if (pageData.isLastPage) break;
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
      }

      // Save raw results to DB
      for (const company of allCompanies) {
        await db.insert(prospectingResultsTable).values({
          jobId,
          companyData: company,
          enrichmentStatus: "pending",
          sourceUrl: company.sourceUrl || targetUrl,
        });
      }

      // Enrich if depth > basic
      if (settings.enrichmentDepth !== "none") {
        await db.update(prospectingJobsTable).set({ status: "enriching", updatedAt: new Date() })
          .where(eq(prospectingJobsTable.id, jobId));

        let enriched = 0;
        const resultRows = await db.select().from(prospectingResultsTable)
          .where(eq(prospectingResultsTable.jobId, jobId));

        for (const row of resultRows) {
          const company = row.companyData as CompanyData;
          if (!company?.name && !company?.nameEn) continue;

          const enriched_data = await enrichSingleCompany(
            company, settings.enrichmentDepth, settings.extractionLanguage
          ).catch(() => null);

          if (enriched_data) {
            await db.update(prospectingResultsTable).set({
              companyData: { ...company, ...enriched_data },
              enrichmentStatus: "enriched",
            }).where(eq(prospectingResultsTable.id, row.id));
            enriched++;
            await db.update(prospectingJobsTable).set({ totalEnriched: enriched, updatedAt: new Date() })
              .where(eq(prospectingJobsTable.id, jobId));
          }
        }
      }

      await db.update(prospectingJobsTable).set({
        status: "completed",
        totalCompaniesFound: allCompanies.length,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(prospectingJobsTable.id, jobId));
    } catch (err) {
      await db.update(prospectingJobsTable).set({
        status: "failed",
        error: (err as Error).message,
        updatedAt: new Date(),
      }).where(eq(prospectingJobsTable.id, jobId));
    }
  });
});

// GET /api/prospecting — list all jobs
router.get("/prospecting", async (req, res) => {
  const jobs = await db.select().from(prospectingJobsTable)
    .orderBy(desc(prospectingJobsTable.createdAt)).limit(50);
  res.json(jobs);
});

// GET /api/prospecting/:jobId — single job
router.get("/prospecting/:jobId", async (req, res) => {
  const [job] = await db.select().from(prospectingJobsTable)
    .where(eq(prospectingJobsTable.id, parseInt(req.params.jobId))).limit(1);
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  res.json(job);
});

// GET /api/prospecting/:jobId/results — get extracted companies
router.get("/prospecting/:jobId/results", async (req, res) => {
  const results = await db.select().from(prospectingResultsTable)
    .where(eq(prospectingResultsTable.jobId, parseInt(req.params.jobId)))
    .orderBy(prospectingResultsTable.id).limit(500);
  res.json(results);
});

// DELETE /api/prospecting/:jobId
router.delete("/prospecting/:jobId", async (req, res) => {
  await db.delete(prospectingJobsTable)
    .where(eq(prospectingJobsTable.id, parseInt(req.params.jobId)));
  res.json({ success: true });
});

// POST /api/prospecting/:jobId/export — export to CSV/Excel/JSON/PDF
router.post("/prospecting/:jobId/export", async (req, res) => {
  const { format } = req.body as { format: "csv" | "xlsx" | "json" | "pdf" };
  const jobId = parseInt(req.params.jobId);
  const results = await db.select().from(prospectingResultsTable)
    .where(eq(prospectingResultsTable.jobId, jobId));

  const companies = results.map(r => r.companyData as Record<string, unknown>).filter(Boolean);
  const filename = `prospecting-${jobId}-${Date.now()}.${format}`;

  if (format === "csv") {
    const keys = [...new Set(companies.flatMap(c => Object.keys(c as Record<string, unknown>)))];
    const csv = [keys.join(","), ...companies.map(c => keys.map(k => `"${String((c as any)[k] || "").replace(/"/g, '""')}"`).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // Save to export history
    await db.insert(exportHistoryTable).values({ jobId, format, filename, recordCount: companies.length, fileSize: csv.length });
    res.send(csv);
    return;
  }
  if (format === "json") {
    const json = JSON.stringify(companies, null, 2);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(json);
    return;
  }
  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(companies);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Companies");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const base64 = buf.toString("base64");
    res.json({ content: base64, filename, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    return;
  }
});

// GET /api/prospecting/exports/history — export history
router.get("/prospecting/exports/history", async (req, res) => {
  const history = await db.select().from(exportHistoryTable).orderBy(desc(exportHistoryTable.createdAt)).limit(50);
  res.json(history);
});

// ── Single Company Research ────────────────────────────────────────────────

// POST /api/prosengine/research-url — research a single company by website
router.post("/prosengine/research-url", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  // Crawl the website
  const crawlRes = await runWebSeeder(url, "", { maxPages: 8 }).catch(() => null);
  const siteText = crawlRes?.text || "";

  // Research with Gemini + Claude
  const [geminiRes, claudeRes] = await Promise.allSettled([
    isGeminiConfigured()
      ? searchWithGemini(`Research the company at ${url}: company name, industry, city, phone, email, founding year, legal form, CR number, paid-up capital, employees, revenue, CEO name, shareholders, main products/services. Browse this URL and Saudi registries. Verified data only.`)
      : Promise.resolve(null),
    (async () => {
      const msg = await Promise.race([
        anthropic.messages.create({
          model: "claude-sonnet-4-6", max_tokens: 2000,
          messages: [{ role: "user", content: `Analyze this Saudi company website content and extract ALL available information:\n\nURL: ${url}\n\nWebsite content:\n${siteText.slice(0, 6000)}\n\nReturn JSON with all fields you can find: nameEn, nameAr, industry, city, phone, email, address, crNumber, legalForm, paidUpCapital, founded, employees, revenue, ceo, ceoAr, shareholders, management, board, products, clients, description, aiInsights.` }],
        }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 30000)),
      ]);
      return msg.content[0]?.type === "text" ? msg.content[0].text : null;
    })(),
  ]);

  // Parse and merge results
  let profile: Record<string, unknown> = {};
  const sources = [geminiRes, claudeRes];
  for (const src of sources) {
    if (src.status === "fulfilled" && src.value) {
      const text = String(src.value);
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          profile = { ...profile, ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v != null && v !== "" && v !== "null")) };
        } catch { /* ignore */ }
      }
    }
  }

  res.json({ profile, url });
});
```

### 6c. Frontend State Machine (website.tsx key logic)

```typescript
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Mode: "directory" (scan list of companies) or "single" (research one company)
const [urlMode, setUrlMode] = useState<"directory" | "single">("directory");

// Directory mode state
const [step, setStep] = useState(1); // 1=URL, 2=Scanning, 3=Configure, 4=Extraction, 5=Results
const [url, setUrl] = useState("");
const [activeJobId, setActiveJobId] = useState<number | null>(null);
const [job, setJob] = useState<ProspectingJob | null>(null);
const [results, setResults] = useState<ProspectingResult[]>([]);

// Configuration state (step 3)
const [maxPages, setMaxPages] = useState(50);
const [enrichmentDepth, setEnrichmentDepth] = useState<string>("deep");
const [extractionLanguage, setExtractionLanguage] = useState<string>("english");
const [reportFields, setReportFields] = useState<Record<string, boolean>>({
  ownerName: true, landline: true, email: true, crNumber: true,
  revenue: true, employees: true, shareholders: true, keyPeople: true,
});
const [answers, setAnswers] = useState<Record<string, string[]>>({});

// Single company mode state
const [companyProfile, setCompanyProfile] = useState<Record<string, unknown> | null>(null);
const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);

// Polling for directory scan
const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

const startPolling = (jobId: number) => {
  if (pollRef.current) clearInterval(pollRef.current);
  let failCount = 0;
  const poll = async () => {
    try {
      const updated = await fetch(`${BASE}/api/prospecting/${jobId}`).then(r => r.json());
      setJob(updated);
      failCount = 0;
      if (updated.status === "scanned") { clearInterval(pollRef.current!); setStep(3); }
      else if (updated.status === "extracting" || updated.status === "enriching") {
        const r = await fetch(`${BASE}/api/prospecting/${jobId}/results`).then(r => r.json());
        setResults(r);
      } else if (updated.status === "completed") {
        clearInterval(pollRef.current!);
        const r = await fetch(`${BASE}/api/prospecting/${jobId}/results`).then(r => r.json());
        setResults(r);
        setStep(5);
        // Write to localStorage for cross-module context
        try {
          const companies = r.slice(0, 50).map((c: any) => ({
            name: c.companyData?.nameEn || c.companyData?.name || "",
            industry: c.companyData?.industry || "",
          })).filter((c: any) => c.name);
          localStorage.setItem("websiteIntelContext", JSON.stringify({
            websiteUrl: url,
            companies,
            generatedAt: new Date().toISOString(),
          }));
        } catch { }
      } else if (updated.status === "failed") {
        clearInterval(pollRef.current!);
        setStep(1);
      }
    } catch {
      if (++failCount >= 10) clearInterval(pollRef.current!);
    }
  };
  poll();
  pollRef.current = setInterval(poll, 3000);
};

// The FOCUS_FIELDS available for extraction
const FOCUS_FIELDS = [
  { key: "founded",           label: "Founding Year" },
  { key: "capital",           label: "Paid Up Capital" },
  { key: "revenue",           label: "Est. Revenue (Prev Year)" },
  { key: "website",           label: "Company Website" },
  { key: "address",           label: "Company Address" },
  { key: "landline",          label: "Company Landline" },
  { key: "location",          label: "Company Location" },
  { key: "ownerName",         label: "Company Owner Name" },
  { key: "shareholders",      label: "Shareholder Names & %" },
  { key: "marketPositioning", label: "Market Positioning" },
  { key: "industry",          label: "Company Industry" },
  { key: "employees",         label: "Employee Count" },
  { key: "crNumber",          label: "CR Number" },
  { key: "keyPeople",         label: "Key People / Executives" },
  { key: "services",          label: "Services Offered" },
  { key: "entityType",        label: "Entity Type (LLC/JSC)" },
  { key: "email",             label: "Company Email" },
  { key: "contactPerson",     label: "Contact Person" },
];
```

---

## 7. TOOL 4: DATA SEEDER

### 7a. Two Modes

**Text Mode** (3-step wizard):
1. Describe what you need (textarea) + filters (industry, city, record type, count)
2. Refine: record type (Companies/Executives/Both), count (10/20/30/50), extra context
3. AI generates the records

**URL Mode** (3-step wizard):
1. Enter a URL + optional description
2. Backend analyzes the URL and generates tailored questions → user answers them
3. Backend extracts companies matching the answers

**Auto-hydration** from `localStorage["websiteIntelContext"]` — same pattern as Person Intel.

### 7b. Frontend State + API Calls

```typescript
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const INDUSTRIES = [
  "Any / Mixed", "Healthcare & Medical", "Construction & Real Estate",
  "Oil & Gas / Energy", "Banking & Finance", "Retail & FMCG",
  "Technology & IT", "Manufacturing", "Logistics & Transportation",
  "Education & Training", "Food & Beverage", "Hospitality & Tourism",
  "Government & Public Sector", "Legal & Professional Services",
];

const CITIES = [
  "All Saudi Arabia", "Riyadh", "Jeddah", "Dammam", "Khobar",
  "Mecca", "Medina", "Tabuk", "Abha", "Taif", "Jubail", "Yanbu",
  "Najran", "Hail", "Qassim / Buraydah",
];

const RECORD_TYPES = [
  { id: "companies",  label: "Companies",  desc: "Company profiles with contact & financial data" },
  { id: "executives", label: "Executives", desc: "Named individuals with roles & contacts" },
  { id: "both",       label: "Both",       desc: "Companies + their key decision-makers" },
];

// Text mode: generate seed data
const seedTextMode = async (form: FormState) => {
  const res = await fetch(`${BASE}/api/prosengine/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: form.prompt || `${form.industry} ${form.recordType} in ${form.city}`,
      industry: form.industry !== "Any / Mixed" ? form.industry : undefined,
      city: form.city !== "All Saudi Arabia" ? form.city : undefined,
      recordType: form.recordType,
      count: form.count,
      extraContext: form.extraContext || undefined,
    }),
  });
  if (!res.ok) throw new Error("Generation failed");
  return res.json() as Promise<SeedResult>;
};

// URL mode step 1: analyze URL
const analyzeUrl = async (url: string, description?: string) => {
  const res = await fetch(`${BASE}/api/prosengine/analyze-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.trim(), description }),
  });
  if (!res.ok) throw new Error("URL analysis failed");
  return res.json() as Promise<UrlAnalysis>;
};

// URL mode step 2: seed from URL with answered questions
const seedFromUrl = async (url: string, answers: Record<string, string>, description?: string) => {
  const res = await fetch(`${BASE}/api/prosengine/seed-from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.trim(), answers, description }),
  });
  if (!res.ok) throw new Error("Company extraction failed");
  return res.json() as Promise<SeedResult>;
};

interface SeedResult {
  records: Record<string, string>[];
  summary: string;
  market_insight?: string;
  count: number;
  fields?: string[];
  url?: string;
}

interface UrlAnalysis {
  siteType: string;
  companiesDetected: string;
  questions: Array<{
    id: string;
    question: string;
    type: "choice" | "boolean" | "text";
    options?: string[];
    placeholder?: string;
  }>;
  url: string;
  pageTitle?: string;
}

// CSV Export
const exportCSV = (records: Record<string, string>[]) => {
  if (!records.length) return;
  const keys = Object.keys(records[0]);
  const csv = [keys.join(","), ...records.map(r => keys.map(k => `"${(r[k] || "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `prosengine-seed-${Date.now()}.csv`;
  a.click();
};
```

### 7c. Backend — prosengine routes

```typescript
// POST /api/prosengine/seed — text mode: AI generates records
router.post("/prosengine/seed", async (req, res) => {
  const { prompt, industry, city, recordType, count, extraContext } = req.body;

  const systemPrompt = "You are a Saudi Arabia B2B data specialist. Generate realistic Saudi company and executive records for prospecting. Use real Saudi business naming conventions in both Arabic and English.";

  const userPrompt = `Generate ${count || 20} Saudi Arabia ${recordType || "company"} records.

Request: ${prompt || `${industry || "mixed"} companies in ${city || "Saudi Arabia"}`}
Industry: ${industry || "All sectors"}
City/Region: ${city || "All Saudi Arabia"}
Record Type: ${recordType || "companies"}
${extraContext ? `Additional context: ${extraContext}` : ""}

IMPORTANT:
- Generate realistic Saudi company names (in Arabic and English)
- Include real-sounding Saudi executive names (Arabic script + English transliteration)  
- Use realistic Saudi phone numbers (+966 5X XXXX XXXX or +966 1X XXXX XXXX)
- Use realistic Saudi email patterns (name@company.com.sa)
- Include variety of cities: Riyadh, Jeddah, Dammam, Khobar, etc.
- For companies: include companyName, industry, city, phone, email, website, description, employees, revenue
- For executives: include fullName, title, company, phone, email, city, industry, bio
- Revenue in SAR (realistic for Saudi SMEs: SAR 500K - SAR 500M range)

Return ONLY valid JSON:
{
  "records": [...array of ${count || 20} records...],
  "summary": "Brief description of what was generated",
  "market_insight": "One insight about this Saudi market segment",
  "count": ${count || 20},
  "fields": ["list of field names used"]
}`;

  const r = await Promise.race([
    openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 4000,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    }),
    new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 45000)),
  ]);

  const text = r.choices[0]?.message?.content || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) { res.status(500).json({ error: "AI generation failed" }); return; }
  res.json(JSON.parse(match[0]));
});

// POST /api/prosengine/analyze-url — analyze a URL and generate questions
router.post("/prosengine/analyze-url", async (req, res) => {
  const { url, description } = req.body;

  const crawlRes = await runWebSeeder(url, "", { maxPages: 3 }).catch(() => null);
  const siteText = crawlRes?.text || "";

  const analysisPrompt = `Analyze this URL: ${url}
${description ? `Description: ${description}` : ""}
Sample content from website: ${siteText.slice(0, 3000)}

Return JSON:
{
  "siteType": "company-directory / trade-association / chamber / yellow-pages / etc",
  "companiesDetected": "estimated number or description of what's listed",
  "pageTitle": "website title",
  "url": "${url}",
  "questions": [
    {
      "id": "unique_id",
      "question": "question text",
      "type": "choice",
      "options": ["option1", "option2", "option3"]
    }
  ]
}

Generate 3-5 focused questions that help extract exactly the right companies. Examples:
- "Which cities should we focus on?" (choice: Riyadh / Jeddah / Dammam / All)
- "What industry sector?" (choice list)
- "Do you need contact information?" (boolean)
- "Any specific keywords to filter by?" (text)`;

  const result = await searchWithGemini(analysisPrompt).catch(() => null)
    || await openai.chat.completions.create({ model: "gpt-4o", max_completion_tokens: 800, messages: [{ role: "user", content: analysisPrompt }] })
      .then(r => r.choices[0]?.message?.content || null);

  const match = String(result || "").match(/\{[\s\S]*\}/);
  if (!match) { res.status(500).json({ error: "URL analysis failed" }); return; }
  res.json(JSON.parse(match[0]));
});

// POST /api/prosengine/seed-from-url — extract companies from URL based on user answers
router.post("/prosengine/seed-from-url", async (req, res) => {
  const { url, answers, description } = req.body;

  const crawlRes = await runWebSeeder(url, Object.values(answers).join(" "), { maxPages: 15 }).catch(() => null);
  const siteText = crawlRes?.text || "";

  const answerContext = Object.entries(answers as Record<string, string>)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const extractPrompt = `Extract Saudi company records from this website: ${url}
${description ? `Context: ${description}` : ""}

User preferences:
${answerContext}

Website content:
${siteText.slice(0, 6000)}

Extract ALL companies/businesses matching the user's preferences. For each record include:
- companyName (or fullName for executives)
- phone, email, website
- city, address
- industry / type
- description
- any other relevant fields from the page

Return JSON:
{
  "records": [...extracted records...],
  "summary": "X companies extracted from [site description]",
  "market_insight": "insight about this data",
  "count": number,
  "url": "${url}"
}`;

  const r = await Promise.race([
    openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 4000,
      messages: [{ role: "user", content: extractPrompt }],
    }),
    new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 45000)),
  ]);

  const text = r.choices[0]?.message?.content || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) { res.status(500).json({ error: "Extraction failed" }); return; }
  res.json(JSON.parse(match[0]));
});

// POST /api/prosengine/chat — AI chat about results
router.post("/prosengine/chat", async (req, res) => {
  const { message, context, mode } = req.body;

  const systemPrompt = mode === "website"
    ? "You are a Saudi Arabia B2B intelligence analyst specializing in analyzing company website data. Help the user understand and act on the intelligence gathered."
    : mode === "seeder"
    ? "You are a Saudi Arabia B2B data specialist. Help the user understand, analyze, and leverage the generated prospecting data."
    : "You are a Saudi Arabia B2B intelligence analyst. Answer questions about the research data provided.";

  const r = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 800,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Context:\n${context}\n\nUser question: ${message}` },
    ],
  });

  res.json({ reply: r.choices[0]?.message?.content || "I couldn't generate a response." });
});
```

---

## 8. THE PROSENGINE CHAT COMPONENT

This reusable floating chat widget appears after any tool generates results:

```tsx
// components/ProsEngineChat.tsx
interface ProsEngineChatProps {
  mode: "company" | "person" | "website" | "seeder";
  context: string;     // the research context to include in all messages
  autoOpen?: boolean;  // auto-open the chat panel after results appear
}

export default function ProsEngineChat({ mode, context, autoOpen = false }: ProsEngineChatProps) {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [open, setOpen] = useState(autoOpen);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msg }]);
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/prosengine/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, context, mode }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I couldn't process that." }]);
    } finally {
      setLoading(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-primary shadow-lg flex items-center justify-center hover:bg-primary/90 transition-all z-40"
      >
        <MessageCircle className="w-5 h-5 text-white" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-80 bg-card border border-white/15 rounded-2xl shadow-2xl flex flex-col z-40" style={{ height: "420px" }}>
      <div className="flex items-center justify-between p-3 border-b border-white/8">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-white">ProsEngine AI</span>
        </div>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            Ask anything about the intelligence gathered…
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${
              m.role === "user"
                ? "bg-primary/20 text-white"
                : "bg-white/5 text-white/80"
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white/5 rounded-xl px-3 py-2">
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="p-3 border-t border-white/8 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage()}
          placeholder="Ask a question…"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()}
          className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center disabled:opacity-50">
          <Send className="w-3.5 h-3.5 text-white" />
        </button>
      </div>
    </div>
  );
}
```

---

## 9. KEY IMPLEMENTATION NOTES

1. **5-step wizard pattern**: All wizards use `step` state (1–5). Each step validates before proceeding. The "Back" button decrements step. Step 1 always has the "what you want" fields.

2. **Cross-module context flow**:
   - Website Intel (single mode) → writes `localStorage["websiteIntelContext"]` with `companyName`, `websiteUrl`, `executives[]`, `generatedAt`
   - Website Intel (directory mode completed) → writes `companies[]` array
   - Person Intel reads this on `useEffect([], [])` — auto-fills `name`, `title`, `company`
   - Data Seeder reads this on `useEffect([], [])` — auto-fills `prompt` and `industry`
   - Data Seeder also accepts `?prompt=...&source=website-intel&company=...` URL params

3. **Export formats**:
   - Website Intel: CSV, Excel (XLSX via base64), JSON, PDF (via `window.print()`)
   - Data Seeder: CSV only (client-side blob)
   - Company/Person Intel: HTML report (via `Blob + <a download>`), Word (.doc), PDF (`window.print()`)

4. **The `webSearch()` function** (used throughout): tries Perplexity first, falls back to Gemini `deepResearchWithGemini()`. Returns empty string on complete failure — never throws.

5. **Report generation timeout**: Company Intel and Person Intel both use `Promise.race` with 50-second timeouts on Claude synthesis calls, falling back to partial data already collected.

6. **Polling interval**: Website Intel polls job status every 3 seconds via `setInterval`. Max 10 consecutive failures before stopping.

7. **ProsEngineChat is always present**: It sits outside the main content area as a fixed floating button. On results pages it auto-opens (`autoOpen={true}`).
