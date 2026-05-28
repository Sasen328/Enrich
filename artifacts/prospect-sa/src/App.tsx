import { type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout/Layout";
import Dashboard from "@/pages/Dashboard";
import CompaniesPage from "@/pages/companies";
import ProspectingPage from "@/pages/prospecting";
import WebsiteIntelPage from "@/pages/prospecting/website";
import PersonIntelPage from "@/pages/prospecting/person";
import CompanyIntelPage from "@/pages/prospecting/company";
import DataSeederPage from "@/pages/prospecting/seeder";
import DatabaseBuilder from "@/pages/database-builder";
import BuilderResults from "@/pages/database-builder/results";
import LeadsPage from "@/pages/leads";
import MeshBase from "@/pages/MeshBase";
import MeshBaseCompanies from "@/pages/MeshBaseCompanies";
import MeshBaseExecutives from "@/pages/MeshBaseExecutives";
import MeshBaseCompanyProfile from "@/pages/MeshBaseCompanyProfile";
import MeshBaseExecutiveProfile from "@/pages/MeshBaseExecutiveProfile";
import OrcEnginePage from "@/pages/orcengine";
import MasaarPage from "@/pages/masaar";
import MasaarDatabasePage from "@/pages/masaar/database";
import SAMarketShareholdersPage from "@/pages/sa-market/shareholders";
import SAMarketExecutivesPage from "@/pages/sa-market/executives";
import NotFound from "@/pages/not-found";
import LeadFactoryPage from "@/pages/lead-factory";
import LeadFactoryPersonPage from "@/pages/lead-factory/person";
import LeadFactoryCompanyPage from "@/pages/lead-factory/company";
import LeadFactoryResultsPage from "@/pages/lead-factory/results";
import AIChatPage from "@/pages/ai-chat";
import SwarmBoardPage from "@/pages/swarm";
import { Redirect } from "wouter";
import RelationshipIntelTreePage from "@/pages/relationship-intel/tree";
import SignalIntelligencePage from "@/pages/signal-intelligence";
import SignalsTreePage from "@/pages/signal-intelligence/tree";
import RelationshipIntelPage from "@/pages/relationship-intel";
import { TrendingUp, Users } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function SAMarketLayout({ tab, children }: { tab: "shareholders" | "executives"; children: ReactNode }) {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-white tracking-tight">SA Market Prospecting</h1>
          <p className="text-muted-foreground mt-1">TASI & NOMU listed companies — shareholders, board members & executives with AI deep profiling</p>
        </div>
      </div>
      <div className="flex gap-1 border-b border-white/10 pb-0">
        {([
          { id: "shareholders", label: "Shareholders", icon: TrendingUp, href: `${BASE}/sa-market/shareholders` },
          { id: "executives",   label: "Executives",   icon: Users,     href: `${BASE}/sa-market/executives` },
        ] as const).map(({ id, label, icon: Icon, href }) => (
          <a key={id} href={href}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-white hover:border-white/20"}`}>
            <Icon className="w-4 h-4" />{label}
          </a>
        ))}
      </div>
      {children}
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/companies" component={CompaniesPage} />
        <Route path="/prospecting/website" component={WebsiteIntelPage} />
        <Route path="/prospecting/person" component={PersonIntelPage} />
        <Route path="/prospecting/company" component={CompanyIntelPage} />
        <Route path="/prospecting/seeder" component={DataSeederPage} />
        <Route path="/prospecting" component={ProspectingPage} />
        {/* ProsEngine aliases — same pages, new prefix */}
        <Route path="/prosengine/website" component={WebsiteIntelPage} />
        <Route path="/prosengine/person"  component={PersonIntelPage} />
        <Route path="/prosengine/company" component={CompanyIntelPage} />
        <Route path="/prosengine/seeder"  component={DataSeederPage} />
        <Route path="/prosengine" component={ProspectingPage} />
        <Route path="/database-builder" component={DatabaseBuilder} />
        <Route path="/database-builder/results" component={BuilderResults} />
        <Route path="/leads" component={LeadsPage} />
        {/* New Lead Genome alias for /leads */}
        <Route path="/lead-genome" component={LeadsPage} />
        <Route path="/lead-genome/lists" component={LeadsPage} />
        <Route path="/meshbase/companies/:id" component={MeshBaseCompanyProfile} />
        <Route path="/meshbase/executives/:id" component={MeshBaseExecutiveProfile} />
        <Route path="/meshbase/companies" component={MeshBaseCompanies} />
        <Route path="/meshbase/executives" component={MeshBaseExecutives} />
        <Route path="/meshbase" component={MeshBase} />
        <Route path="/orcengine" component={OrcEnginePage} />
        <Route path="/masaar/database" component={MasaarDatabasePage} />
        {/* Harvest AI = Masaar Engine + Masaar Database + AI DB Builder, grouped */}
        <Route path="/harvest-ai/masaar-engine"   component={MasaarPage} />
        <Route path="/harvest-ai/masaar-database" component={MasaarDatabasePage} />
        <Route path="/harvest-ai/db-builder"      component={DatabaseBuilder} />
        <Route path="/harvest-ai/db-builder/results" component={BuilderResults} />
        <Route path="/harvest-ai">{() => <Redirect to="/harvest-ai/masaar-engine" />}</Route>
        {/* ── Lead Factory + its sub-tools ────────────────────────────────
            Signal Intel and Relationship Intel are now Lead Factory tools.
            They live under /lead-factory/* paths. The old top-level URLs
            still work as redirects to keep bookmarks alive. */}
        <Route path="/lead-factory/results" component={LeadFactoryResultsPage} />
        <Route path="/lead-factory/person" component={LeadFactoryPersonPage} />
        <Route path="/lead-factory/company" component={LeadFactoryCompanyPage} />
        <Route path="/lead-factory/signals/tree" component={SignalsTreePage} />
        <Route path="/lead-factory/signals" component={SignalIntelligencePage} />
        <Route path="/lead-factory/relationship/tree" component={RelationshipIntelTreePage} />
        <Route path="/lead-factory/relationship" component={RelationshipIntelPage} />
        <Route path="/lead-factory/legacy" component={LeadFactoryPage} />
        <Route path="/lead-factory">{() => <Redirect to="/lead-factory/person" />}</Route>

        {/* ── AI Chat Agent (ProsEngine /chat/stream) ─────────────────── */}
        <Route path="/ai-chat" component={AIChatPage} />

        {/* ── SwarmBoard — Kimi-coordinated agent swarm mission control ── */}
        <Route path="/swarm" component={SwarmBoardPage} />

        {/* Old paths redirect into the Lead Factory namespace */}
        <Route path="/signal-intelligence/tree">{() => <Redirect to="/lead-factory/signals/tree" />}</Route>
        <Route path="/signal-intelligence">{() => <Redirect to="/lead-factory/signals" />}</Route>
        <Route path="/relationship-intel/tree">{() => <Redirect to="/lead-factory/relationship/tree" />}</Route>
        <Route path="/relationship-intel">{() => <Redirect to="/lead-factory/relationship" />}</Route>
        <Route path="/masaar" component={MasaarPage} />
        {/* Signal Intel + Relationship Intel moved under /lead-factory/*
            — top-level redirects above keep old URLs working. */}
        <Route path="/sa-market/shareholders" component={() => <SAMarketLayout tab="shareholders"><SAMarketShareholdersPage /></SAMarketLayout>} />
        <Route path="/sa-market/executives"   component={() => <SAMarketLayout tab="executives"><SAMarketExecutivesPage /></SAMarketLayout>} />
        <Route path="/sa-market" component={() => <SAMarketLayout tab="shareholders"><SAMarketShareholdersPage /></SAMarketLayout>} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="prospectsa-theme">
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

export default App;
