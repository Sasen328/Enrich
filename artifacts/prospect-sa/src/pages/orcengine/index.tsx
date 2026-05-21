import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cpu, Globe, Search, FileText, Download, MessageSquare, Loader2,
  Building2, User, CheckCircle2, Plus, X, Send,
  BookOpen, ChevronDown, ChevronRight, Copy,
  BarChart3, Brain, ScanSearch, FileOutput,
  Layers, Play, ExternalLink, Clock, Zap, AlertCircle,
  ShieldCheck, Database,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const API = "/api/orcengine";

// ─── Shared export helper ─────────────────────────────────────────────────────

async function triggerDownload(res: Response) {
  if (!res.ok) throw new Error("Export failed");
  const data = await res.json() as { filename: string; content: string; mimeType: string };
  let blob: Blob;
  if (data.mimeType.includes("excel") || data.mimeType.includes("spreadsheet") || data.mimeType.includes("openxml")) {
    const bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
    blob = new Blob([bytes], { type: data.mimeType });
  } else {
    blob = new Blob([data.content], { type: data.mimeType });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = data.filename; a.click();
  URL.revokeObjectURL(url);
}

function ExportButtons({ onExport, exporting, reportId }: {
  onExport: (fmt: string) => void;
  exporting: string | null;
  reportId?: number;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {[
        { fmt: "pdf",   label: "PDF",   cls: "border-rose-500/30 text-rose-400" },
        { fmt: "word",  label: "Word",  cls: "border-blue-500/30 text-blue-400" },
        { fmt: "excel", label: "Excel", cls: "border-emerald-500/30 text-emerald-400" },
        { fmt: "json",  label: "JSON",  cls: "border-white/15 text-muted-foreground" },
      ].map(({ fmt, label, cls }) => (
        <Button key={fmt} size="sm" variant="outline"
          onClick={() => onExport(fmt)}
          disabled={exporting === `${reportId}-${fmt}` || exporting === fmt}
          className={cn("h-7 px-2 text-[10px] border gap-1", cls)}>
          {(exporting === `${reportId}-${fmt}` || exporting === fmt) ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Download className="w-2.5 h-2.5" />}
          {label}
        </Button>
      ))}
    </div>
  );
}

// ─── Enrichment Agents ────────────────────────────────────────────────────────

const ENRICH_AGENTS = [
  { id: "perplexity", label: "Perplexity Search",   icon: Search,       color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
  { id: "crawler",    label: "Web Crawler",          icon: Globe,        color: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/20" },
  { id: "openai",     label: "OpenAI GPT-4o",        icon: Brain,        color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20" },
  { id: "apollo",     label: "Apollo Contact Intel", icon: User,         color: "text-cyan-400",   bg: "bg-cyan-500/10 border-cyan-500/20" },
  { id: "playwright", label: "Playwright Render",    icon: Layers,       color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
  { id: "crossverify",label: "Cross-Verify",         icon: ShieldCheck,  color: "text-rose-400",   bg: "bg-rose-500/10 border-rose-500/20" },
  { id: "compiler",   label: "Data Compiler",        icon: Database,     color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20" },
  { id: "quality",    label: "Quality Validation",   icon: CheckCircle2, color: "text-primary",    bg: "bg-primary/10 border-primary/20" },
];


// ─── Save to Companies DB Button ─────────────────────────────────────────────
function SaveToDBButton({ reportId }: { reportId: string }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const save = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (saving || saved) return;
    setSaving(true); setError("");
    try {
      const res = await fetch(`${BASE}/api/orcengine/enrich/${reportId}/save-to-companies`, { method: "POST" });
      const data = await res.json() as { action: string; companyId: number; name: string };
      if (!res.ok) throw new Error((data as any).error || "Failed");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <button onClick={save} title={saved ? "Saved to companies DB" : "Save to MeshBase companies DB"}
      className={`text-[10px] font-medium px-2 py-1 rounded-md border transition-all flex items-center gap-1 shrink-0 ${
        saved ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
        : error ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
        : "bg-primary/10 border-primary/20 text-primary hover:bg-primary/20"
      }`}>
      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : saved ? <CheckCircle2 className="w-3 h-3" /> : <Database className="w-3 h-3" />}
      {saved ? "Saved" : error ? "Error" : "Save to DB"}
    </button>
  );
}

// ─── Enrichment Tab ───────────────────────────────────────────────────────────

function EnrichmentTab() {
  const [mode, setMode] = useState<"company" | "person">("company");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [context, setContext] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [agentPhase, setAgentPhase] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [chatReportId, setChatReportId] = useState<number | null>(null);
  const [chatMsg, setChatMsg] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string }[]>([]);
  const qc = useQueryClient();

  const { data: reports = [] } = useQuery<Record<string, unknown>[]>({
    queryKey: ["orc-enrich-reports"],
    queryFn: () => fetch(`${API}/enrich/reports`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const enrichMutation = useMutation({
    mutationFn: async () => {
      const endpoint = mode === "company" ? "company" : "person";
      const res = await fetch(`${API}/enrich/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, website: website || undefined, linkedinUrl: linkedinUrl || undefined, context: context || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Enrichment failed");
      return res.json();
    },
    onSuccess: () => {
      setName(""); setWebsite(""); setLinkedinUrl(""); setContext("");
      qc.invalidateQueries({ queryKey: ["orc-enrich-reports"] });
    },
  });

  const chatMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/enrich/${chatReportId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatMsg }),
      });
      if (!res.ok) throw new Error("Chat failed");
      return res.json() as Promise<{ response: string }>;
    },
    onSuccess: (data) => {
      setChatHistory((prev) => [...prev, { role: "user", content: chatMsg }, { role: "assistant", content: data.response }]);
      setChatMsg("");
    },
  });

  useEffect(() => {
    if (!enrichMutation.isPending) { setAgentPhase(0); return; }
    setAgentPhase(1);
    const iv = setInterval(() => {
      setAgentPhase((p) => {
        if (p >= ENRICH_AGENTS.length) { clearInterval(iv); return p; }
        return p + 1;
      });
    }, 1900);
    return () => clearInterval(iv);
  }, [enrichMutation.isPending]);

  const handleExportReport = async (report: Record<string, unknown>, fmt: string) => {
    const key = `${report.id}-${fmt}`;
    setExporting(key);
    try {
      const data = (report.reportData || {}) as Record<string, unknown>;
      const res = await fetch(`${API}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(report.subjectName || "Enrichment Report"),
          type: "enrichment",
          data: { records: [{ ...data, subject: report.subjectName, type: report.type, date: report.createdAt }] },
          format: fmt === "xlsx" ? "excel" : fmt,
        }),
      });
      await triggerDownload(res);
    } catch { /* ignore */ } finally { setExporting(null); }
  };

  const reportList = Array.isArray(reports) ? reports : [];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">

      {/* ── LEFT: Input form ── */}
      <div className="xl:col-span-2 space-y-4">
        <Card className="bg-card/70 border-white/8">
          <CardContent className="py-5 px-5 space-y-4">
            {/* Mode toggle */}
            <div className="flex gap-2">
              {(["company", "person"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all flex-1 justify-center",
                    mode === m ? "border-primary/50 bg-primary/15 text-primary" : "border-border/40 text-muted-foreground hover:border-white/20")}>
                  {m === "company" ? <Building2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
                  {m === "company" ? "Company" : "Person"}
                </button>
              ))}
            </div>

            {/* Primary input */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                {mode === "company" ? "Company Name" : "Person Name"}
              </p>
              <Input value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && name) enrichMutation.mutate(); }}
                placeholder={mode === "company" ? "Saudi Aramco, stc, SABIC, Almarai..." : "Ahmed Al-Rashid, exec name..."}
                className="bg-black/30 border-white/15 h-10" />
            </div>

            {/* Website URL */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Website URL (optional)</p>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://company.com.sa"
                className="bg-black/30 border-white/15 h-9 text-sm" />
            </div>

            {/* LinkedIn URL */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">LinkedIn URL (optional)</p>
              <Input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://linkedin.com/in/..."
                className="bg-black/30 border-white/15 h-9 text-sm" />
            </div>

            {/* Context toggle */}
            <button onClick={() => setShowContext((v) => !v)}
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              <ChevronDown className={cn("w-3 h-3 transition-transform", showContext && "rotate-180")} />
              Additional context
            </button>
            {showContext && (
              <Textarea value={context} onChange={(e) => setContext(e.target.value)}
                placeholder="Add any known details to boost enrichment accuracy..."
                className="bg-black/30 border-white/15 text-sm min-h-[70px] resize-none" />
            )}

            <Button onClick={() => enrichMutation.mutate()} disabled={!name || enrichMutation.isPending}
              className="w-full h-11 bg-primary hover:bg-primary/90 gap-2">
              {enrichMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
              {enrichMutation.isPending ? "Running 8-Agent Pipeline..." : "Run Enrichment"}
            </Button>
            {enrichMutation.isError && <p className="text-xs text-rose-400">{enrichMutation.error?.message}</p>}
          </CardContent>
        </Card>

        {/* Agent pipeline status */}
        {enrichMutation.isPending && (
          <Card className="bg-violet-500/5 border-violet-500/20">
            <CardContent className="py-4 px-4 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-400 mb-3">Intelligence Pipeline</p>
              {ENRICH_AGENTS.map((agent, i) => {
                const isDone    = i < agentPhase - 1;
                const isRunning = i === agentPhase - 1;
                const isPending = i >= agentPhase;
                return (
                  <div key={agent.id} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 border transition-all",
                    isRunning ? agent.bg : isDone ? "bg-emerald-500/5 border-emerald-500/15" : "bg-white/2 border-border/30")}>
                    <div className={cn("w-5 h-5 rounded-full flex items-center justify-center shrink-0",
                      isDone ? "bg-emerald-500/20" : isRunning ? "bg-primary/20" : "bg-muted/40")}>
                      {isDone    && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      {isRunning && <Loader2 className={cn("w-3 h-3 animate-spin", agent.color)} />}
                      {isPending && <div className="w-1.5 h-1.5 rounded-full bg-white/20" />}
                    </div>
                    <p className={cn("text-xs font-medium",
                      isDone ? "text-emerald-400" : isRunning ? "text-foreground" : "text-foreground/30")}>
                      {agent.label}
                    </p>
                    {isDone && <span className="text-[9px] text-emerald-400 ml-auto">✓</span>}
                    {isRunning && <span className="text-[9px] text-primary ml-auto animate-pulse">running</span>}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Chat panel */}
        {chatReportId && (
          <Card className="bg-violet-500/5 border-violet-500/20">
            <CardHeader className="pb-2 pt-4 px-5 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-violet-400" /> Ask about this report
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => { setChatReportId(null); setChatHistory([]); }}
                className="h-7 w-7 p-0 text-muted-foreground"><X className="w-3.5 h-3.5" /></Button>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-3">
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {chatHistory.map((m, i) => (
                  <div key={i} className={cn("rounded-lg p-2.5 text-sm", m.role === "user" ? "bg-primary/10 text-primary" : "bg-muted/40 text-foreground/80")}>
                    {m.content}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={chatMsg} onChange={(e) => setChatMsg(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && chatMsg) chatMutation.mutate(); }}
                  placeholder="Ask a follow-up question..."
                  className="bg-black/30 border-white/15 h-9 text-sm" />
                <Button size="sm" onClick={() => chatMutation.mutate()} disabled={!chatMsg || chatMutation.isPending}
                  className="h-9 px-3 bg-violet-600 hover:bg-violet-700">
                  {chatMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── RIGHT: Reports ── */}
      <div className="xl:col-span-3 space-y-3">
        {reportList.length === 0 && !enrichMutation.isPending && (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Brain className="w-12 h-12 opacity-10 mb-3" />
            <p className="text-sm font-medium">No enrichment reports yet</p>
            <p className="text-xs mt-1">Enter a company or person name on the left and run enrichment</p>
          </div>
        )}
        {reportList.map((report, i) => {
          const data = (report.reportData || {}) as Record<string, unknown>;
          const sources = (report.sources || []) as unknown[];
          return (
            <Card key={String(report.id || i)} className="bg-card/75 border-white/8">
              <button onClick={() => setExpanded(expanded === i ? null : i)} className="w-full text-left">
                <CardContent className="py-3 px-5 flex items-center gap-3">
                  {report.type === "company"
                    ? <Building2 className="w-4 h-4 text-primary shrink-0" />
                    : <User className="w-4 h-4 text-violet-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-sm">{String(report.subjectName || "Unknown")}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {String(report.type)} · {sources.length} sources · {new Date(String(report.createdAt)).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 bg-emerald-500/10 shrink-0">AI Enriched</Badge>
                  {report.type === "company" && (
                    <SaveToDBButton reportId={String(report.id)} />
                  )}
                  {expanded === i ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </CardContent>
              </button>
              {expanded === i && (
                <CardContent className="px-5 pb-5 pt-0 border-t border-border/30 space-y-3">
                  {/* Export row */}
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Export Report</p>
                    <ExportButtons onExport={(fmt) => handleExportReport(report, fmt)} exporting={exporting} reportId={report.id as number} />
                  </div>

                  {/* Summary */}
                  {data.profileSummary && (
                    <div className="bg-black/20 rounded-xl p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Summary</p>
                      <p className="text-sm text-foreground/80 leading-relaxed">{String(data.profileSummary)}</p>
                    </div>
                  )}

                  {/* Key fields grid */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {Object.entries(data)
                      .filter(([k, v]) => v && !Array.isArray(v) && typeof v !== "object" && k !== "profileSummary")
                      .slice(0, 12)
                      .map(([k, v]) => (
                        <div key={k} className="bg-black/20 rounded-lg p-2.5">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">
                            {k.replace(/([A-Z])/g, " $1").trim()}
                          </p>
                          <p className="text-xs text-foreground truncate">{String(v)}</p>
                        </div>
                      ))}
                  </div>

                  {/* Leadership */}
                  {(data.leadership as Record<string, unknown>)?.executiveTeam && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Executive Team</p>
                      <div className="grid grid-cols-2 gap-2">
                        {((data.leadership as Record<string, unknown>).executiveTeam as Record<string, unknown>[])
                          .filter(Boolean).slice(0, 6).map((exec, ei) => (
                            <div key={ei} className="bg-primary/5 border border-primary/10 rounded-lg p-2.5">
                              <p className="text-xs font-medium text-foreground">{String(exec?.name || "")}</p>
                              <p className="text-[10px] text-muted-foreground">{String(exec?.title || "")}</p>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Sources */}
                  {sources.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Sources ({sources.length})</p>
                      <div className="flex flex-wrap gap-1">
                        {sources.slice(0, 6).map((s: unknown, si) => {
                          const src = s as Record<string, unknown>;
                          return (
                            <span key={si} className="text-[9px] bg-muted/40 border border-white/8 rounded px-1.5 py-0.5 text-muted-foreground truncate max-w-[180px]">
                              {String(src.title || src.url || "")}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => { setChatReportId(report.id as number); setChatHistory([]); }}
                      className="gap-1.5 border-violet-500/30 text-violet-400 text-xs h-7">
                      <MessageSquare className="w-3 h-3" /> Chat
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}
                      className="gap-1.5 border-border/40 text-xs h-7">
                      <Copy className="w-3 h-3" /> Copy JSON
                    </Button>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Scrape & Chat Tab ────────────────────────────────────────────────────────

const SCRAPE_AGENTS = [
  { id: "playwright", label: "Playwright Crawler",  desc: "JS-rendered page extraction",  icon: Globe,    color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  { id: "crawl4ai",   label: "Crawl4AI",            desc: "AI-ready markdown extraction", icon: Brain,    color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
  { id: "browser",    label: "BrowserHelper",        desc: "DOM processing & JS exec",     icon: Layers,   color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/20" },
  { id: "perplexity", label: "Perplexity Search",   desc: "AI search fallback",           icon: Search,   color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20" },
];

function ScrapeTab() {
  const [urls, setUrls] = useState([""]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [scrapePhase, setScrapePhase] = useState(0);
  const [chatMsg, setChatMsg] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string }[]>([]);
  const [exporting, setExporting] = useState(false);
  const [seedResult, setSeedResult] = useState<{ seeded: number; skipped: number; jobId: string } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const sessionQuery = useQuery({
    queryKey: ["orc-scrape", sessionId],
    queryFn: () => fetch(`${API}/scrape/${sessionId}`).then((r) => r.json()),
    enabled: !!sessionId,
    refetchInterval: (data) => {
      const d = data?.state?.data as Record<string, unknown>;
      return d?.status === "scraping" ? 2500 : false;
    },
  });

  const scrapeMutation = useMutation({
    mutationFn: async () => {
      const validUrls = urls.filter((u) => u.trim());
      const res = await fetch(`${API}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: validUrls }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json() as Promise<{ id: number }>;
    },
    onSuccess: (data) => { setSessionId(data.id); setChatHistory([]); setScrapePhase(1); setSeedResult(null); },
  });

  const chatMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/scrape/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatMsg }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json() as Promise<{ answer: string }>;
    },
    onSuccess: (data) => {
      setChatHistory((prev) => [...prev, { role: "user", content: chatMsg }, { role: "assistant", content: data.answer }]);
      setChatMsg("");
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/scrape/${sessionId}/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json() as Promise<{ seeded: number; skipped: number; jobId: string }>;
    },
    onSuccess: (data) => setSeedResult(data),
  });

  useEffect(() => {
    if (!scrapeMutation.isPending && scrapePhase === 0) return;
    if (!scrapeMutation.isPending) { setScrapePhase(SCRAPE_AGENTS.length + 1); return; }
    const iv = setInterval(() => {
      setScrapePhase((p) => {
        if (p >= SCRAPE_AGENTS.length) { clearInterval(iv); return p; }
        return p + 1;
      });
    }, 2400);
    return () => clearInterval(iv);
  }, [scrapeMutation.isPending]);

  const session = sessionQuery.data;
  const isReady = session?.status === "ready";
  const knowledgeBase = (session?.knowledgeBase || []) as unknown[];
  const progress = session?.progress ?? 0;

  const handleExportSession = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${API}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `OrcEngine Deep-Seed Session #${sessionId}`,
          type: "scrape",
          data: { records: knowledgeBase },
          format: "json",
        }),
      });
      await triggerDownload(res);
    } catch { /* ignore */ } finally { setExporting(false); }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

      {/* ── LEFT: URL inputs + agent pipeline ── */}
      <div className="space-y-4">
        <Card className="bg-card/70 border-white/8">
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" /> Target URLs
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-2">
            {urls.map((u, i) => (
              <div key={i} className="flex gap-2">
                <Input value={u} onChange={(e) => setUrls((prev) => { const n = [...prev]; n[i] = e.target.value; return n; })}
                  placeholder="https://example.com.sa"
                  className="bg-black/30 border-white/15 h-9 text-sm" />
                {urls.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => setUrls((prev) => prev.filter((_, j) => j !== i))}
                    className="h-9 w-9 p-0 text-muted-foreground"><X className="w-3.5 h-3.5" /></Button>
                )}
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setUrls((prev) => [...prev, ""])}
              className="gap-1.5 text-xs border-border/40 h-7 mt-1">
              <Plus className="w-3 h-3" /> Add URL
            </Button>
            <Button onClick={() => scrapeMutation.mutate()} disabled={scrapeMutation.isPending || !urls.some((u) => u.trim())}
              className="w-full bg-primary hover:bg-primary/90 gap-2 mt-2">
              {scrapeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
              {scrapeMutation.isPending ? "Launching agents..." : "Deep-Seed Research"}
            </Button>
            {scrapeMutation.isError && <p className="text-xs text-rose-400">{scrapeMutation.error?.message}</p>}
          </CardContent>
        </Card>

        {/* Agent pipeline */}
        <Card className="bg-card/75 border-white/8">
          <CardContent className="py-4 px-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Multi-Agent Pipeline</p>
            <div className="space-y-2">
              {SCRAPE_AGENTS.map((agent, i) => {
                const isDone    = scrapePhase > i + 1;
                const isRunning = scrapePhase === i + 1;
                return (
                  <div key={agent.id} className={cn("flex items-start gap-2.5 rounded-lg p-2.5 border transition-all",
                    isRunning ? agent.bg : isDone ? "bg-emerald-500/5 border-emerald-500/10" : "bg-white/2 border-border/30")}>
                    <div className={cn("w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      isDone ? "bg-emerald-500/20" : isRunning ? "bg-white/10" : "bg-muted/40")}>
                      {isDone    && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      {isRunning && <Loader2 className={cn("w-3 h-3 animate-spin", agent.color)} />}
                      {!isDone && !isRunning && <div className="w-1.5 h-1.5 rounded-full bg-white/20" />}
                    </div>
                    <div>
                      <p className={cn("text-xs font-medium", isDone ? "text-emerald-400" : isRunning ? "text-foreground" : "text-foreground/30")}>
                        {agent.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{agent.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── CENTER: Session status + company profiles ── */}
      <div className="space-y-4">
        {session && (
          <Card className={cn("border", isReady ? "bg-emerald-500/5 border-emerald-500/20" : "bg-amber-500/5 border-amber-500/20")}>
            <CardContent className="py-4 px-5">
              <div className="flex items-center gap-3 mb-3">
                {isReady
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  : <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{isReady ? "Deep-Seed Complete" : "Multi-agent research in progress..."}</p>
                  <p className="text-xs text-muted-foreground">Session #{session.id} · {knowledgeBase.length}/{(session.urls as string[])?.length ?? "?"} companies</p>
                </div>
              </div>

              {/* Progress bar */}
              {!isReady && (
                <div className="mb-3">
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full transition-all duration-700" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 text-right">{progress}% complete</p>
                </div>
              )}

              {isReady && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleExportSession} disabled={exporting}
                      className="flex-1 border-border/40 text-xs gap-1.5">
                      {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      Export JSON
                    </Button>
                    <Button size="sm" onClick={() => seedMutation.mutate()}
                      disabled={seedMutation.isPending || !!seedResult}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-xs gap-1.5">
                      {seedMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                      {seedResult ? `Seeded ${seedResult.seeded}` : "Seed to OrcBase"}
                    </Button>
                  </div>
                  {seedResult && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                      <p className="text-xs text-emerald-400 font-medium">{seedResult.seeded} profiles saved to AI Database Builder</p>
                      {seedResult.skipped > 0 && <p className="text-[10px] text-muted-foreground">{seedResult.skipped} skipped (duplicates/errors)</p>}
                    </div>
                  )}
                  {seedMutation.isError && <p className="text-xs text-rose-400">{seedMutation.error?.message}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Company profiles list */}
        {knowledgeBase.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Company Profiles ({knowledgeBase.length})
            </p>
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {knowledgeBase.map((item: unknown, i) => {
                const p = item as Record<string, unknown>;
                const social = p.socialMedia as Record<string, unknown> | undefined;
                const people = (p.keyPeople || p.management || []) as Array<Record<string, unknown>>;
                return (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-xl p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground truncate">{String(p.nameEn || p._sourceUrl || `Company ${i + 1}`)}</p>
                        {p.nameAr && <p className="text-xs text-muted-foreground" dir="rtl">{String(p.nameAr)}</p>}
                      </div>
                      {p.website && (
                        <a href={String(p.website)} target="_blank" rel="noreferrer"
                          className="shrink-0 text-primary hover:text-primary/80">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1.5">
                      {p.industry && <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] font-medium">{String(p.industry)}</span>}
                      {p.city && <span className="bg-muted/40 text-foreground/60 px-2 py-0.5 rounded-full text-[10px]">{String(p.city)}</span>}
                      {p.crNumber && <span className="bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full text-[10px] font-mono">CR: {String(p.crNumber)}</span>}
                      {p.employees && <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full text-[10px]">{String(p.employees)} emp.</span>}
                      {p.revenue && <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full text-[10px]">{String(p.revenue)}</span>}
                    </div>

                    {/* CEO + contact */}
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      {p.ceo && (
                        <div>
                          <p className="text-muted-foreground">CEO</p>
                          <p className="text-foreground font-medium truncate">{String(p.ceo)}</p>
                        </div>
                      )}
                      {p.phone && (
                        <div>
                          <p className="text-muted-foreground">Phone</p>
                          <p className="text-foreground font-medium">{String(p.phone)}</p>
                        </div>
                      )}
                      {p.email && (
                        <div className="col-span-2">
                          <p className="text-muted-foreground">Email</p>
                          <p className="text-foreground font-medium truncate">{String(p.email)}</p>
                        </div>
                      )}
                    </div>

                    {/* Description */}
                    {p.description && (
                      <p className="text-[11px] text-foreground/60 leading-relaxed line-clamp-3">{String(p.description)}</p>
                    )}

                    {/* Key people preview */}
                    {people.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground mb-1">Key People</p>
                        <div className="space-y-1">
                          {people.slice(0, 3).map((person, j) => (
                            <div key={j} className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                <User className="w-2.5 h-2.5 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <span className="text-[10px] text-foreground font-medium truncate">{String(person.nameEn || "Unknown")}</span>
                                {person.role && <span className="text-[10px] text-muted-foreground ml-1">· {String(person.role)}</span>}
                              </div>
                              {person.linkedin && (
                                <a href={String(person.linkedin)} target="_blank" rel="noreferrer"
                                  className="shrink-0 text-blue-400 hover:text-blue-300 ml-auto">
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Social media */}
                    {social && Object.values(social).some(Boolean) && (
                      <div className="flex gap-2 flex-wrap">
                        {social.linkedin && <a href={String(social.linkedin)} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:underline">LinkedIn</a>}
                        {social.twitter && <a href={String(social.twitter)} target="_blank" rel="noreferrer" className="text-[10px] text-sky-400 hover:underline">Twitter</a>}
                        {social.instagram && <a href={String(social.instagram)} target="_blank" rel="noreferrer" className="text-[10px] text-pink-400 hover:underline">Instagram</a>}
                        {social.youtube && <a href={String(social.youtube)} target="_blank" rel="noreferrer" className="text-[10px] text-rose-400 hover:underline">YouTube</a>}
                      </div>
                    )}

                    {/* AI insights */}
                    {p.aiInsights && (
                      <div className="bg-violet-500/5 border border-violet-500/15 rounded-lg px-3 py-2">
                        <p className="text-[10px] font-bold text-violet-400 mb-1">AI Insight</p>
                        <p className="text-[10px] text-foreground/60 leading-relaxed line-clamp-3">{String(p.aiInsights)}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!session && !scrapeMutation.isPending && (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground border border-border/30 rounded-xl bg-white/2">
            <ScanSearch className="w-10 h-10 opacity-10 mb-3" />
            <p className="text-sm">Add company URLs and launch deep-seed</p>
            <p className="text-xs opacity-60 mt-1">12 AI agents will extract full company intelligence</p>
          </div>
        )}
      </div>

      {/* ── RIGHT: Chat with profiles ── */}
      <Card className="bg-card/75 border-white/8 flex flex-col" style={{ minHeight: 420 }}>
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-violet-400" /> Chat with Profiles
          </CardTitle>
          <p className="text-[10px] text-muted-foreground">Ask anything about the researched companies</p>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto px-5 pb-0 space-y-3" style={{ maxHeight: 380 }}>
          {chatHistory.length === 0
            ? (
              <div className="py-10 text-center space-y-2">
                <Brain className="w-8 h-8 opacity-10 mx-auto" />
                <p className="text-xs text-muted-foreground">Scrape URLs then ask anything</p>
                <div className="space-y-1 mt-4">
                  {["Who is the CEO and their background?", "What are their key clients and revenue?", "How should I approach them for a sale?"].map((q) => (
                    <button key={q} onClick={() => { if (isReady) { setChatMsg(q); } }}
                      className="block w-full text-left text-[10px] text-muted-foreground hover:text-foreground bg-white/3 hover:bg-muted/40 border border-border/30 rounded-lg px-3 py-1.5 transition-colors">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )
            : chatHistory.map((m, i) => (
              <div key={i} className={cn("rounded-xl p-3 text-sm", m.role === "user" ? "bg-primary/10 text-primary ml-8" : "bg-muted/40 text-foreground/80 mr-8")}>
                {m.content}
              </div>
            ))
          }
          <div ref={chatEndRef} />
        </CardContent>
        <div className="px-5 pb-5 pt-3 border-t border-border/30 mt-3">
          <div className="flex gap-2">
            <Input value={chatMsg} onChange={(e) => setChatMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && chatMsg && isReady) chatMutation.mutate(); }}
              placeholder={isReady ? "Ask about these companies..." : "Scrape URLs first..."}
              disabled={!isReady || chatMutation.isPending}
              className="bg-black/30 border-white/15 h-9 text-sm" />
            <Button size="sm" onClick={() => chatMutation.mutate()} disabled={!chatMsg || !isReady || chatMutation.isPending}
              className="h-9 px-3 bg-primary hover:bg-primary/90">
              {chatMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Research Tab ─────────────────────────────────────────────────────────────

const RESEARCH_PHASES = [
  { key: "pending",    label: "Queued",     pct: 0   },
  { key: "planning",   label: "Planning",   pct: 10  },
  { key: "searching",  label: "Searching",  pct: 30  },
  { key: "extracting", label: "Extracting", pct: 50  },
  { key: "analyzing",  label: "Analyzing",  pct: 65  },
  { key: "verifying",  label: "Verifying",  pct: 80  },
  { key: "compiling",  label: "Compiling",  pct: 90  },
  { key: "completed",  label: "Complete",   pct: 100 },
  { key: "failed",     label: "Failed",     pct: 100 },
];

const DATA_SOURCES = [
  { id: "perplexity", label: "Perplexity AI", color: "text-violet-400 border-violet-500/30 bg-violet-500/10" },
  { id: "apollo",     label: "Apollo.io",     color: "text-blue-400 border-blue-500/30 bg-blue-500/10"       },
  { id: "web",        label: "Web Crawler",   color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
];

const REPORT_FORMATS = ["Structured Analysis","Executive Summary","Bullet Points","Comparative Table","SWOT Analysis"];
const TIME_FRAMES    = ["Last 30 days","Last 90 days","Last 6 months","Last year","All time"];

function ResearchTab() {
  const [query, setQuery]             = useState("");
  const [enhancing, setEnhancing]     = useState(false);
  const [selectedSources, setSources] = useState<string[]>(["perplexity", "web"]);
  const [deepVerify, setDeepVerify]   = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filterCountry, setCountry]   = useState("Saudi Arabia");
  const [filterFormat, setFormat]     = useState("Structured Analysis");
  const [filterTime, setTimeFrame]    = useState("Last year");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [chatMsg, setChatMsg]         = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string }[]>([]);
  const [exporting, setExporting]     = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data: jobs = [] } = useQuery<Record<string, unknown>[]>({
    queryKey: ["orc-research-jobs"],
    queryFn: () => fetch(`${API}/research`).then((r) => r.json()),
    refetchInterval: 6000,
  });

  const activeJobQuery = useQuery({
    queryKey: ["orc-research-job", activeJobId],
    queryFn: () => fetch(`${API}/research/${activeJobId}`).then((r) => r.json()),
    enabled: !!activeJobId,
    refetchInterval: (q) => {
      const status = (q?.state?.data as Record<string, unknown>)?.status as string;
      return status && !["completed","failed"].includes(status) ? 2000 : false;
    },
  });

  const researchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          sources: selectedSources,
          deepVerify,
          filters: { country: filterCountry, reportFormat: filterFormat, timeFrame: filterTime },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json() as Promise<{ jobId: string }>;
    },
    onSuccess: (data) => {
      setActiveJobId(String(data.jobId));
      setQuery("");
      setChatHistory([]);
      qc.invalidateQueries({ queryKey: ["orc-research-jobs"] });
    },
  });

  const chatMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/research/${activeJobId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatMsg }),
      });
      if (!res.ok) throw new Error("Chat failed");
      return res.json() as Promise<{ response: string }>;
    },
    onSuccess: (data) => {
      setChatHistory((prev) => [...prev,
        { role: "user", content: chatMsg },
        { role: "assistant", content: data.response },
      ]);
      setChatMsg("");
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
  });

  const handleEnhance = async () => {
    if (!query.trim()) return;
    setEnhancing(true);
    try {
      const res = await fetch(`${API}/enhance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (data.enhancedQuery) setQuery(data.enhancedQuery);
    } catch { /* ignore */ } finally { setEnhancing(false); }
  };

  const toggleSource = (id: string) =>
    setSources((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);

  const handleExport = async (format: string) => {
    if (!activeJobId) return;
    setExporting(format);
    try {
      const res = await fetch(`${API}/research/${activeJobId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json() as { filename: string; content: string; mimeType: string };
      let blob: Blob;
      if (format === "excel") {
        const bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
        blob = new Blob([bytes], { type: data.mimeType });
      } else {
        blob = new Blob([data.content], { type: data.mimeType });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = data.filename; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ } finally { setExporting(null); }
  };

  const activeJob   = activeJobQuery.data as Record<string, unknown> | undefined;
  const report      = activeJob?.report as Record<string, unknown> | undefined;
  const jobStatus   = String(activeJob?.status || "");
  const jobProgress = typeof activeJob?.progress === "number" ? activeJob.progress : 0;
  const isRunning   = jobStatus && !["completed","failed",""].includes(jobStatus);
  const isComplete  = jobStatus === "completed";
  const isFailed    = jobStatus === "failed";
  const phaseIdx    = RESEARCH_PHASES.findIndex((p) => p.key === jobStatus);
  const jobSources  = (activeJob?.sources || []) as { url: string; title: string; reliability: number }[];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      {/* ── LEFT: Config panel ── */}
      <div className="xl:col-span-1 space-y-4">
        <Card className="bg-card/70 border-white/8">
          <CardContent className="py-4 px-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Research Query</p>
            <Textarea value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Analyze Saudi fintech ecosystem 2025 · Top construction companies in Riyadh · Vision 2030 healthcare opportunities"
              className="bg-black/30 border-white/15 text-sm min-h-[90px] resize-none" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleEnhance} disabled={!query || enhancing}
                className="gap-1.5 border-violet-500/30 text-violet-400 text-xs h-8">
                {enhancing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                AI Enhance
              </Button>
              <Button onClick={() => researchMutation.mutate()}
                disabled={!query || researchMutation.isPending || selectedSources.length === 0}
                className="flex-1 bg-primary hover:bg-primary/90 gap-2 h-8 text-sm">
                {researchMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
                Run Research
              </Button>
            </div>
            {researchMutation.isError && <p className="text-xs text-rose-400">{researchMutation.error?.message}</p>}
          </CardContent>
        </Card>

        <Card className="bg-card/70 border-white/8">
          <CardContent className="py-4 px-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Data Sources</p>
            {DATA_SOURCES.map((src) => (
              <button key={src.id} onClick={() => toggleSource(src.id)}
                className={cn("w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium transition-all",
                  selectedSources.includes(src.id) ? src.color : "border-white/8 text-muted-foreground hover:border-white/15")}>
                {src.label}
                {selectedSources.includes(src.id) && <CheckCircle2 className="w-3.5 h-3.5" />}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card/70 border-white/8">
          <CardContent className="py-4 px-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-foreground">Deep Verify</p>
                <p className="text-[10px] text-muted-foreground">Cross-check findings across sources</p>
              </div>
              <button onClick={() => setDeepVerify((v) => !v)}
                className={cn("w-10 h-5 rounded-full border transition-all relative",
                  deepVerify ? "bg-primary border-primary" : "bg-white/10 border-white/15")}>
                <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
                  deepVerify ? "left-5" : "left-0.5")} />
              </button>
            </div>
            <button onClick={() => setShowFilters((v) => !v)}
              className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors">
              <span className="font-semibold">Advanced Filters</span>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showFilters && "rotate-180")} />
            </button>
            {showFilters && (
              <div className="space-y-2 pt-1 border-t border-white/8">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Country Focus</p>
                  <Input value={filterCountry} onChange={(e) => setCountry(e.target.value)}
                    className="bg-black/30 border-white/15 h-7 text-xs" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Report Format</p>
                  <div className="grid grid-cols-1 gap-1">
                    {REPORT_FORMATS.map((f) => (
                      <button key={f} onClick={() => setFormat(f)}
                        className={cn("text-[10px] px-2 py-1 rounded-md border text-left transition-all",
                          filterFormat === f ? "border-primary/40 bg-primary/10 text-primary" : "border-white/8 text-muted-foreground hover:border-white/15")}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Time Frame</p>
                  <div className="grid grid-cols-1 gap-1">
                    {TIME_FRAMES.map((t) => (
                      <button key={t} onClick={() => setTimeFrame(t)}
                        className={cn("text-[10px] px-2 py-1 rounded-md border text-left transition-all",
                          filterTime === t ? "border-primary/40 bg-primary/10 text-primary" : "border-white/8 text-muted-foreground hover:border-white/15")}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {(jobs as Record<string, unknown>[]).length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Past Research</p>
            {(jobs as Record<string, unknown>[]).map((job) => (
              <button key={String(job.id)} onClick={() => { setActiveJobId(String(job.id)); setChatHistory([]); }}
                className={cn("w-full text-left p-2.5 border rounded-xl transition-all text-xs",
                  String(job.id) === activeJobId
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-white/6 bg-white/2 hover:border-white/15 text-muted-foreground hover:text-foreground")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">{String(job.query || "Research job")}</p>
                  <Badge variant="outline" className={cn("text-[9px] font-bold shrink-0",
                    job.status === "completed" ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/10"
                    : job.status === "failed"   ? "text-rose-400 border-rose-500/20 bg-rose-500/10"
                    : "text-amber-400 border-amber-500/20 bg-amber-500/10")}>
                    {String(job.status)}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── RIGHT: Results panel ── */}
      <div className="xl:col-span-2 space-y-4">
        {!activeJob && !researchMutation.isPending && (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <BookOpen className="w-12 h-12 opacity-15 mb-3" />
            <p className="text-sm font-medium">Configure your research on the left and run it</p>
            <p className="text-xs mt-1">Results with full report sections, sources, and export will appear here</p>
          </div>
        )}

        {activeJob && (
          <Card className={cn("border", isComplete ? "bg-emerald-500/5 border-emerald-500/20" : isFailed ? "bg-rose-500/5 border-rose-500/20" : "bg-amber-500/5 border-amber-500/20")}>
            <CardContent className="py-4 px-5">
              <div className="flex items-center gap-1 mb-3 flex-wrap">
                {RESEARCH_PHASES.filter((p) => !["failed"].includes(p.key)).map((phase, i) => {
                  const active = phase.key === jobStatus;
                  const done   = phaseIdx > i && phaseIdx !== -1;
                  return (
                    <div key={phase.key} className="flex items-center gap-1">
                      <div className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full border transition-all",
                        active ? "border-amber-500/50 bg-amber-500/20 text-amber-300"
                        : done  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-white/8 text-foreground/20")}>
                        {phase.label}
                      </div>
                      {i < RESEARCH_PHASES.filter((p) => !["failed"].includes(p.key)).length - 1 && (
                        <span className="text-foreground/15 text-xs">›</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="w-full h-1.5 bg-white/8 rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full transition-all duration-700",
                  isComplete ? "bg-emerald-400" : isFailed ? "bg-rose-400" : "bg-amber-400")}
                  style={{ width: `${jobProgress}%` }} />
              </div>
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-muted-foreground">
                  {isRunning  && <><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Running research pipeline...</>}
                  {isComplete && <><CheckCircle2 className="w-3 h-3 text-emerald-400 inline mr-1" />Research complete</>}
                  {isFailed   && <><AlertCircle className="w-3 h-3 text-rose-400 inline mr-1" />{String(activeJob.error || "Research failed")}</>}
                </p>
                <p className="text-xs text-muted-foreground">{jobProgress}%</p>
              </div>
            </CardContent>
          </Card>
        )}

        {isComplete && report && (
          <Card className="bg-card/75 border-white/8">
            <CardContent className="py-5 px-5 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Research Report</p>
                  <h2 className="text-lg font-bold text-foreground leading-snug">{String(report.title || activeJob?.query || "Research Report")}</h2>
                  {(report.metadata as Record<string, unknown>)?.generatedAt && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(String((report.metadata as Record<string, unknown>).generatedAt)).toLocaleString()}
                      {" · "}
                      {String((report.metadata as Record<string, unknown>).totalSources || 0)} sources
                      {" · "}
                      {Math.round(Number((report.metadata as Record<string, unknown>).confidenceScore || 0) * 100)}% confidence
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  <ExportButtons onExport={handleExport} exporting={exporting} />
                </div>
              </div>

              {report.summary && (
                <div className="bg-primary/5 border border-primary/15 rounded-xl p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-2">Executive Summary</p>
                  <p className="text-sm text-foreground/80 leading-relaxed">{String(report.summary)}</p>
                </div>
              )}

              {Array.isArray(report.keyFindings) && (report.keyFindings as string[]).length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Key Findings</p>
                  <ul className="space-y-1.5">
                    {(report.keyFindings as string[]).map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-foreground/75 bg-white/3 rounded-lg px-3 py-2">
                        <span className="text-primary font-bold mt-0.5 shrink-0">{i + 1}.</span> {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {Array.isArray(report.sections) && (report.sections as Record<string, unknown>[]).length > 0 && (
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Report Sections</p>
                  {(report.sections as Record<string, unknown>[]).map((sec, i) => (
                    <div key={i} className="bg-black/20 rounded-xl p-4 border border-border/30">
                      <p className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">
                        {String(sec.title || sec.heading || `Section ${i + 1}`)}
                      </p>
                      <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-line">
                        {typeof sec.content === "object" ? JSON.stringify(sec.content, null, 2) : String(sec.content || "")}
                      </p>
                      {Array.isArray(sec.citations) && (sec.citations as string[]).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(sec.citations as string[]).map((c, ci) => (
                            <span key={ci} className="text-[9px] bg-muted/40 border border-white/8 rounded px-1.5 py-0.5 text-muted-foreground">
                              [{ci + 1}] {c.length > 40 ? c.slice(0, 40) + "…" : c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {Array.isArray((report as Record<string, unknown>).peopleTable) && ((report as Record<string, unknown>).peopleTable as Record<string, unknown>[]).length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Data Table</p>
                  <div className="overflow-x-auto rounded-xl border border-white/8">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/8 bg-white/3">
                          {Object.keys(((report as Record<string, unknown>).peopleTable as Record<string, unknown>[])[0]).map((col) => (
                            <th key={col} className="text-left px-3 py-2 text-muted-foreground font-bold uppercase tracking-wider text-[9px]">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {((report as Record<string, unknown>).peopleTable as Record<string, unknown>[]).map((row, ri) => (
                          <tr key={ri} className="border-b border-border/30 hover:bg-white/3">
                            {Object.values(row).map((val, vi) => (
                              <td key={vi} className="px-3 py-2 text-foreground/70">{String(val ?? "")}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {jobSources.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    Sources Used ({jobSources.length})
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {jobSources.slice(0, 10).map((src, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white/3 border border-white/6 rounded-lg px-2.5 py-1.5">
                        <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                        <p className="text-[11px] text-foreground/70 truncate flex-1">{src.title || src.url}</p>
                        <span className={cn("text-[9px] font-bold shrink-0",
                          src.reliability > 0.7 ? "text-emerald-400" : src.reliability > 0.4 ? "text-amber-400" : "text-muted-foreground")}>
                          {Math.round(src.reliability * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-white/8 pt-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Follow-up Questions</p>
                <div className="space-y-2 max-h-44 overflow-y-auto mb-3">
                  {chatHistory.length === 0 && (
                    <p className="text-xs text-muted-foreground">Ask anything about this research report...</p>
                  )}
                  {chatHistory.map((m, i) => (
                    <div key={i} className={cn("rounded-xl px-3 py-2 text-sm",
                      m.role === "user" ? "bg-primary/10 text-primary ml-8" : "bg-muted/40 text-foreground/80 mr-8")}>
                      {m.content}
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div className="flex gap-2">
                  <Input value={chatMsg} onChange={(e) => setChatMsg(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && chatMsg) chatMutation.mutate(); }}
                    placeholder="What are the top 5 companies in this sector?..."
                    className="bg-black/30 border-white/15 h-9 text-sm" />
                  <Button size="sm" onClick={() => chatMutation.mutate()}
                    disabled={!chatMsg || chatMutation.isPending}
                    className="h-9 px-3 bg-primary hover:bg-primary/90">
                    {chatMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const [executing, setExecuting] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, Record<string, unknown>>>({});
  const [customQuery, setCustomQuery] = useState<Record<number, string>>({});
  const [exporting, setExporting] = useState<string | null>(null);

  const { data: templates = [] } = useQuery<Record<string, unknown>[]>({
    queryKey: ["orc-templates"],
    queryFn: () => fetch(`${API}/templates`).then((r) => r.json()),
  });

  const executeMutation = useMutation({
    mutationFn: async ({ id, query }: { id: number; query: string }) => {
      setExecuting(id);
      const res = await fetch(`${API}/templates/${id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error("Execution failed");
      return res.json();
    },
    onSuccess: (data, vars) => {
      setResults((prev) => ({ ...prev, [vars.id]: data }));
      setExecuting(null);
    },
    onError: () => setExecuting(null),
  });

  const handleExportResult = async (id: number, name: string, result: Record<string, unknown>, fmt: string) => {
    const key = `${id}-${fmt}`;
    setExporting(key);
    try {
      const res = await fetch(`${API}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: name,
          type: "template",
          data: { records: [result] },
          format: fmt === "xlsx" ? "excel" : fmt,
        }),
      });
      await triggerDownload(res);
    } catch { /* ignore */ } finally { setExporting(null); }
  };

  const CATEGORY_COLORS: Record<string, string> = {
    research:     "text-blue-400 border-blue-500/20 bg-blue-500/10",
    enrichment:   "text-violet-400 border-violet-500/20 bg-violet-500/10",
    prospecting:  "text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
    analysis:     "text-orange-400 border-orange-500/20 bg-orange-500/10",
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Pre-built intelligence templates for Saudi Arabia B2B research — click to run with a custom query
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(Array.isArray(templates) ? templates : []).map((tmpl) => {
          const id       = tmpl.id as number;
          const category = String(tmpl.category || "research").toLowerCase();
          const colorClass = CATEGORY_COLORS[category] || CATEGORY_COLORS.research;
          const result   = results[id];
          const isRunning = executing === id;

          return (
            <Card key={id} className="bg-card/75 border-white/8">
              <CardContent className="py-4 px-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-semibold text-foreground text-sm">{String(tmpl.name)}</p>
                  <Badge variant="outline" className={cn("text-[9px] font-bold capitalize shrink-0", colorClass)}>
                    {String(tmpl.category)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{String(tmpl.description || "")}</p>
                <div className="flex gap-2">
                  <Input
                    value={customQuery[id] || ""}
                    onChange={(e) => setCustomQuery((prev) => ({ ...prev, [id]: e.target.value }))}
                    placeholder="Add a specific query (optional)..."
                    className="bg-black/30 border-white/15 h-8 text-xs"
                  />
                  <Button size="sm" onClick={() => executeMutation.mutate({ id, query: customQuery[id] || String(tmpl.name) })}
                    disabled={isRunning}
                    className="h-8 px-3 bg-primary hover:bg-primary/90 gap-1.5 shrink-0">
                    {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    Run
                  </Button>
                </div>
                {result && (
                  <div className="mt-3 bg-black/20 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Result</p>
                      <ExportButtons
                        onExport={(fmt) => handleExportResult(id, String(tmpl.name), result, fmt)}
                        exporting={exporting}
                        reportId={id}
                      />
                    </div>
                    <p className="text-xs text-foreground/70 line-clamp-4">
                      {typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 300)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bulk Export Tab ───────────────────────────────────────────────────────────

function BulkExportTab() {
  const [title, setTitle] = useState("Saudi B2B Company Export");
  const [format, setFormat] = useState("csv");
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");

  const FORMATS = [
    { id: "csv",  label: "CSV Spreadsheet",  icon: FileText,   color: "text-emerald-400" },
    { id: "xlsx", label: "Excel Workbook",   icon: BarChart3,  color: "text-green-400"   },
    { id: "json", label: "JSON Data",        icon: Cpu,        color: "text-blue-400"    },
    { id: "pdf",  label: "PDF Report",       icon: FileOutput, color: "text-rose-400"    },
  ];

  const handleExport = async () => {
    setIsExporting(true);
    setError("");
    try {
      const companiesRes = await fetch("/api/companies?limit=500&page=1&curated=true");
      const companiesData = await companiesRes.json();
      const records = companiesData.companies || [];
      const fmt = format === "xlsx" ? "excel" : format;
      const res = await fetch(`${API}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, type: "companies", data: { records }, format: fmt }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const contentDisposition = res.headers.get("content-disposition") || "";
      const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] || `export.${format}`;
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex gap-3">
        <Database className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-foreground">Bulk Database Export</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Export your entire curated OrcBase company database. For per-report exports, use the export buttons inside each tab above.
          </p>
        </div>
      </div>
      <Card className="bg-card/70 border-white/8">
        <CardContent className="py-5 px-5 space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Export Title</p>
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
              className="bg-black/30 border-white/15 h-10" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Format</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {FORMATS.map((f) => (
                <button key={f.id} onClick={() => setFormat(f.id)}
                  className={cn("flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition-all",
                    format === f.id ? "border-primary/50 bg-primary/10" : "border-border/40 hover:border-white/20 bg-white/3")}>
                  <f.icon className={cn("w-5 h-5", format === f.id ? "text-primary" : f.color)} />
                  <span className="text-xs font-medium text-foreground">{f.label}</span>
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <Button onClick={handleExport} disabled={isExporting} className="w-full bg-primary hover:bg-primary/90 gap-2 h-11">
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isExporting ? "Exporting..." : `Export Companies Database (${format.toUpperCase()})`}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OrcEnginePage() {
  return (
    <div className="flex flex-col h-full p-6 gap-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 bg-violet-500/15 rounded-xl border border-violet-500/20 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-violet-400" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">OrcEngine</h1>
        </div>
        <p className="text-muted-foreground text-sm ml-12">
          AI Intelligence Engine · 8-agent enrichment · Multi-agent scraping · Deep research · Inline export
        </p>
      </div>

      <Tabs defaultValue="enrichment" className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-muted/40 border border-border/40 w-fit shrink-0 flex-wrap h-auto gap-0.5">
          <TabsTrigger value="enrichment" className="gap-2 data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            <Brain className="w-4 h-4" /> AI Enrichment
          </TabsTrigger>
          <TabsTrigger value="scrape" className="gap-2 data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            <Globe className="w-4 h-4" /> Multi-Agent Scrape
          </TabsTrigger>
          <TabsTrigger value="research" className="gap-2 data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            <BookOpen className="w-4 h-4" /> Deep Research
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-2 data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            <Layers className="w-4 h-4" /> Templates
          </TabsTrigger>
          <TabsTrigger value="export" className="gap-2 data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
            <Download className="w-4 h-4" /> Bulk Export
          </TabsTrigger>
        </TabsList>

        <TabsContent value="enrichment" className="flex-1 mt-4 overflow-y-auto">
          <EnrichmentTab />
        </TabsContent>
        <TabsContent value="scrape" className="flex-1 mt-4 overflow-y-auto">
          <ScrapeTab />
        </TabsContent>
        <TabsContent value="research" className="flex-1 mt-4 overflow-y-auto">
          <ResearchTab />
        </TabsContent>
        <TabsContent value="templates" className="flex-1 mt-4 overflow-y-auto">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="export" className="flex-1 mt-4 overflow-y-auto">
          <BulkExportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
