import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { prospectingJobsTable } from "./prospecting_jobs";

export const prospectingResultsTable = pgTable("prospecting_results", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => prospectingJobsTable.id, { onDelete: "cascade" }),
  companyData: jsonb("company_data"),
  enrichmentStatus: text("enrichment_status").default("pending"),
  sourceUrl: text("source_url"),
  enrichmentReportId: text("enrichment_report_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProspectingResultSchema = createInsertSchema(prospectingResultsTable).omit({ id: true, createdAt: true });
export type InsertProspectingResult = z.infer<typeof insertProspectingResultSchema>;
export type ProspectingResult = typeof prospectingResultsTable.$inferSelect;

export interface FastEnrichmentResult {
  profileSummary: string;
  industry: string;
  employees: string;
  revenue: string;
  founded: string;
  services: string[];
  keyPeople: string[];
  ownerName?: string;
  ownerDetails?: string;
  estimatedWealth?: string;
  shareholders?: Array<{ name: string; percentage: string; estimatedWealth: string }>;
  location: string;
  landline?: string;
  email?: string;
  website: string;
  socialMedia: Record<string, string>;
  crNumber?: string;
  capital?: string;
  entityType?: string;
  registrationDate?: string;
  marketPositioning?: string;
  contactPerson?: string;
}
