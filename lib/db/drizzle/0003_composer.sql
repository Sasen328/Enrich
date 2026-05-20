-- Composer tables — user-CRUD skills/templates/sources + per-run audit

CREATE TABLE IF NOT EXISTS "composer_skills" (
  "id" serial PRIMARY KEY,
  "builtin_id" text,
  "name" text NOT NULL,
  "description" text,
  "system_prompt" text NOT NULL,
  "tool_whitelist" text[] NOT NULL DEFAULT '{}',
  "report_schema" text NOT NULL DEFAULT 'Custom',
  "model_tier" text,
  "visibility" text NOT NULL DEFAULT 'private',
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "composer_templates" (
  "id" serial PRIMARY KEY,
  "builtin_id" text,
  "name" text NOT NULL,
  "description" text,
  "default_question" text NOT NULL,
  "default_modes" text[] NOT NULL DEFAULT '{}',
  "default_target" text NOT NULL DEFAULT 'both',
  "default_countries" text[] NOT NULL DEFAULT '{}',
  "default_industry" text,
  "default_sources" text[] NOT NULL DEFAULT '{}',
  "default_skills" text[] NOT NULL DEFAULT '{}',
  "required_schema" text NOT NULL DEFAULT 'LeadList',
  "visibility" text NOT NULL DEFAULT 'private',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "composer_user_sources" (
  "id" serial PRIMARY KEY,
  "label" text NOT NULL,
  "url" text NOT NULL,
  "category" text,
  "language" text DEFAULT 'both',
  "countries" text[],
  "industries" text[],
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "composer_runs" (
  "id" serial PRIMARY KEY,
  "state" jsonb NOT NULL,
  "enhanced_prompt" text NOT NULL,
  "report_shape" text NOT NULL DEFAULT 'detail',
  "blocks" jsonb,
  "raw_text" text,
  "status" text NOT NULL DEFAULT 'running',
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "composer_runs_status_idx" ON "composer_runs" ("status");
CREATE INDEX IF NOT EXISTS "composer_runs_created_idx" ON "composer_runs" ("created_at" DESC);
