import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Boxes, Rocket, Loader2, CheckCircle2, Circle, Activity, RotateCcw,
  Clock, Database, Gauge, X,
} from "lucide-react";
import { SWARM_AGENTS, AGENT_BY_ID, CATEGORY_COLOR, type SwarmAgent } from "@/data/swarmAgents";
import { SWARM_QUESTIONS, EVAL_STEPS, evaluateSwarm } from "@/data/swarmQuestions";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Phase = "wizard" | "evaluating" | "execute" | "report";
interface FeedItem { ts: string; agent: string; text: string; done?: boolean }
type NodeState = "pending" | "active" | "done";

export default function SwarmBoardPage() {
  const [phase, setPhase] = useState<Phase>("wizard");
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [agentIds, setAgentIds] = useState<string[]>([]);

  function toggle(qid: string, oid: string, multi: boolean) {
    setAnswers((prev) => {
      const cur = prev[qid] || [];
      if (multi) {
        return { ...prev, [qid]: cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid] };
      }
      return { ...prev, [qid]: cur.includes(oid) ? [] : [oid] };
    });
  }

  const previewAgents = useMemo(() => evaluateSwarm(answers), [answers]);
  const canLaunch = (answers.goal?.length ?? 0) > 0;

  function launch() {
    const ids = evaluateSwarm(answers);
    setAgentIds(ids.length ? ids : SWARM_AGENTS.slice(0, 5).map((a) => a.id));
    setPhase("evaluating");
  }

  function reset() {
    setAnswers({});
    setAgentIds([]);
    setPhase("wizard");
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <header className="border-b border-border/40 px-5 py-3 bar-bg sticky top-0 z-10 flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl brand-gradient flex items-center justify-center text-foreground">
          <Boxes className="w-4 h-4" />
        </span>
        <div>
          <h1 className="text-lg font-display font-bold leading-tight">SwarmBoard</h1>
          <p className="text-[10px] text-muted-foreground">Mission Control · Kimi-coordinated agent swarm</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {(["wizard", "evaluating", "execute", "report"] as Phase[]).map((p, i) => (
            <span key={p} className={cn("px-2 py-0.5 rounded-full border",
              phase === p ? "border-primary text-primary bg-primary/10" : "border-border/40")}>
              {i + 1}
            </span>
          ))}
        </div>
      </header>

      <div className="flex-1 p-5">
        <AnimatePresence mode="wait">
          {phase === "wizard" && (
            <Wizard key="wizard" answers={answers} toggle={toggle} previewAgents={previewAgents}
              canLaunch={canLaunch} onLaunch={launch} />
          )}
          {phase === "evaluating" && (
            <Evaluating key="eval" count={agentIds.length} onDone={() => setPhase("execute")} />
          )}
          {phase === "execute" && (
            <Execute key="exec" agentIds={agentIds} answers={answers}
              onDone={() => setPhase("report")} />
          )}
          {phase === "report" && (
            <Report key="report" agentIds={agentIds} onReset={reset} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Phase 1: Q&A Wizard ───────────────────────────────────────────────────────
function Wizard(props: {
  answers: Record<string, string[]>;
  toggle: (q: string, o: string, multi: boolean) => void;
  previewAgents: string[];
  canLaunch: boolean;
  onLaunch: () => void;
}) {
  const { answers, toggle, previewAgents, canLaunch, onLaunch } = props;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="max-w-3xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-display font-bold">Configure your swarm</h2>
        <p className="text-sm text-muted-foreground mt-1">Answer a few questions — we'll assemble the right agents.</p>
      </div>

      {SWARM_QUESTIONS.map((q) => (
        <div key={q.id} className="surf rounded-2xl p-4">
          <div className="text-sm font-semibold mb-3">{q.question}
            {q.multi && <span className="text-[10px] text-muted-foreground ml-2 font-normal">select any</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {q.options.map((o) => {
              const on = (answers[q.id] || []).includes(o.id);
              return (
                <button key={o.id} onClick={() => toggle(q.id, o.id, q.multi)}
                  className={cn("px-3 py-1.5 rounded-full text-xs border transition-colors",
                    on ? "bg-primary text-primary-foreground border-primary"
                       : "border-border/50 hover:border-primary/40 text-muted-foreground")}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="surf rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">Swarm preview</span>
          <span className="text-xs text-muted-foreground">{previewAgents.length} agents</span>
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {previewAgents.length === 0 && <span className="text-xs text-muted-foreground">Pick a research goal to assemble agents…</span>}
          {previewAgents.map((id) => {
            const a = AGENT_BY_ID[id];
            return (
              <span key={id} className="px-2 py-1 rounded-md text-[10px] font-mono font-medium text-white"
                style={{ background: CATEGORY_COLOR[a.category] }}>{a.name}</span>
            );
          })}
        </div>
      </div>

      <div className="flex justify-center">
        <button onClick={onLaunch} disabled={!canLaunch}
          className={cn("inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition",
            canLaunch ? "brand-gradient text-foreground hover:opacity-90" : "bg-muted text-muted-foreground cursor-not-allowed")}>
          <Rocket className="w-4 h-4" /> Launch Swarm
        </button>
      </div>
    </motion.div>
  );
}

// ── Phase 2: Evaluating ───────────────────────────────────────────────────────
function Evaluating({ count, onDone }: { count: number; onDone: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const per = 3500 / EVAL_STEPS.length;
    const timers = EVAL_STEPS.map((_, i) => setTimeout(() => setStep(i + 1), per * (i + 1)));
    const done = setTimeout(onDone, 3600);
    return () => { timers.forEach(clearTimeout); clearTimeout(done); };
  }, [onDone]);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="max-w-md mx-auto pt-16 text-center space-y-6">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
        className="w-16 h-16 mx-auto rounded-2xl brand-gradient flex items-center justify-center text-foreground">
        <Boxes className="w-7 h-7" />
      </motion.div>
      <h2 className="text-xl font-display font-bold">Assembling {count}-agent swarm…</h2>
      <div className="space-y-2 text-left">
        {EVAL_STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2 text-sm">
            {i < step ? <CheckCircle2 className="w-4 h-4 text-primary" />
              : i === step ? <Loader2 className="w-4 h-4 animate-spin text-primary" />
              : <Circle className="w-4 h-4 text-muted-foreground/40" />}
            <span className={i <= step ? "text-foreground" : "text-muted-foreground"}>{s}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Phase 3: Live Orbit Execution ─────────────────────────────────────────────
function Execute({ agentIds, answers, onDone }: {
  agentIds: string[]; answers: Record<string, string[]>; onDone: () => void;
}) {
  const agents = agentIds.map((id) => AGENT_BY_ID[id]).filter(Boolean) as SwarmAgent[];
  const [states, setStates] = useState<Record<string, NodeState>>(
    () => Object.fromEntries(agents.map((a) => [a.id, "pending" as NodeState])));
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [selected, setSelected] = useState<SwarmAgent | null>(null);
  const reportRef = useRef("");
  const startedAt = useRef(Date.now());
  const finished = useRef(false);

  const pushFeed = (agent: string, text: string, done?: boolean) =>
    setFeed((f) => [{ ts: new Date().toLocaleTimeString(), agent, text, done }, ...f].slice(0, 50));

  useEffect(() => {
    // Animate orbit nodes pending → active → done across the run.
    let i = 0;
    const ramp = setInterval(() => {
      if (i >= agents.length) { clearInterval(ramp); return; }
      const a = agents[i];
      setStates((s) => ({ ...s, [a.id]: "active" }));
      const idx = i;
      setTimeout(() => setStates((s) => ({ ...s, [agents[idx].id]: "done" })), 1400);
      i++;
      setProgress(Math.round((i / Math.max(agents.length, 1)) * 100));
    }, 900);

    // Real swarm run over SSE.
    const controller = new AbortController();
    const brief = buildBrief(answers, agents);
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/swarm/start`, {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief, useKimi: true }),
        });
        if (!res.body) throw new Error("no stream");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const p = line.slice(5).trim(); if (!p) continue;
            try {
              const { event, data } = JSON.parse(p);
              if (event === "agent_start") pushFeed(data.agent || "Agent", data.description || "working…");
              else if (event === "agent_done") pushFeed(data.agent || "Agent", data.summary || "done", true);
              else if (event === "intent") pushFeed("🧠 Coordinator", String(data.plan || ""));
              else if (event === "token") reportRef.current += typeof data === "string" ? data : "";
              else if (event === "final") reportRef.current = (data?.text) || reportRef.current;
              else if (event === "error") pushFeed("⚠ Error", String(data?.message || ""), true);
            } catch { /* skip */ }
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) pushFeed("⚠ Error", e instanceof Error ? e.message : String(e), true);
      } finally {
        if (!finished.current) {
          finished.current = true;
          setStates((s) => Object.fromEntries(Object.keys(s).map((k) => [k, "done" as NodeState])));
          setProgress(100);
          sessionStorage.setItem("swarm:report", reportRef.current);
          sessionStorage.setItem("swarm:elapsed", String(Date.now() - startedAt.current));
          setTimeout(onDone, 1200);
        }
      }
    })();

    return () => { clearInterval(ramp); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = Object.values(states).filter((s) => s === "done").length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="grid lg:grid-cols-[1fr_360px] gap-5 max-w-6xl mx-auto">
      {/* Orbit */}
      <div className="surf rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold flex items-center gap-1.5"><Activity className="w-4 h-4 text-primary" /> Live Orbit</span>
          <span className="text-xs text-muted-foreground">{doneCount}/{agents.length} complete</span>
        </div>
        <div className="relative mx-auto" style={{ width: 360, height: 360 }}>
          <div className="absolute inset-0 m-auto w-20 h-20 rounded-full brand-gradient flex items-center justify-center text-foreground text-[10px] font-bold text-center leading-tight">
            SWARM<br />CORE
          </div>
          {agents.map((a, i) => {
            const ang = (i / agents.length) * 2 * Math.PI - Math.PI / 2;
            const r = 150;
            const x = 180 + r * Math.cos(ang), y = 180 + r * Math.sin(ang);
            const st = states[a.id];
            return (
              <button key={a.id} onClick={() => setSelected(a)}
                className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-110"
                style={{ left: x, top: y }} title={a.name}>
                <span className={cn("flex items-center justify-center rounded-full text-[8px] font-mono font-bold text-white border-2 transition-all",
                  st === "active" ? "w-12 h-12 animate-pulse border-white shadow-lg" : st === "done" ? "w-10 h-10 border-white/80" : "w-10 h-10 border-transparent opacity-50")}
                  style={{ background: CATEGORY_COLOR[a.category] }}>
                  {a.name.split(" ")[0].slice(0, 6)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <motion.div className="h-full brand-gradient" animate={{ width: `${progress}%` }} />
          </div>
          <div className="text-[10px] text-muted-foreground mt-1 text-center">{progress}% · throughput ~{Math.max(1, doneCount * 7)} rec/s</div>
        </div>
      </div>

      {/* Activity feed */}
      <div className="surf rounded-2xl p-4 flex flex-col">
        <span className="text-sm font-semibold mb-2">Activity feed</span>
        <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[360px] text-[11px]">
          {feed.length === 0 && <div className="text-muted-foreground">Waiting for the coordinator…</div>}
          {feed.map((f, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-muted-foreground font-mono text-[9px] mt-0.5 shrink-0">{f.ts}</span>
              <span className={cn("font-medium shrink-0", f.done ? "text-primary" : "text-foreground")}>{f.agent}</span>
              <span className="text-muted-foreground truncate">· {f.text}</span>
            </div>
          ))}
        </div>
      </div>

      {selected && <AgentDrawer agent={selected} state={states[selected.id]} onClose={() => setSelected(null)} />}
    </motion.div>
  );
}

function AgentDrawer({ agent, state, onClose }: { agent: SwarmAgent; state: NodeState; onClose: () => void }) {
  return (
    <motion.div initial={{ x: 360 }} animate={{ x: 0 }} exit={{ x: 360 }}
      className="fixed right-0 top-0 bottom-0 w-80 surf-strong border-l border-border/40 z-50 p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <span className="px-2 py-1 rounded-md text-[10px] font-mono font-bold text-white" style={{ background: CATEGORY_COLOR[agent.category] }}>{agent.name}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <div className="text-xs text-muted-foreground mb-1">{agent.role} · {agent.category}</div>
      <p className="text-xs mb-4">{agent.description}</p>
      <div className="text-[11px] font-semibold mb-1.5">Tools used</div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {agent.tools.map((t) => <span key={t} className="px-2 py-0.5 rounded-md text-[10px] bg-primary/10 text-primary border border-primary/20">{t}</span>)}
      </div>
      <div className="text-[11px] font-semibold mb-1.5">Status</div>
      <div className={cn("text-xs", state === "done" ? "text-primary" : state === "active" ? "text-amber-500" : "text-muted-foreground")}>
        {state === "done" ? "✓ Completed" : state === "active" ? "● Running…" : "○ Pending"}
      </div>
    </motion.div>
  );
}

// ── Phase 4: Visual Report ────────────────────────────────────────────────────
function Report({ agentIds, onReset }: { agentIds: string[]; onReset: () => void }) {
  const report = sessionStorage.getItem("swarm:report") || "";
  const elapsed = Number(sessionStorage.getItem("swarm:elapsed") || 0);
  const agents = agentIds.map((id) => AGENT_BY_ID[id]).filter(Boolean) as SwarmAgent[];
  const stats = [
    { ico: <Boxes className="w-4 h-4" />, label: "Agents", value: String(agents.length) },
    { ico: <Database className="w-4 h-4" />, label: "Report", value: `${report.length.toLocaleString()} ch` },
    { ico: <Clock className="w-4 h-4" />, label: "Time", value: `${(elapsed / 1000).toFixed(1)}s` },
    { ico: <Gauge className="w-4 h-4" />, label: "Success", value: report.length > 100 ? "100%" : "—" },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-bold">Swarm report</h2>
        <button onClick={onReset} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border border-border/50 hover:border-primary/40">
          <RotateCcw className="w-4 h-4" /> Run new swarm
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="surf rounded-2xl p-4">
            <div className="text-primary mb-1">{s.ico}</div>
            <div className="text-xl font-display font-bold">{s.value}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="surf rounded-2xl p-4">
        <div className="text-sm font-semibold mb-2">Agents engaged</div>
        <div className="flex flex-wrap gap-1.5">
          {agents.map((a) => (
            <span key={a.id} className="px-2 py-1 rounded-md text-[10px] font-mono font-medium text-white" style={{ background: CATEGORY_COLOR[a.category] }}>{a.name}</span>
          ))}
        </div>
      </div>

      <div className="surf rounded-2xl p-4">
        <div className="text-sm font-semibold mb-2">Fused report</div>
        {report ? (
          <pre className="whitespace-pre-wrap text-[12px] leading-relaxed font-sans text-foreground/90">{report}</pre>
        ) : (
          <div className="text-xs text-muted-foreground">No report text returned — set a NEXUS provider key (OPENROUTER_API_KEY / GROQ_API_KEY / GEMINI_API_KEY) to get live output.</div>
        )}
      </div>
    </motion.div>
  );
}

// ── helper: turn answers into a natural-language brief for the swarm ──────────
function buildBrief(answers: Record<string, string[]>, agents: SwarmAgent[]): string {
  const labelOf = (qid: string) => {
    const q = SWARM_QUESTIONS.find((x) => x.id === qid);
    return (answers[qid] || []).map((oid) => q?.options.find((o) => o.id === oid)?.label).filter(Boolean).join(", ");
  };
  const parts = [
    labelOf("goal") && `Goal: ${labelOf("goal")}`,
    labelOf("sources") && `Sources: ${labelOf("sources")}`,
    labelOf("output") && `Output: ${labelOf("output")}`,
    labelOf("scale") && `Scale: ${labelOf("scale")}`,
  ].filter(Boolean);
  return `Saudi Arabia / GCC B2B intelligence task. ${parts.join(". ")}. ` +
    `Coordinate these engines: ${agents.map((a) => a.name).join(", ")}.`;
}
