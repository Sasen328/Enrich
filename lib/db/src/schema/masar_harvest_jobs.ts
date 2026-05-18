import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const masarHarvestJobsTable = pgTable("masar_harvest_jobs", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull().unique(),
  keyword: text("keyword").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull().default("running"),
  companiesFound: integer("companies_found").default(0),
  companiesEnriched: integer("companies_enriched").default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertMasarHarvestJobSchema = createInsertSchema(masarHarvestJobsTable).omit({ id: true, createdAt: true });
export type InsertMasarHarvestJob = z.infer<typeof insertMasarHarvestJobSchema>;
export type MasarHarvestJob = typeof masarHarvestJobsTable.$inferSelect;
