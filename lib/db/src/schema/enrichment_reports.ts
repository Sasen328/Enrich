import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const enrichmentReportsTable = pgTable("enrichment_reports", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  subjectName: text("subject_name").notNull(),
  subjectCompany: text("subject_company"),
  confidenceScore: text("confidence_score"),
  reportData: jsonb("report_data"),
  sources: jsonb("sources"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEnrichmentReportSchema = createInsertSchema(enrichmentReportsTable).omit({ id: true, createdAt: true });
export type InsertEnrichmentReport = z.infer<typeof insertEnrichmentReportSchema>;
export type EnrichmentReport = typeof enrichmentReportsTable.$inferSelect;

export interface EnrichmentSource {
  title: string;
  confidence: number;
  url?: string;
  type?: string;
}

export interface EnrichmentReportData {
  profileSummary?: string;
  companyOverview?: {
    legalName?: string;
    tradingName?: string;
    arabicName?: string;
    founded?: string | number;
    founders?: string[];
    headquarters?: {
      address?: string;
      city?: string;
      country?: string;
      coordinates?: { lat?: number; lng?: number };
    };
    companyType?: string;
    registrationNumber?: string;
    stockInfo?: {
      exchange?: string;
      ticker?: string;
      marketCap?: string;
      weekHigh52?: string;
    };
  };
  financials?: {
    annualRevenue?: string;
    revenueGrowth?: string;
    netIncome?: string;
    profitMargin?: string;
    totalAssets?: string;
  };
  workforce?: {
    totalEmployees?: number | string;
    employeeGrowth?: string;
    saudiNationalsPercentage?: number | string;
    keyDepartments?: string[];
  };
  ownership?: {
    ownershipType?: string;
    majorShareholders?: Array<{
      name?: string;
      arabicName?: string;
      percentage?: number;
      type?: string;
    }>;
    publicFloat?: number;
    governmentStake?: number;
    familyOwnership?: boolean;
  };
  leadership?: {
    boardOfDirectors?: Array<{
      name?: string;
      arabicName?: string;
      title?: string;
      background?: string;
      otherBoards?: string[];
      aiAnalysis?: string;
    }>;
    executiveTeam?: Array<{
      name?: string;
      arabicName?: string;
      title?: string;
      department?: string;
      background?: string;
      education?: string;
      linkedin?: string;
      email?: string;
      estimatedCompensation?: string;
    } | null | undefined>;
  };
  currentRole?: {
    title?: string;
    company?: string;
    department?: string;
    startDate?: string;
    estimatedCompensation?: string;
  };
  careerHistory?: Array<{
    title?: string;
    company?: string;
    startDate?: string;
    endDate?: string;
    description?: string;
  }>;
  education?: Array<{
    degree?: string;
    institution?: string;
    year?: string;
  }>;
  skills?: string[];
  boardPositions?: Array<{ company?: string; role?: string }>;
  certifications?: string[];
  awards?: string[];
  publications?: string[];
  socialProfiles?: {
    linkedin?: string;
    twitter?: string;
    email?: string;
    phone?: string;
  };
  networkInsights?: {
    keyConnections?: string[];
    industryInfluence?: number;
    thoughtLeadership?: string;
  };
  keyInsights?: string[];
  strengths?: string[];
  recommendations?: string[];
  engagementRecommendations?: string[];
  estimatedCompensation?: string;
  companyPositioning?: string;
  [key: string]: unknown;
}
