import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Target, Plus, Trash2, Download, ChevronRight, ChevronLeft, X,
  CheckCircle2, Loader2, AlertCircle, Building2, Phone, Mail,
  Globe, Users, MapPin, BarChart3, Filter, FileText, FileSpreadsheet,
  Braces, Sparkles, Search, RefreshCw, UserCircle, Linkedin,
  TrendingUp, DollarSign, BriefcaseBusiness, Briefcase, Star, Info,
  Brain, User, Calendar, Eye, ChevronDown, ChevronUp, Shield, Heart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadGenomePanel } from "@/components/LeadGenomePanel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────
interface LeadList {
  id: number; name: string; criteria: string;
  status: "pending" | "running" | "done" | "failed";
  totalFound: number | null; sourcesSearched: string | null;
  createdAt: string; updatedAt: string;
}

interface LeadListItem {
  id: number; listId: number;
  personName: string | null; personNameAr: string | null;
  personTitle: string | null; personTitleAr: string | null;
  personType: string | null; seniority: string | null;
  department: string | null; nationality: string | null;
  linkedin: string | null; estimatedSalary: number | null;
  biography: string | null;
  phone: string | null; email: string | null; website: string | null;
  companyName: string | null; companyNameAr: string | null;
  industry: string | null; city: string | null;
  companyRevenue: string | null; companyEmployees: string | null;
  crNumber: string | null; ownershipPct: string | null;
  source: string | null; sourceId: string | null;
  matchScore: number | null; aiScore: number | null; aiReasoning: string | null;
  createdAt: string;
}

