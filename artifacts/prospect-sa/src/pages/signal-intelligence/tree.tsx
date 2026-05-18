import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Building2, ChevronRight, ChevronDown, Activity, Loader2,
  Sparkles, Search, RefreshCw, ExternalLink, User2,
  Newspaper, FileText, CheckCircle2, TrendingUp, Shield,
  BarChart3, AlertCircle, Zap, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types (mirror the existing Signals page) ─────────────────────────────────

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

interface RecentSignalsResponse {
  alerts: SignalAlert[];
  total?: number;
}

// ── Visual config ────────────────────────────────────────────────────────────

const SIGNAL_TYPES: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  news:       { label: "News",       color: "text-primary bg-primary/10 border-primary/25",       icon: <Newspaper className="w-3 h-3" /> },
  tender:     { label: "Tender",     color: "text-amber-400 bg-amber-500/10 border-amber-500/25", icon: <FileText className="w-3 h-3" /> },
  contract:   { label: "Contract",   color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25", icon: <CheckCircle2 className="w-3 h-3" /> },
  hiring:     { label: "Hiring",     color: "text-violet-400 bg-violet-500/10 border-violet-500/25", icon: <TrendingUp className="w-3 h-3" /> },
  regulatory: { label: "Regulatory", color: "text-orange-400 bg-orange-500/10 border-orange-500/25", icon: <Shield className="w-3 h-3" /> },
  market:     { label: "Market",     color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/25",    icon: <BarChart3 className="w-3 h-3" /> },
  sanctions:  { label: "Sanctions",  color: "text-red-400 bg-red-500/10 border-red-500/25",       icon: <AlertCircle className="w-3 h-3" /> },
};

const CATEGORY_TONE: Record<string, string> = {
  positive: "text-emerald-400 bg-emerald-500/10",
  negative: "text-red-400 bg-red-500/10",
  neutral:  "text-muted-foreground bg-muted",
};

// ── Tree shape ────────────────────────────────────────────────────────────────

interface CompanyNode {
  company: string;
  companyNameAr?: string;
  sanctioned: boolean;
  signals: SignalAlert[];
  byType: Record<string, SignalAlert[]>;
  topRelevance: number;
}

function groupByCompany(alerts: SignalAlert[]): CompanyNode[] {
  const map = new Map<string, CompanyNode>();
  for (const a of alerts) {
    const key = (a.company || "Unknown").trim();
    if (!map.has(key)) {
      map.set(key, {
        company: key,
        companyNameAr: a.companyNameAr,
        sanctioned: false,
        signals: [],
        byType: {},
        topRelevance: 0,
      });
    }
    const node = map.get(key)!;
    node.signals.push(a);
    (node.byType[a.signalType] ||= []).push(a);
    if (a.isSanctioned) node.sanctioned = true;
    if ((a.relevanceScore ?? 0) > node.topRelevance) node.topRelevance = a.relevanceScore ?? 0;
  }
  return Array.from(map.values()).sort((a, b) => b.topRelevance - a.topRelevance);
}

// ── Side panel — runs Company Intel / Person Intel / Lead Factory bridge ─────

function SidePanel({
  node,
  onClose,
}: {
  node: CompanyNode | null;
  onClose: () => void;
}) {
  const [, navigate] = useLocation();
  const [personName, setPersonName] = useState("");

  const companyIntel = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/company-intel/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: node?.company }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const personIntel = useMutation({
    mutationFn: async () => {
      if (!personName.trim()) throw new Error("Person name required");
      const r = await fetch(`${BASE}/api/person-intel/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: personName, company: node?.company }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const relIntel = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/relationship-intel/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCompanyName: node?.company }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: (data: { jobId?: string }) => {
      if (data.jobId) navigate(`/relationship-intel?jobId=${data.jobId}`);
    },
  });

  const leadFactoryRun = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/lead-factory/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputMode: "list",
          companies: [node?.company],
          targetCount: 25,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: (data: { jobId?: string }) => {
      if (data.jobId) navigate(`/lead-factory?jobId=${data.jobId}`);
    },
  });

  if (!node) return null;

  return (
    <Sheet open={!!node} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            {node.company}
            {node.sanctioned && (
              <Badge variant="destructive" className="ml-2 text-[10px]">SANCTIONED</Badge>
            )}
          </SheetTitle>
          {node.companyNameAr && (
            <SheetDescription dir="rtl" className="text-right">{node.companyNameAr}</SheetDescription>
          )}
        </SheetHeader>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <div className="rounded-lg border border-border/40 p-2">
            <div className="text-xl font-bold">{node.signals.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Signals</div>
          </div>
          <div className="rounded-lg border border-border/40 p-2">
            <div className="text-xl font-bold">{Object.keys(node.byType).length}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Types</div>
          </div>
          <div className="rounded-lg border border-border/40 p-2">
            <div className="text-xl font-bold">{node.topRelevance}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Top score</div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Run intel</div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => companyIntel.mutate()}
              disabled={companyIntel.isPending}
              className="gap-1.5"
            >
              {companyIntel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Company Intel
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => relIntel.mutate()}
              disabled={relIntel.isPending}
              className="gap-1.5"
            >
              {relIntel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              Relationship
            </Button>
          </div>

          <div className="flex gap-2">
            <Input
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="Person name…"
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => personIntel.mutate()}
              disabled={!personName.trim() || personIntel.isPending}
              className="gap-1.5 shrink-0"
            >
              {personIntel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <User2 className="w-3 h-3" />}
              Person
            </Button>
          </div>

          <Button
            size="sm"
            onClick={() => leadFactoryRun.mutate()}
            disabled={leadFactoryRun.isPending}
            className="w-full gap-1.5"
          >
            {leadFactoryRun.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
            Harvest with Lead Factory
          </Button>
        </div>

        {/* Mutation result previews */}
        {companyIntel.data && (
          <Card className="mt-3 bg-card/40 border-border/40">
            <CardContent className="p-3 text-xs space-y-1">
              <div className="font-semibold text-primary">Company Intel result</div>
              <pre className="text-[10px] overflow-x-auto max-h-32 text-muted-foreground">
                {JSON.stringify(companyIntel.data, null, 2).slice(0, 600)}…
              </pre>
            </CardContent>
          </Card>
        )}
        {personIntel.data && (
          <Card className="mt-3 bg-card/40 border-border/40">
            <CardContent className="p-3 text-xs space-y-1">
              <div className="font-semibold text-primary">Person Intel result</div>
              <pre className="text-[10px] overflow-x-auto max-h-32 text-muted-foreground">
                {JSON.stringify(personIntel.data, null, 2).slice(0, 600)}…
              </pre>
            </CardContent>
          </Card>
        )}
        {(companyIntel.error || personIntel.error || relIntel.error || leadFactoryRun.error) && (
          <div className="mt-3 text-xs text-red-400">
            {(companyIntel.error || personIntel.error || relIntel.error || leadFactoryRun.error)?.toString()}
          </div>
        )}

        {/* Signal list grouped by type */}
        <div className="mt-5 space-y-3">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Signal timeline</div>
          {Object.entries(node.byType).map(([type, list]) => {
            const cfg = SIGNAL_TYPES[type] || SIGNAL_TYPES.news;
            return (
              <div key={type} className="space-y-1.5">
                <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md border uppercase tracking-wide", cfg.color)}>
                  {cfg.icon}{cfg.label} · {list.length}
                </span>
                {list.slice(0, 5).map((s, i) => (
                  <div key={i} className="rounded border border-border/30 bg-background/30 p-2 text-xs">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <div className="font-medium leading-snug">{s.headline}</div>
                        {s.summary && (
                          <div className="text-muted-foreground text-[11px] mt-0.5 line-clamp-2">{s.summary}</div>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                          <span>{s.source}</span>
                          {s.timestamp && <span>· {new Date(s.timestamp).toLocaleDateString()}</span>}
                          {s.category && (
                            <span className={cn("px-1.5 rounded", CATEGORY_TONE[s.category])}>{s.category}</span>
                          )}
                        </div>
                      </div>
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Tree row ──────────────────────────────────────────────────────────────────

function CompanyRow({
  node,
  expanded,
  onToggle,
  onSelect,
}: {
  node: CompanyNode;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  return (
    <div className="border-b border-border/20">
      <div
        className="flex items-center gap-2 px-3 py-2 hover:bg-card/60 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
        <Building2 className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{node.company}</div>
          {node.companyNameAr && (
            <div className="text-[10px] text-muted-foreground truncate" dir="rtl">{node.companyNameAr}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {node.sanctioned && <Badge variant="destructive" className="text-[10px]">SANCTIONED</Badge>}
          <Badge variant="outline" className="text-[10px]">{node.signals.length}</Badge>
          <Badge variant="outline" className="text-[10px] bg-primary/10">{node.topRelevance}</Badge>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
          >
            Open →
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="pl-12 pr-3 pb-2 space-y-1.5">
          {Object.entries(node.byType).map(([type, list]) => {
            const cfg = SIGNAL_TYPES[type] || SIGNAL_TYPES.news;
            return (
              <div key={type} className="flex items-center gap-2 text-xs">
                <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded border uppercase tracking-wide", cfg.color)}>
                  {cfg.icon}{cfg.label}
                </span>
                <span className="text-muted-foreground">{list.length} signal{list.length === 1 ? "" : "s"}</span>
                <span className="text-muted-foreground truncate flex-1">{list[0].headline}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SignalsTreePage() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<CompanyNode | null>(null);

  // Poll every 8s for near-live feed. SSE upgrade tracked in
  // docs/specs/signals-tree-redesign.md.
  const { data, isLoading, refetch, isFetching } = useQuery<RecentSignalsResponse>({
    queryKey: ["signals", "recent"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/signals/recent`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 8000,
  });

  const nodes = useMemo(() => {
    const all = groupByCompany(data?.alerts || []);
    if (!search.trim()) return all;
    const q = search.trim().toLowerCase();
    return all.filter(
      (n) =>
        n.company.toLowerCase().includes(q) ||
        (n.companyNameAr || "").includes(search) ||
        n.signals.some((s) => s.headline.toLowerCase().includes(q)),
    );
  }, [data, search]);

  function toggle(company: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(company)) next.delete(company);
      else next.add(company);
      return next;
    });
  }

  function expandAll() { setExpanded(new Set(nodes.map((n) => n.company))); }
  function collapseAll() { setExpanded(new Set()); }

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Signal Intelligence — Tree
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.alerts?.length ?? 0} signals · {nodes.length} companies · auto-refreshes every 8s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={expandAll}>Expand all</Button>
          <Button size="sm" variant="ghost" onClick={collapseAll}>Collapse all</Button>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by company, Arabic name, or signal headline…"
          className="pl-9"
        />
      </div>

      {/* Tree */}
      <Card className="bg-card/40 border-border/40">
        <CardContent className="p-0">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading signals…
            </div>
          )}
          {!isLoading && nodes.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {search.trim() ? "No signals match the filter." : "No signals yet — run a scan or kick a push job."}
            </div>
          )}
          {!isLoading && nodes.map((node) => (
            <CompanyRow
              key={node.company}
              node={node}
              expanded={expanded.has(node.company)}
              onToggle={() => toggle(node.company)}
              onSelect={() => setSelected(node)}
            />
          ))}
        </CardContent>
      </Card>

      <SidePanel node={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
