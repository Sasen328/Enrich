import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, MapPin, Globe, Phone, Mail, ArrowLeft, Calendar,
  DollarSign, Users, TrendingUp, Briefcase, Linkedin, Twitter,
  User, Award, FileText, BarChart3, AlertCircle, ExternalLink,
  Tag, Star, Info, Hash,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function fmt(v?: string | null): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  if (n >= 1e9) return `SAR ${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `SAR ${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `SAR ${Math.round(n / 1e3)}K`;
  return `SAR ${n.toLocaleString()}`;
}

function fmtSalary(v?: number | null): string {
  if (!v) return "—";
  if (v >= 1_000_000) return `SAR ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `SAR ${Math.round(v / 1_000)}K`;
  return `SAR ${v.toLocaleString()}`;
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function InfoRow({ icon: Icon, label, value, href }: { icon: any; label: string; value?: string | null; href?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all flex items-center gap-1">
            {value} <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        ) : (
          <div className="text-sm text-foreground break-words">{value}</div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  return (
    <div className={`rounded-xl border p-4 space-y-2 ${color}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="text-xl font-bold text-foreground">{value}</div>
    </div>
  );
}

export default function MeshBaseCompanyProfile() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const { data: company, isLoading, isError } = useQuery({
    queryKey: ["/api/companies", id],
    queryFn: () => fetch(`${BASE}/api/companies/${id}`).then(r => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
  });

  const { data: execsData } = useQuery<{ executives: any[] }>({
    queryKey: ["/api/companies", id, "executives"],
    queryFn: () => fetch(`${BASE}/api/companies/${id}/executives`).then(r => r.json()),
    enabled: !!id,
  });

  const executives = execsData?.executives || [];

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted/40 rounded animate-pulse" />
        <div className="h-40 bg-muted/40 rounded-xl animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted/40 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (isError || !company) {
    return (
      <div className="p-6 max-w-5xl mx-auto text-center py-20">
        <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
        <p className="text-muted-foreground font-medium">Company not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/meshbase/companies")}>
          Back to Companies
        </Button>
      </div>
    );
  }

  const websiteHref = company.website ? (company.website.startsWith("http") ? company.website : `https://${company.website}`) : undefined;
  const revenue = fmt(company.revenue);
  const profit = fmt(company.profit);
  const marketCap = fmt(company.marketCap);
  const capital = fmt(company.capitalAmount);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back button */}
      <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground -ml-2" onClick={() => navigate("/meshbase/companies")}>
        <ArrowLeft className="w-4 h-4" />
        Back to Companies
      </Button>

      {/* Company Header */}
      <Card className="border-border/50 bg-card/60">
        <CardContent className="p-6">
          <div className="flex items-start gap-5">
            {company.logoUrl ? (
              <img
                src={company.logoUrl}
                alt={company.nameEn}
                className="w-20 h-20 rounded-2xl object-contain bg-background border border-border/50 p-1 shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-600/20 border border-blue-500/20 flex items-center justify-center shrink-0">
                <span className="text-2xl font-bold text-blue-400">{initials(company.nameEn)}</span>
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <h1 className="text-2xl font-bold text-foreground leading-tight">{company.nameEn || company.nameAr || "—"}</h1>
                {company.nameAr && company.nameEn && (
                  <div className="text-lg text-muted-foreground mt-0.5" dir="rtl">{company.nameAr}</div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {company.industry && <Badge variant="outline" className="capitalize">{company.industry}</Badge>}
                {company.subIndustry && <Badge variant="outline" className="capitalize text-muted-foreground">{company.subIndustry}</Badge>}
                {company.entityType && <Badge variant="outline" className="text-muted-foreground">{company.entityType}</Badge>}
                {company.enrichmentScore != null && (
                  <Badge variant="outline" className="gap-1 text-amber-400 border-amber-400/30 bg-amber-500/5">
                    <Star className="w-3 h-3" />
                    Score {company.enrichmentScore}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {company.city && (
                  <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{company.city}{company.region ? `, ${company.region}` : ""}</span>
                )}
                {company.foundingYear && (
                  <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Est. {company.foundingYear}</span>
                )}
                {company.employeeCount && (
                  <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{company.employeeCount} employees</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {websiteHref && (
                  <a href={websiteHref} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
                      <Globe className="w-3.5 h-3.5" />Website
                    </Button>
                  </a>
                )}
                {company.linkedinUrl && (
                  <a href={company.linkedinUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
                      <Linkedin className="w-3.5 h-3.5" />LinkedIn
                    </Button>
                  </a>
                )}
                {company.twitterUrl && (
                  <a href={company.twitterUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
                      <Twitter className="w-3.5 h-3.5" />Twitter
                    </Button>
                  </a>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Financial Stats */}
      {(company.revenue || company.profit || company.marketCap || company.capitalAmount || company.growthRate) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {company.revenue && <StatCard label="Annual Revenue" value={revenue} icon={DollarSign} color="border-emerald-500/20 bg-emerald-500/5" />}
          {company.profit && <StatCard label="Profit" value={profit} icon={TrendingUp} color="border-blue-500/20 bg-blue-500/5" />}
          {company.marketCap && <StatCard label="Market Cap" value={marketCap} icon={BarChart3} color="border-violet-500/20 bg-violet-500/5" />}
          {company.capitalAmount && <StatCard label="Capital" value={capital} icon={Award} color="border-amber-500/20 bg-amber-500/5" />}
          {company.growthRate && (
            <StatCard label="Growth Rate" value={`${company.growthRate}%`} icon={TrendingUp} color="border-teal-500/20 bg-teal-500/5" />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Description + AI Insights */}
        <div className="lg:col-span-2 space-y-5">
          {company.description && (
            <Card className="border-border/50 bg-card/60">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-400" />About
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-sm text-muted-foreground leading-relaxed">{company.description}</p>
              </CardContent>
            </Card>
          )}
          {company.aiInsights && (
            <Card className="border-violet-500/20 bg-violet-500/5">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-violet-400">
                  <Star className="w-4 h-4" />AI Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-sm text-muted-foreground leading-relaxed">{company.aiInsights}</p>
              </CardContent>
            </Card>
          )}
          {company.marketPositioning && (
            <Card className="border-border/50 bg-card/60">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-emerald-400" />Market Position
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-sm text-muted-foreground leading-relaxed">{company.marketPositioning}</p>
              </CardContent>
            </Card>
          )}
          {company.recentNews && (
            <Card className="border-border/50 bg-card/60">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-400" />Recent News
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-sm text-muted-foreground leading-relaxed">{company.recentNews}</p>
              </CardContent>
            </Card>
          )}

          {/* Executives */}
          {executives.length > 0 && (
            <Card className="border-border/50 bg-card/60">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-violet-400" />
                  Leadership Team · {executives.length}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {executives.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-background/40 hover:bg-accent/10 transition-colors cursor-pointer"
                      onClick={() => navigate(`/meshbase/executives/${e.id}`)}
                    >
                      {e.photoUrl ? (
                        <img src={e.photoUrl} alt={e.name} className="w-10 h-10 rounded-full object-cover border border-border/50 shrink-0" onError={ev => { (ev.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-violet-400">{initials(e.name)}</span>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground truncate">{e.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{e.position}</div>
                        {e.estimatedSalary && <div className="text-xs text-emerald-400 mt-0.5">{fmtSalary(e.estimatedSalary)} / yr</div>}
                      </div>
                      {e.seniorityLevel && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">{e.seniorityLevel}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Details sidebar */}
        <div className="space-y-5">
          <Card className="border-border/50 bg-card/60">
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold">Company Details</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <InfoRow icon={Building2} label="Company Name (AR)" value={company.nameAr} />
              <InfoRow icon={Globe} label="Website" value={websiteHref} href={websiteHref} />
              <InfoRow icon={Phone} label="Phone" value={company.phone} />
              <InfoRow icon={Mail} label="Email" value={company.email || company.contactEmail} href={company.email ? `mailto:${company.email}` : undefined} />
              <InfoRow icon={MapPin} label="Address" value={company.address} />
              <InfoRow icon={Hash} label="CR Number" value={company.crNumber} />
              <InfoRow icon={Building2} label="Entity Type" value={company.entityType} />
              <InfoRow icon={Tag} label="Company Type" value={company.companyType} />
              <InfoRow icon={User} label="CEO" value={company.ceo} />
              <InfoRow icon={User} label="Founder" value={company.founder} />
              <InfoRow icon={FileText} label="Data Source" value={company.dataSource} />
            </CardContent>
          </Card>

          {(company.ownerName || company.ownerEmail || company.ownerPhone || company.ownerLinkedin) && (
            <Card className="border-border/50 bg-card/60">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <User className="w-4 h-4 text-amber-400" />Key Contact
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <InfoRow icon={User} label="Name" value={company.ownerName || company.ownerNameAr} />
                <InfoRow icon={Briefcase} label="Title" value={company.ownerTitle} />
                <InfoRow icon={Phone} label="Phone" value={company.ownerPhone} />
                <InfoRow icon={Mail} label="Email" value={company.ownerEmail} href={company.ownerEmail ? `mailto:${company.ownerEmail}` : undefined} />
                <InfoRow icon={Linkedin} label="LinkedIn" value={company.ownerLinkedin} href={company.ownerLinkedin} />
              </CardContent>
            </Card>
          )}

          {company.tags && (
            <Card className="border-border/50 bg-card/60">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Tag className="w-4 h-4 text-muted-foreground" />Tags
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 flex flex-wrap gap-1.5">
                {company.tags.split(",").map((t: string) => (
                  <Badge key={t.trim()} variant="outline" className="text-xs capitalize">{t.trim()}</Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
