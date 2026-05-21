import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Database, Play, Clock, Loader2, Plus, Trash2, Zap, CheckCircle2, AlertCircle,
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SourceItem {
  id: string;
  name: string;
  nameAr?: string;
  category: string;
  url: string;
  description: string;
  estimatedCompanies: number;
  isCustom: boolean;
  dbId?: number;
  lastHarvestedAt: string | null;
  harvestedCount?: number;
}

interface HarvestState {
  status: "idle" | "harvesting" | "done" | "error";
  count?: number;
  error?: string;
}

export default function DatabaseBuilder() {
  const qc = useQueryClient();

  const [sources, setSources] = useState<SourceItem[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [harvestStates, setHarvestStates] = useState<Record<string, HarvestState>>({});
  const [harvestAllRunning, setHarvestAllRunning] = useState(false);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [srcName, setSrcName] = useState("");
  const [srcUrl, setSrcUrl] = useState("");
  const [srcCategory, setSrcCategory] = useState("business-directory");
  const [srcEstimated, setSrcEstimated] = useState("");
  const [srcDescription, setSrcDescription] = useState("");
  const [addingSource, setAddingSource] = useState(false);
  const [addSourceError, setAddSourceError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [enrichmentDepth, setEnrichmentDepth] = useState<"basic" | "standard" | "deep">("standard");

  const [totalCompanies, setTotalCompanies] = useState<number | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const [srcRes, statsRes] = await Promise.allSettled([
        fetch(`${BASE}/api/builder/sources`),
        fetch(`${BASE}/api/builder/stats`),
      ]);
      if (srcRes.status === "fulfilled") {
        const data = await srcRes.value.json() as SourceItem[];
        setSources(data);
      }
      if (statsRes.status === "fulfilled" && statsRes.value.ok) {
        const stats = await statsRes.value.json() as { total: number };
        setTotalCompanies(stats.total ?? null);
      }
    } catch {
      setSources([]);
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  useEffect(() => { void loadSources(); }, [loadSources]);

  const setSourceState = (id: string, state: HarvestState) => {
    setHarvestStates(prev => ({ ...prev, [id]: state }));
  };

  const harvestOne = async (source: SourceItem) => {
    setSourceState(source.id, { status: "harvesting" });
    try {
      const res = await fetch(`${BASE}/api/builder/sources/${encodeURIComponent(source.id)}/harvest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize: 1, enrichmentDepth }),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        setSourceState(source.id, { status: "error", error: err.error || "Harvest failed" });
        return;
      }
      const job = await res.json() as { jobId: string; builderJobId: number };

      let polls = 0;
      const poll = async () => {
        try {
          const jobRes = await fetch(`${BASE}/api/builder/jobs/${job.jobId}`);
          const jobData = await jobRes.json() as { status: string; companiesHarvested: number };
          if (jobData.status === "completed") {
            setSourceState(source.id, { status: "done", count: jobData.companiesHarvested });
            setSources(prev => prev.map(s => s.id === source.id ? { ...s, lastHarvestedAt: new Date().toISOString() } : s));
            void qc.invalidateQueries({ queryKey: ["builder-results"] });
            void qc.invalidateQueries({ queryKey: ["builder-stats"] });
          } else if (jobData.status === "failed" || jobData.status === "cancelled") {
            setSourceState(source.id, { status: "error", error: `Job ${jobData.status}` });
          } else if (polls < 60) {
            polls++;
            setTimeout(() => void poll(), 3000);
          } else {
            setSourceState(source.id, { status: "error", error: "Timed out" });
          }
        } catch {
          if (polls < 60) { polls++; setTimeout(() => void poll(), 3000); }
          else setSourceState(source.id, { status: "error", error: "Polling failed" });
        }
      };
      setTimeout(() => void poll(), 2000);
    } catch (e: unknown) {
      setSourceState(source.id, { status: "error", error: e instanceof Error ? e.message : "Network error" });
    }
  };

  const harvestAll = async () => {
    setHarvestAllRunning(true);
    for (const s of sources) {
      setSourceState(s.id, { status: "harvesting" });
    }
    try {
      const res = await fetch(`${BASE}/api/builder/harvest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize: 3, enrichmentDepth }),
      });
      if (!res.ok) {
        for (const s of sources) setSourceState(s.id, { status: "idle" });
        setHarvestAllRunning(false);
        return;
      }
      const job = await res.json() as { jobId: string };

      let polls = 0;
      const poll = async () => {
        try {
          const jobRes = await fetch(`${BASE}/api/builder/jobs/${job.jobId}`);
          const jobData = await jobRes.json() as { status: string; companiesHarvested: number; progress: number };
          if (jobData.status === "completed" || jobData.status === "failed") {
            for (const s of sources) setSourceState(s.id, { status: jobData.status === "completed" ? "done" : "idle" });
            setHarvestAllRunning(false);
            void qc.invalidateQueries({ queryKey: ["builder-results"] });
            void qc.invalidateQueries({ queryKey: ["builder-stats"] });
          } else if (polls < 120) {
            polls++;
            setTimeout(() => void poll(), 3000);
          } else {
            setHarvestAllRunning(false);
          }
        } catch {
          if (polls < 120) { polls++; setTimeout(() => void poll(), 3000); }
          else setHarvestAllRunning(false);
        }
      };
      setTimeout(() => void poll(), 2000);
    } catch {
      setHarvestAllRunning(false);
    }
  };

  const handleAddSource = async () => {
    if (!srcName.trim() || !srcUrl.trim()) {
      setAddSourceError("Name and URL are required.");
      return;
    }
    setAddingSource(true);
    setAddSourceError("");
    try {
      const res = await fetch(`${BASE}/api/builder/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: srcName.trim(),
          url: srcUrl.trim(),
          category: srcCategory,
          estimatedCompanies: srcEstimated ? parseInt(srcEstimated) : null,
          description: srcDescription.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        throw new Error(err.error || "Failed to add source");
      }
      setSrcName(""); setSrcUrl(""); setSrcCategory("business-directory");
      setSrcEstimated(""); setSrcDescription("");
      setAddSourceOpen(false);
      await loadSources();
    } catch (e: unknown) {
      setAddSourceError(e instanceof Error ? e.message : "Failed to add source");
    } finally {
      setAddingSource(false);
    }
  };

  const handleDeleteSource = async (source: SourceItem) => {
    setDeletingId(source.id);
    try {
      await fetch(`${BASE}/api/builder/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" });
      await loadSources();
    } finally {
      setDeletingId(null);
    }
  };

  const categoryIcon: Record<string, string> = {
    wikidata: "🌍",
    government: "🏛️",
    directory: "📂",
    chamber: "🤝",
    financial: "💹",
    "business-directory": "📂",
    "chamber-of-commerce": "🤝",
    "industry-association": "🏭",
    linkedin: "💼",
    news: "📰",
    other: "🔗",
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground">Harvest AI — Database Builder</h1>
          <p className="text-muted-foreground mt-2">
            Autonomous harvesting from Saudi data sources. Click ▶ on any source to harvest it individually.
          </p>
          {totalCompanies !== null && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-mono bg-primary/15 text-primary border border-primary/20 px-2.5 py-1 rounded-lg">
                {totalCompanies.toLocaleString()} companies in DB
              </span>
              <Link href="/database-builder/results" className="text-xs text-primary hover:underline underline-offset-2">
                Browse Results →
              </Link>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Select value={enrichmentDepth} onValueChange={v => setEnrichmentDepth(v as typeof enrichmentDepth)}>
            <SelectTrigger className="bg-black/40 border-white/15 text-foreground w-44 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border/40 text-foreground">
              <SelectItem value="basic">Basic enrichment</SelectItem>
              <SelectItem value="standard">Standard enrichment</SelectItem>
              <SelectItem value="deep">Deep enrichment</SelectItem>
            </SelectContent>
          </Select>

          <Link href="/database-builder/results" className="text-sm font-medium text-primary hover:underline underline-offset-4">
            View Results →
          </Link>

          <Dialog open={addSourceOpen} onOpenChange={setAddSourceOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-white/15 text-foreground gap-2 h-9">
                <Plus className="w-4 h-4" /> Add Source
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border/40 sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle className="text-foreground">Add Custom Data Source</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-muted-foreground text-xs">Source Name *</Label>
                    <Input value={srcName} onChange={e => setSrcName(e.target.value)}
                      placeholder="e.g. Saudi Exporters Directory"
                      className="bg-black/40 border-border/40 text-foreground" />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-muted-foreground text-xs">Website URL *</Label>
                    <Input value={srcUrl} onChange={e => setSrcUrl(e.target.value)}
                      placeholder="https://example.com"
                      className="bg-black/40 border-border/40 text-foreground" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">Category</Label>
                    <Select value={srcCategory} onValueChange={setSrcCategory}>
                      <SelectTrigger className="bg-black/40 border-border/40 text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border/40 text-foreground">
                        <SelectItem value="business-directory">Business Directory</SelectItem>
                        <SelectItem value="chamber-of-commerce">Chamber of Commerce</SelectItem>
                        <SelectItem value="government">Government Portal</SelectItem>
                        <SelectItem value="industry-association">Industry Association</SelectItem>
                        <SelectItem value="linkedin">LinkedIn</SelectItem>
                        <SelectItem value="news">News / Media</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">Est. Companies Listed</Label>
                    <Input value={srcEstimated} onChange={e => setSrcEstimated(e.target.value.replace(/\D/g, ""))}
                      placeholder="e.g. 1200"
                      className="bg-black/40 border-border/40 text-foreground" />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-muted-foreground text-xs">Description (optional)</Label>
                    <Textarea value={srcDescription} onChange={e => setSrcDescription(e.target.value)}
                      placeholder="Briefly describe what this source provides..."
                      className="bg-black/40 border-border/40 text-foreground resize-none min-h-[60px]" />
                  </div>
                </div>
                {addSourceError && <p className="text-xs text-rose-400">{addSourceError}</p>}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAddSourceOpen(false)} className="border-border/40">Cancel</Button>
                <Button onClick={handleAddSource} disabled={addingSource} className="bg-primary hover:bg-primary/90">
                  {addingSource ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Add Source
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Button
            onClick={() => void harvestAll()}
            disabled={harvestAllRunning || sourcesLoading}
            className="bg-gradient-to-r from-primary to-accent hover:shadow-lg hover:shadow-primary/25 border-none h-9"
          >
            {harvestAllRunning
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Harvesting All...</>
              : <><Zap className="w-4 h-4 mr-2" />Harvest All</>
            }
          </Button>
        </div>
      </div>

      {/* Sources Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-display font-semibold text-foreground">
            Data Sources
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {sourcesLoading ? "..." : `${sources.length} configured`}
            </span>
          </h3>
          <p className="text-xs text-muted-foreground">
            Click <Play className="w-3 h-3 inline text-primary" /> to harvest from a single source
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sourcesLoading ? (
            [1,2,3,4,5,6].map(i => <Card key={i} className="h-36 bg-muted/40 border-border/30 animate-pulse" />)
          ) : sources.map(source => {
            const hs = harvestStates[source.id] || { status: "idle" };
            const isHarvesting = hs.status === "harvesting";
            const isDone = hs.status === "done";
            const isError = hs.status === "error";

            return (
              <Card key={source.id} className={cn(
                "bg-card/65 backdrop-blur-sm border transition-all duration-200",
                isHarvesting && "border-primary/60 shadow-[0_0_20px_rgba(6,182,212,0.15)]",
                isDone && "border-emerald-500/40",
                isError && "border-rose-500/30",
                !isHarvesting && !isDone && !isError && "border-border/40 hover:border-white/20",
              )}>
                <CardContent className="p-5">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span>{categoryIcon[source.category] || "🔗"}</span>
                        <h4 className="font-semibold text-foreground text-sm truncate">{source.name}</h4>
                        {source.isCustom && (
                          <span className="text-[10px] bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded shrink-0">Custom</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{source.url}</p>
                      {source.description && (
                        <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-1">{source.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {source.isCustom && (
                        <button
                          onClick={() => void handleDeleteSource(source)}
                          disabled={deletingId === source.id || isHarvesting}
                          className="text-muted-foreground hover:text-rose-400 transition-colors p-1"
                          title="Delete source"
                        >
                          {deletingId === source.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      )}

                      <button
                        onClick={() => !isHarvesting && void harvestOne(source)}
                        disabled={isHarvesting || harvestAllRunning}
                        className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                          isHarvesting
                            ? "bg-primary/20 text-primary cursor-not-allowed"
                            : isDone
                            ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                            : isError
                            ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30"
                            : "bg-primary/10 text-primary hover:bg-primary/25 hover:scale-110",
                        )}
                        title={isHarvesting ? "Harvesting..." : isDone ? `Done — ${hs.count ?? 0} companies` : isError ? hs.error : "Harvest this source"}
                      >
                        {isHarvesting
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : isDone
                          ? <CheckCircle2 className="w-4 h-4" />
                          : isError
                          ? <AlertCircle className="w-4 h-4" />
                          : <Play className="w-4 h-4 ml-0.5" />
                        }
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground border-t border-border/30 pt-3">
                    <div className="flex items-center gap-1.5">
                      <Database className="w-3 h-3" />
                      {(source.harvestedCount ?? 0) > 0
                        ? <><span className="text-emerald-400 font-medium">{source.harvestedCount!.toLocaleString()} harvested</span><span className="opacity-50 mx-1">/</span>~{source.estimatedCompanies?.toLocaleString() || "N/A"} est.</>
                        : <span>~{source.estimatedCompanies?.toLocaleString() || "N/A"} estimated</span>
                      }
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isHarvesting ? (
                        <span className="text-primary animate-pulse">Harvesting…</span>
                      ) : isDone ? (
                        <span className="text-emerald-400">{hs.count ?? 0} added</span>
                      ) : isError ? (
                        <span className="text-rose-400 truncate max-w-[120px]">{hs.error}</span>
                      ) : (
                        <>
                          <Clock className="w-3 h-3" />
                          {source.lastHarvestedAt
                            ? new Date(source.lastHarvestedAt).toLocaleDateString()
                            : "Never harvested"}
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
