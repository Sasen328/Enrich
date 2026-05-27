import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Database,
  Search,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronRight,
  Trash2,
  Zap,
  Globe,
  Users,
  DollarSign,
  Building2,
  MapPin,
  FileText,
  FileSpreadsheet,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  X,
  ExternalLink,
  Plus,
  Link,
  Bookmark,
  Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Source definitions ──────────────────────────────────────────────────────

interface SourceDef {
  id: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  category: string;
}

const SOURCES: SourceDef[] = [
  // ── General Web ──
  {
    id: "open-data",
    label: "Wikipedia + Gemini Search",
    description: "Wikipedia Saudi company articles enriched with Google Gemini web intelligence",
    icon: "🌐",
    color: "border-blue-500/40 bg-blue-500/5 text-blue-300",
    category: "General",
  },
  {
    id: "bluepages",
    label: "Blue Pages SA",
    description: "bluepages.com.sa — official Saudi Chamber business directory (JSON API)",
    icon: "📘",
    color: "border-sky-500/40 bg-sky-500/5 text-sky-300",
    category: "General",
  },
  {
    id: "gov-data-sa",
    label: "Saudi Open Data (data.gov.sa)",
    description: "data.gov.sa — government-published commercial registry & business datasets",
    icon: "🏛️",
    color: "border-cyan-500/40 bg-cyan-500/5 text-cyan-300",
    category: "General",
  },
  // ── Government Registries ──
  {
    id: "contractors",
    label: "Saudi Contractors",
    description: "Licensed contractors from muqawil.gov.sa — Saudi Contractors Authority",
    icon: "🏗️",
    color: "border-orange-500/40 bg-orange-500/5 text-orange-300",
    category: "Government Registries",
  },
  {
    id: "etimad",
    label: "Etimad Gov. Suppliers",
    description: "Government procurement suppliers on Etimad tendering portal",
    icon: "📋",
    color: "border-yellow-500/40 bg-yellow-500/5 text-yellow-300",
    category: "Government Registries",
  },
  {
    id: "industrial",
    label: "Industrial (MODON)",
    description: "MODON industrial estates — manufacturers & factories",
    icon: "🏭",
    color: "border-amber-500/40 bg-amber-500/5 text-amber-300",
    category: "Government Registries",
  },
  {
    id: "realestate",
    label: "Real Estate (REGA)",
    description: "REGA licensed developers, brokers & property companies",
    icon: "🏠",
    color: "border-lime-500/40 bg-lime-500/5 text-lime-300",
    category: "Government Registries",
  },
  // ── Professional Sectors ──
  {
    id: "lawyers",
    label: "Law Firms & Lawyers",
    description: "Saudi Bar Association registered law firms & legal offices",
    icon: "⚖️",
    color: "border-indigo-500/40 bg-indigo-500/5 text-indigo-300",
    category: "Professional Sectors",
  },
  {
    id: "auditors",
    label: "Auditors & Accountants",
    description: "SOCPA licensed audit firms & certified accountants",
    icon: "📊",
    color: "border-purple-500/40 bg-purple-500/5 text-purple-300",
    category: "Professional Sectors",
  },
  {
    id: "healthcare",
    label: "Healthcare & Medical",
    description: "MOH licensed hospitals, clinics & pharma companies",
    icon: "🏥",
    color: "border-rose-500/40 bg-rose-500/5 text-rose-300",
    category: "Professional Sectors",
  },
  {
    id: "banks",
    label: "Banks & Finance",
    description: "SAMA licensed banks, finance & insurance companies",
    icon: "🏦",
    color: "border-emerald-500/40 bg-emerald-500/5 text-emerald-300",
    category: "Professional Sectors",
  },
  {
    id: "logistics",
    label: "Logistics & Freight",
    description: "Licensed freight, shipping, warehousing & supply chain",
    icon: "🚛",
    color: "border-teal-500/40 bg-teal-500/5 text-teal-300",
    category: "Professional Sectors",
  },
  // ── Documents ──
  {
    id: "amaaly-aoa",
    label: "Amaaly AOA Documents",
    description: "Articles of Association with shareholders & board data",
    icon: "🗞️",
    color: "border-violet-500/40 bg-violet-500/5 text-violet-300",
    category: "Documents",
  },
  // ── Open Global Registries ──
  {
    id: "opencorporates",
    label: "OpenCorporates (SA)",
    description: "openCorporates.com — 200M+ global companies. Saudi Arabia jurisdiction filter via free REST API",
    icon: "🌍",
    color: "border-blue-400/40 bg-blue-400/5 text-blue-200",
    category: "Open Registries",
  },
  {
    id: "gleif",
    label: "GLEIF (Legal Entity IDs)",
    description: "gleif.org — Global LEI Foundation. Legal names, entity status, registration authority for Saudi corps",
    icon: "🔏",
    color: "border-cyan-400/40 bg-cyan-400/5 text-cyan-200",
    category: "Open Registries",
  },
  {
    id: "wikidata-sparql",
    label: "Wikidata SPARQL",
    description: "Wikidata structured knowledge graph — Saudi companies with founding year, HQ, CEO, ISIN, exchange",
    icon: "📡",
    color: "border-green-400/40 bg-green-400/5 text-green-200",
    category: "Open Registries",
  },
  // ── Professional Directories ──
  {
    id: "mooresrowland",
    label: "Moores Rowland Members",
    description: "mooresrowland.net/en/members — accounting & advisory firm network. Saudi Arabia filter + full profile scrape",
    icon: "🏢",
    color: "border-fuchsia-500/40 bg-fuchsia-500/5 text-fuchsia-300",
    category: "Professional Directories",
  },
  {
    id: "arabbritishchamber",
    label: "Arab British Chamber",
    description: "arabbritishchamber.com — Arab-British Chamber of Commerce member directory",
    icon: "🇬🇧",
    color: "border-red-400/40 bg-red-400/5 text-red-200",
    category: "Professional Directories",
  },
  {
    id: "amcham-saudi",
    label: "AmCham Saudi Arabia",
    description: "amcham.org.sa — American Chamber of Commerce Saudi Arabia member companies",
    icon: "🇺🇸",
    color: "border-blue-300/40 bg-blue-300/5 text-blue-200",
    category: "Professional Directories",
  },
  {
    id: "sbbc",
    label: "Saudi British Business Council",
    description: "saudibbc.org — SBBC member companies and UK-Saudi business firms",
    icon: "🤝",
    color: "border-sky-400/40 bg-sky-400/5 text-sky-200",
    category: "Professional Directories",
  },
  {
    id: "jcc",
    label: "Jeddah Chamber of Commerce",
    description: "jcc.org.sa — Jeddah Chamber registered member businesses",
    icon: "🏛️",
    color: "border-amber-400/40 bg-amber-400/5 text-amber-200",
    category: "Professional Directories",
  },
  {
    id: "french-chamber-ksa",
    label: "French Chamber KSA",
    description: "fcc.org.sa — French Chamber of Commerce Saudi Arabia member firms",
    icon: "🇫🇷",
    color: "border-blue-500/30 bg-blue-500/5 text-blue-200",
    category: "Professional Directories",
  },
  {
    id: "german-arab-chamber",
    label: "German-Arab Chamber (AHK)",
    description: "gdksa.org / AHK Riyadh — German-Arab Chamber of Commerce Saudi members",
    icon: "🇩🇪",
    color: "border-yellow-400/40 bg-yellow-400/5 text-yellow-200",
    category: "Professional Directories",
  },
  {
    id: "gcc-chambers",
    label: "GCC Chambers",
    description: "gcc-chambers.com — GCC-wide chambers of commerce directory, Saudi Arabia filter",
    icon: "🌙",
    color: "border-emerald-400/40 bg-emerald-400/5 text-emerald-200",
    category: "Professional Directories",
  },
  {
    id: "icaew",
    label: "ICAEW Chartered Accountants",
    description: "icaew.com — Institute of Chartered Accountants member firms in Saudi Arabia",
    icon: "📐",
    color: "border-purple-400/40 bg-purple-400/5 text-purple-200",
    category: "Professional Directories",
  },
];

