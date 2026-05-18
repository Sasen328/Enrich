import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// TODO: builder_jobs.id is `serial` (int) but builder_companies.job_id is
// `text`. They likely join via builder_jobs.legacy_job_id. Decide the
// canonical key and add a proper FK in a follow-up migration.

export const builderCompaniesTable = pgTable("builder_companies", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull(),
  sourceId: text("source_id").notNull(),
  sourceName: text("source_name"),
  nameAr: text("name_ar"),
  nameEn: text("name_en"),
  industry: text("industry"),
  industryAr: text("industry_ar"),
  city: text("city"),
  region: text("region"),
  country: text("country").notNull().default("Saudi Arabia"),
  website: text("website"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  description: text("description"),
  descriptionAr: text("description_ar"),
  employeeCount: integer("employee_count"),
  revenue: text("revenue"),
  foundingYear: integer("founding_year"),
  crNumber: text("cr_number"),
  capitalAmount: text("capital_amount"),
  entityType: text("entity_type"),
  companyType: text("company_type"),
  ownerName: text("owner_name"),
  ownerNameAr: text("owner_name_ar"),
  ownerTitle: text("owner_title"),
  ownerPhone: text("owner_phone"),
  ownerEmail: text("owner_email"),
  ownerLinkedin: text("owner_linkedin"),
  estimatedWealth: text("estimated_wealth"),
  shareholders: text("shareholders"),
  keyExecutives: text("key_executives"),
  marketPositioning: text("market_positioning"),
  recentNews: text("recent_news"),
  linkedinUrl: text("linkedin_url"),
  enrichmentScore: integer("enrichment_score"),
  enrichmentStatus: text("enrichment_status"),
  isDuplicate: boolean("is_duplicate").notNull().default(false),
  isValidated: boolean("is_validated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBuilderCompanySchema = createInsertSchema(builderCompaniesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBuilderCompany = z.infer<typeof insertBuilderCompanySchema>;
export type BuilderCompany = typeof builderCompaniesTable.$inferSelect;
