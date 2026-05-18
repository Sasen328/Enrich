import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull().unique(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  phase: text("phase"),
  sessionId: text("session_id"),
  sourceIds: text("source_ids"),
  sourcesTotal: integer("sources_total").notNull().default(0),
  sourcesCompleted: integer("sources_completed").notNull().default(0),
  companiesHarvested: integer("companies_harvested").notNull().default(0),
  companiesEnriched: integer("companies_enriched").notNull().default(0),
  companiesDuplicated: integer("companies_duplicated").notNull().default(0),
  progress: integer("progress").notNull().default(0),
  total: integer("total").notNull().default(0),
  companiesProcessed: integer("companies_processed").notNull().default(0),
  agentStatuses: text("agent_statuses"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
