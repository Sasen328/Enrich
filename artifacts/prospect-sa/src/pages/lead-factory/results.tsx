import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download, ArrowLeft, Building2, Loader2, ExternalLink, Mail, Phone, Linkedin,
  Sparkles, Network, ArrowRight, FileSpreadsheet, FileText, FileBarChart, Code,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { IntelReport, type IntelSection } from "@/components/intel/IntelReport";
import { LeadFactoryTabs } from "@/components/lead-factory/LeadFactoryTabs";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Result row shape ─────────────────────────────────────────────────────────

interface LeadResult {
  id: number;
  jobId: number;
  companyName: string | null;
  companyNameAr: string | null;
  domain: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  industry: string | null;
  subIndustry: string | null;
  employeeCount: string | null;
  revenue: string | null;
  icpScore: number | null;
  priorityTier: string | null;
  buyingScore: number | null;
  qualityScore: number | null;
  validationStatus: string;
  linkedinUrl: string | null;
  crNumber: string | null;
  outreachEmail: string | null;
  outreachLinkedin: string | null;
  outreachWhatsapp: string | null;
  openingAngle: string | null;
  culturalNote: string | null;
  conversationHook: string | null;
  publishedLeadId: number | null;
  publishedCompanyId: number | null;
  keyExecutives?: Array<{ name?: string; title?: string }> | null;
  signalData?: Record<string, unknown> | null;
}

interface ResultsResponse {
  ok: boolean;
  results: LeadResult[];
  total: number;
}

const TIER_COLOR: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  B: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  C: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
  D: "bg-muted text-muted-foreground border-border",
};

function getJobIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("jobId");
}

// ── Row drawer with Intel report + actions ───────────────────────────────────

