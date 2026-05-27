// §4A frontend — Data Seeder 4-phase wizard. Drives the real pipeline:
//   EVAL → APPROVE → HARVEST → ENRICH against /api/prosengine/seed/*.
import { useState } from "react";
import { Search, Check, Loader2, Globe, ListChecks, Download, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SeedPlan { entities: { type: string; count: number }[]; fields: { name: string; confidence: number }[]; pagesScanned: number; }

type Phase = "eval" | "approve" | "harvest" | "enrich" | "done";

export function SeederWizard() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("eval");
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState<number | null>(null);
  const [plan, setPlan] = useState<SeedPlan | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const post = async (path: string, body: any) => {
    const r = await fetch(`${BASE}/api/prosengine/seed/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${path} failed (${r.status})`);
    return r.json();
  };

  const runEval = async () => {
    if (!url.trim()) return;
    setBusy(true); setErr(null);
    try {
      const d = await post("eval", { url: url.trim() });
      setPlanId(d.planId); setPlan(d.seedPlan);
      setChosen(new Set((d.seedPlan?.fields ?? []).map((f: any) => f.name)));
      setPhase("approve");
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const runApprove = async () => {
    if (!planId) return;
    setBusy(true);
    try {
      await post("approve", { planId, approvedFields: [...chosen] });
      await post("harvest", { planId });
      setPhase("harvest");
      // poll rows
      const poll = setInterval(async () => {
        const r = await fetch(`${BASE}/api/prosengine/seed/rows?planId=${planId}`);
        if (r.ok) { const d = await r.json(); setRows(d.rows ?? []); if ((d.rows ?? []).length) { clearInterval(poll); setPhase("enrich"); } }
      }, 3000);
      setTimeout(() => clearInterval(poll), 60000);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const runEnrich = async () => {
    setBusy(true);
    try { await post("enrich", { stagingIds: rows.map((r) => r.id) }); setPhase("done"); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const stages: { id: Phase; label: string; icon: any }[] = [
    { id: "eval", label: "1 Scan", icon: Search },
    { id: "approve", label: "2 Approve", icon: ListChecks },
    { id: "harvest", label: "3 Harvest", icon: Download },
    { id: "enrich", label: "4 Enrich", icon: Sparkles },
  ];
  const phaseIdx = ["eval", "approve", "harvest", "enrich", "done"].indexOf(phase);

  return (
    <div className="surf p-5 rounded-xl">
      <div className="flex items-center gap-2 mb-4">
        <Globe className="w-4 h-4 text-[hsl(var(--ac))]" />
        <h2 className="font-display font-bold">Crawl & Seed — AI pipeline</h2>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {stages.map((s, i) => (
          <span key={s.id} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border ${i <= phaseIdx ? "bg-[hsl(var(--brand-mist))]/50 text-[hsl(var(--ac))] border-[hsl(var(--ac))]/30" : "text-muted-foreground border-border"}`}>
            <s.icon className="w-3 h-3" />{s.label}
          </span>
        ))}
      </div>

      {err && <div className="text-xs text-rose-500 mb-3">{err}</div>}

      {phase === "eval" && (
        <div className="space-y-3">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Seed URL</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://directory.example.sa/companies"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background/50 text-sm outline-none focus:border-[hsl(var(--ac))]" />
          <Button onClick={runEval} disabled={busy || !url.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Scan & map</Button>
        </div>
      )}

      {phase === "approve" && plan && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Scanned {plan.pagesScanned} page(s). Detected: {plan.entities.map((e) => `${e.count} ${e.type}`).join(", ") || "—"}. Pick fields to seed:</p>
          <div className="flex flex-wrap gap-2">
            {plan.fields.map((f) => {
              const on = chosen.has(f.name);
              return (
                <button key={f.name} onClick={() => setChosen((s) => { const n = new Set(s); on ? n.delete(f.name) : n.add(f.name); return n; })}
                  className={`px-2.5 py-1 rounded-full text-[11px] border ${on ? "bg-[hsl(var(--ac))] text-white border-[hsl(var(--ac))]" : "text-muted-foreground border-border"}`}>
                  {f.name} <span className="opacity-60">{f.confidence}%</span>
                </button>
              );
            })}
          </div>
          <Button onClick={runApprove} disabled={busy || chosen.size === 0}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve & Harvest ({chosen.size})</Button>
        </div>
      )}

      {phase === "harvest" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" /> Harvesting pages… ({rows.length} rows so far)</div>
      )}

      {phase === "enrich" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{rows.length} rows staged. Enrich + promote them?</p>
          <Button onClick={runEnrich} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Enrich {rows.length} rows</Button>
        </div>
      )}

      {phase === "done" && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 py-4"><Check className="w-4 h-4" /> Done — {rows.length} rows seeded + queued for enrichment.</div>
      )}
    </div>
  );
}
