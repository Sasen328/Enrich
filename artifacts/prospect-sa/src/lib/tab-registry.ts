// §3 — Tab registry (placeholders filled with actual app routes).
// TAB_NAMES, TAB_SUBS, TAB_DEEP map to /lead-factory, /prospecting, etc.

import {
  LayoutDashboard, Sparkles, Target, Zap, Building2, User, Globe,
  Layers, Search, TableProperties, BarChart3, UserCircle, Network,
  Database, Activity, GitFork, FileBarChart,
} from "lucide-react";

export interface TabItem {
  id: string;
  label: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  /** if true, sub-tab is marked with › and slides the rail open */
  rail?: boolean;
}

export const TAB_NAMES: TabItem[] = [
  { id: "dashboard",       label: "Dashboard",         url: "/",                icon: LayoutDashboard },
  { id: "ai-chat",         label: "AI Chat",           url: "/ai-chat",         icon: Sparkles },
  { id: "leads",           label: "Leads",             url: "/leads",           icon: Target },
  { id: "lead-factory",    label: "Lead Factory",      url: "/lead-factory/person", icon: Zap },
  { id: "prospecting",     label: "Prospecting",       url: "/prospecting",     icon: Building2 },
  { id: "masaar",          label: "Masaar",            url: "/masaar",          icon: Search },
  { id: "meshbase",        label: "MeshBase",          url: "/meshbase",        icon: BarChart3 },
  { id: "sa-market",       label: "SA Market",         url: "/sa-market",       icon: TableProperties },
  { id: "orcengine",       label: "OrcEngine",         url: "/orcengine",       icon: Network },
  { id: "db-builder",      label: "AI Database Builder", url: "/database-builder", icon: Database },
];

export const TAB_SUBS: Record<string, TabItem[]> = {
  "lead-factory": [
    { id: "person",       label: "Person Hunt",   url: "/lead-factory/person",       icon: User,         rail: true },
    { id: "company",      label: "Company Hunt",  url: "/lead-factory/company",      icon: Building2,    rail: true },
    { id: "results",      label: "Results",       url: "/lead-factory/results",      icon: FileBarChart, rail: true },
    { id: "signals",      label: "Signals",       url: "/lead-factory/signals",      icon: Activity },
    { id: "relationship", label: "Relationship",  url: "/lead-factory/relationship", icon: GitFork },
  ],
  "prospecting": [
    { id: "company-intel", label: "Company Intel", url: "/prospecting/company",  icon: Building2 },
    { id: "person-intel",  label: "Person Intel",  url: "/prospecting/person",   icon: User },
    { id: "website-intel", label: "Website Intel", url: "/prospecting/website",  icon: Globe },
    { id: "seeder",        label: "Data Seeder",   url: "/prospecting/seeder",   icon: Layers },
  ],
  "masaar": [
    { id: "cr-lookup",  label: "CR Lookup",      url: "/masaar",          icon: Search },
    { id: "database",   label: "Masar Database", url: "/masaar/database", icon: TableProperties },
  ],
  "meshbase": [
    { id: "overview",   label: "Overview",   url: "/meshbase",            icon: BarChart3,  rail: true },
    { id: "companies",  label: "Companies",  url: "/meshbase/companies",  icon: Building2,  rail: true },
    { id: "executives", label: "Executives", url: "/meshbase/executives", icon: UserCircle, rail: true },
  ],
  "sa-market": [
    { id: "shareholders", label: "Shareholders", url: "/sa-market/shareholders", icon: User },
    { id: "executives",   label: "Executives",   url: "/sa-market/executives",   icon: UserCircle },
  ],
};

/** Deep panels (› markers) opened by sub-tab click — surfaced by the rail */
export const TAB_DEEP: Record<string, { id: string; label: string }[]> = {
  "lead-factory/person":   [{ id: "form",    label: "Filters" }, { id: "preview", label: "Preview" }, { id: "history", label: "History" }],
  "lead-factory/company":  [{ id: "form",    label: "Filters" }, { id: "preview", label: "Preview" }, { id: "history", label: "History" }],
  "lead-factory/results":  [{ id: "lists",   label: "Lists" },   { id: "export",  label: "Export" },  { id: "logs",    label: "Logs" }],
  "meshbase/overview":     [{ id: "kpis",    label: "KPIs" },    { id: "trends",  label: "Trends" },  { id: "feed",    label: "Activity" }],
  "meshbase/companies":    [{ id: "filter",  label: "Filter" },  { id: "table",   label: "Table" },   { id: "map",     label: "Map View" }],
  "meshbase/executives":   [{ id: "filter",  label: "Filter" },  { id: "table",   label: "Table" }],
};

/** Quick Action Bar tabs — fixed shortcuts beneath the command bar */
export const QUICK_TABS: { id: string; label: string; url: string }[] = [
  { id: "new-hunt",   label: "+ New Hunt",      url: "/lead-factory/person" },
  { id: "ai-chat",    label: "AI Chat",         url: "/ai-chat" },
  { id: "leads",      label: "My Leads",        url: "/leads" },
  { id: "meshbase",   label: "MeshBase",        url: "/meshbase" },
  { id: "signals",    label: "Signals",         url: "/lead-factory/signals" },
];

/** Resolve sub-tabs for a given path */
export function subsForPath(path: string): TabItem[] {
  if (path.startsWith("/lead-factory")) return TAB_SUBS["lead-factory"];
  if (path.startsWith("/prospecting"))  return TAB_SUBS["prospecting"];
  if (path.startsWith("/masaar"))       return TAB_SUBS["masaar"];
  if (path.startsWith("/meshbase"))     return TAB_SUBS["meshbase"];
  if (path.startsWith("/sa-market"))    return TAB_SUBS["sa-market"];
  return [];
}
