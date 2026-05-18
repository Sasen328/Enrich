import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const builderJobsTable = pgTable("builder_jobs", {
  id: serial("id").primaryKey(),
  legacyJobId: text("legacy_job_id"),
  status: text("status").notNull().default("pending"),
  sourceIndex: integer("source_index").notNull().default(0),
  log: text("log"),
  companiesFound: integer("companies_found").notNull().default(0),
  companiesAdded: integer("companies_added").notNull().default(0),
  companiesDuplicate: integer("companies_duplicate").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertBuilderJobSchema = createInsertSchema(builderJobsTable).omit({ id: true });
export type InsertBuilderJob = z.infer<typeof insertBuilderJobSchema>;
export type BuilderJob = typeof builderJobsTable.$inferSelect;
