import { useState } from "react";
import { ChevronDown, ChevronRight, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// ─── Brief shape (matches leadFactoryBriefSchema on the server) ─────────────
export interface LeadFactoryBrief {
  inputMode: "segment" | "list";
  mode?: "person" | "company";
  icpDescription?: string;
  industries?: string[];
  subIndustries?: string[];
  employeeBands?: string[];
  revenueBands?: string[];
  cities?: string[];
  regions?: string[];
  entityTypes?: string[];
  targetTitles?: string[];
  seniority?: string[];
  departments?: string[];
  languages?: string[];
  yearsInRoleMin?: number;
  yearsInRoleMax?: number;
  yearsExperienceMin?: number;
  yearsExperienceMax?: number;
  educationDegree?: string[];
  fundingStage?: string[];
  technologies?: string[];
  foundedYearMin?: number;
  foundedYearMax?: number;
  buyingSignals?: string[];
  signalRecencyDays?: number;
  minIcpScore?: number;
  hasExecutives?: boolean;
  hasWebsite?: boolean;
  hasVerifiedEmail?: boolean;
  saudizationBand?: string;
  tadawulListedOnly?: boolean;
  companies?: string[];
  targetCount?: number;
  enrichmentDepth?: "shallow" | "standard" | "deep";
  autoEnrichDownstream?: boolean;
}

// ─── Filter option presets ──────────────────────────────────────────────────
const EMPLOYEE_BANDS = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+"];
const REVENUE_BANDS = ["<1M", "1-10M", "10-50M", "50-250M", "250M-1B", "1B+"];
const REGIONS = ["Riyadh", "Eastern Province", "Makkah", "Madinah", "Asir", "Qassim", "Tabuk", "Ha'il", "Jazan", "Najran", "Al Bahah", "Northern Borders", "Al Jouf"];
const CITIES = ["Riyadh", "Jeddah", "Dammam", "Khobar", "Dhahran", "Makkah", "Madinah", "Tabuk", "Buraidah", "Abha", "Taif"];
const INDUSTRIES = ["Technology", "Financial Services", "Healthcare", "Retail", "Manufacturing", "Construction", "Energy", "Hospitality", "Real Estate", "Education", "Logistics", "Government", "Telecom", "Media"];
const SENIORITY = ["c_level", "vp", "director", "manager", "senior", "mid", "junior", "entry"];
const DEPARTMENTS = ["engineering", "sales", "marketing", "operations", "finance", "hr", "legal", "product", "it", "executive"];
const LANGUAGES = ["Arabic", "English", "Hindi", "Urdu", "French", "Tagalog"];
const DEGREES = ["bachelor", "master", "phd", "mba", "certificate"];
const FUNDING_STAGES = ["bootstrapped", "seed", "series_a", "series_b", "series_c+", "public", "private_equity"];
const SIGNAL_TYPES = ["hiring_surge", "funding_round", "leadership_change", "expansion", "compliance_event", "contract_award", "regulatory_change", "sanctions"];
const ENRICHMENT_DEPTH: Array<"shallow" | "standard" | "deep"> = ["shallow", "standard", "deep"];
const TARGET_COUNTS = [25, 50, 100, 250, 500];

interface FilterPanelProps {
  mode: "person" | "company";
  value: LeadFactoryBrief;
  onChange: (next: LeadFactoryBrief) => void;
  onSubmit: () => void;
  submitting?: boolean;
}

// ── Reusable section wrapper ──────────────────────────────────────────────────
function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <div className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        className="w-full flex items-center justify-between py-2 px-3 hover:bg-card/40 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && <div className="px-3 pb-3 pt-1 space-y-2">{children}</div>}
    </div>
  );
}

