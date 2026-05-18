/**
 * Company Deletion Blocklist
 * When a company is deleted from any module, its identifiers are recorded here.
 * The harvest/seed processes check this before inserting to prevent re-seeding.
 */

import { db } from "@workspace/db";
import { deletedCompaniesTable } from "@workspace/db/schema";
import { or, eq, sql } from "drizzle-orm";

// ── Normalise a company name for fuzzy matching ───────────────────────────────
function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\b(company|co|ltd|llc|corp|inc|group|holding|holdings|international|intl|establishment|est|trading|industries|industrial|services|solutions|technology|technologies|sa|ksa|the)\b\.?/g, "")
    .replace(/[^a-z0-9\u0600-\u06FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Extract domain from website URL ──────────────────────────────────────────
function normalizeWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = website.startsWith("http") ? website : `https://${website}`;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch { return null; }
}

export interface BlocklistEntry {
  nameEn?: string | null;
  nameAr?: string | null;
  crNumber?: string | null;
  website?: string | null;
}

// ── Add one or more companies to the blocklist ────────────────────────────────
export async function addToBlocklist(
  companies: BlocklistEntry[],
  module: "masaar" | "builder" | "orcbase"
): Promise<void> {
  if (!companies.length) return;
  try {
    await db.insert(deletedCompaniesTable).values(
      companies.map(c => ({
        nameEn: c.nameEn || null,
        nameAr: c.nameAr || null,
        crNumber: c.crNumber || null,
        website: normalizeWebsite(c.website),
        module,
      }))
    );
  } catch (err) {
    console.error("[Blocklist] Failed to record deletions:", err);
  }
}

// ── Check a single company against the blocklist ──────────────────────────────
export async function isBlocked(entry: BlocklistEntry): Promise<boolean> {
  try {
    const conditions = [];

    if (entry.crNumber) {
      conditions.push(eq(deletedCompaniesTable.crNumber, entry.crNumber));
    }

    const domain = normalizeWebsite(entry.website);
    if (domain) {
      conditions.push(eq(deletedCompaniesTable.website, domain));
    }

    const enKey = normalizeName(entry.nameEn);
    const arKey = normalizeName(entry.nameAr);

    if (conditions.length === 0 && !enKey && !arKey) return false;

    const rows = await db.select({ nameEn: deletedCompaniesTable.nameEn, nameAr: deletedCompaniesTable.nameAr })
      .from(deletedCompaniesTable);

    if (conditions.length > 0) {
      const directHit = await db.select({ id: deletedCompaniesTable.id })
        .from(deletedCompaniesTable)
        .where(or(...conditions))
        .limit(1);
      if (directHit.length > 0) return true;
    }

    if (enKey || arKey) {
      for (const row of rows) {
        if (enKey && normalizeName(row.nameEn) === enKey) return true;
        if (arKey && normalizeName(row.nameAr) === arKey) return true;
      }
    }

    return false;
  } catch (err) {
    console.error("[Blocklist] isBlocked check failed:", err);
    return false;
  }
}

// ── Batch check: returns Set of indices that are blocked ──────────────────────
export async function filterBlocked(entries: BlocklistEntry[]): Promise<Set<number>> {
  if (!entries.length) return new Set();
  try {
    const allBlocked = await db.select().from(deletedCompaniesTable);
    const blocked = new Set<number>();

    const blockedCRs = new Set(allBlocked.map(b => b.crNumber).filter(Boolean));
    const blockedDomains = new Set(allBlocked.map(b => b.website).filter(Boolean));
    const blockedEnNames = new Set(allBlocked.map(b => normalizeName(b.nameEn)).filter(Boolean));
    const blockedArNames = new Set(allBlocked.map(b => normalizeName(b.nameAr)).filter(Boolean));

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.crNumber && blockedCRs.has(e.crNumber)) { blocked.add(i); continue; }
      const domain = normalizeWebsite(e.website);
      if (domain && blockedDomains.has(domain)) { blocked.add(i); continue; }
      const enKey = normalizeName(e.nameEn);
      const arKey = normalizeName(e.nameAr);
      if (enKey && blockedEnNames.has(enKey)) { blocked.add(i); continue; }
      if (arKey && blockedArNames.has(arKey)) { blocked.add(i); continue; }
    }

    return blocked;
  } catch (err) {
    console.error("[Blocklist] filterBlocked failed:", err);
    return new Set();
  }
}

// ── List all blocklist entries (for admin visibility) ─────────────────────────
export async function getBlocklist() {
  return db.select().from(deletedCompaniesTable).orderBy(sql`deleted_at DESC`);
}

// ── Remove a specific entry from the blocklist (unblock) ──────────────────────
export async function removeFromBlocklist(id: number) {
  await db.delete(deletedCompaniesTable).where(eq(deletedCompaniesTable.id, id));
}
