import { useEffect, useRef, useState, useCallback } from "react";
import { Network, Activity, Clock, Zap, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SwarmAgent {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "error";
  startedAt?: string;
  endedAt?: string;
  description?: string;
  output?: string;
  error?: string;
}

interface SwarmRun {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  endedAt?: string;
  trigger: { type: string; userQuery?: string };
  agents: SwarmAgent[];
}

interface SwarmEvent {
  event: string;
  data: Record<string, unknown>;
  at?: string;
}

export default function SwarmPage() {
  const [runs, setRuns] = useState<SwarmRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<SwarmEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const selectedRun = runs.find((r) => r.id === selectedRunId);

  // Subscribe to global swarm SSE
  useEffect(() => {
    const es = new EventSource(`${BASE}/api/swarm/stream`);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        if (parsed.event === "init") {
          const initRuns = parsed.data?.activeRuns || [];
          setRuns((prev) => mergeRuns(prev, initRuns));
        } else if (parsed.event === "swarm_event") {
          const { runId, event } = parsed.data;
          setEvents((prev) => [...prev.slice(-100), { ...event, at: new Date().toISOString() }]);
          // Refresh runs list occasionally
          setRuns((prev) =>
            prev.map((r) =>
              r.id === runId
                ? { ...r, status: event.event === "final" ? "completed" : event.event === "error" ? "failed" : r.status }
                : r
            )
          );
        }
      } catch { /* skip malformed */ }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  // Fetch historical runs on mount
  useEffect(() => {
    fetch(`${BASE}/api/swarm/runs`)
      .then((r) => r.json())
      .then((data) => {
        if (data.runs) setRuns(data.runs.map((r: SwarmRun) => ({ ...r, agents: r.agents || [] })));
      })
      .catch(() => {});
  }, []);

  // Auto-select first run
  useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  const statusColor = (status: string) => {
    switch (status) {
      case "running": return "text-amber-400";
      case "completed": return "text-emerald-400";
      case "failed": return "text-red-400";
      default: return "text-muted-foreground";
    }
  };

  const statusBg = (status: string) => {
    switch (status) {
      case "running": return "bg-amber-500/10 border-amber-500/30";
      case "completed": return "bg-emerald-500/10 border-emerald-500/30";
      case "failed": return "bg-red-500/10 border-red-500/30";
      default: return "bg-muted/30 border-border/30";
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border/40 px-4 py-3 bar-bg sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            Agent Swarm
            <span className="text-[10px] font-normal text-muted-foreground ml-1">· Live orchestration dashboard</span>
          </h1>
          <div className="flex items-center gap-3">
            <div className={cn("flex items-center gap-1.5 text-[11px]", connected ? "text-emerald-400" : "text-red-400")}>
              <span className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-emerald-400 animate-pulse" : "bg-red-400")} />
              {connected ? "Live" : "Disconnected"}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] gap-1"
              onClick={() => {
                fetch(`${BASE}/api/swarm/runs`).then((r) => r.json()).then((d) => {
                  if (d.runs) setRuns(d.runs.map((r: SwarmRun) => ({ ...r, agents: r.agents || [] })));
                });
              }}
            >
              <Zap className="w-3 h-3" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Runs list */}
        <div className="w-72 border-r border-border/30 overflow-y-auto bg-card/30">
          <div className="p-3">
            <h2 className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-2">
              Active & Recent Runs
            </h2>
            <div className="space-y-1.5">
              {runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={cn(
                    "w-full text-left p-2.5 rounded-lg border transition-all",
                    selectedRunId === run.id
                      ? "border-primary/40 bg-primary/10"
                      : "border-border/20 hover:border-border/40 hover:bg-card/50"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground truncate">{run.id.slice(0, 16)}…</span>
                    <span className={cn("text-[10px] font-medium", statusColor(run.status))}>
                      {run.status}
                    </span>
                  </div>
                  <p className="text-xs text-foreground truncate mb-1">{run.trigger.userQuery || run.trigger.type}</p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {fmtTime(run.startedAt)}
                    {run.endedAt && (
                      <>
                        <ArrowRight className="w-2.5 h-2.5" />
                        {fmtDuration(run.startedAt, run.endedAt)}
                      </>
                    )}
                  </div>
                </button>
              ))}
              {runs.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-xs">
                  No runs yet. Start an AI Chat to see agents orchestrate live.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center: Agent topology */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedRun ? (
            <>
              <div className="px-4 py-3 border-b border-border/20">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">{selectedRun.trigger.userQuery || "Agent Run"}</h2>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                      <span className={cn("font-medium", statusColor(selectedRun.status))}>{selectedRun.status}</span>
                      <span>·</span>
                      <span>{selectedRun.agents?.length || 0} agents</span>
                      <span>·</span>
                      <span>{selectedRun.agents?.filter((a) => a.status === "done").length || 0} completed</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {selectedRun.status === "running" && (
                      <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {/* Agent cards grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                  {(selectedRun.agents || []).map((agent) => (
                    <AgentCard key={agent.id} agent={agent} />
                  ))}
                  {(selectedRun.agents || []).length === 0 && (
                    <div className="col-span-full text-center py-12 text-muted-foreground text-sm">
                      Agents will appear here as the orchestrator delegates tasks.
                    </div>
                  )}
                </div>

                {/* Event timeline */}
                <div className="border border-border/20 rounded-xl bg-card/30 p-3">
                  <h3 className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-2">
                    Event Stream
                  </h3>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {events
                      .filter((e) => e.event === "agent_start" || e.event === "agent_done" || e.event === "error")
                      .slice(-20)
                      .reverse()
                      .map((ev, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs p-1.5 rounded hover:bg-muted/20">
                          <EventBadge event={ev.event} />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{ev.data?.agent as string || ev.event}</span>
                            {ev.data?.description && (
                              <span className="text-muted-foreground ml-1">· {String(ev.data.description).slice(0, 60)}</span>
                            )}
                            {ev.data?.summary && (
                              <span className="text-muted-foreground ml-1">→ {String(ev.data.summary).slice(0, 60)}</span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            {ev.at ? fmtTime(ev.at) : "—"}
                          </span>
                        </div>
                      ))}
                    {events.length === 0 && (
                      <div className="text-center py-4 text-muted-foreground text-xs">No events yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <Activity className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Select a run to inspect agent topology</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: SwarmAgent }) {
  const statusConfig = {
    pending: { icon: "⏳", color: "text-muted-foreground", bg: "bg-muted/20", border: "border-border/20" },
    running: { icon: "▶️", color: "text-amber-400", bg: "bg-amber-500/5", border: "border-amber-500/20" },
    done: { icon: "✅", color: "text-emerald-400", bg: "bg-emerald-500/5", border: "border-emerald-500/20" },
    error: { icon: "❌", color: "text-red-400", bg: "bg-red-500/5", border: "border-red-500/20" },
  };
  const cfg = statusConfig[agent.status];

  return (
    <div className={cn("p-3 rounded-xl border transition-all", cfg.bg, cfg.border)}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm">{cfg.icon}</span>
        <span className={cn("text-xs font-semibold", cfg.color)}>{agent.name}</span>
        <span className={cn("text-[10px] ml-auto px-1.5 py-0.5 rounded-full bg-background/50", cfg.color)}>
          {agent.status}
        </span>
      </div>
      {agent.description && (
        <p className="text-[10px] text-muted-foreground mb-1">{agent.description}</p>
      )}
      {agent.output && (
        <p className="text-[10px] text-emerald-400/80 truncate">{agent.output}</p>
      )}
      {agent.error && (
        <p className="text-[10px] text-red-400/80 truncate">{agent.error}</p>
      )}
      {(agent.startedAt || agent.endedAt) && (
        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground/60 font-mono">
          {agent.startedAt && <span>{fmtTime(agent.startedAt)}</span>}
          {agent.startedAt && agent.endedAt && (
            <>
              <ArrowRight className="w-2.5 h-2.5" />
              <span>{fmtDuration(agent.startedAt, agent.endedAt)}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EventBadge({ event }: { event: string }) {
  const colors: Record<string, string> = {
    agent_start: "bg-amber-500/15 text-amber-400",
    agent_done: "bg-emerald-500/15 text-emerald-400",
    error: "bg-red-500/15 text-red-400",
    token: "bg-blue-500/15 text-blue-400",
    final: "bg-primary/15 text-primary",
  };
  return (
    <span className={cn("text-[9px] font-mono px-1 py-0.5 rounded", colors[event] || "bg-muted text-muted-foreground")}>
      {event}
    </span>
  );
}

function mergeRuns(prev: SwarmRun[], incoming: SwarmRun[]): SwarmRun[] {
  const map = new Map(prev.map((r) => [r.id, r]));
  for (const r of incoming) {
    const existing = map.get(r.id);
    if (existing) {
      map.set(r.id, { ...existing, ...r, agents: r.agents || existing.agents || [] });
    } else {
      map.set(r.id, { ...r, agents: r.agents || [] });
    }
  }
  return Array.from(map.values()).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fmtDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
