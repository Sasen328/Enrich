import { db } from "@workspace/db";
import { enrichmentReportsTable, companiesTable, executivesTable } from "@workspace/db";
import type { EnrichmentReport, EnrichmentReportData, EnrichmentSource } from "@workspace/db";
import { eq, ilike, or, sql } from "drizzle-orm";
import { crawlUrls } from "./crawler";
import { orchestrateCompanyEnrichment, orchestratePersonEnrichment, type OrchestratedReport, type OrchestratedPersonReport } from "./agent-orchestra";
import { getPageContent } from "../browser-helper";
import { PerplexityService } from "../perplexity-service";
import { openai } from "../openai-client";
import { nexusGenerate } from "../lib/nexus/index.js";
import { scoutSiteIntel, scoutAiExtract, scoutSignalsFull } from "../lib/scout-client.js";

const perplexity = new PerplexityService();

// Apollo API for person/company data
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

// Explorium API for deep enrichment
const EXPLORIUM_API_KEY = process.env.EXPLORIUM_API_KEY;
const EXPLORIUM_BASE_URL = "https://app.explorium.ai/api/bundle/v1";

// Helper function with timeout for API calls
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function searchApolloByLinkedIn(linkedinUrl: string): Promise<any | null> {
  if (!APOLLO_API_KEY) {
    console.log("[Apollo] API key not available for LinkedIn match");
    return null;
  }

  try {
    console.log(`[Apollo] Matching person by LinkedIn URL: ${linkedinUrl}`);
    const response = await withTimeout(
      fetch("https://api.apollo.io/v1/people/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": APOLLO_API_KEY,
        },
        body: JSON.stringify({ linkedin_url: linkedinUrl }),
      }),
      15000,
      "Apollo LinkedIn match timeout"
    );

    if (!response.ok) {
      console.log(`[Apollo] LinkedIn match returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    const person = data.person || data;
    if (person && (person.first_name || person.name)) {
      const fullName = person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim();
      console.log(`[Apollo] LinkedIn match found: ${fullName} - ${person.title || 'N/A'} at ${person.organization?.name || person.company || 'N/A'}`);
      return person;
    }

    console.log("[Apollo] LinkedIn match returned no person data");
    return null;
  } catch (error) {
    console.error("[Apollo] LinkedIn match error:", error);
    return null;
  }
}

// Apollo API Integration - Search for people
async function searchApolloForPerson(name: string, company?: string): Promise<any | null> {
  if (!APOLLO_API_KEY) {
    console.log("Apollo API key not available, using database only");
    return null;
  }
  
  try {
    console.log(`[Apollo] Searching for person: ${name}${company ? ` at ${company}` : ''}`);
    const response = await withTimeout(
      fetch("https://api.apollo.io/v1/people/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": APOLLO_API_KEY,
        },
        body: JSON.stringify({
          q_person_name: name,
          q_organization_name: company,
          per_page: 5,
        }),
      }),
      15000,
      "Apollo API timeout"
    );
    
    if (!response.ok) {
      console.log(`[Apollo] API returned ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`[Apollo] Found ${data.people?.length || 0} results`);
    return data.people?.[0] || null;
  } catch (error) {
    console.error("[Apollo] Person search error:", error);
    return null;
  }
}

// Apollo API Integration - Search for companiesTable
async function searchApolloForCompany(name: string): Promise<any | null> {
  if (!APOLLO_API_KEY) {
    console.log("Apollo API key not available, using database only");
    return null;
  }
  
  try {
    console.log(`[Apollo] Searching for company: ${name}`);
    const response = await withTimeout(
      fetch("https://api.apollo.io/v1/organizations/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": APOLLO_API_KEY,
        },
        body: JSON.stringify({
          q_organization_name: name,
          per_page: 3,
        }),
      }),
      15000,
      "Apollo API timeout"
    );
    
    if (!response.ok) {
      console.log(`[Apollo] API returned ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`[Apollo] Found ${data.organizations?.length || 0} results`);
    return data.organizations?.[0] || null;
  } catch (error) {
    console.error("[Apollo] Company search error:", error);
    return null;
  }
}

// Explorium API Integration
async function enrichWithExplorium(companyName: string, domain?: string): Promise<any | null> {
  if (!EXPLORIUM_API_KEY) {
    console.log("Explorium API key not available");
    return null;
  }
  
  try {
    console.log(`[Explorium] Enriching company: ${companyName}`);
    const response = await withTimeout(
      fetch(`${EXPLORIUM_BASE_URL}/enrich/firmographics`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api_key": EXPLORIUM_API_KEY,
        },
        body: JSON.stringify([{ company: companyName, domain: domain }]),
      }),
      20000,
      "Explorium API timeout"
    );
    
    if (!response.ok) {
      console.log(`[Explorium] API returned ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`[Explorium] Enrichment successful`);
    return Array.isArray(data) && data.length > 0 ? data[0] : data;
  } catch (error) {
    console.error("[Explorium] Enrichment error:", error);
    return null;
  }
}

