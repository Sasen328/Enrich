import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Search, Filter, Building2, TrendingUp, Users, BarChart3, MapPin,
  ChevronDown, ChevronRight, RefreshCw, Download, Sparkles, Loader2,
  X, AlertCircle, DollarSign, BriefcaseBusiness, GraduationCap, Clock,
  Globe, Heart, Lightbulb, Shield, Star, Target, Zap, Phone, Mail,
  ExternalLink, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────
interface Shareholder {
  id: number;
  stockCode: string | null;
  stockIndex: string | null;
  companyName: string | null;
  companyNameAr: string | null;
  sector: string | null;
  city: string | null;
  shareholderName: string | null;
  shareholderNameAr: string | null;
  shareholderType: string | null;
  ownershipPercent: number | null;
  ownershipDisplay: string | null;
}

interface GroupedCompany {
  stockCode: string;
  stockIndex: string;
  companyName: string;
  companyNameAr: string | null;
  sector: string | null;
  city: string | null;
  shareholderCount: number;
  totalOwnership: number | null;
  topShareholder: string | null;
}

interface AIProfile {
  id?: number;
  personName: string;
  personType: string;
  companyName?: string | null;
  sector?: string | null;
  estimatedAnnualIncome?: string | null;
  estimatedWealth?: string | null;
  investmentAppetite?: string | null;
  investmentFocus?: string | null;
  educationBackground?: string | null;
  careerHistory?: string | null;
  boardMemberships?: string | null;
  keyConnections?: string | null;
  bestTimeToContact?: string | null;
  approachStrategy?: string | null;
  riskProfile?: string | null;
  philanthropyInterests?: string | null;
  geographicPresence?: string | null;
  languagesSpoken?: string | null;
  publicProfiles?: string[];
  rawProfile?: string | null;
  profileScore?: number | null;
  cached?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initials(name: string) {
  return name.split(" ").filter(Boolean).map(p => p[0]).join("").slice(0, 2).toUpperCase();
}

function ownershipColor(pct: number | null) {
  if (!pct) return "text-zinc-400";
  if (pct >= 20) return "text-emerald-400";
  if (pct >= 5)  return "text-amber-400";
  return "text-zinc-400";
}

function ownershipBarColor(pct: number | null) {
  if (!pct) return "bg-zinc-600";
  if (pct >= 20) return "bg-emerald-500";
  if (pct >= 5)  return "bg-amber-500";
  return "bg-zinc-500";
}

const RISK_COLORS: Record<string, string> = {
  Conservative: "bg-blue-500/15 text-blue-300 border-blue-500/20",
  Balanced:     "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
  Growth:       "bg-amber-500/15 text-amber-300 border-amber-500/20",
  Speculative:  "bg-red-500/15 text-red-300 border-red-500/20",
};

const APPETITE_COLORS: Record<string, string> = {
  Conservative:  "bg-blue-500/15 text-blue-300 border-blue-500/20",
  Moderate:      "bg-teal-500/15 text-teal-300 border-teal-500/20",
  Aggressive:    "bg-orange-500/15 text-orange-300 border-orange-500/20",
  Opportunistic: "bg-violet-500/15 text-violet-300 border-violet-500/20",
};

// ─── AI Profile Drawer ────────────────────────────────────────────────────────
function AIProfileDrawer({
  person, companyName, sector, open, onClose,
}: {
  person: { name: string; ownershipPercent?: number | null; stockCode?: string | null; stockIndex?: string | null };
  companyName?: string; sector?: string; open: boolean; onClose: () => void;
}) {
  const [profile, setProfile] = useState<AIProfile | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/sa-market/profile/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personName: person.name,
          personType: "shareholder",
          companyName,
          sector,
          ownershipPercent: person.ownershipPercent,
          stockCode: person.stockCode,
          stockIndex: person.stockIndex,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<AIProfile>;
    },
    onSuccess: (data) => { setProfile(data); setHasLoaded(true); },
  });

  const checkCached = useCallback(async () => {
    if (hasLoaded) return;
    try {
      const r = await fetch(`${BASE}/api/sa-market/profile/${encodeURIComponent(person.name)}`);
      if (r.ok) { const d = await r.json() as AIProfile; setProfile(d); setHasLoaded(true); }
    } catch {}
  }, [person.name, hasLoaded]);

  if (open && !hasLoaded && !generateMutation.isPending) { checkCached(); }

  const score = profile?.profileScore ?? 0;
  const scoreColor = score >= 75 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-zinc-400";
  const scoreBar = score >= 75 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-zinc-500";

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-xl bg-card border-l border-white/10 overflow-y-auto p-0">
        {/* Header */}
        <SheetHeader className="px-6 py-5 bg-gradient-to-r from-primary/15 to-violet-500/10 border-b border-white/10 sticky top-0 z-10 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
              <span className="text-lg font-display font-bold text-primary">{initials(person.name)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-white font-display font-bold text-lg leading-tight">{person.name}</SheetTitle>
              {companyName && <p className="text-sm text-primary/80 mt-0.5">Shareholder · {companyName}</p>}
              {person.ownershipPercent && (
                <p className={`text-sm font-semibold mt-0.5 ${ownershipColor(person.ownershipPercent)}`}>
                  {person.ownershipPercent.toFixed(2)}% ownership
                </p>
              )}
            </div>
          </div>
          {profile?.rawProfile && (
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{profile.rawProfile}</p>
          )}
        </SheetHeader>

        <div className="px-6 py-5 space-y-5">
          {/* Generate / Refresh button */}
          {!profile && !generateMutation.isPending && (
            <Card className="bg-primary/5 border-primary/20 border-dashed">
              <CardContent className="py-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
                  <Sparkles className="w-6 h-6 text-primary" />
                </div>
                <p className="text-white font-medium">Generate AI Deep Profile</p>
                <p className="text-sm text-muted-foreground">AI will research investment appetite, estimated wealth, education, career history, and optimal approach strategy</p>
                <Button onClick={() => generateMutation.mutate()} className="bg-primary hover:bg-primary/90">
                  <Sparkles className="w-4 h-4 mr-2" />Generate Profile
                </Button>
              </CardContent>
            </Card>
          )}

          {generateMutation.isPending && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-white font-medium">AI is researching {person.name}…</p>
              <p className="text-sm text-muted-foreground text-center">Analyzing investment profile, wealth estimation, career history, and optimal contact strategy</p>
            </div>
          )}

          {generateMutation.isError && (
            <Card className="bg-red-500/5 border-red-500/20">
              <CardContent className="py-4 flex gap-3 items-center">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                <p className="text-sm text-red-300">Failed to generate profile. Please try again.</p>
                <Button size="sm" variant="ghost" onClick={() => generateMutation.mutate()} className="ml-auto text-muted-foreground">Retry</Button>
              </CardContent>
            </Card>
          )}

          {profile && (
            <>
              {profile.cached && (
                <div className="flex items-center justify-between">
                  <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/20 border text-xs">Cached profile</Badge>
                  <Button size="sm" variant="ghost" onClick={() => generateMutation.mutate()} className="text-xs text-muted-foreground h-7">
                    <RefreshCw className="w-3 h-3 mr-1" />Refresh
                  </Button>
                </div>
              )}

              {/* Profile score */}
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1">Profile confidence score</p>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${scoreBar} transition-all`} style={{ width: `${score}%` }} />
                  </div>
                </div>
                <span className={`text-xl font-display font-bold ${scoreColor}`}>{score}</span>
              </div>

              {/* Financial Intelligence */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <DollarSign className="w-3.5 h-3.5" />Financial Intelligence
                </h4>
                <div className="grid grid-cols-1 gap-2">
                  {profile.estimatedWealth && (
                    <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                      <p className="text-xs text-muted-foreground mb-0.5">Estimated Net Worth</p>
                      <p className="text-sm font-semibold text-emerald-400">{profile.estimatedWealth}</p>
                    </div>
                  )}
                  {profile.estimatedAnnualIncome && (
                    <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                      <p className="text-xs text-muted-foreground mb-0.5">Estimated Annual Income</p>
                      <p className="text-sm font-semibold text-amber-400">{profile.estimatedAnnualIncome}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {profile.investmentAppetite && (
                      <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                        <p className="text-xs text-muted-foreground mb-1">Investment Appetite</p>
                        <Badge className={`text-xs border ${APPETITE_COLORS[profile.investmentAppetite] ?? "bg-zinc-500/15 text-zinc-300"}`}>{profile.investmentAppetite}</Badge>
                      </div>
                    )}
                    {profile.riskProfile && (
                      <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                        <p className="text-xs text-muted-foreground mb-1">Risk Profile</p>
                        <Badge className={`text-xs border ${RISK_COLORS[profile.riskProfile] ?? "bg-zinc-500/15 text-zinc-300"}`}>{profile.riskProfile}</Badge>
                      </div>
                    )}
                  </div>
                  {profile.investmentFocus && (
                    <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                      <p className="text-xs text-muted-foreground mb-1">Investment Focus Areas</p>
                      <p className="text-sm text-white">{profile.investmentFocus}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Background */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <GraduationCap className="w-3.5 h-3.5" />Background
                </h4>
                {profile.educationBackground && (
                  <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                    <p className="text-xs text-muted-foreground mb-0.5">Education</p>
                    <p className="text-sm text-white">{profile.educationBackground}</p>
                  </div>
                )}
                {profile.careerHistory && (
                  <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                    <p className="text-xs text-muted-foreground mb-0.5">Career History</p>
                    <p className="text-sm text-white leading-relaxed">{profile.careerHistory}</p>
                  </div>
                )}
                {profile.boardMemberships && (
                  <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                    <p className="text-xs text-muted-foreground mb-0.5">Board & Memberships</p>
                    <p className="text-sm text-white">{profile.boardMemberships}</p>
                  </div>
                )}
              </div>

              {/* Network */}
              {profile.keyConnections && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5" />Key Connections
                  </h4>
                  <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                    <p className="text-sm text-white">{profile.keyConnections}</p>
                  </div>
                </div>
              )}

              {/* Approach Strategy */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Target className="w-3.5 h-3.5" />Prospecting Strategy
                </h4>
                {profile.bestTimeToContact && (
                  <div className="p-3 bg-amber-500/5 rounded-xl border border-amber-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <p className="text-xs text-amber-300 font-semibold">Best Time to Contact</p>
                    </div>
                    <p className="text-sm text-white">{profile.bestTimeToContact}</p>
                  </div>
                )}
                {profile.approachStrategy && (
                  <div className="p-3 bg-primary/5 rounded-xl border border-primary/20">
                    <div className="flex items-center gap-2 mb-1">
                      <Lightbulb className="w-3.5 h-3.5 text-primary" />
                      <p className="text-xs text-primary font-semibold">Approach Strategy</p>
                    </div>
                    <p className="text-sm text-white leading-relaxed">{profile.approachStrategy}</p>
                  </div>
                )}
              </div>

              {/* Personal interests */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Heart className="w-3.5 h-3.5" />Personal & Interests
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {profile.philanthropyInterests && (
                    <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                      <p className="text-xs text-muted-foreground mb-0.5">Philanthropy</p>
                      <p className="text-xs text-white">{profile.philanthropyInterests}</p>
                    </div>
                  )}
                  {profile.geographicPresence && (
                    <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                      <p className="text-xs text-muted-foreground mb-0.5">Geography</p>
                      <p className="text-xs text-white">{profile.geographicPresence}</p>
                    </div>
                  )}
                </div>
                {profile.languagesSpoken && (
                  <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                    <p className="text-xs text-muted-foreground mb-0.5">Languages</p>
                    <p className="text-sm text-white">{profile.languagesSpoken}</p>
                  </div>
                )}
              </div>

              {/* Public Profiles */}
              {(profile.publicProfiles ?? []).length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Public Profiles</h4>
                  <div className="flex flex-wrap gap-2">
                    {(profile.publicProfiles ?? []).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1.5 rounded-lg">
                        <ExternalLink className="w-3 h-3" />{url.replace(/^https?:\/\//, "").split("/")[0]}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Shareholder Row Card ──────────────────────────────────────────────────────
function ShareholderCard({ sh, onProfile }: { sh: Shareholder; onProfile: (sh: Shareholder) => void }) {
  const pct = sh.ownershipPercent ?? 0;
  const barW = Math.min(pct, 100);
  return (
    <div className="flex items-center gap-3 py-2.5 px-4 rounded-xl hover:bg-white/5 transition-colors group">
      <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
        <span className="text-xs font-bold text-primary">{sh.shareholderName ? initials(sh.shareholderName) : "?"}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{sh.shareholderName}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden max-w-[100px]">
            <div className={`h-full rounded-full ${ownershipBarColor(sh.ownershipPercent)}`} style={{ width: `${barW}%` }} />
          </div>
          <span className={`text-xs font-semibold ${ownershipColor(sh.ownershipPercent)}`}>
            {sh.ownershipDisplay ?? `${pct.toFixed(2)}%`}
          </span>
          {sh.shareholderType && sh.shareholderType !== "Individual" && (
            <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/20 border text-xs">{sh.shareholderType}</Badge>
          )}
        </div>
      </div>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" onClick={() => onProfile(sh)}
              className="opacity-0 group-hover:opacity-100 text-primary hover:bg-primary/10 h-8 w-8 p-0 shrink-0">
              <Sparkles className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="bg-card border-white/10 text-xs">Generate AI Profile</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ─── Company Group Card ────────────────────────────────────────────────────────
function CompanyGroupCard({
  company, onExpand, expanded, shareholders, onProfile,
}: {
  company: GroupedCompany;
  onExpand: () => void;
  expanded: boolean;
  shareholders: Shareholder[];
  onProfile: (sh: Shareholder) => void;
}) {
  const indexBg = company.stockIndex === "TASI"
    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/20"
    : "bg-blue-500/15 text-blue-300 border-blue-500/20";

  return (
    <Card className="bg-card/40 border-white/10 hover:border-white/20 transition-all duration-150 overflow-hidden">
      <button onClick={onExpand} className="w-full text-left">
        <CardHeader className="pb-3 pt-4 px-5">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/20 to-violet-500/20 border border-primary/20 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-semibold text-white text-sm leading-tight">{company.companyName}</h3>
                <Badge className={`text-xs border ${indexBg}`}>{company.stockIndex}</Badge>
                {company.stockCode && <Badge className="bg-white/5 text-zinc-400 border-white/10 border text-xs">{company.stockCode}</Badge>}
              </div>
              {company.sector && <p className="text-xs text-muted-foreground mt-0.5"><BarChart3 className="w-3 h-3 inline mr-0.5" />{company.sector}</p>}
              {company.city && <p className="text-xs text-muted-foreground"><MapPin className="w-3 h-3 inline mr-0.5" />{company.city}</p>}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm font-semibold text-white">{company.shareholderCount}</span>
                <span className="text-xs text-muted-foreground">shareholders</span>
              </div>
              {company.topShareholder && (
                <p className="text-xs text-muted-foreground truncate max-w-[140px]">Top: {company.topShareholder}</p>
              )}
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
            </div>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <div className="border-t border-white/5 divide-y divide-white/5">
          {shareholders.length === 0 ? (
            <div className="py-4 px-5 text-center text-sm text-muted-foreground flex items-center gap-2 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />Loading shareholders…
            </div>
          ) : (
            shareholders.map(sh => (
              <ShareholderCard key={sh.id} sh={sh} onProfile={onProfile} />
            ))
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Stats Bar ─────────────────────────────────────────────────────────────────
function StatsBar({ stats }: { stats: { total: number; sectors: { sector: string; count: number }[]; indexes: { index: string; count: number }[] } }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: "Total Shareholders", value: stats.total.toLocaleString(), icon: TrendingUp, color: "text-primary" },
        { label: "Sectors Covered", value: stats.sectors.length.toString(), icon: BarChart3, color: "text-violet-400" },
        { label: "TASI Companies", value: (stats.indexes.find(i=>i.index==="TASI")?.count ?? 0).toString(), icon: Star, color: "text-emerald-400" },
        { label: "NOMU Companies", value: (stats.indexes.find(i=>i.index==="NOMU")?.count ?? 0).toString(), icon: Zap, color: "text-amber-400" },
      ].map(({ label, value, icon: Icon, color }) => (
        <Card key={label} className="bg-card/40 border-white/10">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <Icon className={`w-5 h-5 ${color} shrink-0`} />
            <div>
              <p className={`text-xl font-display font-bold ${color}`}>{value}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Main Shareholders Page ───────────────────────────────────────────────────
export default function ShareholdersPage() {
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("");
  const [stockIndex, setStockIndex] = useState("");
  const [minOwnership, setMinOwnership] = useState(0);
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const [companyShareholdersCache, setCompanyShareholdersCache] = useState<Record<string, Shareholder[]>>({});
  const [profileTarget, setProfileTarget] = useState<{ sh: Shareholder; companyName: string; sector: string } | null>(null);

  // Stats
  const { data: stats } = useQuery({
    queryKey: ["sa-market-sh-stats"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/sa-market/shareholders/stats`); return r.json() as Promise<{ total: number; sectors: { sector: string; count: number }[]; topIndividuals: { name: string; totalOwnership: number; companiesCount: number }[]; indexes: { index: string; count: number }[] }>; },
  });

  // Sectors
  const { data: sectors = [] } = useQuery<string[]>({
    queryKey: ["sa-market-sectors"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/sa-market/sectors`); return r.json(); },
  });

  // Data
  const qKey = ["sa-market-shareholders", search, sector, stockIndex, minOwnership, viewMode];
  const { data: rows = [], isLoading } = useQuery<(GroupedCompany | Shareholder)[]>({
    queryKey: qKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (search) params.set("search", search);
      if (sector) params.set("sector", sector);
      if (stockIndex) params.set("stock_index", stockIndex);
      if (minOwnership > 0) params.set("min_ownership", String(minOwnership));
      if (viewMode === "grouped") params.set("group_by_company", "1");
      const r = await fetch(`${BASE}/api/sa-market/shareholders?${params}`);
      return r.json();
    },
  });

  function toggleExpand(stockCode: string, companyName: string) {
    const next = new Set(expandedCodes);
    if (next.has(stockCode)) { next.delete(stockCode); }
    else {
      next.add(stockCode);
      if (!companyShareholdersCache[stockCode]) {
        fetch(`${BASE}/api/sa-market/shareholders/by-company/${stockCode}`)
          .then(r => r.json() as Promise<Shareholder[]>)
          .then(d => setCompanyShareholdersCache(c => ({ ...c, [stockCode]: d })));
      }
    }
    setExpandedCodes(next);
  }

  return (
    <div className="space-y-5 animate-in slide-in-from-bottom-4 duration-500">
      {/* Page title (shared header handles it) */}

      {stats && <StatsBar stats={stats} />}

      {/* Filters */}
      <Card className="bg-card/30 border-white/10">
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by name or company…" value={search}
                onChange={e => setSearch(e.target.value)} className="pl-9 bg-white/5 border-white/10 text-white h-9" />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="border-white/10 text-muted-foreground hover:text-white gap-2 h-9 shrink-0">
                  <BarChart3 className="w-3.5 h-3.5" />{sector || "All Sectors"}<ChevronDown className="w-3 h-3 ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-card border-white/10 max-h-72 overflow-y-auto">
                <DropdownMenuItem onClick={() => setSector("")} className="cursor-pointer">All Sectors</DropdownMenuItem>
                {sectors.map(s => <DropdownMenuItem key={s} onClick={() => setSector(s)} className="cursor-pointer text-sm">{s}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="border-white/10 text-muted-foreground hover:text-white gap-2 h-9 shrink-0">
                  <Star className="w-3.5 h-3.5" />{stockIndex || "TASI + NOMU"}<ChevronDown className="w-3 h-3 ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-card border-white/10">
                <DropdownMenuItem onClick={() => setStockIndex("")} className="cursor-pointer">TASI + NOMU</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStockIndex("TASI")} className="cursor-pointer">TASI only</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStockIndex("NOMU")} className="cursor-pointer">NOMU only</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Min %:</span>
              <div className="w-28">
                <Slider min={0} max={50} step={1} value={[minOwnership]}
                  onValueChange={([v]) => setMinOwnership(v)} />
              </div>
              <span className="text-xs font-semibold text-white w-8">{minOwnership}%</span>
            </div>

            <div className="flex items-center gap-1 border border-white/10 rounded-lg p-0.5 shrink-0">
              {(["grouped","flat"] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={`px-3 py-1 text-xs rounded-md transition-all ${viewMode===m ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-white"}`}>
                  {m === "grouped" ? "By Company" : "All People"}
                </button>
              ))}
            </div>

            <span className="text-xs text-muted-foreground shrink-0">{rows.length} results</span>
          </div>
        </CardContent>
      </Card>

      {/* Data */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 bg-white/5 rounded-xl animate-pulse" />)}
        </div>
      ) : viewMode === "grouped" ? (
        <div className="space-y-3">
          {(rows as GroupedCompany[]).map(company => (
            <CompanyGroupCard
              key={company.stockCode}
              company={company}
              expanded={expandedCodes.has(company.stockCode)}
              shareholders={companyShareholdersCache[company.stockCode] ?? []}
              onExpand={() => toggleExpand(company.stockCode, company.companyName)}
              onProfile={sh => setProfileTarget({ sh, companyName: company.companyName, sector: company.sector ?? "" })}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {(rows as Shareholder[]).map(sh => (
            <Card key={sh.id} className="bg-card/40 border-white/10 hover:border-white/20 transition-all">
              <CardContent className="py-0 px-2">
                <ShareholderCard sh={sh} onProfile={s => setProfileTarget({ sh: s, companyName: s.companyName ?? "", sector: s.sector ?? "" })} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {rows.length === 0 && !isLoading && (
        <Card className="bg-card/30 border-white/10 border-dashed">
          <CardContent className="py-12 text-center">
            <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-white font-medium">No shareholders found</p>
            <p className="text-sm text-muted-foreground mt-1">Try broadening your filters.</p>
          </CardContent>
        </Card>
      )}

      {/* AI Profile Drawer */}
      {profileTarget && (
        <AIProfileDrawer
          person={{ name: profileTarget.sh.shareholderName ?? "", ownershipPercent: profileTarget.sh.ownershipPercent, stockCode: profileTarget.sh.stockCode, stockIndex: profileTarget.sh.stockIndex }}
          companyName={profileTarget.companyName}
          sector={profileTarget.sector}
          open={!!profileTarget}
          onClose={() => setProfileTarget(null)}
        />
      )}
    </div>
  );
}
