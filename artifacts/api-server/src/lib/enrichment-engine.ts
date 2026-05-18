import { openai } from "./openai.js";
import { scrapeWebsiteContacts, validateWebsiteIsReal, validateAndCleanData } from "./scraper.js";
import { enrichCompanyWithApollo } from "./apollo-service.js";
import { enrichCompanyWithExplorium, findContactsWithExplorium, isExploriumConfigured } from "./explorium-service.js";
import { researchCompanyWithPerplexity, searchNewsWithPerplexity, researchOwnerWithPerplexity, researchExecutivesWithPerplexity, researchRevenueWithPerplexity, researchShareholdersWithPerplexity, isPerplexityConfigured } from "./perplexity-enrichment.js";
import { enrichWithClaude, isAnthropicConfigured } from "./anthropic-service.js";
import { synthesizeWithGemini, isGeminiConfigured } from "../gemini-search.js";
import { enrichWithFreeSources, type FreeSourceEnrichmentResult } from "./free-sources.js";
import { nexusGenerate, nexusSynthesize } from "./nexus/index.js";
import { scoutSiteIntel, scoutSignalsFull } from "./scout-client.js";

export interface CompanyEnrichmentInput {
  nameAr?: string | null;
  nameEn?: string | null;
  website?: string | null;
  city?: string | null;
  industry?: string | null;
  crNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  contextBlock?: string;
}

export interface EnrichedCompanyData {
  nameAr?: string;
  nameEn?: string;
  industry?: string;
  industryAr?: string;
  city?: string;
  region?: string;
  address?: string;
  website?: string;
  phone?: string;
  email?: string;
  description?: string;
  descriptionAr?: string;
  employeeCount?: number;
  revenue?: string;
  foundingYear?: number;
  crNumber?: string;
  capitalAmount?: string;
  entityType?: string;
  companyType?: string;
  ownerName?: string;
  ownerNameAr?: string;
  ownerTitle?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  ownerLinkedin?: string;
  estimatedWealth?: string;
  shareholders?: string;
  keyExecutives?: string;
  marketPositioning?: string;
  recentNews?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  enrichmentScore?: number;
  enrichmentStatus?: string;
}

