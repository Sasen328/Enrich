import { Router, type IRouter, type Request, type Response } from "express";
import { db, leadsTable, companiesTable, executivesTable } from "@workspace/db";
import { eq, ilike, and, or, sql } from "drizzle-orm";
import { insertLeadWithGate, type GateInput } from "../lib/lead-gate.js";

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

/**
 * POST /api/leads
 * Manual single-lead insert. Routes through the same validate + dedup + verify
 * gate the 7-agent pipeline uses (Agent 5). Rejects placeholder/dummy rows;
 * inserts "warn" leads with status="unverified".
 */
router.post("/leads", async (req: Request, res: Response): Promise<void> => {
  const b = req.body as Record<string, unknown>;
  const companyId = typeof b.companyId === "number" ? b.companyId : undefined;

  // Resolve company name from companyId if present, so validation can run
  let companyName: string | undefined;
  let companyDomain: string | undefined;
  if (companyId) {
    const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (c) {
      companyName = c.nameEn || c.nameAr || undefined;
      companyDomain = c.website || undefined;
    }
  }

  const input: GateInput = {
    firstName: (b.firstName as string) || undefined,
    lastName: (b.lastName as string) || undefined,
    title: (b.title as string) || undefined,
    email: (b.email as string) || undefined,
    emailTrusted: b.emailTrusted === true,
    phone: (b.phone as string) || undefined,
    linkedinUrl: (b.linkedinUrl as string) || undefined,
    department: (b.department as string) || undefined,
    seniority: (b.seniority as string) || undefined,
    companyName: (b.companyName as string) || companyName,
    domain: (b.domain as string) || companyDomain,
  };

  const { gate, lead, inserted } = await insertLeadWithGate(input, {
    companyId: companyId ?? null,
    status: (b.status as string) || undefined,
    notes: (b.notes as string) || undefined,
  });

  if (!inserted) {
    res.status(422).json({
      ok: false,
      error: "Lead rejected by validation gate",
      gate,
    });
    return;
  }

  res.status(201).json({ ok: true, lead, gate });
});

/**
 * POST /api/leads/push-from-company/:companyId
 * Bulk push: takes every executive row for a company, runs each through the
 * gate, inserts passing ones. Returns a summary { pushed, rejected, duplicate }.
 * This is what the "Push All to Leads" button on the company profile calls.
 */
router.post("/leads/push-from-company/:companyId", async (req: Request, res: Response): Promise<void> => {
  const companyId = parseInt(String(req.params.companyId), 10);
  if (!Number.isFinite(companyId)) {
    res.status(400).json({ ok: false, error: "Invalid companyId" });
    return;
  }

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  if (!company) {
    res.status(404).json({ ok: false, error: "Company not found" });
    return;
  }

  const execs = await db.select().from(executivesTable).where(eq(executivesTable.companyId, companyId));

  const results = {
    pushed: 0,
    rejected: 0,
    duplicate: 0,
    warned: 0,
    details: [] as Array<{ executiveId: number; name: string | null; status: string; reasons: string[]; leadId?: number }>,
  };

  const companyName = company.nameEn || company.nameAr || undefined;
  const companyDomain = company.website || undefined;

  for (const exec of execs) {
    // Split "Full Name" → firstName + lastName for the lead schema
    const fullName = exec.name || "";
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts[0] || undefined;
    const lastName = parts.slice(1).join(" ") || undefined;

    const input: GateInput = {
      firstName,
      lastName,
      title: exec.position || undefined,
      email: exec.email || undefined,
      emailTrusted: !!exec.email && !!exec.dataSource && exec.dataSource !== "ai_guessed",
      phone: exec.phone || undefined,
      linkedinUrl: exec.linkedinUrl || exec.linkedin || undefined,
      department: exec.department || undefined,
      seniority: exec.seniorityLevel || undefined,
      companyName,
      domain: companyDomain,
    };

    const { gate, lead, inserted } = await insertLeadWithGate(input, {
      companyId,
    });

    if (gate.isDuplicate) results.duplicate++;
    if (gate.status === "warn") results.warned++;
    if (gate.status === "reject" || !inserted) {
      results.rejected++;
    } else {
      results.pushed++;
    }

    results.details.push({
      executiveId: exec.id,
      name: fullName || null,
      status: gate.status,
      reasons: gate.reasons,
      leadId: lead?.id,
    });
  }

  res.json({ ok: true, companyId, totalExecutives: execs.length, ...results });
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
