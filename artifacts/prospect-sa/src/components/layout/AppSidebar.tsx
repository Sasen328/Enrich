import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  LayoutDashboard, Radar, Database, Landmark, ChevronDown,
  Settings, Building2, UserCircle, TrendingUp, Users, Zap,
  Network, Globe, User, Search, TableProperties, BarChart3,
  Target, BrainCircuit, Layers, Activity, GitFork, Sparkles,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton,
  SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const coreNav = [
  { title: "Dashboard",        url: "/",                      icon: LayoutDashboard },
  { title: "AI Chat",          url: "/ai-chat",               icon: Sparkles },
  { title: "Leads",            url: "/leads",                 icon: Target },
  { title: "Lead Factory",     url: "/lead-factory/person",   icon: Zap },
  { title: "  ↳ Company Hunt", url: "/lead-factory/company",  icon: Zap },
];

const prosEngineTools = [
  { title: "Company Intel", url: "/prospecting/company",  icon: Building2 },
  { title: "Person Intel",  url: "/prospecting/person",   icon: User },
  { title: "Website Intel", url: "/prospecting/website",  icon: Globe },
  { title: "Data Seeder",   url: "/prospecting/seeder",   icon: Layers },
];

const masaarTools = [
  { title: "CR Lookup",      url: "/masaar",          icon: Search },
  { title: "Masar Database", url: "/masaar/database", icon: TableProperties },
];

const orcbaseItems = [
  { title: "Overview",   url: "/meshbase",            icon: BarChart3 },
  { title: "Companies",  url: "/meshbase/companies",  icon: Building2 },
  { title: "Executives", url: "/meshbase/executives", icon: UserCircle },
];

const saMarketItems: { title: string; url: string; icon: React.ComponentType<{ className?: string }> }[] = [
  // Tadawul shareholders + executives temporarily removed pending fresh data sheet.
  // Re-enable once the operator pushes the updated dataset.
];

function NavGroup({ label, icon: Icon, items, activeCheck }: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: { title: string; url: string; icon: React.ComponentType<{ className?: string }> }[];
  activeCheck: boolean;
}) {
  const [location] = useLocation();
  const [open, setOpen] = useState(activeCheck);
  return (
    <SidebarMenuItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton className={`h-10 rounded-xl transition-all duration-200 w-full ${activeCheck ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}>
            <div className="flex items-center gap-3 px-3 w-full">
              <Icon className={`w-4 h-4 flex-shrink-0 ${activeCheck ? "text-primary" : "text-muted-foreground"}`} />
              <span className="font-medium text-sm flex-1 text-left">{label}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""} ${activeCheck ? "text-primary" : "text-muted-foreground"}`} />
            </div>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="ml-3 mt-0.5 mb-0.5 border-l border-primary/20 pl-3 gap-0">
            {items.map((sub) => {
              const isActive = location === sub.url || (sub.url !== "/" && location.startsWith(sub.url));
              return (
                <SidebarMenuSubItem key={sub.url}>
                  <SidebarMenuSubButton asChild isActive={isActive} className={`h-8 rounded-lg transition-all duration-150 ${isActive ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}>
                    <Link href={sub.url} className="flex items-center gap-2.5 px-2">
                      <sub.icon className={`w-3.5 h-3.5 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="text-xs font-medium">{sub.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

function NavItem({ item }: { item: { title: string; url: string; icon: React.ComponentType<{ className?: string }>; badge?: string } }) {
  const [location] = useLocation();
  const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} className={`h-10 rounded-xl transition-all duration-200 ${isActive ? "bg-primary/15 text-primary glow-brand-sm" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}>
        <Link href={item.url} className="flex items-center gap-3 px-3">
          <item.icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
          <span className="font-medium text-sm flex-1">{item.title}</span>
          {item.badge && <span className="text-[10px] font-mono bg-primary/15 text-primary px-1.5 py-0.5 rounded-md border border-primary/20">{item.badge}</span>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const isProsActive   = location === "/prospecting" || location.startsWith("/prospecting/");
  const isMasaarActive = location === "/masaar"      || location.startsWith("/masaar/");
  const isOrcActive    = location === "/meshbase"    || location.startsWith("/meshbase/");
  const isSAActive     = location === "/sa-market"   || location.startsWith("/sa-market/");

  return (
    <Sidebar variant="inset" className="border-r border-border/30 bg-sidebar/70 backdrop-blur-2xl">
      <SidebarHeader className="px-5 py-5 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center glow-brand-sm">
            <Radar className="w-4 h-4 text-primary" />
          </div>
          <div>
            <span className="font-display text-lg font-bold tracking-tight text-foreground leading-none">ProspectSA</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="pulse-dot" />
              <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Live</span>
            </div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3 py-2 gap-4">

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-1 px-1">Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {coreNav.map((item) => (
                <NavItem key={item.url} item={{ ...item, badge: item.url === "/lead-factory/person" ? "7-Agent" : undefined }} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-1 px-1">Intelligence</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <NavGroup label="ProsEngine" icon={BrainCircuit} items={prosEngineTools} activeCheck={isProsActive} />
              <NavGroup label="Masaar" icon={Landmark} items={masaarTools} activeCheck={isMasaarActive} />
              <NavItem item={{ title: "OrcEngine", url: "/orcengine", icon: Network }} />
              <NavItem item={{ title: "AI Database Builder", url: "/database-builder", icon: Database }} />
              {/* Signal Intel + Relationship Intel are now Lead Factory tools.
                  Kept at top-level paths as redirects in App.tsx so old bookmarks
                  still work, but removed from the sidebar to consolidate the
                  workflow inside Lead Factory. */}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-1 px-1">Market Data</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <NavGroup label="OrcBase / MeshBase" icon={BarChart3} items={orcbaseItems} activeCheck={isOrcActive} />
              {/* SA Market (Tadawul shareholders + executives) temporarily hidden
                  pending fresh dataset from operator. Re-enable when ready. */}
              {saMarketItems.length > 0 && (
                <NavGroup label="SA Market" icon={TrendingUp} items={saMarketItems} activeCheck={isSAActive} />
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="p-3">
        <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/40 transition-colors cursor-pointer border border-transparent hover:border-white/8">
          <Avatar className="w-8 h-8 border border-primary/30">
            <AvatarFallback className="bg-primary/15 text-primary font-semibold text-xs">SA</AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 overflow-hidden">
            <span className="text-xs font-semibold text-foreground truncate">Admin User</span>
            <span className="text-[11px] text-muted-foreground truncate font-mono">admin@prospectsaudi.com</span>
          </div>
          <Settings className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
