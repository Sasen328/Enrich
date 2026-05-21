import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";

// Shared shape returned by /api/person-intel/profile and /api/company-intel/profile
export interface IntelSection {
  title: string;
  content: string;
  citations?: Array<{ url: string; source?: string }> | string[];
}

interface IntelReportProps {
  sections: IntelSection[];
  hasRealData?: boolean;
  researchThreads?: number;
  discoveredLinkedIn?: string | null;
  className?: string;
}

export function IntelReport({ sections, hasRealData, researchThreads, discoveredLinkedIn, className }: IntelReportProps) {
  if (!sections || sections.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic">No report sections returned.</div>
    );
  }

  return (
    <div className={className}>
      {/* Header strip */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-[11px] text-muted-foreground">
        {typeof researchThreads === "number" && (
          <span className="px-2 py-0.5 rounded bg-card/65 border border-border/40">
            {researchThreads} research threads
          </span>
        )}
        {hasRealData !== undefined && (
          <span className={`px-2 py-0.5 rounded border ${hasRealData ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-amber-500/10 border-amber-500/30 text-amber-400"}`}>
            {hasRealData ? "real data" : "inferred"}
          </span>
        )}
        {discoveredLinkedIn && (
          <a href={discoveredLinkedIn} target="_blank" rel="noopener noreferrer" className="px-2 py-0.5 rounded bg-primary/10 border border-primary/30 text-primary inline-flex items-center gap-1">
            LinkedIn <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {sections.map((s, i) => (
          <Card key={i} className="bg-card/65 border-border/40">
            <CardContent className="p-4 space-y-2">
              <h3 className="font-semibold text-sm text-primary">{s.title}</h3>
              <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
                {s.content}
              </div>
              {s.citations && s.citations.length > 0 && (
                <div className="pt-2 border-t border-border/30 flex flex-wrap gap-1.5">
                  {s.citations.slice(0, 8).map((c, ci) => {
                    const url = typeof c === "string" ? c : c.url;
                    const label = typeof c === "string" ? new URL(c).hostname : (c.source || new URL(c.url).hostname);
                    return (
                      <a
                        key={ci}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
                      >
                        {label} <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
