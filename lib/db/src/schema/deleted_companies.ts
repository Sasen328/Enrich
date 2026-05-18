import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const deletedCompaniesTable = pgTable("deleted_companies", {
  id: serial("id").primaryKey(),
  nameEn: text("name_en"),
  nameAr: text("name_ar"),
  crNumber: text("cr_number"),
  website: text("website"),
  module: text("module").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeletedCompany = typeof deletedCompaniesTable.$inferSelect;
