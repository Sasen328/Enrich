/**
 * BehaviorAgent — floating bottom-right panel that observes user actions and
 * offers a live suggestion based on the most recent state change.
 * Per v8 prototype: always-on, foldable, 10-event history.
 */

import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Bot, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ComposerState } from "./Composer";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PlugAction { label: string; endpoint: string; body?: Record<string, unknown>; }
interface BackendSuggestion { suggestion: string; oneLineHint: string; plugActions: PlugAction[]; }

interface Props {
  events: Array<{ kind: string; msg: string; t: Date }>;
  state: ComposerState | null;
  reportShape: "exec" | "detail" | "custom";
}

export function BehaviorAgent({ events, state, reportShape }: Props) {
  const [folded, setFolded] = useState(false);
  const [closed, setClosed] = useState(false);

  if (closed) {
    return (
      <button
        onClick={() => setClosed(false)}
        className="fixed bottom-5 right-5 z-30 bg-card border border-border rounded-full p-2.5 shadow-lg hover:border-primary/40"
        title="Open Behavior Agent"
      ><Bot className="w-4 h-4" /></button>
    );
  }

  return (
    <div className={`fixed bottom-5 right-5 z-30 w-[300px] max-h-[60vh] bg-card border border-border rounded-xl shadow-xl flex flex-col transition-transform ${folded ? "translate-y-[calc(100%-44px)]" : ""}`}>
      <button
        onClick={() => setFolded((f) => !f)}
        className="flex items-center gap-2 px-3 py-2.5 border-b border-border w-full"
      >
        <Bot className="w-4 h-4 text-primary" />
        <span className="font-bold text-sm">Behavior Agent</span>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <Button variant="ghost" size="sm" className="ml-auto h-6 px-1.5" onClick={(e) => { e.stopPropagation(); setClosed(true); }}><X className="w-3 h-3" /></Button>
        {folded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {!folded && (
        <div className="overflow-y-auto p-3 space-y-2 text-xs">
          <Suggestion events={events} state={state} reportShape={reportShape} />
          {events.length === 0 && <div className="text-muted-foreground italic">Make any selection to see suggestions.</div>}
          {events.map((e, i) => (
            <div key={i} className="bg-muted/30 border border-border rounded p-2">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{e.kind} · {new Date(e.t).toLocaleTimeString().slice(0, 8)}</div>
              <div className="mt-0.5">{e.msg}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Suggestion({ events, state, reportShape }: Props) {
  const last = events[0];
  // Local deterministic fallback (instant).
  let msg = "Pick a template to lock the loadout in one click.";
  if (last) {
    if (last.kind === "compose") msg = "Loadout looks good. Toggle Enhance ON for AI to add missing constraints.";
    else if (last.kind === "nav" && last.msg.includes("enrich")) msg = "After enrich, push the highest-tier rows to Leads automatically?";
    else if (state?.target === "both") msg = "Both targets active — enrich runs both lead + company gates separately.";
    else if (reportShape === "exec") msg = "Executive shape suppresses tables. If you need rows, switch to Detailed.";
  }

  // Backend enrichment: richer suggestion + ready-to-plug action chips.
  const [backend, setBackend] = useState<BackendSuggestion | null>(null);
  const [firing, setFiring] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${BASE}/api/behavior/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: { target: state?.target, reportShape }, history: events.slice(0, 5).map((e) => ({ kind: e.kind })) }),
      signal: ctrl.signal,
    }).then((r) => r.ok ? r.json() : null).then((d) => { if (d?.suggestion) setBackend(d); }).catch(() => {});
    return () => ctrl.abort();
  }, [events.length, state?.target, reportShape]);

  const fire = async (a: PlugAction) => {
    setFiring(a.label);
    try { await fetch(`${a.endpoint.startsWith("/api") ? "" : BASE}${a.endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a.body ?? {}) }); }
    catch { /* ignore */ }
    setTimeout(() => setFiring(null), 1200);
  };

  const text = backend?.suggestion || msg;
  return (
    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-emerald-700 font-bold">💡 Live suggestion</div>
      <div className="mt-1 text-emerald-900 dark:text-emerald-100">{text}</div>
      {backend?.plugActions?.length ? (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {backend.plugActions.map((a) => (
            <button key={a.label} onClick={() => fire(a)} disabled={!!firing}
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:opacity-60">
              <Zap className="w-2.5 h-2.5" />{firing === a.label ? "Running…" : a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
