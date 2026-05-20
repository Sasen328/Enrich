/**
 * Composer DB schema — user-CRUD tables for skills, templates, sources, runs,
 * and the rendered report block tree per run.
 */
import { pgTable, text, serial, integer, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

/** User-customized skills (clone of built-in or fully new) */
export const composerSkillsTable = pgTable("composer_skills", {
  id: serial("id").primaryKey(),
  builtinId: text("builtin_id"),            // null if user-created from scratch
  name: text("name").notNull(),
  description: text("description"),
  systemPrompt: text("system_prompt").notNull(),
  toolWhitelist: text("tool_whitelist").array().notNull().default([]),
  reportSchema: text("report_schema").notNull().default("Custom"),
  modelTier: text("model_tier"),
  visibility: text("visibility").notNull().default("private"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** User-customized templates */
export const composerTemplatesTable = pgTable("composer_templates", {
  id: serial("id").primaryKey(),
  builtinId: text("builtin_id"),
  name: text("name").notNull(),
  description: text("description"),
  defaultQuestion: text("default_question").notNull(),
  defaultModes: text("default_modes").array().notNull().default([]),
  defaultTarget: text("default_target").notNull().default("both"),
  defaultCountries: text("default_countries").array().notNull().default([]),
  defaultIndustry: text("default_industry"),
  defaultSources: text("default_sources").array().notNull().default([]),
  defaultSkills: text("default_skills").array().notNull().default([]),
  requiredSchema: text("required_schema").notNull().default("LeadList"),
  visibility: text("visibility").notNull().default("private"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** User-added sources (URLs/feeds beyond the 60 built-ins) */
export const composerUserSourcesTable = pgTable("composer_user_sources", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  url: text("url").notNull(),
  category: text("category"),
  language: text("language").default("both"),
  countries: text("countries").array(),
  industries: text("industries").array(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Runs — one row per Compose & Run, stores the enhanced prompt + result */
export const composerRunsTable = pgTable("composer_runs", {
  id: serial("id").primaryKey(),
  state: jsonb("state").notNull(),          // full ComposerState
  enhancedPrompt: text("enhanced_prompt").notNull(),
  reportShape: text("report_shape").notNull().default("detail"),
  blocks: jsonb("blocks"),                  // ReportBlock[]
  rawText: text("raw_text"),                // raw LLM final text
  status: text("status").notNull().default("running"),  // running | done | failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
