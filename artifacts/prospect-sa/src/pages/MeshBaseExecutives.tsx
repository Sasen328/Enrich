import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, Search, Download, Trash2, CheckSquare, Square,
  ChevronLeft, ChevronRight, X, Linkedin, Mail,
  ChevronDown, SlidersHorizontal, AlertTriangle, FileJson,
  FileSpreadsheet, Building2, Briefcase, DollarSign, Star,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Executive {
  id: number;
  name?: string | null;
  nameAr?: string | null;
  position?: string | null;
  companyName?: string | null;
  companyId?: number | null;
  email?: string | null;
  linkedin?: string | null;
  linkedinUrl?: string | null;
  biography?: string | null;
  education?: string | null;
  photoUrl?: string | null;
  yearsOfExperience?: number | null;
  estimatedSalary?: number | null;
  seniorityLevel?: string | null;
  skills?: string[] | null;
  salary?: string | null;
}

function fmtSalary(v?: number | null): string {
  if (!v) return "—";
  if (v >= 1_000_000) return `SAR ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `SAR ${Math.round(v / 1_000)}K`;
  return `SAR ${v.toLocaleString()}`;
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

const JOB_LEVELS = [
  { value: "c-suite", label: "C-Suite" },
  { value: "vp", label: "Vice President" },
  { value: "director", label: "Director" },
  { value: "manager", label: "Manager" },
  { value: "founder", label: "Founder" },
  { value: "chairman", label: "Chairman" },
];

const EXPERIENCE_RANGES = [
  { value: "0-5", label: "0 – 5 years" },
  { value: "5-10", label: "5 – 10 years" },
  { value: "10-15", label: "10 – 15 years" },
  { value: "15-20", label: "15 – 20 years" },
  { value: "20+", label: "20+ years" },
];

const SALARY_RANGES = [
  { value: "0-500000", label: "< SAR 500K" },
  { value: "500000-1000000", label: "SAR 500K – 1M" },
  { value: "1000000-2000000", label: "SAR 1M – 2M" },
  { value: "2000000-5000000", label: "SAR 2M – 5M" },
  { value: "5000000+", label: "SAR 5M+" },
];

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = "All",
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
}) {
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v));
    else onChange([...selected, v]);
  };
  const selectedLabels = options.filter(o => selected.includes(o.value)).map(o => o.label);
  const displayLabel = selected.length === 0
    ? placeholder
    : selected.length === 1 ? selectedLabels[0] : `${selected.length} selected`;

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
      <PopoverContent className="w-52 p-2 bg-card border-border/60 shadow-xl" align="start">
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
            <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/20 transition-colors">
              <Checkbox checked={selected.includes(opt.value)} onCheckedChange={() => toggle(opt.value)} className="w-4 h-4" />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CompanyMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: { id: number; name: string }[];
  selected: number[];
  onChange: (vals: number[]) => void;
}) {
  const [companySearch, setCompanySearch] = useState("");
  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };
  const filtered = options.filter(o => o.name.toLowerCase().includes(companySearch.toLowerCase())).slice(0, 100);
  const displayLabel = selected.length === 0
    ? "All Companies"
    : selected.length === 1
      ? (options.find(o => o.id === selected[0])?.name || "1 selected")
      : `${selected.length} companies`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-1.5 h-9 border-border/60 bg-background/60 hover:bg-accent/20 min-w-[150px] justify-between",
            selected.length > 0 && "border-primary/50 text-primary"
          )}
        >
          <span className="text-sm truncate max-w-[140px]">{displayLabel}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 bg-card border-border/60 shadow-xl" align="start">
        <div className="text-xs font-semibold text-muted-foreground px-2 pb-2 border-b border-border/40 mb-1">Company</div>
        <div className="p-1 pb-2">
          <Input
            placeholder="Search companies…"
            value={companySearch}
            onChange={e => setCompanySearch(e.target.value)}
            className="h-7 text-xs bg-background/60 border-border/60"
          />
        </div>
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/20 transition-colors"
          onClick={() => onChange([])}
        >
          <div className={cn("w-4 h-4 rounded border border-border/60 flex items-center justify-center", selected.length === 0 && "bg-primary border-primary")}>
            {selected.length === 0 && <div className="w-2 h-2 rounded-sm bg-white" />}
          </div>
          <span className="text-sm">All Companies</span>
        </div>
        <div className="max-h-48 overflow-y-auto mt-1 space-y-0.5">
          {filtered.map((opt) => (
            <label key={opt.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/20 transition-colors">
              <Checkbox checked={selected.includes(opt.id)} onCheckedChange={() => toggle(opt.id)} className="w-4 h-4" />
              <span className="text-sm truncate">{opt.name}</span>
            </label>
          ))}
          {filtered.length === 0 && <div className="text-xs text-muted-foreground px-2 py-2">No companies found</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const PAGE_SIZE = 24;

export default function MeshBaseExecutives() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState("");
  const [levels, setLevels] = useState<string[]>([]);
  const [experienceRanges, setExperienceRanges] = useState<string[]>([]);
  const [salaryRanges, setSalaryRanges] = useState<string[]>([]);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState("name_asc");
  const [page, setPage] = useState(1);
  const [manageMode, setManageMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data: companiesForFilter = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/companies/filter-list"],
    queryFn: () =>
      fetch(`${BASE}/api/companies?limit=500&sortBy=name`)
        .then(r => r.json())
        .then(d => (d.companies || []).map((c: any) => ({ id: c.id, name: c.nameEn || c.nameAr || "Unknown" }))),
  });

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    params.set("sortBy", sortBy);
    if (search.trim()) params.set("q", search.trim());
    if (levels.length > 0) params.set("levels", levels.join(","));
    if (experienceRanges.length > 0) params.set("experienceRanges", experienceRanges.join(","));
    if (salaryRanges.length > 0) params.set("salaryRanges", salaryRanges.join(","));
    if (selectedCompanyIds.length > 0) params.set("companyIds", selectedCompanyIds.join(","));
    return params.toString();
  }, [page, sortBy, search, levels, experienceRanges, salaryRanges, selectedCompanyIds]);

  const { data, isLoading } = useQuery<{ executives: Executive[]; total: number; totalPages: number }>({
    queryKey: ["/api/executives/meshbase", page, search, levels, experienceRanges, salaryRanges, selectedCompanyIds, sortBy],
    queryFn: () => fetch(`${BASE}/api/executives?${buildQueryString()}`).then(r => r.json()),
    placeholderData: prev => prev,
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) =>
      fetch(`${BASE}/api/executives/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/executives/meshbase"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setSelected(new Set());
      setShowDeleteConfirm(false);
      setManageMode(false);
    },
  });

  const executives = data?.executives || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  const hasFilters = levels.length > 0 || experienceRanges.length > 0 || salaryRanges.length > 0 || selectedCompanyIds.length > 0 || search;
  const clearFilters = () => {
    setLevels([]);
    setExperienceRanges([]);
    setSalaryRanges([]);
    setSelectedCompanyIds([]);
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
    if (selected.size === executives.length) setSelected(new Set());
    else setSelected(new Set(executives.map(e => e.id)));
  };

  const handleExport = (format: string) => {
    const ids = selected.size > 0 ? Array.from(selected).join(",") : undefined;
    const url = `${BASE}/api/executives/export?format=${format}${ids ? `&ids=${ids}` : ""}`;
    window.open(url, "_blank");
  };

  const filterPage = (p: number) => { setPage(p); setSelected(new Set()); };

  const seniorityColor: Record<string, string> = {
    "C-Suite": "text-amber-400 bg-amber-500/10 border-amber-500/30",
    "VP": "text-violet-400 bg-violet-500/10 border-violet-500/30",
    "Director": "text-blue-400 bg-blue-500/10 border-blue-500/30",
    "Senior": "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    "Mid": "text-sky-400 bg-sky-500/10 border-sky-500/30",
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 border border-violet-500/20 flex items-center justify-center">
            <Users className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Executives</h1>
            <p className="text-xs text-muted-foreground">{total.toLocaleString()} executives in OrcBase</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {manageMode && selected.size > 0 && (
            <Button size="sm" variant="destructive" className="gap-2 h-9" onClick={() => setShowDeleteConfirm(true)}>
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
                Export
                <ChevronDown className="w-3 h-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-1.5 bg-card border-border/60 shadow-xl" align="end">
              {[
                { fmt: "csv", label: "Export as CSV", Icon: FileSpreadsheet },
                { fmt: "json", label: "Export as JSON", Icon: FileJson },
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
            <span className="text-sm font-medium">Delete {selected.size} selected executives permanently?</span>
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
            placeholder="Search executives by name, position or company…"
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
            label="Level"
            options={JOB_LEVELS}
            selected={levels}
            onChange={v => { setLevels(v); setPage(1); }}
            placeholder="All Levels"
          />

          <MultiSelect
            label="Experience"
            options={EXPERIENCE_RANGES}
            selected={experienceRanges}
            onChange={v => { setExperienceRanges(v); setPage(1); }}
            placeholder="All Experience"
          />

          <MultiSelect
            label="Compensation"
            options={SALARY_RANGES}
            selected={salaryRanges}
            onChange={v => { setSalaryRanges(v); setPage(1); }}
            placeholder="All Compensation"
          />

          <CompanyMultiSelect
            options={companiesForFilter}
            selected={selectedCompanyIds}
            onChange={v => { setSelectedCompanyIds(v); setPage(1); }}
          />

          <div className="ml-auto flex items-center gap-2">
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-muted-foreground hover:text-foreground" onClick={clearFilters}>
                <X className="w-3.5 h-3.5" />
                Clear filters
              </Button>
            )}
            <Select value={sortBy} onValueChange={v => { setSortBy(v); setPage(1); }}>
              <SelectTrigger className="h-9 w-48 border-border/60 bg-background/60">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name_asc">Name (A–Z)</SelectItem>
                <SelectItem value="name_desc">Name (Z–A)</SelectItem>
                <SelectItem value="salary_high">Salary (High – Low)</SelectItem>
                <SelectItem value="salary_low">Salary (Low – High)</SelectItem>
                <SelectItem value="experience_most">Experience (Most)</SelectItem>
                <SelectItem value="experience_least">Experience (Least)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Manage Mode: select-all bar */}
      {manageMode && executives.length > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-accent/10">
          <Checkbox
            checked={selected.size === executives.length && executives.length > 0}
            onCheckedChange={toggleAll}
          />
          <span className="text-sm text-muted-foreground">
            {selected.size === 0 ? "Select all on this page" : `${selected.size} selected`}
          </span>
        </div>
      )}

      {/* Executive Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-52 rounded-xl border border-border/40 bg-card/40 animate-pulse" />
          ))}
        </div>
      ) : executives.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No executives found</p>
          <p className="text-sm mt-1">Try adjusting your filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {executives.map((e) => {
            const isSelected = selected.has(e.id);
            const linkedinLink = e.linkedinUrl || e.linkedin;
            const salaryColor = seniorityColor[e.seniorityLevel || ""] || "text-muted-foreground bg-muted/10 border-border/40";

            return (
              <Card
                key={e.id}
                className={cn(
                  "border-border/50 bg-card/60 hover:bg-card/80 transition-all cursor-pointer group relative",
                  manageMode && isSelected && "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
                )}
                onClick={() => manageMode ? toggleSelect(e.id) : navigate(`/meshbase/executives/${e.id}`)}
              >
                {manageMode && (
                  <div className="absolute top-3 left-3 z-10">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(e.id)}
                      onClick={ev => ev.stopPropagation()}
                      className="bg-background border-border shadow"
                    />
                  </div>
                )}
                <CardContent className="p-4 space-y-3">
                  <div className={cn("flex items-start gap-3", manageMode && "pl-6")}>
                    {e.photoUrl ? (
                      <img
                        src={e.photoUrl}
                        alt={e.name ?? ""}
                        className="w-12 h-12 rounded-full object-cover border-2 border-border/50 shrink-0"
                        onError={ev => { (ev.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20 border-2 border-violet-500/20 flex items-center justify-center shrink-0">
                        <span className="text-sm font-bold text-violet-400">{initials(e.name)}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-foreground leading-tight truncate">{e.name || "—"}</div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{e.position || "Executive"}</div>
                      {e.companyName && (
                        <div className="text-xs text-violet-400 truncate flex items-center gap-1 mt-0.5">
                          <Building2 className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{e.companyName}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {e.seniorityLevel && e.seniorityLevel !== "Professional" && (
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] px-1.5 py-0 border", salaryColor)}
                    >
                      {e.seniorityLevel}
                    </Badge>
                  )}

                  <div className="space-y-1 text-xs">
                    {e.yearsOfExperience != null && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Briefcase className="w-3 h-3 shrink-0" />
                        <span>{e.yearsOfExperience} yrs experience</span>
                      </div>
                    )}
                    {(e.estimatedSalary != null && e.estimatedSalary > 0) && (
                      <div className="flex items-center gap-1.5 text-emerald-400">
                        <DollarSign className="w-3 h-3 shrink-0" />
                        <span className="font-medium">{fmtSalary(e.estimatedSalary)} / yr</span>
                      </div>
                    )}
                  </div>

                  {(e.email || linkedinLink) && (
                    <div className="flex items-center gap-2 pt-1 border-t border-border/30">
                      {linkedinLink && (
                        <a
                          href={linkedinLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-blue-400 transition-colors"
                          onClick={ev => ev.stopPropagation()}
                          title="LinkedIn Profile"
                        >
                          <Linkedin className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {e.email && (
                        <a
                          href={`mailto:${e.email}`}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          onClick={ev => ev.stopPropagation()}
                          title={e.email}
                        >
                          <Mail className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {e.skills && e.skills.length > 0 && (
                        <div className="ml-auto flex gap-1 overflow-hidden">
                          {e.skills.slice(0, 2).map(s => (
                            <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-accent/30 text-muted-foreground truncate max-w-[60px]">{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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
            Page {page} of {totalPages} · {total.toLocaleString()} executives
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 px-3" disabled={page <= 1} onClick={() => filterPage(page - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let p = page <= 3 ? i + 1 : page - 2 + i;
              if (p > totalPages) return null;
              return (
                <Button key={p} variant={p === page ? "default" : "outline"} size="sm" className="h-8 w-8 px-0" onClick={() => filterPage(p)}>
                  {p}
                </Button>
              );
            })}
            <Button variant="outline" size="sm" className="h-8 px-3" disabled={page >= totalPages} onClick={() => filterPage(page + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