export async function enrichCompanyWithAI(
  input: CompanyEnrichmentInput,
  depth: "basic" | "standard" | "deep" = "standard"
): Promise<EnrichedCompanyData> {
  const companyName = input.nameEn || input.nameAr || "Unknown Company";
  const websiteDomain = input.website
    ? input.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    : undefined;

  console.log(`[Enrichment] Starting multi-source enrichment for: ${companyName}`);

  // Start free sources (GLEIF, OpenCorporates, Wikidata, Clearbit, GitHub, Hunter, Tadawul)
  // in parallel with the main Phase 1 block — no await yet
  const freeSourcesPromise = enrichWithFreeSources(companyName, websiteDomain || undefined).catch(() => null as FreeSourceEnrichmentResult | null);

  // Scout microservice — site intel + signal scan in background (non-blocking)
  const scoutSitePromise = input.website
    ? scoutSiteIntel(input.website, { followSubpages: true }).catch(() => null)
    : Promise.resolve(null);
  const scoutSignalsPromise = scoutSignalsFull(companyName, {
    companyNameAr: input.nameAr || undefined,
    domain: websiteDomain,
    includeNews: true,
    includeSanctions: true,
    includeContracts: true,
    maxArticles: 10,
  }).catch(() => null);

  // ── Phase 1: Parallel data gathering from all configured sources ─────────
  const [
    scrapedContactsRaw,
    apolloData,
    exploriumData,
    exploriumContacts,
    perplexityResearch,
    perplexityNews,
    perplexityOwner,
    perplexityExecs,
    perplexityRevenue,
    perplexityShareholders,
  ] = await Promise.allSettled([
    input.website
      ? validateWebsiteIsReal(input.website).then((ok) =>
          ok ? scrapeWebsiteContacts(input.website!) : {}
        )
      : Promise.resolve({}),
    enrichCompanyWithApollo(websiteDomain, companyName),
    isExploriumConfigured()
      ? enrichCompanyWithExplorium(websiteDomain, companyName)
      : Promise.resolve(null),
    isExploriumConfigured() && websiteDomain
      ? findContactsWithExplorium(websiteDomain, 3)
      : Promise.resolve([]),
    // Perplexity #1 — general profile
    isPerplexityConfigured()
      ? researchCompanyWithPerplexity(companyName)
      : Promise.resolve(null),
    // Perplexity #2 — recent news
    isPerplexityConfigured() && depth !== "basic"
      ? searchNewsWithPerplexity(companyName)
      : Promise.resolve(null),
    // Perplexity #3 — owner / founder profile with wealth estimate
    isPerplexityConfigured() && depth !== "basic"
      ? researchOwnerWithPerplexity(companyName, input.crNumber)
      : Promise.resolve(null),
    // Perplexity #4 — key executives & board
    isPerplexityConfigured() && depth !== "basic"
      ? researchExecutivesWithPerplexity(companyName, input.crNumber, input.city)
      : Promise.resolve(null),
    // Perplexity #5 — revenue & financial signals (derives estimate from capital + employees)
    isPerplexityConfigured() && depth !== "basic"
      ? researchRevenueWithPerplexity(companyName, input.crNumber ? `CR ${input.crNumber}` : null, null)
      : Promise.resolve(null),
    // Perplexity #6 — shareholders & ownership structure
    isPerplexityConfigured() && depth !== "basic"
      ? researchShareholdersWithPerplexity(companyName, input.crNumber)
      : Promise.resolve(null),
  ]);

  const scrapedContacts = scrapedContactsRaw.status === "fulfilled" ? scrapedContactsRaw.value : {};
  const apollo = apolloData.status === "fulfilled" ? apolloData.value : null;
  const explorium = exploriumData.status === "fulfilled" ? exploriumData.value : null;
  const expContacts = exploriumContacts.status === "fulfilled" ? exploriumContacts.value : [];
  const perplexityText = perplexityResearch.status === "fulfilled" ? perplexityResearch.value : null;
  const newsText = perplexityNews.status === "fulfilled" ? perplexityNews.value : null;
  const ownerText = perplexityOwner.status === "fulfilled" ? perplexityOwner.value : null;
  const execsText = perplexityExecs.status === "fulfilled" ? perplexityExecs.value : null;
  const revenueText = perplexityRevenue.status === "fulfilled" ? perplexityRevenue.value : null;
  const shareholdersText = perplexityShareholders.status === "fulfilled" ? perplexityShareholders.value : null;

  // Log which sources returned data
  const sources = [
    apollo ? "Apollo" : null,
    explorium ? "Explorium" : null,
    perplexityText ? "Perplexity-Profile" : null,
    ownerText ? "Perplexity-Owner" : null,
    execsText ? "Perplexity-Execs" : null,
    revenueText ? "Perplexity-Revenue" : null,
    shareholdersText ? "Perplexity-Shareholders" : null,
    Object.keys(scrapedContacts).length > 0 ? "WebScrape" : null,
  ].filter(Boolean);
  if (sources.length > 0) console.log(`[Enrichment] Data gathered from: ${sources.join(", ")}`);

  // ── Phase 2: Build enriched context for AI synthesis ────────────────────
  const contextParts: string[] = [];

  if (Object.keys(scrapedContacts).length > 0) {
    contextParts.push(`Verified website data: ${JSON.stringify(scrapedContacts)}`);
  }
  if (apollo) {
    contextParts.push(`Apollo.io data: ${JSON.stringify(apollo)}`);
  }
  if (explorium) {
    contextParts.push(`Explorium business data: ${JSON.stringify(explorium)}`);
  }
  if (expContacts.length > 0) {
    contextParts.push(`Explorium contacts: ${JSON.stringify(expContacts)}`);
  }
  if (perplexityText) {
    contextParts.push(`[Perplexity: Company Profile]\n${perplexityText}`);
  }
  if (ownerText) {
    contextParts.push(`[Perplexity: Owner & Founder Profile]\n${ownerText}`);
  }
  if (execsText) {
    contextParts.push(`[Perplexity: Key Executives & Board]\n${execsText}`);
  }
  if (revenueText) {
    contextParts.push(`[Perplexity: Revenue & Financial Signals]\n${revenueText}`);
  }
  if (shareholdersText) {
    contextParts.push(`[Perplexity: Shareholders & Ownership]\n${shareholdersText}`);
  }
  if (newsText) {
    contextParts.push(`[Perplexity: Recent News]\n${newsText}`);
  }

  // ── Free sources (GLEIF, OpenCorporates, Wikidata, GitHub, Hunter, Tadawul) ──
  const freeData = await freeSourcesPromise;
  if (freeData?.gleif) {
    const g = freeData.gleif;
    contextParts.push(`[GLEIF: Legal Entity] LEI: ${g.lei} | Name: ${g.legalName} | Status: ${g.status}${g.legalForm ? ` | Legal form: ${g.legalForm}` : ""}${g.registrationAuthority ? ` | Reg. authority: ${g.registrationAuthority}` : ""}`);
  }
  if (freeData?.opencorporates) {
    const oc = freeData.opencorporates;
    contextParts.push(`[OpenCorporates: Registry] CR/Reg: ${oc.crNumber || "(unknown)"} | Founded: ${oc.foundingYear || "(unknown)"} | Status: ${oc.status || "(unknown)"} | Type: ${oc.companyType || "(unknown)"}${oc.registeredAddress ? ` | Address: ${oc.registeredAddress}` : ""}`);
  }
  if (freeData?.wikidata) {
    const w = freeData.wikidata;
    const wParts = [
      w.foundingYear ? `Founded: ${w.foundingYear}` : null,
      w.employees ? `Employees: ${w.employees}` : null,
      w.headquarters ? `HQ: ${w.headquarters}` : null,
      w.ceo ? `CEO: ${w.ceo}` : null,
      w.isin ? `ISIN: ${w.isin}` : null,
      w.stockExchange ? `Exchange: ${w.stockExchange}` : null,
      w.description ? `Description: ${w.description}` : null,
    ].filter(Boolean);
    if (wParts.length) contextParts.push(`[Wikidata: Structured Knowledge] ${wParts.join(" | ")}`);
  }
  if (freeData?.tadawul) {
    const t = freeData.tadawul;
    const tParts = [
      t.ticker ? `Ticker: ${t.ticker}` : null,
      t.isin ? `ISIN: ${t.isin}` : null,
      t.sector ? `Sector: ${t.sector}` : null,
      t.listedMarket ? `Listed: ${t.listedMarket}` : null,
      t.marketCap ? `Market cap: ${t.marketCap}` : null,
    ].filter(Boolean);
    if (tParts.length) contextParts.push(`[Tadawul/Saudi Exchange: Listed Company] ${tParts.join(" | ")}`);
  }
  if (freeData?.github) {
    const gh = freeData.github;
    const ghParts = [
      gh.techSignals?.length ? `Tech stack: ${gh.techSignals.join(", ")}` : null,
      gh.hiringSignals?.length ? `Hiring repos: ${gh.hiringSignals.join(", ")}` : null,
      gh.publicRepos ? `Open source repos: ${gh.publicRepos}` : null,
      gh.description ? `GitHub description: ${gh.description}` : null,
    ].filter(Boolean);
    if (ghParts.length) contextParts.push(`[GitHub: Tech & Hiring Signals] ${ghParts.join(" | ")}`);
  }
  if (freeData?.hunter?.emails?.length) {
    const hEmails = freeData.hunter.emails.slice(0, 5).map(e => `${e.value}${e.position ? " (" + e.position + ", conf:" + e.confidence + "%)" : ""}`).join(", ");
    contextParts.push(`[Hunter.io: Email Intelligence] Pattern: ${freeData.hunter.emailPattern || "unknown"} | Emails: ${hEmails}`);
  }
  const loggedFreeSources = [
    freeData?.gleif ? "GLEIF" : null,
    freeData?.opencorporates ? "OpenCorporates" : null,
    freeData?.wikidata ? "Wikidata" : null,
    freeData?.tadawul ? "Tadawul" : null,
    freeData?.github ? "GitHub" : null,
    freeData?.hunter?.emails?.length ? "Hunter.io" : null,
    freeData?.logoUrl ? "Clearbit-Logo" : null,
  ].filter(Boolean);
  if (loggedFreeSources.length) console.log(`[Enrichment] Free sources: ${loggedFreeSources.join(", ")}`);

  // ── Scout microservice results ────────────────────────────────────────────
  const [scoutSite, scoutSignals] = await Promise.all([scoutSitePromise, scoutSignalsPromise]);

  if (scoutSite) {
    const siteParts: string[] = [];
    if (scoutSite.emails?.length) siteParts.push(`Emails: ${scoutSite.emails.slice(0, 5).join(", ")}`);
    if (scoutSite.phones?.length) siteParts.push(`Phones: ${scoutSite.phones.slice(0, 3).join(", ")}`);
    if (scoutSite.cr_vat?.cr_number) siteParts.push(`CR: ${scoutSite.cr_vat.cr_number}`);
    if (scoutSite.cr_vat?.vat_number) siteParts.push(`VAT: ${scoutSite.cr_vat.vat_number}`);
    if (scoutSite.tech_stack?.length) siteParts.push(`Tech: ${scoutSite.tech_stack.join(", ")}`);
    if (scoutSite.language) siteParts.push(`Site language: ${scoutSite.language}`);
    if (Object.keys(scoutSite.socials || {}).length) siteParts.push(`Socials: ${Object.entries(scoutSite.socials).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    if (scoutSite.meta?.description) siteParts.push(`Description: ${scoutSite.meta.description}`);
    if (siteParts.length) {
      contextParts.push(`[Scout: Live Site Intel]\n${siteParts.join(" | ")}`);
      console.log(`[Enrichment] Scout site intel: ${siteParts.length} data points`);
    }
  }

  if (scoutSignals) {
    const sigParts: string[] = [
      `Buying score: ${scoutSignals.buying_score}/10`,
      `Risk score: ${scoutSignals.risk_score}/10`,
      `Action: ${scoutSignals.recommended_action}`,
      `Sanctioned: ${scoutSignals.is_sanctioned ? "YES — DISQUALIFY" : "No"}`,
      `Positive signals: ${scoutSignals.positive_signals_count}`,
      `Negative signals: ${scoutSignals.negative_signals_count}`,
    ];
    const topNews = (scoutSignals.streams?.news?.articles || []).filter(a => a.category !== "neutral").slice(0, 3);
    for (const art of topNews) {
      sigParts.push(`[${art.category}] ${art.title.slice(0, 80)} (${art.event_types.join(",")})`);
    }
    contextParts.push(`[Scout: Signal Intelligence]\n${sigParts.join(" | ")}`);
    console.log(`[Enrichment] Scout signals: buying=${scoutSignals.buying_score}, risk=${scoutSignals.risk_score}, action=${scoutSignals.recommended_action}`);
  }

  // Merge pre-built contextBlock from input (e.g. from reEnrichCompany with Perplexity + stealth browser data)
  if (input.contextBlock) contextParts.push(input.contextBlock);

  const contextBlock = contextParts.length > 0
    ? `\n\nGathered intelligence from external sources:\n${contextParts.join("\n\n")}`
    : "";

  const depthInstructions = {
    basic: "Provide basic company information: names, industry, city, description (2-3 sentences each language), estimated employees.",
    standard: "Provide comprehensive data: names (EN+AR), industry (EN+AR), city, region, description, employee count, MANDATORY revenue range in SAR (derive from capital/employees if not stated), founding year, entity type, company type, primary owner full name (EN+AR) with title, key executives (2-3 with titles), market positioning, recent news. Revenue MUST be a derived range — never empty.",
    deep: "Provide ALL data with maximum depth: full bilingual names, industry (EN+AR), city, region, address, description (EN+AR 3-4 sentences), employee count, MANDATORY revenue range derived from capital/employees/benchmarks (never empty), founding year, CR if public, capital, entity type, company type, PRIMARY OWNER full name EN+AR with title + estimated personal wealth, ALL shareholders with % (JSON array), ALL key executives + board (JSON array), market positioning, recent news (JSON array), LinkedIn URL.",
  };

  const prompt = `You are an elite Saudi Arabia B2B intelligence analyst. Enrich this Saudi company using ALL intelligence data gathered below.

Company: ${companyName}
Known input data: ${JSON.stringify({ ...input, website: input.website || "(unknown)" })}${contextBlock}

Instructions: ${depthInstructions[depth]}

CRITICAL RULES — FOLLOW EXACTLY:
1. DATA PRIORITY: Use [Perplexity: Owner], [Perplexity: Executives], [Perplexity: Shareholders], [Perplexity: Revenue] sections as primary sources. Apollo/Explorium/WebScrape are ground truth for contacts.
2. ownerName / ownerNameAr: Scan ALL research sections. If ANY person is named as CEO, GM, founder, chairman, partner, or majority shareholder → put them in ownerName/ownerNameAr. Arabic name is critical.
3. keyExecutives: Extract every named person from [Perplexity: Executives] and [Perplexity: Shareholders]. Include nameAr (Arabic script). JSON array: [{name, nameAr, title}].
4. shareholders: Extract every named shareholder with percentage from [Perplexity: Shareholders]. JSON array: [{name, nameAr, percentage}].
5. estimatedWealth: From [Perplexity: Owner] if available. Otherwise estimate: majority owner wealth = company valuation (capital × 15-30x) × ownership %. e.g. SAR 5M capital, 100% owner → "SAR 75M - 150M estimated".
6. revenue — MANDATORY, NEVER EMPTY OR NULL:
   - Stated in research → use it directly
   - Not stated → DERIVE using benchmarks for Saudi Arabia:
     * Service/consulting/IT: capital × 10-20x  OR  employees × SAR 800K-1.5M/person
     * Trading/distribution: capital × 5-12x  OR  employees × SAR 1.5-4M/person
     * Construction/contracting: capital × 4-10x  OR  employees × SAR 1-2M/person
     * Manufacturing: capital × 4-8x
   - Format: "SAR X - Y million". If capital is SAR 1M → "SAR 10M - 20M". Always a range.
7. Phone numbers: real Saudi format only (+966, 05x, 01x). Omit if unsure.
8. Never fabricate phone/email/CR numbers.

Respond with a valid JSON object (all fields present):
{"nameAr":"","nameEn":"","industry":"","industryAr":"","city":"","region":"","address":"street/district/city or null","description":"3-4 sentences","descriptionAr":"3-4 جمل","employeeCount":0,"revenue":"SAR X-Y million — MANDATORY","foundingYear":0,"crNumber":"","capitalAmount":"","entityType":"","companyType":"","ownerName":"Full EN name of primary owner/founder","ownerNameAr":"الاسم الكامل بالعربية","ownerTitle":"Chairman/CEO/Founder/Partner","estimatedWealth":"SAR X-Y million estimated","shareholders":"[{\"name\":\"\",\"nameAr\":\"\",\"percentage\":\"X%\"}]","keyExecutives":"[{\"name\":\"\",\"nameAr\":\"\",\"title\":\"\"}]","marketPositioning":"2-3 sentences","recentNews":"[{\"headline\":\"\",\"date\":\"\",\"summary\":\"\"}]","linkedinUrl":"","twitterUrl":""}`;

  // ── Phase 3: AI synthesis — Gemini (1st) + Claude (2nd) + GPT-4o (3rd) + NEXUS (4th) in PARALLEL ──
  let enriched: EnrichedCompanyData = { enrichmentScore: 0, enrichmentStatus: "pending" };
  const synthSystem = "You are an elite Saudi Arabia B2B intelligence analyst. Return ONLY a valid JSON object matching the schema, no markdown, no explanation.";

  const [geminiResult, claudeResult, openaiResult, nexusResult] = await Promise.allSettled([
    isGeminiConfigured()
      ? synthesizeWithGemini(prompt, synthSystem, "gemini-2.5-pro")
      : Promise.resolve(null),
    isAnthropicConfigured()
      ? enrichWithClaude(companyName, { ...input, contextBlock } as Record<string, unknown>, depth)
      : Promise.resolve(null),
    openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
    // NEXUS extraction tier: DeepSeek → Groq → Qwen as cheap parallel signal
    nexusSynthesize(prompt, synthSystem, { maxTokens: 3000, temperature: 0 }),
  ]);

  let geminiData: EnrichedCompanyData | null = null;
  let claudeData: EnrichedCompanyData | null = null;
  let openaiData: EnrichedCompanyData | null = null;
  let nexusData: EnrichedCompanyData | null = null;

  if (geminiResult.status === "fulfilled" && geminiResult.value) {
    try {
      const raw = geminiResult.value;
      const match = raw.match(/\{[\s\S]*\}/);
      geminiData = match ? JSON.parse(match[0]) as EnrichedCompanyData : null;
      if (geminiData) console.log(`[Enrichment] Gemini synthesis complete for: ${companyName}`);
    } catch { /* ignore */ }
  }

  if (claudeResult.status === "fulfilled" && claudeResult.value) {
    claudeData = claudeResult.value as EnrichedCompanyData;
    console.log(`[Enrichment] Claude synthesis complete for: ${companyName}`);
  }

  if (openaiResult.status === "fulfilled") {
    try {
      const content = openaiResult.value.choices[0]?.message?.content || "{}";
      openaiData = JSON.parse(content) as EnrichedCompanyData;
      console.log(`[Enrichment] GPT-4o synthesis complete for: ${companyName}`);
    } catch { /* ignore */ }
  } else {
    console.warn(`[Enrichment] GPT-4o failed: ${openaiResult.reason instanceof Error ? openaiResult.reason.message : openaiResult.reason}`);
  }

  if (nexusResult.status === "fulfilled" && nexusResult.value) {
    try {
      const raw = nexusResult.value.text;
      const match = raw.match(/\{[\s\S]*\}/);
      nexusData = match ? JSON.parse(match[0]) as EnrichedCompanyData : null;
      if (nexusData) console.log(`[Enrichment] NEXUS synthesis complete via ${nexusResult.value.provider}/${nexusResult.value.model}`);
    } catch { /* ignore */ }
  }

  // Merge strategy: Gemini (1st) → Claude (2nd, wins people/ownership) → GPT-4o (3rd) → NEXUS (4th fills gaps)
  const fillAllFields = ["nameAr","nameEn","industry","industryAr","city","region","description","descriptionAr","employeeCount","revenue","foundingYear","crNumber","capitalAmount","entityType","companyType","ownerName","ownerNameAr","ownerTitle","estimatedWealth","shareholders","keyExecutives","marketPositioning","recentNews","linkedinUrl","twitterUrl"] as const;
  if (geminiData) enriched = { ...geminiData };
  if (claudeData) {
    // Claude is strongest on people/ownership — always wins these fields
    if (claudeData.ownerName) enriched.ownerName = claudeData.ownerName;
    if (claudeData.ownerNameAr) enriched.ownerNameAr = claudeData.ownerNameAr;
    if (claudeData.ownerTitle) enriched.ownerTitle = claudeData.ownerTitle;
    if (claudeData.shareholders) enriched.shareholders = claudeData.shareholders;
    if (claudeData.keyExecutives) enriched.keyExecutives = claudeData.keyExecutives;
    if (claudeData.estimatedWealth) enriched.estimatedWealth = claudeData.estimatedWealth;
    for (const f of fillAllFields) {
      if (!enriched[f] && claudeData[f]) (enriched as Record<string, unknown>)[f] = claudeData[f];
    }
  }
  if (openaiData) {
    for (const f of fillAllFields) {
      if (!enriched[f] && openaiData[f]) (enriched as Record<string, unknown>)[f] = openaiData[f];
    }
  }
  // NEXUS fills any remaining gaps last
  if (nexusData) {
    for (const f of fillAllFields) {
      if (!enriched[f] && nexusData[f]) (enriched as Record<string, unknown>)[f] = nexusData[f];
    }
  }

  if (!geminiData && !claudeData && !openaiData && !nexusData) {
    console.warn(`[Enrichment] All four AI providers failed for: ${companyName}`);
  }

  // ── Phase 4: Ground-truth override from scraped / structured sources ────
  const sc = scrapedContacts as { phone?: string; email?: string };
  if (sc.phone) enriched.phone = sc.phone;
  if (sc.email) enriched.email = sc.email;
  if (apollo?.phone && !enriched.phone) enriched.phone = apollo.phone;
  if (explorium?.phone && !enriched.phone) enriched.phone = explorium.phone;
  if (explorium?.website && !enriched.website) enriched.website = explorium.website;
  if (explorium?.linkedinUrl && !enriched.linkedinUrl) enriched.linkedinUrl = explorium.linkedinUrl;
  if (apollo?.linkedinUrl && !enriched.linkedinUrl) enriched.linkedinUrl = apollo.linkedinUrl;
  if (apollo?.employeeCount && !enriched.employeeCount) enriched.employeeCount = apollo.employeeCount;
  if (explorium?.employeeCount && !enriched.employeeCount) enriched.employeeCount = explorium.employeeCount;
  if (apollo?.revenue && !enriched.revenue) enriched.revenue = apollo.revenue;
  if (explorium?.revenue && !enriched.revenue) enriched.revenue = explorium.revenue;
  if (apollo?.description && !enriched.description) enriched.description = apollo.description;
  if (apollo?.industry && !enriched.industry) enriched.industry = apollo.industry;
  if (apollo?.city && !enriched.city) enriched.city = apollo.city;
  if (apollo?.foundingYear && !enriched.foundingYear) enriched.foundingYear = apollo.foundingYear;
  if (input.website && !enriched.website) enriched.website = input.website;

  // ── Free-source ground-truth overrides (highest-confidence structured data) ──
  if (!enriched.crNumber && freeData?.opencorporates?.crNumber) enriched.crNumber = freeData.opencorporates.crNumber;
  if (!enriched.foundingYear && freeData?.opencorporates?.foundingYear) enriched.foundingYear = freeData.opencorporates.foundingYear;
  if (!enriched.foundingYear && freeData?.wikidata?.foundingYear) enriched.foundingYear = freeData.wikidata.foundingYear;
  if (!enriched.employeeCount && freeData?.wikidata?.employees) enriched.employeeCount = freeData.wikidata.employees;
  // Tadawul: revenue from listed market cap is a strong signal
  if (!enriched.revenue && freeData?.tadawul?.marketCap) enriched.revenue = freeData.tadawul.marketCap;
  // Hunter.io: take best-confidence email if not already set
  if (!enriched.email && freeData?.hunter?.emails?.length) {
    const best = freeData.hunter.emails.sort((a, b) => b.confidence - a.confidence)[0];
    if (best?.value && best.confidence > 50) enriched.email = best.value;
  }

  // Merge Explorium contacts into keyExecutives if not already set
  if (expContacts.length > 0 && !enriched.keyExecutives) {
    enriched.keyExecutives = JSON.stringify(
      expContacts.map((c) => ({ name: c.name, title: c.title, linkedin: c.linkedinUrl }))
    );
  }

  const cleaned = validateAndCleanData(enriched as Record<string, unknown>);
  const score = calculateEnrichmentScore(cleaned as EnrichedCompanyData);
  cleaned.enrichmentScore = score;
  cleaned.enrichmentStatus = score >= 70 ? "enriched" : score >= 30 ? "partial" : "pending";

  console.log(`[Enrichment] Done: ${companyName} — score ${score} (${cleaned.enrichmentStatus})`);
  return cleaned as EnrichedCompanyData;
}

function calculateEnrichmentScore(data: EnrichedCompanyData): number {
  const fields = [
    { key: "nameEn", weight: 5 },
    { key: "nameAr", weight: 5 },
    { key: "industry", weight: 5 },
    { key: "industryAr", weight: 3 },
    { key: "city", weight: 4 },
    { key: "region", weight: 3 },
    { key: "website", weight: 5 },
    { key: "phone", weight: 6 },
    { key: "email", weight: 5 },
    { key: "description", weight: 4 },
    { key: "descriptionAr", weight: 3 },
    { key: "employeeCount", weight: 5 },
    { key: "revenue", weight: 6 },
    { key: "foundingYear", weight: 4 },
    { key: "crNumber", weight: 5 },
    { key: "capitalAmount", weight: 4 },
    { key: "entityType", weight: 3 },
    { key: "ownerName", weight: 6 },
    { key: "shareholders", weight: 5 },
    { key: "keyExecutives", weight: 5 },
    { key: "marketPositioning", weight: 3 },
    { key: "recentNews", weight: 3 },
  ];

  const totalWeight = fields.reduce((s, f) => s + f.weight, 0);
  let score = 0;
  for (const { key, weight } of fields) {
    const val = data[key as keyof EnrichedCompanyData];
    if (val !== null && val !== undefined && val !== "" && val !== "null") {
      score += weight;
    }
  }
  return Math.round((score / totalWeight) * 100);
}

export async function scanWebsiteForCompanies(
  url: string,
  maxPages: number = 10
): Promise<{
  websiteType: string;
  detectedCategories: string[];
  estimatedCompanyCount: number;
  pagesFound: number;
  sampleCompanies: string[];
  language: string;
}> {
  let pageContent = "";
  try {
    const { fetchUrl } = await import("./scraper.js");
    pageContent = await fetchUrl(url);
  } catch {
    pageContent = "";
  }

  const prompt = `Analyze this website to determine if it contains company/business listings for Saudi Arabia.

URL: ${url}
Page content preview (first 3000 chars): ${pageContent.substring(0, 3000)}

Determine:
1. websiteType: one of "directory", "association", "government", "chamber", "corporate", "marketplace", "news", "other"
2. detectedCategories: array of business categories found
3. estimatedCompanyCount: rough estimate of companies listed
4. pagesFound: estimated number of listing pages
5. sampleCompanies: array of 3-5 company names visible on the page
6. language: "ar", "en", or "bilingual"

Respond with JSON only.`;

  try {
    const response = await nexusGenerate(prompt + "\n\nReturn JSON only.", {
      tier: "extraction",
      maxTokens: 2000,
      temperature: 0,
    });
    const match = response.text.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : {};
    return {
      websiteType: result.websiteType || "directory",
      detectedCategories: result.detectedCategories || [],
      estimatedCompanyCount: result.estimatedCompanyCount || 0,
      pagesFound: Math.min(result.pagesFound || 1, maxPages),
      sampleCompanies: result.sampleCompanies || [],
      language: result.language || "bilingual",
    };
  } catch {
    return {
      websiteType: "directory",
      detectedCategories: [],
      estimatedCompanyCount: 0,
      pagesFound: 1,
      sampleCompanies: [],
      language: "bilingual",
    };
  }
}

export async function extractCompaniesFromHtml(html: string, sourceUrl: string): Promise<CompanyEnrichmentInput[]> {
  const prompt = `Extract all company/business listings from this HTML content.

Source URL: ${sourceUrl}
HTML (first 5000 chars): ${html.substring(0, 5000)}

For each company found, extract available fields:
- nameAr (Arabic name)
- nameEn (English name)
- website
- phone
- email
- industry
- city
- description

Return a JSON array of company objects. If no companies found, return empty array.`;

  try {
    const response = await nexusGenerate(prompt + "\n\nReturn JSON: {\"companies\":[...]}.", {
      tier: "extraction",
      maxTokens: 4000,
      temperature: 0,
    });
    const match = response.text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { companies: [] };
    return Array.isArray(parsed) ? parsed : (parsed.companies || []);
  } catch {
    return [];
  }
}

async function fetchPageContent(pageUrl: string): Promise<{ text: string; html: string }> {
  let html = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(pageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
    });
    clearTimeout(timer);
    html = await res.text();
  } catch { /* try stealth */ }

  if (html.length < 300) {
    try {
      const { StealthBrowser } = await import("./stealth-browser.js");
      const domain = new URL(pageUrl).hostname;
      const browser = new StealthBrowser();
      await browser.start(domain);
      await browser.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      html = await browser.getContent();
      await browser.stop();
    } catch { /* give up */ }
  }

  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, nav, footer, header').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 15000);
  return { text, html };
}

// Keywords that suggest a URL is a company listing or category page
const LISTING_KEYWORDS = [
  'compan', 'business', 'member', 'director', 'categor', 'sector', 'industry',
  'register', 'list', 'browse', 'search', 'market', 'supplier', 'vendor',
  'exhibitor', 'participant', 'firm', 'enterprise', 'organization',
  // Arabic transliterations
  'sharika', 'sharikat', 'amal', 'tijari', 'قطاع', 'شركة', 'أعمال',
];

// Keywords that suggest a URL is noise (not a company listing page)
const NOISE_KEYWORDS = [
  'login', 'signup', 'register', 'forgot', 'password', 'privacy', 'terms',
  'cookie', 'policy', 'sitemap', 'contact', 'about', 'faq', 'help', 'support',
  'career', 'job', 'news', 'blog', 'press', 'media', 'event', 'rss',
  'feed', 'print', 'share', 'social', 'facebook', 'twitter', 'instagram',
  'youtube', 'linkedin', 'whatsapp', 'tel:', 'mailto:', 'javascript:',
  '.pdf', '.doc', '.xls', '.zip', '.png', '.jpg', '.gif', '.svg', '.css', '.js',
];

/** Score a URL by how likely it is to be a company listing page (higher = better) */
function scoreUrl(url: string, baseOrigin: string): number {
  try { new URL(url); } catch { return -1; }
  const lower = url.toLowerCase();
  if (NOISE_KEYWORDS.some(k => lower.includes(k))) return -1;
  const parsed = new URL(url);
  if (parsed.origin !== baseOrigin) return -1; // stay on same domain
  let score = 0;
  if (LISTING_KEYWORDS.some(k => lower.includes(k))) score += 10;
  if (lower.includes('page=') || lower.includes('/page/')) score += 5;  // pagination
  if (lower.includes('&') || lower.includes('?')) score += 2;           // filtered listing
  const pathDepth = parsed.pathname.split('/').filter(Boolean).length;
  score -= pathDepth; // prefer shallower paths slightly
  return score;
}

/** Extract all internal href links from an HTML page, scored and deduplicated */
async function extractInternalLinks(html: string, baseUrl: string): Promise<string[]> {
  try {
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);
    const origin = new URL(baseUrl).origin;
    const seen = new Set<string>();
    const scored: Array<{ url: string; score: number }> = [];

    $('a[href]').each((_: number, el: any) => {
      const href = $(el).attr('href');
      if (!href) return;
      let abs: string;
      try {
        abs = href.startsWith('http') ? href : new URL(href, baseUrl).href;
        abs = abs.split('#')[0];
      } catch { return; }
      if (seen.has(abs)) return;
      seen.add(abs);
      const s = scoreUrl(abs, origin);
      if (s >= 0) scored.push({ url: abs, score: s });
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map(x => x.url);
  } catch {
    return [];
  }
}

/** Try to find all URLs from the site's sitemap.xml / sitemap_index.xml */
async function discoverSitemapUrls(siteRoot: string): Promise<string[]> {
  const origin = new URL(siteRoot).origin;
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/sitemaps.xml`,
  ];
  const urls: string[] = [];
  for (const sm of candidates) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(sm, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 compatible Googlebot/2.1' },
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const xml = await res.text();
      // Extract <loc> tags
      const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim());
      // Filter to same origin and score them
      for (const loc of locs) {
        try {
          const s = scoreUrl(loc, origin);
          if (s >= 0) urls.push(loc);
        } catch { /* skip */ }
      }
      if (urls.length > 0) break; // found a usable sitemap
    } catch { /* try next */ }
  }
  return urls;
}

