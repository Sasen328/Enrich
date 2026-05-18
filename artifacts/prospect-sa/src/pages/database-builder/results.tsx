import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Search, ChevronLeft, ChevronRight, Loader2,
  Globe, Phone, Mail, CheckCircle2, AlertCircle, Zap,
  Database, BarChart3, Layers, X, RefreshCw, Trash2,
  MapPin, ArrowLeft, Brain, ExternalLink, User, DollarSign,
  Hash, Users, FileText, ChevronDown, Send, Download,
  FileSpreadsheet,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BuilderCompany {
  id: number; jobId: string; sourceId: string; sourceName?: string | null;
  nameAr?: string | null; nameEn?: string | null; industry?: string | null;
  city?: string | null; region?: string | null; country?: string;
  website?: string | null; phone?: string | null; email?: string | null; address?: string | null;
  description?: string | null; employeeCount?: number | null; revenue?: string | null;
  ownerName?: string | null; ownerNameAr?: string | null; ownerTitle?: string | null;
  ownerPhone?: string | null; ownerEmail?: string | null;
  crNumber?: string | null; capitalAmount?: string | null; entityType?: string | null;
  companyType?: string | null; foundingYear?: number | null;
  enrichmentScore?: number | null; enrichmentStatus?: string | null;
  isDuplicate?: boolean; isValidated?: boolean; createdAt?: string;
  keyExecutives?: string | null; shareholders?: string | null;
  marketPositioning?: string | null; recentNews?: string | null;
  linkedinUrl?: string | null;
}

