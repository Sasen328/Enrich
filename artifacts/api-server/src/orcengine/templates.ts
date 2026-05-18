import { db } from "@workspace/db";
import { templatesTable } from "@workspace/db";
import type { ResearchTemplate, TemplateConfig } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { orchestrateCompanyEnrichment, orchestratePersonEnrichment } from "./agent-orchestra";

interface CreateTemplateInput {
  name: string;
  description?: string;
  category: string;
  config?: TemplateConfig;
}

const BUILTIN_TEMPLATES: Omit<ResearchTemplate, 'id' | 'createdAt'>[] = [
  {
    name: "Company Deep Dive",
    description: "Comprehensive analysis of a Saudi company including financials, leadership, and market position",
    category: "company",
    config: {
      sections: ["Overview", "Financial Analysis", "Leadership", "Market Position", "SWOT Analysis", "Recommendations"],
      dataSources: ["argaam.com", "saudiexchange.sa", "zawya.com"],
    },
    isBuiltin: true,
  },
  {
    name: "Executive Profile",
    description: "Detailed profile of a Saudi business executive including career history and network",
    category: "executive",
    config: {
      sections: ["Biography", "Career History", "Education", "Board Memberships", "Notable Achievements", "Network Analysis"],
      dataSources: ["linkedin.com", "arabnews.com", "argaam.com"],
    },
    isBuiltin: true,
  },
  {
    name: "Competitive Landscape",
    description: "Analysis of competitors in a specific Saudi market sector",
    category: "competitor",
    config: {
      sections: ["Market Overview", "Key Players", "Market Share Analysis", "Competitive Advantages", "Threats & Opportunities"],
      dataSources: ["argaam.com", "saudiexchange.sa", "zawya.com"],
    },
    isBuiltin: true,
  },
  {
    name: "Investment Thesis",
    description: "Investment analysis for a Saudi company with financial projections",
    category: "investment",
    config: {
      sections: ["Investment Summary", "Financial Performance", "Valuation Analysis", "Risk Assessment", "Growth Catalysts", "Recommendation"],
      dataSources: ["saudiexchange.sa", "argaam.com", "bloomberg.com"],
    },
    isBuiltin: true,
  },
  {
    name: "Market Entry Analysis",
    description: "Assessment for entering a specific Saudi market sector",
    category: "market",
    config: {
      sections: ["Market Size & Growth", "Regulatory Environment", "Competitive Landscape", "Entry Barriers", "Vision 2030 Alignment", "Recommendations"],
      dataSources: ["vision2030.gov.sa", "mci.gov.sa", "argaam.com"],
    },
    isBuiltin: true,
  },
  {
    name: "GCC IPO Analysis",
    description: "Pre-IPO and post-IPO analysis for companiesTable listing on TASI or NoMU",
    category: "ipo",
    config: {
      sections: ["Company Overview", "IPO Details", "Financial Health", "Valuation Assessment", "Market Conditions", "Comparable IPOs", "Investment Recommendation"],
      dataSources: ["saudiexchange.sa", "cma.org.sa", "argaam.com", "zawya.com"],
      prompts: {
        overview: "Analyze the company's business model, history, and market position in the Saudi context.",
        valuation: "Compare IPO pricing to industry peers and historical GCC IPO performance.",
      },
    },
    isBuiltin: true,
  },
  {
    name: "TASI Sector Report",
    description: "Comprehensive analysis of a TASI sector with all listed companiesTable",
    category: "market",
    config: {
      sections: ["Sector Overview", "Key Players", "Financial Comparison", "Regulatory Impact", "Sector Outlook", "Top Picks"],
      dataSources: ["saudiexchange.sa", "argaam.com"],
    },
    isBuiltin: true,
  },
  {
    name: "NoMU Growth Stock Analysis",
    description: "Analysis of growth companiesTable on the Parallel Market (NoMU)",
    category: "ipo",
    config: {
      sections: ["Company Profile", "Growth Metrics", "Financial Analysis", "Management Quality", "Graduation Potential", "Investment Case"],
      dataSources: ["saudiexchange.sa", "argaam.com"],
    },
    isBuiltin: true,
  },
];

export async function seedBuiltinTemplates(): Promise<void> {
  for (const template of BUILTIN_TEMPLATES) {
    const existing = await db.select()
      .from(templatesTable)
      .where(sql`${templatesTable.name} = ${template.name} AND ${templatesTable.isBuiltin} = true`)
      .limit(1);
    
    if (existing.length === 0) {
      await db.insert(templatesTable).values(template);
    }
  }
}

export async function getTemplates(category?: string): Promise<ResearchTemplate[]> {
  if (category) {
    return db.select()
      .from(templatesTable)
      .where(sql`${templatesTable.category} = ${category}`);
  }
  return db.select().from(templatesTable);
}

export async function getTemplateById(id: string): Promise<ResearchTemplate | null> {
  const result = await db.select()
    .from(templatesTable)
    .where(eq(templatesTable.id, parseInt(id, 10) || 0))
    .limit(1);
  
  return result[0] || null;
}

export async function createTemplate(input: CreateTemplateInput): Promise<ResearchTemplate> {
  const [template] = await db.insert(templatesTable)
    .values(({
      name: input.name,
      description: input.description,
      category: input.category,
      config: input.config,
      isBuiltin: false,
    } as any))
    .returning();
  
  return template;
}

// Execute a template with multi-agent orchestration
export async function executeTemplate(
  templateId: string,
  targetName: string,
  targetWebsite?: string
): Promise<any> {
  const template = await getTemplateById(templateId);
  if (!template) {
    throw new Error("Template not found");
  }
  
  console.log(`[Templates] Executing template "${template.name}" for: ${targetName}`);
  console.log(`[Templates] Category: ${template.category}`);
  console.log(`[Templates] Sections: ${(template.config as any)?.sections?.join(', ')}`);
  
  // Determine which orchestration to use based on template category
  let result: any;
  
  switch (template.category) {
    case 'executive':
      // Use person enrichment for executive profiles
      result = await orchestratePersonEnrichment(targetName, undefined, targetWebsite);
      break;
      
    case 'company':
    case 'investment':
    case 'competitor':
    case 'ipo':
    case 'market':
    default:
      // Use company enrichment for company-related templates
      result = await orchestrateCompanyEnrichment(targetName, targetWebsite);
      break;
  }
  
  // Add template metadata to the result
  return {
    templateId: template.id,
    templateName: template.name,
    templateCategory: template.category,
    requestedSections: (template.config as any)?.sections || [],
    dataSources: (template.config as any)?.dataSources || [],
    ...result,
    executedAt: new Date().toISOString(),
  };
}