interface PersonEnrichmentInput {
  name?: string;
  company?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
  email?: string;
  country?: string;
  reportType?: string;
  sourceUrls?: string[];
}

interface CompanyEnrichmentInput {
  name?: string;
  domain?: string;
  ticker?: string;
  websiteUrl?: string;
  industry?: string;
  country?: string;
  reportType?: string;
}

async function crawlWebsite(url: string): Promise<string> {
  try {
    const results = await crawlUrls([url]);
    const successfulResults = results.filter(r => r.success);
    if (successfulResults.length > 0) {
      return successfulResults.map(r => `Title: ${r.title}\n\nContent:\n${r.content}`).join('\n\n---\n\n');
    }
    return '';
  } catch (error) {
    console.error('Website crawl error:', error);
    return '';
  }
}

async function crawlMultipleUrls(urls: string[]): Promise<{ url: string; content: string }[]> {
  try {
    const results = await crawlUrls(urls);
    return results
      .filter(r => r.success)
      .map(r => ({ url: r.url, content: `Title: ${r.title}\n\nContent:\n${r.content}` }));
  } catch (error) {
    console.error('Multi-URL crawl error:', error);
    return [];
  }
}

async function searchDatabaseForPerson(name: string, company?: string) {
  const conditions = [ilike(executivesTable.name, `%${name}%`)];
  if (company) {
    conditions.push(ilike(executivesTable.companyName, `%${company}%`));
  }
  
  const results = await db.select()
    .from(executivesTable)
    .where(or(...conditions))
    .limit(10);
  
  return results;
}

async function searchDatabaseForCompany(name: string) {
  const results = await db.select()
    .from(companiesTable)
    .where(or(
      ilike((companiesTable as any).nameEn, `%${name}%`),
      ilike((companiesTable as any).nameAr, `%${name}%`)
    ))
    .limit(5);
  
  return results;
}

async function getCompanyExecutives(companyName: string) {
  const results = await db.select()
    .from(executivesTable)
    .where(ilike(executivesTable.companyName, `%${companyName}%`))
    .limit(20);
  
  return results;
}

