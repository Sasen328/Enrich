import { useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, Building2, Loader2, Search, Globe, Phone, Mail, MapPin,
  DollarSign, Users, AlertCircle, ChevronDown, ChevronUp, Sparkles,
  CheckCircle2, BarChart3, Shield, Briefcase, TrendingUp, Target,
  Save, Trash2, Copy, Check, Calendar, Hash, Layers, Network,
  Crown, UserCheck, Award, RefreshCw, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ProsEngineChat from "@/components/ProsEngineChat";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ─────────────────────────────────────────────────────────────────────
interface SellerContext { companyName: string; product: string; objectives: string[]; }
interface WizardState {
  companyName: string; website: string; crNumber: string; city: string;
  sellerContext: SellerContext; goals: string[]; knownFacts: string;
}

interface CompanyProfile {
  nameEn?: string; nameAr?: string; legalForm?: string; legalFormAr?: string;
  crNumber?: string; founded?: string; city?: string; address?: string;
  website?: string; phone?: string; email?: string; industry?: string;
  mainActivity?: string; mainActivityAr?: string;
}
interface CompanyFinancials {
  revenueEstimate?: string; revenueRange?: string; revenueRationale?: string;
  employeeCount?: string; paidUpCapital?: string; profitabilityIndicator?: string;
  growthSignals?: string[]; recentFinancialNews?: string;
}
interface CompanyOwnership {
  structure?: string; isPubliclyListed?: boolean; stockExchange?: string; ticker?: string;
  shareholders?: Array<{ nameEn?: string; nameAr?: string; ownershipPct?: string; nationality?: string; type?: string }>;
}
interface CompanyLeadership {
  ceo?: { nameEn?: string; nameAr?: string; title?: string };
  boardChairman?: { nameEn?: string; nameAr?: string };
  executives?: Array<{ nameEn?: string; nameAr?: string; title?: string }>;
  boardMembers?: Array<{ nameEn?: string; nameAr?: string; role?: string }>;
}
interface CompanyOperations {
  activities?: string[]; products?: string[]; keyCients?: string[];
  subsidiaries?: string[]; geographicPresence?: string[];
}
interface CompanyMarket {
  marketPosition?: string; marketShare?: string;
  competitors?: string[]; strengths?: string[]; weaknesses?: string[]; opportunities?: string[];
}
interface CompanyApproach {
  bestChannel?: string; bestTiming?: string; entryPoint?: string; valueProp?: string;
  openingAngle?: string; potentialObjections?: string[]; culturalNotes?: string; sampleMessage?: string;
}
interface CompanyReport {
  profile?: CompanyProfile; financials?: CompanyFinancials; ownership?: CompanyOwnership;
  leadership?: CompanyLeadership; operations?: CompanyOperations; market?: CompanyMarket;
  approach?: CompanyApproach; news?: Array<{ title?: string; date?: string; summary?: string; source?: string }>;
  intelligence?: { confidenceScore?: number; dataQuality?: string; verifiedFacts?: string[]; estimatedFacts?: string[]; caveats?: string; dataSources?: string[] };
  executiveSummary?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const INTELLIGENCE_GOALS = [
  { id: "profile",    icon: Building2,   label: "Company Profile",         desc: "CR, legal form, address, contacts, activities" },
  { id: "financials", icon: DollarSign,  label: "Financial Intelligence",  desc: "Revenue, capital, employees, growth signals" },
  { id: "ownership",  icon: Network,     label: "Ownership & Shareholders",desc: "Shareholder names, percentages, structure" },
  { id: "leadership", icon: Crown,       label: "Leadership & Board",      desc: "CEO, executives, board with bilingual names" },
  { id: "market",     icon: BarChart3,   label: "Market Intelligence",     desc: "Competitors, position, strengths, opportunities" },
  { id: "approach",   icon: Target,      label: "B2B Approach Strategy",   desc: "Entry point, value prop, opening message" },
];

const OBJECTIVES = [
  "Book a meeting", "Get a referral intro", "Pitch a proposal",
  "Close a deal", "Build a relationship", "Conduct due diligence", "Partnership",
];

const LOADING_MSGS = [
  "Stealth-browsing company website…",
  "Querying Saudi commercial registry…",
  "Searching for ownership structure…",
  "Identifying executives & board members…",
  "Analysing market position & competitors…",
  "Estimating revenue & financial profile…",
  "Cross-referencing multiple intelligence sources…",
  "Building approach strategy…",
  "Compiling intelligence dossier…",
];

const DEFAULT_WIZARD: WizardState = {
  companyName: "", website: "", crNumber: "", city: "",
  sellerContext: { companyName: "", product: "", objectives: [] },
  goals: ["profile", "financials", "ownership", "leadership", "market", "approach"],
  knownFacts: "",
};

// ─── Utility Components ────────────────────────────────────────────────────────
function Section({ title, icon: Icon, color = "text-primary", badge, children, defaultOpen = true }: {
  title: string; icon: React.FC<{ className?: string }>; color?: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="bg-card/60 border-white/8">
      <button className="w-full px-5 py-4 flex items-center gap-3" onClick={() => setOpen(!open)}>
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-sm font-semibold text-white">{title}</span>
        {badge && <Badge className="bg-white/5 text-white/60 border-white/10 border text-xs ml-1">{badge}</Badge>}
        <div className="ml-auto">{open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}</div>
      </button>
      {open && <CardContent className="px-5 pb-5 pt-0">{children}</CardContent>}
    </Card>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-white shrink-0"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}

function InfoRow({ label, value, copyable }: { label: string; value?: string | null; copyable?: boolean }) {
  if (!value || value === "null" || value === "Not found" || value === "Unknown") return null;
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
      <span className="text-xs text-white flex-1">{value}</span>
      {copyable && <CopyBtn text={value} />}
    </div>
  );
}

function Tag({ text, color = "bg-primary/10 text-primary border-primary/20" }: { text: string; color?: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border ${color}`}>{text}</span>;
}

const STEP_LABELS = ["Company", "Your Context", "Goals", "Known Facts", "Generate"];
function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-6">
      {STEP_LABELS.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <div key={label} className="flex items-center gap-1.5 flex-1">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all
              ${done ? "bg-primary text-white" : active ? "bg-primary/20 text-primary border border-primary/50" : "bg-white/5 text-muted-foreground border border-white/10"}`}>
              {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx}
            </div>
            <span className={`text-xs hidden sm:block ${active ? "text-white font-medium" : "text-muted-foreground"}`}>{label}</span>
            {i < STEP_LABELS.length - 1 && <div className={`flex-1 h-px ${done ? "bg-primary/40" : "bg-white/10"}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function CompanyIntelPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [wizard, setWizard] = useState<WizardState>(DEFAULT_WIZARD);
  const [report, setReport] = useState<CompanyReport | null>(null);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [saved, setSaved] = useState(false);

  const profileMutation = useMutation({
    mutationFn: async () => {
      const interval = setInterval(() => setLoadingMsgIdx(i => (i + 1) % LOADING_MSGS.length), 3500);
      try {
        const resp = await fetch(`${BASE}/api/company-intel/profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyName: wizard.companyName.trim(),
            website: wizard.website.trim() || undefined,
            crNumber: wizard.crNumber.trim() || undefined,
            city: wizard.city.trim() || undefined,
            sellerContext: wizard.sellerContext.companyName ? wizard.sellerContext : undefined,
            intelligenceGoals: wizard.goals,
            knownFacts: wizard.knownFacts.trim() || undefined,
          }),
          signal: AbortSignal.timeout(180000),
        });
        if (!resp.ok) throw new Error("Failed to generate report");
        return await resp.json() as CompanyReport;
      } finally {
        clearInterval(interval);
      }
    },
    onSuccess: (data) => { setReport(data); setStep(6); setSaved(false); },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const resp = await fetch(`${BASE}/api/company-intel/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: wizard.companyName,
          website: wizard.website || undefined,
          crNumber: wizard.crNumber || undefined,
          city: wizard.city || undefined,
          sellerContext: wizard.sellerContext.companyName ? wizard.sellerContext : undefined,
          intelligenceGoals: wizard.goals,
          knownFacts: wizard.knownFacts || undefined,
          report,
        }),
      });
      if (!resp.ok) throw new Error("Save failed");
      return resp.json();
    },
    onSuccess: () => { setSaved(true); void qc.invalidateQueries({ queryKey: ["company-intel-saved"] }); },
  });

  const wiz = (k: keyof WizardState, v: WizardState[keyof WizardState]) => setWizard(w => ({ ...w, [k]: v }));
  const toggleGoal = (id: string) => wiz("goals", wizard.goals.includes(id) ? wizard.goals.filter(g => g !== id) : [...wizard.goals, id]);
  const toggleObj = (o: string) => wiz("sellerContext", { ...wizard.sellerContext, objectives: wizard.sellerContext.objectives.includes(o) ? wizard.sellerContext.objectives.filter(x => x !== o) : [...wizard.sellerContext.objectives, o] });

  // ─── Step 5: Loading ─────────────────────────────────────────────────────────
  if (step === 5 || profileMutation.isPending) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
        <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Building2 className="w-8 h-8 text-primary animate-pulse" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-display font-bold text-white mb-2">Building Intelligence Dossier</h2>
          <p className="text-muted-foreground text-sm mb-6">Running {wizard.goals.length} parallel research streams on {wizard.companyName}</p>
        </div>
        <div className="w-full max-w-md">
          <div className="bg-card/60 border border-white/10 rounded-xl p-4 flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
            <p className="text-sm text-white/80 transition-all">{LOADING_MSGS[loadingMsgIdx]}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 justify-center">
            {wizard.goals.map(g => {
              const goal = INTELLIGENCE_GOALS.find(x => x.id === g);
              return goal ? <Badge key={g} className="bg-primary/10 text-primary border-primary/20 text-xs">{goal.label}</Badge> : null;
            })}
          </div>
        </div>
        {profileMutation.isError && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>Research failed — please try again</span>
          </div>
        )}
      {/* ProsEngine Chat — embedded after research */}
      <div className="mt-8">
        <ProsEngineChat contextCompany={wizard.companyName} reportType="company" />
      </div>
    </div>
    );
  }

  // ─── Step 6: Report ──────────────────────────────────────────────────────────
  if (step === 6 && report) {
    const p = report.profile || {};
    const f = report.financials || {};
    const o = report.ownership || {};
    const l = report.leadership || {};
    const ops = report.operations || {};
    const m = report.market || {};
    const a = report.approach || {};
    const intel = report.intelligence || {};
    const confidenceColor = intel.confidenceScore != null
      ? intel.confidenceScore >= 70 ? "text-emerald-400" : intel.confidenceScore >= 40 ? "text-amber-400" : "text-red-400"
      : "text-muted-foreground";

    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <Button variant="ghost" size="sm" onClick={() => { setStep(1); setReport(null); setWizard(DEFAULT_WIZARD); }}
            className="text-muted-foreground hover:text-white shrink-0">
            <ArrowLeft className="w-4 h-4 mr-1" /> New
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-display font-bold text-white">{p.nameEn || wizard.companyName}</h1>
            {p.nameAr && <p className="text-sm text-muted-foreground mt-0.5 font-arabic">{p.nameAr}</p>}
            <div className="flex flex-wrap gap-2 mt-2">
              {p.legalForm && <Tag text={p.legalForm} />}
              {p.industry && <Tag text={p.industry} color="bg-cyan-500/10 text-cyan-300 border-cyan-500/20" />}
              {p.city && <Tag text={p.city} color="bg-amber-500/10 text-amber-300 border-amber-500/20" />}
              {o.isPubliclyListed && <Tag text="Publicly Listed" color="bg-green-500/10 text-green-300 border-green-500/20" />}
              {intel.dataQuality && <Tag text={`Quality: ${intel.dataQuality}`} color={intel.dataQuality === "high" ? "bg-green-500/10 text-green-300 border-green-500/20" : "bg-amber-500/10 text-amber-300 border-amber-500/20"} />}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="outline" className="border-white/10 text-white/70 hover:text-white"
              onClick={() => { setStep(1); setReport(null); }}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Redo
            </Button>
            <Button size="sm" variant={saved ? "default" : "outline"}
              className={saved ? "bg-emerald-600 hover:bg-emerald-700" : "border-primary/30 text-primary hover:bg-primary/10"}
              onClick={() => !saved && saveMutation.mutate()}
              disabled={saved || saveMutation.isPending}>
              {saved ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Saved</> : saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Save className="w-3.5 h-3.5 mr-1" /> Save</>}
            </Button>
          </div>
        </div>

        {/* Executive Summary */}
        {report.executiveSummary && (
          <Card className="bg-gradient-to-br from-primary/10 to-cyan-500/5 border-primary/20">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-white">Executive Summary</span>
                {intel.confidenceScore != null && (
                  <span className={`ml-auto text-xs font-bold ${confidenceColor}`}>Confidence: {intel.confidenceScore}%</span>
                )}
              </div>
              <p className="text-sm text-white/85 leading-relaxed">{report.executiveSummary}</p>
            </CardContent>
          </Card>
        )}

        {/* Company Profile */}
        <Section title="Company Profile" icon={Building2} color="text-cyan-400">
          <div className="space-y-0.5">
            <InfoRow label="Legal Form" value={p.legalForm} />
            <InfoRow label="Arabic Form" value={p.legalFormAr} />
            <InfoRow label="CR Number" value={p.crNumber} copyable />
            <InfoRow label="Founded" value={p.founded} />
            <InfoRow label="City" value={p.city} />
            <InfoRow label="Address" value={p.address} />
            <InfoRow label="Industry" value={p.industry} />
            <InfoRow label="Main Activity" value={p.mainActivity} />
            <InfoRow label="النشاط الرئيسي" value={p.mainActivityAr} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {p.website && <a href={p.website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/80 hover:text-white hover:bg-white/10 transition-colors"><Globe className="w-3.5 h-3.5" /> {p.website}</a>}
            {p.phone && <a href={`tel:${p.phone}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/80 hover:text-white transition-colors"><Phone className="w-3.5 h-3.5" /> {p.phone}</a>}
            {p.email && <a href={`mailto:${p.email}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/80 hover:text-white transition-colors"><Mail className="w-3.5 h-3.5" /> {p.email}</a>}
          </div>
        </Section>

        {/* Financial Intelligence */}
        {wizard.goals.includes("financials") && (
          <Section title="Financial Intelligence" icon={DollarSign} color="text-emerald-400">
            <div className="grid grid-cols-2 gap-3 mb-4">
              {f.revenueEstimate && <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Revenue Estimate</p><p className="text-sm font-bold text-emerald-400">{f.revenueEstimate}</p></div>}
              {f.employeeCount && <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Employees</p><p className="text-sm font-bold text-blue-400">{f.employeeCount}</p></div>}
              {f.paidUpCapital && <div className="bg-purple-500/5 border border-purple-500/15 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Paid-up Capital</p><p className="text-sm font-bold text-purple-400">{f.paidUpCapital}</p></div>}
              {f.profitabilityIndicator && f.profitabilityIndicator !== "Unknown" && <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Profitability</p><p className="text-sm font-bold text-amber-400">{f.profitabilityIndicator}</p></div>}
            </div>
            {f.revenueRationale && <p className="text-xs text-muted-foreground italic mb-3">{f.revenueRationale}</p>}
            {f.growthSignals && f.growthSignals.length > 0 && (
              <div><p className="text-xs font-semibold text-white mb-2">Growth Signals</p>
                <div className="space-y-1">{f.growthSignals.map((s, i) => <div key={i} className="flex items-start gap-2 text-xs text-white/80"><TrendingUp className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />{s}</div>)}</div>
              </div>
            )}
          </Section>
        )}

        {/* Ownership */}
        {wizard.goals.includes("ownership") && (
          <Section title="Ownership & Shareholders" icon={Network} color="text-violet-400">
            {o.structure && <p className="text-xs text-muted-foreground mb-3">Structure: <span className="text-white">{o.structure}</span></p>}
            {o.isPubliclyListed && <div className="flex gap-3 mb-3">
              {o.stockExchange && <Tag text={`Listed: ${o.stockExchange}`} color="bg-green-500/10 text-green-300 border-green-500/20" />}
              {o.ticker && <Tag text={`Ticker: ${o.ticker}`} color="bg-green-500/10 text-green-300 border-green-500/20" />}
            </div>}
            {o.shareholders && o.shareholders.length > 0 ? (
              <div className="space-y-2">
                {o.shareholders.map((sh, i) => (
                  <div key={i} className="flex items-center gap-3 bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                    <div className="w-8 h-8 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-xs font-bold text-violet-400">{sh.ownershipPct?.replace("%", "") || "?"}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white">{sh.nameEn || "Unknown"}</p>
                      {sh.nameAr && <p className="text-[10px] text-muted-foreground font-arabic">{sh.nameAr}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {sh.ownershipPct && <Tag text={sh.ownershipPct} color="bg-violet-500/10 text-violet-300 border-violet-500/20" />}
                      {sh.nationality && <Tag text={sh.nationality} color="bg-white/5 text-white/50 border-white/10" />}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-muted-foreground">No shareholder data found</p>}
          </Section>
        )}

        {/* Leadership */}
        {wizard.goals.includes("leadership") && (
          <Section title="Leadership & Board" icon={Crown} color="text-amber-400">
            {l.ceo && (l.ceo.nameEn || l.ceo.nameAr) && (
              <div className="mb-3 bg-amber-500/5 border border-amber-500/15 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1"><Award className="w-3.5 h-3.5 text-amber-400" /><span className="text-xs font-bold text-amber-400">{l.ceo.title || "CEO"}</span></div>
                <p className="text-sm font-semibold text-white">{l.ceo.nameEn}</p>
                {l.ceo.nameAr && <p className="text-xs text-muted-foreground font-arabic">{l.ceo.nameAr}</p>}
              </div>
            )}
            {l.boardChairman && (l.boardChairman.nameEn || l.boardChairman.nameAr) && (
              <div className="mb-3 bg-primary/5 border border-primary/15 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1"><Crown className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-bold text-primary">Board Chairman</span></div>
                <p className="text-sm font-semibold text-white">{l.boardChairman.nameEn}</p>
                {l.boardChairman.nameAr && <p className="text-xs text-muted-foreground font-arabic">{l.boardChairman.nameAr}</p>}
              </div>
            )}
            {l.executives && l.executives.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-white mb-2">Key Executives</p>
                <div className="space-y-1.5">
                  {l.executives.map((ex, i) => (
                    <div key={i} className="flex items-center gap-2 bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                      <UserCheck className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0"><p className="text-xs font-medium text-white">{ex.nameEn}</p>{ex.nameAr && <p className="text-[10px] text-muted-foreground font-arabic">{ex.nameAr}</p>}</div>
                      {ex.title && <Tag text={ex.title} color="bg-white/5 text-white/60 border-white/10" />}
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 shrink-0"
                        onClick={() => navigate(`/prospecting/person?name=${encodeURIComponent(ex.nameEn || "")}&company=${encodeURIComponent(wizard.companyName)}&title=${encodeURIComponent(ex.title || "")}&source=company-intel`)}>
                        Profile
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {l.boardMembers && l.boardMembers.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-white mb-2">Board Members</p>
                <div className="space-y-1.5">
                  {l.boardMembers.map((bm, i) => (
                    <div key={i} className="flex items-center gap-2 bg-white/3 border border-white/8 rounded-lg px-3 py-2">
                      <Shield className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0"><p className="text-xs font-medium text-white">{bm.nameEn}</p>{bm.nameAr && <p className="text-[10px] text-muted-foreground font-arabic">{bm.nameAr}</p>}</div>
                      {bm.role && <Tag text={bm.role} color="bg-white/5 text-white/50 border-white/10" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Operations */}
        {(ops.activities?.length || ops.products?.length || ops.keyCients?.length || ops.subsidiaries?.length) ? (
          <Section title="Business Operations" icon={Briefcase} color="text-blue-400" defaultOpen={false}>
            {ops.activities && ops.activities.length > 0 && <div className="mb-3"><p className="text-xs font-semibold text-white mb-2">Activities</p><div className="flex flex-wrap gap-1.5">{ops.activities.map((a, i) => <Tag key={i} text={a} color="bg-blue-500/10 text-blue-300 border-blue-500/20" />)}</div></div>}
            {ops.products && ops.products.length > 0 && <div className="mb-3"><p className="text-xs font-semibold text-white mb-2">Products & Services</p><div className="flex flex-wrap gap-1.5">{ops.products.map((p, i) => <Tag key={i} text={p} />)}</div></div>}
            {ops.keyCients && ops.keyCients.length > 0 && <div className="mb-3"><p className="text-xs font-semibold text-white mb-2">Notable Clients</p><div className="flex flex-wrap gap-1.5">{ops.keyCients.map((c, i) => <Tag key={i} text={c} color="bg-cyan-500/10 text-cyan-300 border-cyan-500/20" />)}</div></div>}
            {ops.subsidiaries && ops.subsidiaries.length > 0 && <div><p className="text-xs font-semibold text-white mb-2">Subsidiaries & Affiliates</p><div className="flex flex-wrap gap-1.5">{ops.subsidiaries.map((s, i) => <Tag key={i} text={s} color="bg-purple-500/10 text-purple-300 border-purple-500/20" />)}</div></div>}
          </Section>
        ) : null}

        {/* Market Intelligence */}
        {wizard.goals.includes("market") && (
          <Section title="Market Intelligence" icon={BarChart3} color="text-cyan-400" defaultOpen={false}>
            {m.marketPosition && <p className="text-sm text-white/85 mb-4 leading-relaxed">{m.marketPosition}</p>}
            {m.marketShare && <div className="mb-3"><span className="text-xs text-muted-foreground">Estimated Market Share: </span><span className="text-xs font-bold text-white">{m.marketShare}</span></div>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {m.competitors && m.competitors.length > 0 && <div className="bg-white/3 border border-white/8 rounded-lg p-3"><p className="text-xs font-semibold text-white mb-2">Competitors</p><div className="space-y-1">{m.competitors.map((c, i) => <p key={i} className="text-xs text-muted-foreground">• {c}</p>)}</div></div>}
              {m.strengths && m.strengths.length > 0 && <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3"><p className="text-xs font-semibold text-emerald-400 mb-2">Strengths</p><div className="space-y-1">{m.strengths.map((s, i) => <p key={i} className="text-xs text-white/80">✓ {s}</p>)}</div></div>}
              {m.opportunities && m.opportunities.length > 0 && <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg p-3"><p className="text-xs font-semibold text-blue-400 mb-2">Opportunities</p><div className="space-y-1">{m.opportunities.map((o, i) => <p key={i} className="text-xs text-white/80">→ {o}</p>)}</div></div>}
            </div>
          </Section>
        )}

        {/* B2B Approach Strategy */}
        {wizard.goals.includes("approach") && (
          <Section title="B2B Approach Strategy" icon={Target} color="text-primary" defaultOpen={false}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
              {a.bestChannel && <div className="bg-primary/5 border border-primary/15 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Best Channel</p><p className="text-xs font-bold text-primary">{a.bestChannel}</p></div>}
              {a.bestTiming && <div className="bg-white/3 border border-white/8 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Best Timing</p><p className="text-xs text-white">{a.bestTiming}</p></div>}
              {a.entryPoint && <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Entry Point</p><p className="text-xs font-bold text-amber-400">{a.entryPoint}</p></div>}
            </div>
            {a.valueProp && <div className="mb-3 bg-white/3 border border-white/8 rounded-lg p-3"><p className="text-xs font-semibold text-white mb-1">Value Proposition</p><p className="text-xs text-white/80">{a.valueProp}</p></div>}
            {a.openingAngle && <div className="mb-3 bg-white/3 border border-white/8 rounded-lg p-3"><p className="text-xs font-semibold text-white mb-1">Opening Angle</p><p className="text-xs text-white/80">{a.openingAngle}</p></div>}
            {a.sampleMessage && (
              <div className="bg-primary/8 border border-primary/20 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold text-primary">Sample Opening Message</p><CopyBtn text={a.sampleMessage} /></div>
                <p className="text-xs text-white/85 italic">"{a.sampleMessage}"</p>
              </div>
            )}
            {a.culturalNotes && <div className="mt-3 text-xs text-muted-foreground"><span className="font-semibold text-white">Cultural Notes: </span>{a.culturalNotes}</div>}
          </Section>
        )}

        {/* Recent News */}
        {report.news && report.news.length > 0 && (
          <Section title="Recent News & Developments" icon={FileText} color="text-muted-foreground" defaultOpen={false}>
            <div className="space-y-2">
              {report.news.map((n, i) => (
                <div key={i} className="bg-white/3 border border-white/8 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-medium text-white">{n.title}</p>
                    {n.date && <span className="text-[10px] text-muted-foreground shrink-0">{n.date}</span>}
                  </div>
                  {n.summary && <p className="text-xs text-muted-foreground">{n.summary}</p>}
                  {n.source && <p className="text-[10px] text-primary/70 mt-1">Source: {n.source}</p>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Intelligence Quality */}
        {(intel.verifiedFacts?.length || intel.estimatedFacts?.length || intel.caveats) && (
          <Section title="Intelligence Quality" icon={Shield} color="text-muted-foreground" defaultOpen={false}>
            {intel.caveats && <p className="text-xs text-amber-400 mb-3">{intel.caveats}</p>}
            {intel.verifiedFacts && intel.verifiedFacts.length > 0 && <div className="mb-3"><p className="text-xs font-semibold text-white mb-2">Verified Facts</p><div className="space-y-1">{intel.verifiedFacts.map((f, i) => <p key={i} className="text-xs text-white/80">✓ {f}</p>)}</div></div>}
            {intel.estimatedFacts && intel.estimatedFacts.length > 0 && <div><p className="text-xs font-semibold text-white mb-2">Estimated Facts</p><div className="space-y-1">{intel.estimatedFacts.map((f, i) => <p key={i} className="text-xs text-muted-foreground">~ {f}</p>)}</div></div>}
          </Section>
        )}
      </div>
    );
  }

  // ─── Steps 1–4: Wizard ──────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => step > 1 ? setStep(s => s - 1) : navigate("/prospecting")}
          className="text-muted-foreground hover:text-white">
          <ArrowLeft className="w-4 h-4 mr-1" /> {step > 1 ? "Back" : "Hub"}
        </Button>
        <div>
          <h1 className="text-xl font-display font-bold text-white">Company Intelligence</h1>
          <p className="text-xs text-muted-foreground">Enter a company name — no website required</p>
        </div>
      </div>

      <StepBar current={step} />

      {/* Step 1: Company Identity */}
      {step === 1 && (
        <Card className="bg-card/60 border-white/8">
          <CardContent className="p-6 space-y-4">
            <div>
              <label className="text-xs font-semibold text-white mb-1.5 block">Company Name *</label>
              <Input placeholder="e.g. Almarai, Saudi Aramco, Al Rajhi Bank…"
                value={wizard.companyName}
                onChange={e => wiz("companyName", e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-muted-foreground"
                onKeyDown={e => e.key === "Enter" && wizard.companyName.trim() && setStep(2)} />
              <p className="text-xs text-muted-foreground mt-1">Arabic or English name — the AI will find it</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-white mb-1.5 block">Website URL <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input placeholder="https://www.example.com.sa"
                value={wizard.website}
                onChange={e => wiz("website", e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-muted-foreground" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-white mb-1.5 block">CR Number <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Input placeholder="10-digit CR"
                  value={wizard.crNumber}
                  onChange={e => wiz("crNumber", e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-muted-foreground" />
              </div>
              <div>
                <label className="text-xs font-semibold text-white mb-1.5 block">City <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Input placeholder="Riyadh / Jeddah…"
                  value={wizard.city}
                  onChange={e => wiz("city", e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-muted-foreground" />
              </div>
            </div>
            <Button className="w-full" onClick={() => setStep(2)} disabled={!wizard.companyName.trim()}>
              Next <ArrowLeft className="w-4 h-4 ml-1 rotate-180" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Seller Context */}
      {step === 2 && (
        <Card className="bg-card/60 border-white/8">
          <CardContent className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">Help AI tailor the approach strategy to your business <span className="text-white/50">(all optional)</span></p>
            <div>
              <label className="text-xs font-semibold text-white mb-1.5 block">Your Company</label>
              <Input placeholder="Your company name"
                value={wizard.sellerContext.companyName}
                onChange={e => wiz("sellerContext", { ...wizard.sellerContext, companyName: e.target.value })}
                className="bg-white/5 border-white/10 text-white placeholder:text-muted-foreground" />
            </div>
            <div>
              <label className="text-xs font-semibold text-white mb-1.5 block">Product / Service</label>
              <Input placeholder="What are you selling or proposing?"
                value={wizard.sellerContext.product}
                onChange={e => wiz("sellerContext", { ...wizard.sellerContext, product: e.target.value })}
                className="bg-white/5 border-white/10 text-white placeholder:text-muted-foreground" />
            </div>
            <div>
              <label className="text-xs font-semibold text-white mb-1.5 block">Objective</label>
              <div className="flex flex-wrap gap-2">
                {OBJECTIVES.map(o => (
                  <button key={o} onClick={() => toggleObj(o)}
                    className={`px-3 py-1 rounded-full text-xs border transition-all ${wizard.sellerContext.objectives.includes(o) ? "bg-primary/20 border-primary/50 text-primary" : "bg-white/5 border-white/10 text-muted-foreground hover:text-white"}`}>
                    {o}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 border-white/10 text-white/70" onClick={() => setStep(3)}>Skip</Button>
              <Button className="flex-1" onClick={() => setStep(3)}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Goals */}
      {step === 3 && (
        <Card className="bg-card/60 border-white/8">
          <CardContent className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">Select what to research about <span className="text-white font-medium">{wizard.companyName}</span></p>
            <div className="space-y-2">
              {INTELLIGENCE_GOALS.map(goal => {
                const Icon = goal.icon;
                const selected = wizard.goals.includes(goal.id);
                return (
                  <button key={goal.id} onClick={() => toggleGoal(goal.id)} className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${selected ? "bg-primary/10 border-primary/30" : "bg-white/3 border-white/8 hover:border-white/15"}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${selected ? "bg-primary/20" : "bg-white/5"}`}>
                      <Icon className={`w-4 h-4 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${selected ? "text-white" : "text-white/70"}`}>{goal.label}</p>
                      <p className="text-xs text-muted-foreground">{goal.desc}</p>
                    </div>
                    {selected && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
            <Button className="w-full" onClick={() => setStep(4)} disabled={wizard.goals.length === 0}>
              Next ({wizard.goals.length} goals selected)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Known Facts */}
      {step === 4 && (
        <Card className="bg-card/60 border-white/8">
          <CardContent className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">Any facts you already know about <span className="text-white font-medium">{wizard.companyName}</span>? <span className="text-white/50">(optional)</span></p>
            <Textarea
              placeholder="e.g. Founded in 1985 by the Al-Othaim family. Main business is retail. We know the CEO is Khalid Al-Othaim…"
              value={wizard.knownFacts}
              onChange={e => wiz("knownFacts", e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-muted-foreground min-h-[120px]"
            />
            <div className="bg-primary/5 border border-primary/15 rounded-lg p-4">
              <p className="text-xs font-semibold text-primary mb-2">Ready to generate — {wizard.goals.length} intelligence modules</p>
              <div className="flex flex-wrap gap-1.5">
                {wizard.goals.map(g => { const goal = INTELLIGENCE_GOALS.find(x => x.id === g); return goal ? <Tag key={g} text={goal.label} /> : null; })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Stealth browser + 4× Gemini Chrome AI + Perplexity + Claude + GPT-4o running in parallel</p>
            </div>
            <Button className="w-full gap-2" size="lg"
              onClick={() => { setStep(5); profileMutation.mutate(); }}
              disabled={profileMutation.isPending}>
              <Sparkles className="w-4 h-4" /> Generate Company Intelligence
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
