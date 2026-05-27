import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// §11A — unified harvest source registry. Replaces the scattered
// composer_user_sources / masar_custom_sources / builder_custom_sources.
export const harvestSourcesTable = pgTable("harvest_sources", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  url: text("url"),
  type: text("type").notNull().default("web"),          // rss|sitemap|api|web|pdf|gov-registry
  category: text("category").notNull().default("custom"),// tadawul|cma|news|registry|social|sanctions|custom
  language: text("language").notNull().default("both"),  // ar|en|both
  countries: jsonb("countries").$type<string[]>().default([]),
  industries: jsonb("industries").$type<string[]>().default([]),
  credibility: text("credibility").notNull().default("secondary"), // primary|secondary|inferred
  trustWeight: integer("trust_weight").notNull().default(65),       // 0-100
  enabled: boolean("enabled").notNull().default(true),
  visibility: text("visibility").notNull().default("system"),       // system|user|team
  requiredForEngines: jsonb("required_for_engines").$type<string[]>().default([]),
  lastSynced: timestamp("last_synced", { withTimezone: true }),
  status: text("status").notNull().default("ok"),                   // ok|degraded|down
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-engine enforcement: which source IDs an engine MUST use / MUST skip.
export const sourceEnforcementTable = pgTable("source_enforcement", {
  id: serial("id").primaryKey(),
  engineName: text("engine_name").notNull(), // lead-factory|prosengine|masaar|builder|signals|relationship
  requiredIds: jsonb("required_ids").$type<number[]>().default([]),
  excludedIds: jsonb("excluded_ids").$type<number[]>().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHarvestSourceSchema = createInsertSchema(harvestSourcesTable).omit({ id: true, createdAt: true });
export type HarvestSource = typeof harvestSourcesTable.$inferSelect;
export type SourceEnforcement = typeof sourceEnforcementTable.$inferSelect;