export async function enrichPerson(input: PersonEnrichmentInput): Promise<EnrichmentReport> {
  console.log(`\n========== PERSON ENRICHMENT (MULTI-AGENT ORCHESTRA) ==========`);
  console.log(`Input: ${JSON.stringify(input)}`);
  
  let personName = input.name || '';
  let apolloPersonData: any = null;
  
  if (!personName && input.linkedinUrl) {
    console.log(`[PersonEnrichment] No name provided, resolving from LinkedIn URL: ${input.linkedinUrl}`);
    
    apolloPersonData = await searchApolloByLinkedIn(input.linkedinUrl);
    if (apolloPersonData) {
      personName = apolloPersonData.name || `${apolloPersonData.first_name || ''} ${apolloPersonData.last_name || ''}`.trim();
      if (!input.company && (apolloPersonData.organization?.name || apolloPersonData.company)) {
        input.company = apolloPersonData.organization?.name || apolloPersonData.company;
      }
      console.log(`[PersonEnrichment] Apollo LinkedIn match resolved name: ${personName}`);
    }
    
    if (!personName) {
      const linkedinMatch = input.linkedinUrl.match(/linkedin\.com\/in\/([^\/\?]+)/i);
      if (linkedinMatch) {
        const slug = linkedinMatch[1];
        const cleaned = slug.replace(/-[a-f0-9]{6,}$/i, '').replace(/-\d{3,}$/i, '');
        const words = cleaned.split('-').filter(w => w.length > 0);
        if (words.length >= 2 && words.every(w => /^[a-zA-Z]+$/.test(w))) {
          personName = words.map(word => 
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          ).join(' ');
          console.log(`[PersonEnrichment] Extracted name from LinkedIn slug: ${personName}`);
        }
      }
    }
    
    if (!personName) {
      try {
        console.log(`[PersonEnrichment] Trying Perplexity to resolve name from LinkedIn URL`);
        const response = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              { role: "system", content: "You are a research assistant. Return ONLY the person's full name, nothing else." },
              { role: "user", content: `What is the full name of the person at this LinkedIn profile: ${input.linkedinUrl}` }
            ],
            max_tokens: 100,
            temperature: 0.1,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          const resolvedName = data.choices?.[0]?.message?.content?.trim();
          if (resolvedName && resolvedName.length > 2 && resolvedName.length < 100 && !resolvedName.toLowerCase().includes('unknown') && !resolvedName.toLowerCase().includes('sorry') && !resolvedName.toLowerCase().includes('cannot')) {
            personName = resolvedName;
            console.log(`[PersonEnrichment] Perplexity resolved name: ${personName}`);
          }
        }
      } catch (e) {
        console.log(`[PersonEnrichment] Perplexity name resolution failed`);
      }
    }
    
    if (!personName) {
      personName = `Person at ${input.linkedinUrl}`;
      console.warn(`[PersonEnrichment] Could not resolve name, using descriptive fallback: ${personName}`);
    }
  }
  
  if (!personName) {
    personName = input.email || 'Unknown Person';
    console.warn(`[PersonEnrichment] No name or LinkedIn URL provided, using fallback: ${personName}`);
  }
  
  // Use the multi-agent orchestra for comprehensive data gathering
  const orchestratedReport = await orchestratePersonEnrichment(
    personName,
    input.company,
    input.linkedinUrl,
    input.websiteUrl
  );
  
  // Convert orchestrated report to enrichment report format
  const sources: EnrichmentSource[] = orchestratedReport.dataSources.map(src => ({
    title: src,
    confidence: 0.85,
    url: src.startsWith('http') ? src : undefined,
  }));
  
  // Add agent-specific source entries
  for (const agentResult of orchestratedReport.agentResults) {
    if (agentResult.status === 'success' || agentResult.status === 'partial') {
      sources.push({
        title: agentResult.agentName,
        confidence: agentResult.status === 'success' ? 0.9 : 0.7,
      });
    }
  }

  // Map orchestrated person report to EnrichmentReportData
  const reportData = {
    profileSummary: orchestratedReport.profileSummary || `Professional intelligence report for ${personName}`,
    currentRole: orchestratedReport.currentRole,
    careerHistory: orchestratedReport.careerHistory,
    education: orchestratedReport.education,
    skills: orchestratedReport.skills,
    boardPositions: orchestratedReport.boardPositions,
    certifications: orchestratedReport.certifications,
    awards: orchestratedReport.awards?.map(a => typeof a === 'string' ? a : `${a.title || 'Award'}${a.year ? ` (${a.year})` : ''}${a.organization ? ` - ${a.organization}` : ''}`),
    publications: orchestratedReport.publications?.map(p => typeof p === 'string' ? p : `${p.title || 'Publication'}${p.year ? ` (${p.year})` : ''}${p.source ? ` - ${p.source}` : ''}`),
    socialProfiles: orchestratedReport.socialProfiles ? {
      linkedin: orchestratedReport.socialProfiles.linkedin?.url,
      twitter: orchestratedReport.socialProfiles.twitter?.url,
      email: orchestratedReport.contactInfo?.email,
      phone: orchestratedReport.contactInfo?.phone,
    } : orchestratedReport.contactInfo,
    networkInsights: orchestratedReport.networkInsights ? {
      keyConnections: [],
      industryInfluence: orchestratedReport.networkInsights.influenceScore,
      thoughtLeadership: undefined,
    } : undefined,
    keyInsights: orchestratedReport.keyInsights || [],
    strengths: orchestratedReport.aiAnalysis?.strengths || [],
    recommendations: orchestratedReport.recommendations || [],
    engagementRecommendations: orchestratedReport.recommendations,
    estimatedCompensation: orchestratedReport.currentRole?.estimatedCompensation,
    companyPositioning: orchestratedReport.currentRole?.company ? 
      `${orchestratedReport.currentRole.company} - ${orchestratedReport.currentRole.title}` : undefined,
  };

  const [report] = await db.insert(enrichmentReportsTable)
    .values(({
      type: 'person',
      subjectName: orchestratedReport.personName || personName,
      subjectCompany: input.company,
      reportData,
      sources,
      confidenceScore: sources.length > 0 ? '0.85' : '0.5',
    } as any)).returning();

  return report;
}

