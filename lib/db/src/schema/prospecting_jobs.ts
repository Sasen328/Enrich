import { pgTable, text, serial, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const prospectingJobsTable = pgTable("prospecting_jobs", {
  id: serial("id").primaryKey(),
  targetUrl: text("target_url").notNull(),
  status: text("status").notNull().default("pending"),
  progress: integer("progress").default(0),
  resultCount: integer("result_count").default(0),
  totalCompaniesFound: integer("total_companies_found").default(0),
  totalEnriched: integer("total_enriched").default(0),
  errorMessage: text("error_message"),
  error: text("error"),
  scanResult: jsonb("scan_result"),
  scanSummary: jsonb("scan_summary"),
  pagesScanned: integer("pages_scanned").default(0),
  settings: jsonb("settings"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertProspectingJobSchema = createInsertSchema(prospectingJobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProspectingJob = z.infer<typeof insertProspectingJobSchema>;
export type ProspectingJob = typeof prospectingJobsTable.$inferSelect;

export interface SiteScanSummary {
  totalPages?: number;
  dataType?: string;
  siteDescription?: string;
  sampleItems?: string[];
  sampleCompanies?: string[];
  suggestedFields?: string[];
  categories?: string[];
  cities?: string[];
  industries?: string[];
  suggestedQuestions?: Array<{ question: string; options?: string[] }>;
  paginationType?: string;
  websiteType?: string;
  contentLanguage?: string;
  note?: string;
  listingPages?: string[];
}

export interface ProspectingSettings {
  targetUrl: string;
  maxPages: number;
  extractionFields: string[];
  filters: Record<string, unknown>;
  enrichmentDepth: 'basic' | 'standard' | 'deep';
  userAnswers?: Record<string, string | string[]>;
  exportFormat?: string;
  extractionLanguage?: string;
}

export interface ProspectingCompanyResult {
  name: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  industry?: string;
  category?: string;
  description?: string;
  employees?: number;
  revenue?: string;
  registrationNumber?: string;
  foundedYear?: number;
  crNumber?: string;
  sourceUrl?: string;
  source?: string;
  contactPerson?: string;
  enrichmentStatus?: string;
  executives?: Array<{ name: string; title?: string; email?: string; phone?: string }>;
  extras?: Record<string, string>;
  [key: string]: unknown;
}