const SOURCE_CATEGORIES = ["General", "Government Registries", "Professional Sectors", "Documents", "Open Registries", "Professional Directories"] as const;

// ─── Harvest Form Constants ───────────────────────────────────────────────────

const SAUDI_SECTORS = [
  "Oil & Gas / Energy",
  "Petrochemicals",
  "Construction & Real Estate",
  "Financial Services & Banking",
  "Technology & IT",
  "Healthcare & Pharmaceuticals",
  "Retail & E-Commerce",
  "Food & Beverage",
  "Manufacturing & Industrial",
  "Transportation & Logistics",
  "Hospitality & Tourism",
  "Education & Training",
  "Telecommunications",
  "Agriculture & Food Production",
  "Mining & Minerals",
  "Professional Services & Consulting",
  "Media & Entertainment",
  "Import & Export / Trade",
  "Automotive",
  "Legal Services",
  "Insurance",
  "Government Contractors",
  "Utilities (Water, Electricity)",
  "Maritime & Shipping",
  "Defense & Security",
  "Non-Profit & Social",
];

const SA_CITIES = [
  "Riyadh", "Jeddah", "Dammam", "Mecca", "Medina", "Khobar", "Dhahran",
  "Tabuk", "Abha", "Buraidah", "Hail", "Jubail", "Yanbu", "Najran",
  "Jizan", "Al Ahsa", "Al Khobar", "Taif", "Al Qatif", "Sakaka",
];

const LEGAL_FORMS = [
  "LLC - ذات مسؤولية محدودة",
  "JSC - مساهمة عامة",
  "Closed JSC - مساهمة مقفلة",
  "Sole Proprietorship - مؤسسة فردية",
  "General Partnership",
  "Limited Partnership",
  "Foreign Branch",
  "Government Entity",
];

const COMPANY_SIZES = [
  "Micro (1–10 employees)",
  "Small (11–50 employees)",
  "Medium (51–250 employees)",
  "Large (251–1000 employees)",
  "Enterprise (1000+ employees)",
];

