import { pgTable, serial, text, jsonb, integer, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { leadsTable } from "./leads";

// ── Lead Factory Jobs ──────────────────────────────────────────────────────────
export const leadFactoryJobsTable = pgTable("lead_factory_jobs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("pending"),
  inputMode: text("input_mode").notNull().default("segment"),
  brief: jsonb("brief"),
  targetCount: integer("target_count").notNull().default(50),
  agentProgress: jsonb("agent_progress"),
  totalDiscovered: integer("total_discovered").notNull().default(0),
  totalEnriched: integer("total_enriched").notNull().default(0),
  totalValidated: integer("total_validated").notNull().default(0),
  totalPublished: integer("total_published").notNull().default(0),
  totalRejected: integer("total_rejected").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type LeadFactoryJob = typeof leadFactoryJobsTable.$inferSelect;

// ── Lead Factory Results ───────────────────────────────────────────────────────
// FK references with onDelete: cascade — deleting a job removes its results.
// publishedLeadId / publishedCompanyId set null on parent delete so we keep
// the audit trail even if the bridged company/lead is later removed.
export const leadFactoryResultsTable = pgTable("lead_factory_results", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => leadFactoryJobsTable.id, { onDelete: "cascade" }),
  companyName: text("company_name"),
  companyNameAr: text("company_name_ar"),
  domain: text("domain"),
  phone: text("phone"),
  email: text("email"),
  city: text("city"),
  region: text("region"),
  industry: text("industry"),
  subIndustry: text("sub_industry"),
  employeeCount: text("employee_count"),
  revenue: text("revenue"),
  crNumber: text("cr_number"),
  entityType: text("entity_type"),
  foundingYear: text("founding_year"),
  ownerName: text("owner_name"),
  keyExecutives: jsonb("key_executives"),
  description: text("description"),
  logoUrl: text("logo_url"),
  linkedinUrl: text("linkedin_url"),
  sourceUsed: text("source_used"),
  rawData: jsonb("raw_data"),
  enrichedData: jsonb("enriched_data"),
  signalData: jsonb("signal_data"),
  icpScore: integer("icp_score"),
  priorityTier: text("priority_tier"),
  buyingScore: integer("buying_score"),
  riskScore: integer("risk_score"),
  qualityScore: real("quality_score"),
  validationStatus: text("validation_status").notNull().default("pending"),
  validationReasons: jsonb("validation_reasons"),
  isDuplicate: boolean("is_duplicate").notNull().default(false),
  duplicateOf: text("duplicate_of"),
  outreachEmail: text("outreach_email"),
  outreachLinkedin: text("outreach_linkedin"),
  outreachWhatsapp: text("outreach_whatsapp"),
  openingAngle: text("opening_angle"),
  culturalNote: text("cultural_note"),
  conversationHook: text("conversation_hook"),
  publishedLeadId: integer("published_lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  publishedCompanyId: integer("published_company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeadFactoryResult = typeof leadFactoryResultsTable.$inferSelect;

// ── Deduplication Fingerprint Index ───────────────────────────────────────────
export const leadFingerprintsTable = pgTable("lead_fingerprints", {
  id: serial("id").primaryKey(),
  normalizedName: text("normalized_name"),
  domain: text("domain"),
  phoneNormalized: text("phone_normalized"),
  emailNormalized: text("email_normalized"),
  crNumber: text("cr_number"),
  sourceTable: text("source_table"),
  sourceId: integer("source_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Relationship Intelligence Jobs ────────────────────────────────────────────
export const relationshipIntelJobsTable = pgTable("relationship_intel_jobs", {
  id: serial("id").primaryKey(),
  targetCompanyName: text("target_company_name").notNull(),
  targetCompanyNameAr: text("target_company_name_ar"),
  targetCrNumber: text("target_cr_number"),
  targetWebsite: text("target_website"),
  status: text("status").notNull().default("pending"),
  orgChartData: jsonb("org_chart_data"),
  networkData: jsonb("network_data"),
  outreachPlan: jsonb("outreach_plan"),
  totalContacts: integer("total_contacts").notNull().default(0),
  totalConnections: integer("total_connections").notNull().default(0),
  adjacentCompanies: integer("adjacent_companies").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type RelationshipIntelJob = typeof relationshipIntelJobsTable.$inferSelect;
