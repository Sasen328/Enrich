import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const leadListsTable = pgTable("lead_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  criteria: text("criteria").notNull(),
  status: text("status").notNull().default("pending"),
  totalFound: integer("total_found").default(0),
  sourcesSearched: text("sources_searched"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leadListItemsTable = pgTable("lead_list_items", {
  id: serial("id").primaryKey(),
  listId: integer("list_id").notNull(),
  // Person fields
  personName: text("person_name"),
  personNameAr: text("person_name_ar"),
  personTitle: text("person_title"),
  personTitleAr: text("person_title_ar"),
  personType: text("person_type"),
  seniority: text("seniority"),
  department: text("department"),
  nationality: text("nationality"),
  linkedin: text("linkedin"),
  estimatedSalary: integer("estimated_salary"),
  biography: text("biography"),
  // Company context
  companyName: text("company_name"),
  companyNameAr: text("company_name_ar"),
  industry: text("industry"),
  city: text("city"),
  companyRevenue: text("company_revenue"),
  companyEmployees: text("company_employees"),
  crNumber: text("cr_number"),
  ownershipPct: text("ownership_pct"),
  // Contact info
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  // Scoring
  source: text("source"),
  sourceId: text("source_id"),
  matchScore: integer("match_score").default(0),
  aiScore: integer("ai_score"),
  aiReasoning: text("ai_reasoning"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeadList = typeof leadListsTable.$inferSelect;
export type LeadListItem = typeof leadListItemsTable.$inferSelect;
