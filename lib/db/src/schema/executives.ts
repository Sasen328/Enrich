import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const executivesTable = pgTable("executives", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id),
  companyName: text("company_name"),
  name: text("name"),
  nameAr: text("name_ar"),
  position: text("position"),
  positionAr: text("position_ar"),
  email: text("email"),
  phone: text("phone"),
  linkedin: text("linkedin"),
  linkedinUrl: text("linkedin_url"),
  location: text("location"),
  biography: text("biography"),
  education: text("education"),
  salary: text("salary"),
  seniorityLevel: text("seniority_level"),
  department: text("department"),
  photoUrl: text("photo_url"),
  yearsOfExperience: integer("years_of_experience"),
  estimatedSalary: integer("estimated_salary"),
  skills: text("skills").array(),
  achievements: text("achievements").array(),
  previousCompanies: text("previous_companies").array(),
  apolloId: text("apollo_id"),
  isFeatured: boolean("is_featured").default(false),
  enrichmentStatus: text("enrichment_status").default("pending"),
  dataSource: text("data_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertExecutiveSchema = createInsertSchema(executivesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExecutive = z.infer<typeof insertExecutiveSchema>;
export type Executive = typeof executivesTable.$inferSelect;
