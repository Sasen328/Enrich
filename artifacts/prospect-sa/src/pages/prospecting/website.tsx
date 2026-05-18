import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Globe, Loader2, CheckCircle2, Search,
  Phone, Mail, MapPin, Briefcase, DollarSign, Calendar,
  User, Hash, Layers, AlertCircle, RefreshCw, Download,
  ScanLine, ClipboardList, Cpu, BarChart3, X, Trash2, ArrowLeft,
  FileText, FileDown, Printer, BookUser, Save, Send, Bot, MessageCircle,
  ChevronDown, ChevronUp, ExternalLink, Plus, Building2, Users, Shield, Database,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import ProsEngineChat from "@/components/ProsEngineChat";

const API = "/api/prospecting";

interface ProspectingJob {
  id: number;
  targetUrl: string;
  status: string;
  progress: number | null;
  resultCount: number | null;
  totalCompaniesFound: number | null;
  totalEnriched: number | null;
  errorMessage: string | null;
  error: string | null;
  scanResult: { progressMessage?: string } | null;
  scanSummary: SiteScanSummary | null;
  pagesScanned: number | null;
  settings: ProspectingSettings | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface SiteScanSummary {
  totalPages?: number;
  dataType?: string;
  siteDescription?: string;
  sampleItems?: string[];
  sampleCompanies?: string[];
  suggestedFields?: string[];
  categories?: string[];
  cities?: string[];
  industries?: string[];
  suggestedQuestions?: Array<{ question: string; options?: string[] }>;
  paginationType?: string;
  websiteType?: string;
  contentLanguage?: string;
  note?: string;
}

interface ProspectingSettings {
  targetUrl: string;
  maxPages: number;
  extractionFields: string[];
  filters: Record<string, unknown>;
  enrichmentDepth: string;
  userAnswers?: Record<string, string | string[]>;
  exportFormat?: string;
  extractionLanguage?: string;
}

interface ExportHistoryItem {
  id: number;
  jobId: number;
  format: string;
  filename: string;
  recordCount: number;
  fileSize: number;
  targetUrl: string | null;
  createdAt: string;
}

interface ProspectingResult {
  id: number;
  jobId: number;
  companyData: CompanyData | null;
  enrichmentStatus: string | null;
  sourceUrl: string | null;
  createdAt: string;
}

interface CompanyData {
  name: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  industry?: string;
  category?: string;
  description?: string;
  employees?: number;
  revenue?: string;
  registrationNumber?: string;
  foundedYear?: number;
  crNumber?: string;
  sourceUrl?: string;
  source?: string;
  contactPerson?: string;
  enrichmentStatus?: string;
  executives?: Array<{ name: string; title?: string; email?: string; phone?: string }>;
  extras?: Record<string, string>;
  [key: string]: unknown;
}

const DIR_STEPS = [
  { num: 1, label: "Target URL", icon: Search },
  { num: 2, label: "Scanning", icon: ScanLine },
  { num: 3, label: "Configure", icon: ClipboardList },
  { num: 4, label: "Extraction", icon: Cpu },
  { num: 5, label: "Results", icon: BarChart3 },
];

const SINGLE_STEPS = [
  { num: 1, label: "Target URL", icon: Search },
  { num: 2, label: "Researching", icon: Loader2 },
  { num: 3, label: "Intel Report", icon: BarChart3 },
];

const DEFAULT_REPORT_FIELDS: Record<string, boolean> = {
  ownerName: true, landline: true, email: true, crNumber: true,
  revenue: true, employees: true, shareholders: true, keyPeople: true,
};

const FOCUS_FIELDS = [
  { key: 'founded',           label: 'Founding Year' },
  { key: 'capital',           label: 'Paid Up Capital' },
  { key: 'revenue',           label: 'Est. Revenue (Prev Year)' },
  { key: 'website',           label: 'Company Website' },
  { key: 'address',           label: 'Company Address' },
  { key: 'landline',          label: 'Company Landline' },
  { key: 'location',          label: 'Company Location' },
  { key: 'ownerName',         label: 'Company Owner Name' },
  { key: 'shareholders',      label: 'Shareholder Names & %' },
  { key: 'marketPositioning', label: 'Market Positioning' },
  { key: 'industry',          label: 'Company Industry' },
  { key: 'employees',         label: 'Employee Count' },
  { key: 'crNumber',          label: 'CR Number' },
  { key: 'keyPeople',         label: 'Key People / Executives' },
  { key: 'services',          label: 'Services Offered' },
  { key: 'entityType',        label: 'Entity Type (LLC/JSC)' },
  { key: 'email',             label: 'Company Email' },
  { key: 'contactPerson',     label: 'Contact Person' },
];

function StepBar({ current, mode = "directory" }: { current: number; mode?: "directory" | "single" }) {
  const steps = mode === "single" ? SINGLE_STEPS : DIR_STEPS;
  return (
    <div className="flex items-center gap-0 w-full">
      {steps.map((s, i) => {
        const done = current > s.num;
        const active = current === s.num;
        const Icon = s.icon;
        return (
          <div key={s.num} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <div className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-500 shrink-0",
                done ? "bg-primary border-primary text-primary-foreground shadow-[0_0_12px_rgba(6,182,212,0.4)]" :
                active ? "bg-primary/20 border-primary text-primary shadow-[0_0_12px_rgba(6,182,212,0.2)]" :
                "bg-card border-white/10 text-muted-foreground",
              )}>
                {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={cn(
                "text-[10px] font-medium hidden sm:block",
                active ? "text-white" : done ? "text-primary" : "text-muted-foreground",
              )}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("h-px flex-1 mb-4 transition-colors duration-500", done ? "bg-primary/60" : "bg-white/8")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const ICON_MAP: Record<string, typeof Phone> = {
  phone: Phone,
  email: Mail,
  website: Globe,
  address: MapPin,
  city: MapPin,
  contactperson: User,
  contact_person: User,
  crnumber: Hash,
  cr_number: Hash,
  employees: Layers,
  revenue: DollarSign,
  foundedyear: Calendar,
  founded_year: Calendar,
  industry: Briefcase,
  category: Briefcase,
};

const ICON_COLORS: Record<string, string> = {
  phone: "text-emerald-400",
  email: "text-blue-400",
  website: "text-cyan-400",
  address: "text-orange-400",
  city: "text-orange-400",
  contactperson: "text-purple-400",
  contact_person: "text-purple-400",
  crnumber: "text-indigo-400",
  cr_number: "text-indigo-400",
  employees: "text-teal-400",
  revenue: "text-yellow-400",
  foundedyear: "text-pink-400",
  founded_year: "text-pink-400",
  industry: "text-violet-400",
  category: "text-amber-400",
};

function RecordCard({ data, enrichmentStatus }: { data: CompanyData; enrichmentStatus?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const status = enrichmentStatus || data.enrichmentStatus || "pending";
  const isEnriched = status === "enriched" || status === "completed";
  const isPartial = status === "partial" || status === "in_progress";
  const extras = data.extras || {};

  const primaryLabel = data.name || String(Object.values(data).find(v => typeof v === 'string' && v.length > 1) || "Unknown");

  const subInfo: string[] = [];
  if (data.industry) subInfo.push(data.industry);
  if (data.city) subInfo.push(data.city);
  if (data.category && data.category !== data.industry) subInfo.push(data.category);

  const standardFields: Array<{ key: string; label: string; value: string | number }> = [];
  const FIELD_LABELS: Record<string, string> = {
    phone: "Phone", email: "Email", website: "Website", address: "Address",
    city: "City", contactPerson: "Contact", crNumber: "CR Number",
    employees: "Employees", revenue: "Revenue", foundedYear: "Founded",
    founded: "Founded", industry: "Industry", category: "Category",
    description: "Description", registrationNumber: "Reg. No.", source: "Source",
    ownerName: "Owner", shareholders: "Shareholders", capital: "Capital",
    landline: "Landline", location: "Location", entityType: "Entity Type",
    keyPeople: "Key People", services: "Services", marketPositioning: "Market Position",
  };
  for (const [k, label] of Object.entries(FIELD_LABELS)) {
    const v = data[k as keyof CompanyData];
    if (v && k !== 'name' && typeof v !== 'object') standardFields.push({ key: k, label, value: v as string | number });
  }
  const extrasEntries = Object.entries(extras).filter(([, v]) => v);

  return (
    <div className={cn(
      "border rounded-lg transition-all",
      isEnriched ? "bg-emerald-500/5 border-emerald-500/15" :
      isPartial ? "bg-amber-500/5 border-amber-500/15" :
      "bg-white/3 border-white/6",
    )}>
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-3 p-3 w-full text-left">
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
          isEnriched ? "bg-emerald-500/15" : "bg-primary/15",
        )}>
          <Layers className={cn("w-4 h-4", isEnriched ? "text-emerald-400" : "text-primary")} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{primaryLabel}</p>
          {subInfo.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{subInfo.join(" · ")}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {data.phone && <Phone className="w-3 h-3 text-emerald-400" />}
          {data.email && <Mail className="w-3 h-3 text-blue-400" />}
          {data.website && <Globe className="w-3 h-3 text-cyan-400" />}
        </div>
        <Badge
          className={cn(
            "text-[9px] font-bold shrink-0",
            isEnriched ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
            isPartial ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
            "bg-white/10 text-white/50 border-white/10",
          )}
          variant="outline"
        >
          {isEnriched ? "Enriched" : isPartial ? "Partial" : "Raw"}
        </Badge>
      </button>
      {expanded && (
        <div className="px-4 pb-3 border-t border-white/5 pt-3 space-y-2">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
            {standardFields.map(({ key, label, value }) => {
              const kl = key.toLowerCase().replace(/[^a-z]/g, '');
              const IconComp = ICON_MAP[kl] || Hash;
              const iconColor = ICON_COLORS[kl] || "text-white/40";
              const isLink = key === 'phone' || key === 'email' || key === 'website';
              const href = key === 'phone' ? `tel:${value}` : key === 'email' ? `mailto:${value}` : String(value);
              return (
                <div key={key} className="flex items-start gap-1.5">
                  <IconComp className={cn("w-3 h-3 shrink-0 mt-0.5", iconColor)} />
                  {isLink ? (
                    <a href={href} target={key === 'website' ? '_blank' : undefined} rel="noopener" className={cn("truncate hover:underline", iconColor, "opacity-80")}>{value}</a>
                  ) : (
                    <span className="text-white/70 truncate"><span className="text-white/35">{label}: </span>{value}</span>
                  )}
                </div>
              );
            })}
          </div>
          {data.executives && data.executives.length > 0 && (
            <div className="mt-2 p-2 bg-white/3 rounded-md">
              <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Key People</p>
              {data.executives.map((ex, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <User className="w-3 h-3 text-purple-400 shrink-0" />
                  <span className="text-white/80">{ex.name}</span>
                  {ex.title && <span className="text-white/40">— {ex.title}</span>}
                  {ex.email && <a href={`mailto:${ex.email}`} className="text-blue-400/60 hover:underline ml-1">{ex.email}</a>}
                  {ex.phone && <a href={`tel:${ex.phone}`} className="text-emerald-400/60 hover:underline ml-1">{ex.phone}</a>}
                </div>
              ))}
            </div>
          )}
          {extrasEntries.length > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] pt-1">
              {extrasEntries.map(([k, v]) => {
                const focusField = FOCUS_FIELDS.find(f => f.key === k);
                const displayLabel = focusField?.label || FIELD_LABELS[k] || k.replace(/_/g, ' ');
                return (
                  <div key={k} className="flex items-start gap-1.5">
                    <span className="text-white/30 shrink-0">{displayLabel}:</span>
                    <span className="text-white/65 break-words">{v}</span>
                  </div>
                );
              })}
            </div>
          )}
          {data.description && (
            <p className="text-[10px] text-white/50 mt-1 italic">{data.description}</p>
          )}
        </div>
      )}
    </div>
  );
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export default function WebsiteIntelPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [url, setUrl] = useState("");
  const [inputMode, setInputMode] = useState<"url" | "text">("url");
  const [urlMode, setUrlMode] = useState<"directory" | "single">("directory");
  const [companyProfile, setCompanyProfile] = useState<Record<string, unknown> | null>(null);
  const [textPrompt, setTextPrompt] = useState("");
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [job, setJob] = useState<ProspectingJob | null>(null);
  const [results, setResults] = useState<ProspectingResult[]>([]);
  const [maxPages, setMaxPages] = useState(50);
  const [enrichmentDepth, setEnrichmentDepth] = useState<string>("deep");
  const [extractionLanguage, setExtractionLanguage] = useState<string>("english");
  const [reportFields, setReportFields] = useState<Record<string, boolean>>(DEFAULT_REPORT_FIELDS);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [showExportHistory, setShowExportHistory] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  // Inline chat for single company
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  // Save state
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [viewJobId, setViewJobId] = useState<number | null>(null);
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);
  const [scanElapsed, setScanElapsed] = useState(0);
  const [scanProgressMsg, setScanProgressMsg] = useState<string | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: allJobs, refetch: refetchJobs } = useQuery<ProspectingJob[]>({
    queryKey: ["prospecting-jobs"],
    queryFn: () => apiRequest<ProspectingJob[]>(API),
    refetchInterval: 15000,
  });

  const { data: viewResults } = useQuery<ProspectingResult[]>({
    queryKey: ["view-results", viewJobId],
    queryFn: () => apiRequest<ProspectingResult[]>(`${API}/${viewJobId}/results`),
    enabled: !!viewJobId,
  });

  const { data: exportHistory, refetch: refetchExportHistory } = useQuery<ExportHistoryItem[]>({
    queryKey: ["export-history"],
    queryFn: () => apiRequest<ExportHistoryItem[]>(`${API}/exports/history`),
    enabled: showExportHistory,
  });

  const researchMutation = useMutation({
    mutationFn: (targetUrl: string) =>
      apiRequest<{ profile: Record<string, unknown>; url: string }>("/api/prosengine/research-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      }),
    onMutate: () => setStep(2),
    onSuccess: (data) => {
      setCompanyProfile(data.profile);
      setChatMessages([]);
      setSaveStatus("idle");
      setStep(3);
      // Propagate to cross-module localStorage context store
      try {
        const p = data.profile as Record<string, unknown>;
        const nameEn = String(p.nameEn || p.name || "");
        const management = Array.isArray(p.management) ? p.management as Array<{ nameEn?: string; title?: string; arabicName?: string }> : [];
        const board = Array.isArray(p.board) ? p.board as Array<{ nameEn?: string; title?: string }> : [];
        const execs = [...management, ...board]
          .filter(e => e.nameEn)
          .map(e => ({ name: e.nameEn || "", title: e.title || "" }));
        localStorage.setItem("websiteIntelContext", JSON.stringify({
          companyName: nameEn,
          websiteUrl: data.url || "",
          executives: execs,
          industry: String(p.industry || ""),
          city: String(p.city || ""),
          generatedAt: new Date().toISOString(),
        }));
      } catch { /* ignore localStorage errors */ }
    },
    onError: () => {
      setScanError("Research failed. Check the URL and try again.");
      setStep(1);
    },
  });

  const scanMutation = useMutation({
    mutationFn: (targetUrl: string) =>
      apiRequest<ProspectingJob>(`${API}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      }),
    onSuccess: (newJob) => {
      setScanError(null);
      setActiveJobId(newJob.id);
      setJob(newJob);
      setStep(2);
      setScanStartTime(Date.now());
      setScanElapsed(0);
      setScanProgressMsg(null);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      elapsedRef.current = setInterval(() => {
        setScanElapsed(prev => prev + 1);
      }, 1000);
      startPolling(newJob.id);
    },
    onError: (err: Error) => setScanError(err.message),
  });

  const extractMutation = useMutation({
    mutationFn: (jobId: number) =>
      apiRequest<ProspectingJob>(`${API}/${jobId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            maxPages,
            enrichmentDepth,
            extractionLanguage,
            extractionFields: Object.entries(reportFields).filter(([, v]) => v).map(([k]) => k),
            userAnswers: answers,
          },
        }),
      }),
    onSuccess: (updated) => {
      setJob(updated);
      setResults([]);
      setStep(4);
      if (activeJobId) startPolling(activeJobId);
    },
    onError: (err: Error) => setScanError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (jobId: number) =>
      apiRequest<{ success: boolean }>(`${API}/${jobId}`, { method: "DELETE" }),
    onSuccess: (_, jobId) => {
      qc.invalidateQueries({ queryKey: ["prospecting-jobs"] });
      if (viewJobId === jobId) setViewJobId(null);
      if (activeJobId === jobId) resetFlow();
    },
  });