export async function enrichCompany(input: CompanyEnrichmentInput): Promise<EnrichmentReport> {
  console.log(`\n========== COMPANY ENRICHMENT (MULTI-AGENT ORCHESTRA) ==========`);
  console.log(`Input: ${JSON.stringify(input)}`);
  
  const companyName = input.name || '';
  const websiteUrl = input.websiteUrl;

  // Launch Scout microservice in parallel with orchestra (non-blocking)
  const scoutSitePromise = websiteUrl
    ? scoutSiteIntel(websiteUrl, { followSubpages: true }).catch(() => null)
    : Promise.resolve(null);
  const scoutSignalsPromise = scoutSignalsFull(companyName, {
    includeNews: true, includeSanctions: true, includeContracts: true, maxArticles: 10,
  }).catch(() => null);
  
  // Use the multi-agent orchestra for comprehensive data gathering
  const orchestratedReport = await orchestrateCompanyEnrichment(companyName, websiteUrl);

  // Collect Scout results (should be done by now)
  const [scoutSiteData, scoutSignalsData] = await Promise.all([scoutSitePromise, scoutSignalsPromise]);
  if (scoutSiteData) {
    const contacts = [...(scoutSiteData.emails || []), ...(scoutSiteData.phones || [])];
    if (contacts.length) console.log(`[OrcEngine] Scout site: ${contacts.length} contact(s) — ${contacts.slice(0, 3).join(", ")}`);
    if (!orchestratedReport.contactInfo.email && scoutSiteData.emails?.[0]) {
      orchestratedReport.contactInfo.email = scoutSiteData.emails[0];
    }
    if (!orchestratedReport.contactInfo.phone && scoutSiteData.phones?.[0]) {
      orchestratedReport.contactInfo.phone = scoutSiteData.phones[0];
    }
  }
  if (scoutSignalsData) {
    console.log(`[OrcEngine] Scout signals: buying=${scoutSignalsData.buying_score}, risk=${scoutSignalsData.risk_score}, action=${scoutSignalsData.recommended_action}`);
  }
  
  // Convert orchestrated report to enrichment report format
  const sources: EnrichmentSource[] = orchestratedReport.dataSources.map(src => ({
    title: src,
    confidence: 0.85,
    url: src.startsWith('http') ? src : undefined,
  }));
  
  // Add agent-specific source entries
  for (const agentResult of orchestratedReport.agentResults) {
    if (agentResult.status === 'success' || agentResult.status === 'partial') {
      sources.push({
        title: agentResult.agentName,
        confidence: agentResult.status === 'success' ? 0.9 : 0.7,
      });
    }
  }
  
  // Extract founders as string array (names only) for schema compatibility
  const foundersArray: string[] = [];
  if (orchestratedReport.companyOverview.founders) {
    for (const f of orchestratedReport.companyOverview.founders) {
      if (typeof f === 'string') {
        foundersArray.push(f);
      } else if (f && typeof f === 'object' && f.name) {
        foundersArray.push(f.arabicName ? `${f.name} (${f.arabicName})` : f.name);
      }
    }
  }

  // Extract headquarters as string for schema compatibility
  let headquartersString: string | undefined;
  const hqData = orchestratedReport.locations.headquarters;
  if (typeof hqData === 'string') {
    headquartersString = hqData;
  } else if (hqData && typeof hqData === 'object') {
    const parts = [hqData.address, hqData.city, hqData.region, hqData.country].filter(Boolean);
    headquartersString = parts.join(', ') || undefined;
  }

  // Map contact info with proper type handling
  const mappedContactInfo = {
    phone: orchestratedReport.contactInfo.phone || orchestratedReport.contactInfo.mainPhone,
    email: orchestratedReport.contactInfo.email,
    website: orchestratedReport.contactInfo.website,
    investorRelations: typeof orchestratedReport.contactInfo.investorRelations === 'string' 
      ? orchestratedReport.contactInfo.investorRelations 
      : orchestratedReport.contactInfo.investorRelations?.email,
  };

  // Map headquarters object properly for companyOverview
  const mappedHQ = orchestratedReport.companyOverview.headquarters ? {
    address: orchestratedReport.companyOverview.headquarters.address,
    city: orchestratedReport.companyOverview.headquarters.city,
    country: orchestratedReport.companyOverview.headquarters.country,
    coordinates: orchestratedReport.companyOverview.headquarters.coordinates,
  } : undefined;

  const reportData = {
    profileSummary: orchestratedReport.profileSummary || `Company intelligence report for ${orchestratedReport.companyName || input.name || 'Unknown'}`,
    companyOverview: {
      legalName: orchestratedReport.companyOverview.legalName,
      tradingName: orchestratedReport.companyName,
      arabicName: orchestratedReport.arabicName || orchestratedReport.companyOverview.arabicName,
      founded: orchestratedReport.companyOverview.founded,
      founders: foundersArray.length > 0 ? foundersArray : undefined,
      headquarters: mappedHQ,
      companyType: orchestratedReport.companyOverview.companyType,
      registrationNumber: orchestratedReport.companyOverview.registrationNumber,
      stockInfo: orchestratedReport.companyOverview.stockInfo ? {
        exchange: orchestratedReport.companyOverview.stockInfo.exchange,
        ticker: orchestratedReport.companyOverview.stockInfo.ticker,
        marketCap: orchestratedReport.companyOverview.stockInfo.marketCap,
        weekHigh52: orchestratedReport.companyOverview.stockInfo.currentPrice,
      } : undefined,
    },
    financials: {
      annualRevenue: orchestratedReport.financials.revenue || orchestratedReport.financials.annualRevenue,
      revenueGrowth: orchestratedReport.financials.revenueGrowth,
      netIncome: orchestratedReport.financials.netIncome,
      profitMargin: orchestratedReport.financials.profitMargin,
      totalAssets: orchestratedReport.financials.totalAssets,
    },
    workforce: {
      totalEmployees: orchestratedReport.workforce.totalEmployees,
      employeeGrowth: orchestratedReport.workforce.employeeGrowth,
      saudiNationalsPercentage: orchestratedReport.workforce.saudizationRate,
      keyDepartments: orchestratedReport.workforce.departments,
    },
    ownership: orchestratedReport.ownership ? {
      ownershipType: orchestratedReport.ownership.ownershipType,
      majorShareholders: orchestratedReport.ownership.majorShareholders?.map(s => ({
        name: s.name,
        arabicName: s.arabicName,
        percentage: s.percentage,
        type: s.type,
      })),
      publicFloat: orchestratedReport.ownership.publicFloat,
      governmentStake: orchestratedReport.ownership.governmentStake,
      familyOwnership: orchestratedReport.ownership.familyOwnership,
    } : undefined,
    leadership: {
      boardOfDirectors: [
        ...(orchestratedReport.leadership.boardOfDirectors?.map(m => ({
          name: m.name,
          arabicName: m.arabicName,
          title: m.role,
          background: m.bio,
          otherBoards: m.otherBoards,
          aiAnalysis: m.aiAnalysis,
        })) || []),
        ...(orchestratedReport.leadership.boardMembers?.map(m => ({
          name: m.name,
          arabicName: m.arabicName,
          title: m.role,
        })) || []),
      ],
      executiveTeam: [
        // Add CEO with compensation
        orchestratedReport.leadership.ceo && {
          name: orchestratedReport.leadership.ceo.name,
          arabicName: orchestratedReport.leadership.ceo.arabicName,
          title: 'Chief Executive Officer',
          department: 'Executive',
          background: orchestratedReport.leadership.ceo.bio,
          education: orchestratedReport.leadership.ceo.education,
          linkedin: orchestratedReport.leadership.ceo.linkedin,
          email: orchestratedReport.leadership.ceo.email,
          estimatedCompensation: orchestratedReport.leadership.ceo.estimatedCompensation,
        },
        // Add Chairman
        orchestratedReport.leadership.chairman && {
          name: orchestratedReport.leadership.chairman.name,
          arabicName: orchestratedReport.leadership.chairman.arabicName,
          title: 'Chairman of the Board',
          department: 'Board',
          background: orchestratedReport.leadership.chairman.bio,
          estimatedCompensation: orchestratedReport.leadership.chairman.estimatedCompensation,
        },
        // Add CFO with compensation
        orchestratedReport.leadership.cfo && {
          name: orchestratedReport.leadership.cfo.name,
          arabicName: orchestratedReport.leadership.cfo.arabicName,
          title: 'Chief Financial Officer',
          department: 'Finance',
          background: orchestratedReport.leadership.cfo.bio,
          estimatedCompensation: orchestratedReport.leadership.cfo.estimatedCompensation,
        },
        // Add other executivesTable with compensation
        ...(orchestratedReport.leadership.executiveTeam?.map(e => ({
          name: e.name,
          arabicName: e.arabicName,
          title: e.title,
          department: e.department,
          background: e.bio,
          linkedin: e.linkedin,
          email: e.email,
          estimatedCompensation: e.estimatedCompensation,
        })) || []),
      ].filter(Boolean) as any[],
      keyPeople: [
        orchestratedReport.leadership.ceo && {
          name: orchestratedReport.leadership.ceo.name,
          title: 'Chief Executive Officer',
          significance: `Estimated Compensation: ${orchestratedReport.leadership.ceo.estimatedCompensation || 'Not disclosed'}`,
        },
        orchestratedReport.leadership.chairman && {
          name: orchestratedReport.leadership.chairman.name,
          title: 'Chairman of the Board',
          significance: `Estimated Compensation: ${orchestratedReport.leadership.chairman.estimatedCompensation || 'Not disclosed'}`,
        },
        orchestratedReport.leadership.cfo && {
          name: orchestratedReport.leadership.cfo.name,
          title: 'Chief Financial Officer',
          significance: `Estimated Compensation: ${orchestratedReport.leadership.cfo.estimatedCompensation || 'Not disclosed'}`,
        },
      ].filter(Boolean) as any[],
    },
    locations: {
      headquarters: headquartersString,
      branches: orchestratedReport.locations.branches?.map(b => ({
        city: b.city,
        country: b.country,
        type: b.type || b.name,
        employees: b.employees,
      })),
      internationalPresence: orchestratedReport.locations.internationalOffices || orchestratedReport.locations.regions,
    },
    contactInfo: mappedContactInfo,
    socialMedia: orchestratedReport.socialMedia,
    productsAndServices: {
      mainProducts: orchestratedReport.productsAndServices?.mainProducts || orchestratedReport.products || [],
      revenueStreams: orchestratedReport.productsAndServices?.revenueStreams || orchestratedReport.services || [],
      targetMarkets: orchestratedReport.productsAndServices?.targetMarkets || [],
      competitiveAdvantage: orchestratedReport.productsAndServices?.competitiveAdvantage,
    },
    competitiveLandscape: {
      directCompetitors: orchestratedReport.competitiveLandscape?.directCompetitors?.map(c => ({
        name: c.name,
        comparison: c.comparison,
      })) || orchestratedReport.competitors?.map(c => ({ name: c, comparison: undefined })) || [],
      marketShare: orchestratedReport.competitiveLandscape?.marketShare,
      competitivePosition: orchestratedReport.competitiveLandscape?.marketPosition,
    },
    swotAnalysis: orchestratedReport.swotAnalysis,
    vision2030Alignment: orchestratedReport.vision2030Alignment ? {
      relevantPillars: orchestratedReport.vision2030Alignment.relevantPillars,
      initiatives: orchestratedReport.vision2030Alignment.initiatives,
      governmentContracts: orchestratedReport.vision2030Alignment.governmentContracts,
    } : undefined,
    aiAnalysis: orchestratedReport.aiAnalysis ? {
      investmentOutlook: orchestratedReport.aiAnalysis.investmentOutlook,
      growthPotential: orchestratedReport.aiAnalysis.growthPotential,
      riskFactors: orchestratedReport.aiAnalysis.riskFactors,
      strategicRecommendations: orchestratedReport.aiAnalysis.strategicRecommendations,
      partnershipOpportunities: orchestratedReport.aiAnalysis.partnershipOpportunities,
      founderAnalysis: orchestratedReport.aiAnalysis.founderAnalysis,
      boardEffectiveness: orchestratedReport.aiAnalysis.boardEffectiveness,
      managementQuality: orchestratedReport.aiAnalysis.managementQuality,
    } : undefined,
    recentNews: orchestratedReport.recentNews,
    keyInsights: orchestratedReport.keyInsights || [],
    strengths: orchestratedReport.swotAnalysis?.strengths || [],
    recommendations: orchestratedReport.recommendations || [],
  };
  
  let subjectName = orchestratedReport.companyName || input.name || 'Unknown';
  if (!subjectName && input.websiteUrl) {
    try {
      subjectName = new URL(input.websiteUrl).hostname;
    } catch {
      subjectName = input.websiteUrl.replace(/https?:\/\//, '').split('/')[0] || 'Unknown';
    }
  }

  const [report] = await db.insert(enrichmentReportsTable)
    .values(({
      type: 'company',
      subjectName,
      reportData,
      sources,
      confidenceScore: sources.length > 0 ? '0.85' : '0.5',
    } as any)).returning();

  return report;
}

export async function getEnrichmentReport(id: string): Promise<EnrichmentReport | null> {
  const result = await db.select()
    .from(enrichmentReportsTable)
    .where(eq(enrichmentReportsTable.id, parseInt(id, 10) || 0))
    .limit(1);
  
  return result[0] || null;
}

export async function chatWithReport(reportId: string, message: string): Promise<string> {
  const report = await getEnrichmentReport(reportId);
  if (!report) {
    return "Report not found. Please generate a report first.";
  }

  const reportSystem = `You are an AI assistant helping users understand and work with enrichment reports. You have access to the full report data and can answer questions, provide additional analysis, or suggest modifications.

Current Report Type: ${report.type}
Subject: ${report.subjectName}
Report Data: ${JSON.stringify(report.reportData, null, 2)}
Sources: ${JSON.stringify(report.sources, null, 2)}
Confidence Score: ${report.confidenceScore}

Answer questions about this report, provide deeper analysis when asked, suggest improvements, or help the user understand specific aspects. Be specific and reference actual data from the report.`;

  try {
    // NEXUS synthesis tier: Gemini → Claude → GPT-4o → DeepSeek
    const nexusResult = await nexusGenerate(message, { tier: "synthesis", systemPrompt: reportSystem, maxTokens: 2000 });
    return nexusResult.text || "I couldn't generate a response. Please try again.";
  } catch {
    // Final fallback: direct OpenAI
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: reportSystem }, { role: "user", content: message }],
        max_completion_tokens: 2000,
      });
      return response.choices[0]?.message?.content || "I couldn't generate a response. Please try again.";
    } catch (error) {
      console.error('Chat with report error:', error);
      return "An error occurred while processing your question. Please try again.";
    }
  }
}

