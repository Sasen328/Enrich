import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Radio, Activity, Loader2, X, RefreshCw, Building2,
  TrendingUp, Shield, AlertCircle, CheckCircle2, Zap,
  Newspaper, FileText, Search, Filter, ChevronDown,
  ExternalLink, Clock, BarChart3, Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LeadFactoryTabs } from "@/components/lead-factory/LeadFactoryTabs";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

interface SignalAlert {
  id?: number;
  source: string;
  headline: string;
  company?: string;
  companyNameAr?: string;
  signalType: string;
  category?: "positive" | "negative" | "neutral";
  summary: string;
  timestamp?: string;
  url?: string;
  relevanceScore?: number;
  recommendedAction?: string;
  isSanctioned?: number;
}

interface SignalScanResult {
  companyName: string;
  signals: SignalAlert[];
  positive: SignalAlert[];
  negative: SignalAlert[];
  sanctioned: boolean;
  total: number;
}

// ── Signal type config ─────────────────────────────────────────────────────────

const SIGNAL_TYPES: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  news:       { label: "News",       color: "text-primary bg-primary/10 border-primary/25",       icon: <Newspaper className="w-3 h-3" /> },
  tender:     { label: "Tender",     color: "text-amber-400 bg-amber-500/10 border-amber-500/25", icon: <FileText className="w-3 h-3" /> },
  contract:   { label: "Contract",   color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25", icon: <CheckCircle2 className="w-3 h-3" /> },
  hiring:     { label: "Hiring",     color: "text-violet-400 bg-violet-500/10 border-violet-500/25", icon: <TrendingUp className="w-3 h-3" /> },
  regulatory: { label: "Regulatory", color: "text-orange-400 bg-orange-500/10 border-orange-500/25", icon: <Shield className="w-3 h-3" /> },
  market:     { label: "Market",     color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/25",    icon: <BarChart3 className="w-3 h-3" /> },
  sanctions:  { label: "Sanctions",  color: "text-red-400 bg-red-500/10 border-red-500/25",       icon: <AlertCircle className="w-3 h-3" /> },
};

const ACTION_COLORS: Record<string, string> = {
  prioritize: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
  hold:       "text-amber-400 bg-amber-500/10 border-amber-500/25",
  disqualify: "text-red-400 bg-red-500/10 border-red-500/25",
};

// ── Signal Card ────────────────────────────────────────────────────────────────

function SignalCard({ signal }: { signal: SignalAlert }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = SIGNAL_TYPES[signal.signalType] || SIGNAL_TYPES.news;
  const isNegative = signal.category === "negative";

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-all cursor-pointer hover:border-primary/30",
        isNegative ? "bg-red-500/5 border-red-500/15" : "bg-card/70 border-border/30"
      )}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        {/* Type badge */}
        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md border uppercase tracking-wide shrink-0", cfg.color)}>
          {cfg.icon}{cfg.label}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-foreground leading-snug">{signal.headline}</p>
            {signal.recommendedAction && (
              <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0", ACTION_COLORS[signal.recommendedAction] || "text-muted-foreground border-border/30")}>
                {signal.recommendedAction}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {signal.company && (
              <span className="text-xs font-medium text-primary">{signal.company}</span>
            )}
            <span className="text-[10px] text-muted-foreground">{signal.source}</span>
            {signal.timestamp && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(signal.timestamp).toLocaleDateString("en-SA", { month: "short", day: "numeric" })}
              </span>
            )}
            {signal.isSanctioned === 1 && (
              <span className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">SANCTIONED</span>
            )}
          </div>

          {expanded && signal.summary && signal.summary !== signal.headline && (
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{signal.summary}</p>
          )}
        </div>

        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expanded && "rotate-180")} />
      </div>

      {expanded && signal.url && (
        <a href={signal.url} target="_blank" rel="noopener noreferrer"
          className="mt-2 flex items-center gap-1 text-[10px] text-primary hover:underline"
          onClick={e => e.stopPropagation()}>
          <ExternalLink className="w-3 h-3" /> Open source
        </a>
      )}
    </div>
  );
}

// ── Company Scanner ────────────────────────────────────────────────────────────