interface LeadCriteria {
  name: string;
  industries: string[];
  cities: string[];
  revenueRange: "any" | "under1m" | "1m-10m" | "10m-100m" | "100m+";
  employeeMin: number;
  employeeMax: number;
  personTypes: string[];
  compensationRange: "any" | "under50k" | "50k-200k" | "200k-500k" | "500k+";
  requiredPersonFields: string[];
  requiredCompanyFields: string[];
  sources: string[];
  maxLeads: number;
  freeText: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const INDUSTRIES = [
  "Technology", "Banking & Finance", "Construction", "Healthcare", "Energy & Oil",
  "Manufacturing", "Retail", "Real Estate", "Logistics & Transport",
  "Education", "Food & Beverage", "Telecom", "Government",
  "Consulting", "Media & Marketing", "Agriculture",
  "Mining & Materials", "Insurance",
];

const CITIES = [
  "Riyadh", "Jeddah", "Dammam", "Mecca", "Medina", "Tabuk",
  "Abha", "Khobar", "Al Ahsa", "Hofuf", "Jubail", "Yanbu", "Najran", "Hail",
  "Qassim", "Buraydah", "Taif", "Dhahran", "Khamis Mushait", "Jizan",
  "Al Baha", "Sakaka", "Arar", "Rafha", "Wajh", "Unaizah",
  "Dawadmi", "Bisha", "Sharurah", "Rabigh", "Laith",
];

const REVENUE_RANGES = [
  { id: "any",       label: "Any Revenue",        desc: "No revenue filter" },
  { id: "under1m",   label: "< 1M SAR",           desc: "Small companies" },
  { id: "1m-10m",    label: "1M – 10M SAR",        desc: "Growing companies" },
  { id: "10m-100m",  label: "10M – 100M SAR",      desc: "Mid-size companies" },
  { id: "100m+",     label: "100M+ SAR",           desc: "Large enterprises" },
];

const COMPENSATION_RANGES = [
  { id: "any",       label: "Any Level",           desc: "No compensation filter" },
  { id: "under50k",  label: "< $50K/yr",           desc: "Entry/mid level" },
  { id: "50k-200k",  label: "$50K – $200K/yr",     desc: "Senior level" },
  { id: "200k-500k", label: "$200K – $500K/yr",    desc: "Director / VP level" },
  { id: "500k+",     label: "$500K+/yr",           desc: "C-suite / Partner" },
];

const PERSON_TYPES = [
  { id: "executive",    label: "Executives",      desc: "CEOs, COOs, CTOs, VPs", icon: BriefcaseBusiness },
  { id: "owner",        label: "Owners",          desc: "Business owners & founders", icon: Star },
  { id: "shareholder",  label: "Shareholders",    desc: "Registered shareholders", icon: TrendingUp },
  { id: "board_member", label: "Board Members",   desc: "Directors & board members", icon: UserCircle },
  { id: "management",   label: "Management",      desc: "GMs, department heads", icon: Users },
];

const SOURCES = [
  { id: "orcbase",    label: "OrcBase",              desc: "6,000+ executives database" },
  { id: "masaar",     label: "Masaar",               desc: "CR shareholders & board" },
  { id: "builder",    label: "AI Database Builder",  desc: "Harvested owners & execs" },
  { id: "sa_market",  label: "SA Market (TASI/NOMU)", desc: "2,877 shareholders · 2,921 executives from listed companies" },
];

const PERSON_TYPE_BADGE: Record<string, { color: string; label: string }> = {
  executive:    { color: "bg-blue-500/15 text-primary border-primary/20",       label: "Executive" },
  owner:        { color: "bg-amber-500/15 text-amber-300 border-amber-500/20",    label: "Owner" },
  shareholder:  { color: "bg-violet-500/15 text-violet-300 border-violet-500/20", label: "Shareholder" },
  board_member: { color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20", label: "Board" },
  management:   { color: "bg-rose-500/15 text-rose-300 border-rose-500/20",       label: "Management" },
};

const SOURCE_BADGE: Record<string, { color: string; label: string }> = {
  orcbase:   { color: "bg-blue-500/15 text-primary border-primary/20",      label: "OrcBase" },
  masaar:    { color: "bg-amber-500/15 text-amber-300 border-amber-500/20",   label: "Masaar" },
  builder:   { color: "bg-violet-500/15 text-violet-300 border-violet-500/20", label: "Builder" },
  sa_market: { color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20", label: "SA Market" },
};

const DEFAULT_CRITERIA: LeadCriteria = {
  name: "", industries: [], cities: [],
  revenueRange: "any", employeeMin: 0, employeeMax: 99999,
  personTypes: ["executive", "owner"],
  compensationRange: "any",
  requiredPersonFields: [], requiredCompanyFields: [],
  sources: ["orcbase", "masaar", "builder", "sa_market"],
  maxLeads: 100, freeText: "",
};

const TOTAL_STEPS = 10;
const STEP_TITLES = [
  "Name your lead list",
  "Target industries",
  "Target cities",
  "Company revenue range",
  "Company size (employees)",
  "Person types to find",
  "Compensation level",
  "Required contact & data fields",
  "Data sources",
  "Lead limit & extra notes",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 cursor-pointer ${
      active ? "bg-primary/20 text-primary border-primary/40" : "bg-muted/40 text-muted-foreground border-border/40 hover:border-white/20 hover:text-foreground"
    }`}>
      {active && <CheckCircle2 className="w-3 h-3 mr-1 inline" />}{label}
    </button>
  );
}

function statusBadge(status: string) {
  if (status === "done")    return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/20 border">Done</Badge>;
  if (status === "running") return <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/20 border"><Loader2 className="w-3 h-3 mr-1 animate-spin inline" />Running</Badge>;
  if (status === "failed")  return <Badge className="bg-red-500/15 text-red-300 border-red-500/20 border">Failed</Badge>;
  return <Badge className="bg-zinc-500/15 text-muted-foreground border-border/20 border">Pending</Badge>;
}

function initials(name: string) {
  return name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Wizard ───────────────────────────────────────────────────────────────────
function WizardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [criteria, setCriteria] = useState<LeadCriteria>(DEFAULT_CRITERIA);
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (c: LeadCriteria) => {
      const r = await fetch(`${BASE}/api/lead-lists`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lead-lists"] }); handleClose(); },
  });

  function handleClose() {
    setStep(1); setCriteria(DEFAULT_CRITERIA); createMutation.reset(); onClose();
  }

  const canNext = step !== 1 || criteria.name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl bg-card border-border/40 text-foreground p-0 overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary/20 to-violet-500/10 px-6 pt-5 pb-4 border-b border-border/40 shrink-0">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-xl font-display font-bold text-foreground">AI Lead Hunt</DialogTitle>
                <p className="text-sm text-muted-foreground">Find decision-makers, owners & shareholders across Saudi Arabia</p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <div key={i} className={`h-1 rounded-full flex-1 transition-all duration-300 ${i + 1 < step ? "bg-primary" : i + 1 === step ? "bg-primary/60" : "bg-white/10"}`} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Step {step} of {TOTAL_STEPS}: <span className="text-foreground/70">{STEP_TITLES[step - 1]}</span></p>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="px-6 py-5 flex-1 overflow-y-auto min-h-[240px]">

          {/* Step 1: Name */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Give your lead hunt a clear name so you can reference it later.</p>
              <Input autoFocus placeholder="e.g. Riyadh Tech Founders Q2 2026"
                value={criteria.name}
                onChange={e => setCriteria(c => ({ ...c, name: e.target.value }))}
                className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground text-base h-12"
                onKeyDown={e => { if (e.key === "Enter" && canNext) setStep(2); }} />
            </div>
          )}

          {/* Step 2: Industries */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Which industries should the person's company be in? Leave empty for all. Leads with no industry data are always included.</p>
              <div className="flex items-center gap-2 mb-1">
                <button
                  onClick={() => setCriteria(c => ({ ...c, industries: c.industries.length === INDUSTRIES.length ? [] : [...INDUSTRIES] }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${criteria.industries.length === INDUSTRIES.length ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : "bg-muted/40 text-foreground/60 border-white/15 hover:border-white/30"}`}>
                  {criteria.industries.length === INDUSTRIES.length ? "✓ All Industries" : "Select All"}
                </button>
                {criteria.industries.length > 0 && criteria.industries.length < INDUSTRIES.length && (
                  <button onClick={() => setCriteria(c => ({ ...c, industries: [] }))} className="text-xs text-muted-foreground hover:text-foreground underline">Clear</button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">{INDUSTRIES.map(ind => (
                <Chip key={ind} label={ind} active={criteria.industries.includes(ind)}
                  onClick={() => setCriteria(c => ({ ...c, industries: toggle(c.industries, ind) }))} />
              ))}</div>
              <p className="text-xs text-muted-foreground/70">Leads with no industry tag in the database are always included regardless of your selection.</p>
            </div>
          )}

          {/* Step 3: Cities */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Which cities should the company be based in? Leave empty for all of Saudi Arabia. Leads with no city data are always included.</p>
              <div className="flex items-center gap-2 mb-1">
                <button
                  onClick={() => setCriteria(c => ({ ...c, cities: c.cities.length === CITIES.length ? [] : [...CITIES] }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${criteria.cities.length === CITIES.length ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : "bg-muted/40 text-foreground/60 border-white/15 hover:border-white/30"}`}>
                  {criteria.cities.length === CITIES.length ? "✓ All Cities" : "Select All Cities"}
                </button>
                {criteria.cities.length > 0 && criteria.cities.length < CITIES.length && (
                  <button onClick={() => setCriteria(c => ({ ...c, cities: [] }))} className="text-xs text-muted-foreground hover:text-foreground underline">Clear</button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">{CITIES.map(city => (
                <Chip key={city} label={city} active={criteria.cities.includes(city)}
                  onClick={() => setCriteria(c => ({ ...c, cities: toggle(c.cities, city) }))} />
              ))}</div>
              {criteria.cities.length > 0 && <p className="text-xs text-primary">{criteria.cities.length} cities selected · Leads with no city data also included</p>}
            </div>
          )}

          {/* Step 4: Revenue range */}
          {step === 4 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Filter by estimated annual company revenue (in Saudi Riyals).</p>
              <div className="grid grid-cols-1 gap-2">
                {REVENUE_RANGES.map(r => (
                  <button key={r.id} onClick={() => setCriteria(c => ({ ...c, revenueRange: r.id as LeadCriteria["revenueRange"] }))}
                    className={`flex items-center justify-between p-3.5 rounded-xl border transition-all text-left ${criteria.revenueRange === r.id ? "border-primary/50 bg-primary/10" : "border-border/40 bg-muted/40 hover:border-white/20"}`}>
                    <div>
                      <span className="text-sm font-semibold text-foreground">{r.label}</span>
                      <p className="text-xs text-muted-foreground">{r.desc}</p>
                    </div>
                    {criteria.revenueRange === r.id && <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 5: Company size */}
          {step === 5 && (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">Set the employee count range for target companies.</p>
              <div className="space-y-6 px-2">
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-2">
                    <span>Minimum employees</span>
                    <span className="text-foreground font-semibold">{criteria.employeeMin === 0 ? "Any" : criteria.employeeMin.toLocaleString()}</span>
                  </div>
                  <Slider min={0} max={5000} step={10}
                    value={[criteria.employeeMin]}
                    onValueChange={([v]) => setCriteria(c => ({ ...c, employeeMin: Math.min(v, c.employeeMax - 10) }))} />
                </div>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-2">
                    <span>Maximum employees</span>
                    <span className="text-foreground font-semibold">{criteria.employeeMax >= 99999 ? "Unlimited" : criteria.employeeMax.toLocaleString()}</span>
                  </div>
                  <Slider min={10} max={99999} step={10}
                    value={[criteria.employeeMax]}
                    onValueChange={([v]) => setCriteria(c => ({ ...c, employeeMax: Math.max(v, c.employeeMin + 10) }))} />
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {[{l:"Any",min:0,max:99999},{l:"Startup <10",min:0,max:9},{l:"Small 10-50",min:10,max:50},{l:"Medium 50-500",min:50,max:500},{l:"Large 500+",min:500,max:99999}].map(p => (
                  <button key={p.l} onClick={() => setCriteria(c => ({ ...c, employeeMin: p.min, employeeMax: p.max }))}
                    className={`px-3 py-1.5 text-xs rounded-full border transition-all ${criteria.employeeMin === p.min && criteria.employeeMax === p.max ? "bg-primary/20 text-primary border-primary/40" : "bg-muted/40 text-muted-foreground border-border/40 hover:border-white/20"}`}>
                    {p.l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 6: Person types */}
          {step === 6 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">What type of people are you looking for? Select all that apply.</p>
              <div className="space-y-2">
                {PERSON_TYPES.map(({ id, label, desc, icon: Icon }) => (
                  <button key={id} onClick={() => setCriteria(c => ({ ...c, personTypes: toggle(c.personTypes, id) }))}
                    className={`w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left ${criteria.personTypes.includes(id) ? "border-primary/50 bg-primary/10" : "border-border/40 bg-muted/40 hover:border-white/20"}`}>
                    <Icon className={`w-5 h-5 shrink-0 ${criteria.personTypes.includes(id) ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-foreground">{label}</span>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    {criteria.personTypes.includes(id) && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 7: Compensation */}
          {step === 7 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Filter by estimated annual compensation level (USD equivalent).</p>
              <div className="grid grid-cols-1 gap-2">
                {COMPENSATION_RANGES.map(r => (
                  <button key={r.id} onClick={() => setCriteria(c => ({ ...c, compensationRange: r.id as LeadCriteria["compensationRange"] }))}
                    className={`flex items-center justify-between p-3.5 rounded-xl border transition-all text-left ${criteria.compensationRange === r.id ? "border-primary/50 bg-primary/10" : "border-border/40 bg-muted/40 hover:border-white/20"}`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <DollarSign className={`w-4 h-4 ${criteria.compensationRange === r.id ? "text-primary" : "text-muted-foreground"}`} />
                        <span className="text-sm font-semibold text-foreground">{r.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground ml-6">{r.desc}</p>
                    </div>
                    {criteria.compensationRange === r.id && <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 8: Required fields */}
          {step === 8 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground mb-1">Person must have at least one of:</p>
                <p className="text-xs text-amber-400/80 mb-2">Selecting multiple means OR — any one is enough to qualify.</p>
                <div className="space-y-2">
                  {[{id:"phone",label:"Direct phone number",icon:Phone},{id:"email",label:"Email address",icon:Mail},{id:"linkedin",label:"LinkedIn profile",icon:Linkedin}].map(({id,label,icon:Icon}) => (
                    <button key={id} onClick={() => setCriteria(c => ({ ...c, requiredPersonFields: toggle(c.requiredPersonFields, id) }))}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${criteria.requiredPersonFields.includes(id) ? "border-primary/50 bg-primary/10" : "border-border/40 bg-muted/40 hover:border-white/20"}`}>
                      <Icon className={`w-4 h-4 ${criteria.requiredPersonFields.includes(id) ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="text-sm text-foreground">{label}</span>
                      {criteria.requiredPersonFields.includes(id) && <CheckCircle2 className="w-4 h-4 text-primary ml-auto" />}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground mb-1">Required company data (each selected is mandatory):</p>
                <div className="space-y-2">
                  {[{id:"revenue",label:"Company revenue data available"},{id:"employees",label:"Employee count available"},{id:"crNumber",label:"CR registration number"}].map(({id,label}) => (
                    <button key={id} onClick={() => setCriteria(c => ({ ...c, requiredCompanyFields: toggle(c.requiredCompanyFields, id) }))}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${criteria.requiredCompanyFields.includes(id) ? "border-primary/50 bg-primary/10" : "border-border/40 bg-muted/40 hover:border-white/20"}`}>
                      <Building2 className={`w-4 h-4 ${criteria.requiredCompanyFields.includes(id) ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="text-sm text-foreground">{label}</span>
                      {criteria.requiredCompanyFields.includes(id) && <CheckCircle2 className="w-4 h-4 text-primary ml-auto" />}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Unselected = include all leads regardless of data availability.</p>
            </div>
          )}

          {/* Step 9: Sources */}
          {step === 9 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Which databases should we hunt in? At least one required.</p>
              <div className="space-y-2">
                {SOURCES.map(src => (
                  <button key={src.id} onClick={() => setCriteria(c => ({ ...c, sources: toggle(c.sources, src.id) }))}
                    className={`w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left ${criteria.sources.includes(src.id) ? "border-primary/50 bg-primary/10" : "border-border/40 bg-muted/40 hover:border-white/20"}`}>
                    <div className="flex-1">
                      <span className="text-sm font-medium text-foreground">{src.label}</span>
                      <p className="text-xs text-muted-foreground">{src.desc}</p>
                    </div>
                    {criteria.sources.includes(src.id) && <CheckCircle2 className="w-4 h-4 text-primary" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 10: Max leads + free text + summary */}
          {step === 10 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-3">Maximum number of leads to generate (AI will pick the best matches).</p>
                <Slider min={10} max={500} step={10} value={[criteria.maxLeads]}
                  onValueChange={([v]) => setCriteria(c => ({ ...c, maxLeads: v }))} />
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>10</span><span className="text-xl font-display font-bold text-foreground">{criteria.maxLeads} leads</span><span>500</span>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Optional: any extra requirements for the AI to consider.</p>
                <Textarea placeholder="e.g. Must be Saudi nationals, companies founded after 2010, listed on Tadawul..."
                  value={criteria.freeText}
                  onChange={e => setCriteria(c => ({ ...c, freeText: e.target.value }))}
                  className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground min-h-[80px] resize-none" />
              </div>
              <div className="bg-muted/40 rounded-xl p-4 border border-border/40 space-y-1.5">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Hunt Summary</p>
                {[
                  ["Industries", criteria.industries.length > 0 ? criteria.industries.slice(0,3).join(", ")+(criteria.industries.length>3?"…":"") : "All"],
                  ["Cities", criteria.cities.length > 0 ? criteria.cities.slice(0,3).join(", ")+(criteria.cities.length>3?"…":"") : "All Saudi Arabia"],
                  ["Revenue", REVENUE_RANGES.find(r=>r.id===criteria.revenueRange)?.label ?? "Any"],
                  ["Employees", criteria.employeeMax >= 99999 ? `${criteria.employeeMin}+` : `${criteria.employeeMin}–${criteria.employeeMax}`],
                  ["Person types", criteria.personTypes.map(t=>PERSON_TYPES.find(p=>p.id===t)?.label).join(", ") || "Any"],
                  ["Compensation", COMPENSATION_RANGES.find(r=>r.id===criteria.compensationRange)?.label ?? "Any"],
                  ["Sources", criteria.sources.join(", ")],
                  ["Max leads", String(criteria.maxLeads)],
                ].map(([k,v]) => (
                  <div key={k} className="grid grid-cols-2 gap-2 text-xs">
                    <span className="text-muted-foreground">{k}:</span>
                    <span className="text-foreground">{v}</span>
                  </div>
                ))}
              </div>
              {createMutation.isError && (
                <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />Failed to launch. Please try again.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/40 flex justify-between items-center shrink-0">
          <Button variant="ghost" onClick={() => step === 1 ? handleClose() : setStep(s => s - 1)} className="text-muted-foreground hover:text-foreground">
            {step === 1 ? <><X className="w-4 h-4 mr-1.5" />Cancel</> : <><ChevronLeft className="w-4 h-4 mr-1.5" />Back</>}
          </Button>
          {step < TOTAL_STEPS ? (
            <Button onClick={() => setStep(s => s + 1)} disabled={!canNext} className="bg-primary hover:bg-primary/90">
              Next <ChevronRight className="w-4 h-4 ml-1.5" />
            </Button>
          ) : (
            <Button onClick={() => createMutation.mutate(criteria)}
              disabled={createMutation.isPending || criteria.sources.length === 0 || criteria.personTypes.length === 0}
              className="bg-primary hover:bg-primary/90 px-6">
              {createMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Launching…</> : <><Sparkles className="w-4 h-4 mr-2" />Launch Lead Hunt</>}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Lead Profile Dialog ──────────────────────────────────────────────────────
function LeadProfileDialog({ item, listId, open, onClose, onDeleted }: {
  item: LeadListItem; listId: number; open: boolean; onClose: () => void; onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/lead-lists/${listId}/items/${item.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lead-list-items", listId] }); onDeleted(); onClose(); },
  });
  const [, navigate] = useLocation();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-card border-border/40 text-foreground max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary">{item.personName ? initials(item.personName) : "?"}</span>
            </div>
            <div>
              <p className="text-lg font-display font-bold text-foreground leading-tight">{item.personName}</p>
              {item.personNameAr && <p className="text-sm text-muted-foreground" dir="rtl">{item.personNameAr}</p>}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Role & Company */}
          <div className="p-4 rounded-xl bg-muted/40 border border-border/40 space-y-1">
            <p className="text-sm font-semibold text-foreground">{item.personTitle}</p>
            {item.companyName && <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" />{item.companyName}{item.companyNameAr && ` · ${item.companyNameAr}`}</p>}
            {item.seniority && <p className="text-xs text-muted-foreground capitalize">{item.seniority} · {item.department || ""}</p>}
          </div>

          {/* Company details */}
          <div className="grid grid-cols-2 gap-2">
            {item.industry && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Industry</p><p className="text-xs text-foreground font-medium">{item.industry}</p></div>}
            {item.city && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">City</p><p className="text-xs text-foreground font-medium">{item.city}</p></div>}
            {item.companyRevenue && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Revenue</p><p className="text-xs text-foreground font-medium">{item.companyRevenue}</p></div>}
            {item.companyEmployees && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Employees</p><p className="text-xs text-foreground font-medium">{item.companyEmployees}</p></div>}
            {item.crNumber && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">CR Number</p><p className="text-xs text-foreground font-medium">{item.crNumber}</p></div>}
            {item.ownershipPct && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Ownership</p><p className="text-xs text-foreground font-medium">{item.ownershipPct}%</p></div>}
            {item.nationality && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Nationality</p><p className="text-xs text-foreground font-medium">{item.nationality}</p></div>}
            {item.estimatedSalary && <div className="p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/15"><p className="text-xs text-amber-400/80 mb-0.5">Est. Salary</p><p className="text-xs text-amber-300 font-medium">${item.estimatedSalary.toLocaleString()}/yr</p></div>}
          </div>

          {/* Contact */}
          <div className="space-y-2">
            {item.phone && <a href={`tel:${item.phone}`} className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/15 text-sm text-emerald-300 hover:bg-emerald-500/15 transition-colors"><Phone className="w-4 h-4 shrink-0" />{item.phone}</a>}
            {item.email && <a href={`mailto:${item.email}`} className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-500/8 border border-primary/15 text-sm text-primary hover:bg-blue-500/15 transition-colors"><Mail className="w-4 h-4 shrink-0" />{item.email}</a>}
            {item.linkedin && <a href={item.linkedin.startsWith("http") ? item.linkedin : `https://${item.linkedin}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2.5 rounded-lg bg-sky-500/8 border border-sky-500/15 text-sm text-sky-300 hover:bg-sky-500/15 transition-colors"><Linkedin className="w-4 h-4 shrink-0" />View LinkedIn Profile</a>}
            {item.website && <a href={item.website.startsWith("http") ? item.website : `https://${item.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2.5 rounded-lg bg-violet-500/8 border border-violet-500/15 text-sm text-violet-300 hover:bg-violet-500/15 transition-colors"><Globe className="w-4 h-4 shrink-0" />{item.website.replace(/^https?:\/\//, "").split("/")[0]}</a>}
          </div>

          {/* Biography */}
          {item.biography && (
            <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Biography</p>
              <p className="text-xs text-foreground/80 leading-relaxed">{item.biography}</p>
            </div>
          )}

          {/* AI reasoning */}
          {item.aiReasoning && (
            <div className="p-3 rounded-xl bg-primary/5 border border-primary/15">
              <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3" />AI Reasoning</p>
              <p className="text-xs text-foreground/80 leading-relaxed">{item.aiReasoning}</p>
            </div>
          )}

          {/* Source + score */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex gap-2">
              {item.personType && PERSON_TYPE_BADGE[item.personType] && (
                <span className={`text-xs px-2 py-0.5 rounded-full border ${PERSON_TYPE_BADGE[item.personType].color}`}>{PERSON_TYPE_BADGE[item.personType].label}</span>
              )}
              {item.source && SOURCE_BADGE[item.source] && (
                <span className={`text-xs px-2 py-0.5 rounded-full border ${SOURCE_BADGE[item.source].color}`}>{SOURCE_BADGE[item.source].label}</span>
              )}
            </div>
            {(item.aiScore ?? item.matchScore) != null && (
              <span className={`text-sm font-bold ${(item.aiScore ?? item.matchScore ?? 0) >= 75 ? "text-emerald-400" : (item.aiScore ?? item.matchScore ?? 0) >= 50 ? "text-amber-400" : "text-muted-foreground"}`}>
                Score: {item.aiScore ?? item.matchScore}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-border/40">
            <Button size="sm" className="flex-1 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 gap-1.5"
              onClick={() => { onClose(); navigate(`/prospecting/person?name=${encodeURIComponent(item.personName || "")}&company=${encodeURIComponent(item.companyName || "")}`); }}>
              <Brain className="w-3.5 h-3.5" />Generate Intel Profile
            </Button>
            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1.5"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Remove
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Person Lead Card ─────────────────────────────────────────────────────────
function LeadCard({ item, listId, onDeleted }: { item: LeadListItem; listId: number; onDeleted: () => void }) {
  const [showProfile, setShowProfile] = useState(false);
  const score = item.aiScore ?? item.matchScore ?? 0;
  const typeBadge = item.personType ? PERSON_TYPE_BADGE[item.personType] : null;
  const srcBadge  = item.source     ? SOURCE_BADGE[item.source]           : null;
  const color = score >= 75 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-muted-foreground";
  const barColor = score >= 75 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-zinc-500";

  return (
    <>
      <Card
        className="bg-card/65 border-border/40 hover:border-white/25 transition-all duration-150 cursor-pointer group"
        onClick={() => setShowProfile(true)}>
        <CardContent className="py-4 px-5">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary">{item.personName ? initials(item.personName) : "?"}</span>
            </div>

            {/* Main info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2 flex-wrap">
                <p className="font-semibold text-foreground group-hover:text-primary transition-colors">{item.personName}</p>
                {item.personNameAr && <p className="text-sm text-muted-foreground" dir="rtl">{item.personNameAr}</p>}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                <span className="text-sm text-primary/90">{item.personTitle}</span>
                {item.companyName && <><span className="text-muted-foreground text-sm">at</span><span className="text-sm text-foreground/80">{item.companyName}</span></>}
              </div>

              {/* Company meta */}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                {item.industry && <span className="text-xs text-muted-foreground"><BarChart3 className="w-3 h-3 inline mr-0.5" />{item.industry}</span>}
                {item.city && <span className="text-xs text-muted-foreground"><MapPin className="w-3 h-3 inline mr-0.5" />{item.city}</span>}
                {item.companyEmployees && <span className="text-xs text-muted-foreground"><Users className="w-3 h-3 inline mr-0.5" />{item.companyEmployees} emp.</span>}
                {item.companyRevenue && <span className="text-xs text-muted-foreground"><TrendingUp className="w-3 h-3 inline mr-0.5" />{item.companyRevenue}</span>}
                {item.ownershipPct && <span className="text-xs text-muted-foreground">Owns {item.ownershipPct}%</span>}
                {item.seniority && <span className="text-xs text-muted-foreground capitalize">{item.seniority}</span>}
                {item.nationality && <span className="text-xs text-muted-foreground">{item.nationality}</span>}
                {item.crNumber && <span className="text-xs text-muted-foreground">CR: {item.crNumber}</span>}
              </div>

              {/* Contact preview */}
              <div className="flex flex-wrap gap-3 mt-2">
                {item.phone && <span className="flex items-center gap-1 text-xs text-emerald-400"><Phone className="w-3 h-3" />{item.phone}</span>}
                {item.email && <span className="flex items-center gap-1 text-xs text-primary"><Mail className="w-3 h-3" />{item.email}</span>}
                {item.linkedin && <span className="flex items-center gap-1 text-xs text-sky-400"><Linkedin className="w-3 h-3" />LinkedIn</span>}
              </div>

              {/* Biography */}
              {item.biography && (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-1">{item.biography}</p>
              )}
            </div>

            {/* Right: badges + score + view */}
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="flex flex-col gap-1 items-end">
                {typeBadge && <span className={`text-xs px-2 py-0.5 rounded-full border ${typeBadge.color}`}>{typeBadge.label}</span>}
                {srcBadge && <span className={`text-xs px-2 py-0.5 rounded-full border ${srcBadge.color}`}>{srcBadge.label}</span>}
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex flex-col items-end gap-1 cursor-default">
                      <span className={`text-lg font-display font-bold ${color}`}>{score}</span>
                      <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${score}%` }} />
                      </div>
                      {item.aiScore != null && <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Sparkles className="w-2.5 h-2.5" />AI</span>}
                    </div>
                  </TooltipTrigger>
                  {item.aiReasoning && (
                    <TooltipContent side="left" className="max-w-xs bg-card border-border/40 text-xs text-foreground">
                      <p className="font-semibold mb-1 text-primary">AI reasoning:</p>
                      <p>{item.aiReasoning}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
              <span className="text-xs text-primary/70 flex items-center gap-0.5 group-hover:text-primary transition-colors">
                <Eye className="w-3 h-3" />View
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {showProfile && (
        <LeadProfileDialog
          item={item}
          listId={listId}
          open={showProfile}
          onClose={() => setShowProfile(false)}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}

// ─── Retry Hunt Button ────────────────────────────────────────────────────────
function RetryHuntButton({ listId }: { listId: number }) {
  const qc = useQueryClient();
  const retryMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/lead-lists/${listId}/retry`, { method: "POST" });
      if (!r.ok) throw new Error("Retry failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lead-lists"] }); },
  });
  return (
    <Button size="sm" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}
      className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 shrink-0">
      {retryMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Retrying…</> : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Retry Hunt</>}
    </Button>
  );
}

// ─── List Detail View ─────────────────────────────────────────────────────────
function ListDetailView({ list, onBack }: { list: LeadList; onBack: () => void }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: items = [], isLoading, refetch } = useQuery<LeadListItem[]>({
    queryKey: ["lead-list-items", list.id],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/lead-lists/${list.id}/items`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: list.status === "running" ? 3000 : false,
  });

  const { data: freshList } = useQuery<LeadList>({
    queryKey: ["lead-list", list.id],
    queryFn: async () => { const r = await fetch(`${BASE}/api/lead-lists/${list.id}`); return r.json(); },
    refetchInterval: list.status === "running" ? 3000 : false,
    enabled: list.status === "running",
  });
  const currentList = freshList ?? list;

  const filtered = items.filter(item => {
    const q = search.toLowerCase();
    const ms = !search ||
      (item.personName || "").toLowerCase().includes(q) ||
      (item.personTitle || "").toLowerCase().includes(q) ||
      (item.companyName || "").toLowerCase().includes(q) ||
      (item.industry || "").toLowerCase().includes(q);
    const mt = !typeFilter || item.personType === typeFilter;
    const ms2 = !sourceFilter || item.source === sourceFilter;
    return ms && mt && ms2;
  });

  function downloadExport(fmt: string) { window.open(`${BASE}/api/lead-lists/${list.id}/export?format=${fmt}`, "_blank"); }
  const criteria = (() => { try { return JSON.parse(list.criteria || "{}") as LeadCriteria; } catch { return {} as Partial<LeadCriteria>; } })();

  return (
    <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onBack} className="text-muted-foreground hover:text-foreground px-2">
          <ChevronLeft className="w-4 h-4 mr-1" />Back
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-display font-bold text-foreground truncate">{list.name}</h2>
          <p className="text-sm text-muted-foreground">{new Date(list.createdAt).toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {statusBadge(currentList.status)}
          {currentList.status === "running" && (
            <Button variant="ghost" size="sm" onClick={() => { refetch(); qc.invalidateQueries({ queryKey: ["lead-list", list.id] }); }} className="text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30" size="sm">
                <Download className="w-4 h-4 mr-1.5" />Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-card border-border/40">
              <DropdownMenuItem onClick={() => downloadExport("csv")} className="gap-2 cursor-pointer"><FileText className="w-4 h-4 text-emerald-400" />CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadExport("excel")} className="gap-2 cursor-pointer"><FileSpreadsheet className="w-4 h-4 text-green-400" />Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadExport("json")} className="gap-2 cursor-pointer"><Braces className="w-4 h-4 text-primary" />JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Criteria badges */}
      <Card className="bg-card/65 border-border/40">
        <CardContent className="pt-3 pb-3">
          <div className="flex flex-wrap gap-1.5">
            {criteria.personTypes?.map(t => PERSON_TYPES.find(p=>p.id===t)?.label).filter(Boolean).map(l => (
              <Badge key={l} className="bg-primary/10 text-primary border-primary/20 border text-xs">{l}</Badge>
            ))}
            {criteria.industries?.slice(0,4).map(i => <Badge key={i} className="bg-violet-500/15 text-violet-300 border-violet-500/20 border text-xs">{i}</Badge>)}
            {criteria.cities?.slice(0,3).map(c => <Badge key={c} className="bg-blue-500/15 text-primary border-primary/20 border text-xs"><MapPin className="w-2.5 h-2.5 mr-0.5 inline" />{c}</Badge>)}
            {criteria.revenueRange && criteria.revenueRange !== "any" && <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/20 border text-xs">{REVENUE_RANGES.find(r=>r.id===criteria.revenueRange)?.label}</Badge>}
            {criteria.compensationRange && criteria.compensationRange !== "any" && <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/20 border text-xs">{COMPENSATION_RANGES.find(r=>r.id===criteria.compensationRange)?.label}</Badge>}
            <Badge className="bg-muted/40 text-muted-foreground border-border/40 border text-xs">Max {criteria.maxLeads ?? "?"} leads</Badge>
            <Badge className="bg-muted/40 text-muted-foreground border-border/40 border text-xs">{currentList.totalFound ?? 0} found</Badge>
          </div>
        </CardContent>
      </Card>

      {currentList.status === "running" && (
        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardContent className="py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center animate-pulse shrink-0">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground">AI is hunting leads…</p>
              <p className="text-sm text-muted-foreground">Scanning executives, owners, shareholders & board members — scoring with AI</p>
            </div>
          </CardContent>
        </Card>
      )}
      {currentList.status === "failed" && (
        <Card className="bg-red-500/5 border-red-500/20">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-300 font-medium">Lead hunt failed or was interrupted</p>
              <p className="text-xs text-muted-foreground mt-0.5">This can happen when the server restarts mid-hunt. Click Retry to run it again.</p>
            </div>
            <RetryHuntButton listId={currentList.id} />
          </CardContent>
        </Card>
      )}
      {currentList.status === "done" && items.length === 0 && (
        <Card className="bg-card/30 border-border/40">
          <CardContent className="py-12 text-center">
            <UserCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-foreground font-medium">No matching people found</p>
            <p className="text-sm text-muted-foreground mt-1">Try broadening your criteria — fewer required fields or more person types.</p>
          </CardContent>
        </Card>
      )}

      {items.length > 0 && (
        <>
          <div className="flex gap-2 items-center flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by name, title, company…" value={search}
                onChange={e => setSearch(e.target.value)} className="pl-9 bg-muted/40 border-border/40 text-foreground" />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="border-border/40 text-muted-foreground hover:text-foreground gap-2 shrink-0">
                  <Filter className="w-3.5 h-3.5" />
                  {typeFilter ? (PERSON_TYPE_BADGE[typeFilter]?.label ?? typeFilter) : "All Types"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-card border-border/40">
                <DropdownMenuItem onClick={() => setTypeFilter(null)} className="cursor-pointer">All Types</DropdownMenuItem>
                {PERSON_TYPES.map(p => <DropdownMenuItem key={p.id} onClick={() => setTypeFilter(p.id)} className="cursor-pointer">{p.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="border-border/40 text-muted-foreground hover:text-foreground gap-2 shrink-0">
                  <Filter className="w-3.5 h-3.5" />
                  {sourceFilter ? (SOURCE_BADGE[sourceFilter]?.label ?? sourceFilter) : "All Sources"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-card border-border/40">
                <DropdownMenuItem onClick={() => setSourceFilter(null)} className="cursor-pointer">All Sources</DropdownMenuItem>
                {SOURCES.map(s => <DropdownMenuItem key={s.id} onClick={() => setSourceFilter(s.id)} className="cursor-pointer">{s.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="text-sm text-muted-foreground shrink-0">{filtered.length} results</span>
          </div>

          <div className="space-y-2">
            {filtered.slice(0, 200).map(item => (
              <LeadCard key={item.id} item={item} listId={list.id}
                onDeleted={() => qc.invalidateQueries({ queryKey: ["lead-list-items", list.id] })} />
            ))}
            {filtered.length > 200 && <p className="text-center text-sm text-muted-foreground py-2">Showing 200 of {filtered.length}. Export to see full list.</p>}
          </div>
        </>
      )}

      {isLoading && <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 bg-muted/40 rounded-xl animate-pulse" />)}</div>}
    </div>
  );
}

// ─── ProsEngine Research Tab ──────────────────────────────────────────────────
interface SavedResearch {
  id: number; personName: string; company: string | null; title: string | null;
  linkedinUrl: string | null; intelligenceGoals: string | null;
  sellerContext: string | null; knownFacts: string | null;
  report: string | null; tags: string | null; notes: string | null;
  createdAt: string;
}

function ProsEngineTab() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: items = [], isLoading } = useQuery<SavedResearch[]>({
    queryKey: ["prosengine-research"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/person-intel/saved`); return r.json(); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/person-intel/saved/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prosengine-research"] }),
  });

  const confidenceColor = (c: string) =>
    c === "High" ? "bg-green-500/15 text-green-300 border-green-500/30" :
    c === "Medium" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
    "bg-red-500/15 text-red-300 border-red-500/30";

  if (isLoading) return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 bg-muted/40 rounded-2xl animate-pulse" />)}
    </div>
  );

  if (items.length === 0) return (
    <Card className="bg-card/30 border-border/40 border-dashed">
      <CardContent className="py-16 text-center">
        <Brain className="w-12 h-12 text-violet-400/30 mx-auto mb-4" />
        <p className="text-foreground font-semibold mb-1">No intelligence profiles yet</p>
        <p className="text-muted-foreground text-sm mb-4">Generate a Person Intelligence profile and save it to see it here.</p>
        <Button onClick={() => navigate("/prospecting/person")}
          className="bg-violet-600 hover:bg-violet-700 text-foreground">
          <Brain className="w-4 h-4 mr-2" />Open Person Intelligence
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
      {items.map(item => {
        const report = (() => { try { return JSON.parse(item.report || "{}"); } catch { return {}; } })();
        const goals = (() => { try { return JSON.parse(item.intelligenceGoals || "[]") as string[]; } catch { return []; } })();
        const sellerCtx = (() => { try { return JSON.parse(item.sellerContext || "{}"); } catch { return {}; } })();
        const confidence = report?.intelligence_notes?.confidence_level;
        const wealth = report?.wealth_profile?.estimated_net_worth;
        const company = report?.company_analysis;
        const isOpen = expanded === item.id;

        return (
          <Card key={item.id} className="bg-card/75 border-white/8 overflow-hidden">
            <div className="p-5 flex items-start gap-4 cursor-pointer" onClick={() => setExpanded(isOpen ? null : item.id)}>
              <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 flex-wrap">
                  <p className="text-base font-display font-semibold text-foreground">{item.personName}</p>
                  {confidence && (
                    <Badge className={`border text-xs ${confidenceColor(confidence)}`}>
                      <Shield className="w-3 h-3 mr-1" />{confidence}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                  {item.title && <span className="text-xs text-muted-foreground">{item.title}</span>}
                  {item.company && <span className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="w-3 h-3" />{item.company}</span>}
                  {wealth && <span className="text-xs text-emerald-400 flex items-center gap-1"><DollarSign className="w-3 h-3" />{wealth}</span>}
                </div>
                {sellerCtx.companyName && (
                  <p className="text-xs text-muted-foreground/70 mt-1">Context: {sellerCtx.companyName} · {sellerCtx.objective || "—"}</p>
                )}
                {goals.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {goals.slice(0, 4).map((g: string) => (
                      <span key={g} className="text-xs px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/15 text-violet-300">{g}</span>
                    ))}
                    {goals.length > 4 && <span className="text-xs text-muted-foreground">+{goals.length - 4} more</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </div>

            {isOpen && (
              <div className="border-t border-white/8 bg-white/2 p-5 space-y-5">
                {/* Approach Strategy */}
                {report?.approach_strategy?.recommended_approach && (
                  <div>
                    <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2 flex items-center gap-1"><Target className="w-3 h-3" />Approach Strategy</p>
                    <p className="text-sm text-foreground/85 leading-relaxed bg-primary/5 border border-primary/15 rounded-xl p-4">{report.approach_strategy.recommended_approach}</p>
                    {(report.approach_strategy.best_channel || report.approach_strategy.best_timing) && (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {report.approach_strategy.best_channel && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Best Channel</p><p className="text-xs font-medium text-foreground">{report.approach_strategy.best_channel}</p></div>}
                        {report.approach_strategy.best_timing && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Best Timing</p><p className="text-xs font-medium text-foreground">{report.approach_strategy.best_timing}</p></div>}
                      </div>
                    )}
                    {report.approach_strategy.opening_angle && <div className="mt-2 p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Opening Angle</p><p className="text-xs text-foreground/80">{report.approach_strategy.opening_angle}</p></div>}
                    {report.approach_strategy.value_proposition && <div className="mt-2 p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Value Proposition</p><p className="text-xs text-foreground/80">{report.approach_strategy.value_proposition}</p></div>}
                    {report.approach_strategy.cultural_notes && <div className="mt-2 p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/15"><p className="text-xs text-amber-400 mb-0.5">Cultural Notes</p><p className="text-xs text-foreground/80">{report.approach_strategy.cultural_notes}</p></div>}
                    {report.approach_strategy.conversation_starters?.length > 0 && <div className="mt-2"><p className="text-xs text-muted-foreground mb-1.5">Conversation Starters</p><div className="flex flex-wrap gap-1.5">{report.approach_strategy.conversation_starters.map((s: string, i: number) => <span key={i} className="text-xs px-2.5 py-1 rounded-lg bg-muted/40 border border-border/40 text-foreground/80">{s}</span>)}</div></div>}
                  </div>
                )}

                {/* Wealth Profile */}
                {report?.wealth_profile && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1"><DollarSign className="w-3 h-3" />Wealth & Financial Profile</p>
                    <div className="grid grid-cols-2 gap-2">
                      {report.wealth_profile.estimated_net_worth && <div className="p-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/15"><p className="text-xs text-emerald-400/70 mb-0.5">Net Worth</p><p className="text-sm font-bold text-emerald-300">{report.wealth_profile.estimated_net_worth}</p></div>}
                      {report.wealth_profile.income_estimate && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Annual Income</p><p className="text-sm font-bold text-foreground">{report.wealth_profile.income_estimate}</p></div>}
                    </div>
                    {report.wealth_profile.wealth_sources?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{report.wealth_profile.wealth_sources.map((s: string, i: number) => <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">{s}</span>)}</div>}
                    {report.wealth_profile.assets && <p className="text-xs text-foreground/70 mt-2 p-2.5 bg-muted/40 rounded-lg border border-white/8"><span className="text-muted-foreground">Assets: </span>{report.wealth_profile.assets}</p>}
                    {report.wealth_profile.investments && <p className="text-xs text-foreground/70 mt-1.5 p-2.5 bg-muted/40 rounded-lg border border-white/8"><span className="text-muted-foreground">Investments: </span>{report.wealth_profile.investments}</p>}
                  </div>
                )}

                {/* Career */}
                {report?.career?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Briefcase className="w-3 h-3" />Career History</p>
                    <div className="space-y-2">
                      {report.career.slice(0, 4).map((job: { title: string; company: string; period: string; description?: string }, i: number) => (
                        <div key={i} className="p-2.5 rounded-lg bg-muted/40 border border-white/8">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-foreground">{job.title}</p>
                            <span className="text-xs text-muted-foreground shrink-0">{job.period}</span>
                          </div>
                          <p className="text-xs text-orange-400">{job.company}</p>
                          {job.description && <p className="text-xs text-foreground/60 mt-1">{job.description}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Company Analysis */}
                {company && (
                  <div>
                    <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2 flex items-center gap-1"><Building2 className="w-3 h-3" />Company Analysis</p>
                    <div className="space-y-2">
                      {company.performance && <div className="p-2.5 rounded-lg bg-blue-500/8 border border-primary/15"><p className="text-xs font-medium text-primary mb-0.5">{company.name || item.company}</p><p className="text-xs text-foreground/70">{company.performance}</p></div>}
                      <div className="grid grid-cols-2 gap-2">
                        {company.revenue_estimate && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Revenue</p><p className="text-xs font-medium text-foreground">{company.revenue_estimate}</p></div>}
                        {company.employees && <div className="p-2.5 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-0.5">Employees</p><p className="text-xs font-medium text-foreground">{company.employees}</p></div>}
                      </div>
                      {company.market_position && <p className="text-xs text-foreground/70 p-2.5 bg-muted/40 rounded-lg border border-white/8"><span className="text-muted-foreground">Market: </span>{company.market_position}</p>}
                      {company.recent_developments && <p className="text-xs text-foreground/70 p-2.5 bg-muted/40 rounded-lg border border-white/8"><span className="text-muted-foreground">Recent: </span>{company.recent_developments}</p>}
                    </div>
                  </div>
                )}

                {/* Personal Profile */}
                {report?.personal_profile && (report.personal_profile.interests?.length > 0 || report.personal_profile.personality_traits?.length > 0 || report.personal_profile.board_memberships?.length > 0) && (
                  <div>
                    <p className="text-xs font-semibold text-pink-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Heart className="w-3 h-3" />Personal Profile</p>
                    {report.personal_profile.interests?.length > 0 && <div className="mb-2"><p className="text-xs text-muted-foreground mb-1.5">Interests</p><div className="flex flex-wrap gap-1.5">{report.personal_profile.interests.map((i: string, idx: number) => <span key={idx} className="text-xs px-2 py-0.5 rounded-lg bg-pink-500/10 border border-pink-500/20 text-pink-300">{i}</span>)}</div></div>}
                    {report.personal_profile.personality_traits?.length > 0 && <div className="mb-2"><p className="text-xs text-muted-foreground mb-1.5">Traits</p><div className="flex flex-wrap gap-1.5">{report.personal_profile.personality_traits.map((t: string, idx: number) => <span key={idx} className="text-xs px-2 py-0.5 rounded-full bg-muted/40 border border-border/40 text-foreground/80">{t}</span>)}</div></div>}
                    {report.personal_profile.board_memberships?.length > 0 && <div><p className="text-xs text-muted-foreground mb-1">Board Memberships</p><ul className="space-y-0.5">{report.personal_profile.board_memberships.map((b: string, i: number) => <li key={i} className="text-xs text-foreground/70">• {b}</li>)}</ul></div>}
                  </div>
                )}

                {/* Intelligence Notes */}
                {report?.intelligence_notes?.caveats && (
                  <div className="p-3 rounded-lg bg-amber-500/8 border border-amber-500/15 flex gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300/80">{report.intelligence_notes.caveats}</p>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="border-border/40 text-foreground hover:bg-muted/40 text-xs gap-1.5"
                    onClick={() => navigate("/prospecting/person")}>
                    <Brain className="w-3.5 h-3.5" />New Profile
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs gap-1.5"
                    onClick={() => deleteMutation.mutate(item.id)}
                    disabled={deleteMutation.isPending}>
                    {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}Delete
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LeadsPage() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"hunts" | "prosengine">("hunts");
  const [showWizard, setShowWizard] = useState(false);
  const [selectedList, setSelectedList] = useState<LeadList | null>(null);
  const qc = useQueryClient();

  const { data: lists = [], isLoading, refetch } = useQuery<LeadList[]>({
    queryKey: ["lead-lists"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/lead-lists`); return r.json(); },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (Array.isArray(data) && data.some((l: LeadList) => l.status === "running")) return 4000;
      return false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { const r = await fetch(`${BASE}/api/lead-lists/${id}`, { method: "DELETE" }); if (!r.ok) throw new Error("Failed"); },
    onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ["lead-lists"] }); if (selectedList?.id === id) setSelectedList(null); },
  });

  useEffect(() => {
    if (selectedList) {
      const updated = lists.find(l => l.id === selectedList.id);
      if (updated) setSelectedList(updated);
    }
  }, [lists]);

  const runningList = lists.find(l => l.status === "running");

  if (selectedList) return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <ListDetailView key={selectedList.id} list={selectedList} onBack={() => setSelectedList(null)} />
    </div>
  );

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground tracking-tight">Lead Genome</h1>
          <p className="text-muted-foreground mt-1">Saved leads + lead lists generated by your engines (Lead Factory, ProsEngine, Harvest AI)</p>
          {/* Live saved-leads bucket — backed by /api/lead-genome/* */}
          <div className="mt-4"><LeadGenomePanel /></div>
        </div>
        {tab === "hunts" && (
          <Button onClick={() => setShowWizard(true)} className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 shrink-0">
            <Plus className="w-4 h-4 mr-2" />New Lead Hunt
          </Button>
        )}
        {tab === "prosengine" && (
          <Button onClick={() => navigate("/prospecting/person")} className="bg-violet-600 hover:bg-violet-700 shadow-lg shadow-violet-500/20 shrink-0">
            <Brain className="w-4 h-4 mr-2" />New Profile
          </Button>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-muted/40 rounded-xl border border-white/8 w-fit">
        <button onClick={() => setTab("hunts")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "hunts" ? "bg-primary/20 text-foreground border border-primary/30" : "text-muted-foreground hover:text-foreground"}`}>
          <Target className="w-4 h-4" />AI Lead Hunts
        </button>
        <button onClick={() => setTab("prosengine")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "prosengine" ? "bg-violet-500/20 text-foreground border border-violet-500/30" : "text-muted-foreground hover:text-foreground"}`}>
          <Brain className="w-4 h-4" />ProsEngine Research
        </button>
      </div>

      {/* ProsEngine Research Tab */}
      {tab === "prosengine" && <ProsEngineTab />}

      {tab === "hunts" && runningList && (
        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardContent className="py-4 flex items-center gap-4">
            <Loader2 className="w-5 h-5 text-amber-400 animate-spin shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Hunt in progress: <span className="text-amber-300">{runningList.name}</span></p>
              <p className="text-xs text-muted-foreground">Finding people + running AI scoring — auto-refreshing</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-muted-foreground shrink-0"><RefreshCw className="w-3.5 h-3.5" /></Button>
          </CardContent>
        </Card>
      )}

      {tab === "hunts" && (
        isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-52 bg-muted/40 rounded-2xl animate-pulse" />)}
        </div>
        ) : lists.length === 0 ? (
        <Card className="bg-card/30 border-border/40 border-dashed">
          <CardContent className="py-20 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <UserCircle className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="text-xl font-display font-bold text-foreground">No lead hunts yet</p>
              <p className="text-muted-foreground mt-1 max-w-sm">Launch an AI Lead Hunt to find executives, owners, shareholders & board members matching your exact criteria.</p>
            </div>
            <Button onClick={() => setShowWizard(true)} className="bg-primary hover:bg-primary/90 mt-2">
              <Sparkles className="w-4 h-4 mr-2" />Start First Lead Hunt
            </Button>
          </CardContent>
        </Card>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {lists.map(list => {
            const criteria = (() => { try { return JSON.parse(list.criteria || "{}") as LeadCriteria; } catch { return {} as Partial<LeadCriteria>; } })();
            return (
              <Card key={list.id}
                className="bg-card/65 border-border/40 hover:border-white/25 transition-all duration-200 cursor-pointer group hover:-translate-y-0.5"
                onClick={() => setSelectedList(list)}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base font-display font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2">{list.name}</CardTitle>
                    {statusBadge(list.status)}
                  </div>
                  <CardDescription className="text-xs">{new Date(list.createdAt).toLocaleDateString("en-US", { year:"numeric", month:"short", day:"numeric" })}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="flex items-center gap-2">
                    <UserCircle className="w-5 h-5 text-primary shrink-0" />
                    <span className="text-2xl font-display font-bold text-foreground">{(list.totalFound ?? 0).toLocaleString()}</span>
                    <span className="text-sm text-muted-foreground">leads found</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 min-h-6">
                    {(criteria.personTypes ?? []).map(t => PERSON_TYPES.find(p=>p.id===t)?.label).filter(Boolean).slice(0,3).map(l => (
                      <Badge key={l} className="bg-primary/10 text-primary border-primary/20 border text-xs">{l}</Badge>
                    ))}
                    {(criteria.industries ?? []).slice(0,2).map(i => <Badge key={i} className="bg-violet-500/10 text-violet-300 border-violet-500/20 border text-xs">{i}</Badge>)}
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-border/30">
                    <div className="flex flex-wrap gap-1">
                      {(criteria.sources ?? []).map(s => SOURCE_BADGE[s] && (
                        <span key={s} className={`text-xs px-1.5 py-0.5 rounded border ${SOURCE_BADGE[s].color}`}>{SOURCE_BADGE[s].label}</span>
                      ))}
                    </div>
                    <Button variant="ghost" size="sm"
                      className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors h-7 w-7 p-0 shrink-0"
                      title="Delete hunt"
                      onClick={e => { e.stopPropagation(); if (confirm("Delete this lead hunt and all its leads?")) deleteMutation.mutate(list.id); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        )
      )}
      <WizardModal open={showWizard} onClose={() => setShowWizard(false)} />
    </div>
  );
}