// Chat with research job for follow-up questions
export async function chatWithResearchJob(job: any, message: string): Promise<string> {
  const researchSystem = `You are an AI research assistant helping users understand and work with research reports. You have access to the full research data and can answer questions, provide additional analysis, or suggest modifications.

Research Query: ${job.query}
Report Summary: ${job.report?.summary || 'In progress'}
Report Sections: ${JSON.stringify(job.report?.sections || [], null, 2)}
Key Findings: ${JSON.stringify(job.report?.keyFindings || [], null, 2)}
Sources: ${JSON.stringify(job.sources || [], null, 2)}

Answer questions about this research, provide deeper analysis when asked, suggest improvements, or help the user understand specific aspects. Be specific and reference actual data from the research.`;

  try {
    // NEXUS synthesis tier: Gemini → Claude → GPT-4o → DeepSeek
    const nexusResult = await nexusGenerate(message, { tier: "synthesis", systemPrompt: researchSystem, maxTokens: 2000 });
    return nexusResult.text || "I couldn't generate a response. Please try again.";
  } catch {
    // Final fallback: direct OpenAI
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: researchSystem }, { role: "user", content: message }],
        max_completion_tokens: 2000,
      });
      return response.choices[0]?.message?.content || "I couldn't generate a response. Please try again.";
    } catch (error) {
      console.error('Chat with research error:', error);
      return "An error occurred while processing your question. Please try again.";
    }
  }
}

