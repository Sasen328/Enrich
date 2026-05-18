import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const masarCustomSourcesTable = pgTable("masar_custom_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMasarCustomSourceSchema = createInsertSchema(masarCustomSourcesTable).omit({ id: true, createdAt: true });
export type MasarCustomSource = typeof masarCustomSourcesTable.$inferSelect;
