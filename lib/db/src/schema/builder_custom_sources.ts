import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const builderCustomSourcesTable = pgTable("builder_custom_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  url: text("url").notNull(),
  category: text("category").notNull().default("other"),
  description: text("description"),
  estimatedCompanies: integer("estimated_companies").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
