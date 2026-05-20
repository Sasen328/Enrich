/**
 * Composer — built-in prompt templates
 *
 * Each template = mode + defaults + system hint. User picks one in Layer 1
 * (Pick) and the rest of the composer auto-fills.
 */

export interface ComposerTemplate {
  id: string;
  label: string;
  description: string;
  defaultQuestion: string;
  defaultModes: string[];               // e.g. ["leadgen", "enrich"]
  defaultTarget: "person" | "company" | "both";
  defaultCountries: string[];           // ISO-2 lowercase or "gcc"/"mena"
  defaultIndustry?: string;
  defaultSources: string[];             // source IDs
  defaultSkills: string[];              // skill IDs
  requiredSchema: "LeadList" | "CompanyDossier" | "CompareMatrix" | "SignalDigest" | "Custom";
}

export const BUILTIN_TEMPLATES: ComposerTemplate[] = [
  {
    id: "saudi-fintech-ctos-2024",
    label: "🎯 Saudi fintech CTOs · 2024 funded",
    description: "Lead-gen + enrich for Series-A+ Saudi fintechs that closed funding in 2024, hiring engineers.",
    defaultQuestion: "Find 5 Saudi fintech CTOs at Series-A+ companies that closed 2024 funding and are hiring engineers in Riyadh.",
    defaultModes: ["leadgen", "enrich"],
    defaultTarget: "both",
    defaultCountries: ["sa"],
    defaultIndustry: "fintech",
    defaultSources: ["tadawul", "argaam", "mubasher", "mci-cr", "gleif", "tavily"],
    defaultSkills: ["saudi-lead-hunter"],
    requiredSchema: "LeadList",
  },
  {
    id: "tadawul-board-compare",
    label: "⚖️ Tadawul board comparison",
    description: "Compare board composition + governance across Tadawul-listed companies.",
    defaultQuestion: "Compare the boards of the top 10 Tadawul-listed banks by digital transformation maturity.",
    defaultModes: ["compare", "research"],
    defaultTarget: "company",
    defaultCountries: ["sa"],
    defaultIndustry: "banking",
    defaultSources: ["tadawul", "cma", "argaam", "tavily"],
    defaultSkills: ["tadawul-analyst"],
    requiredSchema: "CompareMatrix",
  },
  {
    id: "family-office-contact-map",
    label: "🏛️ Family-office contact map · GCC",
    description: "Map influential GCC family offices + their investment leads.",
    defaultQuestion: "Map the top 15 GCC family offices and identify their primary investment decision-makers.",
    defaultModes: ["research", "leadgen", "tree"],
    defaultTarget: "both",
    defaultCountries: ["sa", "ae", "kw", "qa"],
    defaultSources: ["gleif", "opencorporates", "tavily", "linkedin"],
    defaultSkills: ["saudi-lead-hunter"],
    requiredSchema: "CompanyDossier",
  },
  {
    id: "cr-lookup-dossier",
    label: "🔬 CR Lookup deep dossier",
    description: "Build a complete dossier for a single company by CR number.",
    defaultQuestion: "Build a complete dossier on Saudi commercial registry number 1010***.",
    defaultModes: ["deepdive", "enrich"],
    defaultTarget: "company",
    defaultCountries: ["sa"],
    defaultSources: ["mci-cr", "masar", "tadawul", "gleif", "tavily"],
    defaultSkills: ["company-dossier"],
    requiredSchema: "CompanyDossier",
  },
  {
    id: "vc-founders-mena",
    label: "💰 VC-backed founders · MENA",
    description: "Find VC-backed startup founders across MENA who raised in the last 12 months.",
    defaultQuestion: "Find founders of MENA startups that raised Series A or larger in the last 12 months.",
    defaultModes: ["leadgen", "signal"],
    defaultTarget: "person",
    defaultCountries: ["sa", "ae", "eg", "jo"],
    defaultSources: ["wamda", "magnitt", "crunchbase", "tavily"],
    defaultSkills: ["funding-watch"],
    requiredSchema: "LeadList",
  },
  {
    id: "ma-screener",
    label: "📊 M&A candidates screen",
    description: "Screen M&A targets by sector + revenue band.",
    defaultQuestion: "Screen Saudi industrial-services companies with SAR 50-250M revenue as acquisition targets.",
    defaultModes: ["extract", "compare"],
    defaultTarget: "company",
    defaultCountries: ["sa"],
    defaultIndustry: "consulting",
    defaultSources: ["tadawul", "mci-cr", "gleif", "argaam"],
    defaultSkills: [],
    requiredSchema: "CompareMatrix",
  },
];

export function findTemplate(id: string): ComposerTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
