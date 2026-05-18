import { pgTable, text, serial, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const researchJobsTable = pgTable("research_jobs", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  status: text("status").notNull().default("pending"),
  progress: integer("progress").default(0),
  report: jsonb("report"),
  sources: jsonb("sources"),
  findings: jsonb("findings"),
  agentResults: jsonb("agent_results"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertResearchJobSchema = createInsertSchema(researchJobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertResearchJob = z.infer<typeof insertResearchJobSchema>;
export type ResearchJob = typeof researchJobsTable.$inferSelect;

export interface ResearchSource {
  url?: string;
  title: string;
  snippet?: string;
  relevanceScore?: number;
  agent?: string;
  publishedAt?: string;
}

export interface ResearchFinding {
  category: string;
  content: string;
  confidence?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface ResearchReport {
  summary: string;
  findings: ResearchFinding[];
  sources: ResearchSource[];
  metadata?: Record<string, unknown>;
  generatedAt?: string;
}

export interface AgentResult {
  agentName: string;
  status: 'success' | 'partial' | 'failed';
  sources: ResearchSource[];
  findings: ResearchFinding[];
  metadata?: Record<string, unknown>;
  error?: string;
}
