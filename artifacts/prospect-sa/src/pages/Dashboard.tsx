import { useQuery } from "@tanstack/react-query";
import { useGetDashboardStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Building2, Radar, Database, Users, MapPin, TrendingUp, Globe,
  Phone, Mail, Layers, Network, Landmark, Target, BarChart3,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell,
} from "recharts";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CompanyStats {
  total: number;
  byEnrichment: { enriched: number; partial: number; pending: number };
  fieldCoverage: Record<string, { count: number; pct: number }>;
  bySource: { source: string; count: number }[];
  byCity: { city: string; count: number }[];
  byIndustry: { industry: string; count: number }[];
  byCompanyType: { type: string; count: number }[];
  totalIndustries?: number;
  totalCities?: number;
}

interface AllSourceStats {
  orcbase: number;
  masaar: number;
  builder: number;
  prosengine: number;
  leadLists: number;
}

function useCompanyStats() {
  return useQuery<CompanyStats>({
    queryKey: ["company-stats"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/companies/stats`);
      if (!r.ok) throw new Error("Failed to fetch stats");
      return r.json();
    },
    staleTime: 60_000,
  });
}

function useAllSourceStats() {
  return useQuery<AllSourceStats>({
    queryKey: ["all-source-stats"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/lead-lists/stats/all`);
      if (!r.ok) throw new Error("Failed to fetch source stats");
      return r.json();
    },
    staleTime: 30_000,
  });
}

const ENRICHMENT_COLORS = ["#10b981", "#f59e0b", "#6b7280"];

