# Setup

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 24.x |
| pnpm | 9+ (enforced via `preinstall` hook) |
| Python | 3.11+ (only for the Scout microservice) |
| PostgreSQL | 14+ |

## 1. Install

```bash
pnpm install
```

This installs all workspace packages: `artifacts/api-server`, `artifacts/prospect-sa` (frontend), `lib/db`, `lib/api-zod`, `lib/api-client-react`, `scripts`.

## 2. Configure environment

Create `.env` at the repo root (or use Replit Secrets). The bare minimum:

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/enrich
PORT=3000
OPENAI_API_KEY=sk-...      # or AI_INTEGRATIONS_OPENAI_API_KEY on Replit
ANTHROPIC_API_KEY=sk-ant-...
```

External-API features (Scout, Lead Factory, Signals, Person Intel) need additional keys — see [ENV.md](ENV.md) for the full list and which engine uses which.

## 3. Database

```bash
# Apply Drizzle schema
pnpm --filter @workspace/db run db:push

# (optional) seed the unified company pool from fixtures
pnpm --filter @workspace/scripts run seed-import
```

The seed step is idempotent — safe to re-run.

## 4. Run

**API server (dev mode, watch + reload):**
```bash
pnpm --filter @workspace/api-server run dev
```
Boots on `PORT` (no default — must be set). On startup it recovers any stuck `lead_lists` jobs and seeds MeshBase if the `companies` table is empty.

**Frontend:**
```bash
pnpm --filter @workspace/prospect-sa run dev
```

**Python Scout microservice** (optional, only needed for OSINT / site-intel / full-scan features):
```bash
cd artifacts/python-scout
uv sync
uv run uvicorn main:app --port 8099
```
Then set `SCOUT_URL=http://localhost:8099` in the API server env.

## 5. Build for production

```bash
pnpm run typecheck   # full monorepo TypeScript check
pnpm run build       # builds all workspaces with esbuild
```

## Replit notes

- `modules.yaml` declares the Nix toolchain.
- `replit.md` documents the canonical Replit workflow.
- AI keys are exposed as `AI_INTEGRATIONS_*` env vars when using Replit's AI Integrations — the code falls back to direct `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` if those are absent.

## Troubleshooting

- **`PORT is required`** — the server intentionally has no port default; set it.
- **Empty company pool** — run the seed script, or let the server auto-seed MeshBase on first boot.
- **Scout endpoints 502** — Python service isn't running, or `SCOUT_URL` is wrong.
- **Captcha endpoints hanging** — set one of `CAPMONSTER_API_KEY` / `AZCAPTCHA_API_KEY` / `NOPECHA_API_KEY`.
- **Playwright errors on Replit** — point `CHROMIUM_EXECUTABLE_PATH` at the Nix-provided binary.

---

# Frontend Replication Checklist

_Merged from `docs/docs/frontend-replication-guide.md`._

## Why the engines were tangling and how to fix it

> Read this BEFORE copying any source files.

---

## The core mistake

The engines tangle when they are placed as **components or tabs on one page**.  
They must be placed as **separate routes** — each engine is its own page, rendered by its own file, at its own URL.

---

## Route map — the single most important thing to replicate

Every engine has a dedicated URL. When a user clicks a card, Wouter navigates to that URL and React renders a completely different component.

```
URL                          Component file                         What renders
────────────────────────────────────────────────────────────────────────────────────
/                            src/pages/Dashboard.tsx                Dashboard
/masaar                      src/pages/masaar/index.tsx             Masaar CR pipeline form + results
/masaar/database             src/pages/masaar/database.tsx          Masaar company database harvester
/prospecting                 src/pages/prospecting/index.tsx        ProsEngine hub (4 mode cards only)
/prospecting/company         src/pages/prospecting/company.tsx      Company Intel form + results
/prospecting/person          src/pages/prospecting/person.tsx       Person Intel form + results
/prospecting/website         src/pages/prospecting/website.tsx      Website scanner form + results
/prospecting/seeder          src/pages/prospecting/seeder.tsx       Data seeder form + results
/database-builder            src/pages/database-builder/index.tsx   AI Database Builder
/database-builder/results    src/pages/database-builder/results.tsx Builder results panel
/leads                       src/pages/leads/index.tsx              Lead Finder
/meshbase                    src/pages/MeshBase.tsx                  OrcBase overview
/meshbase/companies          src/pages/MeshBaseCompanies.tsx        OrcBase company list
/meshbase/executives         src/pages/MeshBaseExecutives.tsx       OrcBase executive list
/sa-market/shareholders      src/pages/sa-market/shareholders.tsx   SA Market shareholders
/sa-market/executives        src/pages/sa-market/executives.tsx     SA Market executives
```

**Masaar is NOT inside ProsEngine.** They are completely separate route trees:
- `/masaar/*` → Masaar (Saudi CR pipeline)
- `/prospecting/*` → ProsEngine (company / person / website / seeder)

---

## Why your new app tangled

The screenshot shows a hub page with Masaar, Person Intel, Company Intel, Lead Finder, and AI Database all as cards — and then the Masaar form rendered **below them on the same page**.

This happens when engines are imported and rendered as JSX inside the hub component instead of being navigated to as separate routes:

```tsx
// WRONG — puts all engines on one page, forms appear inline below cards
export default function Hub() {
  const [active, setActive] = useState("masaar");
  return (
    <>
      <HubCards onSelect={setActive} />
      {active === "masaar" && <MasaarPage />}
      {active === "person" && <PersonIntelPage />}
    </>
  );
}
```

```tsx
// CORRECT — hub only shows cards, clicking navigates to a separate URL
// src/pages/prospecting/index.tsx
export default function ProsEngineHub() {
  const [, navigate] = useLocation();   // wouter hook
  return (
    <div>
      {MODES.map(mode => (
        <Card
          key={mode.id}
          onClick={() => navigate(mode.path)}   // navigates, does NOT render inline
          className="cursor-pointer"
        >
          {/* card content only — no engine component imported here */}
        </Card>
      ))}
    </div>
  );
}
```

The card component renders **nothing from the engine**. It just navigates. Wouter then renders the correct engine component for that new URL via `App.tsx`.

---

## App.tsx — the complete router (copy this exactly)

