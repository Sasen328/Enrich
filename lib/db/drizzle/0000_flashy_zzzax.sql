CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_ar" text,
	"name_en" text,
	"industry" text,
	"industry_ar" text,
	"city" text,
	"region" text,
	"country" text DEFAULT 'Saudi Arabia' NOT NULL,
	"website" text,
	"phone" text,
	"email" text,
	"description" text,
	"description_ar" text,
	"employee_count" integer,
	"revenue" text,
	"founding_year" integer,
	"cr_number" text,
	"capital_amount" text,
	"entity_type" text,
	"company_type" text,
	"owner_name" text,
	"owner_name_ar" text,
	"owner_title" text,
	"owner_phone" text,
	"owner_email" text,
	"owner_linkedin" text,
	"estimated_wealth" text,
	"shareholders" text,
	"key_executives" text,
	"market_positioning" text,
	"recent_news" text,
	"linkedin_url" text,
	"twitter_url" text,
	"enrichment_score" integer,
	"enrichment_status" text,
	"data_source" text,
	"tags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builder_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_name" text,
	"name_ar" text,
	"name_en" text,
	"industry" text,
	"industry_ar" text,
	"city" text,
	"region" text,
	"country" text DEFAULT 'Saudi Arabia' NOT NULL,
	"website" text,
	"phone" text,
	"email" text,
	"description" text,
	"description_ar" text,
	"employee_count" integer,
	"revenue" text,
	"founding_year" integer,
	"cr_number" text,
	"capital_amount" text,
	"entity_type" text,
	"company_type" text,
	"owner_name" text,
	"owner_name_ar" text,
	"owner_title" text,
	"owner_phone" text,
	"owner_email" text,
	"owner_linkedin" text,
	"estimated_wealth" text,
	"shareholders" text,
	"key_executives" text,
	"market_positioning" text,
	"recent_news" text,
	"linkedin_url" text,
	"enrichment_score" integer,
	"enrichment_status" text,
	"is_duplicate" boolean DEFAULT false NOT NULL,
	"is_validated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builder_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_job_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"source_index" integer DEFAULT 0 NOT NULL,
	"log" text,
	"companies_found" integer DEFAULT 0 NOT NULL,
	"companies_added" integer DEFAULT 0 NOT NULL,
	"companies_duplicate" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prospecting_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"url" text NOT NULL,
	"website_type" text,
	"detected_categories" text,
	"estimated_company_count" integer,
	"pages_found" integer DEFAULT 0 NOT NULL,
	"sample_companies" text,
	"language" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"companies_found" integer DEFAULT 0 NOT NULL,
	"enrichment_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospecting_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"phase" text,
	"session_id" text,
	"source_ids" text,
	"sources_total" integer DEFAULT 0 NOT NULL,
	"sources_completed" integer DEFAULT 0 NOT NULL,
	"companies_harvested" integer DEFAULT 0 NOT NULL,
	"companies_enriched" integer DEFAULT 0 NOT NULL,
	"companies_duplicated" integer DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"companies_processed" integer DEFAULT 0 NOT NULL,
	"agent_statuses" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"first_name" text,
	"last_name" text,
	"first_name_ar" text,
	"last_name_ar" text,
	"title" text,
	"title_ar" text,
	"email" text,
	"phone" text,
	"linkedin_url" text,
	"twitter_url" text,
	"department" text,
	"seniority" text,
	"notes" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrichment_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"subject_name" text NOT NULL,
	"subject_company" text,
	"confidence_score" text,
	"report_data" jsonb,
	"sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executives" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"company_name" text,
	"name" text,
	"name_ar" text,
	"position" text,
	"position_ar" text,
	"email" text,
	"phone" text,
	"linkedin" text,
	"linkedin_url" text,
	"location" text,
	"biography" text,
	"education" text,
	"salary" text,
	"seniority_level" text,
	"department" text,
	"apollo_id" text,
	"is_featured" boolean DEFAULT false,
	"enrichment_status" text DEFAULT 'pending',
	"data_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospecting_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0,
	"result_count" integer DEFAULT 0,
	"total_companies_found" integer DEFAULT 0,
	"total_enriched" integer DEFAULT 0,
	"error_message" text,
	"error" text,
	"scan_result" jsonb,
	"scan_summary" jsonb,
	"pages_scanned" integer DEFAULT 0,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prospecting_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"company_data" jsonb,
	"enrichment_status" text DEFAULT 'pending',
	"source_url" text,
	"enrichment_report_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0,
	"report" jsonb,
	"sources" jsonb,
	"findings" jsonb,
	"agent_results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"urls" jsonb,
	"knowledge_base" jsonb,
	"chat_history" jsonb,
	"summary" text,
	"progress" integer DEFAULT 0,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"config" jsonb,
	"is_builtin" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "executives" ADD CONSTRAINT "executives_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;