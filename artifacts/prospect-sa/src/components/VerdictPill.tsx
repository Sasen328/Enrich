// §7 frontend — renders a source-credibility verdict as a small lavender pill.
import { cn } from "@/lib/utils";

export interface Verdict {
  field: string;
  value: unknown;
  certainty: "verified" | "likely" | "unverified" | "estimated";
  trustScore: number;
  rationale: string;
  sources?: { provider: string; url?: string; tier: string }[];
}

const TONE: Record<Verdict["certainty"], string> = {
  verified:   "bg-emerald-500/12 text-emerald-600 border-emerald-500/30",
  likely:     "bg-[hsl(var(--brand-mist))]/40 text-[hsl(var(--ac))] border-[hsl(var(--ac))]/30",
  unverified: "bg-amber-500/12 text-amber-600 border-amber-500/30",
  estimated:  "bg-muted/50 text-muted-foreground border-border",
};

export function VerdictPill({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <span
      title={`${verdict.certainty} · ${verdict.rationale}${verdict.sources?.length ? " · " + verdict.sources.map(s => s.provider).join(", ") : ""}`}
      className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border cursor-help", TONE[verdict.certainty], className)}
    >
      🛡 {verdict.trustScore}
    </span>
  );
}

/** Render a list of verdicts as a compact wrap. */
export function VerdictList({ verdicts }: { verdicts: Verdict[] }) {
  if (!verdicts?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {verdicts.slice(0, 12).map((v, i) => (
        <span key={i} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <VerdictPill verdict={v} />
          <span className="truncate max-w-[160px]">{String(v.value).slice(0, 40)}</span>
        </span>
      ))}
    </div>
  );
}