```tsx
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout/Layout";

import Dashboard          from "@/pages/Dashboard";
import MasaarPage         from "@/pages/masaar";
import MasaarDatabasePage from "@/pages/masaar/database";
import ProspectingPage    from "@/pages/prospecting";
import CompanyIntelPage   from "@/pages/prospecting/company";
import PersonIntelPage    from "@/pages/prospecting/person";
import WebsiteIntelPage   from "@/pages/prospecting/website";
import DataSeederPage     from "@/pages/prospecting/seeder";
import DatabaseBuilder    from "@/pages/database-builder";
import BuilderResults     from "@/pages/database-builder/results";
import LeadsPage          from "@/pages/leads";
import NotFound           from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/"                         component={Dashboard} />

        {/* Masaar — standalone, NOT under /prospecting */}
        <Route path="/masaar"                   component={MasaarPage} />
        <Route path="/masaar/database"          component={MasaarDatabasePage} />

        {/* ProsEngine sub-routes BEFORE the parent hub route */}
        <Route path="/prospecting/company"      component={CompanyIntelPage} />
        <Route path="/prospecting/person"       component={PersonIntelPage} />
        <Route path="/prospecting/website"      component={WebsiteIntelPage} />
        <Route path="/prospecting/seeder"       component={DataSeederPage} />
        <Route path="/prospecting"              component={ProspectingPage} />

        {/* AI Database Builder */}
        <Route path="/database-builder/results" component={BuilderResults} />
        <Route path="/database-builder"         component={DatabaseBuilder} />

        <Route path="/leads"                    component={LeadsPage} />
        <Route                                  component={NotFound} />
      </Switch>
    </Layout>
  );
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {/* base= strips the Vite preview path prefix so routes work in Replit */}
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

**Critical ordering rule:** In Wouter's `<Switch>`, more specific routes must come BEFORE their parent.  
`/prospecting/company` must be declared before `/prospecting` — otherwise Wouter matches the parent first and the sub-route never renders.

---

## The BASE_URL pattern — required in every file

At the top of every page file that makes API calls or navigates via plain `<a>` tags:

```ts
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
```

API calls:

```ts
const res = await fetch(`${BASE}/api/masaar/run`, { method: "POST", ... });
```

Wouter navigation (programmatic):

```ts
const [, navigate] = useLocation();
navigate("/prospecting/company");   // Wouter adds BASE automatically from WouterRouter base=
```

Plain `<a>` links (outside Wouter context):

```tsx
<a href={`${BASE}/masaar/database`}>Go to database</a>
```

**Why this matters on Replit:** Your app runs under a path prefix (e.g. `/prospect-sa/`). Without `BASE_URL` in API calls, every fetch hits the wrong URL and returns 404.

---

## File structure — exact layout to create

```
src/
├── App.tsx                            router + all providers (copy first)
├── main.tsx                           ReactDOM.createRoot entry point
├── components/
│   ├── layout/
│   │   ├── Layout.tsx                 SidebarProvider shell
│   │   └── AppSidebar.tsx             collapsible nav with Wouter Links
│   ├── ProsEngineChat.tsx             floating AI chat widget (SSE streaming)
│   └── ui/                            shadcn components (copy all)
└── pages/
    ├── Dashboard.tsx
    ├── masaar/
    │   ├── index.tsx                  Masaar CR search (form + 7-agent results)
    │   └── database.tsx               Masaar database (harvest jobs + company grid)
    ├── prospecting/
    │   ├── index.tsx                  ProsEngine hub (4 cards — navigates away on click)
    │   ├── company.tsx                Company Intel (form + full dossier)
    │   ├── person.tsx                 Person Intel (form + executive profile)
    │   ├── website.tsx                Website Intelligence (URL scanner)
    │   └── seeder.tsx                 Data Seeder (text describe or URL)
    ├── database-builder/
    │   ├── index.tsx                  AI Database Builder source manager
    │   └── results.tsx                Builder results viewer
    └── leads/
        └── index.tsx                  Lead Finder
```

---

## How the layout shell works

```
Layout.tsx
  SidebarProvider
  ├── AppSidebar          ← always visible on left, persists across all navigation
  └── SidebarInset
        └── <main>
              └── {children}   ← routed page component renders here
```

Every page component (`MasaarPage`, `CompanyIntelPage`, etc.) renders **only its own content**.  
It does NOT include the sidebar, header, or any layout wrapper.  
The `<Layout>` in `App.tsx` wraps every route so the sidebar persists.

```tsx
// src/components/layout/Layout.tsx
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

---

## Sidebar navigation structure

```
Platform section
  Dashboard          → /
  Leads              → /leads

OrcBase (collapsible)
  Overview           → /meshbase
  Companies          → /meshbase/companies
  Executives         → /meshbase/executives

SA Market (collapsible)
  Shareholders       → /sa-market/shareholders
  Executives         → /sa-market/executives

Masaar (collapsible)      ← standalone engine, NOT inside ProsEngine
  Search             → /masaar
  Database           → /masaar/database

AI Database Builder  → /database-builder    ← single link
ProsEngine           → /prospecting         ← single link to hub; cards navigate deeper
```

Masaar and OrcBase use `Collapsible` from Radix UI with `CollapsibleTrigger` and `CollapsibleContent`.  
They expand/collapse in the sidebar. Their sub-items use `<Link href={url}>` from Wouter.

---

## How ProsEngine hub navigates to engines