// Batch enrichment for database records
export async function enrichDatabaseCompanies(limit: number = 50): Promise<{ enriched: number; errors: number }> {
  console.log(`[Batch Enrichment] Starting company enrichment for up to ${limit} companiesTable...`);
  
  // Find companiesTable missing revenue or employee data
  const companiesNeedingEnrichment = await db.select()
    .from(companiesTable)
    .where(or(
      sql`${companiesTable.revenue} IS NULL`,
      sql`${companiesTable.employeeCount} IS NULL OR ${companiesTable.employeeCount} < 10`
    ))
    .limit(limit);
  
  console.log(`[Batch Enrichment] Found ${companiesNeedingEnrichment.length} companiesTable needing enrichment`);
  
  let enriched = 0;
  let errors = 0;
  
  for (const company of companiesNeedingEnrichment) {
    try {
      console.log(`[Batch Enrichment] Enriching company: ${(company as any).nameEn}`);
      
      // Use multiple sources in parallel
      const [apolloResult, websiteCrawlResult] = await Promise.allSettled([
        searchApolloForCompany((company as any).nameEn),
        company.website ? getPageContent(company.website, { waitMs: 5000 }) : Promise.resolve(null),
      ]);
      
      let updates: any = {};
      
      // Extract data from Apollo
      if (apolloResult.status === "fulfilled" && apolloResult.value) {
        const apollo = apolloResult.value;
        if (apollo.estimated_num_employees && !company.employeeCount) {
          updates.employeeCount = apollo.estimated_num_employees;
        }
        if (apollo.annual_revenue && !company.revenue) {
          updates.revenue = apollo.annual_revenue;
        }
      }
      
      
      // Update if we have data
      if (Object.keys(updates).length > 0) {
        await db.update(companiesTable)
          .set(updates)
          .where(eq(companiesTable.id, company.id));
        enriched++;
        console.log(`[Batch Enrichment] Updated ${(company as any).nameEn}: ${JSON.stringify(updates)}`);
      }
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      console.error(`[Batch Enrichment] Error enriching ${(company as any).nameEn}:`, error);
      errors++;
    }
  }
  
  console.log(`[Batch Enrichment] Complete: ${enriched} enriched, ${errors} errors`);
  return { enriched, errors };
}

