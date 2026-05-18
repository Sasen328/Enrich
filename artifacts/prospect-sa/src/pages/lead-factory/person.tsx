import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Users, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterPanel, type LeadFactoryBrief } from "@/components/lead-factory/FilterPanel";

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
      const numeric = data.jobId?.split("-")[1] || data.jobId;
      navigate(`/lead-factory?jobId=${numeric}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/lead-factory")} className="gap-1.5 mb-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to hub
          </Button>
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
        <div className="rounded-lg border border-border/40 bg-card/40 p-6">
          <h2 className="font-semibold mb-2">Run preview</h2>
          <p className="text-sm text-muted-foreground mb-4">
            When you submit, the 7-agent Lead Factory pipeline runs against these filters.
            Results land on the Lead Factory hub with live SSE progress.
          </p>
          <pre className="text-[11px] bg-background/40 border border-border/30 rounded p-3 max-h-96 overflow-auto">
            {JSON.stringify(brief, null, 2)}
          </pre>
          {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
        </div>
      </div>
    </div>
  );
}
