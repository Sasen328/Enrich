import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { FilterPanel, type LeadFactoryBrief } from "@/components/lead-factory/FilterPanel";
import { AgentPreview } from "@/components/lead-factory/AgentPreview";
import { LeadFactoryTabs } from "@/components/lead-factory/LeadFactoryTabs";
import { useLeadFactoryStream } from "@/hooks/useLeadFactoryStream";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LeadFactoryCompanyPage() {
  const [brief, setBrief] = useState<LeadFactoryBrief>({
    inputMode: "segment",
    mode: "company",
    targetCount: 50,
    enrichmentDepth: "standard",
    hasWebsite: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const agentState = useLeadFactoryStream(jobId);

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
      // Stay on the page so the 7-agent stream renders in the right pane.
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const estMatches = (() => {
    const tightness =
      (brief.industries?.length || 0) * 0.4 +
      (brief.cities?.length || 0) * 0.3 +
      (brief.employeeBands?.length || 0) * 0.3 +
      (brief.revenueBands?.length || 0) * 0.3;
    const base = 800;
    return Math.max(15, Math.round(base / Math.max(1, tightness)));
  })();

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <LeadFactoryTabs />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            Lead Factory — Company Hunt
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Filter for the companies that match your ICP. Contacts are harvested per company.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
        <FilterPanel
          mode="company"
          value={brief}
          onChange={setBrief}
          onSubmit={() => run.mutate()}
          submitting={run.isPending}
        />
        <AgentPreview
          jobId={jobId}
          estMatches={estMatches}
          targetCount={brief.targetCount}
          agentState={agentState}
          error={error}
        />
      </div>
    </div>
  );
}
