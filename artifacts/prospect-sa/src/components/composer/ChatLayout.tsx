/**
 * ChatLayout — the full 6-stage composer experience from the v8 prototype.
 *   1. Compose  (already in Composer.tsx — embedded here)
 *   2. Enhance  (preview the enhanced prompt)
 *   3. Clarify  (report-shape + clarifying questions)
 *   4. Run      (agent stream)
 *   5. Report   (structured blocks + signal + tree)
 *   6. Enrich   (Leads / Companies split tabs)
 *
 * Top: MegaMindBanner + StageBar + HistoryBar
 * Floating: BehaviorAgent (bottom-right)
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, ChevronRight, History as HistoryIcon, Sparkles, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Composer, type ComposerState } from "./Composer";
import { ReportView } from "./ReportView";
import { ClarifyView } from "./ClarifyView";
import { EnrichView } from "./EnrichView";
import { BehaviorAgent } from "./BehaviorAgent";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type Stage = "compose" | "enhance" | "clarify" | "run" | "report" | "enrich";
const STAGES: { id: Stage; label: string }[] = [
  { id: "compose", label: "Compose" },
  { id: "enhance", label: "Enhance" },
  { id: "clarify", label: "Clarify" },
  { id: "run",     label: "Run" },
  { id: "report",  label: "Report" },
  { id: "enrich",  label: "Enrich" },
];

interface RunRow { id: number; state: ComposerState | Record<string, unknown>; reportShape: string; status: string; createdAt: string }

export default function ChatLayout() {
  const [stage, setStage] = useState<Stage>("compose");
  const [reached, setReached] = useState<Set<Stage>>(new Set(["compose"]));
  const [state, setState] = useState<ComposerState | null>(null);
  const [enhancedPrompt, setEnhancedPrompt] = useState("");
  const [reportShape, setReportShape] = useState<"exec" | "detail" | "custom">("detail");
  const [reportBlocks, setReportBlocks] = useState<string[]>([]);
  const [rawAnswer, setRawAnswer] = useState("");
  const [parsedBlocks, setParsedBlocks] = useState<Array<Record<string, unknown>> | null>(null);
  const [behaviorLog, setBehaviorLog] = useState<Array<{ kind: string; msg: string; t: Date }>>([]);

  function logBehavior(kind: string, msg: string) {
    setBehaviorLog((prev) => [{ kind, msg, t: new Date() }, ...prev].slice(0, 10));
  }
  function goto(s: Stage) {
    setReached((r) => new Set([...r, s]));
    setStage(s);
    logBehavior("nav", `Stage → ${s}`);
  }

  // Mega-mind banner — live route summary
  const megaMind = state
    ? `route → ${state.target} · ${state.countries.join(",")} · ${state.industry} · modes ${state.modes.join("+")} · report ${reportShape}`
    : "Watching your selections · build a route below";

  // History
  const history = useQuery<{ runs: RunRow[] }>({
    queryKey: ["/api/composer/runs"],
    queryFn: () => fetch(`${BASE}/api/composer/runs?limit=3`).then((r) => r.json()),
    refetchOnMount: true,
  });

  return (
    <div className="space-y-3 pb-24">
      {/* Mega-mind banner */}
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-gradient-to-r from-primary/8 via-emerald-500/8 to-amber-500/8">
        <Brain className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide">Mega-mind orchestrator</div>
          <div className="text-xs font-mono text-muted-foreground truncate" title={megaMind}>{megaMind}</div>
        </div>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      </div>

      {/* Stage bar */}
      <div className="flex items-center gap-1 bg-card border border-border rounded-full p-1 overflow-x-auto">
        {STAGES.map((s, i) => (
          <button
            key={s.id}
            onClick={() => reached.has(s.id) && goto(s.id)}
            disabled={!reached.has(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              stage === s.id ? "bg-primary/15 text-primary ring-1 ring-primary/40"
              : reached.has(s.id) ? "text-emerald-600 hover:bg-emerald-500/10 cursor-pointer"
              : "text-muted-foreground cursor-not-allowed opacity-50"
            }`}
          >
            <span className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[9px] ${
              stage === s.id ? "bg-primary text-primary-foreground"
              : reached.has(s.id) ? "bg-emerald-500 text-white"
              : "bg-muted"
            }`}>{i + 1}</span>
            {s.label}
            {i < STAGES.length - 1 && <ChevronRight className="w-3 h-3 opacity-40" />}
          </button>
        ))}
      </div>

      {/* Strict contract banner */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20 text-xs">
        <Lock className="w-3.5 h-3.5 text-emerald-500" />
        <span><strong>Strict Input Contract</strong> — every selection is honored; halt-and-ask on conflict; cite every claim.</span>
      </div>

      {/* History */}
      {history.data?.runs && history.data.runs.length > 0 && stage === "compose" && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <HistoryIcon className="w-3 h-3" /> Recent runs
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {history.data.runs.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setRawAnswer("");
                  setState(r.state as ComposerState);
                  setReportShape((r.reportShape as "exec" | "detail" | "custom") || "detail");
                  goto("report");
                }}
                className="text-left text-xs p-2 rounded-lg border border-border bg-card/40 hover:border-primary/30"
              >
                <div className="text-[10px] text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</div>
                <div className="font-semibold text-foreground truncate mt-0.5">
                  {(r.state as { industry?: string })?.industry || "—"} · {(r.state as { freeText?: string })?.freeText?.slice(0, 60) || "—"}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">Shape: {r.reportShape} · {r.status}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STAGE CONTENT */}
      {stage === "compose" && (
        <Composer
          onRun={async ({ enhancedPrompt: ep, state: s }) => {
            setState(s);
            setEnhancedPrompt(ep);
            logBehavior("compose", "Loadout built");
            // If enhancer was on, go to enhance preview; otherwise to clarify
            goto(s.enhance ? "enhance" : "clarify");
          }}
        />
      )}

      {stage === "enhance" && (
        <div className="border border-border rounded-xl bg-card/60 p-4">
          <div className="text-sm font-bold mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" /> Enhanced Prompt
          </div>
          <pre className="text-xs bg-muted/30 border border-border rounded p-3 whitespace-pre-wrap font-mono">{enhancedPrompt}</pre>
          <div className="flex justify-between mt-3 pt-3 border-t border-dashed border-border">
            <Button variant="ghost" size="sm" onClick={() => goto("compose")}>← Compose</Button>
            <Button size="sm" onClick={() => goto("clarify")}>Continue: Clarify →</Button>
          </div>
        </div>
      )}

      {stage === "clarify" && (
        <ClarifyView
          state={state}
          reportShape={reportShape}
          onShapeChange={setReportShape}
          reportBlocks={reportBlocks}
          onBlocksChange={setReportBlocks}
          onBack={() => goto(state?.enhance ? "enhance" : "compose")}
          onRun={async () => {
            goto("run");
            // Fire SSE
            await runAgent(enhancedPrompt, (delta) => setRawAnswer((p) => p + delta), () => goto("report"));
          }}
        />
      )}

      {stage === "run" && (
        <div className="border border-border rounded-xl bg-card/60 p-4">
          <div className="text-sm font-bold mb-3 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-primary animate-pulse" /> Agents working
          </div>
          <pre className="text-xs whitespace-pre-wrap font-mono max-h-96 overflow-y-auto bg-muted/20 border border-border rounded p-3">{rawAnswer || "Streaming..."}</pre>
          <div className="flex justify-between mt-3 pt-3 border-t border-dashed border-border">
            <Button variant="ghost" size="sm" onClick={() => goto("clarify")}>← Clarify</Button>
            {rawAnswer && <Button size="sm" onClick={async () => {
              const r = await fetch(`${BASE}/api/composer/render-blocks`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rawText: rawAnswer, shape: reportShape }),
              });
              const data = await r.json();
              setParsedBlocks(data.blocks);
              goto("report");
            }}>Continue: Report →</Button>}
          </div>
        </div>
      )}

      {stage === "report" && (
        <div className="border border-border rounded-xl bg-card/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold">Report</div>
            <Button variant="ghost" size="sm" onClick={() => goto("enrich")}>Continue: Enrich →</Button>
          </div>
          <ReportView
            blocks={(parsedBlocks as Parameters<typeof ReportView>[0]["blocks"]) || []}
            rawText={rawAnswer}
            shape={reportShape}
            title="Research Report"
          />
        </div>
      )}

      {stage === "enrich" && (
        <EnrichView
          onBack={() => goto("report")}
          onReset={() => { setStage("compose"); setReached(new Set(["compose"])); setRawAnswer(""); setParsedBlocks(null); }}
        />
      )}

      {/* Behavior agent — always-on floating panel */}
      <BehaviorAgent events={behaviorLog} state={state} reportShape={reportShape} />
    </div>
  );
}

// ── stream helper ────────────────────────────────────────────────────────────
async function runAgent(prompt: string, onToken: (s: string) => void, onDone: () => void): Promise<void> {
  try {
    const r = await fetch(`${BASE}/api/ai-chat/stream`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt, history: [] }),
    });
    if (!r.body) throw new Error("No stream");
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5).trim());
          if (j.event === "token" || j.event === "chunk") onToken(typeof j.data === "string" ? j.data : j.data?.text || "");
          else if (j.event === "final" || j.event === "reply") onToken(typeof j.data === "string" ? j.data : j.data?.reply || "");
          else if (j.event === "agent_start") onToken(`\n\n[${j.data?.agent || "agent"}] ${j.data?.description || ""}\n`);
        } catch { /* skip */ }
      }
    }
  } finally { onDone(); }
}
