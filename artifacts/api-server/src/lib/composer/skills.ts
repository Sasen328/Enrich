/**
 * Composer — skills registry. Bundled prompts + tool whitelist + report schema.
 */

export type SkillCategory = "finance" | "real" | "energy" | "people" | "compliance" | "other";

export interface ComposerSkill {
  id: string;
  label: string;
  category: SkillCategory;
  description: string;
  systemPrompt: string;
  toolWhitelist: string[];
  reportSchema: "LeadList" | "CompanyDossier" | "CompareMatrix" | "SignalDigest" | "Custom";
  modelHints?: { tier: "extraction" | "arabic" | "realtime" | "synthesis" | "bulk" };
}

export const BUILTIN_SKILLS: ComposerSkill[] = [
  {
    id: "saudi-lead-hunter", label: "🎯 Saudi Lead Hunter", category: "finance",
    description: "B2B prospects in Saudi-listed companies; prefer Arabic sources.",
    systemPrompt:
      "You are a B2B prospect researcher specialised in Saudi Arabia. 1) Honor every filter. 2) NEVER invent contact data — leave blank and flag. 3) Cite every fact with source URL. 4) Prefer Arabic-language sources for Tadawul-listed companies. 5) Halt-and-ask on filter conflict.",
    toolWhitelist: ["web_search", "url_crawl", "harvester_run", "nexus_run"],
    reportSchema: "LeadList",
    modelHints: { tier: "synthesis" },
  },
  {
    id: "tadawul-analyst", label: "📊 Tadawul Analyst", category: "finance",
    description: "Analyse and compare Tadawul-listed companies.",
    systemPrompt:
      "You analyse Tadawul-listed companies. Compare financials, board composition, ownership, sector positioning. Always cite Tadawul filings and CMA disclosures.",
    toolWhitelist: ["web_search", "url_crawl", "nexus_run"],
    reportSchema: "CompareMatrix",
  },
  {
    id: "bank-sector-compare", label: "🏦 Bank Sector Compare", category: "finance",
    description: "Compare Saudi banks across KPIs.",
    systemPrompt:
      "Compare Saudi commercial / Islamic / digital banks across capital adequacy, ROE, NPL ratio, digital maturity, and key leadership. Cite SAMA + annual reports.",
    toolWhitelist: ["web_search", "url_crawl", "nexus_run"],
    reportSchema: "CompareMatrix",
  },
  {
    id: "funding-watch", label: "💰 Funding Round Watch", category: "finance",
    description: "Track funding rounds in MENA tech.",
    systemPrompt:
      "Identify funding rounds in MENA tech. For each round: company, amount, stage, lead investor, date, source URL. Use Wamda + MAGNiTT first; Crunchbase as backup.",
    toolWhitelist: ["web_search", "url_crawl", "harvester_run"],
    reportSchema: "SignalDigest",
  },
  {
    id: "gcc-real-estate", label: "🏢 GCC Real-Estate", category: "real",
    description: "Map real-estate developers + projects across GCC.",
    systemPrompt:
      "Find GCC real-estate developers, project pipeline, ownership, key contacts. Cite REGA, Sakani, MEED Projects.",
    toolWhitelist: ["web_search", "url_crawl", "harvester_run"],
    reportSchema: "CompanyDossier",
  },
  {
    id: "tender-scout", label: "🏗️ Construction Tender Scout", category: "real",
    description: "Find tender opportunities + winning contractors.",
    systemPrompt:
      "Identify recent construction tenders in Saudi/GCC. Report: tender ID, awarding body, value, winning contractor, date.",
    toolWhitelist: ["web_search", "url_crawl"],
    reportSchema: "SignalDigest",
  },
  {
    id: "gov-vendor", label: "🏛️ Government Vendor", category: "real",
    description: "Map vendors to Saudi government entities.",
    systemPrompt:
      "Identify companies that supply Saudi government / PIF entities. Cite Etimad, government RFPs, awarded contracts.",
    toolWhitelist: ["web_search", "harvester_run"],
    reportSchema: "CompanyDossier",
  },
  {
    id: "energy-procurement", label: "🛢️ Energy Procurement", category: "energy",
    description: "Procurement decision-makers in Saudi energy.",
    systemPrompt:
      "Find procurement decision-makers in Saudi/GCC energy. Use MEED, PIF Portfolio, Aramco filings.",
    toolWhitelist: ["web_search", "harvester_run", "nexus_run"],
    reportSchema: "LeadList",
  },
  {
    id: "outreach-writer", label: "📨 Outreach Writer (Ar/En)", category: "people",
    description: "Personalised outreach drafts in Arabic + English.",
    systemPrompt:
      "Write personalised cold outreach in BOTH Arabic and English. Reference verifiable facts about the recipient and their company. Keep it short and specific.",
    toolWhitelist: ["nexus_run"],
    reportSchema: "Custom",
    modelHints: { tier: "arabic" },
  },
  {
    id: "company-dossier", label: "🔬 Company Dossier", category: "people",
    description: "Build a complete dossier for a single company.",
    systemPrompt:
      "Build a comprehensive dossier: history, ownership, financials, leadership, key partnerships, recent news, risks, signals. Cite every section.",
    toolWhitelist: ["web_search", "url_crawl", "harvester_run", "nexus_run"],
    reportSchema: "CompanyDossier",
    modelHints: { tier: "synthesis" },
  },
  {
    id: "signal-hunter", label: "📡 Signal Hunter", category: "people",
    description: "Hunt buying signals across companies.",
    systemPrompt:
      "Identify recent buying signals (hiring, funding, leadership change, expansion). Score 0-100 by strength. Cite source.",
    toolWhitelist: ["web_search", "harvester_run"],
    reportSchema: "SignalDigest",
  },
  {
    id: "pep-check", label: "⚖️ PEP Check", category: "compliance",
    description: "Politically-exposed-person screening.",
    systemPrompt:
      "Check the named individual / company against PEP databases + sanctions lists. Report exact match, fuzzy match, and adverse-media findings. Never assume — only report verified matches.",
    toolWhitelist: ["harvester_run", "url_crawl"],
    reportSchema: "Custom",
  },
  {
    id: "sanctions-screen", label: "🛡️ Sanctions Screen", category: "compliance",
    description: "Screen entity against OFAC / UN / EU sanctions.",
    systemPrompt:
      "Screen the entity against OFAC SDN, UN Consolidated, EU Sanctions, OpenSanctions. Report match confidence + source list.",
    toolWhitelist: ["harvester_run"],
    reportSchema: "Custom",
  },
  {
    id: "healthcare-vendor", label: "💊 Healthcare Vendor Map", category: "other",
    description: "Map healthcare vendors + their decision-makers.",
    systemPrompt:
      "Identify healthcare providers / vendors in Saudi/GCC. Capture: facility type, beds (if hospital), procurement head, recent equipment purchases.",
    toolWhitelist: ["web_search", "url_crawl"],
    reportSchema: "CompanyDossier",
  },
  {
    id: "edtech-prospects", label: "🎓 EdTech Prospects", category: "other",
    description: "EdTech prospects in MENA.",
    systemPrompt: "Find EdTech companies + their CTOs/Heads of Product in MENA.",
    toolWhitelist: ["web_search", "url_crawl"],
    reportSchema: "LeadList",
  },
  {
    id: "retail-buyer", label: "🛒 Retail Buyer Finder", category: "other",
    description: "Find buying heads at GCC retailers.",
    systemPrompt: "Identify Heads of Buying / Category Managers at top GCC retailers across F&B, Fashion, Electronics.",
    toolWhitelist: ["web_search", "url_crawl"],
    reportSchema: "LeadList",
  },
];

export function findSkill(id: string): ComposerSkill | undefined {
  return BUILTIN_SKILLS.find((s) => s.id === id);
}
