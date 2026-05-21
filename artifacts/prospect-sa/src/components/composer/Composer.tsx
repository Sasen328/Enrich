/**
 * Composer — 4-layer wizard for the AI Research Composer.
 *   Layer 1: Pick  (template + modes + target)
 *   Layer 2: Scope (country + industry + listing + sub-filters)
 *   Layer 3: Tools (sources / connectors / skills with category drill-down)
 *   Layer 4: Ask   (write / filters / both + enhance toggle)
 *
 * Driven by /api/composer/* endpoints. Emits an EnhancedPrompt that the chat
 * page POSTs to /api/ai-chat/stream as the message body.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronLeft, Sparkles, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── types mirroring the backend ───────────────────────────────────────────────
interface Template { id: string; label: string; description: string; defaultQuestion: string; defaultModes: string[]; defaultTarget: "person" | "company" | "both"; defaultCountries: string[]; defaultIndustry?: string; defaultSources: string[]; defaultSkills: string[]; requiredSchema: string }
interface Mode { id: string; label: string; description: string }
interface Source { id: string; label: string; category: string; language: string }
interface Connector { id: string; label: string; category: string; status: "ok" | "req" }
interface Skill { id: string; label: string; category: string; description: string }

export interface ComposerState {
  templateId?: string;
  modes: string[];
  target: "person" | "company" | "both";
  countries: string[];
  industry: string;
  listing: string;
  subFilters: Record<string, string>;
  askFilters: Record<string, string>;
  sources: string[];
  connectors: string[];
  skills: string[];
  freeText: string;
  enhance: boolean;
}

const COUNTRIES = [
  ["sa", "🇸🇦 Saudi Arabia"], ["ae", "🇦🇪 UAE"], ["kw", "🇰🇼 Kuwait"], ["qa", "🇶🇦 Qatar"],
  ["bh", "🇧🇭 Bahrain"], ["om", "🇴🇲 Oman"], ["eg", "🇪🇬 Egypt"], ["jo", "🇯🇴 Jordan"],
  ["gcc", "🌐 GCC"], ["mena", "🌐 MENA"], ["global", "🌐 Global"],
] as const;

const INDUSTRIES = [
  ["fintech", "💳 Fintech"], ["banking", "🏦 Banking"], ["insurance", "🛡️ Insurance"],
  ["energy", "🛢️ Energy"], ["utilities", "⚡ Utilities"], ["construction", "🏗️ Construction"],
  ["realestate", "🏢 Real Estate"], ["healthcare", "💊 Healthcare"], ["retail", "🛒 Retail"],
  ["fnb", "🍽️ F&B"], ["hospitality", "🏨 Hospitality"], ["logistics", "🚚 Logistics"],
  ["manufacturing", "🏭 Manufacturing"], ["telecom", "📡 Telecom"], ["saas", "💻 SaaS / Tech"],
  ["edtech", "🎓 EdTech"], ["govt", "🏛️ Government"],
] as const;

const LISTINGS = ["Any", "Tadawul main", "Nomu", "Private only", "VC-backed", "PE-owned", "Family-owned", "State-owned"];

const DEFAULT_STATE: ComposerState = {
  modes: ["leadgen", "enrich"],
  target: "both",
  countries: ["sa"],
  industry: "fintech",
  listing: "Any",
  subFilters: {},
  askFilters: {},
  sources: [],
  connectors: ["tavily", "playwright", "crawl4ai"],
  skills: ["saudi-lead-hunter"],
  freeText: "",
  enhance: true,
};

interface Props {
  onRun: (payload: { enhancedPrompt: string; state: ComposerState }) => void;
  running?: boolean;
}

export function Composer({ onRun, running }: Props) {
  const [layer, setLayer] = useState(1);
  const [s, setS] = useState<ComposerState>(DEFAULT_STATE);
  const [enhancing, setEnhancing] = useState(false);

  // ── data ────────────────────────────────────────────────────────────────────
  const templates = useQuery<{ templates: Template[] }>({
    queryKey: ["/api/composer/templates"],
    queryFn: () => fetch(`${BASE}/api/composer/templates`).then((r) => r.json()),
  });
  const modes = useQuery<{ modes: Mode[] }>({
    queryKey: ["/api/composer/modes"],
    queryFn: () => fetch(`${BASE}/api/composer/modes`).then((r) => r.json()),
  });
  const skills = useQuery<{ skills: Skill[] }>({
    queryKey: ["/api/composer/skills"],
    queryFn: () => fetch(`${BASE}/api/composer/skills`).then((r) => r.json()),
  });
  const recoSources = useQuery<{ sources: Source[] }>({
    queryKey: ["/api/composer/sources", "reco", s.industry, s.countries.join(","), s.listing, s.target],
    queryFn: () => fetch(`${BASE}/api/composer/sources?reco=1&industry=${encodeURIComponent(s.industry)}&countries=${encodeURIComponent(s.countries.join(","))}&listing=${encodeURIComponent(s.listing)}&target=${s.target}`).then((r) => r.json()),
  });
  const connectors = useQuery<{ connectors: Connector[] }>({
    queryKey: ["/api/composer/connectors"],
    queryFn: () => fetch(`${BASE}/api/composer/connectors`).then((r) => r.json()),
  });

  // sync sources when reco arrives + user hasn't manually picked any
  useEffect(() => {
    if (recoSources.data?.sources && s.sources.length === 0) {
      setS((prev) => ({ ...prev, sources: recoSources.data!.sources.map((src) => src.id) }));
    }
  }, [recoSources.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Template-pick auto-fills downstream layers
  function applyTemplate(t: Template) {
    setS((prev) => ({
      ...prev,
      templateId: t.id,
      modes: t.defaultModes,
      target: t.defaultTarget,
      countries: t.defaultCountries,
      industry: t.defaultIndustry || prev.industry,
      sources: t.defaultSources,
      skills: t.defaultSkills,
      freeText: prev.freeText || t.defaultQuestion,
    }));
  }

  async function run() {
    setEnhancing(true);
    try {
      let enhancedPrompt = s.freeText;
      if (s.enhance) {
        const r = await fetch(`${BASE}/api/composer/enhance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(s),
        });
        const data = await r.json();
        if (data?.enhancedPrompt) enhancedPrompt = data.enhancedPrompt;
      }
      onRun({ enhancedPrompt, state: s });
    } finally {
      setEnhancing(false);
    }
  }

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Crumb strip */}
      <div className="flex items-center gap-1.5 text-xs">
        {[1, 2, 3, 4].map((n, i) => (
          <button
            key={n}
            onClick={() => setLayer(n)}
            className={`px-3 py-1.5 rounded-full font-semibold transition-colors flex items-center gap-1.5 ${
              layer === n ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                : layer > n ? "text-emerald-500 hover:bg-emerald-500/10"
                : "text-muted-foreground"
            }`}
          >
            <span className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] ${
              layer === n ? "bg-primary text-primary-foreground"
              : layer > n ? "bg-emerald-500 text-foreground"
              : "bg-muted text-muted-foreground"}`}>{n}</span>
            {["Pick", "Scope", "Tools", "Ask"][i]}
          </button>
        ))}
      </div>

      {/* Rule-lock banner */}
      <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
        <Lock className="w-3.5 h-3.5 text-emerald-500" />
        <span><strong>Strict Input Contract</strong> — every selection is honored verbatim; halt-and-ask on conflict.</span>
      </div>

      {/* LAYER 1: PICK */}
      {layer === 1 && (
        <Card title="1. Pick — template &amp; modes &amp; target">
          <Field label="📑 Template">
            <select className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" value={s.templateId || ""} onChange={(e) => {
              const t = templates.data?.templates.find((x) => x.id === e.target.value);
              if (t) applyTemplate(t); else setS({ ...s, templateId: undefined });
            }}>
              <option value="">— Start blank —</option>
              {templates.data?.templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>

          <Field label="⚙️ Modes (multi-select)">
            <div className="flex flex-wrap gap-1.5">
              {modes.data?.modes.map((m) => (
                <Chip key={m.id} on={s.modes.includes(m.id)} onClick={() =>
                  setS({ ...s, modes: s.modes.includes(m.id) ? s.modes.filter((x) => x !== m.id) : [...s.modes, m.id] })}
                >{m.label}</Chip>
              ))}
            </div>
          </Field>

          <Field label="🎯 Looking for">
            <div className="grid grid-cols-3 gap-2">
              {(["person", "company", "both"] as const).map((t) => (
                <button key={t}
                  onClick={() => setS({ ...s, target: t })}
                  className={`p-3 rounded-lg border text-center text-sm font-semibold transition-colors ${
                    s.target === t ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700"
                    : "border-border bg-card hover:border-primary/40"}`}
                >
                  <div className="text-lg">{t === "person" ? "👤" : t === "company" ? "🏢" : "🌐"}</div>
                  <div className="capitalize">{t === "both" ? "Both" : `${t}s`}</div>
                </button>
              ))}
            </div>
          </Field>
          <Nav onNext={() => setLayer(2)} />
        </Card>
      )}

      {/* LAYER 2: SCOPE */}
      {layer === 2 && (
        <Card title="2. Scope — country, industry, listing">
          <div className="grid grid-cols-2 gap-3">
            <Field label="🌍 Country">
              <div className="flex flex-wrap gap-1.5">
                {COUNTRIES.map(([id, label]) => (
                  <Chip key={id} on={s.countries.includes(id)} onClick={() =>
                    setS({ ...s, countries: s.countries.includes(id) ? s.countries.filter((x) => x !== id) : [...s.countries, id] })}
                  >{label}</Chip>
                ))}
              </div>
            </Field>
            <Field label="🏭 Industry">
              <select className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" value={s.industry} onChange={(e) => setS({ ...s, industry: e.target.value })}>
                {INDUSTRIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="📊 Listing status">
            <div className="flex flex-wrap gap-1.5">
              {LISTINGS.map((l) => <Chip key={l} on={s.listing === l} onClick={() => setS({ ...s, listing: l })}>{l}</Chip>)}
            </div>
          </Field>
          <Nav onBack={() => setLayer(1)} onNext={() => setLayer(3)} />
        </Card>
      )}

      {/* LAYER 3: TOOLS */}
      {layer === 3 && (
        <Card title="3. Tools — sources / connectors / skills">
          <Field label={`📚 Sources — recommended for ${s.industry} · ${s.countries.join(",")}`}>
            <div className="flex flex-wrap gap-1.5">
              {(recoSources.data?.sources || []).map((src) => (
                <Chip key={src.id} on={s.sources.includes(src.id)} onClick={() =>
                  setS({ ...s, sources: s.sources.includes(src.id) ? s.sources.filter((x) => x !== src.id) : [...s.sources, src.id] })}
                >{src.label}</Chip>
              ))}
            </div>
          </Field>

          <Field label="🔌 Connectors (scraping ready)">
            <div className="flex flex-wrap gap-1.5">
              {(connectors.data?.connectors || []).filter((c) => c.category === "scraping").map((c) => (
                <Chip key={c.id} on={s.connectors.includes(c.id)} onClick={() =>
                  setS({ ...s, connectors: s.connectors.includes(c.id) ? s.connectors.filter((x) => x !== c.id) : [...s.connectors, c.id] })}
                >{c.label}</Chip>
              ))}
            </div>
          </Field>

          <Field label="🧬 Skills">
            <div className="flex flex-wrap gap-1.5">
              {(skills.data?.skills || []).map((sk) => (
                <Chip key={sk.id} on={s.skills.includes(sk.id)} onClick={() =>
                  setS({ ...s, skills: s.skills.includes(sk.id) ? s.skills.filter((x) => x !== sk.id) : [...s.skills, sk.id] })}
                >{sk.label}</Chip>
              ))}
            </div>
          </Field>

          <Nav onBack={() => setLayer(2)} onNext={() => setLayer(4)} />
        </Card>
      )}

      {/* LAYER 4: ASK */}
      {layer === 4 && (
        <Card title="4. Ask — text + filters → AI enhancer">
          <textarea
            className="w-full border border-border rounded-lg p-3 text-sm min-h-[120px] resize-y"
            placeholder="Describe what you want..."
            value={s.freeText}
            onChange={(e) => setS({ ...s, freeText: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer mt-2 p-2 rounded-lg bg-seafoam/10 border border-emerald-500/20">
            <input type="checkbox" checked={s.enhance} onChange={(e) => setS({ ...s, enhance: e.target.checked })} />
            <span><strong>AI Prompt Enhancer</strong> — merges text + filters into one structured task</span>
          </label>
          <Nav
            onBack={() => setLayer(3)}
            extra={
              <Button onClick={run} disabled={running || enhancing || !s.freeText.trim()} className="gap-1.5">
                {enhancing || running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Compose &amp; Run
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}

// ── tiny presentational helpers ───────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-xl bg-card/70 backdrop-blur p-4">
      <div className="text-sm font-bold mb-3">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</div>
      {children}
    </div>
  );
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
        on
          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 font-semibold"
          : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >{on ? "✓ " : ""}{children}</button>
  );
}
function Nav({ onBack, onNext, extra }: { onBack?: () => void; onNext?: () => void; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between pt-3 mt-3 border-t border-dashed border-border">
      <div>{onBack && <Button variant="ghost" size="sm" onClick={onBack} className="gap-1"><ChevronLeft className="w-3.5 h-3.5" />Back</Button>}</div>
      <div className="flex gap-2">
        {extra}
        {onNext && <Button size="sm" onClick={onNext} className="gap-1">Next<ChevronRight className="w-3.5 h-3.5" /></Button>}
      </div>
    </div>
  );
}

