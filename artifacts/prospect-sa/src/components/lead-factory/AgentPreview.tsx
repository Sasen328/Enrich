import { Zap, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AgentPreviewProps {
  /** A jobId from a kick-off response, e.g. "lf-42" — if present, the panel
   *  shows "running" state. Otherwise it's a static preview of the 7 agents. */
  jobId?: string | null;
  /** Estimated matches based on filter selectivity (heuristic; optional). */
  estMatches?: number;
  /** Target count from the brief. */
  targetCount?: number;
  /** When the run starts streaming, parent passes the current agent index. */
  currentAgent?: number;
  /** Error text if the run failed. */
  error?: string | null;
}

const AGENTS = [
  { n: 1, title: "ICP Mapper & Source Orchestrator", subtitle: "Brief → prioritised sourcing plan" },
  { n: 2, title: "Lead Harvester", subtitle: "40+ free sources · Tavily · SearXNG · Google News · Saudi RSS" },
  { n: 3, title: "Deep Enrichment", subtitle: "Scout · GLEIF · OpenCorporates · Wikidata · Gemini" },
  { n: 4, title: "Signal Intelligence", subtitle: "News · sanctions · regulatory · hiring · contracts" },
  { n: 5, title: "Validate, Verify & Deduplicate", subtitle: "MX · domain liveness · dummy detection · fingerprint dedup" },
  { n: 6, title: "ICP Scoring & AI Copywriter", subtitle: "Composite score · email · LinkedIn · WhatsApp" },
  { n: 7, title: "Publish & Seed", subtitle: "Bridges into companies / leads / executives" },
];

function StatTile({ value, label, tone }: { value: string | number; label: string; tone: "lav" | "sea" | "sand" }) {
  const colour = tone === "lav" ? "text-primary" : tone === "sea" ? "text-accent" : "";
  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-3 text-center">
      <div className={cn("text-2xl font-bold", colour)} style={tone === "sand" ? { color: "hsl(var(--brand-sand))" } : undefined}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

export function AgentPreview({ jobId, estMatches, targetCount, currentAgent, error }: AgentPreviewProps) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm">
          {jobId ? `Run · job ${jobId}` : "Run preview · 7-agent pipeline"}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <StatTile value={estMatches ?? "~"} label="Est. matches" tone="lav" />
        <StatTile value={targetCount ?? 50} label="Target count" tone="sea" />
        <StatTile value="$0" label="Marginal cost" tone="sand" />
      </div>

      {/* Agent list */}
      <div className="space-y-1.5">
        {AGENTS.map((a) => {
          const isDone = currentAgent !== undefined && a.n < currentAgent;
          const isRunning = currentAgent === a.n;
          return (
            <div
              key={a.n}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg border bg-card/40",
                isRunning ? "border-accent/40 bg-accent/5" : "border-border/40",
              )}
            >
              <span
                className={cn(
                  "w-7 h-7 rounded-md inline-flex items-center justify-center text-xs font-bold shrink-0",
                  isDone
                    ? "bg-accent/20 text-accent"
                    : isRunning
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : a.n}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{a.title}</div>
                <div className="text-[10px] text-muted-foreground truncate">{a.subtitle}</div>
              </div>
              <div className="text-[10px] text-muted-foreground shrink-0">
                {isDone ? "✓ done" : isRunning ? "⚡ running" : isDone === false && currentAgent === undefined ? "" : <Circle className="w-2.5 h-2.5 opacity-30" />}
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className="mt-3 text-xs text-red-400 break-words">{error}</div>}
    </div>
  );
}
