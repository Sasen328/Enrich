-- 0002_missing_tables.sql
-- Adds tables defined in newer Drizzle schemas (lib/db/src/schema/*.ts) that
-- were never reflected in 0000/0001. All CREATEs use IF NOT EXISTS so this
-- file is safe to re-run.

CREATE TABLE IF NOT EXISTS "builder_custom_sources" (
  "id"                   serial PRIMARY KEY,
  "name"                 text NOT NULL,
  "name_ar"              text,
  "url"                  text NOT NULL,
  "category"             text NOT NULL DEFAULT 'other',
  "description"          text,
  "estimated_companies"  integer DEFAULT 0,
  "created_at"           timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_intel_research" (
  "id"                  serial PRIMARY KEY,
  "company_name"        text NOT NULL,
  "website"             text,
  "cr_number"           text,
  "city"                text,
  "seller_context"      text,
  "intelligence_goals"  text,
  "known_facts"         text,
  "report"              text,
  "tags"                text,
  "notes"               text,
  "created_at"          timestamp with time zone DEFAULT now(),
  "updated_at"          timestamp with time zone DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_signals" (
  "id"                     serial PRIMARY KEY,
  "company_id"             integer,
  "company_name"           text NOT NULL,
  "company_name_ar"        text,
  "domain"                 text,
  "category"               text NOT NULL,
  "event_types"            jsonb NOT NULL DEFAULT '[]',
  "primary_event_type"     text,
  "title"                  text NOT NULL,
  "summary"                text,
  "source_url"             text,
  "source_name"            text,
  "published_at"           timestamp with time zone,
  "llm_summary"            text,
  "buying_signal_score"    integer DEFAULT 0,
  "risk_score"             integer DEFAULT 0,
  "relevance_score"        integer DEFAULT 5,
  "recommended_action"     text,
  "is_sanctioned"          integer DEFAULT 0,
  "sanctions_hits"         jsonb,
  "raw_signals"            jsonb,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "conversations" (
  "id"          serial PRIMARY KEY,
  "title"       text NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "deleted_companies" (
  "id"          serial PRIMARY KEY,
  "name_en"     text,
  "name_ar"     text,
  "cr_number"   text,
  "website"     text,
  "module"      text NOT NULL,
  "deleted_at"  timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "lead_factory_jobs" (
  "id"                serial PRIMARY KEY,
  "status"            text NOT NULL DEFAULT 'pending',
  "input_mode"        text NOT NULL DEFAULT 'segment',
  "brief"             jsonb,
  "target_count"      integer NOT NULL DEFAULT 50,
  "agent_progress"    jsonb,
  "total_discovered"  integer NOT NULL DEFAULT 0,
  "total_enriched"    integer NOT NULL DEFAULT 0,
  "total_validated"   integer NOT NULL DEFAULT 0,
  "total_published"   integer NOT NULL DEFAULT 0,
  "total_rejected"    integer NOT NULL DEFAULT 0,
  "error_message"     text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at"      timestamp with time zone
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "lead_factory_results" (
  "id"                     serial PRIMARY KEY,
  "job_id"                 integer NOT NULL,
  "company_name"           text,
  "company_name_ar"        text,
  "domain"                 text,
  "phone"                  text,
  "email"                  text,
  "city"                   text,
  "region"                 text,
  "industry"               text,
  "sub_industry"           text,
  "employee_count"         text,
  "revenue"                text,
  "cr_number"              text,
  "entity_type"            text,
  "founding_year"          text,
  "owner_name"             text,
  "key_executives"         jsonb,
  "description"            text,
  "logo_url"               text,
  "linkedin_url"           text,
  "source_used"            text,
  "raw_data"               jsonb,
  "enriched_data"          jsonb,
  "signal_data"            jsonb,
  "icp_score"              integer,
  "priority_tier"          text,
  "buying_score"           integer,
  "risk_score"             integer,
  "quality_score"          real,
  "validation_status"      text NOT NULL DEFAULT 'pending',
  "validation_reasons"     jsonb,
  "is_duplicate"           boolean NOT NULL DEFAULT false,
  "duplicate_of"           text,
  "outreach_email"         text,
  "outreach_linkedin"      text,
  "outreach_whatsapp"      text,
  "opening_angle"          text,
  "cultural_note"          text,
  "conversation_hook"      text,
  "published_lead_id"      integer,
  "published_company_id"   integer,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "lead_fingerprints" (
  "id"                  serial PRIMARY KEY,
  "normalized_name"     text,
  "domain"              text,
  "phone_normalized"    text,
  "email_normalized"    text,
  "cr_number"           text,
  "source_table"        text,
  "source_id"           integer,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "relationship_intel_jobs" (
  "id"                       serial PRIMARY KEY,
  "target_company_name"      text NOT NULL,
  "target_company_name_ar"   text,
  "target_cr_number"         text,
  "target_website"           text,
  "status"                   text NOT NULL DEFAULT 'pending',
  "org_chart_data"           jsonb,
  "network_data"             jsonb,
  "outreach_plan"            jsonb,
  "total_contacts"           integer NOT NULL DEFAULT 0,
  "total_connections"        integer NOT NULL DEFAULT 0,
  "adjacent_companies"       integer NOT NULL DEFAULT 0,
  "error_message"            text,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at"             timestamp with time zone
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "lead_lists" (
  "id"                 serial PRIMARY KEY,
  "name"               text NOT NULL,
  "criteria"           text NOT NULL,
  "status"             text NOT NULL DEFAULT 'pending',
  "total_found"        integer DEFAULT 0,
  "sources_searched"   text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "lead_list_items" (
  "id"                serial PRIMARY KEY,
  "list_id"           integer NOT NULL,
  "person_name"       text,
  "person_name_ar"    text,
  "person_title"      text,
  "person_title_ar"   text,
  "person_type"       text,
  "seniority"         text,
  "department"        text,
  "nationality"       text,
  "linkedin"          text,
  "estimated_salary"  integer,
  "biography"         text,
  "company_name"      text,
  "company_name_ar"   text,
  "industry"          text,
  "city"              text,
  "company_revenue"   text,
  "company_employees" text,
  "cr_number"         text,
  "ownership_pct"     text,
  "phone"             text,
  "email"             text,
  "website"           text,
  "source"            text,
  "source_id"         text,
  "match_score"       integer DEFAULT 0,
  "ai_score"          integer,
  "ai_reasoning"      text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "masar_custom_sources" (
  "id"          serial PRIMARY KEY,
  "name"        text NOT NULL,
  "url"         text NOT NULL,
  "created_at"  timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "messages" (
  "id"               serial PRIMARY KEY,
  "conversation_id"  integer NOT NULL,
  "role"             text NOT NULL,
  "content"          text NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prosengine_research" (
  "id"                  serial PRIMARY KEY,
  "person_name"         text NOT NULL,
  "company"             text,
  "title"               text,
  "linkedin_url"        text,
  "seller_context"      text,
  "intelligence_goals"  text,
  "known_facts"         text,
  "report"              text,
  "tags"                text,
  "notes"               text,
  "created_at"          timestamp with time zone DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sa_market_shareholders" (
  "id"                    serial PRIMARY KEY,
  "stock_code"            text,
  "stock_index"           text,
  "company_name"          text,
  "company_name_ar"       text,
  "sector"                text,
  "city"                  text,
  "shareholder_name"      text,
  "shareholder_name_ar"   text,
  "shareholder_type"      text,
  "ownership_percent"     real,
  "ownership_display"     text,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sa_market_executives" (
  "id"                serial PRIMARY KEY,
  "stock_code"        text,
  "stock_index"       text,
  "company_name"      text,
  "company_name_ar"   text,
  "sector"            text,
  "city"              text,
  "executive_name"    text,
  "position"          text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sa_market_profiles" (
  "id"                            serial PRIMARY KEY,
  "person_name"                   text NOT NULL,
  "person_type"                   text NOT NULL,
  "company_name"                  text,
  "sector"                        text,
  "estimated_annual_income"       text,
  "estimated_wealth"              text,
  "investment_appetite"           text,
  "investment_focus"              text,
  "education_background"          text,
  "career_history"                text,
  "board_memberships"             text,
  "key_connections"               text,
  "best_time_to_contact"          text,
  "approach_strategy"             text,
  "risk_profile"                  text,
  "philanthropy_interests"        text,
  "geographic_presence"           text,
  "languages_spoken"              text,
  "public_profiles"               jsonb DEFAULT '[]',
  "raw_profile"                   text,
  "profile_score"                 integer,
  "generated_at"                  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                    timestamp with time zone NOT NULL DEFAULT now()
);
