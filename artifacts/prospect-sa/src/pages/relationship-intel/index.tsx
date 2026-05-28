import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Network, Loader2, Building2, User, Mail, Phone, Globe,
  Sparkles, X, Users, GitFork, CheckCircle2, AlertCircle,
  Copy, Check, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LeadFactoryTabs } from "@/components/lead-factory/LeadFactoryTabs";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgNode {
  id: string;
  type: string;
  nameEn: string;
  nameAr?: string;
  title?: string;
  seniority?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
}

interface OutreachContact {
  rank: number;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  outreachEmail?: string;
  outreachLinkedin?: string;
  whatsappOpener?: string;
  conversationHook?: string;
  culturalNote?: string;
}

interface AgentState {
  status: "idle" | "running" | "complete" | "error";
  label: string;
  log: string[];
  progress?: { current: number; total: number };
  count?: number;
}

interface RelBrief {
  targetCompanyName: string;
  targetCompanyNameAr?: string;
  targetCrNumber?: string;
  targetWebsite?: string;
  context?: string;
  outputDepth?: "basic" | "deep";
}

interface AgentEvent {
  type: string;
  agent?: number;
  message?: string;
  current?: number;
  total?: number;
  count?: number;
  node?: OrgNode;
  contact?: OutreachContact;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AGENT_LABELS: Record<number, string> = {
  1: "Org Mapper",
  2: "Stakeholder Enricher",
  3: "Network Expander",
  4: "Outreach Sequencer",
};

const AGENT_ICONS: Record<number, React.ReactNode> = {
  1: <Building2 className="w-4 h-4" />,
  2: <User className="w-4 h-4" />,
  3: <Network className="w-4 h-4" />,
  4: <Sparkles className="w-4 h-4" />,
};

function seniorityTier(n: OrgNode): number {
  const s = (n.seniority || "").toLowerCase();
  if (s.includes("ceo") || s.includes("coo") || s.includes("cfo") || s.includes("cto") || s === "c-suite") return 0;
  if (s.includes("board") || s.includes("chairman")) return 1;
  if (s.includes("vp") || s.includes("vice president")) return 2;
  if (s.includes("director")) return 3;
  if (s.includes("manager")) return 4;
  if (s.includes("senior")) return 5;
  return 6;
}

// ── OrgTree SVG ────────────────────────────────────────────────────────────────

function OrgTree({ nodes }: { nodes: OrgNode[] }) {
  if (nodes.length === 0) return null;

  const tierMap = new Map<number, OrgNode[]>();
  for (const n of nodes) {
    const t = seniorityTier(n);
    if (!tierMap.has(t)) tierMap.set(t, []);
    tierMap.get(t)!.push(n);
  }
  const tiers = Array.from(tierMap.entries()).sort((a, b) => a[0] - b[0]);

  const NODE_W = 140, NODE_H = 56, H_GAP = 14, V_GAP = 44;
  const svgWidth = Math.max(...tiers.map(([, ns]) => ns.length * (NODE_W + H_GAP) - H_GAP)) + 40;
  const svgHeight = tiers.length * (NODE_H + V_GAP) + 20;

  const tierColors: Record<number, string> = {
    0: "hsl(263,70%,60%)",
    1: "hsl(263,60%,70%)",
    2: "hsl(200,80%,55%)",
    3: "hsl(200,70%,65%)",
    4: "hsl(160,60%,50%)",
    5: "hsl(38,80%,55%)",
    6: "hsl(220,14%,50%)",
  };

  const tierPositions: { tier: number; nodes: { node: OrgNode; cx: number; cy: number }[] }[] = [];
  let y = 30;
  for (const [tier, ns] of tiers) {
    const totalW = ns.length * NODE_W + (ns.length - 1) * H_GAP;
    let x = (svgWidth - totalW) / 2;
    const positioned = ns.map(node => {
      const cx = x + NODE_W / 2;
      const cy = y + NODE_H / 2;
      x += NODE_W + H_GAP;
      return { node, cx, cy };
    });
    tierPositions.push({ tier, nodes: positioned });
    y += NODE_H + V_GAP;
  }

  const color = (tier: number) => tierColors[tier] || "hsl(220,14%,50%)";

  return (
    <div className="overflow-x-auto rounded-xl bg-white/3 border border-white/8 p-4">
      <svg width={svgWidth} height={svgHeight} className="mx-auto">
        {/* Connecting lines */}
        {tierPositions.slice(0, -1).map(({ nodes: parentNodes }, ti) => {
          const childTier = tierPositions[ti + 1];
          if (!childTier) return null;
          return parentNodes.flatMap(({ cx: px, cy: py }) =>
            childTier.nodes.map(({ cx: cx2, cy: cy2 }, ci) => (
              <line key={`line-${ti}-${ci}`}
                x1={px} y1={py + NODE_H / 2} x2={cx2} y2={cy2 - NODE_H / 2}
                stroke="hsla(220,14%,50%,0.4)" strokeWidth={1} strokeDasharray="4 4" />
            ))
          );
        })}
        {/* Nodes */}
        {tierPositions.map(({ tier, nodes: ns }) =>
          ns.map(({ node, cx, cy }) => (
            <g key={node.id || node.nameEn} transform={`translate(${cx - NODE_W / 2}, ${cy - NODE_H / 2})`}>
              <rect width={NODE_W} height={NODE_H} rx={8}
                fill={`${color(tier)}22`} stroke={color(tier)} strokeWidth={1.5} />
              <text x={NODE_W / 2} y={18} textAnchor="middle" fill="white"
                fontSize={10} fontWeight="600" className="select-none">
                {node.nameEn.length > 18 ? node.nameEn.slice(0, 17) + "…" : node.nameEn}
              </text>
              {node.nameAr && (
                <text x={NODE_W / 2} y={29} textAnchor="middle" fill="hsla(263,50%,80%,0.8)"
                  fontSize={8} className="select-none">
                  {node.nameAr.length > 16 ? node.nameAr.slice(0, 15) + "…" : node.nameAr}
                </text>
              )}
              {node.title && (
                <text x={NODE_W / 2} y={node.nameAr ? 40 : 31} textAnchor="middle" fill="hsla(220,15%,65%,1)"
                  fontSize={8} className="select-none">
                  {node.title.length > 22 ? node.title.slice(0, 21) + "…" : node.title}
                </text>
              )}
              {/* Contact dots */}
              <g transform={`translate(${NODE_W / 2 - 16}, ${NODE_H - 10})`}>
                {node.email    && <circle cx={0}  cy={0} r={4} fill="hsl(263,70%,70%)" opacity={0.9} />}
                {node.phone    && <circle cx={10} cy={0} r={4} fill="hsl(200,80%,60%)" opacity={0.9} />}
                {node.linkedin && <circle cx={20} cy={0} r={4} fill="hsl(240,60%,65%)" opacity={0.9} />}
              </g>
            </g>
          ))
        )}
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 justify-center">
        {tiers.map(([tier, ns]) => (
          <div key={tier} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-full" style={{ background: color(tier) }} />
            {ns[0]?.seniority || `Level ${tier}`} ({ns.length})
          </div>
        ))}
        <div className="flex items-center gap-2 ml-3 pl-3 border-l border-border/40">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><div className="w-2 h-2 rounded-full bg-primary" />Email</div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><div className="w-2 h-2 rounded-full" style={{background:"hsl(200,80%,60%)"}} />Phone</div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><div className="w-2 h-2 rounded-full" style={{background:"hsl(240,60%,65%)"}} />LinkedIn</div>
        </div>
      </div>
    </div>
  );
}

// ── Agent Card ─────────────────────────────────────────────────────────────────

function AgentCard({ agentNum, state }: { agentNum: number; state: AgentState }) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.log]);

  const statusColor = {
    idle:     "border-border/30 bg-card/65",
    running:  "border-primary/30 bg-primary/5",
    complete: "border-emerald-500/30 bg-emerald-500/5",
    error:    "border-red-500/30 bg-red-500/5",
  }[state.status];

  const statusIcon = {
    idle:     <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />,
    running:  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />,
    complete: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
    error:    <AlertCircle className="w-3.5 h-3.5 text-red-400" />,
  }[state.status];

  return (
    <div className={cn("rounded-xl border p-4 transition-all", statusColor)}>
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center",
          state.status === "running" ? "bg-primary/20 text-primary" :
          state.status === "complete" ? "bg-emerald-500/20 text-emerald-400" :
          "bg-muted/40 text-muted-foreground")}>
          {AGENT_ICONS[agentNum]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {statusIcon}
            <span className="text-xs font-semibold text-foreground">{state.label}</span>
            {state.count !== undefined && (
              <span className="text-[10px] text-muted-foreground ml-auto">{state.count} found</span>
            )}
          </div>
          {state.progress && (
            <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${(state.progress.current / state.progress.total) * 100}%` }} />
            </div>
          )}
        </div>
      </div>
      {state.log.length > 0 && (
        <div ref={logRef} className="max-h-16 overflow-y-auto space-y-0.5 mt-1">
          {state.log.slice(-5).map((msg, i) => (
            <p key={i} className="text-[10px] text-muted-foreground leading-relaxed">{msg}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Outreach contact card ──────────────────────────────────────────────────────

function ContactCard({ contact }: { contact: OutreachContact }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="glass-card rounded-xl border border-white/8 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center text-xs font-bold text-primary shrink-0">
            #{contact.rank}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">{contact.name}</span>
              {contact.title && <span className="text-xs text-muted-foreground">{contact.title}</span>}
            </div>
            {contact.conversationHook && (
              <p className="text-[11px] text-amber-400/80 italic mt-1">"{contact.conversationHook}"</p>
            )}
            <div className="flex items-center gap-3 mt-1.5">
              {contact.email    && <Mail  className="w-3 h-3 text-primary" />}
              {contact.phone    && <Phone className="w-3 h-3 text-emerald-400" />}
              {contact.outreachEmail    && <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">Email draft ready</span>}
              {contact.outreachLinkedin && <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">LinkedIn draft ready</span>}
              {contact.whatsappOpener   && <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">WhatsApp opener</span>}
            </div>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/8 pt-3">
          {contact.culturalNote && (
            <div className="bg-amber-500/8 border border-amber-500/20 rounded-lg p-3">
              <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-1">Cultural Note</p>
              <p className="text-xs text-amber-300/80">{contact.culturalNote}</p>
            </div>
          )}
          {contact.outreachEmail && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Email Draft</p>
                <button onClick={() => copy(contact.outreachEmail!, "email")}
                  className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80">
                  {copied === "email" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied === "email" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="text-[11px] text-foreground/80 font-mono bg-white/3 border border-white/8 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
                {contact.outreachEmail}
              </pre>
            </div>
          )}
          {contact.outreachLinkedin && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">LinkedIn Message</p>
                <button onClick={() => copy(contact.outreachLinkedin!, "linkedin")}
                  className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80">
                  {copied === "linkedin" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied === "linkedin" ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-foreground/80 bg-white/3 border border-white/8 rounded-lg p-3">{contact.outreachLinkedin}</p>
            </div>
          )}
          {contact.whatsappOpener && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">WhatsApp Opener</p>
                <button onClick={() => copy(contact.whatsappOpener!, "whatsapp")}
                  className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80">
                  {copied === "whatsapp" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied === "whatsapp" ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-foreground/80 bg-white/3 border border-white/8 rounded-lg p-3">{contact.whatsappOpener}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function RelationshipIntelPage() {
  const [brief, setBrief] = useState<RelBrief>({ targetCompanyName: "", outputDepth: "deep" });
  const [jobId, setJobId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Record<number, AgentState>>({
    1: { status: "idle", label: "Org Mapper",           log: [] },
    2: { status: "idle", label: "Stakeholder Enricher", log: [] },
    3: { status: "idle", label: "Network Expander",     log: [] },
    4: { status: "idle", label: "Outreach Sequencer",   log: [] },
  });
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [contacts, setContacts] = useState<OutreachContact[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [activeView, setActiveView] = useState<"chart" | "list">("chart");
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => () => { sseRef.current?.close(); }, []);

  const startMutation = useMutation({
    mutationFn: async (b: RelBrief) => {
      const r = await fetch(`${BASE}/api/relationship-intel/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      return r.json();
    },
    onSuccess: (data) => {
      if (data.ok && data.jobId) {
        setJobId(data.jobId);
        setIsRunning(true);
        setDone(false);
        setNodes([]);
        setContacts([]);
        setAgents({
          1: { status: "idle", label: "Org Mapper",           log: [] },
          2: { status: "idle", label: "Stakeholder Enricher", log: [] },
          3: { status: "idle", label: "Network Expander",     log: [] },
          4: { status: "idle", label: "Outreach Sequencer",   log: [] },
        });
        startSSE(data.jobId);
      }
    },
  });

  function startSSE(jId: string) {
    sseRef.current?.close();
    const es = new EventSource(`${BASE}/api/relationship-intel/stream/${jId}`);
    sseRef.current = es;
    es.onmessage = (e) => {
      if (e.data === "[DONE]") { es.close(); setIsRunning(false); setDone(true); return; }
      try {
        const ev: AgentEvent = JSON.parse(e.data);
        if (ev.type === "stream_end") { es.close(); setIsRunning(false); setDone(true); return; }
        if (ev.agent) {
          setAgents(prev => {
            const cur = prev[ev.agent!] || { status: "idle", label: AGENT_LABELS[ev.agent!] || "", log: [] };
            const updated = { ...cur };
            if (ev.type === "agent_start")    { updated.status = "running";  updated.log = []; }
            if (ev.type === "agent_complete") { updated.status = "complete"; updated.count = ev.count; }
            if (ev.type === "agent_error")    { updated.status = "error"; }
            if (ev.type === "agent_log" && ev.message) updated.log = [...cur.log, ev.message].slice(-20);
            if (ev.type === "agent_progress" && ev.current !== undefined) updated.progress = { current: ev.current, total: ev.total! };
            return { ...prev, [ev.agent!]: updated };
          });
        }
        if (ev.type === "org_node_found"  && ev.node)    setNodes(prev => [...prev, ev.node!]);
        if (ev.type === "outreach_contact" && ev.contact) setContacts(prev => [...prev, ev.contact!]);
        if (ev.type === "pipeline_complete") { setIsRunning(false); setDone(true); }
      } catch {}
    };
    es.onerror = () => { es.close(); setIsRunning(false); };
  }

  return (
    <div className="space-y-6 animate-in">
      {/* Lead Factory tab strip — keeps Relationship Intel inside the LF flow */}
      <LeadFactoryTabs />

      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center glow-brand-sm">
            <GitFork className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">Relationship Network Intelligence</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          4-agent pipeline that maps org charts, enriches stakeholders, expands networks, and generates ranked outreach sequences for Saudi companies.
        </p>
      </div>

      {/* Input form */}
      <div className="glass-panel rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            placeholder="Target company name (e.g. Saudi Aramco)"
            value={brief.targetCompanyName}
            onChange={e => setBrief(b => ({ ...b, targetCompanyName: e.target.value }))}
            className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground"
          />
          <Input
            placeholder="اسم الشركة بالعربي (اختياري)"
            value={brief.targetCompanyNameAr || ""}
            onChange={e => setBrief(b => ({ ...b, targetCompanyNameAr: e.target.value }))}
            className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground font-arabic text-right"
            dir="rtl"
          />
          <Input
            placeholder="Website (optional)"
            value={brief.targetWebsite || ""}
            onChange={e => setBrief(b => ({ ...b, targetWebsite: e.target.value }))}
            className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground"
          />
          <Input
            placeholder="CR Number (optional)"
            value={brief.targetCrNumber || ""}
            onChange={e => setBrief(b => ({ ...b, targetCrNumber: e.target.value }))}
            className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <Textarea
          placeholder="Context — what are you selling? What's the goal? E.g. 'We offer Treasury Management Software and want to connect with CFO or Head of Finance.'"
          value={brief.context || ""}
          onChange={e => setBrief(b => ({ ...b, context: e.target.value }))}
          className="bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground resize-none h-20 text-sm"
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {(["basic", "deep"] as const).map(d => (
              <button key={d} onClick={() => setBrief(b => ({ ...b, outputDepth: d }))}
                className={cn("px-3 py-1.5 text-xs font-medium rounded-lg border capitalize transition-all",
                  brief.outputDepth === d
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "border-border/30 text-muted-foreground hover:border-border/50 hover:text-foreground")}>
                {d === "basic" ? "⚡ Basic (faster)" : "🔬 Deep (comprehensive)"}
              </button>
            ))}
          </div>
          <Button
            disabled={!brief.targetCompanyName.trim() || isRunning}
            onClick={() => startMutation.mutate(brief)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
            {isRunning
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Mapping…</>
              : <><Network className="w-4 h-4" /> Map Network</>}
          </Button>
        </div>
      </div>

      {/* Agent pipeline */}
      {(isRunning || done) && (
        <div className="space-y-4 animate-in">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(n => (
              <AgentCard key={n} agentNum={n} state={agents[n] || { status: "idle", label: AGENT_LABELS[n], log: [] }} />
            ))}
          </div>

          {/* Results */}
          {nodes.length > 0 && (
            <div className="space-y-3">
              {/* View toggle + stats */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold text-foreground">
                    Org Chart — {nodes.length} people{contacts.length > 0 && `, ${contacts.length} outreach sequences`}
                  </p>
                </div>
                <div className="flex gap-1">
                  {(["chart", "list"] as const).map(v => (
                    <button key={v} onClick={() => setActiveView(v)}
                      className={cn("px-3 py-1 text-xs rounded-lg border capitalize transition-all",
                        activeView === v
                          ? "bg-primary/15 border-primary/30 text-primary"
                          : "border-border/30 text-muted-foreground hover:border-border/50")}>
                      {v === "chart" ? "Org Chart" : "List View"}
                    </button>
                  ))}
                </div>
              </div>

              {activeView === "chart" ? (
                <OrgTree nodes={nodes} />
              ) : (
                <div className="space-y-2">
                  {nodes.map((node, i) => (
                    <div key={i} className="glass-card rounded-xl p-3 flex items-center gap-3">
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                        seniorityTier(node) === 0 ? "bg-primary/20 text-primary border border-primary/30" :
                        seniorityTier(node) === 1 ? "bg-violet-500/20 text-violet-400 border border-violet-500/30" :
                        "bg-muted/40 text-muted-foreground border border-border/40")}>
                        {node.nameEn?.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{node.nameEn}</span>
                          {node.nameAr && <span className="text-xs text-muted-foreground font-arabic">{node.nameAr}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {node.title && <span className="text-xs text-muted-foreground">{node.title}</span>}
                          {node.seniority && <span className="text-[10px] bg-muted/40 px-1.5 py-0.5 rounded text-muted-foreground">{node.seniority}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {node.email    && <Mail  className="w-3.5 h-3.5 text-primary" />}
                        {node.phone    && <Phone className="w-3.5 h-3.5 text-emerald-400" />}
                        {node.linkedin && <Globe className="w-3.5 h-3.5 text-primary" />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Outreach contacts */}
          {contacts.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Ranked Outreach Plan — {contacts.length} contacts
              </p>
              <div className="space-y-3">
                {contacts.map((contact, i) => (
                  <ContactCard key={i} contact={contact} />
                ))}
              </div>
            </div>
          )}

          {done && nodes.length === 0 && (
            <div className="glass-card rounded-xl p-8 text-center">
              <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-sm text-muted-foreground">No org chart data found. Try a different company name or enable deep mode.</p>
            </div>
          )}
        </div>
      )}

      {!isRunning && !done && (
        <div className="glass-card rounded-xl p-12 text-center">
          <GitFork className="w-10 h-10 text-muted-foreground mx-auto mb-4 opacity-30" />
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Enter a Saudi company name above and click "Map Network" to run the 4-agent pipeline.
            It will map the org chart, enrich stakeholders, expand connections, and generate personalised outreach sequences.
          </p>
        </div>
      )}
    </div>
  );
}
