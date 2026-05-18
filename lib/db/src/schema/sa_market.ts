import { pgTable, text, serial, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";

export const saMarketShareholdersTable = pgTable("sa_market_shareholders", {
  id: serial("id").primaryKey(),
  stockCode: text("stock_code"),
  stockIndex: text("stock_index"),
  companyName: text("company_name"),
  companyNameAr: text("company_name_ar"),
  sector: text("sector"),
  city: text("city"),
  shareholderName: text("shareholder_name"),
  shareholderNameAr: text("shareholder_name_ar"),
  shareholderType: text("shareholder_type"),
  ownershipPercent: real("ownership_percent"),
  ownershipDisplay: text("ownership_display"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const saMarketExecutivesTable = pgTable("sa_market_executives", {
  id: serial("id").primaryKey(),
  stockCode: text("stock_code"),
  stockIndex: text("stock_index"),
  companyName: text("company_name"),
  companyNameAr: text("company_name_ar"),
  sector: text("sector"),
  city: text("city"),
  executiveName: text("executive_name"),
  position: text("position"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const saMarketProfilesTable = pgTable("sa_market_profiles", {
  id: serial("id").primaryKey(),
  personName: text("person_name").notNull(),
  personType: text("person_type").notNull(),
  companyName: text("company_name"),
  sector: text("sector"),
  estimatedAnnualIncome: text("estimated_annual_income"),
  estimatedWealth: text("estimated_wealth"),
  investmentAppetite: text("investment_appetite"),
  investmentFocus: text("investment_focus"),
  educationBackground: text("education_background"),
  careerHistory: text("career_history"),
  boardMemberships: text("board_memberships"),
  keyConnections: text("key_connections"),
  bestTimeToContact: text("best_time_to_contact"),
  approachStrategy: text("approach_strategy"),
  riskProfile: text("risk_profile"),
  philanthropyInterests: text("philanthropy_interests"),
  geographicPresence: text("geographic_presence"),
  languagesSpoken: text("languages_spoken"),
  publicProfiles: jsonb("public_profiles").$type<string[]>().default([]),
  rawProfile: text("raw_profile"),
  profileScore: integer("profile_score"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SaMarketShareholder = typeof saMarketShareholdersTable.$inferSelect;
export type SaMarketExecutive = typeof saMarketExecutivesTable.$inferSelect;
export type SaMarketProfile = typeof saMarketProfilesTable.$inferSelect;
