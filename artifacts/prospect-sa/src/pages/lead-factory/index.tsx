import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Zap, GitFork, Play, ChevronRight, ChevronLeft, CheckCircle2,
  AlertCircle, Loader2, Users, Building2, Mail, Phone, Globe,
  TrendingUp, Shield, Copy, Download, Search, Filter, X,
  MapPin, BarChart2, Target, Sparkles, Network, Star,
  History, Bell, Radio, Clock, ExternalLink, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadFactoryBrief {
  inputMode: "segment" | "list";
  sourcing?: "people" | "companies" | "search";
  icpDescription?: string;
  industries?: string[];
  companySizes?: string[];
  companyTypes?: string[];
  cities?: string[];
  targetTitles?: string[];
  targetFunctions?: string[];
  targetSeniority?: string[];
  prioritySignals?: string[];
  companyList?: string[];
  targetCount?: number;
  enrichmentDepth?: "basic" | "standard" | "deep";
}

interface AgentEvent {
  type: string;
  agent?: number;
  label?: string;
  message?: string;
  current?: number;
  total?: number;
  lead?: Record<string, unknown>;
  companyName?: string;
  reasons?: string[];
  resultId?: number;
  tier?: string;
  totalPublished?: number;
  totalRejected?: number;
  jobId?: number;
}

interface AgentState {
  status: "idle" | "running" | "complete" | "error";
  label: string;
  log: string[];
  progress?: { current: number; total: number };
  count?: number;
}

interface LeadResult {
  id: number;
  companyName?: string;
  companyNameAr?: string;
  domain?: string;
  phone?: string;
  email?: string;
  city?: string;
  industry?: string;
  employeeCount?: string;
  icpScore?: number;
  priorityTier?: string;
  buyingScore?: number;
  riskScore?: number;
  qualityScore?: number;
  validationStatus?: string;
  isDuplicate?: boolean;
  outreachEmail?: string;
  outreachLinkedin?: string;
  outreachWhatsapp?: string;
  openingAngle?: string;
  culturalNote?: string;
  conversationHook?: string;
  sourceUsed?: string;
}

interface RelBrief {
  targetCompanyName: string;
  targetCompanyNameAr?: string;
  targetCrNumber?: string;
  targetWebsite?: string;
  context?: string;
  outputDepth?: "basic" | "deep";
}

interface OrgNode {
  id: string;
  type: string;
  nameEn: string;
  nameAr?: string;
  title?: string;
  seniority?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
}

interface OutreachContact {
  rank: number;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  outreachEmail?: string;
  outreachLinkedin?: string;
  whatsappOpener?: string;
  conversationHook?: string;
  culturalNote?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SAUDI_INDUSTRIES = [
  "Technology & Software", "FinTech", "Construction", "Real Estate",
  "Healthcare", "Manufacturing", "Retail & E-commerce", "Logistics",
  "Oil & Gas", "Petrochemicals", "Banking & Finance", "Insurance",
  "Hospitality & Tourism", "Education", "Agriculture", "Media & Entertainment",
  "Professional Services", "Telecommunications", "Energy", "Government",
];

const SAUDI_CITIES = [
  "Riyadh", "Jeddah", "Dammam", "Mecca", "Medina", "Khobar",
  "Jubail", "Yanbu", "Tabuk", "Abha", "Qassim",
];

const COMPANY_SIZES = ["1-50", "51-200", "201-1000", "1000+"];

const BUYING_SIGNALS = [
  "recent_news", "new_contracts", "hiring", "intent",
  "funding_round", "exec_change", "regulatory_event",
];

const AGENT_LABELS: Record<number, string> = {
  1: "ICP Mapper & Source Orchestrator",
  2: "Lead Harvester",
  3: "Deep Enrichment",
  4: "Signal Intelligence",
  5: "Validate, Verify & Deduplicate",
  6: "ICP Scoring + AI Copywriter",
  7: "Publish & Seed",
};

// ─── Tier Badge ───────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier?: string }) {
  const colors: Record<string, string> = {
    A: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    B: "bg-blue-500/20 text-primary border-primary/30",
    C: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    D: "bg-slate-500/20 text-muted-foreground border-border/30",
  };
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border", colors[tier || "D"] || colors.D)}>
      {tier || "?"}
    </span>
  );
}

