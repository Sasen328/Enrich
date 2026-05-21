// Lead Genome — saved-leads bucket with source filter.
// Wires /api/lead-genome/hunt and /api/lead-genome/stats.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { huntLeadGenome, leadGenomeStats, type LeadSource } from "@/lib/lead-genome-client";
import { Search, Heart, ChevronDown } from "lucide-react";

const SOURCES: { id: LeadSource | ""; label: string }[] = [
  { id: "",             label: "All sources" },
  { id: "lead-factory", label: "Lead Factory" },
  { id: "prosengine",   label: "ProsEngine" },
  { id: "ai-chat",      label: "AI Chat" },
  { id: "executives",   label: "Executives" },
  { id: "masaar",       label: "Masaar" },
  { id: "builder",      label: "AI Builder" },
  { id: "meshbase",     label: "MeshBase" },
  { id: "manual",       label: "Manual" },
];

export function LeadGenomePanel() {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<LeadSource | "">("");

  const { data: hunt, isLoading } = useQuery({
    queryKey: ["lead-genome", "hunt", q, source],
    queryFn: () => huntLeadGenome({ q: q || undefined, source: (source || undefined) as LeadSource | undefined }),
    staleTime: 30_000,
  });

  const { data: stats } = useQuery({
    queryKey: ["lead-genome", "stats"],
    queryFn: () => leadGenomeStats(),
    staleTime: 60_000,
  });

  return (
    <div className="surf p-5 mb-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-[hsl(var(--brand-mist))]/50 flex items-center justify-center">
          <Heart className="w-4 h-4 text-[hsl(var(--ac))]" />
        </div>
        <div className="flex-1">
          <h2 className="font-display font-bold text-lg leading-none">Lead Genome — Saved</h2>
          <p className="text-xs text-[hsl(var(--tx-q))] mt-0.5">
            Total: <strong>{stats?.total ?? 0}</strong> across all sources
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background/40">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name / email / title…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
        </div>
        <div className="relative">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as any)}
            className="appearance-none pl-3 pr-8 py-1.5 rounded-md border border-border bg-background/40 text-sm cursor-pointer"
          >
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}{s.id && stats?.bySource[s.id] ? ` (${stats.bySource[s.id]})` : ""}</option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-[hsl(var(--tx-q))] py-6 text-center">Loading…</div>
      ) : hunt && hunt.count > 0 ? (
        <ul className="space-y-1.5 max-h-[420px] overflow-y-auto">
          {hunt.leads.map((l: any) => {
            const tag = (l.notes || "").match(/\[from:([^\]]+)\]/)?.[1] || "manual";
            return (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-primary/5 border border-transparent hover:border-border/50">
                <div className="w-7 h-7 rounded-full bg-[hsl(var(--brand-mist))]/60 text-[hsl(var(--ac))] text-[10px] font-bold flex items-center justify-center">
                  {(l.firstName?.[0] || "?")}{(l.lastName?.[0] || "")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || "—"}</p>
                  <p className="text-[10px] text-[hsl(var(--tx-q))] truncate">
                    {l.title || "—"}{l.email ? ` · ${l.email}` : ""}
                  </p>
                </div>
                <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[hsl(var(--brand-mist))]/40 text-[hsl(var(--ac))] border border-[hsl(var(--ac))]/20 font-bold">
                  {tag}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="text-sm text-[hsl(var(--tx-q))] py-8 text-center">
          No saved leads yet. Push from Lead Factory / ProsEngine / AI Chat to populate.
        </div>
      )}
    </div>
  );
}
