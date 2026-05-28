import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Network, Users, Crown, Briefcase, Building2, Loader2,
  ChevronDown, ChevronRight, ArrowLeft, ExternalLink, Mail, Phone,
  Linkedin, Sparkles, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { IntelReport, type IntelSection } from "@/components/intel/IntelReport";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types mirror lib/relationship-intel-engine.ts ─────────────────────────────

interface OrgNode {
  id: string;
  type: "executive" | "board" | "shareholder" | "subsidiary" | "department";
  nameEn: string;
  nameAr?: string;
  title?: string;
  titleAr?: string;
  seniority?: "C-Suite" | "VP" | "Director" | "Manager" | "Board";
  email?: string;
  phone?: string;
  linkedin?: string;
  ownership?: string;
  nationality?: string;
  source?: string;
  signalData?: Record<string, unknown>;
  trustScore?: number;
  certainty?: "verified" | "likely" | "unverified" | "estimated";
  children?: OrgNode[];
}

interface NetworkConnection {
  name: string;
  nameAr?: string;
  relationship: string;
  companyType: string;
  domain?: string;
  overlappingPeople: string[];
  strength: "strong" | "medium" | "weak";
}

interface OutreachContact {
  rank: number;
  nodeId: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  icpFitReason: string;
  outreachEmail?: string;
  outreachLinkedin?: string;
  whatsappOpener?: string;
}

interface RelationshipIntelJob {
  id: number;
  targetCompanyName: string;
  targetCompanyNameAr?: string;
  status: string;
  orgChartData?: OrgNode[];
  networkData?: NetworkConnection[];
  outreachPlan?: OutreachContact[];
  totalContacts: number;
  totalConnections: number;
  adjacentCompanies: number;
}

// ── Visual config per node type ──────────────────────────────────────────────

