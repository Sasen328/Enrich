import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// §2A — Behavior Agent event log (per session) for suggestions + learning.
export const behaviorEventsTable = pgTable("behavior_events", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  kind: text("kind").notNull(),                 // compose|nav|filter|run|save
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BehaviorEvent = typeof behaviorEventsTable.$inferSelect;