```tsx
// src/pages/prospecting/index.tsx — abbreviated
import { useLocation } from "wouter";

const MODES = [
  { id: "company", path: "/prospecting/company", title: "Company Intelligence", ... },
  { id: "person",  path: "/prospecting/person",  title: "Person Intelligence",  ... },
  { id: "website", path: "/prospecting/website", title: "Website Intelligence", ... },
  { id: "seeder",  path: "/prospecting/seeder",  title: "Data Seeder",          ... },
];

export default function ProsEngineHub() {
  const [, navigate] = useLocation();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {MODES.map(mode => (
        <Card
          key={mode.id}
          onClick={() => navigate(mode.path)}   // ← THIS is all it does
          className="cursor-pointer"
        >
          <CardContent>
            <h2>{mode.title}</h2>
            <p>{mode.description}</p>
            <button>Go →</button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

No engine component is imported in this file. Navigation is the only action on click.

---

## Replication order (follow this sequence)

1. Copy all `src/components/ui/` shadcn files
2. `src/components/layout/Layout.tsx`
3. `src/components/layout/AppSidebar.tsx`
4. `src/App.tsx` — declare ALL routes now, even before the page files exist
5. `src/pages/Dashboard.tsx` — verify routing works with a simple page
6. `src/pages/masaar/index.tsx` — test at `/masaar`
7. `src/pages/masaar/database.tsx` — test at `/masaar/database`
8. `src/pages/prospecting/index.tsx` — test at `/prospecting`, cards appear, nothing below
9. `src/pages/prospecting/company.tsx` — click Company card → URL changes → form appears
10. `src/pages/prospecting/person.tsx`
11. `src/pages/prospecting/website.tsx`
12. `src/pages/prospecting/seeder.tsx`
13. `src/pages/database-builder/index.tsx` and `results.tsx`
14. `src/components/ProsEngineChat.tsx` — floating chat, add last

---

## Verification checklist

- [ ] `/masaar` shows ONLY the Masaar form — no hub cards above it
- [ ] `/prospecting` shows ONLY the 4 mode cards — no engine forms visible
- [ ] Clicking a ProsEngine card changes the URL to `/prospecting/company` (etc.) and shows the engine form — sidebar stays
- [ ] Refreshing the browser on `/prospecting/person` loads Person Intel directly, not the hub
- [ ] API calls work (check Network tab — URLs should include the Replit path prefix)
- [ ] Masaar is in the sidebar under its own collapsible — NOT nested under ProsEngine

---

*Generated from ProspectSA source — May 2026*

---

# Tech Stack — Full Dependency Reference

_Merged from `docs/docs/tech-stack-full.md`._

## Frontend + Backend + Scraping Layer for Every Engine

---

## Monorepo Overview

```
workspace/
├── artifacts/
│   ├── prospect-sa/        ← React + Vite frontend (all 3 engine UIs)
│   └── api-server/         ← Node.js + Express backend (all 3 engines)
├── packages/
│   ├── db/                 ← Drizzle ORM schema + PostgreSQL migrations
│   ├── api-zod/            ← Shared Zod validation schemas (FE ↔ BE)
│   ├── api-client-react/   ← Typed React Query hooks + axios client
│   └── integrations-openai-ai-server/
```

---

## Shared Frontend Infrastructure

**Runtime & Build**
| Package | Version | Role |
|---|---|---|
| React | 18 | UI framework |
| Vite | catalog | Dev server + bundler |
| TypeScript | catalog | Type safety |
| wouter | ^3.3.5 | Client-side routing |

**Styling**
| Package | Role |
|---|---|
| Tailwind CSS v4 | Utility CSS |
| `@tailwindcss/typography` | Prose/markdown rendering |
| `tw-animate-css` | Animation classes |
| `framer-motion` | Page transitions + animated elements |
| `next-themes` | Dark / light mode |
| `clsx` + `tailwind-merge` + `class-variance-authority` | Dynamic class composition |

**UI Primitives (shadcn/ui pattern over Radix)**
| Package | Components Provided |
|---|---|
| `@radix-ui/react-dialog` | Modal dialogs |
| `@radix-ui/react-tabs` | Tab panels |
| `@radix-ui/react-select` | Dropdowns |
| `@radix-ui/react-badge`, `@radix-ui/react-avatar` | Status indicators |
| `@radix-ui/react-card` | Content containers |
| `@radix-ui/react-input`, `@radix-ui/react-label` | Form controls |
| `@radix-ui/react-progress` | Progress bars |
| `@radix-ui/react-toast` | Toast notifications |
| `@radix-ui/react-tooltip` | Hover tooltips |
| `@radix-ui/react-scroll-area` | Custom scrollbars |
| `@radix-ui/react-separator` | Dividers |
| `@radix-ui/react-collapsible` | Expand/collapse |
| `lucide-react` | Primary icon set |
| `react-icons` | Supplemental icons |
| `sonner` | Toast notifications (alternative) |
| `cmdk` | Command palette |
| `vaul` | Drawer |
| `embla-carousel-react` | Carousel |
| `react-resizable-panels` | Split-pane layouts |

**Data Fetching**
| Package | Role |
|---|---|
| `@tanstack/react-query` | Server state, caching, invalidation |
| `@workspace/api-client-react` | Typed API hooks generated from Zod schemas |
| `react-hook-form` + `@hookform/resolvers` | Form state management |
| `zod` | Runtime schema validation |

**Charts & Data**
| Package | Role |
|---|---|
| `recharts` | Bar, line, area, pie charts |
| `date-fns` + `react-day-picker` | Date utilities + date picker |

---

## Shared Backend Infrastructure

**Runtime**
| Package | Role |
|---|---|
| Node.js + `tsx` | TypeScript execution without compile step |
| Express v5 | HTTP server |
| `cors` | Cross-origin headers |
| `cookie-parser` | Cookie sessions |
| `uuid` | Unique job IDs |
| `drizzle-orm` + PostgreSQL | Database ORM |

**AI Models — Global Priority Waterfall**
```
Gemini (Google)  →  Claude (Anthropic)  →  GPT-4o (OpenAI)  →  Perplexity  →  OpenRouter / Groq (stubs)
```
| Package | Model | Priority |
|---|---|---|
| `@google/genai` ^1.47.0 | Gemini 2.5 Flash / 2.0 Flash | 1st — search + synthesis |
| `@anthropic-ai/sdk` ^0.78.0 | claude-sonnet-4-6 / claude-haiku-4-5 | 2nd — reasoning + reports + CAPTCHA Vision |
| `openai` ^6.29.0 | GPT-4o | 3rd — fallback for every operation |
| axios → Perplexity `sonar` | sonar (web-grounded) | 4th — deep research + citations |
| axios → OpenRouter | deepseek-r1, llama-3.3-70b, moonshot | stub, activates via `OPENROUTER_API_KEY` |
| axios → Groq | llama-3 family | stub, activates via `GROQ_API_KEY` |

**Document Export**
| Package | Role |
|---|---|
| `docx` ^9.6.1 | Word document generation |
| `exceljs` ^4.4.0 | Excel export |
| `pptxgenjs` ^4.0.1 | PowerPoint export |
| `xlsx` ^0.18.5 | Spreadsheet read/write |
| `pdfkit` ^0.18.0 | PDF generation |

---
---

# ENGINE 1 — MASAAR DATABASE & ENGINE

---

## Masaar — Frontend

**File:** `artifacts/prospect-sa/src/pages/masaar/index.tsx`

### React Hooks Used
```typescript
useState      // pipeline status, report, agents[], captchaQueue, stealthMode, reportLang, activeTab
useRef        // EventSource ref (esRef), logsEndRef (auto-scroll)
useEffect     // SSE event stream lifecycle
useCallback   // handleEvent (stable reference for SSE handler)
```

### Real-Time Streaming: EventSource (SSE)
```typescript
// Connects to backend SSE stream:
const es = new EventSource(`/api/masaar/stream/${jobId}`);
es.onmessage = (e) => handleEvent(JSON.parse(e.data));

// Events received from backend EventEmitter:
"agent_start"       → mark agent as "running"
"agent_log"         → append log line to agent card
"stealth_solving"   → set agent status "stealth_solving" (AI SOLVING badge)
"stealth_solved"    → return agent to "running"
"captcha_required"  → push to captchaQueue → render CaptchaOverlay
"captcha_solved"    → return agent to "running"
"agent_complete"    → mark agent "done", store structured data
"agent_error"       → mark agent "error"
"job_complete"      → setReport(event.report), switch to results tab
"job_error"         → setErrorMsg, set status "error"
```

### API Calls
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/masaar/start` | Start pipeline with `{ crNumber, stealthMode }` or `{ nameAr, nameEn }` |
| GET (SSE) | `/api/masaar/stream/:jobId` | Server-sent event stream — live agent progress |
| POST | `/api/masaar/captcha/:jobId` | Submit manual CAPTCHA `{ captchaText, captchaFor }` |

### Page Components (all defined inline in the page file)

| Component | Props | Description |
|---|---|---|
| `MasaarPage` | — | Main page, manages all state |
| `AgentCard` | `agent, state: AgentState` | Per-agent card with status icon, color, expandable log |
| `CaptchaOverlay` | `request, jobId, onSolved, onError` | Full-screen modal showing base64 screenshot + code input |
| `StealthModeToggle` | `enabled, onChange, disabled` | Toggle between stealth AI mode and manual CAPTCHA mode |
| `StealthSolvingBadge` | — | Animated "AI SOLVING" badge shown during auto-solve |
| `FieldRow` | `label, value, valueAr` | Bilingual field display (EN left, AR right, RTL) |
| `ShareholderTable` | `shareholders[]` | Table: Name EN, الاسم, National ID, Ownership %, Nationality |
| `ManagerTable` | `managers[]` | Table: Name EN, الاسم, National ID, Term, Powers |
| `ConflictList` | `conflicts[]` | Cards for source conflicts with severity (high/medium) |
| `MarkdownRenderer` | `text: string` | Custom inline markdown parser for report display |

### UI Packages Used
```
Card, CardContent, CardHeader, CardTitle  — containers
Input                                      — CR number input, CAPTCHA input
Button                                     — search, submit, copy, download
Badge                                      — status labels, confidence indicators
Tabs, TabsContent, TabsList, TabsTrigger  — pipeline / structured / EN report / AR report
cn (clsx + tailwind-merge)                — dynamic class composition
```

### Icons Used (lucide-react)
```
Search, Globe, FileText, ShieldCheck, GitMerge, BookOpen, Loader2
CheckCircle2, AlertCircle, Clock, ChevronDown, ChevronRight
Building2, Users, Landmark, Scale, Copy, Languages, Download
AlertTriangle, Info, Layers, Network, ExternalLink, Hash
KeyRound, Send, RefreshCw, Bot, Zap, Shield, Eye, ToggleLeft, ToggleRight
```

