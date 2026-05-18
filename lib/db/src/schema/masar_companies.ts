import { pgTable, text, serial, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const masarCompaniesTable = pgTable("masar_companies", {
  id: serial("id").primaryKey(),
  nameEn: text("name_en"),
  nameAr: text("name_ar"),
  crNumber: text("cr_number").unique(),
  legalForm: text("legal_form"),
  legalFormAr: text("legal_form_ar"),
  city: text("city"),
  cityAr: text("city_ar"),
  region: text("region"),
  paidUpCapital: text("paid_up_capital"),
  authorizedCapital: text("authorized_capital"),
  foundingDate: text("founding_date"),
  foundingYear: text("founding_year"),
  registrationDate: text("registration_date"),
  expiryDate: text("expiry_date"),
  authorizedSignatory: text("authorized_signatory"),
  shareholders: jsonb("shareholders").$type<Array<{ nameEn: string; nameAr: string; nationalId: string; ownershipPct: string; nationality: string }>>().default([]),
  boardOfDirectors: jsonb("board_of_directors").$type<Array<{ nameEn: string; nameAr: string; role: string; nationalId?: string }>>().default([]),
  management: jsonb("management").$type<Array<{ nameEn: string; nameAr: string; title: string; nationalId?: string; powers?: string }>>().default([]),
  mainActivity: text("main_activity"),
  mainActivityAr: text("main_activity_ar"),
  registrationStatus: text("registration_status"),
  source: text("source").notNull().default("open-data"),
  sourceUrl: text("source_url"),
  enrichmentStatus: text("enrichment_status").default("pending"),
  website: text("website"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  employeeCount: text("employee_count"),
  revenueEstimate: text("revenue_estimate"),
  revenueRationale: text("revenue_rationale"),
  newsHeadlines: jsonb("news_headlines").$type<Array<{ title: string; date: string; source?: string }>>().default([]),
  enrichmentData: jsonb("enrichment_data").$type<Record<string, unknown>>().default({}),
  analysisEn: text("analysis_en"),
  analysisAr: text("analysis_ar"),
  analysisData: jsonb("analysis_data").$type<Record<string, unknown>>().default({}),
  capitalDistribution: text("capital_distribution"),
  profitDistributionRules: text("profit_distribution_rules"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  enrichedAt: timestamp("enriched_at", { withTimezone: true }),
});

export const insertMasarCompanySchema = createInsertSchema(masarCompaniesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMasarCompany = z.infer<typeof insertMasarCompanySchema>;
export type MasarCompany = typeof masarCompaniesTable.$inferSelect;
