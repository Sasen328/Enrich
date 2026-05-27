import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, ArrowRight, User, Loader2, Search, Building2, MapPin, Linkedin,
  Briefcase, GraduationCap, DollarSign, Heart, AlertCircle, ChevronDown,
  ChevronUp, Star, Target, BookOpen, Globe, Calendar, TrendingUp, Shield,
  Sparkles, Brain, CheckCircle2, BarChart3, Trophy, Eye,
  Zap, RefreshCw, Save, Trash2, Copy, Check,
} from "lucide-react";
import ProsEngineChat from "@/components/ProsEngineChat";
import { VerdictList } from "@/components/VerdictPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────
interface SellerContext { companyName: string; product: string; objectives: string[]; }
interface WizardState {
  name: string; title: string; company: string; linkedin: string;
  sellerContext: SellerContext;
  goals: string[];
  knownFacts: string;
}
interface PersonProfile {
  profile: { fullName: string; arabicName?: string; title?: string; company?: string; nationality?: string; location?: string; age?: number | null; linkedin?: string; };
  career: Array<{ company: string; title: string; period: string; description: string }>;
  education: Array<{ institution: string; degree: string; year: string }>;
  company_analysis: { name?: string; industry?: string; founded?: string; headquarters?: string; employees?: string; revenue_estimate?: string; performance?: string; market_position?: string; key_clients?: string[]; recent_developments?: string; competitors?: string[]; pain_points?: string[]; };
  wealth_profile: { estimated_net_worth?: string; income_estimate?: string; wealth_sources?: string[]; assets?: string; investments?: string; lifestyle_indicators?: string; };
  personal_profile: { interests?: string[]; personality_traits?: string[]; communication_style?: string; languages?: string[]; board_memberships?: string[]; publications?: string[]; awards?: string[]; social_presence?: string; };
  approach_strategy: { best_channel?: string; best_timing?: string; opening_angle?: string; value_proposition?: string; potential_objections?: string[]; conversation_starters?: string[]; cultural_notes?: string; recommended_approach?: string; sample_message?: string; };
  intelligence_notes: { confidence_level?: string; data_sources?: string[]; verified_facts?: string[]; estimated_facts?: string[]; caveats?: string; };
  humanizedProfile?: string;
  verdicts?: import("@/components/VerdictPill").Verdict[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const INTELLIGENCE_GOALS = [
  { id: "wealth",      icon: DollarSign,    label: "Wealth & Financial Profile",    desc: "Net worth, income, assets, investments" },
  { id: "approach",    icon: Target,        label: "B2B Approach Strategy",         desc: "Best channel, opening, sample message" },
  { id: "company",     icon: Building2,     label: "Company Deep-Dive",             desc: "Revenue, performance, pain points, competitors" },
  { id: "career",      icon: Briefcase,     label: "Career & Education",            desc: "Career timeline, degrees, institutions" },
  { id: "personal",    icon: Heart,         label: "Personal Profile & Lifestyle",  desc: "Interests, traits, communication style" },
  { id: "competitive", icon: BarChart3,     label: "Competitive Intelligence",      desc: "Company's competitive landscape & weaknesses" },
];

const OBJECTIVES = [
  "Book a meeting", "Get a referral intro", "Pitch a proposal",
  "Close a deal", "Build a relationship", "Conduct due diligence",
  "Prospecting",
];

const LOADING_MSGS = [
  "Scanning corporate registry data…",
  "Cross-referencing public filings…",
  "Estimating wealth profile from known positions…",
  "Mapping career trajectory…",
  "Analysing company performance & market position…",
  "Building personalized approach strategy…",
  "Compiling intelligence dossier…",
  "Finalising report…",
];

const DEFAULT_WIZARD: WizardState = {
  name: "", title: "", company: "", linkedin: "",
  sellerContext: { companyName: "", product: "", objectives: [] },
  goals: ["approach", "wealth", "company"],
  knownFacts: "",
};

// ─── Collapsible Section ──────────────────────────────────────────────────────
function Section({ title, icon: Icon, color = "text-primary", badge, children, defaultOpen = true }: {
  title: string; icon: React.FC<{ className?: string }>; color?: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="bg-card/70 border-white/8">
      <button className="w-full px-5 py-4 flex items-center gap-3" onClick={() => setOpen(!open)}>
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {badge && <Badge className="bg-muted/40 text-foreground/60 border-border/40 border text-xs ml-1">{badge}</Badge>}
        <div className="ml-auto">{open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}</div>
      </button>
      {open && <CardContent className="px-5 pb-5 pt-0">{children}</CardContent>}
    </Card>
  );
}

// ─── Step Bar ─────────────────────────────────────────────────────────────────
const STEP_LABELS = ["Identity", "Your Context", "Goals", "Known Facts", "Generate"];
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
              ${done ? "bg-primary text-foreground" : active ? "bg-primary/20 text-primary border border-primary/50" : "bg-muted/40 text-muted-foreground border border-border/40"}`}>
              {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx}
            </div>
            <span className={`text-xs hidden sm:block ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>{label}</span>
            {i < STEP_LABELS.length - 1 && <div className={`flex-1 h-px ${done ? "bg-primary/40" : "bg-white/10"}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Copy Button ──────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground shrink-0"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PersonIntelPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [wizard, setWizard] = useState<WizardState>(DEFAULT_WIZARD);
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [saved, setSaved] = useState(false);

  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [contextExecs, setContextExecs] = useState<Array<{ name: string; title?: string; company?: string }>>([]);

  // Pre-fill from URL query params OR auto-hydrate from localStorage websiteIntelContext
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nameParam = params.get("name");
    const companyParam = params.get("company");
    const titleParam = params.get("title");
    const source = params.get("source");

    if (nameParam || companyParam) {
      // URL params take priority
      setWizard(w => ({
        ...w,
        name: nameParam ? decodeURIComponent(nameParam) : w.name,
        company: companyParam ? decodeURIComponent(companyParam) : w.company,
        title: titleParam ? decodeURIComponent(titleParam) : w.title,
      }));
      if (source === "website-intel") setSourceLabel("Pre-filled from Website Intelligence");
    } else {
      // Auto-hydrate from localStorage context store written by Website Intel
      try {
        const raw = localStorage.getItem("websiteIntelContext");
        if (raw) {
          const ctx = JSON.parse(raw) as {
            companyName?: string;
            executives?: Array<{ name: string; title?: string; company?: string }>;
            generatedAt?: string;
          };
          if (ctx.companyName) {
            setWizard(w => ({
              ...w,
              company: ctx.companyName || w.company,
            }));
            const age = ctx.generatedAt
              ? Math.round((Date.now() - new Date(ctx.generatedAt).getTime()) / 60000)
              : null;
            const ageLabel = age !== null && age < 60 ? ` (${age}m ago)` : "";
            setSourceLabel(`Auto-filled from Website Intelligence${ageLabel}`);
          }
          // Surface executives as quick-fill candidates
          if (ctx.executives && ctx.executives.length > 0) {
            setContextExecs(ctx.executives.slice(0, 12));
          }
        }
      } catch { /* ignore localStorage errors */ }
    }
  }, []);

  const set = (field: keyof WizardState, value: unknown) => setWizard(w => ({ ...w, [field]: value }));
  const setCtx = (field: keyof Omit<SellerContext, "objectives">, value: string) =>
    setWizard(w => ({ ...w, sellerContext: { ...w.sellerContext, [field]: value } }));
  const toggleObjective = (obj: string) =>
    setWizard(w => ({
      ...w,
      sellerContext: {
        ...w.sellerContext,
        objectives: w.sellerContext.objectives.includes(obj)
          ? w.sellerContext.objectives.filter(o => o !== obj)
          : [...w.sellerContext.objectives, obj],
      },
    }));
  const toggleGoal = (id: string) => setWizard(w => ({
    ...w, goals: w.goals.includes(id) ? w.goals.filter(g => g !== id) : [...w.goals, id],
  }));

  const generateMutation = useMutation({
    mutationFn: async () => {
      let idx = 0;
      const iv = setInterval(() => { idx = (idx + 1) % LOADING_MSGS.length; setLoadingMsgIdx(idx); }, 2500);
      try {
        const r = await fetch(`${BASE}/api/person-intel/profile`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: wizard.name, company: wizard.company || undefined,
            title: wizard.title || undefined, linkedinUrl: wizard.linkedin || undefined,
            sellerContext: wizard.sellerContext.companyName ? wizard.sellerContext : undefined,
            intelligenceGoals: wizard.goals,
            knownFacts: wizard.knownFacts || undefined,
          }),
        });
        if (!r.ok) throw new Error("Profile generation failed");
        return r.json() as Promise<PersonProfile>;
      } finally { clearInterval(iv); }
    },
    onSuccess: (data) => { setProfile(data); setSaved(false); },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profile) return;
      const r = await fetch(`${BASE}/api/person-intel/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personName: wizard.name, company: wizard.company, title: wizard.title,
          linkedinUrl: wizard.linkedin,
          sellerContext: wizard.sellerContext.companyName ? wizard.sellerContext : undefined,
          intelligenceGoals: wizard.goals, knownFacts: wizard.knownFacts, report: profile,
        }),
      });
      if (!r.ok) throw new Error("Save failed");
      return r.json();
    },
    onSuccess: () => { setSaved(true); qc.invalidateQueries({ queryKey: ["prosengine-research"] }); },
  });

  const confidenceColor = (c?: string) =>
    c === "High" ? "bg-green-500/15 text-green-300 border-green-500/30" :
    c === "Medium" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
    "bg-red-500/15 text-red-300 border-red-500/30";

  const canNext = () => {
    if (step === 1) return wizard.name.trim().length > 0;
    if (step === 3) return wizard.goals.length > 0;
    return true;
  };

  // ── Wizard ────────────────────────────────────────────────────────────────
  if (!profile) return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => step === 1 ? navigate("/prospecting") : setStep(s => s - 1)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
            <Brain className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold text-foreground">Person Intelligence</h1>
            <p className="text-xs text-muted-foreground">AI-powered dossier · wealth · career · strategy</p>
          </div>
        </div>
      </div>

      <StepBar current={step} />

      {sourceLabel && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2.5 rounded-lg bg-violet-500/10 border border-violet-500/25 text-xs text-violet-300">
          <Globe className="w-3.5 h-3.5 shrink-0" />
          <span>{sourceLabel} — fields pre-populated below.</span>
        </div>
      )}

      <Card className="bg-card/70 border-white/8">
        <CardContent className="p-6">
          {/* Step 1: Identity */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold text-foreground mb-1">Who is the target person?</p>
                <p className="text-sm text-muted-foreground mb-4">The more you provide, the more accurate and personalised the intelligence report will be.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Full Name <span className="text-red-400">*</span></label>
                <Input placeholder="e.g. Mohammed Al-Rashid" value={wizard.name}
                  onChange={(e) => set("name", e.target.value)}
                  className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Title / Role</label>
                  <Input placeholder="e.g. CEO" value={wizard.title}
                    onChange={(e) => set("title", e.target.value)}
                    className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Company</label>
                  <Input placeholder="e.g. Saudi Aramco" value={wizard.company}
                    onChange={(e) => set("company", e.target.value)}
                    className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">LinkedIn URL (optional)</label>
                <Input placeholder="https://linkedin.com/in/..." value={wizard.linkedin}
                  onChange={(e) => set("linkedin", e.target.value)}
                  className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground" />
              </div>
              {/* Quick-fill executives from Website Intelligence localStorage */}
              {contextExecs.length > 0 && !wizard.name && (
                <div className="pt-2 border-t border-white/8">
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Globe className="w-3 h-3 text-violet-400" />
                    Quick-fill from your last Website Intelligence session:
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
                    {contextExecs.map((exec, i) => (
                      <button key={i}
                        onClick={() => setWizard(w => ({
                          ...w,
                          name: exec.name,
                          title: exec.title || w.title,
                          company: exec.company || w.company,
                        }))}
                        className="text-left px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 transition-all text-xs text-violet-200 hover:text-foreground">
                        <span className="font-medium">{exec.name}</span>
                        {exec.title && <span className="text-violet-400/70 ml-1">· {exec.title}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Seller Context */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold text-foreground mb-1">What's your selling context?</p>
                <p className="text-sm text-muted-foreground mb-4">This personalises the approach strategy and value proposition to your specific situation. Skip if not applicable.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Your company name</label>
                <Input placeholder="e.g. Acme Solutions" value={wizard.sellerContext.companyName}
                  onChange={(e) => setCtx("companyName", e.target.value)}
                  className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Your product or service</label>
                <Input placeholder="e.g. ERP software for manufacturing companies" value={wizard.sellerContext.product}
                  onChange={(e) => setCtx("product", e.target.value)}
                  className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Your objective <span className="text-muted-foreground/60">(select all that apply)</span></label>
                <div className="flex flex-wrap gap-2">
                  {OBJECTIVES.map(obj => {
                    const active = wizard.sellerContext.objectives.includes(obj);
                    return (
                      <button key={obj} onClick={() => toggleObjective(obj)}
                        className={`text-xs px-3 py-2 rounded-lg border transition-all flex items-center gap-1.5 ${active ? "border-primary/50 bg-primary/15 text-foreground" : "border-border/40 bg-muted/40 text-muted-foreground hover:border-white/20"}`}>
                        {active && <Check className="w-3 h-3 text-primary" />}
                        {obj}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Intelligence Goals */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold text-foreground mb-1">What intelligence do you need?</p>
                <p className="text-sm text-muted-foreground mb-4">Select all that apply. Each section will be generated in depth.</p>
              </div>
              <div className="space-y-2">
                {INTELLIGENCE_GOALS.map(({ id, icon: Icon, label, desc }) => {
                  const active = wizard.goals.includes(id);
                  return (
                    <button key={id} onClick={() => toggleGoal(id)}
                      className={`w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left ${active ? "border-violet-500/40 bg-violet-500/10" : "border-white/8 bg-white/3 hover:border-white/15"}`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-violet-500/20" : "bg-muted/40"}`}>
                        <Icon className={`w-4 h-4 ${active ? "text-violet-400" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{label}</p>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                      {active && <CheckCircle2 className="w-4 h-4 text-violet-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 4: Known Facts */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold text-foreground mb-1">What do you already know about this person?</p>
                <p className="text-sm text-muted-foreground mb-4">Add any facts, notes, or context you already have. The AI will treat these as confirmed data and build on them to produce a more accurate report.</p>
              </div>
              <Textarea
                placeholder={`Examples:\n• Met at the Vision 2030 conference in Riyadh, Dec 2025\n• Company recently raised Series B of $40M\n• Known to be interested in digital transformation\n• Has been with current company for 8 years\n• Previously worked at KPMG Saudi Arabia`}
                value={wizard.knownFacts}
                onChange={(e) => set("knownFacts", e.target.value)}
                className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground/60 min-h-[200px] text-sm resize-none"
              />
              <p className="text-xs text-muted-foreground">Leave empty to rely entirely on AI knowledge. The more facts you provide, the more accurate the dossier.</p>
            </div>
          )}

          {/* Step 5: Preview & Generate */}
          {step === 5 && (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold text-foreground mb-1">Ready to generate intelligence report</p>
                <p className="text-sm text-muted-foreground mb-4">Review your inputs, then launch the AI analysis.</p>
              </div>
              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                  <p className="text-xs text-muted-foreground mb-0.5">Target Person</p>
                  <p className="text-sm font-medium text-foreground">{wizard.name}{wizard.title && ` · ${wizard.title}`}{wizard.company && ` @ ${wizard.company}`}</p>
                </div>
                {wizard.sellerContext.companyName && (
                  <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                    <p className="text-xs text-muted-foreground mb-0.5">Your Context</p>
                    <p className="text-sm font-medium text-foreground">{wizard.sellerContext.companyName} · {wizard.sellerContext.product || "—"}{wizard.sellerContext.objectives.length > 0 && ` · ${wizard.sellerContext.objectives.join(" + ")}`}</p>
                  </div>
                )}
                <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                  <p className="text-xs text-muted-foreground mb-1.5">Intelligence Modules ({wizard.goals.length})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {wizard.goals.map(g => {
                      const goal = INTELLIGENCE_GOALS.find(x => x.id === g);
                      return goal ? <Badge key={g} className="bg-violet-500/15 text-violet-300 border-violet-500/20 border text-xs">{goal.label}</Badge> : null;
                    })}
                  </div>
                </div>
                {wizard.knownFacts.trim() && (
                  <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                    <p className="text-xs text-muted-foreground mb-1">Known Facts</p>
                    <p className="text-xs text-foreground/70 line-clamp-3">{wizard.knownFacts}</p>
                  </div>
                )}
              </div>
              <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
                <p className="text-xs text-amber-400/90">
                  <strong>Data transparency:</strong> This report uses AI trained on public knowledge up to its knowledge cutoff. It draws on real public data for known Saudi executives and uses intelligent inference for others. All estimated data is clearly labelled. Always verify critical facts before using in outreach.
                </p>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex gap-3 mt-6">
            {step < 5 && (
              <>
                {step > 1 && (
                  <Button variant="outline" className="border-border/40 text-foreground hover:bg-muted/40" onClick={() => setStep(s => s - 1)}>
                    <ArrowLeft className="w-4 h-4 mr-1.5" />Back
                  </Button>
                )}
                <Button onClick={() => setStep(s => s + 1)} disabled={!canNext()}
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-foreground">
                  {step === 4 ? "Preview" : "Continue"}
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </>
            )}
            {step === 5 && (
              <>
                <Button variant="outline" className="border-border/40 text-foreground hover:bg-muted/40" onClick={() => setStep(4)}>
                  <ArrowLeft className="w-4 h-4 mr-1.5" />Back
                </Button>
                <Button onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-foreground font-semibold">
                  {generateMutation.isPending
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{LOADING_MSGS[loadingMsgIdx]}</>
                    : <><Sparkles className="w-4 h-4 mr-2" />Generate Intelligence Report</>}
                </Button>
              </>
            )}
          </div>
          {generateMutation.isError && (
            <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />Generation failed. Please try again.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );

  // ── Report View ───────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <Button variant="ghost" size="icon" onClick={() => { setProfile(null); setStep(5); }}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-display font-bold text-foreground truncate">{profile.profile?.fullName}</h1>
          <p className="text-xs text-muted-foreground">Intelligence Report · Generated by AI</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" onClick={() => { setProfile(null); setWizard(DEFAULT_WIZARD); setStep(1); setSaved(false); }}
            variant="outline" className="border-border/40 text-foreground hover:bg-muted/40 text-xs">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />New Profile
          </Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saved || saveMutation.isPending}
            className={saved ? "bg-green-600/20 text-green-300 border border-green-600/30" : "bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"}>
            {saved ? <><Check className="w-3.5 h-3.5 mr-1.5" />Saved</> : saveMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Save className="w-3.5 h-3.5 mr-1.5" />Save to Leads</>}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Hero */}
        <Card className="bg-gradient-to-br from-violet-500/15 to-purple-500/5 border-violet-500/25">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                <User className="w-8 h-8 text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-3 flex-wrap">
                  <div>
                    <h2 className="text-2xl font-display font-bold text-foreground">{profile.profile?.fullName}</h2>
                    {profile.profile?.arabicName && !["not found", "n/a", "unknown", "null", "none", "not available", ""].includes(profile.profile.arabicName.toLowerCase().trim()) && <p className="text-base text-violet-300 font-medium mt-0.5">{profile.profile.arabicName}</p>}
                  </div>
                  {profile.intelligence_notes?.confidence_level && (
                    <Badge className={`border text-xs mt-1 ${confidenceColor(profile.intelligence_notes.confidence_level)}`}>
                      <Shield className="w-3 h-3 mr-1" />{profile.intelligence_notes.confidence_level} Confidence
                    </Badge>
                  )}
                  {profile.verdicts?.length ? <VerdictList verdicts={profile.verdicts} /> : null}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
                  {profile.profile?.title && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Briefcase className="w-3.5 h-3.5" />{profile.profile.title}</span>}
                  {profile.profile?.company && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Building2 className="w-3.5 h-3.5" />{profile.profile.company}</span>}
                  {profile.profile?.location && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="w-3.5 h-3.5" />{profile.profile.location}</span>}
                  {profile.profile?.nationality && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Globe className="w-3.5 h-3.5" />{profile.profile.nationality}</span>}
                  {profile.profile?.age && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Calendar className="w-3.5 h-3.5" />Age ~{profile.profile.age}</span>}
                  {wizard.linkedin && <a href={wizard.linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"><Linkedin className="w-3.5 h-3.5" />LinkedIn</a>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Approach Strategy — shown first */}
        {profile.approach_strategy && (wizard.goals.length === 0 || wizard.goals.includes("approach")) && (
          <Section title="B2B Approach Strategy" icon={Target} color="text-primary" defaultOpen>
            <div className="space-y-4">
              {profile.approach_strategy.recommended_approach && (
                <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
                  <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{profile.approach_strategy.recommended_approach}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {profile.approach_strategy.best_channel && (
                  <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                    <p className="text-xs text-muted-foreground mb-1">Best Channel</p>
                    <p className="text-sm font-medium text-foreground">{profile.approach_strategy.best_channel}</p>
                  </div>
                )}
                {profile.approach_strategy.best_timing && (
                  <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                    <p className="text-xs text-muted-foreground mb-1">Best Timing</p>
                    <p className="text-sm font-medium text-foreground">{profile.approach_strategy.best_timing}</p>
                  </div>
                )}
              </div>
              {profile.approach_strategy.opening_angle && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Opening Angle</p>
                  <p className="text-sm text-foreground/80 bg-muted/40 rounded-lg p-3 border border-white/8">{profile.approach_strategy.opening_angle}</p>
                </div>
              )}
              {profile.approach_strategy.value_proposition && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Value Proposition</p>
                  <p className="text-sm text-foreground/80 bg-muted/40 rounded-lg p-3 border border-white/8">{profile.approach_strategy.value_proposition}</p>
                </div>
              )}
              {profile.approach_strategy.cultural_notes && (
                <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
                  <p className="text-xs font-semibold text-amber-400 mb-1">Cultural Notes (Saudi Context)</p>
                  <p className="text-sm text-foreground/80">{profile.approach_strategy.cultural_notes}</p>
                </div>
              )}
              {profile.approach_strategy.conversation_starters && profile.approach_strategy.conversation_starters.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Conversation Starters</p>
                  <div className="flex flex-wrap gap-2">
                    {profile.approach_strategy.conversation_starters.map((s, i) => (
                      <span key={i} className="text-xs px-3 py-1.5 rounded-lg bg-muted/40 border border-border/40 text-foreground/80">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {profile.approach_strategy.potential_objections && profile.approach_strategy.potential_objections.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Potential Objections</p>
                  <ul className="space-y-1">
                    {profile.approach_strategy.potential_objections.map((o, i) => (
                      <li key={i} className="text-sm text-foreground/70 flex gap-2"><span className="text-red-400 shrink-0">×</span>{o}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Wealth */}
        {profile.wealth_profile && (wizard.goals.length === 0 || wizard.goals.includes("wealth")) && (
          <Section title="Wealth & Financial Profile" icon={DollarSign} color="text-emerald-400">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {profile.wealth_profile.estimated_net_worth && (
                  <div className="p-4 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
                    <p className="text-xs text-muted-foreground mb-1">Estimated Net Worth</p>
                    <p className="text-xl font-display font-bold text-emerald-400">{profile.wealth_profile.estimated_net_worth}</p>
                  </div>
                )}
                {profile.wealth_profile.income_estimate && (
                  <div className="p-4 rounded-xl bg-muted/40 border border-white/8">
                    <p className="text-xs text-muted-foreground mb-1">Annual Income Estimate</p>
                    <p className="text-lg font-display font-bold text-foreground">{profile.wealth_profile.income_estimate}</p>
                  </div>
                )}
              </div>
              {profile.wealth_profile.wealth_sources && profile.wealth_profile.wealth_sources.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Wealth Sources</p>
                  <div className="flex flex-wrap gap-2">{profile.wealth_profile.wealth_sources.map((s, i) => <Badge key={i} className="bg-emerald-500/10 text-emerald-300 border-emerald-500/20 border">{s}</Badge>)}</div>
                </div>
              )}
              {profile.wealth_profile.assets && <div className="p-3 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-1">Notable Assets & Holdings</p><p className="text-sm text-foreground/80">{profile.wealth_profile.assets}</p></div>}
              {profile.wealth_profile.investments && <div className="p-3 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-1">Investment Portfolio</p><p className="text-sm text-foreground/80">{profile.wealth_profile.investments}</p></div>}
              {profile.wealth_profile.lifestyle_indicators && <div className="p-3 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-1">Lifestyle Indicators</p><p className="text-sm text-foreground/80">{profile.wealth_profile.lifestyle_indicators}</p></div>}
            </div>
          </Section>
        )}

        {/* Company */}
        {profile.company_analysis && (wizard.goals.length === 0 || wizard.goals.includes("company") || wizard.goals.includes("competitive")) && (
          <Section title="Company Analysis" icon={TrendingUp} color="text-blue-400" defaultOpen={false}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { label: "Industry", value: profile.company_analysis.industry },
                  { label: "Founded", value: profile.company_analysis.founded },
                  { label: "Headquarters", value: profile.company_analysis.headquarters },
                  { label: "Employees", value: profile.company_analysis.employees },
                  { label: "Est. Revenue", value: profile.company_analysis.revenue_estimate },
                  { label: "Market Position", value: profile.company_analysis.market_position },
                ].filter(f => f.value).map(({ label, value }) => (
                  <div key={label} className="p-3 rounded-xl bg-muted/40 border border-white/8">
                    <p className="text-xs text-muted-foreground mb-1">{label}</p>
                    <p className="text-sm font-medium text-foreground">{value}</p>
                  </div>
                ))}
              </div>
              {profile.company_analysis.performance && <div className="p-3 rounded-lg bg-blue-500/8 border border-blue-500/20"><p className="text-xs font-semibold text-blue-400 mb-1">Performance Summary</p><p className="text-sm text-foreground/80">{profile.company_analysis.performance}</p></div>}
              {profile.company_analysis.recent_developments && <div className="p-3 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-1">Recent Developments</p><p className="text-sm text-foreground/80">{profile.company_analysis.recent_developments}</p></div>}
              {profile.company_analysis.pain_points && profile.company_analysis.pain_points.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Likely Business Pain Points</p>
                  <ul className="space-y-1">{profile.company_analysis.pain_points.map((p, i) => <li key={i} className="text-sm text-foreground/70 flex gap-2"><Zap className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />{p}</li>)}</ul>
                </div>
              )}
              {profile.company_analysis.competitors && profile.company_analysis.competitors.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Key Competitors</p>
                  <div className="flex flex-wrap gap-2">{profile.company_analysis.competitors.map((c, i) => <Badge key={i} className="bg-red-500/10 text-red-300 border-red-500/20 border">{c}</Badge>)}</div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Career */}
        {profile.career && profile.career.length > 0 && (wizard.goals.length === 0 || wizard.goals.includes("career")) && (
          <Section title="Career Timeline" icon={Briefcase} color="text-orange-400" defaultOpen={false}>
            <div className="relative pl-5">
              <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-orange-500/40 via-orange-500/20 to-transparent" />
              <div className="space-y-5">
                {profile.career.map((job, i) => (
                  <div key={i} className="relative">
                    <div className="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full bg-orange-500/60 border-2 border-orange-500/30" />
                    <div className="p-3 rounded-xl bg-muted/40 border border-white/8">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold text-foreground">{job.title}</p>
                        <span className="text-xs text-muted-foreground shrink-0">{job.period}</span>
                      </div>
                      <p className="text-xs font-medium text-orange-400 mb-1.5">{job.company}</p>
                      {job.description && <p className="text-xs text-foreground/70 leading-relaxed">{job.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* Education */}
        {profile.education && profile.education.length > 0 && (wizard.goals.length === 0 || wizard.goals.includes("career")) && (
          <Section title="Education" icon={GraduationCap} color="text-indigo-400" defaultOpen={false}>
            <div className="space-y-3">
              {profile.education.map((edu, i) => (
                <div key={i} className="p-3 rounded-xl bg-muted/40 border border-white/8 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0 mt-0.5"><BookOpen className="w-4 h-4 text-indigo-400" /></div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{edu.degree}</p>
                    <p className="text-xs text-indigo-400">{edu.institution}</p>
                    {edu.year && <p className="text-xs text-muted-foreground mt-0.5">{edu.year}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Personal */}
        {profile.personal_profile && (wizard.goals.length === 0 || wizard.goals.includes("personal")) && (
          <Section title="Personal Profile" icon={Heart} color="text-pink-400" defaultOpen={false}>
            <div className="space-y-4">
              {profile.personal_profile.communication_style && <div className="p-3 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-1">Communication Style</p><p className="text-sm text-foreground/80">{profile.personal_profile.communication_style}</p></div>}
              {profile.personal_profile.interests && profile.personal_profile.interests.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Interests</p>
                  <div className="flex flex-wrap gap-2">{profile.personal_profile.interests.map((i, idx) => <span key={idx} className="text-xs px-3 py-1.5 rounded-lg bg-pink-500/10 border border-pink-500/20 text-pink-300">{i}</span>)}</div>
                </div>
              )}
              {profile.personal_profile.personality_traits && profile.personal_profile.personality_traits.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Personality Traits</p>
                  <div className="flex flex-wrap gap-2">{profile.personal_profile.personality_traits.map((t, i) => <Badge key={i} className="bg-muted/40 text-foreground/80 border-border/40 border">{t}</Badge>)}</div>
                </div>
              )}
              {profile.personal_profile.social_presence && <div className="p-3 rounded-lg bg-muted/40 border border-white/8"><p className="text-xs text-muted-foreground mb-1">Social Presence</p><p className="text-sm text-foreground/80">{profile.personal_profile.social_presence}</p></div>}
              {profile.personal_profile.board_memberships && profile.personal_profile.board_memberships.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Board Memberships</p>
                  <ul className="space-y-1">{profile.personal_profile.board_memberships.map((b, i) => <li key={i} className="text-xs text-foreground/80">{b}</li>)}</ul>
                </div>
              )}
              {profile.personal_profile.awards && profile.personal_profile.awards.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Awards & Recognition</p>
                  <ul className="space-y-1">{profile.personal_profile.awards.map((a, i) => <li key={i} className="text-xs text-foreground/80 flex gap-2"><Star className="w-3 h-3 text-yellow-400 shrink-0 mt-0.5" />{a}</li>)}</ul>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Intelligence Notes */}
        {profile.intelligence_notes && (
          <Section title="Data Transparency & Sources" icon={Eye} color="text-muted-foreground" defaultOpen={false}>
            <div className="space-y-3">
              {profile.intelligence_notes.verified_facts && profile.intelligence_notes.verified_facts.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-green-400 mb-2">✓ Confirmed Public Knowledge</p>
                  <ul className="space-y-1">{profile.intelligence_notes.verified_facts.map((f, i) => <li key={i} className="text-xs text-foreground/70 flex gap-2"><span className="text-green-400 shrink-0">✓</span>{f}</li>)}</ul>
                </div>
              )}
              {profile.intelligence_notes.estimated_facts && profile.intelligence_notes.estimated_facts.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-400 mb-2">~ Intelligent Inference (not confirmed)</p>
                  <ul className="space-y-1">{profile.intelligence_notes.estimated_facts.map((f, i) => <li key={i} className="text-xs text-foreground/70 flex gap-2"><span className="text-amber-400 shrink-0">~</span>{f}</li>)}</ul>
                </div>
              )}
              {profile.intelligence_notes.caveats && (
                <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 flex gap-3">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground/70">{profile.intelligence_notes.caveats}</p>
                </div>
              )}
              {profile.intelligence_notes.data_sources && (
                <p className="text-xs text-muted-foreground">Sources: {profile.intelligence_notes.data_sources.join(", ")}</p>
              )}
            </div>
          </Section>
        )}
      </div>
      <ProsEngineChat
        mode="person"
        autoOpen={false}
        context={(() => {
          const p = profile;
          const s = (v: unknown) => Array.isArray(v) ? v.join(", ") : (v != null ? String(v) : "");
          const career = (p.career || []).map((c, i) => `  ${i+1}. ${c.title} @ ${c.company} (${c.period})`).join("\n");
          const edu = (p.education || []).map(e => `  - ${e.degree} — ${e.institution} ${e.year}`).join("\n");
          return [
            `=== PERSON INTELLIGENCE DOSSIER ===`,
            `Subject: ${p.profile?.fullName || wizard.name}${p.profile?.arabicName ? ` (${p.profile.arabicName})` : ""}`,
            `Title: ${p.profile?.title || wizard.title}`,
            `Company: ${p.profile?.company || wizard.company}`,
            `Nationality: ${p.profile?.nationality || ""}  |  Location: ${p.profile?.location || ""}`,
            `Age: ${p.profile?.age || ""}  |  LinkedIn: ${p.profile?.linkedin || ""}`,
            `Confidence: ${p.intelligence_notes?.confidence_level || ""}`,

            p.career?.length ? `\nCAREER HISTORY:\n${career}` : "",
            p.education?.length ? `\nEDUCATION:\n${edu}` : "",

            p.company_analysis ? `\nCOMPANY ANALYSIS:\n  Name: ${s(p.company_analysis.name)}  |  Industry: ${s(p.company_analysis.industry)}\n  Revenue: ${s(p.company_analysis.revenue_estimate)}  |  Employees: ${s(p.company_analysis.employees)}\n  Performance: ${s(p.company_analysis.performance)}\n  Market position: ${s(p.company_analysis.market_position)}\n  Pain points: ${s(p.company_analysis.pain_points)}\n  Competitors: ${s(p.company_analysis.competitors)}\n  Recent: ${s(p.company_analysis.recent_developments)}` : "",

            p.wealth_profile ? `\nWEALTH PROFILE:\n  Net worth: ${s(p.wealth_profile.estimated_net_worth)}\n  Income: ${s(p.wealth_profile.income_estimate)}\n  Sources: ${s(p.wealth_profile.wealth_sources)}\n  Assets: ${s(p.wealth_profile.assets)}\n  Investments: ${s(p.wealth_profile.investments)}\n  Lifestyle: ${s(p.wealth_profile.lifestyle_indicators)}` : "",

            p.personal_profile ? `\nPERSONAL PROFILE:\n  Interests: ${s(p.personal_profile.interests)}\n  Traits: ${s(p.personal_profile.personality_traits)}\n  Style: ${s(p.personal_profile.communication_style)}\n  Languages: ${s(p.personal_profile.languages)}\n  Board: ${s(p.personal_profile.board_memberships)}` : "",

            p.approach_strategy ? `\nAPPROACH STRATEGY:\n  Best channel: ${s(p.approach_strategy.best_channel)}\n  Best timing: ${s(p.approach_strategy.best_timing)}\n  Opening angle: ${s(p.approach_strategy.opening_angle)}\n  Value prop: ${s(p.approach_strategy.value_proposition)}\n  Objections: ${s(p.approach_strategy.potential_objections)}\n  Starters: ${s(p.approach_strategy.conversation_starters)}\n  Cultural: ${s(p.approach_strategy.cultural_notes)}\n  Recommended: ${s(p.approach_strategy.recommended_approach)}\n  Sample msg: ${s(p.approach_strategy.sample_message)}` : "",

            `\nSELLER CONTEXT:\n  Company: ${wizard.sellerContext?.companyName || ""}\n  Product: ${wizard.sellerContext?.product || ""}\n  Objectives: ${wizard.sellerContext?.objectives?.join(" + ") || ""}`,
            `Goals: ${(wizard.goals || []).join(", ")}`,
            wizard.knownFacts ? `Known facts: ${wizard.knownFacts}` : "",
          ].filter(Boolean).join("\n");
        })()}
        initialSuggestions={[
          `What's the best opening line for ${profile.profile?.fullName?.split(" ")[0] || "this person"}?`,
          "What are their likely objections and how do I overcome them?",
          "Who else in this company should I approach?",
        ]}
      />
    </div>
  );
}
