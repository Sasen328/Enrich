import { Router, type IRouter, type Request, type Response } from "express";
import { db, leadsTable, companiesTable } from "@workspace/db";
import { eq, ilike, and, or, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/leads", async (req: Request, res: Response): Promise<void> => {
  const page = parseInt(String(req.query.page || "1"), 10);
  const limit = Math.min(parseInt(String(req.query.limit || "20"), 10), 100);
  const offset = (page - 1) * limit;
  const search = req.query.search as string | undefined;
  const companyId = req.query.companyId ? parseInt(String(req.query.companyId), 10) : undefined;
  const status = req.query.status as string | undefined;

  const conditions = [];
  if (search) {
    conditions.push(
      or(
        ilike(leadsTable.firstName, `%${search}%`),
        ilike(leadsTable.lastName, `%${search}%`),
        ilike(leadsTable.email, `%${search}%`),
        ilike(leadsTable.title, `%${search}%`)
      )
    );
  }
  if (companyId) conditions.push(eq(leadsTable.companyId, companyId));
  if (status) conditions.push(eq(leadsTable.status, status));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [leads, countResult] = await Promise.all([
    db.select().from(leadsTable).where(whereClause).limit(limit).offset(offset).orderBy(sql`${leadsTable.updatedAt} DESC`),
    db.select({ count: sql<number>`count(*)` }).from(leadsTable).where(whereClause),
  ]);

  const leadsWithCompanies = await Promise.all(
    leads.map(async (lead) => {
      if (lead.companyId) {
        const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, lead.companyId));
        return { ...lead, company: company || null };
      }
      return { ...lead, company: null };
    })
  );

  const total = Number(countResult[0]?.count || 0);
  res.json({ leads: leadsWithCompanies, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.post("/leads", async (req: Request, res: Response): Promise<void> => {
  const { companyId, firstName, lastName, title, email, phone, linkedinUrl, department, seniority, notes, status } = req.body as {
    companyId?: number;
    firstName?: string;
    lastName?: string;
    title?: string;
    email?: string;
    phone?: string;
    linkedinUrl?: string;
    department?: string;
    seniority?: string;
    notes?: string;
    status?: string;
  };

  const [lead] = await db.insert(leadsTable).values({
    companyId: companyId || null,
    firstName: firstName || null,
    lastName: lastName || null,
    title: title || null,
    email: email || null,
    phone: phone || null,
    linkedinUrl: linkedinUrl || null,
    department: department || null,
    seniority: seniority || null,
    notes: notes || null,
    status: status || "new",
  }).returning();

  res.status(201).json(lead);
});

router.patch("/leads/:id", async (req: Request, res: Response): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const body = req.body as Record<string, unknown>;
  const [updated] = await db.update(leadsTable).set({ ...body, updatedAt: new Date() }).where(eq(leadsTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json(updated);
});

router.delete("/leads/:id", async (req: Request, res: Response): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(leadsTable).where(eq(leadsTable.id, id));
  res.json({ success: true, message: "Lead deleted" });
});

export default router;