export async function enrichDatabaseExecutives(limit: number = 100): Promise<{ enriched: number; errors: number }> {
  console.log(`[Batch Enrichment] Starting executive enrichment for up to ${limit} executivesTable...`);
  
  // Find executivesTable missing salary data
  const executivesNeedingEnrichment = await db.select()
    .from(executivesTable)
    .where(sql`${executivesTable.estimatedSalary} IS NULL OR ${executivesTable.estimatedSalary} < 100000`)
    .limit(limit);
  
  console.log(`[Batch Enrichment] Found ${executivesNeedingEnrichment.length} executivesTable needing enrichment`);
  
  let enriched = 0;
  let errors = 0;
  
  for (const exec of executivesNeedingEnrichment) {
    try {
      console.log(`[Batch Enrichment] Enriching executive: ${exec.name}`);
      
      // Get company name if available
      let companyName = "";
      if (exec.companyId) {
        const company = await db.select().from(companiesTable).where(eq(companiesTable.id, exec.companyId)).limit(1);
        companyName = (company[0] as any)?.nameEnEn || "";
      }
      
      // Use Apollo for enrichment
      const apolloResult = await searchApolloForPerson(exec.name ?? '', companyName ?? '').catch(() => null);
      
      let updates: any = {};
      
      // Estimate salary based on position and seniority
      let estimatedSalary = estimateSalaryByPosition(exec.position || "");
      
      // Extract from Apollo
      if (apolloResult) {
        if (apolloResult.linkedin_url && !exec.linkedin) {
          updates.linkedin = apolloResult.linkedin_url;
        }
        if (apolloResult.seniority) {
          estimatedSalary = adjustSalaryBySeniority(estimatedSalary, apolloResult.seniority);
        }
      }
      
      // Set estimated salary
      if (!exec.estimatedSalary || exec.estimatedSalary < 100000) {
        updates.estimatedSalary = estimatedSalary;
      }
      
      // Update if we have data
      if (Object.keys(updates).length > 0) {
        await db.update(executivesTable)
          .set(updates)
          .where(eq(executivesTable.id, exec.id));
        enriched++;
        console.log(`[Batch Enrichment] Updated ${exec.name}: ${JSON.stringify(updates)}`);
      }
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 300));
    } catch (error) {
      console.error(`[Batch Enrichment] Error enriching ${exec.name}:`, error);
      errors++;
    }
  }
  
  console.log(`[Batch Enrichment] Complete: ${enriched} enriched, ${errors} errors`);
  return { enriched, errors };
}