const COVERAGE_FIELDS = [
  { key: "description",  label: "Description",  icon: Layers },
  { key: "website",      label: "Website",       icon: Globe },
  { key: "revenue",      label: "Revenue",       icon: TrendingUp },
  { key: "phone",        label: "Phone",         icon: Phone },
  { key: "email",        label: "Email",         icon: Mail },
  { key: "ownerName",    label: "Owner Name",    icon: Users },
  { key: "foundingYear", label: "Founded Year",  icon: Building2 },
];

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: quality, isLoading: qualityLoading } = useCompanyStats();
  const { data: srcStats, isLoading: srcLoading } = useAllSourceStats();

  const isLoading = statsLoading || qualityLoading;

  const enrichmentPie = quality ? [
    { name: "Enriched", value: quality.byEnrichment.enriched },
    { name: "Partial",  value: quality.byEnrichment.partial },
    { name: "Pending",  value: quality.byEnrichment.pending },
  ] : [];

  const sourceEngines = [
    {
      label: "OrcBase",
      sub: "Master company database",
      icon: Network,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/10",
      value: srcLoading ? null : (srcStats?.orcbase ?? 0).toLocaleString(),
      unit: "companies",
    },
    {
      label: "Masaar",
      sub: "CR registry intelligence",
      icon: Landmark,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/10",
      value: srcLoading ? null : (srcStats?.masaar ?? 0).toLocaleString(),
      unit: "CR records",
    },
    {
      label: "AI Database Builder",
      sub: "Harvested companies",
      icon: Database,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
      border: "border-violet-500/10",
      value: srcLoading ? null : (srcStats?.builder ?? 0).toLocaleString(),
      unit: "companies",
    },
    {
      label: "ProsEngine",
      sub: "Web-prospected results",
      icon: Radar,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/10",
      value: srcLoading ? null : (srcStats?.prosengine ?? 0).toLocaleString(),
      unit: "prospects",
    },
    {
      label: "AI Leads Engine",
      sub: "Saved lead lists",
      icon: Target,
      color: "text-primary",
      bg: "bg-primary/10",
      border: "border-primary/10",
      value: srcLoading ? null : (srcStats?.leadLists ?? 0).toLocaleString(),
      unit: "lead lists",
    },
  ];

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl md:text-4xl font-display font-bold text-white tracking-tight">Intelligence Dashboard</h1>
        <p className="text-muted-foreground mt-1">Saudi B2B platform — real-time overview across all engines</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Companies",
            value: isLoading ? null : (stats?.totalCompanies ?? 0).toLocaleString(),
            sub: `${quality?.totalCities ?? 0} cities covered`,
            icon: Building2,
            color: "text-blue-400",
            bg: "bg-blue-500/10",
          },
          {
            label: "Enriched Profiles",
            value: isLoading ? null : (stats?.enrichedCompanies ?? 0).toLocaleString(),
            sub: quality ? `${Math.round((quality.byEnrichment.enriched / Math.max(quality.total, 1)) * 100)}% of database` : "",
            icon: Radar,
            color: "text-primary",
            bg: "bg-primary/10",
          },
          {
            label: "Industries Covered",
            value: isLoading ? null : (quality?.totalIndustries ?? 0).toString(),
            sub: "Across all Saudi sectors",
            icon: Layers,
            color: "text-violet-400",
            bg: "bg-violet-500/10",
          },
          {
            label: "Lead Lists",
            value: srcLoading ? null : (srcStats?.leadLists ?? 0).toLocaleString(),
            sub: "AI-generated lead hunts",
            icon: Target,
            color: "text-emerald-400",
            bg: "bg-emerald-500/10",
          },
        ].map(({ label, value, sub, icon: Icon, color, bg }) => (
          <Card key={label} className="border-white/10 bg-card/50 backdrop-blur-xl group hover:-translate-y-0.5 transition-all duration-300">
            <CardContent className="p-5">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${bg} mb-4`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
              {value === null ? (
                <Skeleton className="h-8 w-20 bg-white/5" />
              ) : (
                <h3 className="text-2xl font-display font-bold text-white">{value}</h3>
              )}
              <p className="text-xs text-muted-foreground mt-1">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-Engine Data Sources Breakdown */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />Data Sources Overview
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          {sourceEngines.map(({ label, sub, icon: Icon, color, bg, border, value, unit }) => (
            <Card key={label} className={`border-white/10 ${border} bg-card/40 backdrop-blur-sm hover:-translate-y-0.5 transition-all duration-200`}>
              <CardContent className="p-4">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${bg} mb-3`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
                {value === null ? (
                  <Skeleton className="h-7 w-16 bg-white/5 mb-1" />
                ) : (
                  <h4 className={`text-2xl font-display font-bold ${color}`}>{value}</h4>
                )}
                <p className="text-xs text-muted-foreground mt-1">{unit}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 bg-card/40 backdrop-blur-sm border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display">Top Industries</CardTitle>
            <CardDescription>OrcBase — companies by sector (top 15)</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px] pt-2">
            {isLoading ? (
              <div className="h-full flex items-end gap-2">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="flex-1 bg-white/5 rounded animate-pulse" style={{ height: `${Math.random() * 60 + 20}%` }} />
                ))}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={(quality?.byIndustry ?? stats?.industriesBreakdown?.map(i => ({ industry: i.industry, count: i.count })) ?? []).slice(0, 15)}
                  margin={{ top: 0, right: 8, left: -20, bottom: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="industry" stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} angle={-45} textAnchor="end" interval={0} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.03)" }}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-sm border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display">Enrichment Status</CardTitle>
            <CardDescription>OrcBase profile data quality</CardDescription>
          </CardHeader>
          <CardContent>
            {qualityLoading ? (
              <div className="h-36 bg-white/5 rounded animate-pulse" />
            ) : (
              <>
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={enrichmentPie} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value">
                        {enrichmentPie.map((_, i) => <Cell key={i} fill={ENRICHMENT_COLORS[i]} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 mt-1">
                  {[
                    { label: "Enriched (70%+)",  value: quality?.byEnrichment.enriched ?? 0, color: "bg-emerald-500" },
                    { label: "Partial (30–70%)", value: quality?.byEnrichment.partial  ?? 0, color: "bg-amber-500" },
                    { label: "Pending (<30%)",   value: quality?.byEnrichment.pending  ?? 0, color: "bg-zinc-500" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                        <span className="text-muted-foreground">{label}</span>
                      </div>
                      <span className="text-white font-medium">{value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Field coverage + City distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card/40 backdrop-blur-sm border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display">Data Field Coverage</CardTitle>
            <CardDescription>% of OrcBase companies with each field populated</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {qualityLoading ? (
              Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-6 bg-white/5 rounded animate-pulse" />)
            ) : (
              COVERAGE_FIELDS.map(({ key, label, icon: Icon }) => {
                const f = quality?.fieldCoverage[key];
                const pct = f?.pct ?? 0;
                const color = pct >= 70 ? "bg-emerald-500" : pct >= 30 ? "bg-amber-500" : "bg-red-500";
                return (
                  <div key={key} className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-white/70 w-28 shrink-0">{label}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-12 text-right shrink-0">{pct}%</span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-sm border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display">Top Cities</CardTitle>
            <CardDescription>Geographic distribution of OrcBase companies</CardDescription>
          </CardHeader>
          <CardContent className="h-[240px]">
            {qualityLoading ? (
              <div className="h-full bg-white/5 rounded animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={quality?.byCity ?? []} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="city" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={70} />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.03)" }}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary) / 0.6)" radius={[0, 3, 3, 0]} label={{ position: "right", fill: "rgba(255,255,255,0.3)", fontSize: 10 }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
