import { pgTable, text, serial, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const templatesTable = pgTable("templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  config: jsonb("config"),
  isBuiltin: boolean("is_builtin").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTemplateSchema = createInsertSchema(templatesTable).omit({ id: true, createdAt: true });
export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templatesTable.$inferSelect;
export type ResearchTemplate = Template;

export interface TemplateConfig {
  agents?: string[];
  maxSources?: number;
  depth?: 'basic' | 'standard' | 'deep';
  focusAreas?: string[];
  outputFormat?: string;
  [key: string]: unknown;
}
