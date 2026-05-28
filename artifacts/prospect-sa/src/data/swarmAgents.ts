// SwarmBoard — the 12 ProspectSA engines, surfaced as swarm agents.
// Source of truth for the orbit visualisation, agent directory, and the
// Q&A → agent-selection logic (see swarmQuestions.ts).

export type AgentCategory =
  | "Registry" | "Outreach" | "Discovery" | "Intelligence" | "Profile";

export interface SwarmAgent {
  id: string;
  name: string;
  role: string;
  category: AgentCategory;
  description: string;
  tools: string[];
}

export const CATEGORY_COLOR: Record<AgentCategory, string> = {
  Registry:     "#D97706", // amber
  Outreach:     "#7B5EA7", // lavender
  Discovery:    "#14B8A6", // seafoam
  Intelligence: "#4A3470", // deep lavender
  Profile:      "#0EA5E9", // sky
};

export const SWARM_AGENTS: SwarmAgent[] = [
  { id: "masaar", name: "MASAAR", role: "Saudi CR Lookup", category: "Registry",
    description: "Queries the Saudi Commercial Registry by CR number. Validates company existence, extracts license data, handles captcha challenges.",
    tools: ["CR Number Lookup", "Company Validation", "License Extraction", "Captcha Solving"] },
  { id: "masar", name: "MASAR", role: "Wathq Harvester", category: "Registry",
    description: "Harvests Wathq-style CR registry data: shareholders, board members, capital, entity type.",
    tools: ["Shareholder Extraction", "Board Discovery", "Capital Lookup", "Entity Classification"] },
  { id: "prosengine", name: "PROSENGINE", role: "Conversational AI", category: "Outreach",
    description: "Conversational AI for deep research. Exports findings as PowerPoint or PDF with structured narratives.",
    tools: ["Conversational Research", "PPT Generation", "PDF Export", "Structured Narratives"] },
  { id: "builder", name: "BUILDER", role: "Database Builder", category: "Discovery",
    description: "Harvests from 14+ sources (Wikidata, Apollo, custom) into a unified company pool. Deduplication and merge orchestration.",
    tools: ["Multi-Source Harvest", "Wikidata Import", "Apollo Sync", "Deduplication"] },
  { id: "nexus", name: "NEXUS", role: "LLM Router", category: "Intelligence",
    description: "Routes LLM calls via a cost-capability waterfall. Manages the anti-detection browser mesh with proxy rotation and captcha solving.",
    tools: ["Model Routing", "Cost Optimization", "Browser Mesh", "Proxy Rotation"] },
  { id: "orcengine", name: "ORCENGINE", role: "Research Orchestrator", category: "Intelligence",
    description: "Crawls websites, aggregates news, calls the LLM to write structured reports. Exports as HTML, PDF, or PPTX.",
    tools: ["Site Crawling", "News Aggregation", "Report Writing", "Multi-Format Export"] },
  { id: "scout", name: "SCOUT", role: "OSINT Microservice", category: "Discovery",
    description: "Python OSINT microservice: site intelligence, contact discovery, subdomain enumeration, social footprint analysis.",
    tools: ["Site Intelligence", "Contact Discovery", "Subdomain Enum", "OSINT Analysis"] },
  { id: "signals", name: "SIGNALS", role: "Event Scorer", category: "Outreach",
    description: "Monitors news, sanctions, and regulatory events. Scores companies by risk and generates alerts.",
    tools: ["News Monitoring", "Sanctions Screening", "Risk Scoring", "Alert Generation"] },
  { id: "lead-factory", name: "LEAD FACTORY", role: "Lead Discovery", category: "Discovery",
    description: "7-agent pipeline: ICP mapping → harvesting → enrichment → validation → scoring → outreach → publishing.",
    tools: ["ICP Mapping", "Lead Harvesting", "AI Outreach", "Lead Publishing"] },
  { id: "company-intel", name: "COMPANY INTEL", role: "Deep Profiler", category: "Profile",
    description: "Builds 50-field deep company profiles: firmographics, financials, executives, signals, ownership structure.",
    tools: ["Profile Building", "Field Enrichment", "Firmographic Analysis", "Ownership Mapping"] },
  { id: "person-intel", name: "PERSON INTEL", role: "Executive Dossier", category: "Profile",
    description: "Creates executive dossiers: work history, social profiles, seniority assessment, contact verification.",
    tools: ["Dossier Creation", "Social Profiling", "Seniority Scoring", "Contact Verification"] },
];

export const AGENT_BY_ID: Record<string, SwarmAgent> =
  Object.fromEntries(SWARM_AGENTS.map((a) => [a.id, a]));