// ── Multi-select chips ────────────────────────────────────────────────────────
function ChipMulti({
  options, value, onChange,
}: {
  options: readonly string[];
  value: string[] | undefined;
  onChange: (next: string[]) => void;
}) {
  const sel = new Set(value || []);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => {
            const next = new Set(sel);
            if (next.has(o)) next.delete(o); else next.add(o);
            onChange(Array.from(next));
          }}
          className={cn(
            "text-[11px] px-2 py-0.5 rounded-md border transition-colors",
            sel.has(o)
              ? "bg-primary/20 border-primary/50 text-primary"
              : "bg-card/40 border-border/40 text-muted-foreground hover:border-primary/30"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

// ── Number range ──────────────────────────────────────────────────────────────
function RangeInput({
  label, min, max, valueMin, valueMax, onChange,
}: {
  label: string; min: number; max: number;
  valueMin?: number; valueMax?: number;
  onChange: (lo: number | undefined, hi: number | undefined) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2 mt-1">
        <Input
          type="number" min={min} max={max} placeholder={`${min}`}
          value={valueMin ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined, valueMax)}
          className="h-8 text-xs"
        />
        <span className="text-xs text-muted-foreground self-center">to</span>
        <Input
          type="number" min={min} max={max} placeholder={`${max}`}
          value={valueMax ?? ""}
          onChange={(e) => onChange(valueMin, e.target.value ? Number(e.target.value) : undefined)}
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}

// ── Tag input (comma-separated free text) ─────────────────────────────────────
function TagInput({
  label, placeholder, value, onChange,
}: {
  label: string; placeholder?: string;
  value: string[] | undefined; onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState((value || []).join(", "));
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.split(",").map((s) => s.trim()).filter(Boolean))}
        className="h-8 text-xs"
      />
    </div>
  );
}