  const exportMutation = useMutation({
    mutationFn: async ({ jobId, format }: { jobId: number; format: string }) => {
      const data = await apiRequest<{ content: string; filename: string; mimeType: string }>(
        `${API}/${jobId}/export`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format }) },
      );
      let blob: Blob;
      if (format === "xlsx" || format === "excel" || (format === "pdf" && data.mimeType === "application/pdf")) {
        const binaryStr = atob(data.content);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        blob = new Blob([bytes], { type: data.mimeType });
      } else {
        blob = new Blob([format === "json" ? JSON.stringify(JSON.parse(data.content), null, 2) : data.content], { type: data.mimeType });
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = data.filename;
      link.click();
      URL.revokeObjectURL(link.href);
    },
    onSuccess: () => {
      if (showExportHistory) refetchExportHistory();
    },
    onError: (err: Error) => alert(err.message || "Export failed"),
  });

  // Inline chat mutation for single-company profile
  const chatContextRef = useRef<string>("");
  const chatMutation = useMutation({
    mutationFn: (msg: string) =>
      apiRequest<{ reply: string; profileUpdate?: Record<string, unknown> }>("/api/prosengine/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, context: chatContextRef.current, mode: "website" }),
      }),
    onSuccess: (data) => {
      setChatMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
      if (data.profileUpdate) {
        setCompanyProfile(prev => prev ? { ...prev, ...data.profileUpdate } : data.profileUpdate ?? null);
      }
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: (err: Error) => {
      setChatMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    },
  });

  const sendChat = useCallback(() => {
    const msg = chatInput.trim();
    if (!msg) return;
    setChatMessages(prev => [...prev, { role: "user", content: msg }]);
    setChatInput("");
    chatMutation.mutate(msg);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [chatInput, chatMutation]);

  // Save single-company profile to leads
  const saveToLeadsMutation = useMutation({
    mutationFn: async (profile: Record<string, unknown>) => {
      setSaveStatus("saving");
      const nameEn = String(profile.nameEn || profile.name || "Unknown Company");
      return apiRequest<{ id: number }>("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: nameEn,
          lastName: profile.nameAr ? String(profile.nameAr) : undefined,
          title: profile.industry ? String(profile.industry) : "Company",
          email: profile.email ? String(profile.email) : undefined,
          phone: profile.phone ? String(profile.phone) : undefined,
          notes: `[ProsEngine Intel — ${new Date().toLocaleDateString()}]\nWebsite: ${url}\nCR: ${profile.crNumber || "—"}\nCity: ${profile.city || "—"}\nDescription: ${String(profile.description || "").slice(0, 300)}`,
          status: "research",
        }),
      });
    },
    onSuccess: () => setSaveStatus("saved"),
    onError: () => setSaveStatus("error"),
  });

  // Export single-company profile to HTML / Word / PDF
  const exportProfile = useCallback((format: "html" | "word" | "pdf") => {
    if (!companyProfile) return;
    const p = companyProfile as Record<string, unknown>;
    const str = (v: unknown) => (v == null || v === "" || v === "null" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
    const arr = (v: unknown): Array<Record<string, string>> => (Array.isArray(v) ? v as Array<Record<string, string>> : []);

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>${str(p.nameEn) || "Company Report"} — ProspectSA Intel</title>
<style>
  body{font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:32px;color:#111;background:#fff}
  h1{font-size:24px;margin-bottom:4px} h2{font-size:16px;color:#0891b2;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin-top:28px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 32px;margin:12px 0}
  .field label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px}
  .field p{margin:2px 0;font-size:14px}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
  th{background:#f1f5f9;text-align:left;padding:8px 12px;font-size:12px;color:#475569}
  td{padding:8px 12px;border-bottom:1px solid #f1f5f9}
  .badge{display:inline-block;background:#f0f9ff;color:#0891b2;border:1px solid #bae6fd;border-radius:4px;padding:2px 8px;font-size:11px;margin:2px}
  footer{margin-top:40px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
</style></head><body>
<h1>${str(p.nameEn)}${p.nameAr ? ` / ${str(p.nameAr)}` : ""}</h1>
<p style="color:#64748b;font-size:14px">${str(p.industry)}${p.subIndustry ? ` · ${str(p.subIndustry)}` : ""} · ${str(p.city)}, ${str(p.region)}</p>
<h2>Company Overview</h2>
<div class="grid">
  <div class="field"><label>CR Number</label><p>${str(p.crNumber)}</p></div>
  <div class="field"><label>Legal Form</label><p>${str(p.legalForm)}</p></div>
  <div class="field"><label>Founded</label><p>${str(p.founded)}</p></div>
  <div class="field"><label>Paid-Up Capital</label><p>${str(p.paidUpCapital)}</p></div>
  <div class="field"><label>Employees</label><p>${str(p.employees)}</p></div>
  <div class="field"><label>Revenue</label><p>${str(p.revenue)}</p></div>
  <div class="field"><label>CEO / GM</label><p>${str(p.ceo)}${p.ceoAr ? ` (${str(p.ceoAr)})` : ""}</p></div>
  <div class="field"><label>Regulator</label><p>${str(p.regulator)}</p></div>
</div>
<h2>Contact</h2>
<div class="grid">
  <div class="field"><label>Phone</label><p>${str(p.phone)}</p></div>
  <div class="field"><label>Email</label><p>${str(p.email)}</p></div>
  <div class="field"><label>Website</label><p>${url}</p></div>
  <div class="field"><label>Address</label><p>${str(p.address)}</p></div>
</div>
${p.description ? `<h2>Description</h2><p style="font-size:14px;line-height:1.6">${str(p.description)}</p>` : ""}
${arr(p.shareholders).length > 0 ? `<h2>Shareholders</h2><table><tr><th>Name</th><th>Arabic Name</th><th>Ownership %</th><th>Nationality</th></tr>${arr(p.shareholders).map(s => `<tr><td>${s.nameEn||""}</td><td>${s.nameAr||""}</td><td>${s.ownershipPct||""}</td><td>${s.nationality||""}</td></tr>`).join("")}</table>` : ""}
${arr(p.management).length > 0 ? `<h2>Management</h2><table><tr><th>Name</th><th>Arabic Name</th><th>Title</th></tr>${arr(p.management).map(m => `<tr><td>${m.nameEn||""}</td><td>${m.nameAr||""}</td><td>${m.title||""}</td></tr>`).join("")}</table>` : ""}
${arr(p.board).length > 0 ? `<h2>Board of Directors</h2><table><tr><th>Name</th><th>Role</th></tr>${arr(p.board).map(b => `<tr><td>${b.nameEn||""}</td><td>${b.role||""}</td></tr>`).join("")}</table>` : ""}
${p.aiInsights ? `<h2>AI Intelligence Insights</h2><p style="font-size:14px;line-height:1.6">${str(p.aiInsights)}</p>` : ""}
${chatMessages.filter(m => m.role === "assistant").length > 0 ? `<h2>AI Analysis Notes</h2>${chatMessages.filter(m => m.role === "assistant").map(m => `<p style="font-size:13px;line-height:1.6;border-left:3px solid #0891b2;padding-left:12px;margin:8px 0">${m.content}</p>`).join("")}` : ""}
<footer>Generated by ProspectSA · ${new Date().toLocaleDateString()} · ${url}</footer>
</body></html>`;

    if (format === "pdf") {
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); w.print(); }
      return;
    }
    const mime = format === "word" ? "application/msword" : "text/html";
    const ext = format === "word" ? ".doc" : ".html";
    const filename = `${(str(p.nameEn) || "company").replace(/[^a-z0-9]/gi, "-")}-intel${ext}`;
    const blob = new Blob([html], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [companyProfile, url, chatMessages]);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
  }, []);

  const startPolling = useCallback((jobId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let pollFailCount = 0;

    const poll = async () => {
      try {
        const updated = await apiRequest<ProspectingJob>(`${API}/${jobId}`);
        setJob(updated);
        pollFailCount = 0;

        if (updated.scanResult?.progressMessage) {
          setScanProgressMsg(updated.scanResult.progressMessage);
        }

        if (updated.status === "scanned") {
          if (pollRef.current) clearInterval(pollRef.current);
          stopElapsedTimer();
          setStep(3);
        } else if (updated.status === "extracting" || updated.status === "enriching") {
          stopElapsedTimer();
          const r = await apiRequest<ProspectingResult[]>(`${API}/${jobId}/results`);
          setResults(r);
        } else if (updated.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          stopElapsedTimer();
          const r = await apiRequest<ProspectingResult[]>(`${API}/${jobId}/results`);
          setResults(r);
          setStep(5);
          qc.invalidateQueries({ queryKey: ["prospecting-jobs"] });
          // Propagate directory scan results to cross-module localStorage store
          try {
            const companies = r.slice(0, 50).map(c => {
              const cd = c.companyData as (CompanyData & { nameEn?: string; executives?: Array<{ name: string; title?: string }> }) | null;
              return {
                name: cd?.nameEn || cd?.name || "",
                industry: cd?.industry || "",
                city: cd?.city || "",
                executives: (cd?.executives || []).map((e: { name: string; title?: string }) => ({ name: e.name, title: e.title || "" })),
              };
            }).filter(c => c.name);
            const allExecs = companies.flatMap(c => c.executives.map(e => ({ ...e, company: c.name })));
            const firstCompany = companies[0]?.name || "";
            if (firstCompany || allExecs.length > 0) {
              localStorage.setItem("websiteIntelContext", JSON.stringify({
                companyName: firstCompany,
                websiteUrl: url,
                executives: allExecs.slice(0, 30),
                companies: companies.slice(0, 20),
                generatedAt: new Date().toISOString(),
              }));
            }
          } catch { /* ignore localStorage errors */ }
        } else if (updated.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          stopElapsedTimer();
          setScanError(updated.error || updated.errorMessage || "Job failed");
          setStep(1);
        }
      } catch (err) {
        pollFailCount++;
        console.warn(`[Prospecting] Poll error (${pollFailCount}):`, err);
        if (pollFailCount >= 10) {
          if (pollRef.current) clearInterval(pollRef.current);
          stopElapsedTimer();
          setScanError("Lost connection to server. Please try again.");
        }
      }
    };

    poll();
    pollRef.current = setInterval(poll, 3000);
  }, [qc, stopElapsedTimer]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, []);


  const resetFlow = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    setStep(1);
    setUrl("");
    setActiveJobId(null);
    setJob(null);
    setResults([]);
    setScanError(null);
    setAnswers({});
    setViewJobId(null);
    setReportFields({ ...DEFAULT_REPORT_FIELDS });
    setScanStartTime(null);
    setScanElapsed(0);
    setScanProgressMsg(null);
    setCompanyProfile(null);
    setChatMessages([]);
    setChatInput("");
    setChatOpen(false);
    setSaveStatus("idle");
  };

  const displayResults = viewJobId ? (viewResults || []) : results;
  const displayJob = viewJobId
    ? allJobs?.find(j => j.id === viewJobId) || null
    : job;

  const scanSummary = job?.scanSummary;

  const chatContext = useMemo(() => {
    const str = (v: unknown): string => {
      if (v == null || v === "" || v === "null") return "";
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.map(x => typeof x === "object" ? JSON.stringify(x) : String(x)).join(", ");
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    };
    // Single company mode: send full profile as structured intelligence
    if (urlMode === "single" && companyProfile) {
      const p = companyProfile as Record<string, unknown>;
      const shareholders = Array.isArray(p.shareholders) ? (p.shareholders as Record<string,string>[]) : [];
      const management = Array.isArray(p.management) ? (p.management as Record<string,string>[]) : [];
      const board = Array.isArray(p.board) ? (p.board as Record<string,string>[]) : [];
      const products = Array.isArray(p.products) ? (p.products as string[]) : [];
      const clients = Array.isArray(p.clients) ? (p.clients as string[]) : [];
      const strengths = Array.isArray(p.strengths) ? (p.strengths as string[]) : [];
      return [
        `=== COMPANY INTELLIGENCE REPORT ===`,
        `Website: ${url}`,
        `Name (EN): ${str(p.nameEn)}`,
        `Name (AR): ${str(p.nameAr)}`,
        `Industry: ${str(p.industry)} ${p.subIndustry ? `/ ${str(p.subIndustry)}` : ""}`,
        `City: ${str(p.city)} | Region: ${str(p.region)}`,
        `Legal Form: ${str(p.legalForm)} | CR Number: ${str(p.crNumber)}`,
        `Paid-Up Capital: ${str(p.paidUpCapital)} | Founded: ${str(p.founded)}`,
        `CEO / GM: ${str(p.ceo)} ${p.ceoAr ? `(${str(p.ceoAr)})` : ""}`,
        `Phone: ${str(p.phone)} | Email: ${str(p.email)}`,
        `Address: ${str(p.address)}`,
        `Employees: ${str(p.employees)} | Revenue: ${str(p.revenue)}`,
        `Description: ${str(p.description)}`,
        shareholders.length > 0 ? `\nSHAREHOLDERS:\n${shareholders.map(s => `  - ${s.nameEn || ""} ${s.nameAr ? `(${s.nameAr})` : ""} — ${s.ownershipPct || "?"}% — ${s.nationality || ""}`).join("\n")}` : "",
        management.length > 0 ? `\nMANAGEMENT:\n${management.map(m => `  - ${m.nameEn || ""} ${m.nameAr ? `(${m.nameAr})` : ""} — ${m.title || ""}`).join("\n")}` : "",
        board.length > 0 ? `\nBOARD OF DIRECTORS:\n${board.map(b => `  - ${b.nameEn || ""} — ${b.role || ""}`).join("\n")}` : "",
        products.length > 0 ? `\nPRODUCTS / SERVICES: ${products.join(", ")}` : "",
        clients.length > 0 ? `\nKEY CLIENTS: ${clients.join(", ")}` : "",
        strengths.length > 0 ? `\nSTRENGTHS: ${strengths.join(" | ")}` : "",
        p.marketPosition ? `\nMARKET POSITION: ${str(p.marketPosition)}` : "",
        p.recentNews ? `\nRECENT NEWS: ${str(p.recentNews)}` : "",
        p.aiInsights ? `\nAI INTELLIGENCE INSIGHTS: ${str(p.aiInsights)}` : "",
      ].filter(Boolean).join("\n");
    }
    if (!displayJob) return "";
    const topRecords = (displayResults || []).slice(0, 10).map((r, i) => {
      const cd = r.companyData as Record<string,string> | undefined;
      if (!cd) return "";
      return [
        `${i + 1}. ${cd.name || cd.nameEn || "Unknown"} ${cd.nameAr ? `(${cd.nameAr})` : ""}`,
        `   Industry: ${cd.industry || "—"} | City: ${cd.city || "—"}`,
        cd.email ? `   Email: ${cd.email}` : "",
        cd.phone ? `   Phone: ${cd.phone}` : "",
        cd.description ? `   Desc: ${cd.description.slice(0, 120)}` : "",
      ].filter(Boolean).join("\n");
    }).filter(Boolean).join("\n\n");
    return `=== WEBSITE INTELLIGENCE EXTRACTION ===\nTarget URL: ${displayJob.targetUrl || "unknown"}\nStatus: ${displayJob.status}\nRecords extracted: ${displayJob.totalCompaniesFound || 0}\nRecords enriched: ${displayJob.totalEnriched || 0}\nPages scanned: ${displayJob.pagesScanned || 0}\n\nCOMPANIES FOUND:\n${topRecords || "None yet"}`;
  }, [displayJob, displayResults, urlMode, companyProfile, url]);

  // Keep chatContextRef in sync so chatMutation always has latest context
  useEffect(() => { chatContextRef.current = chatContext; }, [chatContext]);

  return (
    <div className="flex gap-6 h-full animate-in fade-in duration-400">
      <div className="flex-1 min-w-0 space-y-6 overflow-y-auto pr-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/prospecting")} className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-display font-bold text-white">Website Intelligence</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                3-phase automated pipeline: Scan · Extract · Enrich
              </p>
            </div>
          </div>
          {step > 1 && (
            <Button variant="ghost" size="sm" onClick={resetFlow} className="text-muted-foreground hover:text-white gap-2">
              <X className="w-4 h-4" /> New Job
            </Button>
          )}
        </div>

        <StepBar current={step} mode={urlMode} />

        {/* Step 1: URL Input */}
        {step === 1 && !viewJobId && (
          <Card className="bg-card/60 border-white/8 backdrop-blur-md">
            <CardContent className="pt-8 pb-10 px-8">
              <div className="max-w-2xl mx-auto space-y-6">
                <div className="text-center space-y-2">
                  <div className="w-14 h-14 bg-primary/15 rounded-2xl flex items-center justify-center mx-auto border border-primary/20">
                    <Globe className="w-7 h-7 text-primary" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">Enter Target</h2>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Provide a website URL to scan, or describe what you want in plain text.
                    The engine scans, detects the data type, asks tailored questions, then extracts and enriches.
                  </p>
                </div>

                {/* Mode toggle */}
                <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/8 w-fit mx-auto">
                  <button onClick={() => setInputMode("url")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${inputMode === "url" ? "bg-primary/20 text-white border border-primary/30" : "text-muted-foreground hover:text-white"}`}>
                    <Globe className="w-3.5 h-3.5" />Website URL
                  </button>
                  <button onClick={() => setInputMode("text")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${inputMode === "text" ? "bg-primary/20 text-white border border-primary/30" : "text-muted-foreground hover:text-white"}`}>
                    <ClipboardList className="w-3.5 h-3.5" />Describe in text
                  </button>
                </div>

                {inputMode === "url" && (
                  <div className="space-y-4">
                    {/* Sub-mode toggle: Directory vs Single Company */}
                    <div className="flex gap-1 p-1 bg-white/5 rounded-lg border border-white/8 w-fit mx-auto">
                      <button onClick={() => { setUrlMode("directory"); setCompanyProfile(null); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${urlMode === "directory" ? "bg-primary/20 text-white border border-primary/30" : "text-muted-foreground hover:text-white"}`}>
                        <Layers className="w-3 h-3" />Directory Scan
                      </button>
                      <button onClick={() => { setUrlMode("single"); setCompanyProfile(null); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${urlMode === "single" ? "bg-primary/20 text-white border border-primary/30" : "text-muted-foreground hover:text-white"}`}>
                        <Search className="w-3 h-3" />Single Company
                      </button>
                    </div>

                    {urlMode === "directory" ? (
                      <div className="space-y-3">
                        <div className="flex gap-3">
                          <Input
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && url) scanMutation.mutate(url); }}
                            placeholder="https://chamber.org.sa/directory or https://exhibitor-list.com/companies"
                            className="h-12 bg-black/30 border-white/15 focus-visible:ring-primary/40 text-white placeholder:text-white/30"
                          />
                          <Button
                            onClick={() => scanMutation.mutate(url)}
                            disabled={!url || scanMutation.isPending}
                            className="h-12 px-6 bg-primary hover:bg-primary/90 font-semibold gap-2 shadow-lg shadow-primary/20"
                          >
                            {scanMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                            Deep Scan
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <span className="text-xs text-muted-foreground">Try:</span>
                          {[
                            "https://riyadhchamber.com/en/members",
                            "https://saudiarabia.yellowpages.com.sa",
                            "https://www.kompass.com/a/saudi-arabia",
                          ].map((ex) => (
                            <button key={ex} onClick={() => setUrl(ex)}
                              className="text-xs text-primary/70 hover:text-primary underline underline-offset-2 transition-colors">
                              {new URL(ex).hostname}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs text-center text-muted-foreground">Enter a company{"'"}s own website — the AI will extract full intelligence on that single company.</p>
                        <div className="flex gap-3">
                          <Input
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && url) researchMutation.mutate(url); }}
                            placeholder="https://company.com.sa — the company's own website"
                            className="h-12 bg-black/30 border-white/15 focus-visible:ring-primary/40 text-white placeholder:text-white/30"
                          />
                          <Button
                            onClick={() => { setCompanyProfile(null); setChatMessages([]); setSaveStatus("idle"); setStep(2); researchMutation.mutate(url); }}
                            disabled={!url || researchMutation.isPending}
                            className="h-12 px-6 bg-primary hover:bg-primary/90 font-semibold gap-2 shadow-lg shadow-primary/20 whitespace-nowrap"
                          >
                            <Search className="w-4 h-4" />
                            Research Company
                          </Button>
                        </div>
                        {researchMutation.isError && step === 1 && (
                          <p className="text-xs text-red-400 text-center">Research failed — check the URL and try again.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {inputMode === "text" && (
                  <div className="space-y-3">
                    <Textarea
                      value={textPrompt}
                      onChange={(e) => setTextPrompt(e.target.value)}
                      placeholder={"Examples:\n• 30 construction companies in Jeddah with CEO contacts\n• Saudi healthcare companies with 100+ employees\n• Tech startups in Riyadh founded after 2020"}
                      className="min-h-[130px] bg-black/30 border-white/15 text-white placeholder:text-white/30 resize-none"
                    />
                    <Button
                      onClick={() => navigate(`/prospecting/seeder?prompt=${encodeURIComponent(textPrompt)}`)}
                      disabled={!textPrompt.trim()}
                      className="w-full h-12 bg-primary hover:bg-primary/90 font-semibold gap-2 shadow-lg shadow-primary/20"
                    >
                      <Cpu className="w-4 h-4" />Generate with AI Data Seeder
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">AI will generate structured Saudi company/executive records based on your description</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Single Company Researching */}
        {step === 2 && urlMode === "single" && (
          <Card className="bg-card/60 border-white/8 backdrop-blur-md">
            <CardContent className="py-20 px-8 text-center">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-primary/20">
                <Loader2 className="w-9 h-9 text-primary animate-spin" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Researching Company Intelligence</h2>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Crawling the website, extracting company data, cross-referencing with market intelligence, and synthesizing a comprehensive profile...
              </p>
              <div className="mt-8 flex flex-col gap-2 max-w-xs mx-auto text-xs text-muted-foreground/60">
                {["Crawling website pages", "Extracting company data", "AI enrichment & synthesis", "Building intelligence report"].map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-pulse" style={{ animationDelay: `${i * 0.4}s` }} />
                    {s}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Single Company Full Intel Report */}
        {step === 3 && urlMode === "single" && companyProfile && (() => {
          const p = companyProfile as Record<string, unknown>;
          const str = (v: unknown) => (v == null || v === "" || v === "null" ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
          const management = Array.isArray(p.management) ? (p.management as Record<string, string>[]).filter(m => m.nameEn) : [];
          const shareholders = Array.isArray(p.shareholders) ? (p.shareholders as Record<string, string>[]).filter(s => s.nameEn) : [];
          const board = Array.isArray(p.board) ? (p.board as Record<string, string>[]).filter(b => b.nameEn) : [];
          const offices = Array.isArray(p.offices) ? (p.offices as Record<string, string>[]).filter(o => o.city) : [];
          const products = Array.isArray(p.products) ? (p.products as string[]) : [];
          const sm = typeof p.socialMedia === "object" && p.socialMedia ? Object.entries(p.socialMedia as Record<string, string>).filter(([, v]) => v && v !== "null") : [];
          const companyName = str(p.nameEn) || str(p.name) || "Company";

          return (
            <div className="space-y-4">
              {/* Header Card */}
              <Card className="bg-card/60 border-white/8 backdrop-blur-md overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-primary via-cyan-400 to-emerald-400" />
                <CardContent className="pt-6 pb-4 px-6">
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                      <Building2 className="w-7 h-7 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-2xl font-bold text-white leading-tight">{companyName}</h2>
                      {str(p.nameAr) && <p className="text-emerald-300/80 text-base mt-0.5">{str(p.nameAr)}</p>}
                      <div className="flex flex-wrap gap-2 mt-2">
                        {str(p.legalForm) && <span className="text-xs px-2.5 py-1 rounded-full bg-white/8 border border-white/12 text-white/60">{str(p.legalForm)}</span>}
                        {str(p.industry) && <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary/80">{str(p.industry)}</span>}
                        {str(p.city) && <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400/80">{str(p.city)}</span>}
                      </div>
                    </div>
                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center gap-2 ml-auto">
                      {/* Export dropdown */}
                      <div className="relative group">
                        <Button size="sm" variant="outline" className="border-white/15 text-white/70 hover:text-white gap-1.5 h-8 pr-2">
                          <FileDown className="w-3.5 h-3.5" />Export<ChevronDown className="w-3 h-3 ml-0.5" />
                        </Button>
                        <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-white/15 rounded-xl shadow-xl shadow-black/30 overflow-hidden z-50 hidden group-hover:block">
                          {[
                            { label: "Download HTML", icon: FileText, fmt: "html" as const },
                            { label: "Open as PDF", icon: Printer, fmt: "pdf" as const },
                            { label: "Download Word", icon: BookUser, fmt: "word" as const },
                          ].map(({ label, icon: Icon, fmt }) => (
                            <button key={fmt} onClick={() => exportProfile(fmt)}
                              className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors text-left">
                              <Icon className="w-4 h-4 text-primary/70" />{label}
                            </button>
                          ))}
                          <button onClick={async () => {
                            if (!companyProfile) return;
                            try {
                              const r = await fetch("/api/prosengine/export-ppt", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ profile: companyProfile, sourceUrl: url }),
                              });
                              if (!r.ok) throw new Error("PPT generation failed");
                              const blob = await r.blob();
                              const name = String(companyProfile.nameEn || "company").replace(/[^a-z0-9]/gi, "-").toLowerCase();
                              const a = document.createElement("a");
                              a.href = URL.createObjectURL(blob);
                              a.download = `${name}-intel.pptx`;
                              a.click();
                              URL.revokeObjectURL(a.href);
                            } catch { alert("PPT export failed"); }
                          }} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors text-left">
                            <FileDown className="w-4 h-4 text-violet-400/70" />Download PPT
                          </button>
                        </div>
                      </div>
                      {/* Save to leads */}
                      <Button
                        size="sm"
                        onClick={() => saveToLeadsMutation.mutate(companyProfile!)}
                        disabled={saveStatus === "saving" || saveStatus === "saved"}
                        className={cn("h-8 gap-1.5", saveStatus === "saved" ? "bg-emerald-600 hover:bg-emerald-600" : "bg-primary/20 border border-primary/30 hover:bg-primary/30 text-primary")}
                        variant="ghost"
                      >
                        {saveStatus === "saving" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                         saveStatus === "saved" ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                         <Save className="w-3.5 h-3.5" />}
                        {saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving…" : "Save to Leads"}
                      </Button>
                      {/* Seed to Data Seeder */}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const seedPrompt = `${companyName} Saudi Arabia — executives and key contacts from the company profile`;
                          navigate(`/prospecting/seeder?prompt=${encodeURIComponent(seedPrompt)}&company=${encodeURIComponent(companyName)}&source=website-intel`);
                        }}
                        className="h-8 gap-1.5 text-amber-400/80 hover:text-amber-300 border border-amber-500/20 hover:border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
                        title="Send to Data Seeder to generate more similar records"
                      >
                        <Database className="w-3.5 h-3.5" />Seed More
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setChatOpen(v => !v)}
                        className="h-8 gap-1.5 text-white/60 hover:text-white border border-white/10 hover:border-white/20">
                        <MessageCircle className="w-3.5 h-3.5" />AI Chat
                      </Button>
                    </div>
                  </div>
                  {str(p.description) && (
                    <p className="text-sm text-muted-foreground leading-relaxed mt-4">{str(p.description)}</p>
                  )}
                </CardContent>
              </Card>

              {/* Core Fields Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { icon: Hash, label: "CR Number", val: str(p.crNumber), color: "text-indigo-400" },
                  { icon: User, label: "CEO / GM", val: str(p.ceo) + (str(p.ceoAr) ? ` (${str(p.ceoAr)})` : ""), color: "text-violet-400" },
                  { icon: Calendar, label: "Founded", val: str(p.founded), color: "text-pink-400" },
                  { icon: DollarSign, label: "Paid-Up Capital", val: str(p.paidUpCapital), color: "text-yellow-400" },
                  { icon: Users, label: "Employees", val: str(p.employees), color: "text-teal-400" },
                  { icon: DollarSign, label: "Revenue", val: str(p.revenue), color: "text-emerald-400" },
                  { icon: Phone, label: "Phone", val: str(p.phone), color: "text-emerald-400", href: str(p.phone) ? `tel:${str(p.phone)}` : undefined },
                  { icon: Mail, label: "Email", val: str(p.email), color: "text-blue-400", href: str(p.email) ? `mailto:${str(p.email)}` : undefined },
                  { icon: MapPin, label: "Address", val: str(p.address), color: "text-orange-400" },
                  { icon: Shield, label: "Regulator", val: str(p.regulator), color: "text-cyan-400" },
                  { icon: Globe, label: "Region", val: str(p.region), color: "text-emerald-400" },
                  { icon: Briefcase, label: "Sub-Industry", val: str(p.subIndustry), color: "text-violet-400" },
                ].filter(f => f.val && f.val !== "—" && !f.val.includes("null")).map(({ icon: Icon, label, val, color, href }) => (
                  <Card key={label} className="bg-white/3 border-white/6">
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
                        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{label}</span>
                      </div>
                      {href ? (
                        <a href={href} className={cn("text-sm font-medium break-all hover:underline", color)}>{val}</a>
                      ) : (
                        <p className="text-sm font-medium text-white/90 break-words">{val}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Social Media */}
              {sm.length > 0 && (
                <Card className="bg-white/3 border-white/6">
                  <CardContent className="py-4 px-5">
                    <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-3">Social Media</p>
                    <div className="flex flex-wrap gap-2">
                      {sm.map(([platform, link]) => (
                        <a key={platform} href={link} target="_blank" rel="noopener"
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary/80 hover:text-primary hover:border-primary/40 capitalize transition-colors">
                          <ExternalLink className="w-3 h-3" />{platform}
                        </a>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* People Sections */}
              {[
                { label: "Management", items: management, icon: Users, color: "text-violet-400", bgColor: "bg-violet-500/10", borderColor: "border-violet-500/20" },
                { label: "Shareholders", items: shareholders, icon: Building2, color: "text-amber-400", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/20" },
                { label: "Board of Directors", items: board, icon: Shield, color: "text-blue-400", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/20" },
              ].filter(section => section.items.length > 0).map(({ label, items, icon: Icon, color, bgColor, borderColor }) => (
                <Card key={label} className="bg-white/3 border-white/6">
                  <CardContent className="py-4 px-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className={cn("w-4 h-4", color)} />
                      <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">{label}</p>
                    </div>
                    <div className="space-y-2">
                      {items.map((person, i) => (
                        <div key={i} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 border", bgColor, borderColor)}>
                          <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0", bgColor, "border", borderColor)}>
                            <User className={cn("w-3.5 h-3.5", color)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white/90 leading-tight">{person.nameEn}</p>
                            {person.nameAr && <p className="text-xs text-muted-foreground/60">{person.nameAr}</p>}
                            <p className={cn("text-xs mt-0.5", color, "opacity-80")}>{person.title || person.role || person.ownershipPct}</p>
                          </div>
                          {person.nationality && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 border border-white/10 text-white/50 shrink-0">{person.nationality}</span>
                          )}
                          {/* Generate Person Intel button */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const params = new URLSearchParams({
                                name: person.nameEn || "",
                                company: companyName,
                                source: "website-intel",
                              });
                              if (person.title || person.role) params.set("title", person.title || person.role || "");
                              if (person.nationality) params.set("nationality", person.nationality);
                              navigate(`/prospecting/person?${params.toString()}`);
                            }}
                            className="h-7 px-2 text-[10px] gap-1 text-muted-foreground hover:text-white hover:bg-white/8 shrink-0"
                            title="Generate full person intelligence report"
                          >
                            <BookUser className="w-3 h-3" />Intel
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* Offices & Branches */}
              {offices.length > 0 && (
                <Card className="bg-white/3 border-white/6">
                  <CardContent className="py-4 px-5">
                    <div className="flex items-center gap-2 mb-3">
                      <MapPin className="w-4 h-4 text-emerald-400" />
                      <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Offices & Branches</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {offices.map((o, i) => (
                        <div key={i} className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2 text-xs">
                          <div className="flex items-center gap-1.5 mb-1">
                            <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span className="text-white/80 font-medium">{o.city}</span>
                            {o.label && <span className="text-emerald-400/60 ml-auto">{o.label}</span>}
                          </div>
                          {o.address && <p className="text-muted-foreground/50 pl-4">{o.address}</p>}
                          {(o.phone || o.email) && (
                            <p className="text-muted-foreground/40 pl-4 mt-0.5">
                              {o.phone}{o.phone && o.email ? " · " : ""}{o.email}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Products & Services */}
              {products.length > 0 && (
                <Card className="bg-white/3 border-white/6">
                  <CardContent className="py-4 px-5">
                    <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-3">Products & Services</p>
                    <div className="flex flex-wrap gap-2">
                      {products.map((prod, i) => (
                        <span key={i} className="text-xs px-3 py-1 rounded-full bg-white/8 border border-white/10 text-white/70">{prod}</span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Recent News */}
              {str(p.recentNews) && (
                <Card className="bg-blue-500/5 border-blue-500/15">
                  <CardContent className="py-4 px-5">
                    <p className="text-xs font-semibold text-blue-400/80 uppercase tracking-wider mb-2">Recent News</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{str(p.recentNews)}</p>
                  </CardContent>
                </Card>
              )}

              {/* AI Insights */}
              {str(p.aiInsights) && (
                <Card className="bg-primary/5 border-primary/15">
                  <CardContent className="py-4 px-5">
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="w-4 h-4 text-primary" />
                      <p className="text-xs font-semibold text-primary/80 uppercase tracking-wider">AI Intelligence Insights</p>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{str(p.aiInsights)}</p>
                  </CardContent>
                </Card>
              )}

              {/* Inline AI Chat */}
              <Card className="bg-card/60 border-white/8 backdrop-blur-md">
                <CardContent className="p-0">
                  <button
                    onClick={() => setChatOpen(v => !v)}
                    className="flex items-center justify-between w-full px-5 py-4 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">AI Research Assistant</p>
                        <p className="text-xs text-muted-foreground">Ask questions, request edits, or dig deeper into this company</p>
                      </div>
                    </div>
                    {chatOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  {chatOpen && (
                    <div className="border-t border-white/8">
                      {/* Messages */}
                      <div className="px-4 py-3 space-y-3 max-h-80 overflow-y-auto">
                        {chatMessages.length === 0 && (
                          <div className="py-6 text-center">
                            <Bot className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                            <p className="text-xs text-muted-foreground/60">Ask me anything about {companyName}</p>
                            <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                              {[
                                `Who are the key decision makers?`,
                                `What are the growth opportunities?`,
                                `Identify competitors`,
                                `Suggest a sales approach`,
                              ].map(q => (
                                <button key={q} onClick={() => { setChatInput(q); }}
                                  className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-muted-foreground hover:text-white hover:border-white/20 transition-colors">
                                  {q}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {chatMessages.map((msg, i) => (
                          <div key={i} className={cn("flex gap-2.5", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
                            <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                              msg.role === "user" ? "bg-primary/20 border border-primary/30" : "bg-white/8 border border-white/12"
                            )}>
                              {msg.role === "user" ? <User className="w-3.5 h-3.5 text-primary" /> : <Bot className="w-3.5 h-3.5 text-white/70" />}
                            </div>
                            <div className={cn("max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                              msg.role === "user"
                                ? "bg-primary/15 border border-primary/20 text-white/90 rounded-tr-sm"
                                : "bg-white/5 border border-white/8 text-white/85 rounded-tl-sm"
                            )}>
                              {msg.content}
                            </div>
                          </div>
                        ))}
                        {chatMutation.isPending && (
                          <div className="flex gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-white/8 border border-white/12 flex items-center justify-center shrink-0">
                              <Bot className="w-3.5 h-3.5 text-white/70" />
                            </div>
                            <div className="bg-white/5 border border-white/8 rounded-2xl rounded-tl-sm px-4 py-3">
                              <div className="flex gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" />
                                <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0.15s" }} />
                                <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0.3s" }} />
                              </div>
                            </div>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>
                      {/* Input */}
                      <div className="px-4 pb-4 border-t border-white/5 pt-3 flex gap-2">
                        <input
                          value={chatInput}
                          onChange={e => setChatInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                          placeholder="Ask about this company…"
                          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/40 focus:bg-white/8 transition-colors"
                        />
                        <Button size="sm" onClick={sendChat} disabled={!chatInput.trim() || chatMutation.isPending}
                          className="h-10 w-10 p-0 bg-primary hover:bg-primary/90 shrink-0 rounded-xl">
                          <Send className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })()}

        {scanError && (
          <Card className="bg-rose-500/10 border-rose-500/20">
            <CardContent className="py-6 px-6 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-400">Error</p>
                <p className="text-sm text-rose-400/70 mt-1">{scanError}</p>
                <Button size="sm" variant="outline" onClick={() => { setScanError(null); if (step > 1) resetFlow(); }} className="mt-3 border-rose-500/30 text-rose-400">
                  <RefreshCw className="w-3 h-3 mr-1" /> Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Scanning (Directory mode only) */}
        {step === 2 && urlMode === "directory" && (
          <Card className="bg-card/60 border-white/8 backdrop-blur-md">
            <CardContent className="py-16 px-8">
              <div className="max-w-md mx-auto text-center space-y-6">
                <div className="relative">
                  <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto border border-primary/20">
                    <ScanLine className="w-10 h-10 text-primary animate-pulse" />
                  </div>
                  <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Phase 1: Scanning</h3>
                  <p className="text-muted-foreground text-sm mt-2">
                    {scanProgressMsg || "Detecting pagination, sampling records, analyzing structure..."}
                  </p>
                </div>
                <div className="w-full bg-white/5 rounded-full h-1.5 mt-2">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all duration-700"
                    style={{ width: `${Math.min((job?.progress || 0), 95)}%` }}
                  />
                </div>
                <div className="space-y-2 text-left">
                  {[
                    { msg: "Fetching target URL...", threshold: 10 },
                    { msg: "Detecting data type and structure...", threshold: 30 },
                    { msg: "Sampling listed records...", threshold: 40 },
                    { msg: "GPT-4o generating tailored questions...", threshold: 70 },
                  ].map(({ msg, threshold }, i) => {
                    const progress = job?.progress || 0;
                    const isDone = progress > threshold;
                    const isActive = progress >= threshold - 20 && progress <= threshold;
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <div className={`w-1.5 h-1.5 rounded-full ${isDone ? 'bg-emerald-400' : isActive ? 'bg-primary animate-pulse' : 'bg-white/20'}`} />
                        <span className={isDone ? 'text-emerald-400/80' : isActive ? 'text-white/80' : ''}>{msg}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground/60 mt-3">
                  Elapsed: {Math.floor(scanElapsed / 60)}:{String(scanElapsed % 60).padStart(2, '0')}
                  {scanElapsed > 60 && <span className="ml-2 text-yellow-400/60">— scanning may take up to 2 minutes for complex sites</span>}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Configure extraction (Directory mode only) */}
        {step === 3 && urlMode === "directory" && scanSummary && (
          <div className="space-y-5">
            <Card className="bg-emerald-500/8 border-emerald-500/20">
              <CardContent className="py-4 px-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-emerald-300 text-sm">Scan Complete</p>
                    {scanSummary.siteDescription ? (
                      <p className="text-xs text-emerald-300/80 mt-0.5">{scanSummary.siteDescription}</p>
                    ) : (
                      <p className="text-xs text-emerald-400/70 mt-0.5">
                        {scanSummary.websiteType && <><strong>{scanSummary.websiteType}</strong> · </>}
                        ~{scanSummary.totalPages || "?"} pages · Pagination: {scanSummary.paginationType || "unknown"} · Language: {scanSummary.contentLanguage || "auto"}
                      </p>
                    )}
                    {scanSummary.note && (
                      <p className="text-xs text-emerald-300/80 mt-1 italic">{scanSummary.note}</p>
                    )}
                  </div>
                  <div className="flex gap-4 text-center shrink-0">
                    <div>
                      <p className="text-lg font-bold text-emerald-300">{scanSummary.totalPages || "?"}</p>
                      <p className="text-[10px] text-emerald-400/60">Pages</p>
                    </div>
                    {(scanSummary.sampleItems || scanSummary.sampleCompanies) && (
                      <div>
                        <p className="text-lg font-bold text-emerald-300">
                          {(scanSummary.sampleItems || scanSummary.sampleCompanies || []).length}
                        </p>
                        <p className="text-[10px] text-emerald-400/60">Samples</p>
                      </div>
                    )}
                    {scanSummary.dataType && (
                      <div>
                        <p className="text-sm font-bold text-primary capitalize">{scanSummary.dataType}</p>
                        <p className="text-[10px] text-emerald-400/60">Data Type</p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Detected Records Sample */}
            {((scanSummary.sampleItems || scanSummary.sampleCompanies) || []).length > 0 && (
              <Card className="bg-card/50 border-white/8">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold text-white/70 uppercase tracking-wider">
                    Detected Records Sample
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="flex flex-wrap gap-2">
                    {(scanSummary.sampleItems || scanSummary.sampleCompanies || []).slice(0, 15).map((name, i) => (
                      <Badge key={i} variant="outline" className="bg-white/5 border-white/10 text-white/70 text-xs">
                        <Layers className="w-3 h-3 mr-1 text-primary" />
                        {name}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Suggested questions */}
            {scanSummary.suggestedQuestions && scanSummary.suggestedQuestions.length > 0 && (
              <Card className="bg-card/50 border-white/8">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold text-white/70 uppercase tracking-wider">
                    Filter Questions
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4 space-y-4">
                  {scanSummary.suggestedQuestions.map((q, i) => (
                    <div key={i} className="space-y-2">
                      <p className="text-sm text-white/80">{q.question}</p>
                      {q.options && q.options.length > 0 ? (
                        <>
                          <p className="text-[10px] text-white/40">Select one or more options</p>
                          <div className="flex flex-wrap gap-2">
                            {q.options.map((opt, j) => {
                              const selected = (answers[q.question] || []).includes(opt);
                              return (
                                <button
                                  key={j}
                                  onClick={() => setAnswers(prev => {
                                    const current = prev[q.question] || [];
                                    const updated = selected
                                      ? current.filter(v => v !== opt)
                                      : [...current, opt];
                                    return { ...prev, [q.question]: updated };
                                  })}
                                  className={cn(
                                    "text-xs px-3 py-1.5 rounded-lg border transition-all",
                                    selected
                                      ? "border-primary bg-primary/20 text-primary"
                                      : "border-white/10 bg-white/5 text-white/60 hover:border-white/20",
                                  )}
                                >
                                  {opt}
                                  {selected && <CheckCircle2 className="w-3 h-3 ml-1.5 inline-block" />}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <Input
                          value={(answers[q.question] || [])[0] || ""}
                          onChange={(e) => setAnswers(prev => ({ ...prev, [q.question]: e.target.value ? [e.target.value] : [] }))}
                          placeholder="Type your answer..."
                          className="h-9 bg-black/20 border-white/10 text-white text-sm"
                        />
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Focus Fields — fixed enrichment fields that map to backend search terms */}
            <Card className="bg-card/50 border-white/8">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold text-white/70 uppercase tracking-wider">
                  Report Focus Fields
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Select which data points to enrich via Perplexity + GPT-4o</p>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {FOCUS_FIELDS.map(({ key, label }) => {
                    const isSelected = !!reportFields[key];
                    return (
                      <button
                        key={key}
                        onClick={() => setReportFields(prev => ({ ...prev, [key]: !prev[key] }))}
                        className={cn(
                          "text-[10px] px-2 py-2 rounded-lg border transition-all text-center leading-tight",
                          isSelected
                            ? "border-primary bg-primary/20 text-primary"
                            : "border-white/10 bg-white/5 text-white/50 hover:border-white/20",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    onClick={() => setReportFields(Object.fromEntries(FOCUS_FIELDS.map(f => [f.key, true])))}
                    className="text-[10px] text-primary/70 hover:text-primary underline"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setReportFields({})}
                    className="text-[10px] text-white/40 hover:text-white/60 underline"
                  >
                    Clear All
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Extraction settings */}
            <Card className="bg-card/50 border-white/8">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold text-white/70 uppercase tracking-wider">
                  Extraction Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Max Pages</label>
                    <Input
                      type="number"
                      value={maxPages}
                      onChange={(e) => setMaxPages(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="h-9 bg-black/20 border-white/10 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Enrichment Depth</label>
                    <div className="flex gap-2">
                      {["basic", "standard", "deep"].map((d) => (
                        <button
                          key={d}
                          onClick={() => setEnrichmentDepth(d)}
                          className={cn(
                            "text-xs px-3 py-2 rounded-lg border capitalize transition-all flex-1",
                            enrichmentDepth === d
                              ? "border-primary bg-primary/20 text-primary"
                              : "border-white/10 bg-white/5 text-white/60 hover:border-white/20",
                          )}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Language</label>
                    <div className="flex gap-2">
                      {["english", "arabic", "auto"].map((lang) => (
                        <button
                          key={lang}
                          onClick={() => setExtractionLanguage(lang)}
                          className={cn(
                            "text-xs px-3 py-2 rounded-lg border capitalize transition-all flex-1",
                            extractionLanguage === lang
                              ? "border-primary bg-primary/20 text-primary"
                              : "border-white/10 bg-white/5 text-white/60 hover:border-white/20",
                          )}
                        >
                          {lang}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <Button
                  onClick={() => activeJobId && extractMutation.mutate(activeJobId)}
                  disabled={extractMutation.isPending || !activeJobId || Object.values(reportFields).filter(Boolean).length === 0}
                  className="w-full h-11 bg-primary hover:bg-primary/90 font-semibold gap-2 shadow-lg shadow-primary/20"
                >
                  {extractMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                  Start Extraction & Enrichment
                </Button>
                {Object.values(reportFields).filter(Boolean).length === 0 && (
                  <p className="text-[10px] text-amber-400 text-center mt-1">Select at least one focus field above</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 4: Extraction in progress (Directory mode only) */}
        {step === 4 && urlMode === "directory" && job && (
          <div className="space-y-5">
            <Card className="bg-card/60 border-white/8 backdrop-blur-md">
              <CardContent className="py-6 px-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {job.status === "extracting" ? "Phase 2: Extracting Records" :
                       job.status === "enriching" ? "Phase 3: Enriching Data" :
                       "Processing..."}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {job.status === "extracting"
                        ? `Crawling pages and extracting records in parallel...`
                        : `Enriching records with parallel data sources...`}
                    </p>
                  </div>
                  <div className="flex gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-white">{job.totalCompaniesFound || 0}</p>
                      <p className="text-[10px] text-muted-foreground">Extracted</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-emerald-400">{job.totalEnriched || 0}</p>
                      <p className="text-[10px] text-muted-foreground">Enriched</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-blue-400">{job.pagesScanned || 0}</p>
                      <p className="text-[10px] text-muted-foreground">Pages</p>
                    </div>
                  </div>
                </div>

                <Progress
                  value={job.progress || 0}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground text-right">{job.progress || 0}%</p>
              </CardContent>
            </Card>

            {/* Live results feed */}
            {results.length > 0 && (
              <Card className="bg-card/50 border-white/8">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold text-white/70 uppercase tracking-wider">
                    Live Results ({results.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4 space-y-2 max-h-[400px] overflow-y-auto">
                  {results.slice(0, 30).map((r) => r.companyData && (
                    <RecordCard key={r.id} data={r.companyData} enrichmentStatus={r.enrichmentStatus} />
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Step 5: Completed results OR viewing past job */}
        {((step === 5 && urlMode === "directory") || viewJobId) && (
          <div className="space-y-5">
            {displayJob && (
              <Card className="bg-emerald-500/8 border-emerald-500/20">
                <CardContent className="py-4 px-5">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-emerald-300 text-sm">
                        {displayJob.status === "completed" ? "Job Complete" : `Status: ${displayJob.status}`}
                      </p>
                      <p className="text-xs text-emerald-400/70 mt-0.5">
                        {displayJob.totalCompaniesFound || 0} records extracted ·
                        {displayJob.totalEnriched || 0} enriched ·
                        {displayJob.pagesScanned || 0} pages crawled
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {["csv", "excel", "json", "pdf"].map((fmt) => (
                        <Button
                          key={fmt}
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const jid = viewJobId || activeJobId;
                            if (jid) exportMutation.mutate({ jobId: jid, format: fmt });
                          }}
                          disabled={exportMutation.isPending}
                          className="border-emerald-500/30 text-emerald-400 text-xs h-8 px-2"
                        >
                          <Download className="w-3 h-3 mr-1" />
                          {fmt === "excel" ? "XLSX" : fmt.toUpperCase()}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {displayResults.length > 0 && (
              <Card className="bg-card/50 border-white/8">
                <CardHeader className="pb-2 pt-4 px-5 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-white/70 uppercase tracking-wider">
                    Records ({displayResults.length})
                  </CardTitle>
                  {viewJobId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setViewJobId(null)}
                      className="text-muted-foreground hover:text-white text-xs h-7"
                    >
                      <X className="w-3 h-3 mr-1" /> Close
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="px-5 pb-4 space-y-2 max-h-[600px] overflow-y-auto">
                  {displayResults.map((r) => r.companyData && (
                    <RecordCard key={r.id} data={r.companyData} enrichmentStatus={r.enrichmentStatus} />
                  ))}
                </CardContent>
              </Card>
            )}

            {displayResults.length === 0 && (
              <Card className="bg-card/50 border-white/8">
                <CardContent className="py-12 text-center">
                  <Layers className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-30" />
                  <p className="text-muted-foreground text-sm">No results yet</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Sidebar: Past Jobs + Export History */}
      <div className="w-72 shrink-0 space-y-3 overflow-y-auto hidden lg:block">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Past Jobs</h3>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setShowExportHistory(!showExportHistory); if (!showExportHistory) refetchExportHistory(); }}
              className={cn("h-7 px-2 text-[10px] gap-1", showExportHistory ? "text-primary" : "text-muted-foreground hover:text-white")}
            >
              <Download className="w-3 h-3" />
              History
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetchJobs()}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-white"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {showExportHistory && (
          <Card className="bg-card/50 border-white/8">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-[10px] font-semibold text-white/60 uppercase tracking-wider flex items-center gap-1.5">
                <Download className="w-3 h-3 text-primary" />
                Export History
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-1.5 max-h-[200px] overflow-y-auto">
              {(!exportHistory || exportHistory.length === 0) ? (
                <p className="text-[10px] text-muted-foreground py-2 text-center">No exports yet</p>
              ) : (
                exportHistory.map((exp) => (
                  <div key={exp.id} className="flex items-center justify-between py-1.5 px-2 bg-white/3 rounded-md">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-white/70 truncate">{exp.filename}</p>
                      <p className="text-[9px] text-muted-foreground">
                        {exp.recordCount} records · {new Date(exp.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[8px] ml-2 shrink-0 border-white/10 text-white/50">
                      {exp.format.toUpperCase()}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {(!allJobs || allJobs.length === 0) && (
          <p className="text-xs text-muted-foreground py-4 text-center">No prospecting jobs yet</p>
        )}

        {allJobs?.map((j) => (
          <Card
            key={j.id}
            className={cn(
              "bg-card/50 border-white/8 cursor-pointer hover:border-white/20 transition-all group",
              viewJobId === j.id && "border-primary/50 bg-primary/5",
            )}
            onClick={() => {
              setViewJobId(j.id);
              setStep(5);
            }}
          >
            <CardContent className="py-3 px-4">
              <div className="flex items-start justify-between mb-1">
                <p className="text-xs font-medium text-white truncate flex-1 mr-2">
                  {j.targetUrl ? new URL(j.targetUrl).hostname : "Unknown"}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] font-bold",
                      j.status === "completed" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                      j.status === "failed" ? "bg-rose-500/20 text-rose-400 border-rose-500/30" :
                      (j.status === "scanning" || j.status === "extracting" || j.status === "enriching")
                        ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                      "bg-white/10 text-white/50 border-white/10",
                    )}
                  >
                    {j.status}
                  </Badge>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(j.id); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-rose-500/20 rounded"
                  >
                    <Trash2 className="w-3 h-3 text-rose-400" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>{j.totalCompaniesFound || 0} records</span>
                <span>{j.totalEnriched || 0} enriched</span>
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                {new Date(j.createdAt).toLocaleDateString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ProsEngine Chat */}
      <div className="mt-8">
        <ProsEngineChat contextCompany={wizard?.url || ''} reportType="company" />
      </div>
    </div>
  );
}