### State Management
```typescript
crInput: string                          // CR number or company name input
stealthMode: boolean                     // true = AI auto-solves CAPTCHA
status: "idle" | "running" | "done" | "error"
jobId: string                            // UUID returned by /api/masaar/start
agents: AgentState[]                     // 5 agents with status + logs[]
report: MasaarReport | null              // Final structured result
reportLang: "en" | "ar"                  // Report language toggle
activeTab: "pipeline" | "structured" | "report-en" | "report-ar"
captchaQueue: CaptchaRequest[]           // Human fallback CAPTCHA queue
stealthEvents: string[]                  // Last 10 stealth AI events for display
```

### Result Tabs Rendered After Pipeline Completes
```
Tab 1: Pipeline      → Live agent cards (always visible)
Tab 2: Structured    → parsed{} JSON fields: identity, incorporation, shareholders,
                        managers, legal framework, contacts, conflicts
Tab 3: English Report → Full markdown report rendered by MarkdownRenderer
Tab 4: Arabic Report  → Full Arabic markdown, dir="rtl"
```

---

## Masaar — Backend

**Route file:** `artifacts/api-server/src/routes/masaar.ts`  
**Engine file:** `artifacts/api-server/src/lib/masaar-engine.ts` (1782 lines)

### API Endpoints
| Method | Path | Handler |
|---|---|---|
| POST | `/api/masaar/start` | Creates job ID, starts `runMasaarPipeline()` or `runMasaarPipelineByName()` async |
| GET | `/api/masaar/stream/:jobId` | SSE endpoint — pipes EventEmitter events to client |
| POST | `/api/masaar/captcha/:jobId` | Resolves the captcha Promise for a waiting agent |

### 5-Agent Pipeline Architecture

```
Agent 1a  MC.gov.sa Stealth Browser         StealthBrowser → Playwright Chromium
          ↓ rawText
Agent 1b  Claude CR Intelligence             Claude parses bilingual JSON from raw text
          ↓ crData { nameAr, nameEn, ... }
          ↓ (parallel)
Agent 2   Amaaly AOA Intelligence            StealthBrowser → emagazine.aamaly.sa → pdf-parse → Claude
Agent 3   Deep Research Intelligence         Perplexity×5 + Gemini×4 + Claude + GPT-4o (all parallel)
          ↓ (sequential after agents 2+3)
Agent 4   Compliance & Sanctions             OFAC + UNSC + EU + CMA + SAMA + ZATCA + Maroof + Najiz
          ↓
Agent 5a  English Report Compiler            Claude → plain markdown (no JSON wrapper)
Agent 5b  Arabic Translator                  Separate Claude call → full Arabic translation
          ↓
Post-5    Structured Field Extractor         extractStructuredFromReport() → fills parsed{} from reportEn
                                             (runs only when Agents 1&2 returned empty data)
```

### Agent 1 — MC.gov.sa Stealth Browser

**What it does:** Navigates to `https://mc.gov.sa/ar/eservices/Pages/Commercial-data.aspx` using a stealth browser, fills in CR number, solves the CAPTCHA, submits form, extracts page text.

**Scraping stack:**
```typescript
StealthBrowser        // Playwright Chromium with full anti-fingerprinting
  .start("mc.gov.sa") // loads session cookies if exists, injects anti-detect JS
  .goto(url)          // waits for DOM, detects Cloudflare
  .detectChallenge()  // → "cloudflare" | "turnstile" | "none"
  .waitForCloudflare()// polls until Cloudflare clears
  .fillFirst(selectors[], value)  // tries each CSS selector until one fills
  .clickFirst(selectors[])        // same for click
  .screenshot()       // base64 PNG for CAPTCHA display
  .getContent()       // returns full page HTML
```

**CAPTCHA resolution flow:**
```
autoSolveCaptcha()
  → screenshot() → base64 → Claude Vision (claude-sonnet-4-6)
  → prompt: "What is the text/number in this CAPTCHA image?"
  → up to 3 attempts
  → if all fail: waitForCaptchaHuman() → frontend CaptchaOverlay
  → emits stealth_solving / stealth_solved / captcha_required events via EventEmitter
```

**Anti-fingerprinting injected JS (stealth-browser.ts):**
```javascript
navigator.webdriver = false
navigator.plugins.length = 3 (spoofed)
navigator.platform = "Win32"
navigator.languages = ["en-US", "ar-SA"]
canvas.getImageData → noise pixels added
canvas.toDataURL → subtle hash noise
WebGL vendor = "Intel Inc." / renderer = "Intel Iris OpenGL Engine"
performance.now() → jitter ±2ms
Date.now() → jitter ±1ms
```

**Human behavior simulation:**
```typescript
HumanBehavior.idle(minMs, maxMs)           // random delay
HumanBehavior.bezierMousePath(page, x, y) // Bézier curve mouse movement
StealthBrowser.humanType(selector, text)   // Gaussian typing delays
```

### Agent 2 — Amaaly AOA Intelligence

**What it does:** Searches `https://emagazine.aamaly.sa/search` for the company's Arabic name, finds the highest-scoring AOA PDF, downloads it, extracts text with `pdf-parse`, then Claude translates and extracts 15+ corporate governance fields.

**Scraping stack:**
```typescript
StealthBrowser           // same anti-detect browser for Cloudflare bypass
  .humanType(searchBox)  // types Arabic company name
  .pressEnter()
axios.get(pdfUrl)        // downloads AOA PDF as binary
pdf-parse(buffer)        // extracts Arabic text from PDF
Claude (sonnet-4-6)      // translates + extracts JSON:
                         // shareholders, managers, capital, legal form,
                         // fiscal year, dissolution, amendment procedures, etc.
```

**AOA document scoring (picks best PDF):**
```typescript
// Scores each article title/excerpt — highest score = most relevant AOA version
"إعلان قرار الشركاء بتعديل النظام الأساسي" → +10 pts
"تعديل النظام الأساسي"                     → +8 pts
"موائمة"                                   → +7 pts
"عقد التأسيس"                              → +5 pts
```

**Fallback when browser unavailable:**
```typescript
// Falls back to axios HTTP fetch + Perplexity search
axios.get("https://emagazine.aamaly.sa/search?q=...") // plain HTTP
perplexitySearch(query)  // Perplexity sonar for AOA data
```

### Agent 3 — Deep Research Intelligence

**What it does:** Fires 12 research engines in parallel, aggregates into a single comprehensive text used by Agent 5.

```typescript
// All parallel via Promise.allSettled():
perplexitySearch("...overview...")         // token: 2000
perplexitySearch("...ownership...")        // token: 1500
perplexitySearch("...financials...")       // token: 1500
perplexitySearch("...market position...")  // token: 1500
perplexitySearch("...news recent...")      // token: 800
searchWithGemini("...company overview...") // Gemini grounded search
searchWithGemini("...shareholders...")
searchWithGemini("...financials...")
searchWithGemini("...competitors...")
Claude (opus/sonnet)   // synthesis from all collected data
GPT-4o                 // alternative synthesis (parallel with Claude)
openRouterQuery()      // stub: deepseek-r1 / llama-3.3-70b (if key set)
groqQuery()            // stub: llama-3 (if key set)
```

### Agent 4 — Compliance & Sanctions

**What it does:** Checks 8 compliance sources in parallel.