const REVENUE_RANGES = [
  "< SAR 1 million",
  "SAR 1M – 10M",
  "SAR 10M – 100M",
  "SAR 100M – 1 billion",
  "> SAR 1 billion",
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface MasarCompany {
  id: number;
  nameEn: string | null;
  nameAr: string | null;
  crNumber: string | null;
  legalForm: string | null;
  legalFormAr: string | null;
  city: string | null;
  cityAr: string | null;
  region: string | null;
  paidUpCapital: string | null;
  authorizedCapital: string | null;
  foundingDate: string | null;
  foundingYear: string | null;
  registrationDate: string | null;
  expiryDate: string | null;
  authorizedSignatory: string | null;
  shareholders: Array<{ nameEn: string; nameAr: string; nationalId: string; ownershipPct: string; nationality: string }>;
  boardOfDirectors: Array<{ nameEn: string; nameAr: string; role: string; nationalId?: string }>;
  management: Array<{ nameEn: string; nameAr: string; title: string; nationalId?: string; powers?: string }>;
  mainActivity: string | null;
  mainActivityAr: string | null;
  registrationStatus: string | null;
  source: string;
  sourceUrl: string | null;
  enrichmentStatus: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  employeeCount: string | null;
  revenueEstimate: string | null;
  revenueRationale: string | null;
  newsHeadlines: Array<{ title: string; date: string; source?: string }>;
  enrichmentData: Record<string, unknown>;
  analysisEn: string | null;
  analysisAr: string | null;
  analysisData: Record<string, unknown>;
  capitalDistribution: string | null;
  profitDistributionRules: string | null;
  createdAt: string;
  enrichedAt: string | null;
}

interface HarvestEvent {
  type: "log" | "company_found" | "company_enriched" | "progress" | "complete" | "error";
  message?: string;
  level?: "info" | "success" | "warn" | "error";
  company?: Partial<MasarCompany>;
  count?: number;
  total?: number;
  error?: string;
}

interface Stats {
  total: number;
  enriched: number;
  openData: number;
  aamalyAoa: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function enrichmentBadge(status: string | null) {
  switch (status) {
    case "enriched":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 gap-1"><CheckCircle2 className="w-3 h-3" />Enriched</Badge>;
    case "enriching":
      return <Badge className="bg-blue-500/15 text-blue-400 border border-blue-500/30 gap-1"><Loader2 className="w-3 h-3 animate-spin" />Enriching</Badge>;
    case "failed":
      return <Badge className="bg-red-500/15 text-red-400 border border-red-500/30 gap-1"><AlertCircle className="w-3 h-3" />Failed</Badge>;
    default:
      return <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30 gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
  }
}

function sourceBadge(source: string) {
  const def = SOURCES.find(s => s.id === source);
  if (def) {
    return (
      <Badge className={`border text-xs gap-1 ${def.color}`}>
        <span>{def.icon}</span>
        <span>{def.label}</span>
      </Badge>
    );
  }
  // Unknown / legacy source value — show raw
  return (
    <Badge className="bg-slate-500/15 text-muted-foreground border border-slate-500/30 text-xs gap-1">
      <Globe className="w-3 h-3" />
      <span>{source || "Unknown"}</span>
    </Badge>
  );
}

// ─── Log entry ────────────────────────────────────────────────────────────────

function LogEntry({ event }: { event: HarvestEvent }) {
  const colorMap: Record<string, string> = {
    success: "text-emerald-400",
    warn: "text-amber-400",
    error: "text-red-400",
    info: "text-muted-foreground",
  };
  const color = colorMap[event.level || "info"] || "text-muted-foreground";
  if (event.type === "company_found") {
    return (
      <div className="text-xs flex gap-2 py-0.5">
        <span className="text-emerald-400 shrink-0">+</span>
        <span className="text-foreground">{event.company?.nameAr || event.company?.nameEn || "Company found"}</span>
        {event.count && <span className="text-muted-foreground ml-auto">#{event.count}</span>}
      </div>
    );
  }
  if (event.type === "progress") {
    return (
      <div className="text-xs text-blue-400 py-0.5">
        🔬 Enriching {event.count}/{event.total}...
      </div>
    );
  }
  return (
    <div className={`text-xs py-0.5 ${color}`}>
      {event.message || ""}
    </div>
  );
}

// ─── Source Checkbox ──────────────────────────────────────────────────────────

function SourceCheckbox({
  source,
  checked,
  onChange,
  disabled,
}: {
  source: SourceDef;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`
        relative flex items-start gap-3 p-3 rounded-xl border text-left transition-all
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}
        ${checked
          ? `${source.color} border-opacity-100`
          : "border-border/30 bg-background/40 text-muted-foreground"
        }
      `}
    >
      <div className={`
        mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all
        ${checked ? "bg-primary border-primary" : "border-border/60 bg-transparent"}
      `}>
        {checked && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span>{source.icon}</span>
          <span className={checked ? "text-foreground" : ""}>{source.label}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{source.description}</p>
      </div>
    </button>
  );
}

// ─── Company Detail Drawer ────────────────────────────────────────────────────

function CompanyDrawer({
  company,
  open,
  onClose,
  onReEnrich,
  onDelete,
}: {
  company: MasarCompany | null;
  open: boolean;
  onClose: () => void;
  onReEnrich: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [pipelineRunning, setPipelineRunning] = useState(false);

  if (!company) return null;

  const ed = (company.enrichmentData || {}) as Record<string, unknown>;

  const runPipelineEnrich = async () => {
    setPipelineRunning(true);
    try {
      const r = await fetch(`${BASE}/api/masar/database/companies/${company.id}/pipeline-enrich`, { method: "POST" });
      const data = await r.json() as { ok?: boolean; error?: string; crNumber?: string; message?: string };
      if (!r.ok || data.error) {
        toast({ title: "Pipeline failed", description: data.error || "Unknown error", variant: "destructive" });
        return;
      }
      toast({
        title: "Masaar Pipeline Running",
        description: `Searching CR ${data.crNumber || ""} on mc.gov.sa + Amaaly AOA — shareholders, capital & management will populate in ~2 minutes`,
      });
      // Poll for completion
      setTimeout(() => { void qc.invalidateQueries({ queryKey: ["masar-companies"] }); }, 30000);
      setTimeout(() => { void qc.invalidateQueries({ queryKey: ["masar-companies"] }); }, 90000);
      setTimeout(() => { void qc.invalidateQueries({ queryKey: ["masar-companies"] }); setPipelineRunning(false); }, 150000);
    } catch (e) {
      toast({ title: "Pipeline error", description: String((e as Error).message), variant: "destructive" });
      setPipelineRunning(false);
    }
  };

  const addAsLead = async (person: { nameEn?: string; nameAr?: string; title?: string; notes?: string }) => {
    const personName = person.nameEn || person.nameAr || "";
    const nameParts = personName.trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";
    const arParts = (person.nameAr || "").trim().split(/\s+/);
    const firstNameAr = arParts[0] || "";
    const lastNameAr = arParts.slice(1).join(" ") || "";

    toast({ title: "Adding lead…", description: `Saving ${personName} and launching full AI enrichment pipeline` });

    // Step 1: Save lead immediately with Masaar data (don't wait for enrichment)
    try {
      const r = await fetch(`${BASE}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName, lastName, firstNameAr, lastNameAr,
          title: person.title || "",
          email: "",
          phone: "",
          linkedin: "",
          nationality: person.notes || "",
          bio: "",
          industry: company.mainActivity || "",
          city: company.city || "",
          notes: [
            person.notes || "",
            company.nameAr || company.nameEn ? `Company: ${company.nameAr || company.nameEn}` : "",
            person.title ? `Role: ${person.title}` : "",
          ].filter(Boolean).join(" | "),
          status: "new",
          source: "masaar-database",
        }),
      });

      if (!r.ok) {
        toast({ title: "Failed to save lead", variant: "destructive" });
        return;
      }

      // Step 2: Navigate immediately to the Leads tab
      toast({
        title: "Lead added ✓",
        description: `${personName} saved. Full AI enrichment running in background — check Leads Engine shortly.`,
      });
      navigate("/leads");

      // Step 3: Fire full agentic person-intel profile in background (don't await)
      void fetch(`${BASE}/api/person-intel/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: personName,
          company: company.nameEn || company.nameAr || "",
          title: person.title || "",
          knownFacts: `Extracted from Masaar CR database. ${person.notes || ""}`.trim(),
        }),
      }).then(async (pr) => {
        if (!pr.ok) { console.warn("[AddAsLead] Profile enrichment failed:", pr.status); return; }
        const profileData = await pr.json() as Record<string, unknown>;
        // Step 4: Auto-save enriched profile to ProsEngine Research
        const saveRes = await fetch(`${BASE}/api/person-intel/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personName,
            company: company.nameEn || company.nameAr || "",
            title: person.title || "",
            report: profileData,
            tags: "masaar-auto",
            notes: `Auto-saved via +Lead from Masaar database. ${person.notes || ""}`.trim(),
          }),
        });
        if (saveRes.ok) {
          console.log(`[AddAsLead] Profile saved to ProsEngine Research for ${personName}`);
        } else {
          console.warn("[AddAsLead] Failed to save profile to ProsEngine Research:", saveRes.status);
        }
      }).catch(err => console.warn("[AddAsLead] Background profile enrichment failed:", err));

    } catch (e) {
      toast({ title: "Failed to save lead", description: String((e as Error).message), variant: "destructive" });
    }
  };

  const UNDISCLOSED_PATTERNS = [/undisclosed/i, /unknown/i, /غير\s*معلن/, /مساهم\s*غير/, /مساهم\s*\d+/, /shareholder\s*\d+/i, /مجهول/, /placeholder/i];
  const isUndisclosedName = (nameEn?: string, nameAr?: string) => {
    const s = `${nameEn || ""} ${nameAr || ""}`.trim();
    return !s || UNDISCLOSED_PATTERNS.some(p => p.test(s));
  };
  const visibleShareholders = (company.shareholders || []).filter(sh => !isUndisclosedName(sh.nameEn, sh.nameAr));
  const visibleManagement   = (company.management    || []).filter(m  => !isUndisclosedName(m.nameEn,  m.nameAr));
  const visibleBoard        = (company.boardOfDirectors || []).filter(b => !isUndisclosedName(b.nameEn, b.nameAr));

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl bg-card border-l border-border/40 p-0">
        <SheetHeader className="px-6 py-5 border-b border-border/40">
          <div className="flex items-start justify-between gap-4">
            <div>
              <SheetTitle className="text-lg font-bold text-foreground leading-tight">
                {company.nameAr || company.nameEn || "Unknown Company"}
              </SheetTitle>
              {company.nameEn && company.nameAr && (
                <p className="text-sm text-muted-foreground mt-0.5">{company.nameEn}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                {enrichmentBadge(company.enrichmentStatus)}
                {sourceBadge(company.source)}
                {company.crNumber && (
                  <span className="text-xs text-muted-foreground font-mono">CR: {company.crNumber}</span>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-border/40 hover:bg-accent/20"
                onClick={() => onReEnrich(company.id)}
              >
                <Zap className="w-3.5 h-3.5 mr-1" />Re-enrich
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pipelineRunning}
                className="h-8 text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                onClick={() => void runPipelineEnrich()}
                title="Run full Masaar CR lookup: searches mc.gov.sa + Amaaly AOA to extract shareholders, capital, management"
              >
                {pipelineRunning ? (
                  <><span className="animate-spin mr-1">⚙</span>Pipeline…</>
                ) : (
                  <><Search className="w-3.5 h-3.5 mr-1" />Masaar CR</>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                onClick={() => { onDelete(company.id); onClose(); }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)]">
          <div className="px-6 py-5 space-y-6">

            {/* Core Registration */}
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />Registration Data
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "CR Number", value: company.crNumber },
                  { label: "Legal Form", value: company.legalForm || company.legalFormAr },
                  { label: "City", value: `${company.city || (ed.city as string) || ""} ${company.cityAr ? `(${company.cityAr})` : ""}`.trim() },
                  { label: "Region", value: company.region },
                  { label: "Founding Year", value: company.foundingYear },
                  { label: "Founding Date", value: company.foundingDate },
                  { label: "Registration Date", value: company.registrationDate },
                  { label: "Status", value: company.registrationStatus },
                ].map(({ label, value }) =>
                  value ? (
                    <div key={label} className="bg-background/40 rounded-lg p-3 border border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">{label}</p>
                      <p className="text-sm font-medium text-foreground">{value}</p>
                    </div>
                  ) : null
                )}
              </div>
            </section>

            {/* Capital */}
            {(company.paidUpCapital || company.authorizedCapital || company.capitalDistribution || ed.paidUpCapital) && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-amber-400" />Capital Structure
                </h3>
                <div className="space-y-2">
                  {(company.paidUpCapital || ed.paidUpCapital as string) && (
                    <div className="bg-background/40 rounded-lg p-3 border border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">Paid-Up Capital</p>
                      <p className="text-sm font-semibold text-amber-400">{company.paidUpCapital || ed.paidUpCapital as string}</p>
                    </div>
                  )}
                  {(company.authorizedCapital || ed.authorizedCapital as string) && (
                    <div className="bg-background/40 rounded-lg p-3 border border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">Authorized Capital</p>
                      <p className="text-sm font-medium text-foreground">{company.authorizedCapital || ed.authorizedCapital as string}</p>
                    </div>
                  )}
                  {company.capitalDistribution && (
                    <div className="bg-background/40 rounded-lg p-3 border border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">Capital Distribution</p>
                      <p className="text-sm text-foreground">{company.capitalDistribution}</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Shareholders / Board / Management */}
            {visibleShareholders.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-violet-400" />Shareholders
                </h3>
                <div className="space-y-2">
                  {visibleShareholders.map((sh, i) => (
                    <div key={i} className="bg-background/40 rounded-lg p-3 border border-border/30 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{sh.nameAr || sh.nameEn || "Unknown"}</p>
                        {sh.nameEn && sh.nameAr && <p className="text-xs text-muted-foreground">{sh.nameEn}</p>}
                        {sh.nationality && <p className="text-xs text-muted-foreground mt-0.5">{sh.nationality}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-lg font-bold text-violet-400">{sh.ownershipPct || "—"}</span>
                        {sh.nationalId && <p className="text-xs text-muted-foreground font-mono">{sh.nationalId}</p>}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 h-7 text-[10px] px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                        onClick={() => void addAsLead({ nameEn: sh.nameEn, nameAr: sh.nameAr, title: `Shareholder ${sh.ownershipPct ? `(${sh.ownershipPct})` : ""}`, notes: sh.nationality })}
                      >
                        + Lead
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {visibleBoard.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-400" />Board of Directors
                </h3>
                <div className="space-y-2">
                  {visibleBoard.map((m, i) => (
                    <div key={i} className="bg-background/40 rounded-lg p-3 border border-border/30 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{m.nameAr || m.nameEn || "Unknown"}</p>
                        {m.nameEn && m.nameAr && <p className="text-xs text-muted-foreground">{m.nameEn}</p>}
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">{m.role}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 h-7 text-[10px] px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                        onClick={() => void addAsLead({ nameEn: m.nameEn, nameAr: m.nameAr, title: m.role })}
                      >
                        + Lead
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {visibleManagement.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-teal-400" />Management
                </h3>
                <div className="space-y-2">
                  {visibleManagement.map((m, i) => (
                    <div key={i} className="bg-background/40 rounded-lg p-3 border border-border/30">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-medium text-foreground min-w-0 truncate">{m.nameAr || m.nameEn || "Unknown"}</p>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="secondary" className="text-xs">{m.title}</Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                            onClick={() => void addAsLead({ nameEn: m.nameEn, nameAr: m.nameAr, title: m.title, notes: m.powers })}
                          >
                            + Lead
                          </Button>
                        </div>
                      </div>
                      {m.powers && <p className="text-xs text-muted-foreground">{m.powers}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Authorized Signatory */}
            {company.authorizedSignatory && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-orange-400" />Authorized Signatory
                </h3>
                <div className="bg-background/40 rounded-lg p-3 border border-border/30 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground min-w-0 flex-1">{company.authorizedSignatory}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-7 text-[10px] px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                    onClick={() => void addAsLead({ nameEn: company.authorizedSignatory ?? "", title: "Authorized Signatory" })}
                  >
                    + Lead
                  </Button>
                </div>
              </section>
            )}

            {/* Activity */}
            {(company.mainActivity || company.mainActivityAr) && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-2">Main Activity</h3>
                <div className="bg-background/40 rounded-lg p-3 border border-border/30">
                  <p className="text-sm text-foreground">{company.mainActivity || company.mainActivityAr}</p>
                  {company.mainActivityAr && company.mainActivity && (
                    <p className="text-xs text-muted-foreground mt-1" dir="rtl">{company.mainActivityAr}</p>
                  )}
                </div>
              </section>
            )}

            {/* Enrichment Data */}
            {company.enrichmentStatus === "enriched" && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-teal-400" />Enrichment Data
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {company.website && (
                    <div className="bg-background/40 rounded-lg p-3 border border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">Website</p>
                      <a href={company.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                        {company.website.replace(/^https?:\/\//, "").slice(0, 30)} <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  {company.phone && (
                    <div className="bg-background/40 rounded-lg p-3 border border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">Phone</p>
                      <p className="text-sm font-medium text-foreground">{company.phone}</p>
                    </div>
                  )}
                  {company.email && (
                    <div className="bg-background/40 rounded-lg p-3 border border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">Email</p>
                      <p className="text-sm font-medium text-foreground">{company.email}</p>
                    </div>
                  )}
                  {company.address && (
                    <div className="bg-background/40 rounded-lg p-3 border border-border/30 col-span-2">
                      <p className="text-xs text-muted-foreground mb-1">Address</p>
                      <p className="text-sm font-medium text-foreground">{company.address}</p>
                    </div>
                  )}
                  {company.employeeCount && (
                    <div className="bg-background/40 rounded-lg p-3 border border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">Employees</p>
                      <p className="text-sm font-medium text-foreground">{company.employeeCount}</p>
                    </div>
                  )}
                  {(ed.description as string) && (
                    <div className="col-span-2 bg-background/40 rounded-lg p-3 border border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">Description</p>
                      <p className="text-xs text-foreground leading-relaxed">{ed.description as string}</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Revenue Estimate */}
            {company.revenueEstimate && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />Revenue Estimation
                </h3>
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                  <p className="text-xl font-bold text-emerald-400">{company.revenueEstimate}</p>
                  {company.revenueRationale && (
                    <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{company.revenueRationale}</p>
                  )}
                </div>
              </section>
            )}

            {/* News Headlines */}
            {company.newsHeadlines && company.newsHeadlines.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-3">Recent News</h3>
                <div className="space-y-2">
                  {company.newsHeadlines.map((n, i) => (
                    <div key={i} className="bg-background/40 rounded-lg p-3 border border-border/30">
                      <p className="text-sm text-foreground">{n.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">{n.date}</span>
                        {n.source && <span className="text-xs text-muted-foreground">· {n.source}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* AI Analysis */}
            {company.analysisEn && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />AI Analysis Summary
                </h3>
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-primary mb-2">English</p>
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{company.analysisEn}</p>
                  </div>
                  {company.analysisAr && (
                    <div className="border-t border-border/30 pt-3">
                      <p className="text-xs font-semibold text-primary mb-2">العربية</p>
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-line" dir="rtl">{company.analysisAr}</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Profit distribution */}
            {company.profitDistributionRules && (
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-2">Profit Distribution Rules</h3>
                <div className="bg-background/40 rounded-lg p-3 border border-border/30">
                  <p className="text-sm text-foreground">{company.profitDistributionRules}</p>
                </div>
              </section>
            )}

          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MasaarDatabasePage() {
  const [companyName, setCompanyName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [sector, setSector] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");
  const [showParams, setShowParams] = useState(false);
  const [paramCity, setParamCity] = useState("");
  const [paramLegalForm, setParamLegalForm] = useState("");
  const [paramSize, setParamSize] = useState("");
  const [paramRevenue, setParamRevenue] = useState("");
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set(["open-data"]));
  const [customUrls, setCustomUrls] = useState<string[]>([]);
  const [customUrlInput, setCustomUrlInput] = useState("");
  const [showCustomUrl, setShowCustomUrl] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [isHarvesting, setIsHarvesting] = useState(false);
  const [logEvents, setLogEvents] = useState<HarvestEvent[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterEnrichment, setFilterEnrichment] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterLegalForm, setFilterLegalForm] = useState("");
  const [page, setPage] = useState(1);
  const [selectedCompany, setSelectedCompany] = useState<MasarCompany | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [savedCustomSources, setSavedCustomSources] = useState<{id:number;name:string;url:string;createdAt:string}[]>([]);
  const [selectedSavedIds, setSelectedSavedIds] = useState<Set<number>>(new Set());
  const [savingSource, setSavingSource] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  // Stats
  const { data: stats } = useQuery<Stats>({
    queryKey: ["masar-stats"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/masar/database/stats`);
      return r.json() as Promise<Stats>;
    },
    refetchInterval: isHarvesting ? 5000 : 30000,
  });

  // Companies list
  const { data: companiesData, isLoading } = useQuery({
    queryKey: ["masar-companies", search, filterCity, filterEnrichment, filterSource, filterLegalForm, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: "25",
        ...(search && { search }),
        ...(filterCity && { city: filterCity }),
        ...(filterEnrichment && { enrichmentStatus: filterEnrichment }),
        ...(filterSource && { source: filterSource }),
        ...(filterLegalForm && { legalForm: filterLegalForm }),
      });
      const r = await fetch(`${BASE}/api/masar/database/companies?${params}`);
      return r.json() as Promise<{ companies: MasarCompany[]; pagination: { total: number; pages: number } }>;
    },
    refetchInterval: isHarvesting ? 3000 : 0,
    staleTime: 0,
  });

  // Fetch saved custom sources on mount — auto-select all saved sources
  useEffect(() => {
    fetch(`${BASE}/api/masar/database/custom-sources`)
      .then(r => r.json())
      .then((data: {id:number;name:string;url:string;createdAt:string}[]) => {
        const arr = Array.isArray(data) ? data : [];
        setSavedCustomSources(arr);
        setSelectedSavedIds(new Set(arr.map(s => s.id)));
      })
      .catch(() => {});
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logEvents]);

  const toggleSource = (id: string) => {
    setSelectedSources(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const addCustomUrl = () => {
    const url = customUrlInput.trim();
    if (!url) return;
    if (!url.startsWith("http")) {
      toast({ title: "Invalid URL", description: "URL must start with http:// or https://", variant: "destructive" });
      return;
    }
    if (!customUrls.includes(url)) {
      setCustomUrls(prev => [...prev, url]);
    }
    setCustomUrlInput("");
  };

  const removeCustomUrl = (url: string) => {
    setCustomUrls(prev => prev.filter(u => u !== url));
  };

  const saveCustomSourceToDB = async (url: string, name?: string) => {
    setSavingSource(true);
    try {
      const r = await fetch(`${BASE}/api/masar/database/custom-sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, name }),
      });
      if (!r.ok) throw new Error("Failed to save");
      const created = await r.json() as {id:number;name:string;url:string;createdAt:string};
      setSavedCustomSources(prev => [created, ...prev]);
      setSelectedSavedIds(prev => new Set([...prev, created.id]));
      toast({ title: "Source saved", description: `"${created.name}" added to permanent sources` });
    } catch {
      toast({ title: "Failed to save source", variant: "destructive" });
    } finally {
      setSavingSource(false);
    }
  };

  const toggleSavedSource = (id: number) => {
    setSelectedSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const deleteCustomSourceFromDB = async (id: number) => {
    try {
      await fetch(`${BASE}/api/masar/database/custom-sources/${id}`, { method: "DELETE" });
      setSavedCustomSources(prev => prev.filter(s => s.id !== id));
      setSelectedSavedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      toast({ title: "Source removed" });
    } catch {
      toast({ title: "Failed to remove source", variant: "destructive" });
    }
  };

  const startHarvest = useCallback(async () => {
    const selectedSavedUrls = savedCustomSources.filter(s => selectedSavedIds.has(s.id)).map(s => s.url);
    const allCustomUrls = [...new Set([...customUrls, ...selectedSavedUrls])];
    if (selectedSources.size === 0 && allCustomUrls.length === 0) {
      toast({ title: "Select at least one source", description: "Choose a data source or add a custom URL", variant: "destructive" });
      return;
    }

    setLogEvents([]);
    setIsHarvesting(true);
    setShowLogs(true);

    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    let jobId: string;
    try {
      const r = await fetch(`${BASE}/api/masar/database/harvest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim() || undefined,
          keyword: keyword.trim() || undefined,
          sector: sector || undefined,
          instructions: aiInstructions.trim() || undefined,
          parameters: {
            ...(paramCity && { city: paramCity }),
            ...(paramLegalForm && { legalForm: paramLegalForm }),
            ...(paramSize && { size: paramSize }),
            ...(paramRevenue && { revenue: paramRevenue }),
          },
          sources: Array.from(selectedSources),
          customUrls: allCustomUrls,
        }),
      });

      if (!r.ok) {
        let errMsg = "Harvest request failed";
        try {
          const err = await r.json() as { error: string };
          errMsg = err.error || errMsg;
        } catch { /* ignore */ }
        toast({ title: "Harvest failed", description: errMsg, variant: "destructive" });
        setIsHarvesting(false);
        return;
      }

      const body = await r.json() as { jobId: string };
      jobId = body.jobId;
    } catch (e) {
      toast({ title: "Network error", description: "Could not reach the server. Check that the API server is running.", variant: "destructive" });
      setIsHarvesting(false);
      return;
    }

    const streamUrl = `${BASE}/api/masar/database/stream/${jobId}`;
    const es = new EventSource(streamUrl);
    sseRef.current = es;

    const timeout = setTimeout(() => {
      if (sseRef.current === es) {
        setIsHarvesting(false);
        es.close();
        toast({ title: "Harvest timed out", description: "The process took too long. Check logs for progress.", variant: "destructive" });
        void qc.invalidateQueries({ queryKey: ["masar-companies"] });
        void qc.invalidateQueries({ queryKey: ["masar-stats"] });
      }
    }, 10 * 60 * 1000);

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data as string) as HarvestEvent;
        setLogEvents(prev => [...prev, evt]);
        if (evt.type === "complete" || evt.type === "error") {
          clearTimeout(timeout);
          setIsHarvesting(false);
          es.close();
          sseRef.current = null;
          void qc.invalidateQueries({ queryKey: ["masar-companies"] });
          void qc.invalidateQueries({ queryKey: ["masar-stats"] });
          if (evt.type === "complete") {
            toast({ title: `Harvest complete`, description: `${evt.count || 0} companies found and saved` });
          } else {
            toast({ title: "Harvest error", description: evt.error || "Unknown error", variant: "destructive" });
          }
        }
      } catch { /* ignore malformed events */ }
    };

    es.onerror = () => {
      clearTimeout(timeout);
      if (sseRef.current === es) {
        setIsHarvesting(false);
        es.close();
        sseRef.current = null;
        void qc.invalidateQueries({ queryKey: ["masar-companies"] });
        void qc.invalidateQueries({ queryKey: ["masar-stats"] });
      }
    };
  }, [companyName, keyword, sector, aiInstructions, paramCity, paramLegalForm, paramSize, paramRevenue, selectedSources, customUrls, savedCustomSources, selectedSavedIds, toast, qc]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await qc.refetchQueries({ queryKey: ["masar-companies"] });
    await qc.refetchQueries({ queryKey: ["masar-stats"] });
    setIsRefreshing(false);
  };

  const deleteCompany = async (id: number) => {
    await fetch(`${BASE}/api/masar/database/companies/${id}`, { method: "DELETE" });
    void qc.invalidateQueries({ queryKey: ["masar-companies"] });
    void qc.invalidateQueries({ queryKey: ["masar-stats"] });
    toast({ title: "Company deleted" });
  };

  const [deletingSelected, setDeletingSelected] = useState(false);
  const deleteSelectedCompanies = async () => {
    if (selectedRows.size === 0) return;
    const ids = Array.from(selectedRows);
    setDeletingSelected(true);
    try {
      const r = await fetch(`${BASE}/api/masar/database/companies/bulk`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) throw new Error("Delete failed");
      setSelectedRows(new Set());
      void qc.invalidateQueries({ queryKey: ["masar-companies"] });
      void qc.invalidateQueries({ queryKey: ["masar-stats"] });
      toast({ title: `${ids.length} compan${ids.length !== 1 ? "ies" : "y"} deleted` });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setDeletingSelected(false);
    }
  };

  const reEnrich = async (id: number) => {
    await fetch(`${BASE}/api/masar/database/companies/${id}/re-enrich`, { method: "POST" });
    toast({ title: "Re-enrichment started", description: "Data will update in ~30 seconds" });
    setTimeout(() => void qc.invalidateQueries({ queryKey: ["masar-companies"] }), 5000);
  };

  const [enrichingAll, setEnrichingAll] = useState(false);
  const reEnrichAll = async (mode: "pending" | "all" = "pending") => {
    setEnrichingAll(true);
    try {
      const r = await fetch(`${BASE}/api/masar/database/enrich-all`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const data = await r.json() as { count: number; message: string };
      toast({ title: `Bulk enrichment started`, description: `Processing ${data.count} companies with AI — shareholders, CR, board data will fill in over the next few minutes` });
      setTimeout(() => { void qc.invalidateQueries({ queryKey: ["masar-companies"] }); void qc.invalidateQueries({ queryKey: ["masar-stats"] }); }, 15000);
    } catch (e) {
      toast({ title: "Error", description: String((e as Error).message), variant: "destructive" });
    } finally {
      setEnrichingAll(false);
    }
  };

  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  const toggleRow = (id: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllRows = () => {
    const ids = companies.map(c => c.id);
    setSelectedRows(prev => prev.size === ids.length ? new Set() : new Set(ids));
  };

  const handleExport = async (format: string) => {
    const params = new URLSearchParams({ format });
    if (search) params.set("search", search);
    if (selectedRows.size > 0) params.set("ids", Array.from(selectedRows).join(","));
    const url = `${BASE}/api/masar/database/export?${params}`;
    if (format === "pdf") { window.open(url, "_blank"); return; }
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const ext = format === "excel" ? "xlsx" : format === "word" ? "doc" : format;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `masar-companies-${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      toast({ title: "Export failed. Please try again.", variant: "destructive" });
    }
  };

  const dedupMutation = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/masar/database/deduplicate`, { method: "POST" }).then(r => r.json()),
    onSuccess: (data) => {
      toast({
        title: "Deduplication complete",
        description: `Removed ${data.duplicatesDeleted} duplicate(s). ${data.remainingCompanies} companies remain.`,
      });
      qc.invalidateQueries({ queryKey: ["masar-companies"] });
      qc.invalidateQueries({ queryKey: ["masar-stats"] });
    },
    onError: (err) => {
      toast({ title: "Deduplication failed", description: String(err), variant: "destructive" });
    },
  });

  const companies = companiesData?.companies || [];
  const pagination = companiesData?.pagination;
  const totalCustom = customUrls.length + selectedSavedIds.size;
  const totalSources = selectedSources.size + totalCustom;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/40 bg-card/75 backdrop-blur-xl px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Database className="w-6 h-6 text-primary" />
              Harvest AI — Masaar Database
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              AI-harvested Saudi company intelligence from {SOURCES.length}+ verified data sources
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={enrichingAll}
              onClick={() => void reEnrichAll("pending")}
              className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
              title="Enrich all pending + failed + missing-data companies now"
            >
              {enrichingAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
              Enrich Pending
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={enrichingAll}
              onClick={() => void reEnrichAll("all")}
              className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
              title="Force re-enrich ALL companies — resets status and runs full AI enrichment"
            >
              {enrichingAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Brain className="w-4 h-4 mr-2" />}
              Force Re-Enrich All
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
              onClick={() => dedupMutation.mutate()}
              disabled={dedupMutation.isPending}
              title="Find and delete duplicate Masar companies by CR number or name"
            >
              {dedupMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Deduplicate
            </Button>
            {selectedRows.size > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                onClick={deleteSelectedCompanies}
                disabled={deletingSelected}
              >
                {deletingSelected ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete ({selectedRows.size})
              </Button>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2 border-border/40 hover:bg-accent/20">
                  <Download className="w-4 h-4 text-muted-foreground" />
                  {selectedRows.size > 0 ? `Export (${selectedRows.size})` : "Export"}
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-1.5 bg-card border-border/60 shadow-xl" align="end">
                {selectedRows.size > 0 && (
                  <p className="text-xs text-muted-foreground px-3 pt-1 pb-1.5 border-b border-border/40 mb-1">
                    {selectedRows.size} selected record{selectedRows.size !== 1 ? "s" : ""}
                  </p>
                )}
                {[
                  { fmt: "excel", label: "Excel Spreadsheet (.xlsx)", Icon: FileSpreadsheet },
                  { fmt: "csv", label: "CSV File", Icon: FileSpreadsheet },
                  { fmt: "word", label: "Word Document (.doc)", Icon: FileText },
                  { fmt: "pptx", label: "PowerPoint (.pptx)", Icon: FileText },
                  { fmt: "pdf", label: "Print / Save as PDF", Icon: FileText },
                ].map(({ fmt, label, Icon }) => (
                  <button
                    key={fmt}
                    onClick={() => handleExport(fmt)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm hover:bg-accent/20 transition-colors text-foreground text-left"
                  >
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    {label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          {[
            { label: "Total Companies", value: stats?.total ?? "—", color: "text-foreground" },
            { label: "Enriched", value: stats?.enriched ?? "—", color: "text-emerald-400" },
            { label: "Pending Enrichment", value: stats?.pending ?? "—", color: "text-amber-400" },
            { label: "Active Sources", value: stats?.activeSources ?? "—", color: "text-primary" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-background/60 border border-border/30 rounded-xl p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="p-6 space-y-4">

        {/* ── Harvest Control ── */}
        <div className="bg-card/70 border border-border/40 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            AI Agent Harvester
          </h2>

          {/* ── Row 1: Company Name | Keyword | Sector ── */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Company Name <span className="text-muted-foreground/50">(optional)</span></label>
              <Input
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="e.g. Saudi Aramco, SABIC..."
                className="bg-background/60 border-border/40 text-sm"
                disabled={isHarvesting}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Keyword / Topic <span className="text-muted-foreground/50">(optional)</span></label>
              <Input
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="e.g. construction, banking, الرياض..."
                className="bg-background/60 border-border/40 text-sm"
                disabled={isHarvesting}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Sector <span className="text-muted-foreground/50">(optional)</span></label>
              <Select value={sector || "_none_"} onValueChange={v => setSector(v === "_none_" ? "" : v)} disabled={isHarvesting}>
                <SelectTrigger className="bg-background/60 border-border/40 text-sm h-10">
                  <SelectValue placeholder="All sectors..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border/60 max-h-64">
                  <SelectItem value="_none_">All sectors</SelectItem>
                  {SAUDI_SECTORS.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Row 2: AI Instructions ── */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5 block">
              <Zap className="w-3.5 h-3.5 text-primary" />
              AI Agent Instructions
              <span className="text-muted-foreground/50">(optional — tell the agent what to look for)</span>
            </label>
            <Textarea
              value={aiInstructions}
              onChange={e => setAiInstructions(e.target.value)}
              placeholder={`e.g. "Focus on companies with more than 100 employees in the Eastern Province. Prioritize listed companies on Tadawul. Exclude holding companies and look for active manufacturing firms registered after 2010."`}
              className="bg-background/60 border-border/40 text-sm min-h-[80px] resize-none placeholder:text-muted-foreground/40"
              disabled={isHarvesting}
              rows={3}
            />
          </div>

          {/* ── Row 3: Optional Parameters ── */}
          <div>
            <button
              type="button"
              disabled={isHarvesting}
              onClick={() => setShowParams(v => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showParams ? "rotate-180" : ""}`} />
              Filter Parameters
              {(paramCity || paramLegalForm || paramSize || paramRevenue) && (
                <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-violet-500/20 text-violet-300 font-medium">
                  {[paramCity, paramLegalForm, paramSize, paramRevenue].filter(Boolean).length} active
                </span>
              )}
              <span className="text-muted-foreground/50 ml-1">(optional constraints for the AI)</span>
            </button>

            {showParams && (
              <div className="mt-2.5 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1 block">City / Region</label>
                  <Select value={paramCity || "_none_"} onValueChange={v => setParamCity(v === "_none_" ? "" : v)} disabled={isHarvesting}>
                    <SelectTrigger className="bg-background/60 border-border/40 text-xs h-9">
                      <SelectValue placeholder="Any city..." />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border/60 max-h-52">
                      <SelectItem value="_none_">Any city</SelectItem>
                      {SA_CITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1 block">Legal Form</label>
                  <Select value={paramLegalForm || "_none_"} onValueChange={v => setParamLegalForm(v === "_none_" ? "" : v)} disabled={isHarvesting}>
                    <SelectTrigger className="bg-background/60 border-border/40 text-xs h-9">
                      <SelectValue placeholder="Any legal form..." />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border/60 max-h-52">
                      <SelectItem value="_none_">Any legal form</SelectItem>
                      {LEGAL_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1 block">Company Size</label>
                  <Select value={paramSize || "_none_"} onValueChange={v => setParamSize(v === "_none_" ? "" : v)} disabled={isHarvesting}>
                    <SelectTrigger className="bg-background/60 border-border/40 text-xs h-9">
                      <SelectValue placeholder="Any size..." />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border/60 max-h-52">
                      <SelectItem value="_none_">Any size</SelectItem>
                      {COMPANY_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1 block">Revenue Range</label>
                  <Select value={paramRevenue || "_none_"} onValueChange={v => setParamRevenue(v === "_none_" ? "" : v)} disabled={isHarvesting}>
                    <SelectTrigger className="bg-background/60 border-border/40 text-xs h-9">
                      <SelectValue placeholder="Any revenue..." />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border/60 max-h-52">
                      <SelectItem value="_none_">Any revenue</SelectItem>
                      {REVENUE_RANGES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {(paramCity || paramLegalForm || paramSize || paramRevenue) && (
                  <button
                    type="button"
                    onClick={() => { setParamCity(""); setParamLegalForm(""); setParamSize(""); setParamRevenue(""); }}
                    className="col-span-2 text-xs text-muted-foreground hover:text-rose-400 text-left transition-colors"
                  >
                    Clear all parameters
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Harvest Button ── */}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => void startHarvest()}
              disabled={isHarvesting || totalSources === 0}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-10 px-6"
            >
              {isHarvesting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Harvesting...</>
              ) : (
                <><Zap className="w-4 h-4 mr-2" />Harvest{totalSources > 1 ? ` (${totalSources} sources)` : ""}</>
              )}
            </Button>
            {(companyName || keyword || sector) && !isHarvesting && (
              <span className="text-xs text-muted-foreground">
                Searching: {[companyName, keyword, sector].filter(Boolean).join(" · ")}
              </span>
            )}
            {!companyName && !keyword && !sector && !isHarvesting && (
              <span className="text-xs text-muted-foreground/50">
                No search terms — will harvest broadly based on sources
              </span>
            )}
            {isHarvesting && (
              <span className="text-xs text-muted-foreground animate-pulse">Running…</span>
            )}
          </div>

          {/* Sources - collapsible */}
          <div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                disabled={isHarvesting}
                onClick={() => setShowSources(v => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSources ? "rotate-180" : ""}`} />
                Data Sources — {totalSources === 0 ? "none selected" : `${totalSources} selected`}
              </button>
              {showSources && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isHarvesting}
                    onClick={() => setSelectedSources(new Set(SOURCES.map(s => s.id)))}
                    className="text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    Select all
                  </button>
                  <span className="text-muted-foreground/40 text-xs">·</span>
                  <button
                    type="button"
                    disabled={isHarvesting}
                    onClick={() => setSelectedSources(new Set())}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            {showSources && (
              <div className="mt-2 space-y-3">
                {SOURCE_CATEGORIES.map(cat => {
                  const catSources = SOURCES.filter(s => s.category === cat);
                  return (
                    <div key={cat}>
                      <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1.5">{cat}</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {catSources.map(src => (
                          <SourceCheckbox
                            key={src.id}
                            source={src}
                            checked={selectedSources.has(src.id)}
                            onChange={() => toggleSource(src.id)}
                            disabled={isHarvesting}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Custom Saved Sources — appear inline just like built-in sources */}
                {savedCustomSources.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1.5">Custom Sources</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {savedCustomSources.map(src => {
                        const isChecked = selectedSavedIds.has(src.id);
                        const shortUrl = src.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
                        return (
                          <SourceCheckbox
                            key={`custom-${src.id}`}
                            source={{
                              id: `custom-saved-${src.id}`,
                              label: src.name,
                              description: shortUrl,
                              icon: "🔗",
                              color: "border-fuchsia-500/40 bg-fuchsia-500/5 text-fuchsia-300",
                              category: "Custom Sources",
                            }}
                            checked={isChecked}
                            onChange={() => !isHarvesting && toggleSavedSource(src.id)}
                            disabled={isHarvesting}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Custom URL toggle + input */}
          <div>
            <button
              type="button"
              disabled={isHarvesting}
              onClick={() => setShowCustomUrl(v => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Link className="w-3.5 h-3.5" />
              {showCustomUrl ? "Hide" : "Add"} custom source URLs
              {savedCustomSources.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-primary/20 text-primary font-medium">
                  {selectedSavedIds.size}/{savedCustomSources.length} selected
                </span>
              )}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCustomUrl ? "rotate-180" : ""}`} />
            </button>

            {showCustomUrl && (
              <div className="mt-2 space-y-3">
                {/* Saved permanent sources — selectable checkboxes */}
                {savedCustomSources.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium text-primary/80 uppercase tracking-wide mb-1">Permanent Saved Sources</p>
                    {savedCustomSources.map(src => {
                      const isSelected = selectedSavedIds.has(src.id);
                      return (
                        <div
                          key={src.id}
                          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 border cursor-pointer transition-all ${isSelected ? "bg-primary/10 border-primary/40" : "bg-background/30 border-border/30 opacity-60"}`}
                          onClick={() => !isHarvesting && toggleSavedSource(src.id)}
                        >
                          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                            {isSelected && <svg viewBox="0 0 10 8" fill="none" className="w-2.5 h-2.5"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground font-medium truncate">{src.name}</p>
                            <p className="text-[10px] text-muted-foreground font-mono truncate">{src.url}</p>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); void deleteCustomSourceFromDB(src.id); }}
                            disabled={isHarvesting}
                            className="text-muted-foreground hover:text-red-400 shrink-0 transition-colors"
                            title="Remove permanently"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add one-time URL */}
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Add URL for this harvest</p>
                  <div className="flex gap-2">
                    <Input
                      value={customUrlInput}
                      onChange={e => setCustomUrlInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addCustomUrl()}
                      placeholder="https://example.com/saudi-companies?q={keyword}"
                      className="bg-background/60 border-border/40 text-xs h-9"
                      disabled={isHarvesting}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 border-border/40 shrink-0"
                      onClick={addCustomUrl}
                      disabled={isHarvesting || !customUrlInput.trim()}
                    >
                      <Plus className="w-4 h-4 mr-1" />Add
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use <code className="bg-background px-1 rounded text-primary">{"{keyword}"}</code> in the URL and it will be replaced with your search term.
                  </p>
                </div>

                {customUrls.length > 0 && (
                  <div className="space-y-1">
                    {customUrls.map(url => (
                      <div key={url} className="flex items-center gap-2 bg-background/40 border border-border/20 rounded-lg px-3 py-1.5">
                        <Link className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-xs text-foreground font-mono truncate flex-1">{url}</span>
                        <button
                          onClick={() => void saveCustomSourceToDB(url)}
                          disabled={isHarvesting || savingSource}
                          className="text-muted-foreground hover:text-primary shrink-0 transition-colors"
                          title="Save permanently"
                        >
                          <Bookmark className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeCustomUrl(url)}
                          disabled={isHarvesting}
                          className="text-muted-foreground hover:text-red-400 shrink-0 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Log toggle */}
          {logEvents.length > 0 && (
            <div className="flex items-center pt-1">
              <Button
                variant="outline"
                size="sm"
                className="border-border/40 h-8 ml-auto"
                onClick={() => setShowLogs(!showLogs)}
              >
                {showLogs ? "Hide" : "Show"} Logs
                <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${showLogs ? "rotate-180" : ""}`} />
              </Button>
            </div>
          )}

          {/* Live Log */}
          {showLogs && logEvents.length > 0 && (
            <div className="bg-background/80 border border-border/30 rounded-xl p-4 max-h-56 overflow-y-auto font-mono">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-sans font-semibold">
                  Live Agent Log {isHarvesting && <span className="text-primary animate-pulse ml-1">● recording</span>}
                </span>
                <button onClick={() => setShowLogs(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {logEvents.map((evt, i) => <LogEntry key={i} event={evt} />)}
              <div ref={logEndRef} />
            </div>
          )}
        </div>

        {/* ── Filters ── */}
        <div className="flex gap-3 items-center flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name, CR, activity..."
              className="pl-9 bg-background/60 border-border/40"
            />
          </div>
          <Input
            value={filterCity}
            onChange={e => { setFilterCity(e.target.value); setPage(1); }}
            placeholder="City..."
            className="w-36 bg-background/60 border-border/40"
          />
          <Select value={filterEnrichment || "all"} onValueChange={v => { setFilterEnrichment(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-40 bg-background/60 border-border/40">
              <SelectValue placeholder="Enrichment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="enriched">Enriched</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="enriching">Enriching</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterSource || "all"} onValueChange={v => { setFilterSource(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-52 bg-background/60 border-border/40">
              <SelectValue placeholder="Filter by source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              {SOURCE_CATEGORIES.map(cat => (
                <div key={cat}>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/30 mt-1">
                    {cat}
                  </div>
                  {SOURCES.filter(s => s.category === cat).map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <span>{s.icon}</span>
                        <span>{s.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterLegalForm || "all"} onValueChange={v => { setFilterLegalForm(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44 bg-background/60 border-border/40">
              <SelectValue placeholder="Legal Form" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Legal Forms</SelectItem>
              <SelectItem value="limited liability">Limited Liability</SelectItem>
              <SelectItem value="joint stock">Joint Stock</SelectItem>
              <SelectItem value="sole proprietorship">Sole Proprietorship</SelectItem>
              <SelectItem value="branch">Branch Office</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="border-border/40 hover:bg-accent/20 h-10 w-10 p-0"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            title="Refresh table"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* ── Table ── */}
        <div className="bg-card/70 border border-border/40 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-background/30">
                  <th className="px-4 py-3 w-8">
                    <Checkbox
                      checked={companies.length > 0 && selectedRows.size === companies.length}
                      onCheckedChange={toggleAllRows}
                      className="border-border/60"
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Company</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">CR Number</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Paid-Up Capital</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">City</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Founded</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Revenue Est.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Source</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={10} className="text-center py-16 text-muted-foreground">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                      Loading...
                    </td>
                  </tr>
                ) : companies.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-20">
                      <Database className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                      <p className="text-muted-foreground font-medium">No companies found</p>
                      <p className="text-xs text-muted-foreground mt-1">Use the harvester above to seed company data</p>
                    </td>
                  </tr>
                ) : (
                  companies.map((c) => {
                    const ed = (c.enrichmentData || {}) as Record<string, unknown>;
                    const displayCity = c.city || c.cityAr || (ed.city as string) || null;
                    const displayCapital = c.paidUpCapital || (ed.paidUpCapital as string) || null;
                    const displayCR = c.crNumber || (ed.crNumber as string) || null;
                    const displayFounded = c.foundingYear || c.foundingDate?.slice(0, 4) || (ed.foundingYear as string) || null;
                    const displayRevenue = c.revenueEstimate || (ed.revenueEstimate as string) || null;
                    const isRowSelected = selectedRows.has(c.id);
                    return (
                      <tr
                        key={c.id}
                        className={`border-b border-border/20 hover:bg-accent/10 transition-colors cursor-pointer ${isRowSelected ? "bg-primary/5" : ""}`}
                        onClick={() => { setSelectedCompany(c); setDrawerOpen(true); }}
                      >
                        <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggleRow(c.id); }}>
                          <Checkbox
                            checked={isRowSelected}
                            onCheckedChange={() => toggleRow(c.id)}
                            className="border-border/60"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-foreground">{c.nameAr || c.nameEn || "—"}</p>
                            {c.nameEn && c.nameAr && (
                              <p className="text-xs text-muted-foreground">{c.nameEn}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {displayCR || <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {displayCapital
                            ? <span className="text-amber-400 font-medium">{displayCapital}</span>
                            : <span className="text-muted-foreground/40">—</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1 text-xs text-foreground">
                            {displayCity ? (
                              <><MapPin className="w-3 h-3 text-muted-foreground" />{displayCity}</>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {displayFounded || <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-emerald-400">
                          {displayRevenue || <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3">{enrichmentBadge(c.enrichmentStatus)}</td>
                        <td className="px-4 py-3">{sourceBadge(c.source)}</td>
                        <td className="px-4 py-3">
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/30">
              <p className="text-xs text-muted-foreground">{pagination.total} total companies</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="border-border/40 h-8 text-xs"
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground self-center">
                  Page {page} of {pagination.pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.pages}
                  onClick={() => setPage(p => p + 1)}
                  className="border-border/40 h-8 text-xs"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Company Detail Drawer */}
      <CompanyDrawer
        company={selectedCompany}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onReEnrich={reEnrich}
        onDelete={deleteCompany}
      />
    </div>
  );
}
