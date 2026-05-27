import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

// §4A — Data Seeder staging. Rows discovered during HARVEST land here for
// review before they're enriched + promoted into companies/leads.
export const seederPlansTable = pgTable("seeder_plans", {
  id: serial("id").primaryKey(),
  rootUrl: text("root_url").notNull(),
  status: text("status").notNull().default("eval"), // eval|approved|harvesting|done|failed
  entities: jsonb("entities").$type<Array<{ type: string; count: number }>>().default([]),
  fields: jsonb("fields").$type<Array<{ name: string; confidence: number }>>().default([]),
  approvedFields: jsonb("approved_fields").$type<string[]>().default([]),
  pagesScanned: integer("pages_scanned").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const seederRowsTable = pgTable("seeder_rows", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull(),
  entityType: text("entity_type").notNull().default("company"), // company|person|product|contact
  data: jsonb("data").$type<Record<string, unknown>>().default({}),
  sourceUrl: text("source_url"),
  enrichmentStatus: text("enrichment_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SeederPlan = typeof seederPlansTable.$inferSelect;
export type SeederRow = typeof seederRowsTable.$inferSelect;