function estimateSalaryByPosition(position: string): number {
  const positionLower = position.toLowerCase();
  
  // C-suite executivesTable
  if (positionLower.includes("ceo") || positionLower.includes("chief executive")) {
    return 2500000 + Math.floor(Math.random() * 1500000);
  }
  if (positionLower.includes("cfo") || positionLower.includes("chief financial")) {
    return 1800000 + Math.floor(Math.random() * 800000);
  }
  if (positionLower.includes("coo") || positionLower.includes("chief operating")) {
    return 1600000 + Math.floor(Math.random() * 700000);
  }
  if (positionLower.includes("cto") || positionLower.includes("chief technology")) {
    return 1500000 + Math.floor(Math.random() * 600000);
  }
  if (positionLower.includes("cmo") || positionLower.includes("chief marketing")) {
    return 1400000 + Math.floor(Math.random() * 500000);
  }
  
  // Board and founders
  if (positionLower.includes("chairman") || positionLower.includes("founder")) {
    return 2000000 + Math.floor(Math.random() * 1000000);
  }
  if (positionLower.includes("board") || positionLower.includes("director")) {
    return 800000 + Math.floor(Math.random() * 400000);
  }
  
  // VP and SVP
  if (positionLower.includes("svp") || positionLower.includes("senior vice president")) {
    return 1200000 + Math.floor(Math.random() * 400000);
  }
  if (positionLower.includes("vp") || positionLower.includes("vice president")) {
    return 900000 + Math.floor(Math.random() * 300000);
  }
  
  // Managing Directors and Partners
  if (positionLower.includes("managing director") || positionLower.includes("partner")) {
    return 1100000 + Math.floor(Math.random() * 500000);
  }
  
  // General Manager and Head of
  if (positionLower.includes("general manager") || positionLower.includes("head of")) {
    return 700000 + Math.floor(Math.random() * 200000);
  }
  
  // Senior Manager
  if (positionLower.includes("senior manager")) {
    return 500000 + Math.floor(Math.random() * 150000);
  }
  
  // Manager
  if (positionLower.includes("manager")) {
    return 350000 + Math.floor(Math.random() * 100000);
  }
  
  // Default for other positions
  return 250000 + Math.floor(Math.random() * 100000);
}

function adjustSalaryBySeniority(baseSalary: number, seniority: string): number {
  const seniorityLower = seniority.toLowerCase();
  
  if (seniorityLower.includes("c_suite") || seniorityLower.includes("founder")) {
    return baseSalary * 1.3;
  }
  if (seniorityLower.includes("vp") || seniorityLower.includes("director")) {
    return baseSalary * 1.15;
  }
  if (seniorityLower.includes("manager")) {
    return baseSalary * 1.0;
  }
  if (seniorityLower.includes("senior")) {
    return baseSalary * 0.9;
  }
  
  return baseSalary;
}
