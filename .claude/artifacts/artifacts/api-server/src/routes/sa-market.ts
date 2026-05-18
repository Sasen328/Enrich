import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, saMarketShareholdersTable, saMarketExecutivesTable, saMarketProfilesTable,
} from "@workspace/db";
import { eq, ilike, and, or, sql, gte, lte } from "drizzle-orm";
import { nexusSynthesize } from "../lib/nexus/index.js";

const router: IRouter = Router();

// ─── GET /api/sa-market/shareholders ─────────────────────────────────────────
router.get("/sa-market/shareholders", async (req: Request, res: Response): Promise<void> => {
  const { search, sector, city, stock_index, min_ownership, max_ownership, limit = "100", offset = "0", group_by_company } = req.query;

  const conditions: Parameters<typeof and>[] = [];
  if (search) {
    conditions.push(
      or(
        ilike(saMarketShareholdersTable.shareholderName, `%${search}%`),
        ilike(saMarketShareholdersTable.companyName, `%${search}%`),
      )!
    );
  }
  if (sector) conditions.push(ilike(saMarketShareholdersTable.sector, `%${sector}%`));
  if (city) conditions.push(ilike(saMarketShareholdersTable.city, `%${city}%`));
  if (stock_index) conditions.push(eq(saMarketShareholdersTable.stockIndex, String(stock_index)));
  if (min_ownership) conditions.push(gte(saMarketShareholdersTable.ownershipPercent, parseFloat(String(min_ownership))));
  if (max_ownership) conditions.push(lte(saMarketShareholdersTable.ownershipPercent, parseFloat(String(max_ownership))));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  if (group_by_company === "1") {
    // Return grouped by company for overview
    const grouped = await db.select({
      stockCode: saMarketShareholdersTable.stockCode,
      stockIndex: saMarketShareholdersTable.stockIndex,
      companyName: saMarketShareholdersTable.companyName,
      companyNameAr: saMarketShareholdersTable.companyNameAr,
      sector: saMarketShareholdersTable.sector,
      city: saMarketShareholdersTable.city,
      shareholderCount: sql<number>`count(*)`,
      totalOwnership: sql<number>`sum(${saMarketShareholdersTable.ownershipPercent})`,
      topShareholder: sql<string>`(SELECT shareholder_name FROM sa_market_shareholders s2 WHERE s2.company_name = sa_market_shareholders.company_name ORDER BY ownership_percent DESC NULLS LAST LIMIT 1)`,
    }).from(saMarketShareholdersTable)
      .where(where)
      .groupBy(
        saMarketShareholdersTable.stockCode,
        saMarketShareholdersTable.stockIndex,
        saMarketShareholdersTable.companyName,
        saMarketShareholdersTable.companyNameAr,
        saMarketShareholdersTable.sector,
        saMarketShareholdersTable.city,
      )
      .orderBy(sql`count(*) DESC`)
      .limit(parseInt(String(limit)))
      .offset(parseInt(String(offset)));
    res.json(grouped);
    return;
  }

  const rows = await db.select().from(saMarketShareholdersTable)
    .where(where)
    .orderBy(sql`${saMarketShareholdersTable.ownershipPercent} DESC NULLS LAST`)
    .limit(parseInt(String(limit)))
    .offset(parseInt(String(offset)));

  res.json(rows);
});

// ─── GET /api/sa-market/shareholders/stats ────────────────────────────────────
router.get("/sa-market/shareholders/stats", async (_req: Request, res: Response): Promise<void> => {
  const [total, sectors, topIndividuals, indexes] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(saMarketShareholdersTable),
    db.select({ sector: saMarketShareholdersTable.sector, count: sql<number>`count(distinct company_name)` })
      .from(saMarketShareholdersTable)
      .where(sql`sector IS NOT NULL AND sector != ''`)
      .groupBy(saMarketShareholdersTable.sector)
      .orderBy(sql`count(distinct company_name) DESC`)
      .limit(10),
    db.select({
      name: saMarketShareholdersTable.shareholderName,
      type: saMarketShareholdersTable.shareholderType,
      totalOwnership: sql<number>`sum(ownership_percent)`,
      companiesCount: sql<number>`count(*)`,
    }).from(saMarketShareholdersTable)
      .where(sql`shareholder_type = 'Individual' AND shareholder_name != '' AND shareholder_name IS NOT NULL`)
      .groupBy(saMarketShareholdersTable.shareholderName, saMarketShareholdersTable.shareholderType)
      .orderBy(sql`sum(ownership_percent) DESC NULLS LAST`)
      .limit(20),
    db.select({ index: saMarketShareholdersTable.stockIndex, count: sql<number>`count(distinct company_name)` })
      .from(saMarketShareholdersTable)
      .groupBy(saMarketShareholdersTable.stockIndex)
      .orderBy(sql`count(distinct company_name) DESC`),
  ]);

  res.json({
    total: Number(total[0]?.count || 0),
    sectors,
    topIndividuals,
    indexes,
  });
});

