# ProspectSA — Frontend Replication Guide
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
