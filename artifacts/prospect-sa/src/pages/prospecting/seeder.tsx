import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, ArrowRight, Database, Loader2, Globe, FileText,
  CheckCircle2, Download, RefreshCw, Building2, User, Users,
  MapPin, Phone, Mail, ExternalLink, Zap, ChevronDown, ChevronUp, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMutation } from "@tanstack/react-query";
import ProsEngineChat from "@/components/ProsEngineChat";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Constants ────────────────────────────────────────────────────────────────
const INDUSTRIES = [
  "Any / Mixed", "Healthcare & Medical", "Construction & Real Estate",
  "Oil & Gas / Energy", "Banking & Finance", "Retail & FMCG",
  "Technology & IT", "Manufacturing", "Logistics & Transportation",
  "Education & Training", "Food & Beverage", "Hospitality & Tourism",
  "Government & Public Sector", "Legal & Professional Services",
];

const CITIES = [
  "All Saudi Arabia", "Riyadh", "Jeddah", "Dammam", "Khobar",
  "Mecca", "Medina", "Tabuk", "Abha", "Taif", "Jubail", "Yanbu",
  "Najran", "Hail", "Qassim / Buraydah",
];

const RECORD_TYPES = [
  { id: "companies", icon: Building2, label: "Companies", desc: "Company profiles with contact & financial data" },
  { id: "executives", icon: User, label: "Executives", desc: "Named individuals with roles & contacts" },
  { id: "both", icon: Users, label: "Both", desc: "Companies + their key decision-makers" },
];

const COUNT_OPTIONS = [10, 20, 30, 50];
const STEP_LABELS = ["Input", "Questionnaire", "Generate"];

// ─── Types ────────────────────────────────────────────────────────────────────
interface Question {
  id: string;
  question: string;
  type: "choice" | "boolean" | "text";
  options?: string[];
  placeholder?: string;
}

interface UrlAnalysis {
  siteType: string;
  companiesDetected: string;
  questions: Question[];
  url: string;
  pageTitle?: string;
}

interface SeedResult {
  records: Record<string, string>[];
  summary: string;
  market_insight?: string;
  count: number;
  fields?: string[];
  url?: string;
}

interface FormState {
  inputType: "text" | "url";
  prompt: string;
  industry: string;
  city: string;
  recordType: "companies" | "executives" | "both";
  count: number;
  extraContext: string;
}

const DEFAULT_FORM: FormState = {
  inputType: "text",
  prompt: "",
  industry: "Any / Mixed",
  city: "All Saudi Arabia",
  recordType: "companies",
  count: 20,
  extraContext: "",
};

