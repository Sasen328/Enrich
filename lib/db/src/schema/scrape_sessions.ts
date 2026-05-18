import { pgTable, text, serial, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scrapeSessionsTable = pgTable("scrape_sessions", {
  id: serial("id").primaryKey(),
  urls: jsonb("urls"),
  knowledgeBase: jsonb("knowledge_base"),
  chatHistory: jsonb("chat_history"),
  summary: text("summary"),
  progress: integer("progress").default(0),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScrapeSessionSchema = createInsertSchema(scrapeSessionsTable).omit({ id: true, createdAt: true });
export type InsertScrapeSession = z.infer<typeof insertScrapeSessionSchema>;
export type ScrapeSession = typeof scrapeSessionsTable.$inferSelect;