function CompanyScanner() {
  const [query, setQuery] = useState("");
  const [queryAr, setQueryAr] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<SignalScanResult | null>(null);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "positive" | "negative">("all");

  const scan = async () => {
    if (!query.trim()) return;
    setScanning(true); setError(""); setResult(null);
    try {
      const res = await fetch(`${BASE}/api/signals/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_name: query, company_name_ar: queryAr || undefined }),
      });
      const data = await res.json() as { ok: boolean; data: SignalScanResult; error?: string };
      if (!data.ok) throw new Error(data.error || "Scan failed");
      setResult(data.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const displayed = result
    ? activeFilter === "positive" ? result.positive
    : activeFilter === "negative" ? result.negative
    : result.signals
    : [];

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="glass-panel rounded-xl p-4 space-y-3">
        <div className="flex gap-2">
          <Input
            value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && scan()}
            placeholder="Company name in English (e.g. Saudi Aramco, stc, Almarai)"
            className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground"
          />
          <Input
            value={queryAr} onChange={e => setQueryAr(e.target.value)}
            placeholder="اسم الشركة (اختياري)"
            className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground w-48 font-arabic text-right"
            dir="rtl"
          />
          <Button onClick={scan} disabled={scanning || !query.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 shrink-0">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {scanning ? "Scanning…" : "Scan"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Scans OFAC/UN sanctions, Saudi news, Etimad contracts, hiring signals, and regulatory events.
        </p>
      </div>

      {error && (
        <div className="glass-panel rounded-xl p-4 border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {result && (
        <div className="space-y-4 animate-in">
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Signals", value: result.total, color: "text-foreground" },
              { label: "Positive", value: result.positive.length, color: "text-emerald-400" },
              { label: "Negative", value: result.negative.length, color: "text-red-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="glass-card rounded-xl p-4 text-center">
                <p className={cn("text-2xl font-display font-bold", color)}>{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {result.sanctioned && (
            <div className="glass-panel rounded-xl p-4 border-red-500/30 bg-red-500/5 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-400">Sanctions Hit</p>
                <p className="text-xs text-muted-foreground">This entity has matched one or more international sanctions lists. Do not proceed without compliance review.</p>
              </div>
            </div>
          )}

          {/* Filter tabs */}
          <div className="flex gap-1">
            {(["all", "positive", "negative"] as const).map(f => (
              <button key={f} onClick={() => setActiveFilter(f)}
                className={cn("px-3 py-1.5 text-xs font-medium rounded-lg border capitalize transition-all",
                  activeFilter === f
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "border-border/30 text-muted-foreground hover:border-border/50 hover:text-foreground")}>
                {f === "all" ? `All (${result.total})` : f === "positive" ? `Positive (${result.positive.length})` : `Negative (${result.negative.length})`}
              </button>
            ))}
          </div>

          {/* Signals list */}
          <div className="space-y-2">
            {displayed.length === 0
              ? <p className="text-center text-sm text-muted-foreground py-8">No {activeFilter} signals found</p>
              : displayed.map((s, i) => <SignalCard key={i} signal={s} />)
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ── Live Monitor ───────────────────────────────────────────────────────────────

function LiveMonitor() {
  const [signals, setSignals] = useState<SignalAlert[]>([]);
  const [logs, setLogs] = useState<string[]>(["Ready — click Start Monitor to begin scanning all leads"]);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [total, setTotal] = useState(0);
  const [filterType, setFilterType] = useState<string>("all");
  const sseRef = useRef<EventSource | null>(null);

  const start = async () => {
    setIsRunning(true); setIsDone(false); setSignals([]); setTotal(0);
    setLogs(["Starting signal monitor across all tracked leads…"]);
    try {
      const r = await fetch(`${BASE}/api/signals/push`, { method: "POST" });
      const data = await r.json() as { ok: boolean; jobId: string };
      if (!data.ok || !data.jobId) { setIsRunning(false); return; }
      sseRef.current?.close();
      const es = new EventSource(`${BASE}/api/signals/stream/${data.jobId}`);
      sseRef.current = es;
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type === "stream_end") { es.close(); setIsRunning(false); setIsDone(true); return; }
          if (ev.type === "heartbeat") return;
          if (ev.type === "log" && ev.message) setLogs(prev => [...prev, ev.message].slice(-30));
          if (ev.type === "signal" && ev.data) setSignals(prev => [ev.data as SignalAlert, ...prev].slice(0, 200));
          if (ev.type === "monitor_complete") { setTotal(ev.total || 0); setIsRunning(false); setIsDone(true); }
        } catch {}
      };
      es.onerror = () => { es.close(); setIsRunning(false); };
    } catch { setIsRunning(false); }
  };

  useEffect(() => () => { sseRef.current?.close(); }, []);

  const displayed = filterType === "all" ? signals : signals.filter(s => s.signalType === filterType);
  const types = [...new Set(signals.map(s => s.signalType))];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="glass-panel rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Live Signal Monitor</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Scans all tracked companies in your MeshBase for news, tenders, contracts, hiring, and regulatory events.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {isDone && <span className="text-xs text-emerald-400">{total} signals found</span>}
          {isRunning && <span className="text-xs text-primary animate-pulse flex items-center gap-1"><Radio className="w-3 h-3" /> Scanning…</span>}
          <Button onClick={start} disabled={isRunning} size="sm" className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground">
            {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
            {isRunning ? "Running…" : isDone ? "Re-scan" : "Start Monitor"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Signals */}
        <div className="xl:col-span-3 space-y-3">
          {/* Type filters */}
          {types.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => setFilterType("all")}
                className={cn("px-3 py-1 text-xs rounded-lg border transition-all", filterType === "all" ? "bg-primary/15 border-primary/30 text-primary" : "border-border/30 text-muted-foreground hover:border-border/50")}>
                All ({signals.length})
              </button>
              {types.map(t => (
                <button key={t} onClick={() => setFilterType(t)}
                  className={cn("px-3 py-1 text-xs rounded-lg border transition-all capitalize", filterType === t ? "bg-primary/15 border-primary/30 text-primary" : "border-border/30 text-muted-foreground hover:border-border/50")}>
                  {t} ({signals.filter(s => s.signalType === t).length})
                </button>
              ))}
            </div>
          )}

          {displayed.length === 0 && !isRunning && (
            <div className="glass-card rounded-xl p-12 text-center">
              <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-sm text-muted-foreground">No signals yet — start the monitor to scan your leads</p>
            </div>
          )}

          {isRunning && displayed.length === 0 && (
            <div className="glass-card rounded-xl p-12 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Scanning sources…</p>
            </div>
          )}

          <div className="space-y-2">
            {displayed.map((s, i) => <SignalCard key={i} signal={s} />)}
          </div>
        </div>

        {/* Log */}
        <div className="glass-card rounded-xl p-4 h-fit">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Source Log</p>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {logs.map((log, i) => (
              <p key={i} className="text-[10px] text-muted-foreground leading-relaxed">{log}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Recent signals from DB ─────────────────────────────────────────────────────

function RecentSignals() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["signals-recent"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/signals/recent`);
      return r.json() as Promise<{ ok: boolean; data: { signals: SignalAlert[]; prioritize: SignalAlert[]; disqualify: SignalAlert[]; hold: SignalAlert[]; total: number } }>;
    },
  });

  const d = data?.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{d?.total ?? 0} signals in database</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-2 text-muted-foreground hover:text-foreground h-8">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="glass-card rounded-xl p-12 flex justify-center">
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        </div>
      )}

      {d && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {[
            { label: "Prioritize", signals: d.prioritize, color: "border-emerald-500/20" },
            { label: "Hold", signals: d.hold, color: "border-amber-500/20" },
            { label: "Disqualify", signals: d.disqualify, color: "border-red-500/20" },
          ].map(({ label, signals, color }) => (
            <div key={label} className={cn("glass-card rounded-xl p-4 border", color)}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{label} ({signals.length})</p>
              {signals.length === 0
                ? <p className="text-xs text-muted-foreground py-4 text-center">None</p>
                : <div className="space-y-2 max-h-64 overflow-y-auto">
                    {signals.map((s, i) => (
                      <div key={i} className="rounded-lg bg-white/3 border border-border/30 p-3">
                        <p className="text-xs font-medium text-foreground leading-snug">{s.headline}</p>
                        {s.company && <p className="text-[10px] text-primary mt-1">{s.company}</p>}
                      </div>
                    ))}
                  </div>
              }
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SignalIntelligencePage() {
  const [tab, setTab] = useState<"scan" | "monitor" | "recent">("scan");

  return (
    <div className="space-y-6 animate-in">
      {/* Lead Factory tab strip — keeps Signal Intel inside the LF flow */}
      <LeadFactoryTabs />

      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center glow-brand-sm">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">Signal Intelligence</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Event-driven lead scoring — sanctions, news, contracts, hiring signals, and regulatory events for Saudi B2B companies.
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "OFAC/UN Sanctions", icon: <Shield className="w-4 h-4" />, color: "text-red-400" },
          { label: "Saudi News", icon: <Newspaper className="w-4 h-4" />, color: "text-primary" },
          { label: "Etimad Contracts", icon: <FileText className="w-4 h-4" />, color: "text-emerald-400" },
          { label: "Hiring Signals", icon: <TrendingUp className="w-4 h-4" />, color: "text-violet-400" },
        ].map(({ label, icon, color }) => (
          <div key={label} className="glass-card rounded-xl p-3 flex items-center gap-3">
            <div className={cn("w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center", color)}>{icon}</div>
            <span className="text-xs font-medium text-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/30">
        {([
          { id: "scan",    label: "Company Scan",   icon: <Search className="w-4 h-4" /> },
          { id: "monitor", label: "Live Monitor",   icon: <Radio className="w-4 h-4" /> },
          { id: "recent",  label: "Recent Signals", icon: <Clock className="w-4 h-4" /> },
        ] as const).map(({ id, label, icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn("flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px",
              tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border/50")}>
            {icon}{label}
          </button>
        ))}
      </div>

      {tab === "scan"    && <CompanyScanner />}
      {tab === "monitor" && <LiveMonitor />}
      {tab === "recent"  && <RecentSignals />}
    </div>
  );
}
