import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Search, Download, Trash2, CheckSquare, Square,
  ChevronLeft, ChevronRight, X, MapPin, Briefcase, DollarSign,
  Globe, ChevronDown, SlidersHorizontal, AlertTriangle, FileJson,
  FileSpreadsheet, FileText,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Company {
  id: number;
  nameEn?: string | null;
  nameAr?: string | null;
  industry?: string | null;
  subIndustry?: string | null;
  city?: string | null;
  website?: string | null;
  phone?: string | null;
  description?: string | null;
  employeeCount?: string | null;
  revenue?: string | null;
  profit?: string | null;
  foundingYear?: number | null;
  logoUrl?: string | null;
  ceo?: string | null;
  enrichmentScore?: number | null;
}

function fmtRevenue(v?: string | null): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  if (n >= 1e9) return `SAR ${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `SAR ${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `SAR ${Math.round(n / 1e3)}K`;
  return `SAR ${n.toLocaleString()}`;
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

const EMPLOYEE_RANGES = ["1-10","11-50","51-200","201-500","501-1000","1001-5000","5001-10000","10000+"];
const REVENUE_BANDS = [
  { label: "< SAR 10M",        min: 0,            max: 10_000_000 },
  { label: "SAR 10M – 100M",   min: 10_000_000,   max: 100_000_000 },
  { label: "SAR 100M – 1B",    min: 100_000_000,  max: 1_000_000_000 },
  { label: "SAR 1B – 10B",     min: 1_000_000_000,max: 10_000_000_000 },
  { label: "SAR 10B+",         min: 10_000_000_000,max: undefined },
];

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = "All",
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
}) {
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v));
    else onChange([...selected, v]);
  };
  const displayLabel = selected.length === 0
    ? placeholder
    : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-1.5 h-9 border-border/60 bg-background/60 hover:bg-accent/20 min-w-[130px] justify-between",
            selected.length > 0 && "border-primary/50 text-primary"
          )}
        >
          <span className="text-sm truncate max-w-[120px]">{displayLabel}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2 bg-card border-border/60 shadow-xl" align="start">
        <div className="text-xs font-semibold text-muted-foreground px-2 pb-2 border-b border-border/40 mb-1">{label}</div>
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/20 transition-colors"
          onClick={() => onChange([])}
        >
          <div className={cn("w-4 h-4 rounded border border-border/60 flex items-center justify-center", selected.length === 0 && "bg-primary border-primary")}>
            {selected.length === 0 && <div className="w-2 h-2 rounded-sm bg-white" />}
          </div>
          <span className="text-sm">All {label}</span>
        </div>
        <div className="max-h-52 overflow-y-auto mt-1 space-y-0.5">
          {options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/20 transition-colors"
            >
              <Checkbox
                checked={selected.includes(opt)}
                onCheckedChange={() => toggle(opt)}
                className="w-4 h-4"
              />
              <span className="text-sm truncate">{opt}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RevenueBandSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v));
    else onChange([...selected, v]);
  };
  const displayLabel = selected.length === 0
    ? "All Revenue"
    : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-1.5 h-9 border-border/60 bg-background/60 hover:bg-accent/20 min-w-[140px] justify-between",
            selected.length > 0 && "border-primary/50 text-primary"
          )}
        >
          <span className="text-sm truncate max-w-[130px]">{displayLabel}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-2 bg-card border-border/60 shadow-xl" align="start">
        <div className="text-xs font-semibold text-muted-foreground px-2 pb-2 border-b border-border/40 mb-1">Revenue Range</div>
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/20 transition-colors"
          onClick={() => onChange([])}
        >
          <div className={cn("w-4 h-4 rounded border border-border/60 flex items-center justify-center", selected.length === 0 && "bg-primary border-primary")}>
            {selected.length === 0 && <div className="w-2 h-2 rounded-sm bg-white" />}
          </div>
          <span className="text-sm">All Revenue</span>
        </div>
        <div className="space-y-0.5 mt-1">
          {REVENUE_BANDS.map((b) => (
            <label key={b.label} className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/20 transition-colors">
              <Checkbox
                checked={selected.includes(b.label)}
                onCheckedChange={() => toggle(b.label)}
                className="w-4 h-4"
              />
              <span className="text-sm">{b.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const PAGE_SIZE = 24;

export default function MeshBaseCompanies() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [industries, setIndustries] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [employeeRanges, setEmployeeRanges] = useState<string[]>([]);
  const [revenueBands, setRevenueBands] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("relevance");
  const [page, setPage] = useState(1);
  const [manageMode, setManageMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data: industriesList = [] } = useQuery<string[]>({
    queryKey: ["/api/companies/industries"],
    queryFn: () => fetch(`${BASE}/api/companies/industries`).then(r => r.json()),
  });

  const { data: citiesList = [] } = useQuery<string[]>({
    queryKey: ["/api/companies/cities"],
    queryFn: () => fetch(`${BASE}/api/companies/cities`).then(r => r.json()),
  });

  const revenueParams = useCallback(() => {
    if (revenueBands.length === 0) return {};
    const bands = REVENUE_BANDS.filter(b => revenueBands.includes(b.label));
    if (bands.length === 0) return {};
    const mins = bands.map(b => b.min);
    const maxs = bands.map(b => b.max).filter(m => m !== undefined) as number[];
    const revenueMin = Math.min(...mins);
    const revenueMax = maxs.length < bands.length ? undefined : Math.max(...maxs);
    return { revenueMin, revenueMax };
  }, [revenueBands]);

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    params.set("sortBy", sortBy);
    if (search.trim()) params.set("q", search.trim());
    if (industries.length > 0) params.set("industries", industries.join(","));
    if (cities.length > 0) params.set("cities", cities.join(","));
    if (employeeRanges.length > 0) params.set("employeeRanges", employeeRanges.join(","));
    const rv = revenueParams();
    if (rv.revenueMin !== undefined) params.set("revenueMin", String(rv.revenueMin));
    if (rv.revenueMax !== undefined) params.set("revenueMax", String(rv.revenueMax));
    return params.toString();
  }, [page, sortBy, search, industries, cities, employeeRanges, revenueParams]);

  const { data, isLoading } = useQuery<{ companies: Company[]; total: number; totalPages: number }>({
    queryKey: ["/api/companies/meshbase", page, search, industries, cities, employeeRanges, revenueBands, sortBy],
    queryFn: () => fetch(`${BASE}/api/companies?${buildQueryString()}`).then(r => r.json()),
    placeholderData: prev => prev,
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) =>
      fetch(`${BASE}/api/companies/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies/meshbase"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setSelected(new Set());
      setShowDeleteConfirm(false);
      setManageMode(false);
    },
  });

  const companies = data?.companies || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  const hasFilters = industries.length > 0 || cities.length > 0 || employeeRanges.length > 0 || revenueBands.length > 0 || search;
  const clearFilters = () => {
    setIndustries([]);
    setCities([]);
    setEmployeeRanges([]);
    setRevenueBands([]);
    setSearch("");
    setPage(1);
  };

  const toggleSelect = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === companies.length) setSelected(new Set());
    else setSelected(new Set(companies.map(c => c.id)));
  };

  const handleExport = async (format: string) => {
    const ids = selected.size > 0 ? Array.from(selected).join(",") : undefined;
    const url = `${BASE}/api/companies/export?format=${format}${ids ? `&ids=${ids}` : ""}`;
    if (format === "pdf") { window.open(url, "_blank"); return; }
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const ext = format === "excel" ? "xlsx" : format === "word" ? "doc" : format;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `orcbase-companies-${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch { toast({ title: "Export failed. Please try again.", variant: "destructive" }); }
  };

  const filterPage = (p: number) => { setPage(p); setSelected(new Set()); };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-600/20 border border-primary/20 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Companies</h1>
            <p className="text-xs text-muted-foreground">{total.toLocaleString()} companies in OrcBase</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {manageMode && selected.size > 0 && (
            <Button
              size="sm"
              variant="destructive"
              className="gap-2 h-9"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="w-4 h-4" />
              Delete {selected.size} selected
            </Button>
          )}
          <Button
            size="sm"
            variant={manageMode ? "default" : "outline"}
            className={cn("gap-2 h-9", manageMode && "bg-primary text-primary-foreground")}
            onClick={() => { setManageMode(!manageMode); setSelected(new Set()); }}
          >
            {manageMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {manageMode ? "Done" : "Manage"}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-2 h-9">
                <Download className="w-4 h-4" />
                {selected.size > 0 ? `Export (${selected.size})` : "Export"}
                <ChevronDown className="w-3 h-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-1.5 bg-card border-border/60 shadow-xl" align="end">
              {selected.size > 0 && (
                <p className="text-xs text-muted-foreground px-3 pt-1 pb-1.5 border-b border-border/40 mb-1">
                  {selected.size} selected record{selected.size !== 1 ? "s" : ""}
                </p>
              )}
              {[
                { fmt: "excel", label: "Excel Spreadsheet (.xlsx)", Icon: FileSpreadsheet },
                { fmt: "csv", label: "CSV File", Icon: FileSpreadsheet },
                { fmt: "word", label: "Word Document (.doc)", Icon: FileText },
                { fmt: "pdf", label: "Print / Save as PDF", Icon: FileText },
                { fmt: "json", label: "JSON Data", Icon: FileJson },
              ].map(({ fmt, label, Icon }) => (
                <button
                  key={fmt}
                  onClick={() => handleExport(fmt)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm hover:bg-accent/20 transition-colors text-foreground"
                >
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  {label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">Delete {selected.size} selected companies permanently?</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => bulkDeleteMutation.mutate(Array.from(selected))}
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? "Deleting…" : "Confirm Delete"}
            </Button>
          </div>
        </div>
      )}

      {/* Search + Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search companies by name, industry or description…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 h-10 bg-background/60 border-border/60"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filter:</span>
          </div>

          <MultiSelect
            label="Industries"
            options={industriesList}
            selected={industries}
            onChange={v => { setIndustries(v); setPage(1); }}
            placeholder="All Industries"
          />

          <MultiSelect
            label="Cities"
            options={citiesList}
            selected={cities}
            onChange={v => { setCities(v); setPage(1); }}
            placeholder="All Cities"
          />

          <MultiSelect
            label="Employee Count"
            options={EMPLOYEE_RANGES}
            selected={employeeRanges}
            onChange={v => { setEmployeeRanges(v); setPage(1); }}
            placeholder="All Sizes"
          />

          <RevenueBandSelect
            selected={revenueBands}
            onChange={v => { setRevenueBands(v); setPage(1); }}
          />

          <div className="ml-auto flex items-center gap-2">
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-muted-foreground hover:text-foreground" onClick={clearFilters}>
                <X className="w-3.5 h-3.5" />
                Clear filters
              </Button>
            )}
            <Select value={sortBy} onValueChange={v => { setSortBy(v); setPage(1); }}>
              <SelectTrigger className="h-9 w-40 border-border/60 bg-background/60">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="relevance">Relevance</SelectItem>
                <SelectItem value="revenue">Revenue (High to Low)</SelectItem>
                <SelectItem value="established">Year Established</SelectItem>
                <SelectItem value="name">Name (A–Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Manage Mode: select-all bar */}
      {manageMode && companies.length > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-accent/10">
          <Checkbox
            checked={selected.size === companies.length && companies.length > 0}
            onCheckedChange={toggleAll}
          />
          <span className="text-sm text-muted-foreground">
            {selected.size === 0 ? "Select all on this page" : `${selected.size} selected`}
          </span>
        </div>
      )}

      {/* Company Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-44 rounded-xl border border-border/40 bg-card/65 animate-pulse" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No companies found</p>
          <p className="text-sm mt-1">Try adjusting your filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {companies.map((c) => {
            const isSelected = selected.has(c.id);
            return (
              <Card
                key={c.id}
                className={cn(
                  "border-border/50 bg-card/70 hover:bg-card/80 transition-all cursor-pointer group relative",
                  manageMode && isSelected && "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
                )}
                onClick={() => manageMode ? toggleSelect(c.id) : navigate(`/meshbase/companies/${c.id}`)}
              >
                {manageMode && (
                  <div className="absolute top-3 left-3 z-10">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(c.id)}
                      onClick={e => e.stopPropagation()}
                      className="bg-background border-border shadow"
                    />
                  </div>
                )}
                <CardContent className="p-4 space-y-3">
                  <div className={cn("flex items-start gap-3", manageMode && "pl-6")}>
                    {c.logoUrl ? (
                      <img
                        src={c.logoUrl}
                        alt={c.nameEn ?? ""}
                        className="w-10 h-10 rounded-lg object-contain bg-background border border-border/50 shrink-0"
                        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-600/20 border border-primary/20 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">{initials(c.nameEn)}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-foreground leading-tight line-clamp-2">{c.nameEn || c.nameAr || "—"}</div>
                      {c.city && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{c.city}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 min-w-0 overflow-hidden">
                    {c.industry && c.industry.split(",").slice(0, 3).map((tag, i) => {
                      const t = tag.trim();
                      if (!t) return null;
                      return (
                        <Badge
                          key={`${t}-${i}`}
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 capitalize border-border/50 max-w-[140px] truncate"
                          title={t}
                        >
                          <span className="truncate">{t}</span>
                        </Badge>
                      );
                    })}
                    {c.industry && c.industry.split(",").length > 3 && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/50 text-muted-foreground">
                        +{c.industry.split(",").length - 3}
                      </Badge>
                    )}
                    {c.foundingYear && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/50 text-muted-foreground whitespace-nowrap">
                        Est. {c.foundingYear}
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-1 text-xs">
                    {c.employeeCount && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Briefcase className="w-3 h-3 shrink-0" />
                        <span>{c.employeeCount} employees</span>
                      </div>
                    )}
                    {c.revenue && parseFloat(c.revenue) > 0 && (
                      <div className="flex items-center gap-1.5 text-emerald-400">
                        <DollarSign className="w-3 h-3 shrink-0" />
                        <span className="font-medium">{fmtRevenue(c.revenue)}</span>
                      </div>
                    )}
                    {c.website && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Globe className="w-3 h-3 shrink-0" />
                        <a
                          href={c.website.startsWith("http") ? c.website : `https://${c.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate hover:text-foreground transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          {c.website.replace(/^https?:\/\//, "").split("/")[0]}
                        </a>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages} · {total.toLocaleString()} companies
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3"
              disabled={page <= 1}
              onClick={() => filterPage(page - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let p = page <= 3 ? i + 1 : page - 2 + i;
              if (p > totalPages) return null;
              return (
                <Button
                  key={p}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  className="h-8 w-8 px-0"
                  onClick={() => filterPage(p)}
                >
                  {p}
                </Button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3"
              disabled={page >= totalPages}
              onClick={() => filterPage(page + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
