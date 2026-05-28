import { type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout/Layout";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/">{() => <Redirect to="/ai-chat" />}</Route>
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
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  // When opened as a static file (offline single-file export), path-based
  // routing can't work, so fall back to hash routing. No effect when served.
  const isFile = typeof window !== "undefined" && window.location.protocol === "file:";
  const routerProps = isFile
    ? { hook: useHashLocation }
    : { base: import.meta.env.BASE_URL.replace(/\/$/, "") };
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="prospectsa-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter {...routerProps}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