| Source | Method | What It Checks |
|---|---|---|
| OFAC SDN List | axios REST → `sanctionslist.ofac.treas.gov` | US sanctions match |
| UN Security Council | axios REST → `scsanctions.un.org` | UN sanctions match |
| EU Consolidated | axios REST → `eeas.europa.eu` | EU sanctions match |
| Maroof.sa | axios + Cheerio → `maroof.sa/search` | Saudi business verification, rating |
| CMA (Capital Market Authority) | Gemini search + Perplexity | Regulatory actions |
| SAMA | Gemini search + Perplexity | Banking/finance regulatory actions |
| ZATCA | Gemini search + Perplexity | Tax/customs violations |
| Najiz | axios + Cheerio → `najiz.sa` | Ministry of Justice legal agency records |
| News flags | Gemini + Perplexity | Fraud, corruption, lawsuit, bankruptcy mentions |

**Risk output:**
```typescript
overallRisk: "low" | "medium" | "high" | "unknown"
// high  = any OFAC/UNSC/EU hit
// medium = CMA/SAMA/ZATCA hit OR 2+ news flags
// low   = Maroof verified, no other flags
```

### Agent 5 — Bilingual Report Compiler

**Step A — English report:**
```typescript
anthropic.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 8192,
  messages: [{ role: "user", content: enPrompt }]
})
// Returns plain markdown — no JSON wrapper (prevents Arabic JSON-parse failures)
// GPT-4o fallback if Claude fails
```

**Step B — Arabic translation (separate call):**
```typescript
anthropic.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 8192,
  messages: [{ role: "user", content: arPrompt }]
})
// Translates full English report to formal MSA Arabic
// Keeps CR numbers, ISINs, phone numbers, financial figures as-is
// GPT-4o fallback if Claude fails
```

**Post-5 — Structured field extractor (new):**
```typescript
extractStructuredFromReport(crNumber, reportEn, deepResearch, baseParsed)
// Only runs if Agents 1 & 2 returned empty (CAPTCHA/Cloudflare failures)
// Claude Haiku reads the compiled reportEn + deepResearch
// Extracts all parsed{} fields as clean JSON
// Backfills: nameEn, nameAr, legalForm, city, foundingYear, capital,
//            shareholders[], managers[], contacts, AOA provisions
```

### Masaar Backend Files
```
src/lib/masaar-engine.ts    (1782 lines)  Full 5-agent pipeline
src/lib/stealth-browser.ts  (569 lines)   Playwright anti-detect browser
src/lib/browser-helper.ts   (101 lines)   Cheerio extraction helpers
src/crawl4ai-engine.ts      (199 lines)   Playwright → Markdown converter
src/gemini-search.ts        (237 lines)   Gemini grounded web search
src/perplexity-service.ts   (144 lines)   Perplexity sonar REST wrapper
src/routes/masaar.ts                      Express route handler + SSE stream
```

### Masaar Database Schema
```typescript
// Table: masaarCompanies
id, crNumber, nameEn, nameAr, legalForm, legalFormAr,
headquarterCity, foundingYear, capitalAmount,
shareholders (JSONB), managers (JSONB),
reportEn (TEXT), reportAr (TEXT),
complianceRisk, ofacHit, unscHit, euHit,
maroofVerified, maroofRating,
fetchedAt, stealthMode, sources (JSONB)
```

---
---

# ENGINE 2 — AI DATABASE BUILDER

---

## AI Database Builder — Frontend

**Files:**
- `artifacts/prospect-sa/src/pages/database-builder/index.tsx` — Sources dashboard
- `artifacts/prospect-sa/src/pages/database-builder/database.tsx` — Results browser

### React Hooks Used
```typescript
useState      // sources[], harvestStates{}, enrichmentDepth, add-source dialog fields
useEffect     // load sources on mount
useCallback   // loadSources (stable reference)
useQueryClient // (TanStack Query) invalidates builder-results + builder-stats
```

### API Calls
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/builder/sources` | Load all configured sources |
| POST | `/api/builder/sources` | Add custom source `{ name, url, category, estimatedCompanies, description }` |
| DELETE | `/api/builder/sources/:id` | Remove custom source |
| POST | `/api/builder/sources/:id/harvest` | Start harvest job for one source `{ batchSize, enrichmentDepth }` |
| POST | `/api/builder/harvest` | Harvest ALL sources `{ batchSize, enrichmentDepth }` |
| GET | `/api/builder/jobs/:jobId` | Poll job status `{ status, companiesHarvested, progress }` (every 3s) |

### Per-Source Harvest State Machine
```
idle → harvesting → done ✓
                  → error ✗
