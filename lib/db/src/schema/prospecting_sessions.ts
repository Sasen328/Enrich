import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const prospectingSessionsTable = pgTable("prospecting_sessions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  url: text("url").notNull(),
  websiteType: text("website_type"),
  detectedCategories: text("detected_categories"),
  estimatedCompanyCount: integer("estimated_company_count"),
  pagesFound: integer("pages_found").notNull().default(0),
  sampleCompanies: text("sample_companies"),
  language: text("language"),
  status: text("status").notNull().default("pending"),
  companiesFound: integer("companies_found").notNull().default(0),
  enrichmentStatus: text("enrichment_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProspectingSessionSchema = createInsertSchema(prospectingSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProspectingSession = z.infer<typeof insertProspectingSessionSchema>;
export type ProspectingSession = typeof prospectingSessionsTable.$inferSelect;