export function FilterPanel({ mode, value, onChange, onSubmit, submitting }: FilterPanelProps) {
  const patch = (delta: Partial<LeadFactoryBrief>) => onChange({ ...value, ...delta });

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-card/60">
        <Filter className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm">
          Filters — {mode === "person" ? "Person mode" : "Company mode"}
        </span>
      </div>

      {/* ICP description */}
      <Section title="ICP description" defaultOpen>
        <Input
          placeholder="e.g. SaaS companies in Riyadh, 50–200 employees, looking for ERP"
          value={value.icpDescription || ""}
          onChange={(e) => patch({ icpDescription: e.target.value })}
          className="h-8 text-xs"
        />
      </Section>

      {/* Person-only filters */}
      {mode === "person" && (
        <>
          <Section title="Person identity">
            <TagInput
              label="Target titles" placeholder="CTO, VP Engineering, …"
              value={value.targetTitles} onChange={(v) => patch({ targetTitles: v })}
            />
            <div>
              <Label className="text-xs">Seniority</Label>
              <ChipMulti options={SENIORITY} value={value.seniority} onChange={(v) => patch({ seniority: v })} />
            </div>
            <div>
              <Label className="text-xs">Department</Label>
              <ChipMulti options={DEPARTMENTS} value={value.departments} onChange={(v) => patch({ departments: v })} />
            </div>
            <div>
              <Label className="text-xs">Languages</Label>
              <ChipMulti options={LANGUAGES} value={value.languages} onChange={(v) => patch({ languages: v })} />
            </div>
            <RangeInput
              label="Years in current role" min={0} max={40}
              valueMin={value.yearsInRoleMin} valueMax={value.yearsInRoleMax}
              onChange={(lo, hi) => patch({ yearsInRoleMin: lo, yearsInRoleMax: hi })}
            />
            <RangeInput
              label="Years of experience" min={0} max={40}
              valueMin={value.yearsExperienceMin} valueMax={value.yearsExperienceMax}
              onChange={(lo, hi) => patch({ yearsExperienceMin: lo, yearsExperienceMax: hi })}
            />
            <div>
              <Label className="text-xs">Education degree</Label>
              <ChipMulti options={DEGREES} value={value.educationDegree} onChange={(v) => patch({ educationDegree: v })} />
            </div>
          </Section>
        </>
      )}

      {/* Firmographics (both modes) */}
      <Section title="Firmographics">
        <div>
          <Label className="text-xs">Industry</Label>
          <ChipMulti options={INDUSTRIES} value={value.industries} onChange={(v) => patch({ industries: v })} />
        </div>
        <div>
          <Label className="text-xs">Employee count</Label>
          <ChipMulti options={EMPLOYEE_BANDS} value={value.employeeBands} onChange={(v) => patch({ employeeBands: v })} />
        </div>
        <div>
          <Label className="text-xs">Revenue (SAR)</Label>
          <ChipMulti options={REVENUE_BANDS} value={value.revenueBands} onChange={(v) => patch({ revenueBands: v })} />
        </div>
        <div>
          <Label className="text-xs">Funding stage</Label>
          <ChipMulti options={FUNDING_STAGES} value={value.fundingStage} onChange={(v) => patch({ fundingStage: v })} />
        </div>
        <RangeInput
          label="Founded year" min={1950} max={new Date().getFullYear()}
          valueMin={value.foundedYearMin} valueMax={value.foundedYearMax}
          onChange={(lo, hi) => patch({ foundedYearMin: lo, foundedYearMax: hi })}
        />
        <TagInput
          label="Technologies used" placeholder="Salesforce, AWS, SAP, …"
          value={value.technologies} onChange={(v) => patch({ technologies: v })}
        />
      </Section>

      {/* Location */}
      <Section title="Location">
        <div>
          <Label className="text-xs">Region</Label>
          <ChipMulti options={REGIONS} value={value.regions} onChange={(v) => patch({ regions: v })} />
        </div>
        <div>
          <Label className="text-xs">City</Label>
          <ChipMulti options={CITIES} value={value.cities} onChange={(v) => patch({ cities: v })} />
        </div>
      </Section>

      {/* Intent / signals */}
      <Section title="Intent (buying signals)">
        <div>
          <Label className="text-xs">Signal types</Label>
          <ChipMulti options={SIGNAL_TYPES} value={value.buyingSignals} onChange={(v) => patch({ buyingSignals: v })} />
        </div>
        <div>
          <Label className="text-xs">Recency (last N days)</Label>
          <Input
            type="number" min={1} max={730} placeholder="30"
            value={value.signalRecencyDays ?? ""}
            onChange={(e) => patch({ signalRecencyDays: e.target.value ? Number(e.target.value) : undefined })}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">Min ICP score</Label>
          <Input
            type="number" min={0} max={100} placeholder="60"
            value={value.minIcpScore ?? ""}
            onChange={(e) => patch({ minIcpScore: e.target.value ? Number(e.target.value) : undefined })}
            className="h-8 text-xs"
          />
        </div>
      </Section>

      {/* Company quality flags (company mode only) */}
      {mode === "company" && (
        <Section title="Quality flags">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={!!value.hasExecutives} onCheckedChange={(v) => patch({ hasExecutives: !!v })} />
              Has executives
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={!!value.hasWebsite} onCheckedChange={(v) => patch({ hasWebsite: !!v })} />
              Has website
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={!!value.hasVerifiedEmail} onCheckedChange={(v) => patch({ hasVerifiedEmail: !!v })} />
              Has verified email
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={!!value.tadawulListedOnly} onCheckedChange={(v) => patch({ tadawulListedOnly: !!v })} />
              Listed on Tadawul only
            </label>
          </div>
        </Section>
      )}

      {/* Output controls */}
      <Section title="Output">
        <div>
          <Label className="text-xs">Target count</Label>
          <ChipMulti
            options={TARGET_COUNTS.map(String)}
            value={value.targetCount ? [String(value.targetCount)] : ["50"]}
            onChange={(v) => patch({ targetCount: Number(v[0] || 50) })}
          />
        </div>
        <div>
          <Label className="text-xs">Enrichment depth</Label>
          <ChipMulti
            options={ENRICHMENT_DEPTH}
            value={value.enrichmentDepth ? [value.enrichmentDepth] : ["standard"]}
            onChange={(v) => patch({ enrichmentDepth: (v[0] as "shallow" | "standard" | "deep") || "standard" })}
          />
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox checked={!!value.autoEnrichDownstream} onCheckedChange={(v) => patch({ autoEnrichDownstream: !!v })} />
          Auto-trigger Signals + Relationship Intel for each new company
        </label>
      </Section>

      <div className="p-3 border-t border-border/40 bg-card/60">
        <Button onClick={onSubmit} disabled={submitting} className="w-full gap-2">
          {submitting ? "Running…" : `Run ${mode === "person" ? "Person" : "Company"} Hunt →`}
        </Button>
      </div>
    </div>
  );
}
