import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  firstNameAr: text("first_name_ar"),
  lastNameAr: text("last_name_ar"),
  title: text("title"),
  titleAr: text("title_ar"),
  email: text("email"),
  phone: text("phone"),
  linkedinUrl: text("linkedin_url"),
  twitterUrl: text("twitter_url"),
  department: text("department"),
  seniority: text("seniority"),
  notes: text("notes"),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
