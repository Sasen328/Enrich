CREATE TABLE "prospecting_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"format" text NOT NULL,
	"filename" text NOT NULL,
	"record_count" integer DEFAULT 0,
	"file_size" integer DEFAULT 0,
	"target_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "masar_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text,
	"name_ar" text,
	"cr_number" text,
	"legal_form" text,
	"legal_form_ar" text,
	"city" text,
	"city_ar" text,
	"region" text,
	"paid_up_capital" text,
	"authorized_capital" text,
	"founding_date" text,
	"founding_year" text,
	"registration_date" text,
	"expiry_date" text,
	"authorized_signatory" text,
	"shareholders" jsonb DEFAULT '[]'::jsonb,
	"board_of_directors" jsonb DEFAULT '[]'::jsonb,
	"management" jsonb DEFAULT '[]'::jsonb,
	"main_activity" text,
	"main_activity_ar" text,
	"registration_status" text,
	"source" text DEFAULT 'open-data' NOT NULL,
	"source_url" text,
	"enrichment_status" text DEFAULT 'pending',
	"website" text,
	"phone" text,
	"email" text,
	"employee_count" text,
	"revenue_estimate" text,
	"revenue_rationale" text,
	"news_headlines" jsonb DEFAULT '[]'::jsonb,
	"enrichment_data" jsonb DEFAULT '{}'::jsonb,
	"analysis_en" text,
	"analysis_ar" text,
	"analysis_data" jsonb DEFAULT '{}'::jsonb,
	"capital_distribution" text,
	"profit_distribution_rules" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enriched_at" timestamp with time zone,
	CONSTRAINT "masar_companies_cr_number_unique" UNIQUE("cr_number")
);
--> statement-breakpoint
CREATE TABLE "masar_harvest_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"keyword" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"companies_found" integer DEFAULT 0,
	"companies_enriched" integer DEFAULT 0,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "masar_harvest_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "employee_count" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sub_industry" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "profit" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "growth_rate" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "market_cap" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "ceo" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "founder" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "ai_insights" text;--> statement-breakpoint
ALTER TABLE "executives" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "executives" ADD COLUMN "years_of_experience" integer;--> statement-breakpoint
ALTER TABLE "executives" ADD COLUMN "estimated_salary" integer;--> statement-breakpoint
ALTER TABLE "executives" ADD COLUMN "skills" text[];--> statement-breakpoint
ALTER TABLE "executives" ADD COLUMN "achievements" text[];--> statement-breakpoint
ALTER TABLE "executives" ADD COLUMN "previous_companies" text[];