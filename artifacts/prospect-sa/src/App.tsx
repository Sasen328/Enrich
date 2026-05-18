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
        <Route path="/database-builder" component={DatabaseBuilder} />
        <Route path="/database-builder/results" component={BuilderResults} />
        <Route path="/leads" component={LeadsPage} />
        <Route path="/meshbase/companies/:id" component={MeshBaseCompanyProfile} />
        <Route path="/meshbase/executives/:id" component={MeshBaseExecutiveProfile} />
        <Route path="/meshbase/companies" component={MeshBaseCompanies} />
        <Route path="/meshbase/executives" component={MeshBaseExecutives} />
        <Route path="/meshbase" component={MeshBase} />
        <Route path="/orcengine" component={OrcEnginePage} />
        <Route path="/masaar/database" component={MasaarDatabasePage} />
        <Route path="/lead-factory/person" component={LeadFactoryPersonPage} />
        <Route path="/lead-factory/company" component={LeadFactoryCompanyPage} />
        <Route path="/lead-factory" component={LeadFactoryPage} />
        <Route path="/masaar" component={MasaarPage} />
        <Route path="/signal-intelligence/tree" component={SignalsTreePage} />
        <Route path="/signal-intelligence" component={SignalIntelligencePage} />
        <Route path="/relationship-intel" component={RelationshipIntelPage} />
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
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="prospectsa-theme">
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