// ─── StepBar ─────────────────────────────────────────────────────────────────
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
              ${done ? "bg-amber-500 text-foreground" : active ? "bg-amber-500/20 text-amber-400 border border-amber-500/50" : "bg-muted/40 text-muted-foreground border border-border/40"}`}>
              {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx}
            </div>
            <span className={`text-xs hidden sm:block ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>{label}</span>
            {i < STEP_LABELS.length - 1 && <div className={`flex-1 h-px ${done ? "bg-amber-500/40" : "bg-white/10"}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Result Card ─────────────────────────────────────────────────────────────
function RecordCard({ record, idx }: { record: Record<string, string>; idx: number }) {
  const [open, setOpen] = useState(false);
  const name = record.companyName || record.fullName || record.name || `Record ${idx + 1}`;
  const sub = record.industry || record.title || record.type || "";
  const city = record.city || record.location || "";
  const email = record.email || "";
  const phone = record.phone || "";
  const website = record.website || "";
  const address = record.address || "";
  const desc = record.description || record.bio || "";
  const extras = Object.entries(record).filter(([k]) =>
    !["companyName", "fullName", "name", "industry", "title", "city", "location", "email", "phone", "website", "address", "description", "bio"].includes(k)
  );

  return (
    <Card className="bg-card/75 border-white/8 overflow-hidden">
      <div className="p-4 flex items-start gap-3 cursor-pointer" onClick={() => setOpen(!open)}>
        <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0 text-xs font-bold text-amber-400">
          {String(idx + 1).padStart(2, "0")}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{name}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
            {city && <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{city}</span>}
            {email && <span className="text-xs text-blue-400 flex items-center gap-1"><Mail className="w-2.5 h-2.5" />{email}</span>}
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
      </div>
      {open && (
        <div className="border-t border-white/6 px-4 pb-4 pt-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {phone && <div className="flex items-center gap-1.5 text-foreground/70"><Phone className="w-3 h-3 text-amber-400 shrink-0" />{phone}</div>}
            {website && <div className="flex items-center gap-1.5 text-foreground/70"><ExternalLink className="w-3 h-3 text-amber-400 shrink-0" /><a href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noopener noreferrer" className="hover:text-foreground truncate">{website}</a></div>}
            {address && <div className="flex items-start gap-1.5 text-foreground/70 col-span-2"><MapPin className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />{address}</div>}
            {extras.map(([k, v]) => v && v !== "N/A" && (
              <div key={k} className="flex gap-1.5 col-span-2">
                <span className="text-muted-foreground capitalize shrink-0">{k.replace(/([A-Z])/g, " $1")}:</span>
                <span className="text-foreground/70">{v}</span>
              </div>
            ))}
          </div>
          {desc && <p className="text-xs text-foreground/60 mt-2 leading-relaxed">{desc}</p>}
        </div>
      )}
    </Card>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DataSeederPage() {
  const [, navigate] = useLocation();
  const prePrompt = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("prompt") || ""
    : "";
  const preSource = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("source") || ""
    : "";
  const preCompany = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("company") || ""
    : "";

  // ── Text mode state ──────────────────────────────────────────────────────
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM, prompt: prePrompt });
  const [result, setResult] = useState<SeedResult | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [contextBanner, setContextBanner] = useState<string | null>(
    preSource === "website-intel" && preCompany ? `Context from Website Intelligence: ${preCompany}` : null
  );
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));

  // Auto-hydrate from localStorage context store written by Website Intel
  useEffect(() => {
    if (prePrompt || preCompany) return; // URL params already set
    try {
      const raw = localStorage.getItem("websiteIntelContext");
      if (raw) {
        const ctx = JSON.parse(raw) as {
          companyName?: string;
          industry?: string;
          city?: string;
          companies?: Array<{ name: string; industry?: string }>;
          generatedAt?: string;
        };
        if (ctx.companyName || (ctx.companies && ctx.companies.length > 0)) {
          const companyName = ctx.companyName || ctx.companies?.[0]?.name || "";
          const industry = ctx.industry || ctx.companies?.[0]?.industry || "";
          const city = ctx.city || "";
          const age = ctx.generatedAt
            ? Math.round((Date.now() - new Date(ctx.generatedAt).getTime()) / 60000)
            : null;
          const ageLabel = age !== null && age < 60 ? ` (${age}m ago)` : "";

          if (companyName) {
            const autoPrompt = `${companyName}${industry ? ` — ${industry}` : ""} Saudi Arabia executives and key contacts`;
            set("prompt", autoPrompt);
            if (industry) set("industry", industry);
            if (city) set("city", city);
            setContextBanner(`Auto-filled from Website Intelligence: ${companyName}${ageLabel}`);
          }
        }
      }
    } catch { /* ignore localStorage errors */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── URL mode state ───────────────────────────────────────────────────────
  const [urlInput, setUrlInput] = useState("");
  const [urlDescription, setUrlDescription] = useState("");
  const [urlAnalysis, setUrlAnalysis] = useState<UrlAnalysis | null>(null);
  const [urlAnswers, setUrlAnswers] = useState<Record<string, string>>({});
  const [urlStep, setUrlStep] = useState<1 | 2 | 3>(1);

  // ── Text mode: seed mutation ──────────────────────────────────────────────
  const seedMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/prosengine/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: form.prompt || `${form.industry} ${form.recordType} in ${form.city}`,
          industry: form.industry !== "Any / Mixed" ? form.industry : undefined,
          city: form.city !== "All Saudi Arabia" ? form.city : undefined,
          recordType: form.recordType,
          count: form.count,
          extraContext: form.extraContext || undefined,
        }),
      });
      if (!r.ok) throw new Error("Generation failed");
      return r.json() as Promise<SeedResult>;
    },
    onSuccess: (data) => { setResult(data); setStep(4 as number); },
  });

  // ── URL mode: analyze URL mutation ────────────────────────────────────────
  const analyzeUrlMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/prosengine/analyze-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim(), description: urlDescription || undefined }),
      });
      if (!r.ok) throw new Error("URL analysis failed");
      return r.json() as Promise<UrlAnalysis>;
    },
    onSuccess: (data) => {
      setUrlAnalysis(data);
      setUrlStep(2);
    },
  });

  // ── URL mode: seed from URL mutation ─────────────────────────────────────
  const seedFromUrlMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/prosengine/seed-from-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urlInput.trim(),
          answers: urlAnswers,
          description: urlDescription || undefined,
        }),
      });
      if (!r.ok) throw new Error("Company extraction failed");
      return r.json() as Promise<SeedResult>;
    },
    onSuccess: (data) => { setResult(data); setStep(4 as number); },
  });

  // ── Export CSV ────────────────────────────────────────────────────────────
  const exportCSV = () => {
    if (!result?.records?.length) return;
    const keys = Object.keys(result.records[0]);
    const csv = [keys.join(","), ...result.records.map(r => keys.map(k => `"${(r[k] || "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url;
    a.download = `prosengine-seed-${Date.now()}.csv`; a.click();
  };

  const chatContext = result
    ? form.inputType === "url"
      ? `Data Seeder extracted ${result.count} Saudi companies from URL: ${urlInput}\n\nSummary: ${result.summary}\n\nFirst 5 records:\n${result.records.slice(0, 5).map((r, i) => `${i + 1}. ${JSON.stringify(r)}`).join("\n")}\n\nMarket Insight: ${result.market_insight || "N/A"}`
      : `Data Seeder generated ${result.count} Saudi ${form.recordType} records.\n\nRequest: ${form.prompt || `${form.industry} in ${form.city}`}\nIndustry: ${form.industry}\nCity/Region: ${form.city}\n\nSummary: ${result.summary}\n\nFirst 5 records:\n${result.records.slice(0, 5).map((r, i) => `${i + 1}. ${JSON.stringify(r)}`).join("\n")}\n\nMarket Insight: ${result.market_insight || "N/A"}`
    : "";

  const filtered = (result?.records ?? []).filter(r => {
    if (!searchFilter) return true;
    const q = searchFilter.toLowerCase();
    return Object.values(r).some(v => v?.toLowerCase().includes(q));
  });

  const isLoading = seedMutation.isPending || seedFromUrlMutation.isPending;

  // ── RESULTS view ──────────────────────────────────────────────────────────
  if (result && step === 4) return (
    <div className="p-6 max-w-4xl mx-auto pb-24">
      <div className="flex items-center gap-3 mb-5">
        <Button variant="ghost" size="icon" onClick={() => { setResult(null); setStep(1); setForm(DEFAULT_FORM); setUrlStep(1); setUrlInput(""); setUrlAnalysis(null); setUrlAnswers({}); }}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-display font-bold text-foreground">
            {form.inputType === "url" ? "Extracted Companies" : "Seeded Data"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {result.count} records · {form.inputType === "url" ? `Scraped from ${urlInput.replace(/^https?:\/\//, "").split("/")[0]}` : "AI-generated · Saudi Arabia"}
          </p>
        </div>
        <Button size="sm" onClick={exportCSV} className="bg-amber-600/20 text-amber-300 border border-amber-500/30 hover:bg-amber-600/30">
          <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
        </Button>
        <Button size="sm" onClick={() => { setResult(null); setStep(1); setForm(DEFAULT_FORM); setUrlStep(1); setUrlInput(""); setUrlAnalysis(null); setUrlAnswers({}); }}
          variant="outline" className="border-border/40 text-foreground hover:bg-muted/40">
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />New Seed
        </Button>
      </div>

      <Card className="bg-amber-500/8 border-amber-500/20 mb-5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
              <Database className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">{result.summary}</p>
              {result.market_insight && (
                <p className="text-xs text-amber-300/80 mt-1.5 flex items-start gap-1.5">
                  <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                  {result.market_insight}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-display font-bold text-amber-400">{result.count}</p>
              <p className="text-xs text-muted-foreground">Records</p>
            </div>
          </div>
          {form.inputType === "url" && (
            <div className="mt-3 flex items-center gap-2 text-xs text-foreground/50">
              <Globe className="w-3.5 h-3.5 text-amber-400" />
              <span className="truncate">{urlInput}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/15 mb-4 text-xs text-amber-400/80">
        {form.inputType === "url"
          ? "Companies extracted from web source using 7 parallel AI agents. Verify contacts and details before outreach."
          : "AI-generated data based on Saudi market knowledge. Use for prospecting reference only — verify contacts before outreach."}
      </div>

      <div className="relative mb-4">
        <Input placeholder="Filter records..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
          className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground" />
      </div>

      <div className="space-y-2">
        {filtered.map((record, i) => <RecordCard key={i} record={record} idx={i} />)}
      </div>

      <ProsEngineChat mode="seeder" context={chatContext} autoOpen={true} />
    </div>
  );

  // ── WIZARD view ───────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => {
          if (form.inputType === "url") {
            if (urlStep === 1) navigate("/prospecting");
            else setUrlStep(s => (s - 1) as 1 | 2 | 3);
          } else {
            step === 1 ? navigate("/prospecting") : setStep(s => s - 1);
          }
        }}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <Database className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold text-foreground">Data Seeder</h1>
            <p className="text-xs text-muted-foreground">
              {form.inputType === "url" ? "Extract real companies from any web source" : "AI-generated Saudi company & executive records"}
            </p>
          </div>
        </div>
      </div>

      <StepBar current={form.inputType === "url" ? urlStep : step} />

      {contextBanner && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300">
          <Globe className="w-3.5 h-3.5 shrink-0" />
          <span>{contextBanner}</span>
        </div>
      )}

      <Card className="bg-card/70 border-white/8">
        <CardContent className="p-6">

          {/* ── Mode toggle always visible on step 1 ── */}
          {((form.inputType === "text" && step === 1) || (form.inputType === "url" && urlStep === 1)) && (
            <div className="flex gap-1 p-1 bg-muted/40 rounded-xl border border-white/8 w-fit mb-5">
              <button onClick={() => { set("inputType", "text"); setStep(1); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${form.inputType === "text" ? "bg-amber-500/20 text-foreground border border-amber-500/30" : "text-muted-foreground hover:text-foreground"}`}>
                <FileText className="w-4 h-4" />Describe in text
              </button>
              <button onClick={() => { set("inputType", "url"); setUrlStep(1); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${form.inputType === "url" ? "bg-amber-500/20 text-foreground border border-amber-500/30" : "text-muted-foreground hover:text-foreground"}`}>
                <Globe className="w-4 h-4" />Scan a URL
              </button>
            </div>
          )}

          {/* ══ TEXT MODE ══════════════════════════════════════════════════════ */}

          {form.inputType === "text" && step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold text-foreground mb-1">What data do you want to seed?</p>
                <p className="text-sm text-muted-foreground mb-4">Describe what you need in plain language.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Describe what you need</label>
                <Textarea
                  placeholder={`Examples:\n• 30 Saudi healthcare companies in Riyadh with CEO names\n• 20 construction companies in Jeddah with executive contacts\n• 15 technology startups in Riyadh founded after 2020`}
                  value={form.prompt}
                  onChange={(e) => set("prompt", e.target.value)}
                  className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground/60 min-h-[120px] text-sm resize-none"
                />
              </div>
              <p className="text-xs text-muted-foreground">Or leave empty and use the questionnaire below to build the request automatically.</p>
            </div>
          )}

          {form.inputType === "text" && step === 2 && (
            <div className="space-y-5">
              <div>
                <p className="text-base font-semibold text-foreground mb-1">Refine your request</p>
                <p className="text-sm text-muted-foreground mb-4">These filters focus the AI on exactly what you need.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block uppercase tracking-wider">Record Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {RECORD_TYPES.map(({ id, icon: Icon, label }) => {
                    const active = form.recordType === id;
                    return (
                      <button key={id} onClick={() => set("recordType", id as FormState["recordType"])}
                        className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-center ${active ? "border-amber-500/40 bg-amber-500/10" : "border-white/8 bg-white/3 hover:border-white/15"}`}>
                        <Icon className={`w-5 h-5 ${active ? "text-amber-400" : "text-muted-foreground"}`} />
                        <p className="text-xs font-medium text-foreground">{label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block uppercase tracking-wider">Industry</label>
                <div className="flex flex-wrap gap-1.5">
                  {INDUSTRIES.map(ind => (
                    <button key={ind} onClick={() => set("industry", ind)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${form.industry === ind ? "border-amber-500/40 bg-amber-500/10 text-foreground" : "border-white/8 text-muted-foreground hover:border-white/20"}`}>
                      {ind}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block uppercase tracking-wider">City / Region</label>
                <div className="flex flex-wrap gap-1.5">
                  {CITIES.map(c => (
                    <button key={c} onClick={() => set("city", c)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${form.city === c ? "border-amber-500/40 bg-amber-500/10 text-foreground" : "border-white/8 text-muted-foreground hover:border-white/20"}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block uppercase tracking-wider">How many records?</label>
                <div className="flex gap-2">
                  {COUNT_OPTIONS.map(n => (
                    <button key={n} onClick={() => set("count", n)}
                      className={`px-5 py-2 rounded-lg border text-sm font-medium transition-all ${form.count === n ? "border-amber-500/40 bg-amber-500/10 text-foreground" : "border-white/8 text-muted-foreground hover:border-white/20"}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Additional instructions (optional)</label>
                <Input placeholder="e.g. focus on companies with 100+ employees, include LinkedIn profiles..."
                  value={form.extraContext}
                  onChange={(e) => set("extraContext", e.target.value)}
                  className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground" />
              </div>
            </div>
          )}

          {form.inputType === "text" && step === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold text-foreground mb-1">Ready to generate</p>
                <p className="text-sm text-muted-foreground mb-4">Review your request then launch the AI data seeder.</p>
              </div>
              <div className="space-y-2">
                {form.prompt && (
                  <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                    <p className="text-xs text-muted-foreground mb-1">Your Request</p>
                    <p className="text-sm text-foreground">{form.prompt}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Record Type", value: form.recordType },
                    { label: "Count", value: `${form.count} records` },
                    { label: "Industry", value: form.industry },
                    { label: "City/Region", value: form.city },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-3 rounded-xl bg-muted/40 border border-white/8">
                      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                      <p className="text-sm font-medium text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
                {form.extraContext && (
                  <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                    <p className="text-xs text-muted-foreground mb-1">Extra Instructions</p>
                    <p className="text-xs text-foreground/80">{form.extraContext}</p>
                  </div>
                )}
              </div>
              <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 text-xs text-amber-400/90">
                Claude + GPT-4o will generate {form.count} realistic Saudi {form.recordType} records. Data is AI-estimated — verify before use.
              </div>
            </div>
          )}

          {/* ══ URL MODE ═══════════════════════════════════════════════════════ */}

          {form.inputType === "url" && urlStep === 1 && (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold text-foreground mb-1">What URL contains companies?</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Enter any web page URL — a directory, registry, government portal, or industry listing.
                  7 AI agents + browser tools will scrape and extract every company found there.
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">URL to scrape <span className="text-amber-400">*</span></label>
                <Input
                  placeholder="https://example.com/companies-directory"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground font-mono text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Describe this URL (optional)</label>
                <Input
                  placeholder="e.g. Saudi contractor registry, list of MODON tenants, Riyadh Chamber members..."
                  value={urlDescription}
                  onChange={e => setUrlDescription(e.target.value)}
                  className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground text-sm"
                />
              </div>
              <div className="p-3 rounded-xl bg-white/3 border border-white/8 text-xs text-muted-foreground space-y-1.5">
                <p className="font-medium text-foreground/60">Powered by 7 parallel agents:</p>
                <div className="grid grid-cols-2 gap-1">
                  {["Crawl4AI", "Cheerio HTML parser", "Playwright stealth browser", "Perplexity web search (×2)", "Claude Sonnet", "GPT-4o"].map(t => (
                    <p key={t} className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />{t}</p>
                  ))}
                </div>
              </div>
              {analyzeUrlMutation.isError && (
                <p className="text-xs text-red-400">Could not analyze URL — check that it's accessible and try again.</p>
              )}
            </div>
          )}

          {form.inputType === "url" && urlStep === 2 && urlAnalysis && (
            <div className="space-y-5">
              <div>
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-teal-500/15 border border-teal-500/20 flex items-center justify-center shrink-0">
                    <Search className="w-4 h-4 text-teal-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{urlAnalysis.siteType}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">~{urlAnalysis.companiesDetected} companies detected · Answer below to refine extraction</p>
                  </div>
                </div>
                <p className="text-base font-semibold text-foreground mb-1">Extraction questionnaire</p>
                <p className="text-sm text-muted-foreground">Answer these questions based on what you want to extract from this URL.</p>
              </div>

              <div className="space-y-4">
                {urlAnalysis.questions.map((q) => (
                  <div key={q.id} className="space-y-2">
                    <label className="text-sm text-foreground font-medium">{q.question}</label>
                    {q.type === "choice" && q.options && (
                      <div className="flex flex-wrap gap-2">
                        {q.options.map(opt => (
                          <button key={opt} onClick={() => setUrlAnswers(a => ({ ...a, [q.id]: opt }))}
                            className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${urlAnswers[q.id] === opt ? "border-amber-500/40 bg-amber-500/10 text-foreground" : "border-white/8 text-muted-foreground hover:border-white/20"}`}>
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                    {q.type === "boolean" && (
                      <div className="flex gap-2">
                        {["Yes", "No"].map(opt => (
                          <button key={opt} onClick={() => setUrlAnswers(a => ({ ...a, [q.id]: opt }))}
                            className={`text-xs px-4 py-1.5 rounded-lg border transition-all ${urlAnswers[q.id] === opt ? "border-amber-500/40 bg-amber-500/10 text-foreground" : "border-white/8 text-muted-foreground hover:border-white/20"}`}>
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                    {q.type === "text" && (
                      <Input
                        placeholder={q.placeholder || "Your answer (optional)"}
                        value={urlAnswers[q.id] || ""}
                        onChange={e => setUrlAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                        className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground text-sm"
                      />
                    )}
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">All questions are optional — the AI will make best-effort decisions if left blank.</p>
            </div>
          )}

          {form.inputType === "url" && urlStep === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold text-foreground mb-1">Ready to extract</p>
                <p className="text-sm text-muted-foreground mb-4">All 7 agents will scrape this URL in parallel and return every company found.</p>
              </div>
              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                  <p className="text-xs text-muted-foreground mb-0.5">Source URL</p>
                  <p className="text-xs font-mono text-amber-300 break-all">{urlInput}</p>
                </div>
                {urlDescription && (
                  <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                    <p className="text-xs text-muted-foreground mb-0.5">Description</p>
                    <p className="text-xs text-foreground/80">{urlDescription}</p>
                  </div>
                )}
                {Object.entries(urlAnswers).filter(([, v]) => v).length > 0 && (
                  <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                    <p className="text-xs text-muted-foreground mb-1.5">Your preferences</p>
                    {Object.entries(urlAnswers).filter(([, v]) => v).map(([k, v]) => (
                      <p key={k} className="text-xs text-foreground/70">{k}: <span className="text-foreground">{v}</span></p>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 text-xs text-amber-400/90">
                7 agents (Crawl4AI + Cheerio + Perplexity ×2 + Claude + GPT-4o + merge agent) will run in parallel. This may take 30–60 seconds.
              </div>
            </div>
          )}

          {/* ── Navigation ─────────────────────────────────────────────────── */}

          {/* Text mode navigation */}
          {form.inputType === "text" && (
            <div className="flex gap-3 mt-6">
              {step < 3 && (
                <>
                  {step > 1 && (
                    <Button variant="outline" className="border-border/40 text-foreground hover:bg-muted/40" onClick={() => setStep(s => s - 1)}>
                      <ArrowLeft className="w-4 h-4 mr-1.5" />Back
                    </Button>
                  )}
                  <Button onClick={() => setStep(s => s + 1)} className="flex-1 bg-amber-600 hover:bg-amber-700 text-foreground">
                    Continue<ArrowRight className="w-4 h-4 ml-1.5" />
                  </Button>
                </>
              )}
              {step === 3 && (
                <>
                  <Button variant="outline" className="border-border/40 text-foreground hover:bg-muted/40" onClick={() => setStep(2)}>
                    <ArrowLeft className="w-4 h-4 mr-1.5" />Back
                  </Button>
                  <Button onClick={() => seedMutation.mutate()}
                    disabled={isLoading}
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-foreground font-semibold">
                    {seedMutation.isPending
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
                      : <><Zap className="w-4 h-4 mr-2" />Generate {form.count} Records</>}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* URL mode navigation */}
          {form.inputType === "url" && (
            <div className="flex gap-3 mt-6">
              {urlStep === 1 && (
                <Button
                  onClick={() => { if (urlInput.trim()) analyzeUrlMutation.mutate(); }}
                  disabled={!urlInput.trim() || analyzeUrlMutation.isPending}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-foreground font-semibold">
                  {analyzeUrlMutation.isPending
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analyzing URL...</>
                    : <><Search className="w-4 h-4 mr-2" />Analyze URL</>}
                </Button>
              )}
              {urlStep === 2 && (
                <>
                  <Button variant="outline" className="border-border/40 text-foreground hover:bg-muted/40" onClick={() => setUrlStep(1)}>
                    <ArrowLeft className="w-4 h-4 mr-1.5" />Back
                  </Button>
                  <Button onClick={() => setUrlStep(3)} className="flex-1 bg-amber-600 hover:bg-amber-700 text-foreground">
                    Continue<ArrowRight className="w-4 h-4 ml-1.5" />
                  </Button>
                </>
              )}
              {urlStep === 3 && (
                <>
                  <Button variant="outline" className="border-border/40 text-foreground hover:bg-muted/40" onClick={() => setUrlStep(2)}>
                    <ArrowLeft className="w-4 h-4 mr-1.5" />Back
                  </Button>
                  <Button
                    onClick={() => seedFromUrlMutation.mutate()}
                    disabled={isLoading}
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-foreground font-semibold">
                    {seedFromUrlMutation.isPending
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Extracting companies...</>
                      : <><Zap className="w-4 h-4 mr-2" />Extract All Companies</>}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Error states */}
          {(seedMutation.isError || seedFromUrlMutation.isError) && (
            <p className="text-xs text-red-400 mt-3 text-center">
              {seedFromUrlMutation.isError ? "Extraction failed — check URL and try again." : "Generation failed — please retry."}
            </p>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
