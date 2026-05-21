import { useLocation } from "wouter";
import { Globe, User, Database, ChevronRight, Sparkles, Zap, Brain, Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const MODES = [
  {
    id: "company",
    icon: Building2,
    color: "from-cyan-500/20 to-teal-500/10 border-cyan-500/30",
    iconColor: "text-cyan-400",
    badge: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    badgeLabel: "AI Company Dossier",
    title: "Company Intelligence",
    description:
      "Enter any Saudi company name — no website needed. Get a full dossier: ownership & shareholders, leadership (EN+AR), financials, market intelligence, competitors, and a tailored B2B approach strategy.",
    bullets: ["Shareholders & ownership % (bilingual)", "CEO, board, executives (EN+AR)", "Revenue, competitors, B2B approach"],
    path: "/prospecting/company",
    cta: "Research a Company",
  },
  {
    id: "person",
    icon: User,
    color: "from-violet-500/20 to-purple-500/10 border-violet-500/30",
    iconColor: "text-violet-400",
    badge: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    badgeLabel: "AI Deep Profile",
    title: "Person Intelligence",
    description:
      "Generate a full intelligence dossier on any Saudi executive, owner, or shareholder. Enter a name (and optional company/LinkedIn) and get wealth estimates, career history, education, company analysis, and a tailored approach strategy.",
    bullets: ["Wealth & income estimation", "Career timeline & education", "B2B approach strategy & cultural notes"],
    path: "/prospecting/person",
    cta: "Profile a Person",
  },
  {
    id: "website",
    icon: Globe,
    color: "from-teal-500/20 to-emerald-500/10 border-teal-500/30",
    iconColor: "text-teal-400",
    badge: "bg-teal-500/15 text-teal-300 border-teal-500/30",
    badgeLabel: "URL Scanner",
    title: "Website Intelligence",
    description:
      "Enter any Saudi business website, directory, or government registry. The engine deep-scans the site, detects data type, extracts companies & executives, then enriches each with AI.",
    bullets: ["Auto-detects directories, portals, catalogs", "Extracts companies & executives", "AI enrichment with contact & revenue data"],
    path: "/prospecting/website",
    cta: "Scan a Website",
  },
  {
    id: "seeder",
    icon: Database,
    color: "from-amber-500/20 to-orange-500/10 border-amber-500/30",
    iconColor: "text-amber-400",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    badgeLabel: "AI Generator",
    title: "Data Seeder",
    description:
      "Describe what data you need in plain text — industries, cities, executives, counts — and AI generates structured Saudi company and executive records instantly. No URL required.",
    bullets: ["Text description OR website URL input", "AI-generated realistic Saudi records", "Export to CSV · AI chat assistant included"],
    path: "/prospecting/seeder",
    cta: "Seed Data",
  },
];

export default function ProsEngineHub() {
  const [, navigate] = useLocation();

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">ProsEngine</h1>
            <p className="text-sm text-muted-foreground">Saudi Arabia Intelligence Platform — choose your mode</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          return (
            <Card
              key={mode.id}
              onClick={() => navigate(mode.path.replace(BASE, ""))}
              className={`group cursor-pointer bg-gradient-to-br ${mode.color} border hover:scale-[1.02] transition-all duration-200 hover:shadow-xl hover:shadow-black/30`}
            >
              <CardContent className="p-6 flex flex-col h-full">
                <div className="flex items-start justify-between mb-5">
                  <div className={`w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center border border-border/40 group-hover:scale-110 transition-transform`}>
                    <Icon className={`w-6 h-6 ${mode.iconColor}`} />
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${mode.badge}`}>{mode.badgeLabel}</span>
                </div>

                <h2 className="text-xl font-display font-bold text-foreground mb-2">{mode.title}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-5">{mode.description}</p>

                <ul className="space-y-1.5 mb-6 flex-1">
                  {mode.bullets.map((b) => (
                    <li key={b} className="flex items-center gap-2 text-xs text-foreground/70">
                      <div className={`w-1.5 h-1.5 rounded-full ${mode.iconColor.replace("text-", "bg-")}`} />
                      {b}
                    </li>
                  ))}
                </ul>

                <button
                  className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border ${mode.badge} hover:opacity-90 transition-opacity text-sm font-medium`}
                >
                  {mode.id === "person" ? <Brain className="w-4 h-4" /> : mode.id === "seeder" ? <Zap className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                  {mode.cta}
                  <ChevronRight className="w-4 h-4 ml-auto" />
                </button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-10 p-5 rounded-2xl border border-border/30 bg-white/2">
        <p className="text-xs text-muted-foreground text-center">
          All intelligence data is for B2B prospecting purposes only. AI-generated profiles clearly indicate estimated vs. confirmed data.
        </p>
      </div>
    </div>
  );
}
