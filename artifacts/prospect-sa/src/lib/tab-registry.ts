// §3 — Tab registry. Refactored 2026-05-21:
//   - Removed from nav: MeshBase, OrcEngine, SA Market (kept as silent
//     backend sources / direct-URL admin pages).
//   - Renamed: Leads → Lead Genome, Prospecting → ProsEngine
//   - Merged: Masaar (CR engine + DB) + AI Database Builder → "Harvest AI"

import {
  LayoutDashboard, Sparkles, Target, Zap, Building2, User, Globe,
  Layers, Search, TableProperties, FileBarChart, Activity, GitFork,
  Database, Sprout, FolderHeart,
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
  { id: "dashboard",    label: "Dashboard",    url: "/",                       icon: LayoutDashboard },
  { id: "ai-chat",      label: "AI Chat",      url: "/ai-chat",                icon: Sparkles },
  { id: "lead-genome",  label: "Lead Genome",  url: "/lead-genome",            icon: FolderHeart },
  { id: "lead-factory", label: "Lead Factory", url: "/lead-factory/person",    icon: Zap },
  { id: "prosengine",   label: "ProsEngine",   url: "/prosengine/company",     icon: Building2 },
  { id: "harvest-ai",   label: "Harvest AI",   url: "/harvest-ai/masaar-engine", icon: Sprout },
];

export const TAB_SUBS: Record<string, TabItem[]> = {
  "lead-factory": [
    { id: "person",       label: "Person Hunt",   url: "/lead-factory/person",       icon: User,         rail: true },
    { id: "company",      label: "Company Hunt",  url: "/lead-factory/company",      icon: Building2,    rail: true },
    { id: "results",      label: "Results",       url: "/lead-factory/results",      icon: FileBarChart, rail: true },
    { id: "signals",      label: "Signals",       url: "/lead-factory/signals",      icon: Activity },
    { id: "relationship", label: "Relationship",  url: "/lead-factory/relationship", icon: GitFork },
  ],
  "prosengine": [
    { id: "company-intel", label: "Company Intel", url: "/prosengine/company",  icon: Building2 },
    { id: "person-intel",  label: "Person Intel",  url: "/prosengine/person",   icon: User },
    { id: "website-intel", label: "Website Intel", url: "/prosengine/website",  icon: Globe },
    { id: "seeder",        label: "Data Seeder",   url: "/prosengine/seeder",   icon: Layers },
  ],
  "harvest-ai": [
    { id: "masaar-engine",   label: "Masaar Engine",       url: "/harvest-ai/masaar-engine",   icon: Search },
    { id: "masaar-database", label: "Masaar Database",     url: "/harvest-ai/masaar-database", icon: TableProperties },
    { id: "db-builder",      label: "AI Database Builder", url: "/harvest-ai/db-builder",      icon: Database },
  ],
  "lead-genome": [
    { id: "saved", label: "Saved Leads",  url: "/lead-genome",       icon: FolderHeart },
    { id: "lists", label: "Lead Lists",   url: "/lead-genome/lists", icon: FileBarChart },
  ],
};

/** Deep panels (› markers) opened by sub-tab click — surfaced by the rail */
export const TAB_DEEP: Record<string, { id: string; label: string }[]> = {
  "lead-factory/person":   [{ id: "form",    label: "Filters" }, { id: "preview", label: "Preview" }, { id: "history", label: "History" }],
  "lead-factory/company":  [{ id: "form",    label: "Filters" }, { id: "preview", label: "Preview" }, { id: "history", label: "History" }],
  "lead-factory/results":  [{ id: "lists",   label: "Lists" },   { id: "export",  label: "Export" },  { id: "logs",    label: "Logs" }],
};

/** Quick Action Bar tabs — fixed shortcuts beneath the command bar */
export const QUICK_TABS: { id: string; label: string; url: string }[] = [
  { id: "new-hunt",  label: "+ New Hunt",   url: "/lead-factory/person" },
  { id: "ai-chat",   label: "AI Chat",      url: "/ai-chat" },
  { id: "genome",    label: "Lead Genome",  url: "/lead-genome" },
  { id: "prosengine",label: "ProsEngine",   url: "/prosengine/company" },
  { id: "harvest",   label: "Harvest AI",   url: "/harvest-ai/masaar-engine" },
];

/** Resolve sub-tabs for a given path */
export function subsForPath(path: string): TabItem[] {
  if (path.startsWith("/lead-factory")) return TAB_SUBS["lead-factory"];
  if (path.startsWith("/prosengine"))   return TAB_SUBS["prosengine"];
  // Legacy /prospecting paths still resolve to ProsEngine sub-tabs
  if (path.startsWith("/prospecting"))  return TAB_SUBS["prosengine"];
  if (path.startsWith("/harvest-ai"))   return TAB_SUBS["harvest-ai"];
  // Legacy /masaar and /database-builder map to Harvest AI subs
  if (path.startsWith("/masaar"))       return TAB_SUBS["harvest-ai"];
  if (path.startsWith("/database-builder")) return TAB_SUBS["harvest-ai"];
  if (path.startsWith("/lead-genome"))  return TAB_SUBS["lead-genome"];
  if (path.startsWith("/leads"))        return TAB_SUBS["lead-genome"];
  return [];
}
