// SwarmBoard — Q&A wizard. Each answer maps to the agents it activates; the
// union of selected answers determines which agents join the swarm orbit.

export interface SwarmOption {
  id: string;
  label: string;
  agents: string[];
}

export interface SwarmQuestion {
  id: string;
  question: string;
  multi: boolean;
  options: SwarmOption[];
}

export const SWARM_QUESTIONS: SwarmQuestion[] = [
  {
    id: "goal",
    question: "What's your research goal?",
    multi: true,
    options: [
      { id: "discover",  label: "Discover companies", agents: ["builder", "lead-factory", "scout"] },
      { id: "enrich",    label: "Enrich profiles",    agents: ["company-intel", "masaar", "masar", "scout"] },
      { id: "contacts",  label: "Find contacts",      agents: ["person-intel", "scout", "prosengine"] },
      { id: "risks",     label: "Monitor risks",      agents: ["signals", "nexus"] },
      { id: "deep",      label: "Deep research",      agents: ["orcengine", "company-intel", "nexus", "prosengine"] },
      { id: "leadlist",  label: "Build a lead list",  agents: ["lead-factory", "scout", "signals", "prosengine"] },
    ],
  },
  {
    id: "sources",
    question: "Which data sources should we use?",
    multi: true,
    options: [
      { id: "gov",      label: "Saudi government", agents: ["masaar", "masar"] },
      { id: "tadawul",  label: "Tadawul",          agents: ["sa-market"] },
      { id: "web",      label: "Open web",         agents: ["orcengine", "scout", "signals"] },
      { id: "apollo",   label: "Apollo",           agents: ["builder", "lead-factory", "person-intel"] },
      { id: "wikidata", label: "Wikidata",         agents: ["builder", "company-intel"] },
      { id: "crawl",    label: "Deep crawl",       agents: ["orcengine", "scout", "nexus"] },
    ],
  },
  {
    id: "output",
    question: "What output do you need?",
    multi: true,
    options: [
      { id: "profiles", label: "Profiles",     agents: ["company-intel", "masaar", "masar"] },
      { id: "contacts", label: "Contacts",     agents: ["person-intel", "scout"] },
      { id: "risk",     label: "Risk reports", agents: ["signals", "orcengine"] },
      { id: "orgchart", label: "Org charts",   agents: ["sa-market", "masar"] },
      { id: "outreach", label: "Outreach",     agents: ["prosengine", "lead-factory"] },
      { id: "export",   label: "Export",       agents: ["orcengine", "prosengine"] },
    ],
  },
  {
    id: "scale",
    question: "What scale are you targeting?",
    multi: false,
    options: [
      { id: "single", label: "Single company", agents: ["orcengine", "company-intel", "person-intel", "prosengine"] },
      { id: "small",  label: "10–50",          agents: ["lead-factory", "scout", "company-intel"] },
      { id: "medium", label: "50–500",         agents: ["builder", "lead-factory", "signals", "scout"] },
      { id: "large",  label: "500+",           agents: ["builder", "lead-factory", "nexus", "scout", "sa-market"] },
    ],
  },
];

/** Resolve the set of agents activated by the chosen answer option ids. */
export function evaluateSwarm(answers: Record<string, string[]>): string[] {
  const selected = new Set<string>();
  for (const q of SWARM_QUESTIONS) {
    const picked = answers[q.id] || [];
    for (const opt of q.options) {
      if (picked.includes(opt.id)) opt.agents.forEach((a) => selected.add(a));
    }
  }
  return [...selected];
}

export const EVAL_STEPS = [
  "Analyzing goals",
  "Mapping engines",
  "Calculating swarm",
  "Building pipeline",
];