// ─── GET /api/sa-market/shareholders/by-company/:stockCode ────────────────────
router.get("/sa-market/shareholders/by-company/:stockCode", async (req: Request, res: Response): Promise<void> => {
  const rows = await db.select().from(saMarketShareholdersTable)
    .where(eq(saMarketShareholdersTable.stockCode, req.params.stockCode))
    .orderBy(sql`ownership_percent DESC NULLS LAST`);
  res.json(rows);
});

// ─── GET /api/sa-market/executives ───────────────────────────────────────────
router.get("/sa-market/executives", async (req: Request, res: Response): Promise<void> => {
  const { search, sector, city, stock_index, position, limit = "100", offset = "0", group_by_company } = req.query;

  const conditions: Parameters<typeof and>[] = [];
  if (search) {
    conditions.push(
      or(
        ilike(saMarketExecutivesTable.executiveName, `%${search}%`),
        ilike(saMarketExecutivesTable.companyName, `%${search}%`),
      )!
    );
  }
  if (sector) conditions.push(ilike(saMarketExecutivesTable.sector, `%${sector}%`));
  if (city) conditions.push(ilike(saMarketExecutivesTable.city, `%${city}%`));
  if (stock_index) conditions.push(eq(saMarketExecutivesTable.stockIndex, String(stock_index)));
  if (position) conditions.push(ilike(saMarketExecutivesTable.position, `%${position}%`));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  if (group_by_company === "1") {
    const grouped = await db.select({
      stockCode: saMarketExecutivesTable.stockCode,
      stockIndex: saMarketExecutivesTable.stockIndex,
      companyName: saMarketExecutivesTable.companyName,
      companyNameAr: saMarketExecutivesTable.companyNameAr,
      sector: saMarketExecutivesTable.sector,
      city: saMarketExecutivesTable.city,
      executiveCount: sql<number>`count(*)`,
      ceoName: sql<string>`(SELECT executive_name FROM sa_market_executives e2 WHERE e2.company_name = sa_market_executives.company_name AND position ILIKE '%CEO%' LIMIT 1)`,
      chairmanName: sql<string>`(SELECT executive_name FROM sa_market_executives e2 WHERE e2.company_name = sa_market_executives.company_name AND position ILIKE '%Chairman%' LIMIT 1)`,
    }).from(saMarketExecutivesTable)
      .where(where)
      .groupBy(
        saMarketExecutivesTable.stockCode,
        saMarketExecutivesTable.stockIndex,
        saMarketExecutivesTable.companyName,
        saMarketExecutivesTable.companyNameAr,
        saMarketExecutivesTable.sector,
        saMarketExecutivesTable.city,
      )
      .orderBy(sql`count(*) DESC`)
      .limit(parseInt(String(limit)))
      .offset(parseInt(String(offset)));
    res.json(grouped);
    return;
  }

  const rows = await db.select().from(saMarketExecutivesTable)
    .where(where)
    .orderBy(saMarketExecutivesTable.companyName, saMarketExecutivesTable.executiveName)
    .limit(parseInt(String(limit)))
    .offset(parseInt(String(offset)));

  res.json(rows);
});

// ─── GET /api/sa-market/executives/stats ─────────────────────────────────────
router.get("/sa-market/executives/stats", async (_req: Request, res: Response): Promise<void> => {
  const [total, positions, sectors] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(saMarketExecutivesTable),
    db.select({ position: saMarketExecutivesTable.position, count: sql<number>`count(*)` })
      .from(saMarketExecutivesTable)
      .where(sql`position IS NOT NULL AND position != ''`)
      .groupBy(saMarketExecutivesTable.position)
      .orderBy(sql`count(*) DESC`)
      .limit(15),
    db.select({ sector: saMarketExecutivesTable.sector, count: sql<number>`count(distinct company_name)` })
      .from(saMarketExecutivesTable)
      .where(sql`sector IS NOT NULL AND sector != ''`)
      .groupBy(saMarketExecutivesTable.sector)
      .orderBy(sql`count(distinct company_name) DESC`)
      .limit(10),
  ]);
  res.json({ total: Number(total[0]?.count || 0), positions, sectors });
});

