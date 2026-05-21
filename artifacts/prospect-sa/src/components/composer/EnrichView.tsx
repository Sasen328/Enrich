/**
 * EnrichView — Stage 6. Split Leads / Companies enrichment tabs (per v8).
 * Different rules, different enrichment options, different gate verdicts.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, RefreshCw } from "lucide-react";

interface Props { onBack: () => void; onReset: () => void }

const LEAD_OPTS = [
  ["linkedin", "🔗 LinkedIn URL",     "Verified profile",  true],
  ["email",    "📧 Email",            "DNS+MX validated",  true],
  ["phone",    "📞 Phone",            "+966 / GCC",        false],
  ["bg",       "🎓 Background",        "Schools · jobs",   false],
  ["icp",      "🎯 ICP Score",        "Tier + reasoning",  false],
  ["activity", "📡 Activity",          "Recent posts",      false],
  ["outreach", "✉️ Outreach",          "Personalized Ar/En",false],
  ["title",    "🏷️ Title verify",     "Cross-source",      false],
] as const;

const CO_OPTS = [
  ["cr",     "🆔 CR number",        "Saudi MCI registry", true],
  ["lei",    "🏢 LEI / GLEIF",      "Legal Entity ID",     true],
  ["rev",    "💰 Revenue / capital", "Last 3 fiscal years", false],
  ["emp",    "👥 Employees",         "Verified band",       true],
  ["own",    "📅 Ownership",         "Founders · shareholders", false],
  ["fund",   "💵 Funding history",   "All rounds",          false],
  ["stack",  "🛠️ Tech stack",       "BuiltWith + jobs",    false],
  ["news",   "📰 News · signals",    "90-day mentions",     false],
] as const;

export function EnrichView({ onBack, onReset }: Props) {
  const [tab, setTab] = useState<"leads" | "co">("leads");
  const [leadOn, setLeadOn] = useState<Record<string, boolean>>(Object.fromEntries(LEAD_OPTS.map((o) => [o[0], o[3]])));
  const [coOn, setCoOn] = useState<Record<string, boolean>>(Object.fromEntries(CO_OPTS.map((o) => [o[0], o[3]])));
  const [pushResult, setPushResult] = useState<string | null>(null);

  async function apply() {
    setPushResult(null);
    const on = tab === "leads" ? Object.entries(leadOn).filter(([, v]) => v).map(([k]) => k) : Object.entries(coOn).filter(([, v]) => v).map(([k]) => k);
    setPushResult(`✓ Enriched ${on.length} field${on.length === 1 ? "" : "s"} per row`);
  }
  async function push() {
    setPushResult(`Gating ${tab}: dedup + validate + verify…`);
    await new Promise((r) => setTimeout(r, 800));
    setPushResult(tab === "leads"
      ? "✓ 4 pushed · ⚠ 1 unverified · 🛡 0 dup"
      : "✓ 4 pushed · 🛡 1 duplicate (CR match)"
    );
  }

  return (
    <div className="border border-border rounded-xl bg-card/70 p-4 space-y-3">
      <div className="text-sm font-bold flex items-center gap-2">🧪 Enrich · Route</div>

      <div className="flex gap-4 border-b border-border">
        <button onClick={() => setTab("leads")}
          className={`pb-2 px-1 text-sm font-semibold border-b-2 ${
            tab === "leads" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
          }`}>👤 Enrich Leads</button>
        <button onClick={() => setTab("co")}
          className={`pb-2 px-1 text-sm font-semibold border-b-2 ${
            tab === "co" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
          }`}>🏢 Enrich Companies</button>
      </div>

      <div className="text-xs text-muted-foreground bg-muted/30 border border-dashed border-border rounded p-2.5">
        {tab === "leads"
          ? <><strong>Lead enrichment rules</strong> · <code>POST /api/leads/enrich</code> · gate dedup+validate+verify · email threshold ≥75 · halt on title conflict</>
          : <><strong>Company enrichment rules</strong> · <code>POST /api/companies/enrich</code> · gate CR-dedup + GLEIF cross-check · SAR conversion · halt on CR conflict</>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(tab === "leads" ? LEAD_OPTS : CO_OPTS).map(([k, lbl, desc]) => {
          const on = tab === "leads" ? leadOn[k] : coOn[k];
          const toggle = () => tab === "leads" ? setLeadOn((s) => ({ ...s, [k]: !s[k] })) : setCoOn((s) => ({ ...s, [k]: !s[k] }));
          return (
            <button key={k} onClick={toggle}
              className={`text-left p-2.5 rounded-lg border transition-colors ${
                on ? "bg-emerald-500/12 border-emerald-500/40" : "bg-card border-border hover:border-primary/30"
              }`}>
              <div className="text-xs font-bold">{lbl}</div>
              <div className="text-[10px] text-muted-foreground">{desc}</div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 flex-wrap items-center bg-muted/20 border border-dashed border-border rounded p-2 text-xs">
        <strong>Gates:</strong>
        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 font-semibold">✓ pass</span>
        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 font-semibold">⚠ unverified</span>
        <span className="px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-700 font-semibold">🛡 dup</span>
        <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-700 font-semibold">✗ rejected</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={apply} className="bg-emerald-500 hover:bg-emerald-600 gap-1">🧪 Apply Enrichment</Button>
        <Button size="sm" onClick={push} variant="outline" className="gap-1">
          {tab === "leads" ? "📤 Push to Leads DB" : "🏢 Push to Companies DB"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset} className="ml-auto gap-1"><RefreshCw className="w-3 h-3" />New query</Button>
      </div>

      {pushResult && (
        <div className="text-xs p-2 bg-card border border-border rounded">{pushResult}</div>
      )}

      <div className="pt-3 border-t border-dashed border-border">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="w-3 h-3 mr-1" />Back to Report</Button>
      </div>
    </div>
  );
}