```
Polling: every 3s for up to 60 polls (3 min) per source, 120 polls for harvest-all.

### Enrichment Depth Selector
```typescript
"basic"    // Fast: Gemini search only
"standard" // Default: Gemini + Claude synthesis + free sources (GLEIF, OpenCorporates)
"deep"     // Full: all 40+ sources including StealthBrowser + Perplexity
```

### Page Components

| Component | Description |
|---|---|
| `DatabaseBuilder` | Main page — sources grid, harvest controls |
| `SourceCard` | Per-source card: name, URL, category emoji, harvest button, progress display, last harvested date |
| Add Source Dialog | `Dialog` from Radix: name, URL, category select, est. companies input, description textarea |
| Enrichment Depth `Select` | Radix Select: basic / standard / deep |

### UI Packages Used
```
Card, CardContent     — source cards
Button                — harvest, harvest-all, add source, delete
Dialog, DialogContent — add source modal
Select, SelectItem    — enrichment depth + category
Label, Input, Textarea — add source form fields
Loader2, CheckCircle2, AlertCircle, Play, Trash2, Plus, Zap, Database, Clock — icons
Link (wouter)         — navigation to /database-builder/results
```

### Source Category Icons
```
government → 🏛️   chamber → 🤝   financial → 💹
directory → 📂    industry-association → 🏭
linkedin → 💼     news → 📰     other → 🔗
```

---

## AI Database Builder — Backend

**Route file:** `artifacts/api-server/src/routes/masar-database.ts`  
**Engine file:** `artifacts/api-server/src/lib/masar-harvester.ts` (2967 lines)

### API Endpoints
| Method | Path | Handler |
|---|---|---|
| GET | `/api/builder/sources` | Returns all configured data sources from DB |
| POST | `/api/builder/sources` | Adds a custom source to DB |
| DELETE | `/api/builder/sources/:id` | Removes custom source |
| POST | `/api/builder/sources/:id/harvest` | Starts harvest job for one source, returns `{ jobId, builderJobId }` |
| POST | `/api/builder/harvest` | Starts harvest-all job, returns `{ jobId }` |
| GET | `/api/builder/jobs/:jobId` | Returns job status + `companiesHarvested` + `progress` |

### NexFlow Waterfall — All 40+ Sources in Priority Order

| Priority | Source | Tech |
|---|---|---|
| 10 | MC.gov.sa CR lookup | StealthBrowser + CAPTCHA + Claude parse |
| 14 | Maroof.sa business profile | axios + Cheerio |
| 16 | Aamaly AOA PDF (emagazine.aamaly.sa) | StealthBrowser + pdf-parse + Claude OCR |
| 18 | GLEIF LEI Registry | axios REST (free, no key needed) |
| 20 | Hunter.io email discovery | axios REST (needs `HUNTER_API_KEY`) |
| 26 | Tadawul / Argaam (Saudi Exchange) | axios REST (public JSON) |
| 28 | OpenCorporates SA | axios REST (free, Saudi jurisdiction) |
| 30 | Gemini Search synthesis | `@google/genai` — grounded web search |
| 32 | Wikidata SPARQL | axios → `query.wikidata.org/sparql` |
| 34 | Clearbit Logo CDN | axios HEAD (no key — always resolves) |
| 36 | GitHub Org API | axios REST (60 req/hr unauthenticated) |
| 38 | Wappalyzer tech-stack | axios REST (needs `WAPPALYZER_API_KEY`) |
| 40 | Claude synthesis | `@anthropic-ai/sdk` — fills remaining fields |
| 44 | GPT-4o fallback | `openai` — last AI fallback |
| 46 | Perplexity `sonar` | axios direct — web-grounded research |
| 50 | Moores Rowland / 8 chamber scrapers | axios + Cheerio (`mooresrowland-scraper.ts`) |
| 52 | OpenCorporates SA bulk harvest | axios paginated (30 per page, 3 pages) |
| 60 | Email Permutator | Pure JS — generates 10 email patterns from name+domain |
| Post | **Web Seeder** (background `setImmediate`) | axios Saudi-UA + Cheerio + Claude |

### Chamber Scrapers (`mooresrowland-scraper.ts`)
8 chamber of commerce directories scraped with axios + Cheerio:
```
1. mooresrowland.net/en/members      — Moores Rowland member firms
2. arabbritishchamber.com/members    — Arab-British Chamber
3. amcham.org.sa/members             — AmCham Saudi Arabia
4. saudibbc.org/members              — Saudi British Business Council (SBBC)
5. jcc.org.sa                        — Jeddah Chamber of Commerce
6. fcc.org.sa / ccef-arabie.com      — French Chamber KSA (CCEF)
7. gdksa.org / riyadh.ahk.de         — German-Arab Chamber (GACIC/AHK)
8. gcc-chambers.com                  — GCC Chambers of Commerce
```

**Per scraper pattern:**
```typescript
axios.get(url, { headers: BROWSER_HEADERS })  // Windows Chrome UA + Arabic Accept-Language
cheerio.load(html)                             // parse member list
$(".member-card, article, .listing-item")      // find member elements
isSaudiRelated(text)                           // filter: saudi/ksa/riyadh/jeddah/الرياض
extractSaudiCity(text)                         // → Riyadh | Jeddah | Dammam | Al Khobar | ...
emailMatch = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i   // extract email
phoneMatch = /(?:\+966|00966)[\s-]?(?:5\d{8}|[1-4]\d{7})/ // extract KSA phone
fetchHtml(profileUrl)                          // individual profile pages (batch of 5)
```

### Free Sources (`free-sources.ts`)
All run in parallel via `Promise.allSettled()`:

| Source | Endpoint | Data Returned |
|---|---|---|
| GLEIF | `api.gleif.org/api/v1/lei-records` | LEI, legal name, country, legal form |
| OpenCorporates | `api.opencorporates.com/v0.4/companies/search?jurisdiction_code=sa` | CR number, founding year, status |
| Wikidata SPARQL | `query.wikidata.org/sparql` | Founded year, employees, HQ, ISIN, CEO |
| Clearbit Logo | `logo.clearbit.com/{domain}` | Company logo URL (CDN, verified with HEAD) |
| GitHub Org | `api.github.com/orgs/{slug}` + `/repos` | Tech stack, hiring signals, public repos |
| Hunter.io | `api.hunter.io/v2/domain-search` | Email pattern, verified emails |
| Tadawul/Argaam | `argaam.com/en/company/company-screener` | ISIN, ticker, sector, market cap |
| Wappalyzer | `api.wappalyzer.com/v2/lookup/` | Tech stack fingerprint |
| Email Permutator | Pure JS | 10 email patterns: first.last@, flast@, firstl@, etc. |

### Web Seeder — Background Auto-Enrichment (`web-seeder.ts`)
Called via `setImmediate()` after primary enrichment completes:
```typescript
// 1. Saudi User-Agent + Arabic Accept-Language
headers: {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
  "Accept-Language": "ar,en;q=0.9"
}

// 2. Link discovery — crawls homepage + 4 internal pages
axios.get(companyWebsite)
cheerio.load(html)
$("a[href]") → collect internal links → deduplicate → take first 5

// 3. Per-page Claude extraction (Claude Haiku, 1024 tokens, 20s timeout)
// Extracts: phone, email, address, services, about text, team names

// 4. Claude aggregation (Claude 3.5, 3000 tokens, 45s timeout)
// Merges all pages → structured company profile

// 5. Race-safe DB write: re-fetches current row before merging
// Prevents stomping on fresh data from concurrent enrichment
```

### AI Enrichment in masar-harvester.ts
```typescript
// Gemini grounded search (PRIMARY)
searchWithGemini(`"${companyName}" Saudi Arabia ${field}`)

// Claude synthesis (SECONDARY)
anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 2000 })

// GPT-4o (TERTIARY)
openai.chat.completions.create({ model: "gpt-4o", max_completion_tokens: 1500 })

// PDF extraction
import pdfParse from "pdf-parse"
pdfParse(buffer) → text → Claude Arabic OCR + field extraction
```

### AI Database Builder Backend Files
```
src/lib/masar-harvester.ts         (2967 lines)  Full 40+ source harvest pipeline
src/lib/free-sources.ts            (600+ lines)  9 free REST sources
src/lib/mooresrowland-scraper.ts   (700+ lines)  8 chamber directory scrapers
src/lib/bluepages-scraper.ts                     Bluepages directory scraper
src/lib/web-seeder.ts              (325 lines)   Background Saudi web crawler
src/lib/builder-engine.ts                        Orchestration + job management
src/lib/enrichment-engine.ts                     Field-level enrichment logic
src/lib/data-sources.ts                          Source definitions registry
src/routes/masar-database.ts                     Express route handler + job registry
```

### AI Database Builder DB Schema
```typescript
// Table: masarCompanies (main harvest table)
id, nameEn, nameAr, website, phone, email, city, region,
crNumber, legalForm, foundingYear, capitalAmount, estimatedRevenue,
employees, sector, mainActivity, description,
shareholders (JSONB), managers (JSONB), logoUrl,
gleifLei, opencorporatesCrNumber, wikidataId,
tadawulIsin, tadawulTicker, tadawulSector,
hunterEmailPattern, githubOrgName, techStack (JSONB),
webSeederData (JSONB), sourcesPriority (JSONB),
enrichmentDepth, lastEnrichedAt, createdAt, updatedAt

// Table: builderJobs
id, jobId (UUID), status, companiesHarvested, progress,
sourceId, enrichmentDepth, startedAt, completedAt
```

---
---

# ENGINE 3 — PROSENGINE

---

## ProsEngine — Frontend

**Files:**
- `artifacts/prospect-sa/src/pages/prospecting/index.tsx` — Hub / mode selector
- `artifacts/prospect-sa/src/pages/prospecting/company.tsx` — Company Intel UI
- `artifacts/prospect-sa/src/pages/prospecting/person.tsx` — Person Intel UI
- `artifacts/prospect-sa/src/pages/prospecting/website.tsx` — Website Scanner UI
- `artifacts/prospect-sa/src/pages/prospecting/seeder.tsx` — Data Seeder UI

### Hub Page (`index.tsx`)
4 mode cards, each routing to a sub-page:
```
Company Intelligence  → /prospecting/company   (Building2 icon, cyan)
Person Intelligence   → /prospecting/person    (User icon, violet)
Website Intelligence  → /prospecting/website   (Globe icon, teal)
Data Seeder           → /prospecting/seeder    (Database icon, amber)
```

**Routing:** `wouter` `useLocation()` → `navigate(path)`  
**Components used:** `Card`, `CardContent`, lucide icons, inline styled mode cards

### Company Intel Page (`company.tsx`)
**Input:** Company name (no website required)  
**Output:** Full dossier — shareholders, leadership, financials, competitors, B2B approach

```typescript
// Hooks
useState    // companyName, loading, result, error, activeTab
useRef      // abort controller