// ─── GET /api/sa-market/executives/by-company/:stockCode ─────────────────────
router.get("/sa-market/executives/by-company/:stockCode", async (req: Request, res: Response): Promise<void> => {
  const rows = await db.select().from(saMarketExecutivesTable)
    .where(eq(saMarketExecutivesTable.stockCode, req.params.stockCode))
    .orderBy(saMarketExecutivesTable.position, saMarketExecutivesTable.executiveName);
  res.json(rows);
});

// ─── GET /api/sa-market/sectors ──────────────────────────────────────────────
router.get("/sa-market/sectors", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db.select({ sector: saMarketShareholdersTable.sector })
    .from(saMarketShareholdersTable)
    .where(sql`sector IS NOT NULL AND sector != ''`)
    .groupBy(saMarketShareholdersTable.sector)
    .orderBy(saMarketShareholdersTable.sector);
  res.json(rows.map(r => r.sector));
});

// ─── GET /api/sa-market/profile/:name ────────────────────────────────────────
router.get("/sa-market/profile/:name", async (req: Request, res: Response): Promise<void> => {
  const name = decodeURIComponent(req.params.name);
  const [profile] = await db.select().from(saMarketProfilesTable)
    .where(eq(saMarketProfilesTable.personName, name));
  if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
  res.json(profile);
});

