import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Users, ArrowLeft, Building2, Briefcase, DollarSign, Mail,
  Phone, Linkedin, GraduationCap, AlertCircle, ExternalLink,
  Star, Award, MapPin, ChevronRight, BookOpen, TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

const seniorityColors: Record<string, string> = {
  "C-Suite": "text-amber-400 bg-amber-500/10 border-amber-500/30",
  "VP": "text-violet-400 bg-violet-500/10 border-violet-500/30",
  "Director": "text-blue-400 bg-blue-500/10 border-blue-500/30",
  "Senior": "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  "Mid": "text-sky-400 bg-sky-500/10 border-sky-500/30",
};

export default function MeshBaseExecutiveProfile() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const { data: executive, isLoading, isError } = useQuery({
    queryKey: ["/api/executives", id],
    queryFn: () => fetch(`${BASE}/api/executives/${id}`).then(r => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted/40 rounded animate-pulse" />
        <div className="h-48 bg-muted/40 rounded-xl animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-muted/40 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (isError || !executive) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-20">
        <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
        <p className="text-muted-foreground font-medium">Executive not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/meshbase/executives")}>
          Back to Executives
        </Button>
      </div>
    );
  }

  const linkedinLink = executive.linkedinUrl || executive.linkedin;
  const levelColor = seniorityColors[executive.seniorityLevel || ""] || "text-muted-foreground bg-muted/10 border-border/40";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Back */}
      <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground -ml-2" onClick={() => navigate("/meshbase/executives")}>
        <ArrowLeft className="w-4 h-4" />
        Back to Executives
      </Button>

      {/* Profile Header */}
      <Card className="border-border/50 bg-card/70">
        <CardContent className="p-6">
          <div className="flex items-start gap-5">
            {executive.photoUrl ? (
              <img
                src={executive.photoUrl}
                alt={executive.name}
                className="w-24 h-24 rounded-2xl object-cover border-2 border-border/50 shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 border-2 border-violet-500/20 flex items-center justify-center shrink-0">
                <span className="text-3xl font-bold text-violet-400">{initials(executive.name)}</span>
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <h1 className="text-2xl font-bold text-foreground leading-tight">{executive.name || "—"}</h1>
                {executive.nameAr && (
                  <div className="text-base text-muted-foreground mt-0.5" dir="rtl">{executive.nameAr}</div>
                )}
              </div>
              <div className="space-y-1">
                <div className="text-base text-muted-foreground font-medium">{executive.position || "Executive"}</div>
                {executive.positionAr && (
                  <div className="text-sm text-muted-foreground/70" dir="rtl">{executive.positionAr}</div>
                )}
              </div>
              {executive.companyName && (
                <button
                  className="flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300 transition-colors"
                  onClick={() => executive.companyId && navigate(`/meshbase/companies/${executive.companyId}`)}
                >
                  <Building2 className="w-3.5 h-3.5" />
                  {executive.companyName}
                  {executive.companyId && <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              )}
              <div className="flex flex-wrap gap-2 items-center">
                {executive.seniorityLevel && (
                  <Badge variant="outline" className={`capitalize ${levelColor}`}>{executive.seniorityLevel}</Badge>
                )}
                {executive.department && (
                  <Badge variant="outline" className="capitalize text-muted-foreground">{executive.department}</Badge>
                )}
                {executive.location && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5" />{executive.location}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {linkedinLink && (
                  <a href={linkedinLink} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
                      <Linkedin className="w-3.5 h-3.5" />LinkedIn <ExternalLink className="w-3 h-3 opacity-60" />
                    </Button>
                  </a>
                )}
                {executive.email && (
                  <a href={`mailto:${executive.email}`}>
                    <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
                      <Mail className="w-3.5 h-3.5" />{executive.email}
                    </Button>
                  </a>
                )}
                {executive.phone && (
                  <a href={`tel:${executive.phone}`}>
                    <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
                      <Phone className="w-3.5 h-3.5" />{executive.phone}
                    </Button>
                  </a>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {executive.yearsOfExperience != null && (
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Years Experience</span>
              <Briefcase className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl font-bold text-foreground">{executive.yearsOfExperience}</div>
          </div>
        )}
        {executive.estimatedSalary != null && executive.estimatedSalary > 0 && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Est. Annual Salary</span>
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-foreground">{fmtSalary(executive.estimatedSalary)}</div>
          </div>
        )}
        {executive.salary && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Salary Range</span>
              <TrendingUp className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-base font-bold text-foreground">{executive.salary}</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Biography */}
          {executive.biography && (
            <Card className="border-border/50 bg-card/70">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-blue-400" />Biography
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-sm text-muted-foreground leading-relaxed">{executive.biography}</p>
              </CardContent>
            </Card>
          )}

          {/* Skills */}
          {executive.skills && executive.skills.length > 0 && (
            <Card className="border-border/50 bg-card/70">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-400" />Skills
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <div className="flex flex-wrap gap-2">
                  {executive.skills.map((s: string) => (
                    <Badge key={s} variant="outline" className="text-xs capitalize bg-amber-500/5 border-amber-500/20 text-amber-300">{s}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Achievements */}
          {executive.achievements && executive.achievements.length > 0 && (
            <Card className="border-border/50 bg-card/70">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Award className="w-4 h-4 text-violet-400" />Achievements
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <ul className="space-y-2">
                  {executive.achievements.map((a: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-2 shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Previous Companies */}
          {executive.previousCompanies && executive.previousCompanies.length > 0 && (
            <Card className="border-border/50 bg-card/70">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />Previous Companies
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <div className="space-y-2">
                  {executive.previousCompanies.map((c: string, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Briefcase className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                      {c}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          {executive.education && (
            <Card className="border-border/50 bg-card/70">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-emerald-400" />Education
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <p className="text-sm text-muted-foreground leading-relaxed">{executive.education}</p>
              </CardContent>
            </Card>
          )}

          <Card className="border-border/50 bg-card/70">
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold">Profile Details</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4 space-y-3">
              {executive.seniorityLevel && (
                <div className="space-y-0.5">
                  <div className="text-xs text-muted-foreground">Seniority</div>
                  <div className="text-sm text-foreground font-medium">{executive.seniorityLevel}</div>
                </div>
              )}
              {executive.department && (
                <div className="space-y-0.5">
                  <div className="text-xs text-muted-foreground">Department</div>
                  <div className="text-sm text-foreground">{executive.department}</div>
                </div>
              )}
              {executive.dataSource && (
                <div className="space-y-0.5">
                  <div className="text-xs text-muted-foreground">Data Source</div>
                  <div className="text-sm text-foreground">{executive.dataSource}</div>
                </div>
              )}
              {executive.enrichmentStatus && (
                <div className="space-y-0.5">
                  <div className="text-xs text-muted-foreground">Enrichment</div>
                  <Badge variant="outline" className={`text-xs capitalize ${executive.enrichmentStatus === "enriched" ? "border-emerald-500/30 text-emerald-400" : "border-border/40"}`}>
                    {executive.enrichmentStatus}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Company link */}
          {executive.companyId && (
            <Card
              className="border-border/50 bg-card/70 hover:bg-card/80 transition-colors cursor-pointer"
              onClick={() => navigate(`/meshbase/companies/${executive.companyId}`)}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground">Works at</div>
                  <div className="text-sm font-semibold text-foreground truncate">{executive.companyName}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
