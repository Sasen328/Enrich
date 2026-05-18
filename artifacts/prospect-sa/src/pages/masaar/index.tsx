import { useState, useRef, useEffect, useCallback } from "react";
import {
  Search, Globe, FileText, ShieldCheck, GitMerge, BookOpen, Loader2,
  CheckCircle2, AlertCircle, Clock, ChevronDown, ChevronRight,
  Building2, Users, Landmark, Scale, Copy, Languages, Download,
  AlertTriangle, Info, Layers, Network, ExternalLink, Hash,
  KeyRound, Send, RefreshCw, Bot, Zap, Shield, Eye, ToggleLeft, ToggleRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

interface AgentEvent {
  type:
    | "agent_start" | "agent_log" | "agent_complete" | "agent_error"
    | "captcha_required" | "captcha_solved"
    | "stealth_solving" | "stealth_solved" | "stealth_session"
    | "job_complete" | "job_error";
  agentNum?: number;
  agentName?: string;
  message?: string;
  data?: Record<string, unknown>;
  report?: MasaarReport;
  captchaFor?: string;
  captchaScreenshot?: string;
  captchaLabel?: string;
  stealthMethod?: "ai" | "human" | "session";
  captchaCode?: string;
}

interface CaptchaRequest {
  captchaFor: string;
  screenshot: string;
  label: string;
  agentNum?: number;
}

interface AgentState {
  num: number;
  name: string;
  status: "pending" | "running" | "done" | "error" | "waiting_captcha" | "stealth_solving";
  logs: string[];
  data?: Record<string, unknown>;
}

interface MasaarReport {
  crNumber: string;
  fetchedAt: string;
  stealthMode: boolean;
  parsed: {
    nameEn: string;
    nameAr: string;
    crNumber: string;
    legalForm: string;
    legalFormAr: string;
    headquarterCity: string;
    headquarterCityAr: string;
    foundingYear: string;
    fiscalYear: string;
    capitalAmount: string;
    capitalDistribution: string;
    estimatedRevenue: string;
    summaryEn: string;
    summaryAr: string;
    contactDetails: Record<string, string>;
    shareholders: Array<{ nameEn: string; nameAr: string; nationalId: string; ownershipPct: string; nationality: string }>;
    managers: Array<{ nameEn: string; nameAr: string; nationalId: string; appointmentTerm: string; powers: string }>;
    boardComposition: string;
    shareTransferRestrictions: string;
    profitDistributionRules: string;
    dissolutionConditions: string;
    amendmentProcedures: string;
  };
  legalAgencies: Array<Record<string, unknown>>;
  conflicts: Array<{ field: string; source1: string; value1: string; source2: string; value2: string; severity?: string; recommendation?: string }>;
  reportEn: string;
  reportAr: string;
}

// ─── Agent config ─────────────────────────────────────────────────────────

const AGENTS = [
  { num: 1, name: "MC.gov.sa Browser",        icon: Globe,      color: "text-blue-400",   desc: "Stealth browser navigates mc.gov.sa — AI auto-solves CAPTCHA" },
  { num: 2, name: "Claude CR Parser",          icon: Layers,     color: "text-violet-400", desc: "Extracts all CR fields bilingually from the page text" },
  { num: 3, name: "Emagazine Search",          icon: Search,     color: "text-amber-400",  desc: "Searches emagazine.aamaly.sa for articles and AOA PDFs" },
  { num: 4, name: "AOA PDF Parser",            icon: FileText,   color: "text-emerald-400",desc: "Downloads Arabic AOA PDF and extracts all 15+ legal fields" },
  { num: 5, name: "Najiz Legal Agencies",      icon: Scale,      color: "text-rose-400",   desc: "Fetches legal agency records from najiz.sa Ministry of Justice" },
  { num: 6, name: "Cross-Validator",           icon: GitMerge,   color: "text-orange-400", desc: "Compares all sources and flags data conflicts" },
  { num: 7, name: "Report Compiler",           icon: BookOpen,   color: "text-cyan-400",   desc: "Compiles full bilingual EN + AR intelligence report" },
];

// ─── Manual CAPTCHA Overlay (fallback when AI fails) ─────────────────────

function CaptchaOverlay({
  request, jobId, onSolved, onError,
}: {
  request: CaptchaRequest;
  jobId: string;
  onSolved: (captchaFor: string) => void;
  onError: (msg: string) => void;
}) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    if (!code.trim()) return;
    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch(`/api/masaar/captcha/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captchaText: code.trim(), captchaFor: request.captchaFor }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "Failed to submit CAPTCHA");
      }
      onSolved(request.captchaFor);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Submission failed");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <Card className="border-rose-500/30 bg-[#0e0e14] shadow-2xl shadow-rose-500/10 w-full max-w-xl mx-4">
        <CardHeader className="pb-2 px-5 pt-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-rose-500/15 border border-rose-500/30 rounded-lg flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-rose-400" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">Manual CAPTCHA Required</p>
              <p className="text-xs text-muted-foreground">AI could not auto-solve — your input needed</p>
            </div>
            <Badge variant="outline" className="ml-auto text-[9px] border-rose-500/30 text-rose-400 bg-rose-500/10">
              FALLBACK MODE
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-4">
          <p className="text-sm text-muted-foreground">{request.label}</p>
          <div className="rounded-xl overflow-hidden border border-white/10 bg-black">
            <img src={`data:image/png;base64,${request.screenshot}`} alt="CAPTCHA screenshot" className="w-full object-contain max-h-72" />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The AI stealth agent attempted but could not read this CAPTCHA. Find the verification code above and type it below.
          </p>
          {err && (
            <div className="flex items-center gap-2 text-rose-400 bg-rose-500/5 border border-rose-500/15 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-sm">{err}</p>
            </div>
          )}
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) submit(); }}
              placeholder="Type the verification code..."
              className="bg-black/40 border-rose-500/20 focus:border-rose-500/50 h-11 font-mono text-white tracking-widest uppercase"
              disabled={submitting}
            />
            <Button onClick={submit} disabled={!code.trim() || submitting} className="bg-rose-500 hover:bg-rose-400 text-white font-bold h-11 px-5 gap-2 shrink-0">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/60 text-center">You have 3 minutes to enter the code. The pipeline is paused.</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Stealth Solving Indicator ────────────────────────────────────────────

function StealthSolvingBadge() {
  return (
    <Badge className="text-[9px] bg-violet-500/15 text-violet-300 border border-violet-500/30 h-4 px-1.5 gap-1 animate-pulse">
      <Bot className="w-2.5 h-2.5" />
      AI SOLVING
    </Badge>
  );
}

// ─── Agent Card ──────────────────────────────────────────────────────────

function AgentCard({ agent, state }: { agent: typeof AGENTS[0]; state: AgentState }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = agent.icon;

  const borderColor =
    state.status === "running"         ? "border-primary/40 bg-primary/5 shadow-primary/10 shadow-lg" :
    state.status === "stealth_solving" ? "border-violet-500/50 bg-violet-500/8 shadow-violet-500/10 shadow-lg" :
    state.status === "waiting_captcha" ? "border-rose-500/40 bg-rose-500/5 shadow-rose-500/10 shadow-lg" :
    state.status === "done"            ? "border-emerald-500/20 bg-emerald-500/3" :
    state.status === "error"           ? "border-rose-500/20 bg-rose-500/3" :
    "border-white/6 bg-black/10";

  return (
    <Card className={cn("border transition-all duration-300", borderColor)}>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border",
            state.status === "running"         ? "bg-primary/15 border-primary/30" :
            state.status === "stealth_solving" ? "bg-violet-500/20 border-violet-500/40" :
            state.status === "waiting_captcha" ? "bg-rose-500/20 border-rose-500/40" :
            state.status === "done"            ? "bg-emerald-500/10 border-emerald-500/20" :
            state.status === "error"           ? "bg-rose-500/10 border-rose-500/20" :
            "bg-white/4 border-white/8"
          )}>
            <Icon className={cn("w-4 h-4", state.status === "pending" ? "text-muted-foreground" : agent.color)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-muted-foreground">AGENT {agent.num}</span>
              <span className="font-semibold text-sm text-white">{agent.name}</span>
              {state.status === "stealth_solving" && <StealthSolvingBadge />}
              {state.status === "waiting_captcha" && (
                <Badge className="text-[9px] bg-rose-500/15 text-rose-400 border-rose-500/30 border h-4 px-1.5 gap-1 animate-pulse">
                  <KeyRound className="w-2.5 h-2.5" /> MANUAL NEEDED
                </Badge>
              )}
            </div>
            {state.logs.length > 0 && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{state.logs[state.logs.length - 1]}</p>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {state.status === "running"         && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
            {state.status === "stealth_solving" && <Bot className="w-4 h-4 text-violet-400 animate-pulse" />}
            {state.status === "waiting_captcha" && <KeyRound className="w-4 h-4 text-rose-400 animate-pulse" />}
            {state.status === "done"            && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {state.status === "error"           && <AlertCircle className="w-4 h-4 text-rose-400" />}
            {state.status === "pending"         && <Clock className="w-4 h-4 text-muted-foreground/40" />}
            {state.logs.length > 0 && (expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />)}
          </div>
        </CardContent>
      </button>
      {expanded && state.logs.length > 0 && (
        <CardContent className="px-4 pb-3 pt-0 border-t border-white/5">
          <div className="bg-black/30 rounded-lg p-2 mt-2 space-y-1 max-h-48 overflow-y-auto">
            {state.logs.map((line, i) => (
              <p key={i} className={cn(
                "text-xs font-mono leading-snug",
                line.startsWith("✓")  ? "text-emerald-400" :
                line.startsWith("⚠")  ? "text-amber-400" :
                line.startsWith("🤖") ? "text-violet-300" :
                line.startsWith("🥷") ? "text-violet-400" :
                line.startsWith("🛡") ? "text-violet-300" :
                line.startsWith("⏳") ? "text-blue-300" :
                line.startsWith("ERROR") ? "text-rose-400" :
                "text-white/60"
              )}>
                {line}
              </p>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function FieldRow({ label, value, valueAr }: { label: string; value?: string | null; valueAr?: string | null }) {
  if (!value && !valueAr) return null;
  return (
    <div className="grid grid-cols-3 gap-3 py-2 border-b border-white/4 last:border-0">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="text-sm text-white">{value || "—"}</p>
      <p className="text-sm text-white/70 text-right" dir="rtl">{valueAr || "—"}</p>
    </div>
  );
}

function ShareholderTable({ shareholders }: { shareholders: MasaarReport["parsed"]["shareholders"] }) {
  if (!shareholders?.length) return <p className="text-sm text-muted-foreground">No shareholder data found</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-white/10">
          {["Name (EN)", "الاسم", "National ID", "Ownership %", "Nationality"].map((h) => (
            <th key={h} className="text-left text-xs font-bold text-muted-foreground pb-2 pr-4">{h}</th>
          ))}
        </tr></thead>
        <tbody>{shareholders.map((sh, i) => (
          <tr key={i} className="border-b border-white/4 hover:bg-white/3">
            <td className="py-2 pr-4 text-white">{sh.nameEn || "—"}</td>
            <td className="py-2 pr-4 text-white/80" dir="rtl">{sh.nameAr || "—"}</td>
            <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">{sh.nationalId || "—"}</td>
            <td className="py-2 pr-4"><Badge variant="outline" className="text-xs border-primary/30 text-primary bg-primary/5">{sh.ownershipPct || "—"}</Badge></td>
            <td className="py-2 text-muted-foreground">{sh.nationality || "—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ManagerTable({ managers }: { managers: MasaarReport["parsed"]["managers"] }) {
  if (!managers?.length) return <p className="text-sm text-muted-foreground">No manager data found</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-white/10">
          {["Name (EN)", "الاسم", "National ID", "Term", "Powers"].map((h) => (
            <th key={h} className="text-left text-xs font-bold text-muted-foreground pb-2 pr-4">{h}</th>
          ))}
        </tr></thead>
        <tbody>{managers.map((m, i) => (
          <tr key={i} className="border-b border-white/4 hover:bg-white/3">
            <td className="py-2 pr-4 text-white">{m.nameEn || "—"}</td>
            <td className="py-2 pr-4 text-white/80">{m.nameAr || "—"}</td>
            <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">{m.nationalId || "—"}</td>
            <td className="py-2 pr-4 text-muted-foreground">{m.appointmentTerm || "—"}</td>
            <td className="py-2 text-white/60 text-xs max-w-[200px] truncate">{m.powers || "—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ConflictList({ conflicts }: { conflicts: MasaarReport["conflicts"] }) {
  if (!conflicts?.length) return (
    <div className="flex items-center gap-2 text-emerald-400 py-6">
      <CheckCircle2 className="w-4 h-4" />
      <p className="text-sm font-semibold">No conflicts detected — all sources agree</p>
    </div>
  );
  return (
    <div className="space-y-2">
      {conflicts.map((c, i) => (
        <Card key={i} className={cn("border", c.severity === "high" ? "border-rose-500/30 bg-rose-500/5" : "border-amber-500/20 bg-amber-500/5")}>
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className={cn("w-4 h-4 mt-0.5 shrink-0", c.severity === "high" ? "text-rose-400" : "text-amber-400")} />
              <div className="flex-1">
                <p className="font-semibold text-sm text-white">{c.field}</p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div><p className="text-xs text-muted-foreground">{c.source1}</p><p className="text-xs text-white/80">{c.value1}</p></div>
                  <div><p className="text-xs text-muted-foreground">{c.source2}</p><p className="text-xs text-white/80">{c.value2}</p></div>
                </div>
                {c.recommendation && <p className="text-xs text-muted-foreground mt-1 italic">{c.recommendation}</p>}
              </div>
              <Badge variant="outline" className={cn("text-[9px] shrink-0", c.severity === "high" ? "text-rose-400 border-rose-500/30" : "text-amber-400 border-amber-500/30")}>
                {c.severity || "medium"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MarkdownRenderer({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {text.split("\n").map((line, i) => {
        if (line.startsWith("## "))  return <h2 key={i} className="text-lg font-bold text-white mt-4 mb-2 pb-1 border-b border-white/10">{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={i} className="text-base font-semibold text-primary mt-3 mb-1">{line.slice(4)}</h3>;
        if (line.startsWith("#### ")) return <h4 key={i} className="text-sm font-semibold text-white/80 mt-2 mb-1">{line.slice(5)}</h4>;
        if (line.startsWith("- ") || line.startsWith("* ")) return <li key={i} className="ml-4 text-white/70 list-disc">{line.slice(2)}</li>;
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i} className="text-white/70">{line}</p>;
      })}
    </div>
  );
}

// ─── Stealth Mode Toggle ──────────────────────────────────────────────────

function StealthModeToggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all duration-200",
        enabled
          ? "bg-violet-500/15 border-violet-500/30 text-violet-300 hover:bg-violet-500/25"
          : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {enabled ? <Shield className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      {enabled ? "Stealth Mode ON" : "Stealth Mode OFF"}
      {enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

type PipelineStatus = "idle" | "running" | "done" | "error";

export default function MasaarPage() {
  const [crInput, setCrInput] = useState("");
  const [stealthMode, setStealthMode] = useState(true);
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [jobId, setJobId] = useState("");
  const [agents, setAgents] = useState<AgentState[]>(
    AGENTS.map((a) => ({ num: a.num, name: a.name, status: "pending", logs: [] }))
  );
  const [report, setReport] = useState<MasaarReport | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [reportLang, setReportLang] = useState<"en" | "ar">("en");
  const [activeTab, setActiveTab] = useState("pipeline");
  const [captchaQueue, setCaptchaQueue] = useState<CaptchaRequest[]>([]);
  const [stealthEvents, setStealthEvents] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => logsEndRef.current?.scrollIntoView({ behavior: "smooth" });

  const handleEvent = useCallback((event: AgentEvent) => {
    setAgents((prev) => {
      const next = prev.map((a) => ({ ...a }));

      if (event.type === "agent_start" && event.agentNum) {
        const idx = event.agentNum - 1;
        if (next[idx]) next[idx].status = "running";
      } else if (event.type === "agent_log" && event.agentNum) {
        const idx = event.agentNum - 1;
        if (next[idx] && event.message) {
          next[idx].logs = [...next[idx].logs, event.message];
          scrollToBottom();
        }
      } else if (event.type === "stealth_solving" && event.agentNum) {
        const idx = event.agentNum - 1;
        if (next[idx]) {
          next[idx].status = "stealth_solving";
          if (event.message) next[idx].logs = [...next[idx].logs, event.message];
        }
      } else if (event.type === "stealth_solved" && event.agentNum) {
        const idx = event.agentNum - 1;
        if (next[idx]) {
          next[idx].status = "running";
          if (event.message) next[idx].logs = [...next[idx].logs, event.message];
        }
      } else if (event.type === "captcha_required" && event.agentNum) {
        const idx = event.agentNum - 1;
        if (next[idx]) {
          next[idx].status = "waiting_captcha";
          if (event.message) next[idx].logs = [...next[idx].logs, `⚠ ${event.message}`];
        }
      } else if (event.type === "captcha_solved" && event.agentNum) {
        const idx = event.agentNum - 1;
        if (next[idx]) next[idx].status = "running";
      } else if (event.type === "agent_complete" && event.agentNum) {
        const idx = event.agentNum - 1;
        if (next[idx]) {
          next[idx].status = "done";
          if (event.data) next[idx].data = event.data;
        }
      } else if (event.type === "agent_error" && event.agentNum) {
        const idx = event.agentNum - 1;
        if (next[idx]) {
          next[idx].status = "error";
          if (event.message) next[idx].logs = [...next[idx].logs, `ERROR: ${event.message}`];
        }
      }
      return next;
    });

    // Track stealth events
    if (event.type === "stealth_solving" && event.message) {
      setStealthEvents((s) => [...s.slice(-9), event.message!]);
    }
    if (event.type === "stealth_solved" && event.message) {
      setStealthEvents((s) => [...s.slice(-9), event.message!]);
    }

    // Human fallback CAPTCHA
    if (event.type === "captcha_required" && event.captchaFor && event.captchaScreenshot) {
      setCaptchaQueue((q) => [...q, {
        captchaFor: event.captchaFor!,
        screenshot: event.captchaScreenshot!,
        label: event.captchaLabel || "Enter the verification code shown",
        agentNum: event.agentNum,
      }]);
    }
    if (event.type === "captcha_solved") {
      setCaptchaQueue((q) => q.filter((r) => r.captchaFor !== event.captchaFor));
    }

    if (event.type === "job_complete" && event.report) {
      setReport(event.report);
      setStatus("done");
      setActiveTab("report");
      esRef.current?.close();
    }
    if (event.type === "job_error") {
      setErrorMsg(event.message || "Pipeline failed");
      setStatus("error");
      esRef.current?.close();
    }
  }, []);

  const startPipeline = async () => {
    const crNum = crInput.trim();
    if (!crNum) return;

    setStatus("running");
    setErrorMsg("");
    setReport(null);
    setActiveTab("pipeline");
    setCaptchaQueue([]);
    setStealthEvents([]);
    setAgents(AGENTS.map((a) => ({ num: a.num, name: a.name, status: "pending", logs: [] })));

    try {
      const res = await fetch("/api/masaar/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crNumber: crNum, stealthMode }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to start pipeline");
      }
      const { jobId: newJobId } = await res.json();
      setJobId(newJobId);

      if (esRef.current) esRef.current.close();
      const es = new EventSource(`/api/masaar/stream/${newJobId}`);
      esRef.current = es;

      es.onmessage = (e) => {
        try { handleEvent(JSON.parse(e.data) as AgentEvent); } catch { /* ignore */ }
      };
      es.onerror = () => {
        if (status !== "done") { setErrorMsg("Connection lost"); setStatus("error"); }
        es.close();
      };
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  };

  useEffect(() => () => { esRef.current?.close(); }, []);

  const doneCount = agents.filter((a) => a.status === "done").length;
  const runningAgent = agents.find((a) => a.status === "running" || a.status === "stealth_solving");
  const waitingCaptcha = agents.some((a) => a.status === "waiting_captcha");
  const stealthSolving = agents.some((a) => a.status === "stealth_solving");
  const currentCaptcha = captchaQueue[0] || null;

  return (
    <div className="space-y-5 h-full flex flex-col animate-in fade-in duration-400">
      {/* Manual CAPTCHA fallback overlay */}
      {currentCaptcha && jobId && (
        <CaptchaOverlay
          request={currentCaptcha}
          jobId={jobId}
          onSolved={(captchaFor) => {
            setCaptchaQueue((q) => q.filter((r) => r.captchaFor !== captchaFor));
            setAgents((prev) => prev.map((a) => a.status === "waiting_captcha" ? { ...a, status: "running" } : a));
          }}
          onError={(msg) => setErrorMsg(msg)}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-amber-500/20 to-orange-500/20 rounded-xl border border-amber-500/20 flex items-center justify-center">
          <Landmark className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-display font-bold text-white">Masaar — CR Lookup Engine</h1>
            {stealthMode && (
              <Badge className="bg-violet-500/20 border border-violet-500/30 text-violet-300 text-[10px] gap-1 px-2">
                <Shield className="w-3 h-3" /> STEALTH
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            7-Agent Saudi CR Intelligence · {stealthMode ? "AI Auto-Solves CAPTCHAs" : "Manual CAPTCHA Mode"} · Claude Sonnet
          </p>
        </div>
        <StealthModeToggle enabled={stealthMode} onChange={setStealthMode} disabled={status === "running"} />
      </div>

      {/* Stealth mode info banner */}
      {stealthMode && status === "idle" && (
        <div className="flex items-start gap-3 bg-violet-500/8 border border-violet-500/20 rounded-xl px-4 py-3">
          <Bot className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-violet-300 mb-0.5">Stealth Agent Active</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Agent 1 uses a fingerprint-spoofed browser with human-like mouse movements and typing delays.
              When a CAPTCHA appears, Claude Vision reads and auto-fills it (up to 3 retries).
              Session cookies are cached so verified domains won't need re-solving.
              Manual input is only requested if AI fails all 3 attempts.
            </p>
          </div>
        </div>
      )}

      {/* Input card */}
      <Card className="bg-card/60 border-white/8">
        <CardContent className="py-4 px-5">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5" /> Saudi Commercial Registration Number
              </p>
              <Input
                value={crInput}
                onChange={(e) => setCrInput(e.target.value.replace(/\D/g, "").slice(0, 12))}
                onKeyDown={(e) => { if (e.key === "Enter" && crInput.length >= 7 && status !== "running") startPipeline(); }}
                placeholder="e.g. 1010123456 (7-12 digits)"
                className="bg-black/30 border-white/15 h-12 text-lg font-mono tracking-widest"
                maxLength={12}
                disabled={status === "running"}
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                {stealthMode
                  ? "Stealth browser navigates mc.gov.sa — Claude Vision auto-solves the CAPTCHA"
                  : "Agent 1 will screenshot the CAPTCHA — you'll need to enter the code manually"}
              </p>
            </div>
            <Button
              onClick={startPipeline}
              disabled={crInput.length < 7 || status === "running"}
              className={cn(
                "h-12 px-8 font-bold gap-2 shrink-0 text-black",
                stealthMode ? "bg-violet-500 hover:bg-violet-400" : "bg-amber-500 hover:bg-amber-400"
              )}
            >
              {status === "running"
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : stealthMode ? <Zap className="w-4 h-4" /> : <Search className="w-4 h-4" />}
              {status === "running" ? "Running..." : "Run Masaar"}
            </Button>
          </div>

          {/* Progress bar */}
          {status === "running" && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  {stealthSolving
                    ? <><Bot className="w-3 h-3 text-violet-400" /> AI solving CAPTCHA automatically...</>
                    : waitingCaptcha
                    ? <><KeyRound className="w-3 h-3 text-rose-400" /> Manual CAPTCHA needed — check the overlay</>
                    : runningAgent
                    ? `Agent ${runningAgent.num}: ${runningAgent.name}`
                    : "Initializing..."}
                </p>
                <p className={cn("text-xs font-bold", stealthSolving ? "text-violet-400" : waitingCaptcha ? "text-rose-400" : "text-amber-400")}>
                  {doneCount}/7 complete
                </p>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    stealthSolving ? "bg-violet-500 animate-pulse" :
                    waitingCaptcha  ? "bg-rose-400 animate-pulse" :
                    "bg-gradient-to-r from-violet-500 to-amber-400"
                  )}
                  style={{ width: `${Math.max(3, (doneCount / 7) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="mt-3 flex items-center gap-2 text-rose-400 bg-rose-500/5 border border-rose-500/15 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-sm flex-1">{errorMsg}</p>
              <Button size="sm" variant="outline" onClick={startPipeline} className="border-rose-500/20 text-rose-400 h-7 text-xs gap-1">
                <RefreshCw className="w-3 h-3" /> Retry
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live stealth events feed */}
      {stealthEvents.length > 0 && status === "running" && (
        <Card className="bg-violet-500/5 border-violet-500/20">
          <CardContent className="py-2.5 px-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Bot className="w-3.5 h-3.5 text-violet-400" />
              <p className="text-xs font-bold text-violet-300">Stealth Agent Activity</p>
            </div>
            <div className="space-y-0.5">
              {stealthEvents.slice(-3).map((ev, i) => (
                <p key={i} className="text-xs font-mono text-violet-200/70 truncate">{ev}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick stats after report */}
      {report && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "CR Number",  value: report.crNumber,                                     icon: Hash,          color: "text-amber-400" },
            { label: "Company",    value: report.parsed.nameEn || report.parsed.nameAr || "—", icon: Building2,     color: "text-blue-400" },
            { label: "City",       value: report.parsed.headquarterCity || "—",                icon: Landmark,      color: "text-emerald-400" },
            { label: "Conflicts",  value: String(report.conflicts.length),                      icon: AlertTriangle, color: report.conflicts.length > 0 ? "text-rose-400" : "text-emerald-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card/40 border-white/8">
              <CardContent className="py-3 px-4 flex items-center gap-3">
                <Icon className={cn("w-4 h-4 shrink-0", color)} />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="text-sm font-semibold text-white truncate">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Main Tabs */}
      {(status !== "idle" || report) && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="bg-white/5 border border-white/10 w-fit shrink-0">
            <TabsTrigger value="pipeline" className="gap-2 data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-400">
              <Network className="w-4 h-4" /> Pipeline
              {status === "running" && (
                <Badge className={cn(
                  "text-[9px] border-0 h-4 px-1.5",
                  stealthSolving  ? "bg-violet-500/30 text-violet-300 animate-pulse" :
                  waitingCaptcha  ? "bg-rose-500/30 text-rose-300 animate-pulse" :
                  "bg-amber-500/20 text-amber-400"
                )}>
                  {stealthSolving ? "AI" : waitingCaptcha ? "CAPTCHA" : `${doneCount}/7`}
                </Badge>
              )}
            </TabsTrigger>
            {report && (
              <>
                <TabsTrigger value="report" className="gap-2 data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-400">
                  <BookOpen className="w-4 h-4" /> Report
                </TabsTrigger>
                <TabsTrigger value="structured" className="gap-2 data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-400">
                  <Layers className="w-4 h-4" /> Structured Data
                </TabsTrigger>
                {report.conflicts.length > 0 && (
                  <TabsTrigger value="conflicts" className="gap-2 data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-400">
                    <AlertTriangle className="w-4 h-4" /> Conflicts
                    <Badge className="text-[9px] bg-rose-500/20 text-rose-400 border-0 h-4 px-1.5">{report.conflicts.length}</Badge>
                  </TabsTrigger>
                )}
              </>
            )}
          </TabsList>

          {/* Pipeline */}
          <TabsContent value="pipeline" className="flex-1 mt-4 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {AGENTS.map((agentCfg) => (
                <AgentCard key={agentCfg.num} agent={agentCfg} state={agents[agentCfg.num - 1]} />
              ))}
            </div>
            <div ref={logsEndRef} />
          </TabsContent>

          {/* Report */}
          {report && (
            <TabsContent value="report" className="flex-1 mt-4 overflow-hidden">
              <Card className="bg-card/50 border-white/8 h-full flex flex-col">
                <CardHeader className="pb-3 px-5 pt-4 shrink-0">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-amber-400" />
                      {reportLang === "en" ? "English Intelligence Report" : "تقرير الاستخبارات بالعربي"}
                      {report.stealthMode && <Badge className="text-[9px] bg-violet-500/15 text-violet-300 border border-violet-500/20 gap-1"><Bot className="w-2.5 h-2.5" /> Stealth</Badge>}
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setReportLang(reportLang === "en" ? "ar" : "en")} className="gap-1.5 border-white/10 text-xs h-7">
                        <Languages className="w-3 h-3" /> {reportLang === "en" ? "عربي" : "English"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(reportLang === "en" ? report.reportEn : report.reportAr)} className="gap-1.5 border-white/10 text-xs h-7">
                        <Copy className="w-3 h-3" /> Copy
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => {
                        const bothReports = `CR: ${report.crNumber}\nFetched: ${report.fetchedAt}\n\n${"=".repeat(60)}\nENGLISH REPORT\n${"=".repeat(60)}\n\n${report.reportEn}\n\n${"=".repeat(60)}\nتقرير عربي\n${"=".repeat(60)}\n\n${report.reportAr}`;
                        const blob = new Blob([bothReports], { type: "text/plain;charset=utf-8" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `masaar-cr-${report.crNumber}-${new Date().toISOString().slice(0,10)}.txt`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }} className="gap-1.5 border-white/10 text-xs h-7">
                        <Download className="w-3 h-3" /> Export
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => {
                        const structured = JSON.stringify(report, null, 2);
                        const blob = new Blob([structured], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `masaar-cr-${report.crNumber}-${new Date().toISOString().slice(0,10)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }} className="gap-1.5 border-white/10 text-xs h-7">
                        <FileText className="w-3 h-3" /> JSON
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 overflow-y-auto flex-1">
                  <div dir={reportLang === "ar" ? "rtl" : "ltr"}>
                    <MarkdownRenderer text={reportLang === "en" ? report.reportEn : report.reportAr} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Structured Data */}
          {report && (
            <TabsContent value="structured" className="flex-1 mt-4 overflow-y-auto space-y-4 pb-4">
              <Card className="bg-card/50 border-white/8">
                <CardHeader className="pb-2 px-5 pt-4">
                  <CardTitle className="text-sm text-white flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-400" /> Company Identity</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <FieldRow label="Company Name"      value={report.parsed.nameEn}           valueAr={report.parsed.nameAr} />
                  <FieldRow label="CR Number"         value={report.parsed.crNumber} />
                  <FieldRow label="Legal Form"        value={report.parsed.legalForm}        valueAr={report.parsed.legalFormAr} />
                  <FieldRow label="Headquarter City"  value={report.parsed.headquarterCity}  valueAr={report.parsed.headquarterCityAr} />
                  <FieldRow label="Founded"           value={report.parsed.foundingYear} />
                  <FieldRow label="Fiscal Year"       value={report.parsed.fiscalYear} />
                  <FieldRow label="Capital"           value={report.parsed.capitalAmount} />
                  <FieldRow label="Est. Revenue"      value={report.parsed.estimatedRevenue} />
                </CardContent>
              </Card>

              {(report.parsed.summaryEn || report.parsed.summaryAr) && (
                <Card className="bg-card/50 border-white/8">
                  <CardHeader className="pb-2 px-5 pt-4">
                    <CardTitle className="text-sm text-white flex items-center gap-2"><Info className="w-4 h-4 text-violet-400" /> Company Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {report.parsed.summaryEn && <div><p className="text-xs font-bold text-muted-foreground mb-1">English</p><p className="text-sm text-white/80 leading-relaxed">{report.parsed.summaryEn}</p></div>}
                    {report.parsed.summaryAr && <div dir="rtl"><p className="text-xs font-bold text-muted-foreground mb-1">عربي</p><p className="text-sm text-white/80 leading-relaxed">{report.parsed.summaryAr}</p></div>}
                  </CardContent>
                </Card>
              )}

              <Card className="bg-card/50 border-white/8">
                <CardHeader className="pb-2 px-5 pt-4">
                  <CardTitle className="text-sm text-white flex items-center gap-2"><Users className="w-4 h-4 text-emerald-400" /> Shareholders ({report.parsed.shareholders?.length || 0})</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4"><ShareholderTable shareholders={report.parsed.shareholders} /></CardContent>
              </Card>

              <Card className="bg-card/50 border-white/8">
                <CardHeader className="pb-2 px-5 pt-4">
                  <CardTitle className="text-sm text-white flex items-center gap-2"><Landmark className="w-4 h-4 text-amber-400" /> Managers & Governance ({report.parsed.managers?.length || 0})</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <ManagerTable managers={report.parsed.managers} />
                  {report.parsed.boardComposition && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <p className="text-xs font-bold text-muted-foreground mb-1">Board Composition</p>
                      <p className="text-sm text-white/70">{report.parsed.boardComposition}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-card/50 border-white/8">
                <CardHeader className="pb-2 px-5 pt-4">
                  <CardTitle className="text-sm text-white flex items-center gap-2"><Scale className="w-4 h-4 text-rose-400" /> AOA Legal Provisions</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4 space-y-3">
                  {[
                    { label: "Capital Distribution",        value: report.parsed.capitalDistribution },
                    { label: "Share Transfer Restrictions", value: report.parsed.shareTransferRestrictions },
                    { label: "Profit Distribution Rules",   value: report.parsed.profitDistributionRules },
                    { label: "Dissolution Conditions",      value: report.parsed.dissolutionConditions },
                    { label: "Amendment Procedures",        value: report.parsed.amendmentProcedures },
                  ].filter(({ value }) => value).map(({ label, value }) => (
                    <div key={label} className="bg-black/15 rounded-lg p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
                      <p className="text-sm text-white/75">{value}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {report.parsed.contactDetails && Object.keys(report.parsed.contactDetails).length > 0 && (
                <Card className="bg-card/50 border-white/8">
                  <CardHeader className="pb-2 px-5 pt-4">
                    <CardTitle className="text-sm text-white flex items-center gap-2"><ExternalLink className="w-4 h-4 text-cyan-400" /> Contact Details</CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-4">
                    {Object.entries(report.parsed.contactDetails).filter(([, v]) => v).map(([k, v]) => (
                      <FieldRow key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} value={v} />
                    ))}
                  </CardContent>
                </Card>
              )}

              {report.legalAgencies?.length > 0 && (
                <Card className="bg-card/50 border-white/8">
                  <CardHeader className="pb-2 px-5 pt-4">
                    <CardTitle className="text-sm text-white flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-violet-400" /> Legal Agencies (Najiz)</CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 pb-4 space-y-1">
                    {report.legalAgencies.slice(0, 10).map((a, i) => (
                      <p key={i} className="text-xs text-white/60 py-1 border-b border-white/5 last:border-0">{String(a.text || a.name || JSON.stringify(a)).slice(0, 200)}</p>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}

          {/* Conflicts */}
          {report && report.conflicts.length > 0 && (
            <TabsContent value="conflicts" className="flex-1 mt-4 overflow-y-auto pb-4">
              <ConflictList conflicts={report.conflicts} />
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Empty state */}
      {status === "idle" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12 gap-6">
          <div className="relative">
            <div className="w-20 h-20 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center">
              <Landmark className="w-10 h-10 text-amber-400" />
            </div>
            {stealthMode && (
              <div className="absolute -top-2 -right-2 w-7 h-7 bg-violet-500/20 border border-violet-500/30 rounded-lg flex items-center justify-center">
                <Bot className="w-3.5 h-3.5 text-violet-400" />
              </div>
            )}
          </div>
          <div>
            <h3 className="text-xl font-bold text-white mb-2">Saudi CR Intelligence Pipeline</h3>
            <p className="text-muted-foreground max-w-lg text-sm leading-relaxed">
              {stealthMode
                ? <>Enter any Saudi CR number. The <strong className="text-violet-300">stealth agent</strong> opens mc.gov.sa with a fingerprint-spoofed browser, uses <strong className="text-white">Claude Vision</strong> to auto-read the CAPTCHA, then all 7 agents run fully automatically.</>
                : <>Enter any Saudi CR number. Agent 1 opens mc.gov.sa — you'll see a screenshot and enter the CAPTCHA manually. The remaining 6 agents then run automatically.</>}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left max-w-lg w-full">
            {AGENTS.map((a) => {
              const Icon = a.icon;
              const isStealthAgent = stealthMode && (a.num === 1 || a.num === 3);
              return (
                <div key={a.num} className={cn(
                  "flex items-start gap-2 p-2.5 rounded-lg border",
                  isStealthAgent ? "bg-violet-500/5 border-violet-500/20" : "bg-white/3 border-white/6"
                )}>
                  {isStealthAgent && <Bot className="w-4 h-4 mt-0.5 shrink-0 text-violet-400" />}
                  {!isStealthAgent && <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", a.color)} />}
                  <div>
                    <p className="text-xs font-semibold text-white">Agent {a.num}: {a.name}</p>
                    <p className="text-[10px] text-muted-foreground leading-snug">{a.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
