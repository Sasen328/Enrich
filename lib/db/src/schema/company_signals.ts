import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companySignalsTable = pgTable("company_signals", {
  id: serial("id").primaryKey(),

  companyId: integer("company_id"),
  companyName: text("company_name").notNull(),
  companyNameAr: text("company_name_ar"),
  domain: text("domain"),

  // Event classification
  category: text("category").notNull(),       // positive | negative | neutral | mixed
  eventTypes: jsonb("event_types").$type<string[]>().notNull().default([]),
  primaryEventType: text("primary_event_type"), // funding | ipo | contract | lawsuit | bankruptcy | sanctions | ...

  // Source article
  title: text("title").notNull(),
  summary: text("summary"),
  sourceUrl: text("source_url"),
  sourceName: text("source_name"),
  publishedAt: timestamp("published_at", { withTimezone: true }),

  // LLM analysis
  llmSummary: text("llm_summary"),          // 1-sentence LLM-generated summary
  buyingSignalScore: integer("buying_signal_score").default(0),  // 0-10
  riskScore: integer("risk_score").default(0),                   // 0-10
  relevanceScore: integer("relevance_score").default(5),         // 0-10
  recommendedAction: text("recommended_action"), // prioritize | monitor | hold | disqualify

  // Sanctions-specific
  isSanctioned: integer("is_sanctioned").default(0),
  sanctionsHits: jsonb("sanctions_hits").$type<Array<{list: string; matchedName: string; program?: string}>>(),

  // Metadata
  rawSignals: jsonb("raw_signals"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompanySignalSchema = createInsertSchema(companySignalsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCompanySignal = z.infer<typeof insertCompanySignalSchema>;
export type CompanySignal = typeof companySignalsTable.$inferSelect;