function RowDrawer({ row, mode, onClose }: { row: LeadResult | null; mode: "person" | "company"; onClose: () => void }) {
  const [report, setReport] = useState<{ sections: IntelSection[]; hasRealData?: boolean; researchThreads?: number; discoveredLinkedIn?: string | null } | null>(null);
  const [, navigate] = useLocation();

  const companyIntel = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No row");
      const r = await fetch(`${BASE}/api/company-intel/profile`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: row.companyName, domain: row.domain }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: (data: { sections?: IntelSection[]; hasRealData?: boolean; researchThreads?: number }) => {
      if (data.sections) setReport({ sections: data.sections, hasRealData: data.hasRealData, researchThreads: data.researchThreads });
    },
  });

  const personIntel = useMutation({
    mutationFn: async () => {
      if (!row || !row.keyExecutives?.[0]?.name) throw new Error("No executive on row");
      const exec = row.keyExecutives[0];
      const r = await fetch(`${BASE}/api/person-intel/profile`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: exec.name, title: exec.title, company: row.companyName }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: (data: { sections?: IntelSection[]; hasRealData?: boolean; researchThreads?: number; discoveredLinkedIn?: string | null }) => {
      if (data.sections) setReport({ sections: data.sections, hasRealData: data.hasRealData, researchThreads: data.researchThreads, discoveredLinkedIn: data.discoveredLinkedIn });
    },
  });

  const relIntel = useMutation({
    mutationFn: async () => {
      if (!row?.companyName) throw new Error("No company");
      const r = await fetch(`${BASE}/api/relationship-intel/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCompanyName: row.companyName, targetWebsite: row.domain }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: (data: { jobId?: string }) => {
      const dbId = data.jobId?.split("-")[1] || data.jobId;
      if (dbId) navigate(`/relationship-intel/tree?jobId=${dbId}`);
    },
  });

  if (!row) return null;

  return (
    <Sheet open={!!row} onOpenChange={(o) => { if (!o) { setReport(null); onClose(); } }}>
      <SheetContent side="right" className="w-[520px] sm:w-[640px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            {row.companyName || "—"}
          </SheetTitle>
          {row.companyNameAr && <SheetDescription dir="rtl" className="text-right">{row.companyNameAr}</SheetDescription>}
        </SheetHeader>

        {/* Scoring strip */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {row.priorityTier && (
            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded border uppercase", TIER_COLOR[row.priorityTier] || TIER_COLOR.D)}>
              Tier {row.priorityTier}
            </span>
          )}
          <Badge variant="outline" className="text-[10px]">ICP {row.icpScore ?? 0}</Badge>
          {row.buyingScore !== null && <Badge variant="outline" className="text-[10px]">Buy {row.buyingScore}</Badge>}
          {row.qualityScore !== null && <Badge variant="outline" className="text-[10px]">Q {Math.round(row.qualityScore)}</Badge>}
          <Badge variant="outline" className={cn("text-[10px]", row.validationStatus === "verified" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30")}>
            {row.validationStatus}
          </Badge>
          {row.publishedCompanyId && <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">published</Badge>}
        </div>

        {/* Firmographics */}
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          {row.industry && <div><span className="text-muted-foreground">Industry:</span> {row.industry}{row.subIndustry ? ` / ${row.subIndustry}` : ""}</div>}
          {row.city && <div><span className="text-muted-foreground">City:</span> {row.city}</div>}
          {row.employeeCount && <div><span className="text-muted-foreground">Size:</span> {row.employeeCount}</div>}
          {row.revenue && <div><span className="text-muted-foreground">Revenue:</span> {row.revenue}</div>}
          {row.crNumber && <div><span className="text-muted-foreground">CR:</span> {row.crNumber}</div>}
          {row.domain && <div><span className="text-muted-foreground">Domain:</span> <a href={`https://${row.domain}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{row.domain}</a></div>}
        </div>

        {/* Contacts */}
        <div className="mt-3 space-y-1 text-xs">
          {row.email && <div className="flex items-center gap-2"><Mail className="w-3 h-3 text-emerald-400" /><a href={`mailto:${row.email}`} className="hover:underline">{row.email}</a></div>}
          {row.phone && <div className="flex items-center gap-2"><Phone className="w-3 h-3 text-emerald-400" /><a href={`tel:${row.phone}`} className="hover:underline">{row.phone}</a></div>}
          {row.linkedinUrl && <div className="flex items-center gap-2"><Linkedin className="w-3 h-3 text-primary" /><a href={row.linkedinUrl} target="_blank" rel="noopener noreferrer" className="hover:underline inline-flex items-center gap-1">LinkedIn <ExternalLink className="w-2.5 h-2.5" /></a></div>}
        </div>

        {/* Outreach previews */}
        {(row.outreachEmail || row.outreachLinkedin || row.outreachWhatsapp || row.openingAngle) && (
          <div className="mt-4 space-y-2">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Outreach</div>
            {row.openingAngle && (
              <Card className="bg-primary/5 border-primary/20"><CardContent className="p-2 text-xs italic">{row.openingAngle}</CardContent></Card>
            )}
            {row.outreachEmail && (
              <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Email template</summary>
                <pre className="mt-1 p-2 bg-background/30 border border-border/30 rounded whitespace-pre-wrap">{row.outreachEmail}</pre>
              </details>
            )}
            {row.outreachLinkedin && (
              <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">LinkedIn DM</summary>
                <pre className="mt-1 p-2 bg-background/30 border border-border/30 rounded whitespace-pre-wrap">{row.outreachLinkedin}</pre>
              </details>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Deep dive</div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="secondary" onClick={() => companyIntel.mutate()} disabled={companyIntel.isPending} className="gap-1.5">
              {companyIntel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Building2 className="w-3 h-3" />}
              Company Intel
            </Button>
            <Button size="sm" variant="secondary" onClick={() => personIntel.mutate()} disabled={personIntel.isPending || !row.keyExecutives?.[0]?.name} className="gap-1.5">
              {personIntel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Person Intel
            </Button>
          </div>
          <Button size="sm" onClick={() => relIntel.mutate()} disabled={relIntel.isPending} className="w-full gap-1.5">
            {relIntel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Network className="w-3 h-3" />}
            Run Relationship Intel
          </Button>
        </div>

        {/* Report */}
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
        {(companyIntel.error || personIntel.error || relIntel.error) && (
          <div className="mt-3 text-xs text-red-400">
            {(companyIntel.error || personIntel.error || relIntel.error)?.toString()}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LeadFactoryResultsPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(getJobIdFromUrl());
  const [selected, setSelected] = useState<LeadResult | null>(null);
  const [mode, setMode] = useState<"person" | "company">("company");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery<ResultsResponse>({
    queryKey: ["lead-factory", "results", jobId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/lead-factory/results/${jobId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !!jobId,
  });

  const bulkAction = useMutation({
    mutationFn: async (action: "publish" | "reject") => {
      const r = await fetch(`${BASE}/api/lead-factory/results/${jobId}/bulk-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, rowIds: Array.from(checked), autoEnrichDownstream: action === "publish" }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      return data as { ok: true; affected: number };
    },
    onSuccess: () => {
      setChecked(new Set());
      qc.invalidateQueries({ queryKey: ["lead-factory", "results", jobId] });
    },
  });

  const rows = (data?.results || []).filter((r) => tierFilter === "all" || r.priorityTier === tierFilter);
  const stats = (data?.results || []).reduce((acc, r) => {
    const t = r.priorityTier || "D";
    acc[t] = (acc[t] || 0) + 1;
    acc.total++;
    if (r.publishedCompanyId) acc.published++;
    return acc;
  }, { total: 0, published: 0 } as Record<string, number>);

  function download(format: string) {
    window.open(`${BASE}/api/lead-factory/results/${jobId}/export?format=${format}`, "_blank");
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-[1400px]">
      <LeadFactoryTabs />
      <div className="flex items-center justify-between mb-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/lead-factory")} className="gap-1.5 mb-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to hub
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileBarChart className="w-6 h-6 text-primary" />
            Lead Factory Results — Job {jobId || "—"}
          </h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-1">
              {stats.total ?? 0} prospects · A:{stats.A ?? 0} B:{stats.B ?? 0} C:{stats.C ?? 0} D:{stats.D ?? 0} · {stats.published ?? 0} published
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(["all", "A", "B", "C", "D"]).map((t) => (
            <Button key={t} size="sm" variant={tierFilter === t ? "default" : "outline"} onClick={() => setTierFilter(t)} className="h-7 px-2 text-[11px]">
              {t === "all" ? "All" : `Tier ${t}`}
            </Button>
          ))}
          <Button size="sm" variant={mode === "person" ? "default" : "outline"} onClick={() => setMode(mode === "person" ? "company" : "person")} className="h-7 px-2 text-[11px]">
            View: {mode}
          </Button>
        </div>
      </div>

      {/* Export controls + bulk actions */}
      <div className="flex items-center gap-2 mb-4">
        <Button size="sm" variant="outline" onClick={() => download("csv")}     className="gap-1.5"><Download className="w-3 h-3" /> CSV</Button>
        <Button size="sm" variant="outline" onClick={() => download("xlsx")}    className="gap-1.5"><FileSpreadsheet className="w-3 h-3" /> XLSX</Button>
        <Button size="sm" variant="outline" onClick={() => download("pdf")}     className="gap-1.5"><FileText className="w-3 h-3" /> PDF</Button>
        <Button size="sm" variant="outline" onClick={() => download("ppt")}     className="gap-1.5"><FileText className="w-3 h-3" /> PPT</Button>
        <Button size="sm" variant="outline" onClick={() => download("json")}    className="gap-1.5"><Code className="w-3 h-3" /> JSON</Button>
        {checked.size > 0 && (
          <div className="ml-auto flex items-center gap-2 px-3 py-1 rounded-md bg-primary/10 border border-primary/30">
            <span className="text-xs font-semibold text-primary">{checked.size} selected</span>
            <Button size="sm" onClick={() => bulkAction.mutate("publish")} disabled={bulkAction.isPending} className="h-7 px-2 text-[11px] gap-1.5">
              {bulkAction.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
              Publish
            </Button>
            <Button size="sm" variant="destructive" onClick={() => bulkAction.mutate("reject")} disabled={bulkAction.isPending} className="h-7 px-2 text-[11px]">
              Reject
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())} className="h-7 px-2 text-[11px]">Clear</Button>
          </div>
        )}
      </div>
      {bulkAction.error && <div className="mb-2 text-xs text-red-400">{(bulkAction.error as Error).message}</div>}

      {/* Empty/loading states */}
      {!jobId && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">No jobId in URL. Open from a Lead Factory run.</CardContent></Card>
      )}
      {jobId && isLoading && (
        <Card><CardContent className="p-6 text-center flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading results…</CardContent></Card>
      )}

      {/* Table */}
      {data && rows.length > 0 && (
        <Card className="bg-card/65 border-border/40">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-card/70 border-b border-border/40">
                <tr>
                  <th className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => checked.has(r.id))}
                      onChange={(e) => {
                        const next = new Set(checked);
                        if (e.target.checked) rows.forEach((r) => next.add(r.id));
                        else rows.forEach((r) => next.delete(r.id));
                        setChecked(next);
                      }}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="text-left px-3 py-2 font-semibold">Company</th>
                  <th className="text-left px-3 py-2 font-semibold">Domain</th>
                  <th className="text-left px-3 py-2 font-semibold">Contact</th>
                  <th className="text-left px-3 py-2 font-semibold">City</th>
                  <th className="text-left px-3 py-2 font-semibold">Industry</th>
                  <th className="text-right px-3 py-2 font-semibold">ICP</th>
                  <th className="text-center px-3 py-2 font-semibold">Tier</th>
                  <th className="text-center px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn("border-b border-border/20 hover:bg-card/70 cursor-pointer", selected?.id === r.id && "bg-primary/5", checked.has(r.id) && "bg-primary/10")}
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked.has(r.id)}
                        onChange={(e) => {
                          const next = new Set(checked);
                          if (e.target.checked) next.add(r.id); else next.delete(r.id);
                          setChecked(next);
                        }}
                        aria-label={`Select ${r.companyName}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium truncate max-w-[220px]">{r.companyName}</div>
                      {r.companyNameAr && <div className="text-[10px] text-muted-foreground truncate max-w-[220px]" dir="rtl">{r.companyNameAr}</div>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.domain}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.email && <Mail className="inline w-3 h-3 mr-1 text-emerald-400" />}
                      {r.phone && <Phone className="inline w-3 h-3 mr-1 text-emerald-400" />}
                      {r.linkedinUrl && <Linkedin className="inline w-3 h-3 mr-1 text-primary" />}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.city}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]">{r.industry}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.icpScore ?? "—"}</td>
                    <td className="px-3 py-2 text-center">
                      {r.priorityTier && (
                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase", TIER_COLOR[r.priorityTier] || TIER_COLOR.D)}>
                          {r.priorityTier}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn("text-[9px] px-1.5 py-0.5 rounded border", r.validationStatus === "verified" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30")}>
                        {r.validationStatus}
                      </span>
                      {r.publishedCompanyId && <ArrowRight className="inline w-3 h-3 ml-1 text-primary" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {data && rows.length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">No rows match the current filter.</CardContent></Card>
      )}

      <RowDrawer row={selected} mode={mode} onClose={() => setSelected(null)} />
    </div>
  );
}