// ─── Score Ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 36 }: { score?: number; size?: number }) {
  const s = score ?? 0;
  const color = s >= 75 ? "hsl(263,70%,70%)" : s >= 50 ? "hsl(200,80%,60%)" : s >= 30 ? "#f59e0b" : "hsl(220,14%,40%)";
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (s / 100) * circumference;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${dash} ${circumference - dash}`} strokeLinecap="round" />
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle"
        fill="white" fontSize={size * 0.28} fontWeight="bold"
        style={{ transform: "rotate(90deg)", transformOrigin: "50% 50%" }}>
        {s}
      </text>
    </svg>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({ agentNum, state }: { agentNum: number; state: AgentState }) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.log]);

  const statusColor = {
    idle: "text-muted-foreground",
    running: "text-primary",
    complete: "text-emerald-400",
    error: "text-red-400",
  }[state.status];

  const statusIcon = {
    idle: <div className="w-3 h-3 rounded-full bg-slate-600" />,
    running: <Loader2 className="w-3 h-3 text-primary animate-spin" />,
    complete: <CheckCircle2 className="w-3 h-3 text-emerald-400" />,
    error: <AlertCircle className="w-3 h-3 text-red-400" />,
  }[state.status];

  return (
    <div className={cn(
      "border rounded-lg p-3 transition-all duration-300",
      state.status === "running" ? "border-primary/50 bg-blue-500/5" :
      state.status === "complete" ? "border-emerald-500/30 bg-emerald-500/5" :
      state.status === "error" ? "border-red-500/30 bg-red-500/5" :
      "border-border/30/50 bg-background/40",
    )}>
      <div className="flex items-center gap-2 mb-2">
        <div className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
          state.status === "running" ? "bg-blue-500 text-foreground" :
          state.status === "complete" ? "bg-emerald-500 text-foreground" :
          state.status === "error" ? "bg-red-500 text-foreground" :
          "bg-secondary text-muted-foreground",
        )}>
          {agentNum}
        </div>
        <span className="text-xs font-semibold text-muted-foreground flex-1 truncate">{state.label}</span>
        <div className="flex items-center gap-1.5">
          {statusIcon}
          {state.count !== undefined && state.status === "complete" && (
            <span className="text-[10px] text-emerald-400 font-semibold">{state.count}</span>
          )}
        </div>
      </div>

      {state.progress && state.status === "running" && (
        <div className="mb-2">
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>{state.progress.current} / {state.progress.total}</span>
            <span>{Math.round((state.progress.current / Math.max(1, state.progress.total)) * 100)}%</span>
          </div>
          <div className="h-1 bg-card rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${(state.progress.current / Math.max(1, state.progress.total)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {state.log.length > 0 && (
        <div ref={logRef} className="max-h-20 overflow-y-auto space-y-0.5 scrollbar-none">
          {state.log.slice(-8).map((msg, i) => (
            <p key={i} className="text-[10px] text-muted-foreground leading-relaxed truncate">{msg}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Lead Card ────────────────────────────────────────────────────────────────

function LeadCard({ lead, onViewCopy }: { lead: LeadResult; onViewCopy: (lead: LeadResult) => void }) {
  return (
    <div className="border border-border/30/60 rounded-lg p-4 hover:border-border/50 transition-colors bg-background/40">
      <div className="flex items-start gap-3">
        <ScoreRing score={lead.icpScore} size={44} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <TierBadge tier={lead.priorityTier} />
            <span className="text-sm font-semibold text-foreground truncate">{lead.companyName || "—"}</span>
            {lead.companyNameAr && <span className="text-xs text-muted-foreground font-arabic">{lead.companyNameAr}</span>}
            {lead.isDuplicate && <Badge variant="outline" className="text-[9px] border-orange-500/40 text-orange-400">dup</Badge>}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {lead.industry && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{lead.industry}</span>}
            {lead.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{lead.city}</span>}
            {lead.employeeCount && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{lead.employeeCount}</span>}
            {lead.domain && <span className="flex items-center gap-1 text-primary"><Globe className="w-3 h-3" />{lead.domain}</span>}
          </div>
          {lead.openingAngle && (
            <p className="text-[11px] text-amber-400/80 mt-1.5 italic truncate">"{lead.openingAngle}"</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex gap-1.5">
            {lead.email && <Mail className="w-3.5 h-3.5 text-emerald-400" title={lead.email} />}
            {lead.phone && <Phone className="w-3.5 h-3.5 text-primary" title={lead.phone} />}
            {lead.domain && <Globe className="w-3.5 h-3.5 text-muted-foreground" title={lead.domain} />}
          </div>
          <Button size="sm" variant="ghost" onClick={() => onViewCopy(lead)}
            className="h-6 text-[10px] text-muted-foreground hover:text-foreground px-2">
            <Sparkles className="w-3 h-3 mr-1" /> Copy
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Outreach Copy Modal ──────────────────────────────────────────────────────

function CopyModal({ lead, onClose }: { lead: LeadResult; onClose: () => void }) {
  const [tab, setTab] = useState<"email" | "linkedin" | "whatsapp">("email");
  const copy = (text: string) => navigator.clipboard.writeText(text || "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border/30 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{lead.companyName}</h3>
            <p className="text-[11px] text-muted-foreground">{lead.openingAngle}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex border-b border-border/30 px-4">
          {(["email", "linkedin", "whatsapp"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("px-3 py-2 text-xs font-medium capitalize border-b-2 transition-colors",
                tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t === "linkedin" ? "LinkedIn" : t === "whatsapp" ? "WhatsApp" : "Email"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground font-mono bg-card rounded-lg p-3 leading-relaxed">
            {tab === "email" ? lead.outreachEmail :
             tab === "linkedin" ? lead.outreachLinkedin :
             lead.outreachWhatsapp || "—"}
          </pre>

          {lead.culturalNote && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <p className="text-[10px] text-amber-400 font-semibold mb-1">Cultural Note</p>
              <p className="text-[11px] text-amber-300/80">{lead.culturalNote}</p>
            </div>
          )}
          {lead.conversationHook && (
            <div className="bg-blue-500/10 border border-primary/20 rounded-lg p-3">
              <p className="text-[10px] text-primary font-semibold mb-1">Conversation Hook</p>
              <p className="text-[11px] text-primary/80">{lead.conversationHook}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border/30 flex justify-between">
          <div className="flex gap-2 text-[11px] text-muted-foreground">
            {lead.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{lead.email}</span>}
            {lead.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</span>}
          </div>
          <Button size="sm" onClick={() => copy(
            tab === "email" ? lead.outreachEmail || "" :
            tab === "linkedin" ? lead.outreachLinkedin || "" :
            lead.outreachWhatsapp || ""
          )} className="h-7 text-xs">
            <Copy className="w-3 h-3 mr-1" /> Copy
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── ICP Wizard (Clay-like) ───────────────────────────────────────────────────

const JOB_TITLE_GROUPS: Record<string, string[]> = {
  "C-Suite": ["CEO", "COO", "CFO", "CTO", "CMO", "CIO", "CHRO", "CPO", "Managing Director", "General Manager"],
  "VP Level": ["VP Sales", "VP Engineering", "VP Operations", "VP Finance", "VP Marketing", "VP IT", "VP Procurement"],
  "Director / Head": ["Director of IT", "Director of Finance", "Head of Operations", "Head of Procurement", "Head of HR", "Head of Marketing", "Head of Sales", "Head of Technology", "Director of Business Development"],
  "Manager": ["Sales Manager", "IT Manager", "Finance Manager", "Procurement Manager", "Project Manager", "Business Dev Manager", "Marketing Manager", "HR Manager", "Operations Manager", "Account Manager"],
};

const FUNCTIONS = [
  "Sales & Business Dev", "Finance & Accounting", "IT & Technology",
  "Operations", "HR & People", "Legal & Compliance",
  "Marketing", "Procurement & Supply Chain", "Engineering", "Executive Leadership",
];

const SENIORITY_LEVELS = ["C-Suite / Board", "VP / SVP", "Director / Head", "Manager / Lead", "Individual Contributor"];

const COMPANY_TYPES_LIST = ["Private", "Public (Listed)", "Government-Owned", "Joint Venture", "SME (< 200)", "Enterprise (1000+)", "Startup"];

const SIGNAL_LABELS: Record<string, string> = {
  recent_news: "Recently in the news",
  new_contracts: "New contracts / project wins",
  hiring: "Actively hiring",
  intent: "High intent signals",
  funding_round: "Just raised funding",
  exec_change: "New executive appointment",
  regulatory_event: "Regulatory event",
};

interface CompanySuggestion { nameEn: string | null; nameAr: string | null; city: string | null; industry: string | null; domain: string | null; }

function CompanyAutocomplete({ onAdd }: { onAdd: (name: string) => void }) {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<CompanySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onInput(val: string) {
    setQ(val);
    if (timer.current) clearTimeout(timer.current);
    if (val.length < 2) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/lead-factory/company-suggest?q=${encodeURIComponent(val)}`);
        const data = await r.json();
        setSuggestions(data.suggestions || []);
        setOpen(true);
      } catch { setSuggestions([]); } finally { setLoading(false); }
    }, 280);
  }

  function pick(s: CompanySuggestion) {
    const name = s.nameEn || s.nameAr || "";
    if (name) { onAdd(name); setQ(""); setSuggestions([]); setOpen(false); }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        {loading && <Loader2 className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />}
        <Input value={q} onChange={e => onInput(e.target.value)}
          placeholder="Type company name to search…"
          className="pl-8 pr-8 h-8 text-xs bg-background border-border/30 text-muted-foreground"
          onKeyDown={e => { if (e.key === "Enter" && q.trim()) { onAdd(q.trim()); setQ(""); setOpen(false); } }}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          onFocus={() => suggestions.length > 0 && setOpen(true)} />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border/50 rounded-lg shadow-xl overflow-hidden">
          {suggestions.map((s, i) => (
            <button key={i} onMouseDown={() => pick(s)}
              className="w-full text-left px-3 py-2 hover:bg-secondary transition-colors">
              <div className="text-xs font-medium text-foreground">{s.nameEn || s.nameAr}</div>
              {(s.city || s.industry) && (
                <div className="text-[10px] text-muted-foreground">{[s.industry, s.city].filter(Boolean).join(" · ")}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ICPWizard({ onSubmit, isRunning }: { onSubmit: (brief: LeadFactoryBrief) => void; isRunning: boolean }) {
  const [sourcing, setSourcing] = useState<"people" | "companies" | "search">("people");
  const [step, setStep] = useState(0);

  // Shared
  const [industries, setIndustries] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [companyTypes, setCompanyTypes] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [signals, setSignals] = useState<string[]>([]);
  const [targetCount, setTargetCount] = useState(30);
  const [depth, setDepth] = useState<"basic" | "standard" | "deep">("standard");
  const [icpDesc, setIcpDesc] = useState("");

  // People mode
  const [titles, setTitles] = useState<string[]>([]);
  const [customTitle, setCustomTitle] = useState("");
  const [functions, setFunctions] = useState<string[]>([]);
  const [seniority, setSeniority] = useState<string[]>([]);

  // Search / paste mode
  const [companyList, setCompanyList] = useState<string[]>([]);
  const [pasteInput, setPasteInput] = useState("");

  const STEPS: Record<typeof sourcing, number> = { people: 4, companies: 4, search: 1 };
  const totalSteps = STEPS[sourcing];

  function toggle<T>(arr: T[], val: T, set: (a: T[]) => void) {
    set(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);
  }

  function addCustomTitle() {
    const t = customTitle.trim();
    if (t && !titles.includes(t)) { setTitles(prev => [...prev, t]); setCustomTitle(""); }
  }

  function handleSubmit() {
    const pastedItems = pasteInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    const allCompanies = [...new Set([...companyList, ...pastedItems])];
    onSubmit({
      inputMode: sourcing === "search" ? "list" : "segment",
      sourcing,
      targetCount,
      enrichmentDepth: depth,
      icpDescription: icpDesc || undefined,
      industries: industries.length > 0 ? industries : undefined,
      companySizes: sizes.length > 0 ? sizes : undefined,
      companyTypes: companyTypes.length > 0 ? companyTypes : undefined,
      cities: cities.length > 0 ? cities : undefined,
      targetTitles: titles.length > 0 ? titles : undefined,
      targetFunctions: functions.length > 0 ? functions : undefined,
      targetSeniority: seniority.length > 0 ? seniority : undefined,
      prioritySignals: signals.length > 0 ? signals : undefined,
      companyList: allCompanies.length > 0 ? allCompanies : undefined,
    });
  }

  function switchMode(m: typeof sourcing) { setSourcing(m); setStep(0); }

  // ── Shared step renderers ──
  function StepSignals() {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Which buying signals should we prioritise?</p>
        <p className="text-[10px] text-muted-foreground">Leave blank to include all signals</p>
        <div className="space-y-1.5">
          {BUYING_SIGNALS.map(sig => (
            <button key={sig} onClick={() => toggle(signals, sig, setSignals)}
              className={cn("w-full text-left px-3 py-2 text-xs rounded-lg border transition-colors flex items-center gap-2",
                signals.includes(sig) ? "bg-amber-500/10 border-amber-500/40 text-amber-300" : "border-border/30/60 text-muted-foreground hover:border-border/50 bg-background/40")}>
              <TrendingUp className="w-3.5 h-3.5 shrink-0 opacity-70" />{SIGNAL_LABELS[sig]}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function StepSettings(summaryLines: string[]) {
    return (
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>Target leads</span><span className="font-semibold text-foreground">{targetCount}</span>
          </div>
          <input type="range" min={10} max={200} step={10} value={targetCount}
            onChange={e => setTargetCount(+e.target.value)} className="w-full accent-blue-500" />
          <div className="flex justify-between text-[10px] text-foreground"><span>10</span><span>200</span></div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-2">Enrichment depth</p>
          <div className="flex gap-2">
            {([["basic", "Fast (2min)"], ["standard", "Balanced (5min)"], ["deep", "Deep (10min+)"]] as const).map(([d, label]) => (
              <button key={d} onClick={() => setDepth(d)}
                className={cn("flex-1 py-2 text-[10px] rounded-lg border transition-colors text-center",
                  depth === d ? "bg-blue-600/20 border-primary/50 text-primary" : "border-border/30/60 text-muted-foreground hover:border-border/50 bg-background/40")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-card/70 rounded-lg p-3 text-[11px] text-muted-foreground space-y-0.5">
          <div className="font-semibold text-muted-foreground mb-1.5">Run summary</div>
          {summaryLines.map((l, i) => <div key={i}>{l}</div>)}
          <div>Target: {targetCount} leads · {depth} enrichment</div>
        </div>
      </div>
    );
  }

  // ── People mode steps ──
  function PeopleStep0() {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-0.5">Who are you looking for?</p>
          <p className="text-[10px] text-muted-foreground mb-2">Select job titles or type your own</p>
          {/* Custom title input */}
          <div className="flex gap-1.5 mb-2">
            <Input value={customTitle} onChange={e => setCustomTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addCustomTitle(); }}
              placeholder="Type a title and press Enter…"
              className="flex-1 h-7 text-xs bg-background border-border/30 text-muted-foreground" />
            <Button size="sm" variant="ghost" onClick={addCustomTitle}
              className="h-7 px-2 text-xs text-muted-foreground border border-border/30">Add</Button>
          </div>
          {/* Custom titles added */}
          {titles.filter(t => !Object.values(JOB_TITLE_GROUPS).flat().includes(t)).length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {titles.filter(t => !Object.values(JOB_TITLE_GROUPS).flat().includes(t)).map(t => (
                <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-600/20 border border-violet-500/40 text-violet-300 text-[10px] rounded-full">
                  {t}<button onClick={() => setTitles(prev => prev.filter(x => x !== t))}><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
            </div>
          )}
          {/* Preset groups */}
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {Object.entries(JOB_TITLE_GROUPS).map(([group, groupTitles]) => (
              <div key={group}>
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{group}</p>
                <div className="flex flex-wrap gap-1">
                  {groupTitles.map(t => (
                    <button key={t} onClick={() => toggle(titles, t, setTitles)}
                      className={cn("px-2 py-0.5 text-[10px] rounded-full border transition-colors",
                        titles.includes(t) ? "bg-violet-600/20 border-violet-500/50 text-violet-300" : "border-border/30/60 text-muted-foreground hover:border-border/50")}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function PeopleStep1() {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-0.5">What function / department?</p>
          <p className="text-[10px] text-muted-foreground mb-2">Helps the AI focus search on the right team</p>
          <div className="grid grid-cols-2 gap-1.5">
            {FUNCTIONS.map(f => (
              <button key={f} onClick={() => toggle(functions, f, setFunctions)}
                className={cn("text-left px-2.5 py-2 text-[11px] rounded-lg border transition-colors",
                  functions.includes(f) ? "bg-blue-600/20 border-primary/50 text-primary" : "border-border/30/60 text-muted-foreground hover:border-border/50 bg-background/40")}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Seniority level</p>
          <div className="space-y-1.5">
            {SENIORITY_LEVELS.map(s => (
              <button key={s} onClick={() => toggle(seniority, s, setSeniority)}
                className={cn("w-full text-left px-3 py-1.5 text-xs rounded-lg border transition-colors",
                  seniority.includes(s) ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-300" : "border-border/30/60 text-muted-foreground hover:border-border/50 bg-background/40")}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function PeopleStep2() {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-0.5">What type of company should they work at?</p>
          <p className="text-[10px] text-muted-foreground mb-2">Industry (multi-select)</p>
          <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
            {SAUDI_INDUSTRIES.map(ind => (
              <button key={ind} onClick={() => toggle(industries, ind, setIndustries)}
                className={cn("text-left px-2.5 py-1.5 text-[11px] rounded-lg border transition-colors",
                  industries.includes(ind) ? "bg-blue-600/20 border-primary/50 text-primary" : "border-border/30/60 text-muted-foreground hover:border-border/50 bg-background/40")}>
                {ind}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground mb-1.5">City / Region</p>
          <div className="grid grid-cols-3 gap-1">
            {SAUDI_CITIES.map(city => (
              <button key={city} onClick={() => toggle(cities, city, setCities)}
                className={cn("px-2 py-1 text-[10px] rounded-lg border transition-colors",
                  cities.includes(city) ? "bg-blue-600/20 border-primary/50 text-primary" : "border-border/30/60 text-muted-foreground hover:border-border/50 bg-background/40")}>
                {city}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground mb-1.5">Company size (employees)</p>
          <div className="flex gap-1.5">
            {COMPANY_SIZES.map(s => (
              <button key={s} onClick={() => toggle(sizes, s, setSizes)}
                className={cn("flex-1 py-1.5 text-[10px] rounded-lg border transition-colors",
                  sizes.includes(s) ? "bg-blue-600/20 border-primary/50 text-primary" : "border-border/30/60 text-muted-foreground hover:border-border/50 bg-background/40")}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Companies mode steps ──
  function CompaniesStep0() {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-0.5">What industries are you targeting?</p>
          <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1">
            {SAUDI_INDUSTRIES.map(ind => (
              <button key={ind} onClick={() => toggle(industries, ind, setIndustries)}
                className={cn("text-left px-2.5 py-1.5 text-[11px] rounded-lg border transition-colors",
                  industries.includes(ind) ? "bg-blue-600/20 border-primary/50 text-primary" : "border-border/30/60 text-muted-foreground hover:border-border/50 bg-background/40")}>
                {ind}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground mb-1.5">Company type</p>
          <div className="flex flex-wrap gap-1.5">
            {COMPANY_TYPES_LIST.map(t => (
              <button key={t} onClick={() => toggle(companyTypes, t, setCompanyTypes)}
                className={cn("px-2.5 py-1 text-[10px] rounded-full border transition-colors",
                  companyTypes.includes(t) ? "bg-cyan-600/20 border-cyan-500/50 text-cyan-300" : "border-border/30/60 text-muted-foreground hover:border-border/50")}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <Textarea placeholder="Describe your ideal company in your own words (optional)…&#10;e.g. 'Fast-growing Saudi logistics company that recently won government contracts'"
          value={icpDesc} onChange={e => setIcpDesc(e.target.value)}
          className="h-16 text-xs bg-background border-border/30 text-muted-foreground resize-none" />
      </div>
    );
  }

  function CompaniesStep1() {
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground">Where are your target companies located?</p>
        <div className="grid grid-cols-3 gap-1.5">
          {SAUDI_CITIES.map(city => (
            <button key={city} onClick={() => toggle(cities, city, setCities)}
              className={cn("px-2 py-1.5 text-[11px] rounded-lg border transition-colors",
                cities.includes(city) ? "bg-blue-600/20 border-primary/50 text-primary" : "border-border/30/60 text-muted-foreground hover:border-border/50 bg-background/40")}>
              {city}
            </button>
          ))}
        </div>
        <p className="text-xs font-semibold text-muted-foreground pt-1">Company size</p>
        <div className="flex gap-2">
          {COMPANY_SIZES.map(s => (
            <button key={s} onClick={() => toggle(sizes, s, setSizes)}
              className={cn("flex-1 py-1.5 text-[11px] rounded-lg border transition-colors",
                sizes.includes(s) ? "bg-blue-600/20 border-primary/50 text-primary" : "border-border/30/60 text-muted-foreground hover:border-border/50 bg-background/40")}>
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Smart Search / paste mode ──
  function SearchStep() {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">Search by company name</p>
          <p className="text-[10px] text-muted-foreground mb-2">Start typing to autocomplete from our Saudi database</p>
          <CompanyAutocomplete onAdd={name => setCompanyList(prev => prev.includes(name) ? prev : [...prev, name])} />
        </div>

        {/* Added companies chips */}
        {companyList.length > 0 && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5">{companyList.length} companies added</p>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {companyList.map(c => (
                <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-600/15 border border-primary/30 text-primary text-[10px] rounded-full">
                  {c}<button onClick={() => setCompanyList(prev => prev.filter(x => x !== c))}><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-secondary" />
          <span className="text-[10px] text-muted-foreground">or paste a list</span>
          <div className="flex-1 h-px bg-secondary" />
        </div>

        <Textarea
          placeholder={"Paste company names, URLs, or CR numbers (one per line):\n\nAramco\narabia-tech.com\n1234567890\nhttps://example.sa"}
          value={pasteInput} onChange={e => setPasteInput(e.target.value)}
          className="h-28 text-xs font-mono bg-background border-border/30 text-muted-foreground resize-none"
        />
        {pasteInput.trim() && (
          <p className="text-[10px] text-muted-foreground">
            {pasteInput.split(/[\n,]+/).filter(s => s.trim()).length} entries detected from paste
          </p>
        )}

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Depth</span>
          {(["basic", "standard", "deep"] as const).map(d => (
            <button key={d} onClick={() => setDepth(d)}
              className={cn("px-2 py-1 text-[10px] rounded border capitalize transition-colors",
                depth === d ? "bg-blue-600/20 border-primary/50 text-primary" : "border-border/30 text-muted-foreground hover:border-border/50")}>
              {d}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const modeConfig = {
    people:    { label: "Find People",    icon: Users,     color: "violet", desc: "Source contacts by title & persona" },
    companies: { label: "Find Companies", icon: Building2,  color: "blue",   desc: "Source accounts by ICP profile" },
    search:    { label: "Search / Paste", icon: Search,     color: "cyan",   desc: "Search names or paste a list" },
  } as const;

  const activeColor = modeConfig[sourcing].color;
  const colorMap: Record<string, string> = {
    violet: "bg-violet-600 border-violet-500 text-foreground",
    blue:   "bg-blue-600 border-primary text-foreground",
    cyan:   "bg-cyan-600 border-cyan-500 text-foreground",
  };

  // Which step content to render
  const stepContent = (() => {
    if (sourcing === "people") {
      if (step === 0) return <PeopleStep0 />;
      if (step === 1) return <PeopleStep1 />;
      if (step === 2) return <PeopleStep2 />;
      if (step === 3) return <StepSignals />;
      if (step === 4) return StepSettings([
        `Looking for: ${titles.length > 0 ? titles.slice(0, 3).join(", ") + (titles.length > 3 ? ` +${titles.length - 3}` : "") : "Any title"}`,
        `Function: ${functions.length > 0 ? functions.join(", ") : "All"}`,
        `Seniority: ${seniority.length > 0 ? seniority.join(", ") : "All"}`,
        `Industries: ${industries.length > 0 ? industries.join(", ") : "All"}`,
        `Cities: ${cities.length > 0 ? cities.join(", ") : "All Saudi Arabia"}`,
      ]);
    }
    if (sourcing === "companies") {
      if (step === 0) return <CompaniesStep0 />;
      if (step === 1) return <CompaniesStep1 />;
      if (step === 2) return <StepSignals />;
      if (step === 3) return StepSettings([
        `Industries: ${industries.length > 0 ? industries.join(", ") : "All"}`,
        `Cities: ${cities.length > 0 ? cities.join(", ") : "All Saudi Arabia"}`,
        `Size: ${sizes.length > 0 ? sizes.join(", ") : "Any"}`,
        `Type: ${companyTypes.length > 0 ? companyTypes.join(", ") : "Any"}`,
        `Signals: ${signals.length > 0 ? signals.join(", ") : "All"}`,
      ]);
    }
    if (sourcing === "search") return <SearchStep />;
    return null;
  })();

  const isLastStep = sourcing === "search" || step === totalSteps - 1;
  const canLaunch = sourcing === "search"
    ? (companyList.length > 0 || pasteInput.trim().length > 0)
    : sourcing === "people"
      ? titles.length > 0 || functions.length > 0 || seniority.length > 0
      : true;

  return (
    <div className="space-y-3">
      {/* Mode selector — 3 cards */}
      <div className="grid grid-cols-3 gap-2">
        {(["people", "companies", "search"] as const).map(m => {
          const cfg = modeConfig[m];
          const Icon = cfg.icon;
          const active = sourcing === m;
          return (
            <button key={m} onClick={() => switchMode(m)}
              className={cn("flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-center transition-all",
                active ? colorMap[cfg.color] : "border-border/30 text-muted-foreground hover:border-border/50 bg-background/40")}>
              <Icon className={cn("w-4 h-4", active ? "text-foreground" : "text-muted-foreground")} />
              <span className="text-[10px] font-semibold leading-tight">{cfg.label}</span>
              <span className={cn("text-[9px] leading-tight", active ? "text-foreground/70" : "text-foreground")}>{cfg.desc}</span>
            </button>
          );
        })}
      </div>

      {/* Step progress — not shown in search mode */}
      {sourcing !== "search" && (
        <div className="flex items-center gap-1">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div key={i} className={cn("flex-1 h-0.5 rounded-full transition-all", i <= step ? "bg-blue-500" : "bg-secondary")} />
          ))}
        </div>
      )}

      {/* Step content */}
      {stepContent}

      {/* Navigation */}
      <div className="flex gap-2 pt-1">
        {sourcing !== "search" && step > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setStep(s => s - 1)}
            className="text-muted-foreground hover:text-foreground h-8">
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>
        )}
        {!isLastStep && (
          <Button size="sm" onClick={() => setStep(s => s + 1)} className="flex-1 h-8 bg-blue-600 hover:bg-blue-500 text-foreground text-xs">
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        )}
        {isLastStep && (
          <Button size="sm" onClick={handleSubmit} disabled={isRunning || !canLaunch}
            className="flex-1 h-8 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-foreground font-semibold text-xs">
            {isRunning ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Running…</> : <><Play className="w-3.5 h-3.5 mr-1.5" /> Launch Pipeline</>}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Org Chart Tree (SVG Tier Visualization) ─────────────────────────────────

const SENIORITY_ORDER = ["Chairman", "Board", "C-Suite", "EVP", "SVP", "VP", "Director", "Head", "Manager", "Senior"];

function seniorityTier(node: OrgNode): number {
  const s = (node.seniority || "").toLowerCase();
  if (s.includes("chair") || s.includes("board")) return 0;
  if (s.includes("c-suite") || s.includes("ceo") || s.includes("coo") || s.includes("cfo") || s.includes("cto") || s.includes("cmo") || s.includes("managing director")) return 1;
  if (s.includes("evp") || s.includes("svp")) return 2;
  if (s.includes("vp") || s.includes("vice president")) return 3;
  if (s.includes("director") || s.includes("head of")) return 4;
  if (s.includes("manager") || s.includes("senior")) return 5;
  return 6;
}

function OrgTree({ nodes }: { nodes: OrgNode[] }) {
  if (nodes.length === 0) return null;

  const tierMap = new Map<number, OrgNode[]>();
  for (const n of nodes) {
    const t = seniorityTier(n);
    if (!tierMap.has(t)) tierMap.set(t, []);
    tierMap.get(t)!.push(n);
  }
  const tiers = Array.from(tierMap.entries()).sort((a, b) => a[0] - b[0]);

  const NODE_W = 130, NODE_H = 52, H_GAP = 16, V_GAP = 40;
  const svgWidth = Math.max(...tiers.map(([, ns]) => ns.length * (NODE_W + H_GAP) - H_GAP)) + 40;
  const svgHeight = tiers.length * (NODE_H + V_GAP) + 20;

  const tierColors: Record<number, string> = {
    0: "#7c3aed", 1: "#1d4ed8", 2: "#0369a1", 3: "#0891b2",
    4: "#047857", 5: "#b45309", 6: "hsl(220,14%,40%)",
  };

  const tierPositions: { tier: number; nodes: { node: OrgNode; cx: number; cy: number }[] }[] = [];
  let y = 30;
  for (const [tier, ns] of tiers) {
    const totalW = ns.length * NODE_W + (ns.length - 1) * H_GAP;
    let x = (svgWidth - totalW) / 2;
    const positioned = ns.map(node => {
      const cx = x + NODE_W / 2;
      const cy = y + NODE_H / 2;
      x += NODE_W + H_GAP;
      return { node, cx, cy };
    });
    tierPositions.push({ tier, nodes: positioned });
    y += NODE_H + V_GAP;
  }

  const color = (tier: number) => tierColors[tier] || "hsl(220,14%,40%)";

  return (
    <div className="overflow-x-auto">
      <svg width={svgWidth} height={svgHeight} className="mx-auto">
        {/* Connecting lines between tiers */}
        {tierPositions.slice(0, -1).map(({ nodes: parentNodes }, ti) => {
          const childTier = tierPositions[ti + 1];
          if (!childTier) return null;
          return parentNodes.flatMap(({ cx: px, cy: py }) =>
            childTier.nodes.map(({ cx: cx2, cy: cy2 }, ci) => (
              <line key={`line-${ti}-${ci}`}
                x1={px} y1={py + NODE_H / 2} x2={cx2} y2={cy2 - NODE_H / 2}
                stroke="#334155" strokeWidth={1} strokeDasharray="4 4" />
            ))
          );
        })}
        {/* Nodes */}
        {tierPositions.map(({ tier, nodes: ns }) =>
          ns.map(({ node, cx, cy }) => (
            <g key={node.id || node.nameEn} transform={`translate(${cx - NODE_W / 2}, ${cy - NODE_H / 2})`}>
              <rect width={NODE_W} height={NODE_H} rx={8}
                fill={`${color(tier)}22`} stroke={color(tier)} strokeWidth={1.5} />
              <text x={NODE_W / 2} y={16} textAnchor="middle" fill="white"
                fontSize={10} fontWeight="600" className="select-none">
                {node.nameEn.length > 16 ? node.nameEn.slice(0, 15) + "…" : node.nameEn}
              </text>
              {node.title && (
                <text x={NODE_W / 2} y={29} textAnchor="middle" fill="#94a3b8"
                  fontSize={8} className="select-none">
                  {node.title.length > 20 ? node.title.slice(0, 19) + "…" : node.title}
                </text>
              )}
              <g transform={`translate(${NODE_W / 2 - 18}, 38)`}>
                {node.email && <circle cx={0} cy={0} r={5} fill="hsl(263,70%,70%)" opacity={0.9} />}
                {node.phone && <circle cx={12} cy={0} r={5} fill="hsl(200,80%,60%)" opacity={0.9} />}
                {node.linkedin && <circle cx={24} cy={0} r={5} fill="#6366f1" opacity={0.9} />}
              </g>
            </g>
          ))
        )}
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap gap-2 mt-2 justify-center">
        {tiers.map(([tier, ns]) => (
          <div key={tier} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-full" style={{ background: color(tier) }} />
            <span>{ns[0]?.seniority || `Level ${tier}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── History Panel ─────────────────────────────────────────────────────────────

interface HistoryJob {
  id: number;
  status: string;
  inputMode: string;
  brief?: Record<string, unknown>;
  totalDiscovered?: number;
  totalPublished?: number;
  totalRejected?: number;
  createdAt?: string;
  completedAt?: string;
}

function HistoryPanel({ onLoadJob }: { onLoadJob: (jobId: number) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["lf-jobs"],
    queryFn: async () => {
      const r = await fetch("/api/lead-factory/jobs");
      return r.json();
    },
    refetchInterval: 10000,
  });

  const jobs: HistoryJob[] = data?.jobs || [];

  const statusColor = (s: string) =>
    s === "completed" ? "text-emerald-400" : s === "failed" ? "text-red-400" : "text-primary";

  const statusIcon = (s: string) =>
    s === "completed" ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> :
    s === "failed" ? <AlertCircle className="w-3 h-3 text-red-400" /> :
    <Loader2 className="w-3 h-3 text-primary animate-spin" />;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-muted-foreground">Pipeline History</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{jobs.length} runs</span>
      </div>
      {isLoading && <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 text-muted-foreground animate-spin" /></div>}
      {!isLoading && jobs.length === 0 && (
        <div className="text-center py-8 text-xs text-foreground">No pipeline runs yet</div>
      )}
      <div className="space-y-2 max-h-[calc(100vh-180px)] overflow-y-auto pr-1">
        {jobs.map(job => {
          const industries = (job.brief?.industries as string[] | undefined) || [];
          const cities = (job.brief?.cities as string[] | undefined) || [];
          const date = job.createdAt ? new Date(job.createdAt).toLocaleDateString("en-SA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
          return (
            <button key={job.id} onClick={() => onLoadJob(job.id)}
              className="w-full text-left border border-border/30/60 rounded-lg p-3 hover:border-border/50 hover:bg-card/65 transition-all bg-background/40">
              <div className="flex items-center gap-2 mb-1.5">
                {statusIcon(job.status)}
                <span className={cn("text-[10px] font-semibold uppercase tracking-wider", statusColor(job.status))}>{job.status}</span>
                <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1"><Clock className="w-3 h-3" />{date}</span>
              </div>
              <div className="text-xs font-medium text-foreground truncate mb-1">
                {industries.length > 0 ? industries.slice(0, 2).join(", ") : job.inputMode === "list" ? "Company List" : "All Industries"}
                {cities.length > 0 && <span className="text-muted-foreground"> · {cities.slice(0, 2).join(", ")}</span>}
              </div>
              <div className="flex gap-3 text-[10px] text-muted-foreground">
                {job.totalDiscovered != null && <span className="text-muted-foreground">{job.totalDiscovered} discovered</span>}
                {job.totalPublished != null && <span className="text-emerald-400/80">{job.totalPublished} published</span>}
                {job.totalRejected != null && <span className="text-red-400/60">{job.totalRejected} rejected</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Signal Monitor Panel ──────────────────────────────────────────────────────

interface SignalAlert {
  source: string;
  headline: string;
  company?: string;
  signalType: string;
  summary: string;
  timestamp?: string;
}

function SignalPanel({ onClose }: { onClose: () => void }) {
  const [signals, setSignals] = useState<SignalAlert[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [total, setTotal] = useState(0);
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    startMonitor();
    return () => sseRef.current?.close();
  }, []);

  async function startMonitor() {
    setIsRunning(true);
    setSignals([]);
    setLogs(["Starting signal monitor…"]);
    try {
      const r = await fetch("/api/signals/push", { method: "POST" });
      const data = await r.json();
      if (!data.ok || !data.jobId) { setIsRunning(false); return; }
      sseRef.current?.close();
      const es = new EventSource(`/api/signals/stream/${data.jobId}`);
      sseRef.current = es;
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type === "stream_end") { es.close(); setIsRunning(false); setIsDone(true); return; }
          if (ev.type === "heartbeat") return;
          if (ev.type === "log" && ev.message) setLogs(prev => [...prev, ev.message].slice(-20));
          if (ev.type === "signal" && ev.data) setSignals(prev => [ev.data as SignalAlert, ...prev].slice(0, 100));
          if (ev.type === "monitor_complete") { setTotal(ev.total || 0); setIsRunning(false); setIsDone(true); }
        } catch {}
      };
      es.onerror = () => { es.close(); setIsRunning(false); };
    } catch { setIsRunning(false); }
  }

  const signalTypeColor: Record<string, string> = {
    news: "text-primary bg-blue-500/10 border-primary/30",
    tender: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    contract: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    hiring: "text-violet-400 bg-violet-500/10 border-violet-500/30",
    regulatory: "text-orange-400 bg-orange-500/10 border-orange-500/30",
    market: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0d1117] border border-border/30 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            {isRunning ? <Radio className="w-4 h-4 text-primary animate-pulse" /> : <Activity className="w-4 h-4 text-emerald-400" />}
            <span className="text-sm font-semibold text-foreground">Signal Monitor</span>
            {isDone && <span className="text-[11px] text-emerald-400">{total} signals collected</span>}
            {isRunning && <span className="text-[11px] text-primary animate-pulse">Scanning…</span>}
          </div>
          <div className="flex gap-2">
            {!isRunning && <Button size="sm" variant="ghost" onClick={startMonitor} className="h-7 text-xs text-muted-foreground hover:text-foreground">Refresh</Button>}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex gap-0">
          {/* Signals list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {signals.length === 0 && isRunning && (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mb-2" />
                <span className="text-xs">Scanning sources…</span>
              </div>
            )}
            {signals.map((s, i) => (
              <div key={i} className="border border-border/30/60 rounded-lg p-3 bg-background/40">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={cn("inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded border uppercase tracking-wide", signalTypeColor[s.signalType] || "text-muted-foreground bg-card border-border/30")}>{s.signalType}</span>
                  <span className="text-[10px] text-muted-foreground">{s.source}</span>
                  {s.company && <span className="text-[10px] text-primary ml-auto truncate max-w-[140px]">{s.company}</span>}
                </div>
                <p className="text-xs text-muted-foreground leading-snug mb-1">{s.headline}</p>
                {s.summary && s.summary !== s.headline && (
                  <p className="text-[10px] text-muted-foreground leading-snug">{s.summary}</p>
                )}
              </div>
            ))}
          </div>

          {/* Log sidebar */}
          <div className="w-52 border-l border-border/40 p-3 overflow-y-auto shrink-0">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Source Log</p>
            {logs.map((log, i) => (
              <p key={i} className="text-[9px] text-foreground leading-relaxed mb-0.5">{log}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Relationship Intelligence Panel ─────────────────────────────────────────

function RelationshipIntelPanel() {
  const [brief, setBrief] = useState<RelBrief>({ targetCompanyName: "", outputDepth: "deep" });
  const [jobId, setJobId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Record<number, AgentState>>({
    1: { status: "idle", label: "Org Mapper", log: [] },
    2: { status: "idle", label: "Stakeholder Enricher", log: [] },
    3: { status: "idle", label: "Network Expander", log: [] },
    4: { status: "idle", label: "Outreach Sequencer", log: [] },
  });
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [contacts, setContacts] = useState<OutreachContact[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [selectedContact, setSelectedContact] = useState<OutreachContact | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const startMutation = useMutation({
    mutationFn: async (b: RelBrief) => {
      const r = await fetch("/api/relationship-intel/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      return r.json();
    },
    onSuccess: (data) => {
      if (data.ok && data.jobId) {
        setJobId(data.jobId);
        setIsRunning(true);
        setDone(false);
        startSSE(data.jobId);
      }
    },
  });

  function startSSE(jId: string) {
    sseRef.current?.close();
    const es = new EventSource(`/api/relationship-intel/stream/${jId}`);
    sseRef.current = es;

    es.onmessage = (e) => {
      if (e.data === "[DONE]") { es.close(); setIsRunning(false); setDone(true); return; }
      try {
        const ev: AgentEvent = JSON.parse(e.data);
        if (ev.type === "stream_end") { es.close(); setIsRunning(false); setDone(true); return; }

        if (ev.agent) {
          setAgents(prev => {
            const cur = prev[ev.agent!] || { status: "idle", label: AGENT_LABELS[ev.agent!] || "", log: [] };
            const updated = { ...cur };
            if (ev.type === "agent_start") { updated.status = "running"; updated.log = []; }
            if (ev.type === "agent_complete") { updated.status = "complete"; updated.count = ev.count; }
            if (ev.type === "agent_error") { updated.status = "error"; }
            if (ev.type === "agent_log" && ev.message) updated.log = [...cur.log, ev.message].slice(-30);
            if (ev.type === "agent_progress" && ev.current !== undefined) updated.progress = { current: ev.current, total: ev.total! };
            return { ...prev, [ev.agent!]: updated };
          });
        }

        if (ev.type === "org_node_found" && ev.node) setNodes(prev => [...prev, ev.node as OrgNode]);
        if (ev.type === "outreach_contact" && ev.contact) setContacts(prev => [...prev, ev.contact as OutreachContact]);
        if (ev.type === "pipeline_complete") { setIsRunning(false); setDone(true); }
      } catch {}
    };
    es.onerror = () => { es.close(); setIsRunning(false); };
  }

  return (
    <div className="space-y-4">
      {/* Input form */}
      <div className="bg-background/60 border border-border/30/60 rounded-xl p-4 space-y-3">
        <div className="flex gap-2">
          <Input placeholder="Target company name (e.g. Saudi Aramco)" value={brief.targetCompanyName}
            onChange={e => setBrief(b => ({ ...b, targetCompanyName: e.target.value }))}
            className="bg-card border-border/30 text-sm text-foreground" />
          <Input placeholder="CR number (optional)" value={brief.targetCrNumber || ""}
            onChange={e => setBrief(b => ({ ...b, targetCrNumber: e.target.value }))}
            className="bg-card border-border/30 text-sm text-foreground w-40" />
        </div>
        <div className="flex gap-2">
          <Input placeholder="Website (optional)" value={brief.targetWebsite || ""}
            onChange={e => setBrief(b => ({ ...b, targetWebsite: e.target.value }))}
            className="bg-card border-border/30 text-sm text-foreground" />
          <Input placeholder="Arabic name (optional)" value={brief.targetCompanyNameAr || ""}
            onChange={e => setBrief(b => ({ ...b, targetCompanyNameAr: e.target.value }))}
            className="bg-card border-border/30 text-sm text-foreground font-arabic" />
        </div>
        <Textarea placeholder="Context (what are you selling, what's the goal?)"
          value={brief.context || ""} onChange={e => setBrief(b => ({ ...b, context: e.target.value }))}
          className="h-16 text-xs bg-card border-border/30 text-muted-foreground resize-none" />
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {(["basic", "deep"] as const).map(d => (
              <button key={d} onClick={() => setBrief(b => ({ ...b, outputDepth: d }))}
                className={cn("px-3 py-1 text-xs rounded-lg border capitalize transition-colors",
                  brief.outputDepth === d ? "bg-blue-600/20 border-primary/50 text-primary" : "border-border/30 text-muted-foreground hover:border-border/50")}>
                {d}
              </button>
            ))}
          </div>
          <Button size="sm" disabled={!brief.targetCompanyName || isRunning}
            onClick={() => startMutation.mutate(brief)}
            className="bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-foreground">
            {isRunning ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Mapping…</> : <><Network className="w-3.5 h-3.5 mr-1.5" /> Map Org</>}
          </Button>
        </div>
      </div>

      {(isRunning || done) && (
        <>
          {/* Agent grid */}
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map(n => (
              <AgentCard key={n} agentNum={n} state={agents[n] || { status: "idle", label: AGENT_LABELS[n], log: [] }} />
            ))}
          </div>

          {/* Org chart — SVG tier tree */}
          {nodes.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-muted-foreground">Org Chart — {nodes.length} people</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Email
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block ml-1" /> Phone
                  <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block ml-1" /> LinkedIn
                </div>
              </div>
              <div className="bg-background/60 border border-border/30/50 rounded-xl p-4">
                <OrgTree nodes={nodes} />
              </div>
              {/* Compact list below tree */}
              <div className="mt-3 space-y-1 max-h-40 overflow-y-auto pr-1">
                {nodes.map((node, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-card/65 transition-colors">
                    <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0",
                      node.seniority === "C-Suite" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                      node.seniority === "Board" ? "bg-violet-500/20 text-violet-400 border border-violet-500/30" :
                      "bg-secondary text-muted-foreground")}>
                      {node.nameEn?.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-foreground truncate">{node.nameEn}</span>
                      {node.nameAr && <span className="text-[10px] text-muted-foreground font-arabic ml-1">{node.nameAr}</span>}
                      <span className="text-[10px] text-muted-foreground ml-1.5">· {node.title}</span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {node.email && <Mail className="w-3 h-3 text-emerald-400" />}
                      {node.phone && <Phone className="w-3 h-3 text-primary" />}
                      {node.linkedin && <Globe className="w-3 h-3 text-primary" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ranked outreach contacts */}
          {contacts.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Ranked Outreach Plan — {contacts.length} contacts</p>
              <div className="space-y-2">
                {contacts.map((contact, i) => (
                  <div key={i} className="border border-border/30/60 rounded-lg p-3 bg-background/40 hover:border-border/50 transition-colors">
                    <div className="flex items-start gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-[9px] font-bold text-foreground shrink-0">
                        #{contact.rank}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">{contact.name}</span>
                          {contact.title && <span className="text-[10px] text-muted-foreground">{contact.title}</span>}
                        </div>
                        {contact.conversationHook && (
                          <p className="text-[10px] text-amber-400/80 italic mt-0.5">"{contact.conversationHook}"</p>
                        )}
                      </div>
                      <button onClick={() => setSelectedContact(contact)}
                        className="text-[10px] text-primary hover:text-primary flex items-center gap-1 shrink-0">
                        <Sparkles className="w-3 h-3" /> Copy
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {selectedContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-background border border-border/30 rounded-xl w-full max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border/30">
              <div>
                <h3 className="text-sm font-semibold text-foreground">#{selectedContact.rank} — {selectedContact.name}</h3>
                <p className="text-[11px] text-muted-foreground">{selectedContact.title}</p>
              </div>
              <button onClick={() => setSelectedContact(null)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {selectedContact.outreachEmail && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground mb-1">EMAIL</p>
                  <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground font-mono bg-card rounded-lg p-3 leading-relaxed">{selectedContact.outreachEmail}</pre>
                </div>
              )}
              {selectedContact.outreachLinkedin && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground mb-1">LINKEDIN</p>
                  <p className="text-[11px] text-muted-foreground bg-card rounded-lg p-3">{selectedContact.outreachLinkedin}</p>
                </div>
              )}
              {selectedContact.whatsappOpener && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground mb-1">WHATSAPP</p>
                  <p className="text-[11px] text-muted-foreground bg-card rounded-lg p-3">{selectedContact.whatsappOpener}</p>
                </div>
              )}
              {selectedContact.culturalNote && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                  <p className="text-[10px] text-amber-400 font-semibold mb-1">Cultural Note</p>
                  <p className="text-[11px] text-amber-300/80">{selectedContact.culturalNote}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LeadFactoryPage() {
  const [tab, setTab] = useState("factory");
  const [showSignalPanel, setShowSignalPanel] = useState(false);
  const [jobStreamId, setJobStreamId] = useState<string | null>(null);
  const [jobDbId, setJobDbId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [agents, setAgents] = useState<Record<number, AgentState>>({
    1: { status: "idle", label: "ICP Mapper & Source Orchestrator", log: [] },
    2: { status: "idle", label: "Lead Harvester", log: [] },
    3: { status: "idle", label: "Deep Enrichment", log: [] },
    4: { status: "idle", label: "Signal Intelligence", log: [] },
    5: { status: "idle", label: "Validate, Verify & Deduplicate", log: [] },
    6: { status: "idle", label: "ICP Scoring + AI Copywriter", log: [] },
    7: { status: "idle", label: "Publish & Seed", log: [] },
  });
  const [liveLeads, setLiveLeads] = useState<LeadResult[]>([]);
  const [results, setResults] = useState<LeadResult[]>([]);
  const [summary, setSummary] = useState<{ published: number; rejected: number } | null>(null);
  const [filterTier, setFilterTier] = useState<string>("all");
  const [searchQ, setSearchQ] = useState("");
  const [copyLead, setCopyLead] = useState<LeadResult | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const startMutation = useMutation({
    mutationFn: async (brief: LeadFactoryBrief) => {
      const r = await fetch("/api/lead-factory/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
      });
      return r.json();
    },
    onSuccess: (data) => {
      if (data.ok && data.jobId) {
        resetState();
        setJobStreamId(data.jobId);
        setIsRunning(true);
        setIsDone(false);
        startSSE(data.jobId);
      }
    },
  });

  function resetState() {
    setLiveLeads([]);
    setResults([]);
    setSummary(null);
    setJobDbId(null);
    setAgents({
      1: { status: "idle", label: "ICP Mapper & Source Orchestrator", log: [] },
      2: { status: "idle", label: "Lead Harvester", log: [] },
      3: { status: "idle", label: "Deep Enrichment", log: [] },
      4: { status: "idle", label: "Signal Intelligence", log: [] },
      5: { status: "idle", label: "Validate, Verify & Deduplicate", log: [] },
      6: { status: "idle", label: "ICP Scoring + AI Copywriter", log: [] },
      7: { status: "idle", label: "Publish & Seed", log: [] },
    });
  }

  function startSSE(jId: string) {
    sseRef.current?.close();
    const es = new EventSource(`/api/lead-factory/stream/${jId}`);
    sseRef.current = es;

    es.onmessage = (e) => {
      if (e.data === "[DONE]") { es.close(); setIsRunning(false); setIsDone(true); return; }
      try {
        const ev: AgentEvent & { node?: OrgNode; contact?: OutreachContact; count?: number } = JSON.parse(e.data);
        if (ev.type === "stream_end") { es.close(); setIsRunning(false); setIsDone(true); return; }
        if (ev.type === "heartbeat") return;

        if (ev.agent) {
          setAgents(prev => {
            const cur = prev[ev.agent!] || { status: "idle", label: AGENT_LABELS[ev.agent!] || "", log: [] };
            const updated = { ...cur };
            if (ev.type === "agent_start") { updated.status = "running"; updated.log = []; }
            else if (ev.type === "agent_complete") { updated.status = "complete"; if (ev.count !== undefined) updated.count = ev.count; }
            else if (ev.type === "agent_error") { updated.status = "error"; if (ev.message) updated.log = [...cur.log, ev.message]; }
            else if (ev.type === "agent_log" && ev.message) updated.log = [...cur.log, ev.message].slice(-30);
            else if (ev.type === "agent_progress" && ev.current !== undefined) updated.progress = { current: ev.current, total: ev.total! };
            return { ...prev, [ev.agent!]: updated };
          });
        }

        if ((ev.type === "lead_found" || ev.type === "lead_enriched") && ev.lead) {
          const lead = ev.lead as LeadResult;
          if (lead.companyName) {
            setLiveLeads(prev => {
              const exists = prev.some(l => l.companyName === lead.companyName);
              if (exists) return prev.map(l => l.companyName === lead.companyName ? { ...l, ...lead } : l);
              return [{ id: Date.now(), ...lead }, ...prev].slice(0, 200);
            });
          }
        }

        if (ev.type === "lead_published" && ev.resultId) {
          setResults(prev => {
            const exists = prev.some(l => l.id === ev.resultId);
            if (!exists) return [{ id: ev.resultId!, companyName: ev.companyName, priorityTier: ev.tier } as LeadResult, ...prev];
            return prev;
          });
        }

        if (ev.type === "pipeline_complete") {
          setIsRunning(false);
          setIsDone(true);
          setSummary({ published: ev.totalPublished || 0, rejected: ev.totalRejected || 0 });
          if (ev.jobId) {
            setJobDbId(ev.jobId);
            loadResults(ev.jobId);
          }
        }
      } catch {}
    };

    es.onerror = () => { es.close(); setIsRunning(false); };
  }

  async function loadResults(jDbId: number) {
    try {
      const r = await fetch(`/api/lead-factory/results/${jDbId}`);
      const data = await r.json();
      if (data.ok) setResults(data.results);
    } catch {}
  }

  const displayLeads = isDone ? results : liveLeads;
  const filteredLeads = displayLeads.filter(l => {
    if (filterTier !== "all" && l.priorityTier !== filterTier) return false;
    if (searchQ && !`${l.companyName} ${l.industry} ${l.city} ${l.domain}`.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  const activeAgentCount = Object.values(agents).filter(a => a.status === "running").length;
  const completedCount = Object.values(agents).filter(a => a.status === "complete").length;
  const tierCounts = { A: 0, B: 0, C: 0, D: 0 };
  displayLeads.forEach(l => { if (l.priorityTier && tierCounts[l.priorityTier as keyof typeof tierCounts] !== undefined) tierCounts[l.priorityTier as keyof typeof tierCounts]++; });

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-foreground">
      {/* Header */}
      <div className="border-b border-border/40 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Zap className="w-4 h-4 text-foreground" />
          </div>
          <div>
            <h1 className="text-base font-bold text-foreground">Lead Factory</h1>
            <p className="text-[11px] text-muted-foreground">7-agent pipeline · 40+ free sources · Saudi B2B intelligence</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isRunning && (
            <div className="flex items-center gap-2 text-xs text-primary">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{activeAgentCount > 0 ? `Agent ${Object.entries(agents).find(([, s]) => s.status === "running")?.[0]} running` : "Starting…"}</span>
            </div>
          )}
          {isDone && summary && (
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{summary.published} leads published</span>
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={() => setShowSignalPanel(true)}
            className="h-7 text-xs text-muted-foreground hover:text-foreground border border-border/40 hover:border-primary/30">
            <Bell className="w-3 h-3 mr-1.5" /> Push Signals
          </Button>
          {results.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => {
              const csv = [
                ["Company", "Industry", "City", "Email", "Phone", "Domain", "Score", "Tier", "Source"].join(","),
                ...results.map(l => [
                  `"${l.companyName || ""}"`, `"${l.industry || ""}"`, `"${l.city || ""}"`,
                  l.email || "", l.phone || "", l.domain || "",
                  l.icpScore || "", l.priorityTier || "", `"${l.sourceUsed || ""}"`,
                ].join(","))
              ].join("\n");
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
              a.download = `leads_${Date.now()}.csv`;
              a.click();
            }} className="text-muted-foreground hover:text-foreground h-7 text-xs">
              <Download className="w-3 h-3 mr-1" /> CSV
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="shrink-0 bg-card/70 border-b border-border/40 rounded-none px-6 h-9 justify-start gap-1">
          <TabsTrigger value="factory" className="text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary rounded">
            <Zap className="w-3 h-3 mr-1.5" /> Lead Factory
          </TabsTrigger>
          <TabsTrigger value="rel" className="text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary rounded">
            <Network className="w-3 h-3 mr-1.5" /> Relationship Intelligence
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary rounded">
            <History className="w-3 h-3 mr-1.5" /> History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="factory" className="flex-1 overflow-hidden m-0">
          <div className="h-full flex gap-0">
            {/* Left: ICP Wizard */}
            <div className="w-72 shrink-0 border-r border-border/40 overflow-y-auto">
              <div className="p-4">
                <ICPWizard onSubmit={brief => startMutation.mutate(brief)} isRunning={isRunning} />

                {/* Pipeline progress */}
                {(isRunning || isDone) && (
                  <div className="mt-5 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pipeline</p>
                      <span className="text-[10px] text-muted-foreground">{completedCount}/7</span>
                    </div>
                    {[1, 2, 3, 4, 5, 6, 7].map(n => (
                      <AgentCard key={n} agentNum={n} state={agents[n] || { status: "idle", label: AGENT_LABELS[n], log: [] }} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Results */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Stats bar */}
              {(isRunning || displayLeads.length > 0) && (
                <div className="shrink-0 border-b border-border/40 px-4 py-2 flex items-center gap-4">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="w-3.5 h-3.5" />
                    <span className="font-semibold text-foreground">{displayLeads.length}</span>
                    <span>leads</span>
                  </div>
                  {["A", "B", "C"].map(tier => tierCounts[tier as keyof typeof tierCounts] > 0 && (
                    <div key={tier} className="flex items-center gap-1 text-xs">
                      <TierBadge tier={tier} />
                      <span className="text-muted-foreground">{tierCounts[tier as keyof typeof tierCounts]}</span>
                    </div>
                  ))}
                  <div className="ml-auto flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search leads…"
                        className="pl-7 h-7 text-xs bg-card border-border/30 text-muted-foreground w-48" />
                    </div>
                    <div className="flex gap-1">
                      {(["all", "A", "B", "C"] as const).map(t => (
                        <button key={t} onClick={() => setFilterTier(t)}
                          className={cn("px-2 py-0.5 text-[10px] rounded border transition-colors",
                            filterTier === t ? "border-primary/50 bg-blue-600/20 text-primary" : "border-border/30 text-muted-foreground hover:border-border/50")}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Leads list */}
              <div className="flex-1 overflow-y-auto p-4">
                {!isRunning && displayLeads.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center px-8">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600/20 to-violet-600/20 border border-primary/20 flex items-center justify-center mb-4">
                      <Zap className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground mb-2">Ready to generate leads</h3>
                    <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                      Configure your ICP using the wizard on the left, then launch the 7-agent pipeline. 
                      It queries 40+ free Saudi & GCC sources and delivers enriched, scored leads with AI outreach copy.
                    </p>
                    <div className="mt-6 grid grid-cols-3 gap-3 w-full max-w-sm">
                      {[["40+", "Sources"], ["7", "AI Agents"], ["100%", "Free"]].map(([n, l]) => (
                        <div key={l} className="bg-background/60 border border-border/30/50 rounded-lg p-3 text-center">
                          <div className="text-lg font-bold text-primary">{n}</div>
                          <div className="text-[10px] text-muted-foreground">{l}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {filteredLeads.length > 0 && (
                  <div className="space-y-2">
                    {filteredLeads.map((lead, i) => (
                      <LeadCard key={lead.id || i} lead={lead} onViewCopy={setCopyLead} />
                    ))}
                  </div>
                )}

                {isRunning && filteredLeads.length === 0 && (
                  <div className="flex items-center justify-center h-40">
                    <div className="text-center">
                      <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">Harvesting leads across sources…</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="rel" className="flex-1 overflow-y-auto m-0 p-4">
          <RelationshipIntelPanel />
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-y-auto m-0 p-4">
          <HistoryPanel onLoadJob={(jobId) => {
            loadResults(jobId);
            setJobDbId(jobId);
            setIsDone(true);
            setTab("factory");
          }} />
        </TabsContent>
      </Tabs>

      {copyLead && <CopyModal lead={copyLead} onClose={() => setCopyLead(null)} />}
      {showSignalPanel && <SignalPanel onClose={() => setShowSignalPanel(false)} />}
    </div>
  );
}