// API call
POST /api/company-intel
Body: { companyName: string }
Returns: CompanyIntelResult {
  nameEn, nameAr, website, phone, email,
  shareholders[], executives[], revenue,
  competitors[], b2bApproach, marketPosition,
  reportEn, reportAr
}
```

**UI Components:**
```
Card, CardContent, CardHeader     — result sections
Input                             — company name input
Button                            — search
Tabs, TabsContent                 — Overview / Shareholders / Leadership / Report EN / Report AR
Badge                             — confidence levels
Loader2                           — loading spinner
```

### Person Intel Page (`person.tsx`)
**Input:** Person name + optional company + optional LinkedIn URL  
**Output:** Full executive dossier — wealth, career, education, B2B approach

```typescript
// API call
POST /api/person-intel
Body: { personName, companyName?, linkedinUrl? }
Returns: PersonIntelResult {
  nameEn, nameAr, title, company,
  wealthEstimate, careerHistory[], education[],
  boardMemberships[], contactInfo,
  b2bApproach, culturalNotes,
  reportEn, reportAr
}
```

### Website Intel Page (`website.tsx`)
**Input:** Any Saudi business website URL  
**Output:** Extracted companies + executives, enriched with AI

```typescript
POST /api/prospecting/website
Body: { url: string }
Returns: { companies[], executives[], sourceType: "directory"|"portal"|"catalog" }
```

### Data Seeder Page (`seeder.tsx`)
**Input:** Plain text description OR website URL  
**Output:** Structured Saudi company + executive records (AI-generated)

```typescript
POST /api/prospecting/seed
Body: { description?: string, url?: string, count: number }
Returns: { companies[], executives[] }
// + CSV export button
// + AI chat assistant for refinement
```

---

## ProsEngine — Backend

**Route files:**
- `artifacts/api-server/src/routes/company-intel.ts` (500 lines)
- `artifacts/api-server/src/routes/person-intel.ts` (774 lines)

### Company Intel — Source Waterfall (`company-intel.ts`)

All sources run in a waterfall — each contributes to a growing data object:

| Source | File | Method | AI Used |
|---|---|---|---|
| **Source 1 — Web Seeder** | `lib/web-seeder.ts` | axios Saudi-UA + Cheerio link graph (5 pages) + Claude extraction | Claude Haiku (1024 tok/page, 3000 tok aggregate) |
| **Source 2 — Gemini Search** | `gemini-search.ts` | `@google/genai` grounded web search | Gemini 2.5 Flash |
| **Source 3 — Claude Synthesis** | inline | All collected data → Claude opus/sonnet | Claude Sonnet |
| **Source 4 — Perplexity** | `perplexity-service.ts` | `sonar` model, 1500 tokens + citations | Perplexity sonar |
| **Source 5 — Free Sources** | `lib/free-sources.ts` | GLEIF, OpenCorporates, Wikidata, Clearbit, GitHub, Hunter, Tadawul, Wappalyzer (all parallel) | None — pure REST |

**API endpoint:**
```
POST /api/company-intel
Request:  { companyName: string }
Response: { nameEn, nameAr, website, phone, email, shareholders[],
            executives[], revenue, competitors[], b2bApproach,
            marketPosition, reportEn, reportAr, sources[] }
```

### Person Intel — Source Waterfall (`person-intel.ts`)

| Source | Method | AI Used |
|---|---|---|
| **Source 1 — Crawl4AI** | `crawl4ai-engine.ts` — Playwright headless Chromium → HTML→Markdown (TurndownService) | Gemini parses Markdown |
| **Source 2 — Company Crawl Agent** | StealthBrowser crawls company domain → finds staff/about/team pages → Cheerio extracts bio text | Claude Vision + Cheerio |
| **Source 3 — Gemini Search** | `gemini-search.ts` — person name + company query | Gemini 2.5 Flash |
| **Source 4 — Claude Synthesis** | All sources merged → structured JSON dossier | Claude Sonnet |
| **Source 5 — LinkedIn Simulation** | Gemini grounded search targeting LinkedIn profile data | Gemini 2.5 Flash |

**API endpoint:**
```
POST /api/person-intel
Request:  { personName: string, companyName?: string, linkedinUrl?: string }
Response: { nameEn, nameAr, title, company, wealthEstimate, careerHistory[],
            education[], boardMemberships[], contactInfo,
            b2bApproach, culturalNotes, reportEn, reportAr }
```

### ProsEngine Backend Files
```
src/routes/company-intel.ts      (500 lines)   Company intel endpoint + waterfall
src/routes/person-intel.ts       (774 lines)   Person intel endpoint + waterfall
src/lib/web-seeder.ts            (325 lines)   Background Saudi web crawler
src/crawl4ai-engine.ts           (199 lines)   Playwright HTML→Markdown crawler
src/lib/stealth-browser.ts       (569 lines)   Anti-detect browser (used for company crawl agent)
src/gemini-search.ts             (237 lines)   Gemini grounded search wrapper
src/perplexity-service.ts        (144 lines)   Perplexity sonar REST wrapper
src/lib/free-sources.ts          (600+ lines)  9 free REST data sources
src/lib/prospecting-engine.ts                  Prospecting orchestration
src/routes/prospecting.ts                      Prospecting route handler
```

---
---

# BUILT-IN SCRAPING ENGINE — ALL LAYERS

---

## Layer 1 — StealthBrowser (Playwright Chromium)
**File:** `src/lib/stealth-browser.ts` (569 lines)  
**Package:** `playwright` ^1.58.2  
**Used by:** Masaar Engine (Agents 1 & 2), AI Database Builder (sources 10 & 16), ProsEngine (Source 2 company crawl agent)

```
Anti-fingerprint JS injection:
  navigator.webdriver = false
  navigator.plugins.length spoofed to 3
  navigator.platform = "Win32"
  canvas noise: getImageData() + toDataURL() pixel noise
  WebGL vendor/renderer spoofed
  performance.now() / Date.now() timing jitter ±2ms

Human simulation:
  Bézier curve mouse paths (3-control-point random arcs)
  Gaussian typing delays (μ=120ms, σ=40ms)
  Random idle delays between actions

Session management:
  Saves cookies + localStorage per domain to JSON file
  Restores on next visit (skips Cloudflare if session valid)

CAPTCHA solving:
  screenshot() → base64 PNG → Claude Vision
  Prompt: "What is the verification code in this image?"
  3 attempts → human fallback if confidence too low

Cloudflare bypass:
  detectChallenge() → checks for cf-challenge, turnstile selectors
  waitForCloudflare() → polls until challenge iframe gone
