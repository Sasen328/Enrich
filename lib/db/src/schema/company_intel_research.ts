import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const companyIntelResearchTable = pgTable("company_intel_research", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  website: text("website"),
  crNumber: text("cr_number"),
  city: text("city"),
  sellerContext: text("seller_context"),
  intelligenceGoals: text("intelligence_goals"),
  knownFacts: text("known_facts"),
  report: text("report"),
  tags: text("tags"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
