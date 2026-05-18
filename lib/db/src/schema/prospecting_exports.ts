import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const prospectingExportsTable = pgTable("prospecting_exports", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  format: text("format").notNull(),
  filename: text("filename").notNull(),
  recordCount: integer("record_count").default(0),
  fileSize: integer("file_size").default(0),
  targetUrl: text("target_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProspectingExport = typeof prospectingExportsTable.$inferSelect;
