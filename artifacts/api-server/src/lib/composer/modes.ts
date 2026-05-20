/**
 * Composer — modes registry. Each mode = system-prompt suffix + default tools
 * + default report schema. Multi-select.
 */

export interface ComposerMode {
  id: string;
  label: string;
  description: string;
  promptSuffix: string;
  defaultTools: string[];
  defaultReportSchema?: string;
}

export const MODES: ComposerMode[] = [
  {
    id: "leadgen", label: "🎯 Lead Gen",
    description: "Find people matching the ICP.",
    promptSuffix: "Focus on identifying named individuals matching the brief. Output one row per person with title, company, source URL.",
    defaultTools: ["web_search", "url_crawl", "harvester_run", "nexus_run"],
    defaultReportSchema: "LeadList",
  },
  {
    id: "enrich", label: "🧪 Enrich",
    description: "Add missing fields to existing leads/companies.",
    promptSuffix: "For each row, fill missing fields (LinkedIn, email, phone, financials) using verified sources. Leave blank if not verifiable.",
    defaultTools: ["web_search", "url_crawl"],
  },
  {
    id: "research", label: "🔍 Research",
    description: "Open-ended exploration; cite-heavy narrative.",
    promptSuffix: "Provide a detailed narrative answer with inline citations. Multiple perspectives where relevant.",
    defaultTools: ["web_search", "url_crawl", "nexus_run"],
  },
  {
    id: "extract", label: "📋 Extract",
    description: "Pull structured data only — no prose.",
    promptSuffix: "Output a single JSON object or table only. No prose. Use null for missing fields.",
    defaultTools: ["url_crawl", "nexus_run"],
  },
  {
    id: "compare", label: "⚖️ Compare",
    description: "Side-by-side comparison matrix.",
    promptSuffix: "Render a comparison matrix with columns = entities, rows = attributes. End with a 1-paragraph synthesis.",
    defaultTools: ["web_search", "nexus_run"],
    defaultReportSchema: "CompareMatrix",
  },
  {
    id: "deepdive", label: "🔬 Deep Dive",
    description: "Exhaustive multi-source dossier.",
    promptSuffix: "Be exhaustive. Cross-reference at least 5 distinct sources. Include sections for history, ownership, financials, leadership, risks, signals.",
    defaultTools: ["web_search", "url_crawl", "harvester_run", "nexus_run"],
    defaultReportSchema: "CompanyDossier",
  },
  {
    id: "signal", label: "📡 Signal Watch",
    description: "Detect buying signals (funding, hiring, leadership change).",
    promptSuffix: "Identify recent buying signals (last 90 days). For each: signal type, strength 0-100, source URL, plain-English summary.",
    defaultTools: ["web_search", "harvester_run"],
    defaultReportSchema: "SignalDigest",
  },
  {
    id: "tree", label: "🌳 Relationship Tree",
    description: "Map organisational + interpersonal relationships.",
    promptSuffix: "Build a tree: company → executives → past colleagues → investors → board interlocks. Output JSON nodes + edges.",
    defaultTools: ["web_search", "harvester_run", "nexus_run"],
  },
  {
    id: "custom", label: "🛠️ Custom",
    description: "Bring your own schema.",
    promptSuffix: "Follow the user's custom schema strictly.",
    defaultTools: ["web_search", "url_crawl", "harvester_run", "nexus_run"],
  },
];

export function findMode(id: string): ComposerMode | undefined {
  return MODES.find((m) => m.id === id);
}
