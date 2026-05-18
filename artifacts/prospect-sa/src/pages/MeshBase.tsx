import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Building2, Users, BarChart3, Network, Globe, TrendingUp,
  ArrowRight, Database, ChevronRight, Layers, Shield, Zap,
  MapPin, Briefcase, DollarSign,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function fmtRevenue(v?: string | null): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  if (n >= 1e9) return `SAR ${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `SAR ${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `SAR ${Math.round(n / 1e3)}K`;
  return `SAR ${n.toLocaleString()}`;
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function MeshBaseOverview() {
  const { data: stats } = useQuery<{ totalCompanies: number; totalExecutives: number; totalIndustries: number }>({
    queryKey: ["/api/stats"],
    queryFn: () => fetch(`${BASE}/api/stats`).then(r => r.json()),
  });

  const { data: industryData } = useQuery<{ name: string; count: number }[]>({
    queryKey: ["/api/industry-distribution"],
    queryFn: () => fetch(`${BASE}/api/industry-distribution`).then(r => r.json()),
  });

  const { data: companiesData } = useQuery<{ companies: any[]; total: number }>({
    queryKey: ["/api/companies", "featured"],
    queryFn: () => fetch(`${BASE}/api/companies?limit=6&sortBy=revenue`).then(r => r.json()),
  });

  const { data: executivesData } = useQuery<{ executives: any[]; total: number }>({
    queryKey: ["/api/executives", "featured"],
    queryFn: () => fetch(`${BASE}/api/executives?limit=6&sortBy=experience_most`).then(r => r.json()),
  });

  const featuredCompanies = companiesData?.companies || [];
  const featuredExecutives = executivesData?.executives || [];
  const industries = (industryData || []).slice(0, 12);
  const maxCount = Math.max(...industries.map(i => i.count), 1);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Network className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">OrcBase</h1>
              <p className="text-sm text-muted-foreground">Master Saudi B2B intelligence database</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href="/meshbase/companies">
              <Building2 className="w-4 h-4" />
              Companies
            </Link>
          </Button>
          <Button asChild size="sm" className="gap-2 bg-violet-600 hover:bg-violet-700 text-white">
            <Link href="/meshbase/executives">
              <Users className="w-4 h-4" />
              Executives
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Companies", value: stats?.totalCompanies?.toLocaleString() ?? "…", icon: Building2, color: "from-blue-500/20 to-blue-600/10 border-blue-500/20", iconColor: "text-blue-400" },
          { label: "Total Executives", value: stats?.totalExecutives?.toLocaleString() ?? "…", icon: Users, color: "from-violet-500/20 to-violet-600/10 border-violet-500/20", iconColor: "text-violet-400" },
          { label: "Industries Covered", value: stats?.totalIndustries?.toLocaleString() ?? "…", icon: Layers, color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/20", iconColor: "text-emerald-400" },
        ].map((s) => (
          <Card key={s.label} className={`bg-gradient-to-br ${s.color} border`}>
            <CardContent className="p-5 flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl bg-background/50 flex items-center justify-center`}>
                <s.icon className={`w-6 h-6 ${s.iconColor}`} />
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{s.value}</div>
                <div className="text-sm text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* What is MeshBase */}
      <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-violet-400" />
                <h2 className="text-lg font-semibold text-foreground">What is OrcBase?</h2>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                OrcBase is the Saudi Arabian B2B intelligence database at the core of ProspectSA. It provides structured,
                curated data on Saudi companies and their leadership teams — built for sales prospecting, market research,
                competitive intelligence, and executive outreach.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Every record is enriched with financial estimates, employee ranges, AI-generated insights, LinkedIn profiles,
                and executive salary benchmarks — giving you an unparalleled view into the Saudi business landscape.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Shield, title: "Verified Data", desc: "Real Saudi companies with curated profiles" },
                { icon: Zap, title: "AI-Enriched", desc: "GPT-4 insights for 746 top companies" },
                { icon: Globe, title: "Full Coverage", desc: "17 industries, 20+ cities across KSA" },
                { icon: TrendingUp, title: "Live Financials", desc: "Revenue, profit & growth estimates" },
              ].map((f) => (
                <div key={f.title} className="p-4 rounded-xl border border-border/50 bg-background/40 space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                    <f.icon className="w-4 h-4 text-violet-400" />
                  </div>
                  <div className="text-sm font-semibold text-foreground">{f.title}</div>
                  <div className="text-xs text-muted-foreground">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Industry Distribution */}
      {industries.length > 0 && (
        <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-violet-400" />
              Industry Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-2.5">
              {industries.map((ind) => (
                <div key={ind.name} className="flex items-center gap-3">
                  <div className="w-32 text-sm text-muted-foreground truncate text-right">{ind.name}</div>
                  <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-purple-400 rounded-full transition-all duration-500"
                      style={{ width: `${(ind.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <div className="w-12 text-sm text-right font-medium text-foreground">{ind.count}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Featured Companies */}
      {featuredCompanies.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-400" />
              Featured Companies
            </h2>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
              <Link href="/meshbase/companies">View all <ChevronRight className="w-3 h-3" /></Link>
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {featuredCompanies.map((c) => (
              <Card key={c.id} className="border-border/50 bg-card/60 hover:bg-card/80 transition-colors cursor-pointer group">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    {c.logoUrl ? (
                      <img src={c.logoUrl} alt={c.nameEn} className="w-10 h-10 rounded-lg object-contain bg-background border border-border/50" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-600/20 border border-blue-500/20 flex items-center justify-center">
                        <span className="text-xs font-bold text-blue-400">{initials(c.nameEn)}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-foreground truncate">{c.nameEn}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" />{c.city || "Saudi Arabia"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs capitalize">{c.industry}</Badge>
                    <span className="text-xs font-medium text-emerald-400">{fmtRevenue(c.revenue)}</span>
                  </div>
                  {c.employeeCount && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Briefcase className="w-3 h-3" />{c.employeeCount} employees
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Featured Executives */}
      {featuredExecutives.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-400" />
              Featured Executives
            </h2>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
              <Link href="/meshbase/executives">View all <ChevronRight className="w-3 h-3" /></Link>
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {featuredExecutives.map((e) => (
              <Card key={e.id} className="border-border/50 bg-card/60 hover:bg-card/80 transition-colors cursor-pointer text-center group">
                <CardContent className="p-4 space-y-2">
                  {e.photoUrl ? (
                    <img src={e.photoUrl} alt={e.name} className="w-14 h-14 rounded-full object-cover mx-auto border-2 border-border/50" onError={(ev) => { (ev.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20 border-2 border-violet-500/20 flex items-center justify-center mx-auto">
                      <span className="text-sm font-bold text-violet-400">{initials(e.name)}</span>
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-semibold text-foreground truncate">{e.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{e.position}</div>
                    <div className="text-[10px] text-violet-400 truncate mt-0.5">{e.companyName}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