const NODE_TYPE_CFG: Record<OrgNode["type"], { icon: React.ReactNode; color: string; label: string }> = {
  executive:    { icon: <Crown className="w-3.5 h-3.5" />,     color: "text-amber-400 bg-amber-500/10 border-amber-500/25", label: "Exec" },
  board:        { icon: <Briefcase className="w-3.5 h-3.5" />, color: "text-violet-400 bg-violet-500/10 border-violet-500/25", label: "Board" },
  shareholder:  { icon: <Building2 className="w-3.5 h-3.5" />, color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/25", label: "Shareholder" },
  subsidiary:   { icon: <Building2 className="w-3.5 h-3.5" />, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25", label: "Subsidiary" },
  department:   { icon: <Users className="w-3.5 h-3.5" />,     color: "text-muted-foreground bg-muted border-border", label: "Dept" },
};

const STRENGTH_CFG: Record<NetworkConnection["strength"], string> = {
  strong: "text-emerald-400 bg-emerald-500/10",
  medium: "text-amber-400 bg-amber-500/10",
  weak:   "text-muted-foreground bg-muted",
};

// ── Recursive node row ────────────────────────────────────────────────────────

function OrgNodeRow({
  node,
  depth,
  expanded,
  onToggle,
  onSelect,
  selectedId,
}: {
  node: OrgNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (n: OrgNode) => void;
  selectedId: string | null;
}) {
  const hasChildren = !!node.children && node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const cfg = NODE_TYPE_CFG[node.type] || NODE_TYPE_CFG.executive;

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1.5 hover:bg-card/70 cursor-pointer rounded transition-colors",
          selectedId === node.id && "bg-primary/10 ring-1 ring-primary/30",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(node.id); }}
          className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {hasChildren ? (isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : <span className="w-1 h-1 rounded-full bg-border" />}
        </button>
        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded border uppercase tracking-wide shrink-0", cfg.color)}>
          {cfg.icon} {cfg.label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">
            <span className="font-medium">{node.nameEn}</span>
            {node.title && <span className="text-muted-foreground ml-2">· {node.title}</span>}
          </div>
          {node.nameAr && <div className="text-[10px] text-muted-foreground truncate" dir="rtl">{node.nameAr}</div>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {typeof node.trustScore === "number" && (
            <Badge
              variant="outline"
              className="text-[9px] bg-primary/10 border-primary/30 text-primary"
              title={`Source credibility: ${node.certainty || "unrated"}`}
            >
              ◆ {node.trustScore}
            </Badge>
          )}
          {node.seniority && <Badge variant="outline" className="text-[9px]">{node.seniority}</Badge>}
          {node.ownership && <Badge variant="outline" className="text-[9px] bg-cyan-500/10 border-cyan-500/30 text-cyan-400">{node.ownership}</Badge>}
          {node.email && <Mail className="w-3 h-3 text-emerald-400" />}
          {node.linkedin && <Linkedin className="w-3 h-3 text-primary" />}
        </div>
      </div>
      {hasChildren && isOpen && node.children!.map((c) => (
        <OrgNodeRow
          key={c.id}
          node={c}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          selectedId={selectedId}
        />
      ))}
    </>
  );
}

// ── Side panel: node detail + actions ─────────────────────────────────────────

function NodeSidePanel({
  node,
  companyName,
  onClose,
}: {
  node: OrgNode | null;
  companyName: string;
  onClose: () => void;
}) {
  const [report, setReport] = useState<{ sections: IntelSection[]; hasRealData?: boolean; researchThreads?: number; discoveredLinkedIn?: string | null } | null>(null);
  const [, navigate] = useLocation();

  const personIntel = useMutation({
    mutationFn: async () => {
      if (!node) throw new Error("No node selected");
      const r = await fetch(`${BASE}/api/person-intel/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: node.nameEn, company: companyName, title: node.title, linkedinUrl: node.linkedin }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: (data: { sections?: IntelSection[]; hasRealData?: boolean; researchThreads?: number; discoveredLinkedIn?: string | null }) => {
      if (data.sections) setReport({ sections: data.sections, hasRealData: data.hasRealData, researchThreads: data.researchThreads, discoveredLinkedIn: data.discoveredLinkedIn });
    },
  });

  const companyIntel = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/company-intel/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: (data: { sections?: IntelSection[]; hasRealData?: boolean; researchThreads?: number }) => {
      if (data.sections) setReport({ sections: data.sections, hasRealData: data.hasRealData, researchThreads: data.researchThreads });
    },
  });

  const pushToLF = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/lead-factory/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputMode: "list", companies: [companyName], targetCount: 25 }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: (data: { jobId?: string }) => {
      if (data.jobId) navigate(`/lead-factory?jobId=${data.jobId}`);
    },
  });

  if (!node) return null;
  const cfg = NODE_TYPE_CFG[node.type] || NODE_TYPE_CFG.executive;

  return (
    <Sheet open={!!node} onOpenChange={(o) => { if (!o) { setReport(null); onClose(); } }}>
      <SheetContent side="right" className="w-[480px] sm:w-[560px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded border uppercase tracking-wide", cfg.color)}>
              {cfg.icon}{cfg.label}
            </span>
            {node.nameEn}
          </SheetTitle>
          {(node.title || node.nameAr) && (
            <SheetDescription>
              {node.title}
              {node.nameAr && <div dir="rtl" className="text-right mt-1">{node.nameAr}</div>}
            </SheetDescription>
          )}
        </SheetHeader>

        {/* Contact ribbons */}
        <div className="mt-3 space-y-1 text-xs">
          {node.email && (
            <div className="flex items-center gap-2"><Mail className="w-3 h-3 text-emerald-400" /><a href={`mailto:${node.email}`} className="hover:underline">{node.email}</a></div>
          )}
          {node.phone && (
            <div className="flex items-center gap-2"><Phone className="w-3 h-3 text-emerald-400" /><a href={`tel:${node.phone}`} className="hover:underline">{node.phone}</a></div>
          )}
          {node.linkedin && (
            <div className="flex items-center gap-2"><Linkedin className="w-3 h-3 text-primary" /><a href={node.linkedin} target="_blank" rel="noopener noreferrer" className="hover:underline inline-flex items-center gap-1">LinkedIn <ExternalLink className="w-2.5 h-2.5" /></a></div>
          )}
          {node.source && <div className="text-muted-foreground text-[10px]">source: {node.source}</div>}
        </div>

        {/* Actions */}
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Actions</div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="secondary" onClick={() => personIntel.mutate()} disabled={personIntel.isPending} className="gap-1.5">
              {personIntel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Person Intel
            </Button>
            <Button size="sm" variant="secondary" onClick={() => companyIntel.mutate()} disabled={companyIntel.isPending} className="gap-1.5">
              {companyIntel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Building2 className="w-3 h-3" />}
              Company Intel
            </Button>
          </div>
          <Button size="sm" onClick={() => pushToLF.mutate()} disabled={pushToLF.isPending} className="w-full gap-1.5">
            {pushToLF.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
            Push to Lead Factory
          </Button>
        </div>

        {/* Report (if a mutation produced one) */}
        {report && (
          <div className="mt-5">
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Intel report</div>
            <IntelReport
              sections={report.sections}
              hasRealData={report.hasRealData}
              researchThreads={report.researchThreads}
              discoveredLinkedIn={report.discoveredLinkedIn}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function getJobIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("jobId");
}

export default function RelationshipIntelTreePage() {
  const [, navigate] = useLocation();
  const [jobId, setJobId] = useState<string>(getJobIdFromUrl() || "");
  const [activeJobId, setActiveJobId] = useState<string | null>(getJobIdFromUrl());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<OrgNode | null>(null);

  const { data, isLoading, error } = useQuery<{ ok: boolean; job?: RelationshipIntelJob }>({
    queryKey: ["relationship-intel", activeJobId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/relationship-intel/jobs/${activeJobId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !!activeJobId,
    // Re-query while job is still running
    refetchInterval: (q) => q.state.data?.job?.status === "completed" ? false : 5000,
  });

  const job = data?.job;
  const rootNodes = useMemo<OrgNode[]>(() => (job?.orgChartData as OrgNode[] | undefined) || [], [job]);

  function toggle(id: string) {
    setExpanded((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function expandAll() {
    const all = new Set<string>();
    const walk = (n: OrgNode) => { all.add(n.id); n.children?.forEach(walk); };
    rootNodes.forEach(walk);
    setExpanded(all);
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/relationship-intel")} className="gap-1.5 mb-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to list view
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            Relationship Intelligence — Tree
          </h1>
          {job && (
            <p className="text-sm text-muted-foreground mt-1">
              {job.targetCompanyName} · {job.totalContacts ?? 0} contacts · {job.totalConnections ?? 0} connections · {job.adjacentCompanies ?? 0} adjacent companies · status: <span className={cn("font-medium", job.status === "completed" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-amber-400")}>{job.status}</span>
            </p>
          )}
        </div>
      </div>

      {/* Job ID input */}
      <div className="flex gap-2 mb-4">
        <Input
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          placeholder="Relationship Intel job id (e.g. 42)"
          className="max-w-xs h-8 text-sm"
        />
        <Button size="sm" onClick={() => setActiveJobId(jobId.trim() || null)}>Load</Button>
        {activeJobId && rootNodes.length > 0 && (
          <Button size="sm" variant="ghost" onClick={expandAll}>Expand all</Button>
        )}
      </div>

      {/* States */}
      {!activeJobId && (
        <Card className="bg-card/65 border-border/40"><CardContent className="p-6 text-sm text-muted-foreground text-center">
          Enter a job id to load the org chart, or start a new run from <a href="/relationship-intel" className="text-primary hover:underline">/relationship-intel</a>.
        </CardContent></Card>
      )}
      {activeJobId && isLoading && (
        <Card className="bg-card/65 border-border/40"><CardContent className="p-6 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading job {activeJobId}…
        </CardContent></Card>
      )}
      {activeJobId && error && (
        <Card className="bg-red-500/5 border-red-500/30"><CardContent className="p-6 text-sm text-red-400">
          Failed to load job: {(error as Error).message}
        </CardContent></Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Org chart */}
        {job && rootNodes.length > 0 && (
          <Card className="bg-card/65 border-border/40">
            <CardContent className="p-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground px-2 py-2 border-b border-border/30 mb-2">
                Org chart ({rootNodes.length} root{rootNodes.length === 1 ? "" : "s"})
              </div>
              <div className="space-y-0.5">
                {rootNodes.map((n) => (
                  <OrgNodeRow
                    key={n.id}
                    node={n}
                    depth={0}
                    expanded={expanded}
                    onToggle={toggle}
                    onSelect={setSelected}
                    selectedId={selected?.id || null}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Network adjacency + outreach plan */}
        {job && (
          <div className="space-y-4">
            {job.networkData && job.networkData.length > 0 && (
              <Card className="bg-card/65 border-border/40">
                <CardContent className="p-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Adjacent companies</div>
                  <div className="space-y-1.5">
                    {job.networkData.slice(0, 20).map((c, i) => (
                      <div key={i} className="text-xs border border-border/30 rounded p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">{c.name}</span>
                          <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide", STRENGTH_CFG[c.strength])}>{c.strength}</span>
                        </div>
                        <div className="text-muted-foreground text-[10px] mt-0.5 truncate">
                          {c.relationship} · {c.companyType}
                        </div>
                        {c.overlappingPeople.length > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            via {c.overlappingPeople.slice(0, 3).join(", ")}
                            {c.overlappingPeople.length > 3 && ` +${c.overlappingPeople.length - 3}`}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {job.outreachPlan && job.outreachPlan.length > 0 && (
              <Card className="bg-card/65 border-border/40">
                <CardContent className="p-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Outreach plan</div>
                  <div className="space-y-1.5">
                    {job.outreachPlan.slice(0, 10).map((c) => (
                      <div key={c.nodeId} className="text-xs border border-border/30 rounded p-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{c.name}</span>
                          <Badge variant="outline" className="text-[9px]">#{c.rank}</Badge>
                        </div>
                        <div className="text-muted-foreground text-[10px]">{c.title}</div>
                        <div className="text-[10px] mt-1 line-clamp-2">{c.icpFitReason}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      <NodeSidePanel
        node={selected}
        companyName={job?.targetCompanyName || ""}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