// ─── POST /api/sa-market/profile/generate ────────────────────────────────────
router.post("/sa-market/profile/generate", async (req: Request, res: Response): Promise<void> => {
  const { personName, personType, companyName, sector, position, ownershipPercent, stockCode, stockIndex } = req.body as {
    personName: string; personType: string; companyName?: string; sector?: string;
    position?: string; ownershipPercent?: number; stockCode?: string; stockIndex?: string;
  };

  if (!personName) { res.status(400).json({ error: "personName is required" }); return; }

  // Check cache first
  const [existing] = await db.select().from(saMarketProfilesTable)
    .where(eq(saMarketProfilesTable.personName, personName));

  // If profile was generated less than 7 days ago, return cached
  if (existing && existing.generatedAt) {
    const age = Date.now() - new Date(existing.generatedAt).getTime();
    if (age < 7 * 24 * 60 * 60 * 1000) {
      res.json({ ...existing, cached: true });
      return;
    }
  }

  // Generate with AI
  const context = [
    personName,
    position ? `Position: ${position}` : null,
    companyName ? `Company: ${companyName}` : null,
    sector ? `Sector: ${sector}` : null,
    ownershipPercent ? `Ownership stake: ${ownershipPercent}%` : null,
    stockCode ? `Listed on: ${stockIndex ?? "Saudi Exchange"} (${stockCode})` : null,
  ].filter(Boolean).join(". ");

  const prompt = `You are an expert Saudi Arabia business intelligence analyst with deep knowledge of the Saudi market, TASI, NOMU, family businesses, and high-net-worth individuals.

Conduct a comprehensive prospect profile for the following person based on publicly available information, market knowledge, and intelligent inference where direct data is unavailable. Be as specific and actionable as possible for B2B prospecting purposes.

Person: ${context}

Generate a detailed JSON profile with these exact fields:
{
  "estimatedAnnualIncome": "string with SAR or USD range estimate",
  "estimatedWealth": "string with total estimated net worth in SAR/USD",
  "investmentAppetite": "Conservative | Moderate | Aggressive | Opportunistic",
  "investmentFocus": "comma-separated areas they likely invest in",
  "educationBackground": "likely educational background based on position, generation, family",
  "careerHistory": "likely career trajectory, previous roles, family business context",
  "boardMemberships": "other likely board seats or affiliations",
  "keyConnections": "prominent business families, government bodies, financial institutions they connect with",
  "bestTimeToContact": "recommended contact window and communication style for Saudi market",
  "approachStrategy": "specific approach strategy for B2B prospecting in Saudi context",
  "riskProfile": "Conservative | Balanced | Growth | Speculative",
  "philanthropyInterests": "likely charitable activities based on sector and background",
  "geographicPresence": "cities, regions, and countries they likely operate in",
  "languagesSpoken": "likely languages based on education and background",
  "publicProfiles": ["array of likely LinkedIn/Twitter/Zawya profile URLs"],
  "profileScore": number between 1-100 indicating how complete and confident this profile is,
  "summary": "2-3 sentence executive summary for this prospect"
}

Be specific. Use Saudi cultural context. Mention Vision 2030 where relevant. Return ONLY valid JSON.`;

  try {
    // Route the synthesis through Nexus instead of calling OpenAI directly.
    // `nexusSynthesize` uses the frontier waterfall (Gemini → Claude → GPT-4o)
    // and tracks cost in the session ledger.
    const result = await nexusSynthesize(prompt, "Return ONLY the JSON object described in the prompt — no prose.");
    const raw = result.text || "{}";
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}") + 1;
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd)) as {
      estimatedAnnualIncome?: string; estimatedWealth?: string; investmentAppetite?: string;
      investmentFocus?: string; educationBackground?: string; careerHistory?: string;
      boardMemberships?: string; keyConnections?: string; bestTimeToContact?: string;
      approachStrategy?: string; riskProfile?: string; philanthropyInterests?: string;
      geographicPresence?: string; languagesSpoken?: string; publicProfiles?: string[];
      profileScore?: number; summary?: string;
    };

    const profileData = {
      personName,
      personType: personType || "unknown",
      companyName: companyName || null,
      sector: sector || null,
      estimatedAnnualIncome: parsed.estimatedAnnualIncome || null,
      estimatedWealth: parsed.estimatedWealth || null,
      investmentAppetite: parsed.investmentAppetite || null,
      investmentFocus: parsed.investmentFocus || null,
      educationBackground: parsed.educationBackground || null,
      careerHistory: parsed.careerHistory || null,
      boardMemberships: parsed.boardMemberships || null,
      keyConnections: parsed.keyConnections || null,
      bestTimeToContact: parsed.bestTimeToContact || null,
      approachStrategy: parsed.approachStrategy || null,
      riskProfile: parsed.riskProfile || null,
      philanthropyInterests: parsed.philanthropyInterests || null,
      geographicPresence: parsed.geographicPresence || null,
      languagesSpoken: parsed.languagesSpoken || null,
      publicProfiles: parsed.publicProfiles || [],
      rawProfile: parsed.summary || null,
      profileScore: parsed.profileScore || 50,
      generatedAt: new Date(),
      updatedAt: new Date(),
    };

    let savedProfile;
    if (existing) {
      [savedProfile] = await db.update(saMarketProfilesTable)
        .set(profileData)
        .where(eq(saMarketProfilesTable.id, existing.id))
        .returning();
    } else {
      [savedProfile] = await db.insert(saMarketProfilesTable).values(profileData).returning();
    }

    res.json({ ...savedProfile, cached: false });
  } catch (err) {
    console.error("[SAMarket] Profile gen error:", err);
    res.status(500).json({ error: "Failed to generate profile" });
  }
});

// ─── GET /api/sa-market/stats ─────────────────────────────────────────────────
router.get("/sa-market/stats", async (_req: Request, res: Response): Promise<void> => {
  const [shTotal, exTotal, profilesTotal, companies, topSectors] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(saMarketShareholdersTable),
    db.select({ count: sql<number>`count(*)` }).from(saMarketExecutivesTable),
    db.select({ count: sql<number>`count(*)` }).from(saMarketProfilesTable),
    db.select({ count: sql<number>`count(distinct stock_code)` }).from(saMarketShareholdersTable),
    db.select({ sector: saMarketShareholdersTable.sector, count: sql<number>`count(distinct stock_code)` })
      .from(saMarketShareholdersTable)
      .where(sql`sector IS NOT NULL AND sector != ''`)
      .groupBy(saMarketShareholdersTable.sector)
      .orderBy(sql`count(distinct stock_code) DESC`)
      .limit(5),
  ]);
  res.json({
    shareholders: Number(shTotal[0]?.count || 0),
    executives: Number(exTotal[0]?.count || 0),
    profilesGenerated: Number(profilesTotal[0]?.count || 0),
    listedCompanies: Number(companies[0]?.count || 0),
    topSectors,
  });
});

export default router;
