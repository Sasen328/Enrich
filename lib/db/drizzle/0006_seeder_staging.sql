-- 0006 — Data Seeder staging (§4A)

CREATE TABLE IF NOT EXISTS seeder_plans (
  id serial PRIMARY KEY,
  root_url text NOT NULL,
  status text NOT NULL DEFAULT 'eval',
  entities jsonb DEFAULT '[]'::jsonb,
  fields jsonb DEFAULT '[]'::jsonb,
  approved_fields jsonb DEFAULT '[]'::jsonb,
  pages_scanned integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seeder_rows (
  id serial PRIMARY KEY,
  plan_id integer NOT NULL,
  entity_type text NOT NULL DEFAULT 'company',
  data jsonb DEFAULT '{}'::jsonb,
  source_url text,
  enrichment_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seeder_rows_plan ON seeder_rows (plan_id);
