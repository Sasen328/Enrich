import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const prosengineResearchTable = pgTable("prosengine_research", {
  id: serial("id").primaryKey(),
  personName: text("person_name").notNull(),
  company: text("company"),
  title: text("title"),
  linkedinUrl: text("linkedin_url"),
  sellerContext: text("seller_context"),
  intelligenceGoals: text("intelligence_goals"),
  knownFacts: text("known_facts"),
  report: text("report"),
  tags: text("tags"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
