import { Router, type IRouter, type Request, type Response } from "express";
import { db, companiesTable, leadsTable, builderCompaniesTable, jobsTable } from "@workspace/db";
import { eq, ilike, and, or, sql, inArray, notLike, gte, lte, asc, desc } from "drizzle-orm";
import { enrichCompanyWithAI } from "../lib/enrichment-engine.js";
import { addToBlocklist } from "../lib/blocklist.js";
import * as XLSX from "xlsx";

const router: IRouter = Router();

const curatedOnlyCondition = and(
  notLike(companiesTable.dataSource, "builder:%"),
  notLike(companiesTable.dataSource, "session:%")
);

// ── Taxonomy endpoints (must come before /:id) ─────────────────────────────

router.get("/companies/industries", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select({ industry: companiesTable.industry })
    .from(companiesTable)
    .where(sql`${companiesTable.industry} IS NOT NULL AND ${companiesTable.industry} != ''`)
    .groupBy(companiesTable.industry)
    .orderBy(sql`count(*) DESC`);
  res.json(rows.map(r => r.industry).filter(Boolean));
});

router.get("/companies/cities", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select({ city: companiesTable.city })
    .from(companiesTable)
    .where(sql`${companiesTable.city} IS NOT NULL AND ${companiesTable.city} != ''`)
    .groupBy(companiesTable.city)
    .orderBy(sql`count(*) DESC`);
  res.json(rows.map(r => r.city).filter(Boolean));
});

router.get("/companies/employee-ranges", async (_req: Request, res: Response): Promise<void> => {
  const order = ["1-10","11-50","51-200","201-500","501-1000","1001-5000","5001-10000","10000+"];
  const rows = await db
    .select({ emp: companiesTable.employeeCount })
    .from(companiesTable)
    .where(sql`${companiesTable.employeeCount} IS NOT NULL AND ${companiesTable.employeeCount} != ''`)
    .groupBy(companiesTable.employeeCount);
  const found = rows.map(r => r.emp).filter(Boolean) as string[];
  const sorted = order.filter(o => found.includes(o));
  const rest = found.filter(f => !order.includes(f)).sort();
  res.json([...sorted, ...rest]);
});

router.get("/companies/stats", async (req: Request, res: Response): Promise<void> => {
  const curated = req.query.curated === "true";
  const baseWhere = curated ? curatedOnlyCondition : undefined;

  const [
    totalResult, enrichedResult, partialResult,
    withWebsiteResult, withPhoneResult, withEmailResult,
    withDescResult, withRevenueResult, withOwnerResult, withFoundingYearResult,
    sourcesResult, citiesResult, industriesResult, companyTypesResult, totalIndustriesResult, totalCitiesResult,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(baseWhere),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, eq(companiesTable.enrichmentStatus, "enriched"))),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, eq(companiesTable.enrichmentStatus, "partial"))),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.website} is not null and ${companiesTable.website} != ''`)),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.phone} is not null and ${companiesTable.phone} != ''`)),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.email} is not null and ${companiesTable.email} != ''`)),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.description} is not null and ${companiesTable.description} != ''`)),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.revenue} is not null and ${companiesTable.revenue} != ''`)),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.ownerName} is not null and ${companiesTable.ownerName} != ''`)),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.foundingYear} is not null`)),
    db.select({ source: companiesTable.dataSource, count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.dataSource} is not null`)).groupBy(companiesTable.dataSource).orderBy(sql`count(*) desc`),
    db.select({ city: companiesTable.city, count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.city} is not null`)).groupBy(companiesTable.city).orderBy(sql`count(*) desc`).limit(15),
    db.select({ industry: companiesTable.industry, count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.industry} is not null`)).groupBy(companiesTable.industry).orderBy(sql`count(*) desc`).limit(15),
    db.select({ type: companiesTable.companyType, count: sql<number>`count(*)` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.companyType} is not null`)).groupBy(companiesTable.companyType).orderBy(sql`count(*) desc`),
    db.select({ count: sql<number>`count(distinct ${companiesTable.industry})` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.industry} is not null`)),
    db.select({ count: sql<number>`count(distinct ${companiesTable.city})` }).from(companiesTable).where(and(baseWhere, sql`${companiesTable.city} is not null`)),
  ]);
  const total = Number(totalResult[0]?.count || 0);
  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;
  res.json({
    total,
    byEnrichment: {
      enriched: Number(enrichedResult[0]?.count || 0),
      partial: Number(partialResult[0]?.count || 0),
      pending: total - Number(enrichedResult[0]?.count || 0) - Number(partialResult[0]?.count || 0),
    },
    fieldCoverage: {
      website:     { count: Number(withWebsiteResult[0]?.count || 0),     pct: pct(Number(withWebsiteResult[0]?.count || 0)) },
      phone:       { count: Number(withPhoneResult[0]?.count || 0),       pct: pct(Number(withPhoneResult[0]?.count || 0)) },
      email:       { count: Number(withEmailResult[0]?.count || 0),       pct: pct(Number(withEmailResult[0]?.count || 0)) },
      description: { count: Number(withDescResult[0]?.count || 0),        pct: pct(Number(withDescResult[0]?.count || 0)) },
      revenue:     { count: Number(withRevenueResult[0]?.count || 0),     pct: pct(Number(withRevenueResult[0]?.count || 0)) },
      ownerName:   { count: Number(withOwnerResult[0]?.count || 0),       pct: pct(Number(withOwnerResult[0]?.count || 0)) },
      foundingYear:{ count: Number(withFoundingYearResult[0]?.count || 0),pct: pct(Number(withFoundingYearResult[0]?.count || 0)) },
    },
    bySource:       sourcesResult.map(r => ({ source: r.source || "unknown", count: Number(r.count) })),
    byCity:         citiesResult.map(r => ({ city: r.city || "Unknown", count: Number(r.count) })),
    byIndustry:     industriesResult.map(r => ({ industry: r.industry || "Unknown", count: Number(r.count) })),
    byCompanyType:  companyTypesResult.map(r => ({ type: r.type || "Unknown", count: Number(r.count) })),
    totalIndustries: Number(totalIndustriesResult[0]?.count || 0),
    totalCities:     Number(totalCitiesResult[0]?.count || 0),
  });
});