```

## Layer 2 — Crawl4AI Engine (Playwright + Markdown)
**File:** `src/crawl4ai-engine.ts` (199 lines)  
**Packages:** `playwright` ^1.58.2, `turndown` ^7.2.2  
**Used by:** ProsEngine (Source 1 — person intel crawl)

```
Playwright page.goto() → page.content()
TurndownService().turndown(html) → clean Markdown
Content chunked and fed to Gemini for field extraction
```

## Layer 3 — Web Seeder (axios + Cheerio)
**File:** `src/lib/web-seeder.ts` (325 lines)  
**Packages:** `axios` ^1.13.6, `cheerio` ^1.2.0  
**Used by:** ProsEngine (Source 1), AI Database Builder (post-enrichment background)

```
Saudi Chrome User-Agent: Windows NT 10.0 + Chrome 122
Accept-Language: ar,en;q=0.9
axios.get(homepage)
cheerio.load(html)
$("a[href]") → collect + deduplicate internal links → take 5
Per page: Claude Haiku (1024 tokens, 20s timeout)
Aggregate: Claude 3.5 (3000 tokens, 45s timeout)
Background: setImmediate() — non-blocking, re-fetches DB row before write
```

## Layer 4 — Free Sources REST API Client
**File:** `src/lib/free-sources.ts` (600+ lines)  
**Package:** `axios` (GET + HEAD requests only)  
**Used by:** AI Database Builder (priorities 18–38), ProsEngine (Source 5)

```
All run in parallel via Promise.allSettled():
GLEIF           → api.gleif.org (no key, JSON)
OpenCorporates  → api.opencorporates.com (no key, jurisdiction=sa)
Wikidata SPARQL → query.wikidata.org/sparql (no key, SPARQL)
Clearbit Logo   → logo.clearbit.com/{domain} (no key, CDN HEAD)
GitHub Org      → api.github.com/orgs/{slug} + /repos (no key, 60/hr)
Hunter.io       → api.hunter.io/v2/domain-search (needs HUNTER_API_KEY)
Tadawul/Argaam  → argaam.com screener + saudiexchange.sa (public JSON)
Wappalyzer      → api.wappalyzer.com/v2/lookup/ (needs WAPPALYZER_API_KEY)
Email Permut.   → pure JS (first.last@, flast@, firstl@, etc.)
```

## Layer 5 — Chamber Scrapers (axios + Cheerio)
**File:** `src/lib/mooresrowland-scraper.ts` (700+ lines)  
**Packages:** `axios`, `cheerio`, `events`  
**Used by:** AI Database Builder (priority 50)

```
Pattern for all 8 chambers:
1. axios.get(directoryUrl)    — fetch member listing
2. cheerio.load(html)         — parse DOM
3. isSaudiRelated(text)       — filter: "saudi"|"ksa"|"riyadh"|"الرياض"
4. extractLinks($, base, [])  — collect profile URLs
5. fetchHtml(profileUrl)      — per profile (batches of 5, 600–800ms delay)
6. extractSaudiCity(text)     — → Riyadh|Jeddah|Dammam|Al Khobar|...
7. emailMatch regex           — extract email
8. phoneMatch regex           — extract +966 KSA number
```

---
---

# DATABASE LAYER

**Package:** `drizzle-orm` + `pg` (PostgreSQL)  
**Connection:** `process.env.DATABASE_URL`  
**Shared via:** `@workspace/db` monorepo package

### Tables

| Table | Engine | Key Columns |
|---|---|---|
| `masaarCompanies` | Masaar | crNumber, nameEn, nameAr, reportEn, reportAr, parsed JSONB |
| `masarCompanies` | AI Database Builder | nameEn, nameAr, website, phone, email, shareholders JSONB, managers JSONB |
| `builderJobs` | AI Database Builder | jobId, status, companiesHarvested, progress |
| `builderSources` | AI Database Builder | sourceId, name, url, category, estimatedCompanies, lastHarvestedAt |
| `leads` | ProsEngine | nameEn, nameAr, company, email, phone, status |
| `leadLists` | ProsEngine | name, description, leadIds JSONB |
| `meshbaseCompanies` | MeshBase | id, nameEn, nameAr, sector, website |
| `meshbaseExecutives` | MeshBase | id, nameEn, nameAr, title, companyId |
| `prospectingSessions` | ProsEngine | id, type, input, result JSONB |

---

# ENVIRONMENT VARIABLES

```bash
# Required
ANTHROPIC_API_KEY        # Claude (PRIMARY AI for all engines)
GEMINI_API_KEY           # Gemini (PRIMARY search for all engines)
DATABASE_URL             # PostgreSQL connection string

# Optional — enhance functionality
OPENAI_API_KEY           # GPT-4o (tertiary fallback)
PERPLEXITY_API_KEY       # Perplexity sonar deep research
HUNTER_API_KEY           # Hunter.io email discovery
WAPPALYZER_API_KEY       # Wappalyzer tech-stack fingerprint
OPENROUTER_API_KEY       # OpenRouter stub (deepseek-r1, llama-3.3-70b)
GROQ_API_KEY             # Groq stub (llama-3 family)

# Kill switches
DISABLE_PERPLEXITY=true  # Disable Perplexity if key invalid/rate-limited
```

---

# COMPLETE SOURCE FILE MAP

| File | Lines | Engine | Role |
|---|---|---|---|
| `routes/masaar.ts` | — | Masaar | Route + SSE stream |
| `routes/company-intel.ts` | 500 | ProsEngine | Company intel endpoint |
| `routes/person-intel.ts` | 774 | ProsEngine | Person intel endpoint |
| `routes/masar-database.ts` | — | AI Database Builder | Harvest route + job management |
| `routes/builder.ts` | — | AI Database Builder | Source CRUD |
| `lib/masaar-engine.ts` | 1782 | Masaar | 5-agent pipeline |
| `lib/masar-harvester.ts` | 2967 | AI Database Builder | 40+ source harvest pipeline |
| `lib/web-seeder.ts` | 325 | ProsEngine + AI DB | Background Saudi web crawler |
| `lib/stealth-browser.ts` | 569 | All engines | Anti-detect Playwright browser |
| `lib/free-sources.ts` | 600+ | AI DB + ProsEngine | 9 free REST API sources |
| `lib/mooresrowland-scraper.ts` | 700+ | AI Database Builder | 8 chamber scrapers |
| `lib/bluepages-scraper.ts` | — | AI Database Builder | Bluepages directory scraper |
| `lib/builder-engine.ts` | — | AI Database Builder | Job orchestration |
| `lib/enrichment-engine.ts` | — | AI Database Builder | Field-level enrichment |
| `lib/anthropic-service.ts` | — | All engines | Claude wrapper |
| `lib/prospecting-engine.ts` | — | ProsEngine | Prospecting orchestration |
| `crawl4ai-engine.ts` | 199 | ProsEngine | Playwright HTML→Markdown |
| `gemini-search.ts` | 237 | All engines | Gemini search wrapper |
| `perplexity-service.ts` | 144 | All engines | Perplexity sonar wrapper |
| `browser-helper.ts` | 101 | All engines | Cheerio extraction helpers |
| `pages/masaar/index.tsx` | — | Masaar FE | Full pipeline UI + SSE |
| `pages/database-builder/index.tsx` | — | AI DB FE | Sources dashboard |
| `pages/database-builder/database.tsx` | — | AI DB FE | Results browser |
| `pages/prospecting/index.tsx` | — | ProsEngine FE | Hub / mode selector |
| `pages/prospecting/company.tsx` | — | ProsEngine FE | Company intel UI |
| `pages/prospecting/person.tsx` | — | ProsEngine FE | Person intel UI |
| `pages/prospecting/website.tsx` | — | ProsEngine FE | Website scanner UI |
| `pages/prospecting/seeder.tsx` | — | ProsEngine FE | Data seeder UI |
