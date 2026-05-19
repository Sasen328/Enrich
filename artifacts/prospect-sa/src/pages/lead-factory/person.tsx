import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { FilterPanel, type LeadFactoryBrief } from "@/components/lead-factory/FilterPanel";
import { AgentPreview } from "@/components/lead-factory/AgentPreview";
import { LeadFactoryTabs } from "@/components/lead-factory/LeadFactoryTabs";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LeadFactoryPersonPage() {
  const [, navigate] = useLocation();
  const [brief, setBrief] = useState<LeadFactoryBrief>({
    inputMode: "segment",
    mode: "person",
    targetCount: 50,
    enrichmentDepth: "standard",
  });
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      setError(null);
      const r = await fetch(`${BASE}/api/lead-factory/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      return data as { ok: true; jobId: string };
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      const numeric = data.jobId?.split("-")[1] || data.jobId;
      navigate(`/lead-factory/results?jobId=${numeric}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  // Rough heuristic for "est. matches" — number of filters checked tightens
  // the funnel. Pure decoration; the real count comes from Agent 1.
  const estMatches = (() => {
    const tightness =
      (brief.industries?.length || 0) * 0.4 +
      (brief.cities?.length || 0) * 0.3 +
      (brief.seniority?.length || 0) * 0.5 +
      (brief.employeeBands?.length || 0) * 0.3;
    const base = 500;
    return Math.max(10, Math.round(base / Math.max(1, tightness)));
  })();

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <LeadFactoryTabs />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Lead Factory — Person Hunt
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Filter for the people you want to reach. Their companies are harvested as a side-effect.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
        <FilterPanel
          mode="person"
          value={brief}
          onChange={setBrief}
          onSubmit={() => run.mutate()}
          submitting={run.isPending}
        />
        <AgentPreview
          jobId={jobId}
          estMatches={estMatches}
          targetCount={brief.targetCount}
          error={error}
        />
      </div>
    </div>
  );
}