function DetailPanel({
  company,
  onClose,
}: {
  company: BuilderCompany;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [enrichData, setEnrichData] = useState<Record<string, unknown> | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [savedExecutives, setSavedExecutives] = useState<Record<string, unknown>[] | null>(null);
  const [savedShareholders, setSavedShareholders] = useState<Record<string, unknown>[] | null>(null);
  const [chatMsg, setChatMsg] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string }[]>([]);
  const [chatReportId, setChatReportId] = useState<number | null>(null);
  const [chatting, setChatting] = useState(false);

  const name = company.nameEn || company.nameAr || "Unknown";

  const addPersonAsLead = async (person: Record<string, unknown>, personTitle?: string) => {
    const fullName = String(person?.name || person?.nameEn || person?.ownerName || "");
    const fullNameAr = String(person?.nameAr || person?.ownerNameAr || "");
    const parts = fullName.trim().split(/\s+/);
    const arParts = fullNameAr.trim().split(/\s+/);
    const title = personTitle || String(person?.title || person?.role || person?.ownerTitle || "");
    if (!fullName.trim()) { toast({ title: "No name", description: "Person has no name to add", variant: "destructive" }); return; }

    // Step 1: Save to leads immediately
    toast({ title: "Adding lead…", description: `Saving ${fullName} and launching full AI enrichment` });
    try {
      const r = await fetch(`${BASE}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: parts[0] || "",
          lastName: parts.slice(1).join(" ") || "",
          firstNameAr: arParts[0] || "",
          lastNameAr: arParts.slice(1).join(" ") || "",
          title,
          email: String(person?.email || person?.ownerEmail || ""),
          phone: String(person?.phone || person?.ownerPhone || ""),
          linkedin: String(person?.linkedin || ""),
          nationality: "",
          bio: "",
          industry: company.industry || "",
          city: company.city || "",
          notes: [
            `Company: ${name}`,
            person?.percentage ? `Ownership: ${String(person.percentage)}%` : "",
          ].filter(Boolean).join(" | "),
          status: "new",
          source: "database-builder",
        }),
      });
      if (!r.ok) { toast({ title: "Failed to save lead", variant: "destructive" }); return; }
      toast({ title: "Lead added ✓", description: `${fullName} saved. Full AI enrichment running — check ProsEngine Research shortly.` });
    } catch {
      toast({ title: "Failed to save lead", variant: "destructive" }); return;
    }

    // Step 2: Fire full agentic profile in background
    void fetch(`${BASE}/api/person-intel/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fullName,
        company: name,
        title,
        knownFacts: [
          company.city ? `City: ${company.city}` : "",
          company.industry ? `Industry: ${company.industry}` : "",
          person?.percentage ? `Ownership: ${String(person.percentage)}%` : "",
        ].filter(Boolean).join(". "),
      }),
    }).then(async (pr) => {
      if (!pr.ok) { console.warn("[BuilderLead] Profile enrichment failed:", pr.status); return; }
      const profileData = await pr.json() as Record<string, unknown>;
      // Step 3: Auto-save to ProsEngine Research
      const saveRes = await fetch(`${BASE}/api/person-intel/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personName: fullName,
          company: name,
          title,
          report: profileData,
          tags: "builder-auto",
          notes: `Auto-saved via +Lead from AI Database Builder.`,
        }),
      });
      if (saveRes.ok) console.log(`[BuilderLead] Profile saved to ProsEngine Research for ${fullName}`);
    }).catch(err => console.warn("[BuilderLead] Background enrichment failed:", err));
  };

  const score = company.enrichmentScore || 0;
  const scoreColor = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-muted-foreground";

  const handleEnrich = async () => {
    setEnriching(true);
    setEnrichError("");
    try {
      const res = await fetch(`${BASE}/api/orcengine/enrich/company`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          websiteUrl: company.website || undefined,
          industry: company.industry || undefined,
          country: "Saudi Arabia",
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Enrichment failed");
      }
      const data = await res.json();
      setEnrichData(data.reportData || data);
      if (data.id) setChatReportId(data.id);

      // Extract executives and shareholders from OrcEngine result and save back to builder company
      const reportData = data.reportData || {};
      const executives: Record<string, unknown>[] = reportData.leadership?.executiveTeam?.filter(Boolean) || [];
      const shareholders: Record<string, unknown>[] = reportData.ownership?.majorShareholders || [];
      if ((executives.length > 0 || shareholders.length > 0) && company.id) {
        fetch(`${BASE}/api/builder/results/${company.id}/save-enrichment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keyExecutives: executives.length > 0 ? JSON.stringify(executives) : undefined,
            shareholders: shareholders.length > 0 ? JSON.stringify(shareholders) : undefined,
            description: reportData.profileSummary || undefined,
            marketPositioning: (reportData as Record<string, unknown>).companyPositioning as string | undefined,
          }),
        }).then(r => {
          if (r.ok) {
            if (executives.length > 0) setSavedExecutives(executives);
            if (shareholders.length > 0) setSavedShareholders(shareholders);
          }
        }).catch(() => {});
      }
    } catch (err: unknown) {
      setEnrichError(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setEnriching(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch(`${BASE}/api/builder/push-to-database`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [company.id] }),
      });
      if (!res.ok) throw new Error("Failed to seed");
      setSeeded(true);
    } catch {
      /* ignore */
    } finally {
      setSeeding(false);
    }
  };

  const handleChat = async () => {
    if (!chatReportId || !chatMsg.trim()) return;
    const msg = chatMsg;
    setChatMsg("");
    setChatting(true);
    try {
      const res = await fetch(`${BASE}/api/orcengine/enrich/${chatReportId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      setChatHistory((prev) => [
        ...prev,
        { role: "user", content: msg },
        { role: "assistant", content: data.response || "No response" },
      ]);
    } catch {
      /* ignore */
    } finally {
      setChatting(false);
    }
  };

  const parseJSON = (val: string | null | undefined) => {
    if (!val) return null;
    try { return JSON.parse(val); } catch { return null; }
  };

  const executives: Record<string, unknown>[] | null = savedExecutives ?? parseJSON(company.keyExecutives);
  const shareholders: Record<string, unknown>[] | null = savedShareholders ?? parseJSON(company.shareholders);

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-[520px] bg-[#0d1117] border-l border-white/10 z-50 flex flex-col shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-white text-sm truncate">{name}</p>
            {company.nameAr && company.nameEn && (
              <p className="text-[10px] text-muted-foreground" dir="rtl">{company.nameAr}</p>
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0 shrink-0">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Status row */}
        <div className="flex flex-wrap gap-2">
          {company.enrichmentStatus && (
            <Badge variant="outline" className={cn("text-[10px]",
              company.enrichmentStatus === "enriched" ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" : "border-white/10 text-muted-foreground")}>
              {company.enrichmentStatus}
            </Badge>
          )}
          {company.isDuplicate && <Badge variant="outline" className="text-[10px] border-rose-500/20 text-rose-400 bg-rose-500/10">duplicate</Badge>}
          {company.isValidated && <Badge variant="outline" className="text-[10px] border-emerald-500/20 text-emerald-400 bg-emerald-500/10">validated</Badge>}
          {score > 0 && <Badge variant="outline" className={cn("text-[10px]", scoreColor)}>{score}% enriched</Badge>}
          <Badge variant="outline" className="text-[10px] border-white/10 text-muted-foreground">via {company.sourceName || company.sourceId}</Badge>
        </div>

        {/* Core info grid */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Industry", value: company.industry, icon: BarChart3 },
            { label: "City", value: company.city, icon: MapPin },
            { label: "Region", value: company.region, icon: MapPin },
            { label: "Country", value: company.country, icon: Globe },
            { label: "Employees", value: company.employeeCount?.toLocaleString(), icon: Users },
            { label: "Revenue", value: company.revenue, icon: DollarSign },
            { label: "Founded", value: company.foundingYear?.toString(), icon: FileText },
            { label: "CR Number", value: company.crNumber, icon: Hash },
            { label: "Entity Type", value: company.entityType, icon: FileText },
            { label: "Company Type", value: company.companyType, icon: Building2 },
            { label: "Capital", value: company.capitalAmount, icon: DollarSign },
          ].filter(f => f.value).map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-white/3 border border-white/6 rounded-lg p-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5 flex items-center gap-1">
                <Icon className="w-2.5 h-2.5" />{label}
              </p>
              <p className="text-xs text-white truncate">{value}</p>
            </div>
          ))}
        </div>

        {/* Contact info */}
        {(company.website || company.phone || company.email || company.address) && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Contact</p>
            {company.website && (
              <a href={company.website} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-primary hover:underline">
                <Globe className="w-3 h-3" /> {company.website}
              </a>
            )}
            {company.phone && (
              <div className="flex items-center gap-2 text-xs text-white/70">
                <Phone className="w-3 h-3 text-muted-foreground" /> {company.phone}
              </div>
            )}
            {company.email && (
              <div className="flex items-center gap-2 text-xs text-white/70">
                <Mail className="w-3 h-3 text-muted-foreground" /> {company.email}
              </div>
            )}
            {company.address && (
              <div className="flex items-start gap-2 text-xs text-white/70">
                <MapPin className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" /> {company.address}
              </div>
            )}
            {company.linkedinUrl && (
              <a href={company.linkedinUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-blue-400 hover:underline">
                <ExternalLink className="w-3 h-3" /> LinkedIn
              </a>
            )}
          </div>
        )}

        {/* Owner */}
        {company.ownerName && (
          <div className="bg-violet-500/5 border border-violet-500/15 rounded-xl p-3">
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <User className="w-2.5 h-2.5" /> Owner / Key Contact
              </p>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 h-6 text-[10px] px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                onClick={() => void addPersonAsLead({
                  name: company.ownerName, nameAr: company.ownerNameAr,
                  ownerTitle: company.ownerTitle, ownerPhone: company.ownerPhone, ownerEmail: company.ownerEmail,
                }, company.ownerTitle || "Owner")}
              >
                + Lead
              </Button>
            </div>
            <p className="text-sm font-semibold text-white">{company.ownerName}</p>
            {company.ownerNameAr && <p className="text-xs text-muted-foreground" dir="rtl">{company.ownerNameAr}</p>}
            {company.ownerTitle && <p className="text-xs text-muted-foreground">{company.ownerTitle}</p>}
            {company.ownerPhone && <p className="text-xs text-white/60 mt-1">{company.ownerPhone}</p>}
            {company.ownerEmail && <p className="text-xs text-white/60">{company.ownerEmail}</p>}
          </div>
        )}

        {/* Description */}
        {company.description && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Description</p>
            <p className="text-xs text-white/70 leading-relaxed">{company.description}</p>
          </div>
        )}

        {/* Executives */}
        {Array.isArray(executives) && executives.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Executives</p>
            <div className="space-y-1.5">
              {executives.slice(0, 6).map((exec: Record<string, unknown>, i: number) => (
                <div key={i} className="bg-primary/5 border border-primary/10 rounded-lg p-2 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-white truncate">{String(exec?.name || "")}</p>
                    <p className="text-[10px] text-muted-foreground">{String(exec?.title || exec?.role || "")}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-6 text-[10px] px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                    onClick={() => void addPersonAsLead(exec)}
                  >
                    + Lead
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Shareholders */}
        {Array.isArray(shareholders) && shareholders.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Shareholders</p>
            <div className="space-y-1">
              {shareholders.slice(0, 5).map((sh: Record<string, unknown>, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 text-xs bg-white/3 rounded-lg px-2 py-1.5">
                  <span className="text-white flex-1 min-w-0 truncate">{String(sh?.name || "")}</span>
                  {sh?.percentage != null && <span className="text-muted-foreground shrink-0">{String(sh.percentage)}%</span>}
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-6 text-[10px] px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                    onClick={() => void addPersonAsLead(sh, "Shareholder")}
                  >
                    + Lead
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Market positioning */}
        {company.marketPositioning && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Market Position</p>
            <p className="text-xs text-white/70 leading-relaxed">{company.marketPositioning}</p>
          </div>
        )}

        {/* AI Enrichment Results */}
        {enrichData && (
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
              <Brain className="w-3 h-3" /> AI Analysis Complete
            </p>
            {(enrichData.profileSummary as string) && (
              <p className="text-xs text-white/80 leading-relaxed">{String(enrichData.profileSummary)}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(enrichData)
                .filter(([k, v]) => v && !Array.isArray(v) && typeof v !== "object" && k !== "profileSummary")
                .slice(0, 10)
                .map(([k, v]) => (
                  <div key={k} className="bg-black/20 rounded-lg p-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">
                      {k.replace(/([A-Z])/g, " $1").trim()}
                    </p>
                    <p className="text-[11px] text-white">{String(v)}</p>
                  </div>
                ))}
            </div>
            {/* Executive team from AI */}
            {Boolean((enrichData.leadership as Record<string, unknown>)?.executiveTeam) && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">AI-Found Executives</p>
                <div className="space-y-1.5">
                  {((enrichData.leadership as Record<string, unknown>).executiveTeam as Record<string, unknown>[])
                    .filter(Boolean).slice(0, 6).map((exec, i) => (
                      <div key={i} className="bg-primary/5 border border-primary/10 rounded-lg p-2 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-white truncate">{String(exec?.name || "")}</p>
                          <p className="text-[10px] text-muted-foreground">{String(exec?.title || exec?.role || "")}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 h-6 text-[10px] px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                          onClick={() => void addPersonAsLead(exec)}
                        >
                          + Lead
                        </Button>
                      </div>
                    ))}
                </div>
              </div>
            )}
            {/* Major shareholders from AI */}
            {Boolean((enrichData.ownership as Record<string, unknown>)?.majorShareholders) && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">AI-Found Shareholders</p>
                <div className="space-y-1.5">
                  {((enrichData.ownership as Record<string, unknown>).majorShareholders as Record<string, unknown>[])
                    .filter(Boolean).slice(0, 5).map((sh, i) => (
                      <div key={i} className="bg-white/3 border border-white/8 rounded-lg px-2 py-1.5 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-white truncate">{String(sh?.name || "")}</p>
                          {sh?.percentage != null && <p className="text-[10px] text-muted-foreground">{String(sh.percentage)}%</p>}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 h-6 text-[10px] px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                          onClick={() => void addPersonAsLead(sh, "Shareholder")}
                        >
                          + Lead
                        </Button>
                      </div>
                    ))}
                </div>
              </div>
            )}
            {/* Chat with report */}
            {chatReportId && (
              <div className="pt-2 border-t border-white/10">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Ask a follow-up</p>
                <div className="space-y-1.5 max-h-32 overflow-y-auto mb-2">
                  {chatHistory.map((m, i) => (
                    <div key={i} className={cn("rounded-lg p-2 text-xs",
                      m.role === "user" ? "bg-primary/10 text-primary" : "bg-white/5 text-white/80")}>
                      {m.content}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input value={chatMsg} onChange={(e) => setChatMsg(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && chatMsg) handleChat(); }}
                    placeholder="Ask about this company..." className="bg-black/30 border-white/15 h-8 text-xs" />
                  <Button size="sm" onClick={handleChat} disabled={!chatMsg || chatting}
                    className="h-8 px-2 bg-violet-600 hover:bg-violet-700">
                    {chatting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {enrichError && (
          <p className="text-xs text-rose-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {enrichError}
          </p>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-5 py-4 border-t border-white/8 shrink-0 space-y-2">
        {!enrichData && (
          <Button onClick={handleEnrich} disabled={enriching}
            className="w-full bg-primary hover:bg-primary/90 gap-2">
            {enriching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
            {enriching ? "Running AI Analysis (8-agent pipeline)..." : "Get Full AI Analysis"}
          </Button>
        )}
        {enriching && (
          <p className="text-[10px] text-primary text-center">
            Querying Perplexity · OpenAI · Apollo · Crawler · Playwright...
          </p>
        )}
        <Button onClick={handleSeed} disabled={seeding || seeded}
          variant="outline"
          className={cn("w-full gap-2 border", seeded ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" : "border-primary/30 text-primary hover:bg-primary/10")}>
          {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : seeded ? <CheckCircle2 className="w-4 h-4" /> : <Database className="w-4 h-4" />}
          {seeded ? "Seeded to OrcBase!" : seeding ? "Seeding..." : "Seed to OrcBase"}
        </Button>
      </div>
    </div>
  );
}

export default function BuilderResults() {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState("");
  const [hideDuplicates, setHideDuplicates] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState<BuilderCompany | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const resultsQ = useQuery<{ companies: BuilderCompany[]; total: number; page: number }>({
    queryKey: ["builder-results", page, search, sourceFilter, hideDuplicates],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: "20", hideDuplicates: String(hideDuplicates) });
      if (search) p.set("search", search);
      if (sourceFilter) p.set("jobId", sourceFilter);
      return fetch(`${BASE}/api/builder/results?${p}`).then(r => r.json());
    },
  });

  const statsQ = useQuery<{ total: number; enriched: number; pending: number; duplicates: number }>({
    queryKey: ["builder-stats"],
    queryFn: () => fetch(`${BASE}/api/builder/stats`).then(r => r.json()),
    refetchInterval: 10000,
  });

  const deduplicateMutation = useMutation({
    mutationFn: () => fetch(`${BASE}/api/builder/deduplicate`, { method: "POST" }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["builder-results"] }); qc.invalidateQueries({ queryKey: ["builder-stats"] }); },
  });

  const enrichAllMutation = useMutation({
    mutationFn: () => fetch(`${BASE}/api/builder/bulk-enrich`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["builder-results"] }); qc.invalidateQueries({ queryKey: ["builder-stats"] }); },
  });

  const seedAllMutation = useMutation({
    mutationFn: () => fetch(`${BASE}/api/builder/push-to-database`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["builder-results"] }); qc.invalidateQueries({ queryKey: ["builder-stats"] }); },
  });

  const toggleRow = (id: number) => setSelectedRows(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const deleteSelectedCompanies = async () => {
    if (selectedRows.size === 0) return;
    const ids = Array.from(selectedRows);
    setDeletingSelected(true);
    try {
      const r = await fetch(`${BASE}/api/builder/companies/bulk`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) throw new Error("Delete failed");
      setSelectedRows(new Set());
      void qc.invalidateQueries({ queryKey: ["builder-results"] });
      void qc.invalidateQueries({ queryKey: ["builder-stats"] });
      toast({ title: `${ids.length} compan${ids.length !== 1 ? "ies" : "y"} deleted` });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setDeletingSelected(false);
    }
  };

  const handleExport = async (format: string) => {
    const params = new URLSearchParams({ format, hideDuplicates: String(hideDuplicates) });
    if (search) params.set("search", search);
    if (sourceFilter) params.set("sourceId", sourceFilter);
    if (selectedRows.size > 0) params.set("ids", Array.from(selectedRows).join(","));
    const url = `${BASE}/api/builder/export?${params}`;
    if (format === "pdf") { window.open(url, "_blank"); return; }
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const ext = format === "excel" ? "xlsx" : format === "word" ? "doc" : format;
      const filename = `builder_results_${new Date().toISOString().slice(0, 10)}.${ext}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast({ title: "Export failed. Please try again.", variant: "destructive" });
    }
  };

  const companies = resultsQ.data?.companies || [];
  const total = statsQ.data?.total || resultsQ.data?.total || 0;
  const totalPages = Math.ceil((resultsQ.data?.total || 0) / 20);

  const enrichedCount = statsQ.data?.enriched || 0;
  const pendingCount = statsQ.data?.pending || 0;
  const dupCount = statsQ.data?.duplicates || 0;

  return (
    <div className="flex flex-col h-full p-6 gap-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Link href="/database-builder" className="text-muted-foreground hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="w-9 h-9 bg-emerald-500/15 rounded-xl border border-emerald-500/20 flex items-center justify-center">
            <Database className="w-5 h-5 text-emerald-400" />
          </div>
          <h1 className="text-3xl font-display font-bold text-white">Builder Results</h1>
        </div>
        <p className="text-muted-foreground text-sm ml-16">Companies harvested by the AI Builder — click any row to view details & run AI analysis</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Harvested", value: total.toLocaleString(), color: "text-emerald-400", icon: Database },
          { label: "AI Enriched", value: enrichedCount.toString(), color: "text-primary", icon: Zap },
          { label: "Pending Enrichment", value: pendingCount.toString(), color: "text-amber-400", icon: AlertCircle },
          { label: "Duplicates Found", value: dupCount.toString(), color: "text-rose-400", icon: Layers },
        ].map(s => (
          <Card key={s.label} className="bg-card/50 border-white/8">
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <s.icon className={cn("w-5 h-5 shrink-0", s.color)} />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={cn("text-xl font-bold", s.color)}>{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Actions bar */}
      <div className="flex gap-2 shrink-0 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={searchInput} onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
            placeholder="Search harvested companies..." className="pl-9 bg-black/30 border-white/15 h-9" />
        </div>
        <button
          onClick={() => { setHideDuplicates(v => !v); setPage(1); }}
          className={cn(
            "h-9 px-3 rounded-md border text-xs font-medium flex items-center gap-1.5 transition-all",
            hideDuplicates
              ? "border-primary/30 text-primary bg-primary/10"
              : "border-white/10 text-muted-foreground hover:text-white"
          )}>
          <Layers className="w-3.5 h-3.5" />
          {hideDuplicates ? "Unique Only" : "Show All"}
        </button>
        <Button size="sm" onClick={() => deduplicateMutation.mutate()} disabled={deduplicateMutation.isPending}
          variant="outline" className="h-9 border-amber-500/30 text-amber-400 gap-1.5">
          {deduplicateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          Deduplicate
        </Button>
        {selectedRows.size > 0 && (
          <Button size="sm" variant="outline"
            className="h-9 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 gap-1.5"
            onClick={deleteSelectedCompanies}
            disabled={deletingSelected}>
            {deletingSelected ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Delete ({selectedRows.size})
          </Button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-9 border-sky-500/30 text-sky-400 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              {selectedRows.size > 0 ? `Export (${selectedRows.size})` : "Export"}
              <ChevronDown className="w-3 h-3 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-1.5 bg-card border-border/60 shadow-xl" align="end">
            {selectedRows.size > 0 && (
              <p className="text-xs text-muted-foreground px-3 pt-1 pb-1.5 border-b border-border/40 mb-1">
                {selectedRows.size} selected compan{selectedRows.size !== 1 ? "ies" : "y"}
              </p>
            )}
            {[
              { fmt: "excel", label: "Excel Spreadsheet (.xlsx)", Icon: FileSpreadsheet },
              { fmt: "csv", label: "CSV File", Icon: FileSpreadsheet },
              { fmt: "word", label: "Word Document (.doc)", Icon: FileText },
              { fmt: "pptx", label: "PowerPoint (.pptx)", Icon: FileText },
              { fmt: "pdf", label: "Print / Save as PDF", Icon: FileText },
            ].map(({ fmt, label, Icon }) => (
              <button key={fmt} onClick={() => handleExport(fmt)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm hover:bg-accent/20 transition-colors text-foreground text-left">
                <Icon className="w-4 h-4 text-muted-foreground" />
                {label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <Button size="sm" onClick={() => enrichAllMutation.mutate()} disabled={enrichAllMutation.isPending}
          variant="outline" className="h-9 border-primary/30 text-primary gap-1.5">
          {enrichAllMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
          Bulk Enrich
        </Button>
        <Button size="sm" onClick={() => seedAllMutation.mutate()} disabled={seedAllMutation.isPending}
          className="h-9 bg-emerald-600 hover:bg-emerald-700 gap-1.5">
          {seedAllMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
          {seedAllMutation.isSuccess ? "Seeded!" : "Seed All to OrcBase"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => { resultsQ.refetch(); statsQ.refetch(); }}
          disabled={resultsQ.isFetching} className="h-9 border-white/10">
          <RefreshCw className={cn("w-3.5 h-3.5", resultsQ.isFetching && "animate-spin")} />
        </Button>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {resultsQ.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : companies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Database className="w-12 h-12 opacity-20 mb-3" />
            <p className="font-medium">No harvested companies yet</p>
            <p className="text-sm mt-1">Start a harvest job from the AI Database Builder page</p>
            <Link href="/database-builder">
              <Button size="sm" className="mt-4 bg-primary hover:bg-primary/90">Go to Builder</Button>
            </Link>
          </div>
        ) : (
          companies.map(co => {
            const name = co.nameEn || co.nameAr || "—";
            const score = co.enrichmentScore || 0;
            const scoreColor = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-muted-foreground";
            const isSelected = selectedCompany?.id === co.id;
            const isRowSelected = selectedRows.has(co.id);

            return (
              <div
                key={co.id}
                className={cn(
                  "flex items-start gap-3 bg-card/40 border rounded-xl p-4 transition-all hover:border-white/15",
                  isSelected ? "border-primary/40 bg-primary/5" : isRowSelected ? "border-sky-500/30 bg-sky-500/5" : "border-white/6 hover:bg-card/60"
                )}
              >
                <div className="pt-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                  <Checkbox
                    checked={isRowSelected}
                    onCheckedChange={() => toggleRow(co.id)}
                    className="border-white/20 data-[state=checked]:bg-sky-600 data-[state=checked]:border-sky-600"
                  />
                </div>
                <button className="flex-1 text-left" onClick={() => setSelectedCompany(isSelected ? null : co)}>
                <div className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white text-sm">{name}</p>
                      {co.isDuplicate && (
                        <Badge variant="outline" className="text-[9px] border-rose-500/20 text-rose-400 bg-rose-500/10">duplicate</Badge>
                      )}
                      {co.isValidated && (
                        <Badge variant="outline" className="text-[9px] border-emerald-500/20 text-emerald-400 bg-emerald-500/10">validated</Badge>
                      )}
                    </div>
                    {co.nameAr && co.nameEn && (
                      <p className="text-xs text-muted-foreground" dir="rtl">{co.nameAr}</p>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {co.industry && <span className="text-xs text-muted-foreground">{co.industry}</span>}
                      {co.city && (
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                          <MapPin className="w-3 h-3" />{co.city}
                        </span>
                      )}
                      {co.sourceName && <span className="text-xs text-muted-foreground">via {co.sourceName}</span>}
                    </div>
                    <div className="flex gap-2 mt-1.5">
                      {co.website && <Globe className="w-3.5 h-3.5 text-muted-foreground" />}
                      {co.phone && <Phone className="w-3.5 h-3.5 text-muted-foreground" />}
                      {co.email && <Mail className="w-3.5 h-3.5 text-muted-foreground" />}
                      {co.ownerName && <User className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className={cn("text-xs font-bold", scoreColor)}>{score > 0 ? `${score}%` : "—"}</p>
                    <p className="text-[10px] text-muted-foreground">{co.enrichmentStatus || "pending"}</p>
                    <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", isSelected && "rotate-180")} />
                  </div>
                </div>
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-between pt-4 shrink-0 border-t border-white/5">
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString()} harvested companies · page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1} className="h-8 border-white/10">
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages} className="h-8 border-white/10">
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Company detail slide panel */}
      {selectedCompany && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setSelectedCompany(null)}
          />
          <DetailPanel
            company={selectedCompany}
            onClose={() => setSelectedCompany(null)}
          />
        </>
      )}
    </div>
  );
}