// ── Main company list ──────────────────────────────────────────────────────

router.get("/companies", async (req: Request, res: Response): Promise<void> => {
  const page = parseInt(String(req.query.page || "1"), 10);
  const limit = Math.min(parseInt(String(req.query.limit || "20"), 10), 100);
  const offset = (page - 1) * limit;

  const search = req.query.search as string | undefined;
  const q = req.query.q as string | undefined;
  const searchTerm = search || q;

  const industry = req.query.industry as string | undefined;
  const industries = req.query.industries as string | undefined;
  const city = req.query.city as string | undefined;
  const cities = req.query.cities as string | undefined;
  const employeeRanges = req.query.employeeRanges as string | undefined;
  const enrichmentStatus = req.query.enrichmentStatus as string | undefined;
  const companyType = req.query.companyType as string | undefined;
  const curated = req.query.curated === "true";
  const sortBy = (req.query.sortBy as string) || "relevance";

  const revenueMin = req.query.revenueMin ? parseFloat(String(req.query.revenueMin)) : undefined;
  const revenueMax = req.query.revenueMax ? parseFloat(String(req.query.revenueMax)) : undefined;

  const conditions: ReturnType<typeof eq>[] = [];

  if (curated) {
    conditions.push(
      and(
        notLike(companiesTable.dataSource, "builder:%"),
        notLike(companiesTable.dataSource, "session:%")
      )! as any
    );
  }

  if (searchTerm) {
    conditions.push(
      or(
        ilike(companiesTable.nameEn, `%${searchTerm}%`),
        ilike(companiesTable.nameAr, `%${searchTerm}%`),
        ilike(companiesTable.industry, `%${searchTerm}%`),
        ilike(companiesTable.description, `%${searchTerm}%`)
      ) as any
    );
  }

  if (industries) {
    const industryList = industries.split(",").map(s => s.trim()).filter(Boolean);
    if (industryList.length === 1) {
      conditions.push(ilike(companiesTable.industry, `%${industryList[0]}%`) as any);
    } else if (industryList.length > 1) {
      conditions.push(inArray(companiesTable.industry, industryList) as any);
    }
  } else if (industry) {
    conditions.push(ilike(companiesTable.industry, `%${industry}%`) as any);
  }

  if (cities) {
    const cityList = cities.split(",").map(s => s.trim()).filter(Boolean);
    if (cityList.length === 1) {
      conditions.push(ilike(companiesTable.city, `%${cityList[0]}%`) as any);
    } else if (cityList.length > 1) {
      conditions.push(inArray(companiesTable.city, cityList) as any);
    }
  } else if (city) {
    conditions.push(ilike(companiesTable.city, `%${city}%`) as any);
  }

  if (employeeRanges) {
    const empList = employeeRanges.split(",").map(s => s.trim()).filter(Boolean);
    if (empList.length > 0) {
      conditions.push(inArray(companiesTable.employeeCount, empList) as any);
    }
  }

  if (revenueMin !== undefined) {
    conditions.push(sql`(${companiesTable.revenue} ~ '^[0-9]+\.?[0-9]*$' AND CAST(${companiesTable.revenue} AS NUMERIC) >= ${revenueMin})` as any);
  }
  if (revenueMax !== undefined) {
    conditions.push(sql`(${companiesTable.revenue} ~ '^[0-9]+\.?[0-9]*$' AND CAST(${companiesTable.revenue} AS NUMERIC) <= ${revenueMax})` as any);
  }

  if (enrichmentStatus) conditions.push(eq(companiesTable.enrichmentStatus, enrichmentStatus) as any);
  if (companyType) conditions.push(eq(companiesTable.companyType, companyType) as any);

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let orderByClause;
  switch (sortBy) {
    case "revenue":
      orderByClause = sql`${companiesTable.enrichmentScore} DESC NULLS LAST`;
      break;
    case "established":
      orderByClause = desc(companiesTable.foundingYear);
      break;
    case "name":
      orderByClause = asc(companiesTable.nameEn);
      break;
    default:
      orderByClause = sql`${companiesTable.enrichmentScore} DESC NULLS LAST`;
  }

  const [companies, countResult] = await Promise.all([
    db.select().from(companiesTable).where(whereClause).orderBy(orderByClause).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(whereClause),
  ]);

  const total = Number(countResult[0]?.count || 0);
  res.json({ companies, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// ── Export ─────────────────────────────────────────────────────────────────

router.get("/companies/export", async (req: Request, res: Response): Promise<void> => {
  try {
    const format = (req.query.format as string) || "csv";
    const idsParam = req.query.ids as string | undefined;
    const dateStr = new Date().toISOString().slice(0, 10);

    let companies;
    if (idsParam) {
      const ids = idsParam.split(",").map(Number).filter(Boolean);
      companies = await db.select().from(companiesTable).where(inArray(companiesTable.id, ids));
    } else {
      companies = await db.select().from(companiesTable).where(curatedOnlyCondition).limit(10000);
    }

    if (format === "json") {
      res.json(companies);
      return;
    }

    const colKeys = [
      "id", "nameEn", "nameAr", "industry", "subIndustry", "city", "region", "website", "phone",
      "employeeCount", "revenue", "profit", "growthRate", "marketCap", "foundingYear",
      "ceo", "founder", "address", "enrichmentScore", "enrichmentStatus", "createdAt",
    ] as const;
    const colLabels: Record<string, string> = {
      id: "ID", nameEn: "Name (EN)", nameAr: "Name (AR)", industry: "Industry",
      subIndustry: "Sub-Industry", city: "City", region: "Region", website: "Website",
      phone: "Phone", employeeCount: "Employees", revenue: "Revenue", profit: "Profit",
      growthRate: "Growth Rate", marketCap: "Market Cap", foundingYear: "Founded",
      ceo: "CEO", founder: "Founder", address: "Address",
      enrichmentScore: "Enrich. Score", enrichmentStatus: "Enrich. Status", createdAt: "Created At",
    };

    if (format === "excel") {
      const rows = companies.map(c => {
        const row: Record<string, unknown> = {};
        colKeys.forEach(k => { row[colLabels[k]] = c[k as keyof typeof c] ?? ""; });
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = colKeys.map(k => ({ wch: Math.max(colLabels[k].length + 2, 14) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "OrcBase Companies");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="orcbase_companies_${dateStr}.xlsx"`);
      res.send(buf);
      return;
    }

    if (format === "word") {
      const tableRows = companies.map(c => `
        <tr>
          <td>${c.nameEn || c.nameAr || "—"}</td>
          <td>${c.industry || "—"}</td>
          <td>${c.city || "—"}</td>
          <td>${c.website ? `<a href="${c.website}">${c.website}</a>` : "—"}</td>
          <td>${c.phone || "—"}</td>
          <td>${c.employeeCount || "—"}</td>
          <td>${c.revenue || "—"}</td>
          <td>${c.ceo || "—"}</td>
          <td>${c.foundingYear || "—"}</td>
          <td>${c.enrichmentStatus || "—"}</td>
        </tr>`).join("");
      const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>OrcBase Companies</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 10pt; margin: 2cm; }
  h1 { font-size: 18pt; color: #1a1a2e; margin-bottom: 4pt; }
  .meta { font-size: 9pt; color: #666; margin-bottom: 16pt; }
  table { border-collapse: collapse; width: 100%; font-size: 9pt; }
  th { background: #1a1a2e; color: #fff; padding: 6pt 8pt; text-align: left; }
  td { padding: 5pt 8pt; border-bottom: 1pt solid #ddd; vertical-align: top; }
  tr:nth-child(even) td { background: #f5f5f5; }
</style></head>
<body>
<h1>OrcBase Company Database</h1>
<p class="meta">Exported: ${new Date().toLocaleDateString("en-SA", { year: "numeric", month: "long", day: "numeric" })} — ${companies.length} companies${idsParam ? " (selected records)" : ""}</p>
<table>
<thead><tr>
  <th>Company</th><th>Industry</th><th>City</th><th>Website</th>
  <th>Phone</th><th>Employees</th><th>Revenue</th><th>CEO</th><th>Founded</th><th>Enrichment</th>
</tr></thead>
<tbody>${tableRows}</tbody>
</table>
</body></html>`;
      res.setHeader("Content-Type", "application/vnd.ms-word");
      res.setHeader("Content-Disposition", `attachment; filename="orcbase_companies_${dateStr}.doc"`);
      res.send(html);
      return;
    }

    if (format === "pdf") {
      const tableRows = companies.map(c => `
        <tr>
          <td>${c.nameEn || c.nameAr || "—"}</td>
          <td>${c.industry || "—"}</td>
          <td>${c.city || "—"}</td>
          <td>${c.phone || "—"}</td>
          <td>${c.employeeCount || "—"}</td>
          <td>${c.revenue || "—"}</td>
          <td>${c.ceo || "—"}</td>
          <td>${c.foundingYear || "—"}</td>
          <td>${c.enrichmentStatus || "—"}</td>
        </tr>`).join("");
      const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>OrcBase Companies</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 15mm; color: #111; }
  h1 { font-size: 16px; margin-bottom: 3px; color: #1a1a2e; }
  .meta { font-size: 9px; color: #666; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1a1a2e; color: #fff; padding: 5px 7px; text-align: left; font-size: 9px; }
  td { padding: 4px 7px; border-bottom: 1px solid #eee; vertical-align: top; word-break: break-word; max-width: 120px; }
  tr:nth-child(even) td { background: #f9f9f9; }
  @media print { body { margin: 0; } .no-print { display: none; } }
</style></head>
<body>
<h1>OrcBase Company Database</h1>
<p class="meta">Exported: ${new Date().toLocaleDateString("en-SA", { year: "numeric", month: "long", day: "numeric" })} — ${companies.length} companies${idsParam ? " (selected records)" : ""}</p>
<button class="no-print" onclick="window.print()" style="margin-bottom:10px;padding:5px 14px;cursor:pointer;font-size:12px;">Print / Save as PDF</button>
<table>
<thead><tr>
  <th>Company</th><th>Industry</th><th>City</th><th>Phone</th>
  <th>Employees</th><th>Revenue</th><th>CEO</th><th>Founded</th><th>Enrichment</th>
</tr></thead>
<tbody>${tableRows}</tbody>
</table>
</body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
      return;
    }

    const csvRows = [
      colKeys.map(k => `"${colLabels[k]}"`).join(","),
      ...companies.map(c =>
        colKeys.map(k => {
          const val = c[k as keyof typeof c];
          if (val === null || val === undefined) return "";
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(",")
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="orcbase_companies_${dateStr}.csv"`);
    res.send("\uFEFF" + csvRows.join("\n"));
  } catch (err) {
    res.status(500).json({ error: "Export failed", detail: String(err) });
  }
});

// ── Bulk delete ────────────────────────────────────────────────────────────

router.post("/companies/bulk-delete", async (req: Request, res: Response): Promise<void> => {
  const { ids } = req.body as { ids: number[] };
  if (!ids?.length) {
    res.status(400).json({ error: "No IDs provided" });
    return;
  }
  const companies = await db.select().from(companiesTable).where(inArray(companiesTable.id, ids));
  if (companies.length > 0) {
    await addToBlocklist(companies.map(c => ({ nameEn: c.nameEn, nameAr: c.nameAr, crNumber: c.crNumber, website: c.website })), "orcbase");
  }
  await db.delete(companiesTable).where(inArray(companiesTable.id, ids));
  res.json({ success: true, message: `Deleted ${ids.length} companies` });
});

router.post("/companies/deduplicate", async (_req: Request, res: Response): Promise<void> => {
  try {
    const dupResult = await db.execute<{ name_en: string; ids: string; count: string }>(sql`
      SELECT LOWER(TRIM(name_en)) as name_en,
             STRING_AGG(id::text, ',' ORDER BY enrichment_score DESC NULLS LAST, id ASC) as ids,
             COUNT(*) as count
      FROM companies
      WHERE name_en IS NOT NULL AND name_en != ''
      GROUP BY LOWER(TRIM(name_en))
      HAVING COUNT(*) > 1
    `);

    const rows = dupResult.rows as { name_en: string; ids: string; count: string }[];
    let removed = 0;
    const idsToDelete: number[] = [];

    for (const row of rows) {
      const ids = row.ids.split(",").map(Number);
      idsToDelete.push(...ids.slice(1));
      removed += ids.length - 1;
    }

    if (idsToDelete.length > 0) {
      await db.delete(companiesTable).where(inArray(companiesTable.id, idsToDelete));
    }

    res.json({ success: true, removed, message: `Removed ${removed} duplicate companies` });
  } catch (err) {
    console.error("[Deduplicate] Error:", err);
    res.status(500).json({ error: "Deduplication failed", detail: String(err) });
  }
});

// ── Single company ─────────────────────────────────────────────────────────

router.get("/companies/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid company ID" }); return; }
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  res.json(company);
});

router.put("/companies/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid company ID" }); return; }
  const body = req.body;
  const allowed: Record<string, any> = {};
  const allowedFields = [
    "nameEn", "nameAr", "industry", "subIndustry", "city", "region", "website", "phone", "email",
    "description", "employeeCount", "revenue", "profit", "foundingYear", "logoUrl", "ceo", "founder",
    "address", "aiInsights", "enrichmentScore", "enrichmentStatus",
  ];
  for (const field of allowedFields) {
    if (body[field] !== undefined) allowed[field] = body[field];
  }
  allowed.updatedAt = new Date();
  const [updated] = await db.update(companiesTable).set(allowed).where(eq(companiesTable.id, id)).returning();
  res.json(updated);
});

router.delete("/companies/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid company ID" }); return; }
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id)).limit(1);
  if (company) {
    await addToBlocklist([{ nameEn: company.nameEn, nameAr: company.nameAr, crNumber: company.crNumber, website: company.website }], "orcbase");
  }
  await db.delete(companiesTable).where(eq(companiesTable.id, id));
  res.json({ success: true, message: "Company deleted" });
});

// ── Analytics dashboard stats ──────────────────────────────────────────────
router.get("/analytics/dashboard", async (_req: Request, res: Response): Promise<void> => {
  const [
    totalCompaniesRes, enrichedCompaniesRes, totalLeadsRes, builderCompaniesRes, activeJobsRes,
    industriesRes, citiesRes, recentActivityRes,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(companiesTable),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(eq(companiesTable.enrichmentStatus, "enriched")),
    db.select({ count: sql<number>`count(*)` }).from(leadsTable),
    db.select({ count: sql<number>`count(*)` }).from(builderCompaniesTable).where(eq(builderCompaniesTable.isDuplicate, false)),
    db.select({ count: sql<number>`count(*)` }).from(jobsTable).where(sql`${jobsTable.status} IN ('running','harvesting','extracting')`),
    db.select({ industry: companiesTable.industry, count: sql<number>`count(*)` })
      .from(companiesTable)
      .where(sql`${companiesTable.industry} IS NOT NULL AND ${companiesTable.industry} != ''`)
      .groupBy(companiesTable.industry)
      .orderBy(sql`count(*) desc`)
      .limit(10),
    db.select({ city: companiesTable.city, count: sql<number>`count(*)` })
      .from(companiesTable)
      .where(sql`${companiesTable.city} IS NOT NULL AND ${companiesTable.city} != ''`)
      .groupBy(companiesTable.city)
      .orderBy(sql`count(*) desc`)
      .limit(10),
    db.select({ nameEn: companiesTable.nameEn, createdAt: companiesTable.createdAt, dataSource: companiesTable.dataSource })
      .from(companiesTable)
      .orderBy(desc(companiesTable.createdAt))
      .limit(10),
  ]);

  res.json({
    totalCompanies: Number(totalCompaniesRes[0]?.count || 0),
    enrichedCompanies: Number(enrichedCompaniesRes[0]?.count || 0),
    totalLeads: Number(totalLeadsRes[0]?.count || 0),
    builderCompanies: Number(builderCompaniesRes[0]?.count || 0),
    activeJobs: Number(activeJobsRes[0]?.count || 0),
    industriesBreakdown: industriesRes.map(r => ({ industry: r.industry || "Unknown", count: Number(r.count) })),
    citiesBreakdown: citiesRes.map(r => ({ city: r.city || "Unknown", count: Number(r.count) })),
    recentActivity: recentActivityRes.map(r => ({
      type: "company_added",
      name: r.nameEn || "Unknown",
      source: r.dataSource || "unknown",
      createdAt: r.createdAt,
    })),
  });
});

export default router;