/** Find the next pagination URL from an HTML page */
async function findNextPageUrl(html: string, currentUrl: string): Promise<string | null> {
  try {
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);
    const baseUrl = new URL(currentUrl);

    const nextHref =
      $("a[rel='next']").first().attr("href") ||
      $("a:contains('Next'), a:contains('التالي'), a:contains('›'), a:contains('»')").first().attr("href") ||
      $(".pagination a.active, .pagination a.current").next("a").first().attr("href") ||
      $(".pager .next a, .next-page a, [class*='next'][href], [class*='pagination'] a[aria-label='Next']").first().attr("href");

    if (nextHref) {
      return nextHref.startsWith("http") ? nextHref : new URL(nextHref, baseUrl.origin).href;
    }

    // Try incrementing ?page=N or &page=N
    const pageMatch = currentUrl.match(/([?&])(page=)(\d+)/);
    if (pageMatch) {
      const nextPage = parseInt(pageMatch[3]) + 1;
      return currentUrl.replace(`${pageMatch[1]}${pageMatch[2]}${pageMatch[3]}`, `${pageMatch[1]}${pageMatch[2]}${nextPage}`);
    }

    // Try /page/N/
    const pathPageMatch = currentUrl.match(/(\/page\/)(\d+)(\/?)$/);
    if (pathPageMatch) {
      const nextPage = parseInt(pathPageMatch[2]) + 1;
      return currentUrl.replace(pathPageMatch[0], `${pathPageMatch[1]}${nextPage}${pathPageMatch[3]}`);
    }

    // Try appending ?page=2 if no page param exists
    if (!currentUrl.includes('page=') && !currentUrl.includes('/page/')) {
      const sep = currentUrl.includes('?') ? '&' : '?';
      return `${currentUrl}${sep}page=2`;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Full site crawler:
 * 1. Discovers URLs via sitemap.xml
 * 2. Extracts and scores internal links from each page
 * 3. Follows pagination for each section
 * 4. Crawls up to maxPages total
 */
async function deepCrawlSite(
  startUrl: string,
  maxPages = 30,
  maxContentChars = 50000,
): Promise<string[]> {
  const origin = new URL(startUrl).origin;
  const visited = new Set<string>();
  const pageTexts: string[] = [];
  let totalChars = 0;

  // Priority queue: [score, url]
  const queue: Array<{ url: string; score: number; isPagination: boolean }> = [];

  const enqueue = (url: string, isPagination = false) => {
    const clean = url.split('#')[0];
    if (visited.has(clean)) return;
    const s = scoreUrl(clean, origin);
    if (s < 0) return;
    queue.push({ url: clean, score: isPagination ? s + 20 : s, isPagination });
  };

  // 1. Start with the root URL
  enqueue(startUrl, false);

  // 2. Discover via sitemap
  const sitemapUrls = await discoverSitemapUrls(startUrl);
  console.log(`[Crawler] sitemap gave ${sitemapUrls.length} candidate URLs`);
  for (const u of sitemapUrls.slice(0, 200)) enqueue(u);

  // 3. Sort queue by score (best first)
  queue.sort((a, b) => b.score - a.score);

  while (queue.length > 0 && visited.size < maxPages && totalChars < maxContentChars) {
    // Pick highest-scored unvisited URL
    const item = queue.shift();
    if (!item) break;
    const { url } = item;
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`[Crawler] [${visited.size}/${maxPages}] Fetching: ${url.substring(0, 90)}`);

    const { text, html } = await fetchPageContent(url);
    if (text.length > 200) {
      pageTexts.push(`[Page: ${url}]\n${text}`);
      totalChars += text.length;
    }

    // Extract next pagination URL for this page and enqueue with high priority
    const nextPage = await findNextPageUrl(html, url);
    if (nextPage && !visited.has(nextPage)) {
      queue.unshift({ url: nextPage, score: 100, isPagination: true });
    }

    // Extract new internal links and add to queue
    const links = await extractInternalLinks(html, url);
    for (const link of links.slice(0, 50)) enqueue(link);

    // Re-sort so best candidates are next
    queue.sort((a, b) => b.score - a.score);

    // Polite delay
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`[Crawler] Done: ${visited.size} pages, ${totalChars} chars collected`);
  return pageTexts;
}

export async function harvestSourceWithAI(
  sourceId: string,
  sourceName: string,
  sourceUrl?: string,
  focusSector?: string,
): Promise<CompanyEnrichmentInput[]> {
  // Deep crawl: sitemap discovery + internal link following + pagination
  const allPageContents: string[] = sourceUrl
    ? await deepCrawlSite(sourceUrl, 30, 50000)
    : [];

  // Split scraped content into 15k-char chunks for batched AI extraction
  const CHUNK_SIZE = 15000;
  const fullText = allPageContents.join('\n\n');
  const hasRealContent = fullText.length > 200;

  // Determine source type label for fallback prompt
  const sourceTypeLabel = sourceId.includes('chamber') ? 'chamber of commerce'
    : sourceId.includes('yellow') ? 'business directory'
    : sourceId.includes('tasi') || sourceId.includes('cma') ? 'financial market listing'
    : 'business directory';

  const sectorInstruction = focusSector
    ? `FOCUS SECTOR: This harvest run specifically targets companies in the "${focusSector}" sector. Prioritize companies from this sector while still including others.`
    : '';

  async function extractFromChunk(chunk: string): Promise<CompanyEnrichmentInput[]> {
    const prompt = `You are a data extraction specialist for Saudi Arabian businesses.

You are given content scraped from "${sourceName}" (${sourceUrl}).
Extract ALL real company names and details found in this content.

SCRAPED CONTENT:
${chunk}

For each company provide:
- nameAr (Arabic name if present)
- nameEn (English name if present)
- industry (sector/category from the listing)
- city (if mentioned)
- website (if mentioned)
- phone (if mentioned)
- email (if mentioned)

Respond with JSON: {"companies": [...]}

RULES:
- Extract ONLY companies explicitly mentioned in the content above
- Do NOT invent or fabricate any company names
- Include ALL companies you find — do not stop early
- If a company has both Arabic and English names, include both
- Skip generic words — only extract actual company names`;

    const response = await nexusGenerate(prompt + "\n\nReturn JSON: {\"companies\":[...]}.", {
      tier: "extraction",
      maxTokens: 6000,
      temperature: 0,
    });
    const match = response.text.match(/\{[\s\S]*\}/);
    const raw = match ? match[0] : '{"companies":[]}';
    return (JSON.parse(raw).companies || []) as CompanyEnrichmentInput[];
  }

  async function extractFromKnowledge(): Promise<CompanyEnrichmentInput[]> {
    const prompt = `You are a research analyst specializing in Saudi Arabian businesses.

Generate a comprehensive list of 40-60 real Saudi companies that would typically be listed in "${sourceName}" (${sourceUrl}).

This is a ${sourceTypeLabel}.

${sectorInstruction}

For each company provide:
- nameAr (Arabic name)
- nameEn (English name)
- industry
- city (Riyadh, Jeddah, Dammam, Khobar, Mecca, Medina, Tabuk, Abha, Taif, etc.)
- website (if publicly known)
- phone (if known)
- email (if known)

Respond with JSON: {"companies": [...]}

IMPORTANT:
- Only include REAL companies with verifiable existence. Do not fabricate.
- Avoid major multinationals and household names (Aramco, STC, SABIC, etc.) — focus on mid-market and SME companies
- Cover multiple cities across Saudi Arabia — not just Riyadh
- Aim for at least 40 companies`;

    const response = await nexusGenerate(prompt + "\n\nReturn JSON: {\"companies\":[...]}.", {
      tier: "extraction",
      maxTokens: 4000,
      temperature: 0,
    });
    const match = response.text.match(/\{[\s\S]*\}/);
    const raw = match ? match[0] : '{"companies":[]}';
    return (JSON.parse(raw).companies || []) as CompanyEnrichmentInput[];
  }

  try {
    let allCompanies: CompanyEnrichmentInput[] = [];

    if (hasRealContent) {
      // Build chunks from the full crawled text
      const chunks: string[] = [];
      for (let i = 0; i < Math.min(fullText.length, 50000); i += CHUNK_SIZE) {
        chunks.push(fullText.slice(i, i + CHUNK_SIZE));
      }
      console.log(`[Builder] ${sourceName}: processing ${chunks.length} content chunk(s) from ${allPageContents.length} pages`);

      // Process up to 4 chunks in parallel batches
      const PARALLEL = 3;
      for (let i = 0; i < chunks.length; i += PARALLEL) {
        const batch = chunks.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(batch.map(c => extractFromChunk(c)));
        for (const r of results) {
          if (r.status === 'fulfilled') allCompanies.push(...r.value);
        }
      }
    } else {
      // No scrapable content — fall back to AI knowledge with sector rotation
      console.log(`[Builder] ${sourceName}: no scraped content, using AI knowledge (sector: ${focusSector || 'mixed'})`);
      allCompanies = await extractFromKnowledge();
    }

    // Deduplicate by nameEn/nameAr within this batch
    const seenNames = new Set<string>();
    const deduplicated = allCompanies.filter(c => {
      const key = ((c.nameEn || '') + '|' + (c.nameAr || '')).toLowerCase().trim();
      if (!key || key === '|') return false;
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });

    console.log(`[Builder] ${sourceName}: ${allCompanies.length} raw → ${deduplicated.length} unique companies (${hasRealContent ? `from ${allPageContents.length} pages` : `AI knowledge, sector: ${focusSector || 'mixed'}`})`);
    return deduplicated;
  } catch (err) {
    console.error(`[Builder] AI extraction failed for ${sourceName}:`, err);
    return [];
  }
}
