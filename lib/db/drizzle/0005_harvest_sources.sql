-- 0005 — unified harvest source registry (§11A)

CREATE TABLE IF NOT EXISTS harvest_sources (
  id serial PRIMARY KEY,
  label text NOT NULL,
  url text,
  type text NOT NULL DEFAULT 'web',
  category text NOT NULL DEFAULT 'custom',
  language text NOT NULL DEFAULT 'both',
  countries jsonb DEFAULT '[]'::jsonb,
  industries jsonb DEFAULT '[]'::jsonb,
  credibility text NOT NULL DEFAULT 'secondary',
  trust_weight integer NOT NULL DEFAULT 65,
  enabled boolean NOT NULL DEFAULT true,
  visibility text NOT NULL DEFAULT 'system',
  required_for_engines jsonb DEFAULT '[]'::jsonb,
  last_synced timestamptz,
  status text NOT NULL DEFAULT 'ok',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_enforcement (
  id serial PRIMARY KEY,
  engine_name text NOT NULL,
  required_ids jsonb DEFAULT '[]'::jsonb,
  excluded_ids jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_harvest_sources_category ON harvest_sources (category);
CREATE INDEX IF NOT EXISTS idx_harvest_sources_enabled ON harvest_sources (enabled);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_enforcement_engine ON source_enforcement (engine_name);

-- Copy any existing user-added sources into the registry (best-effort; the
-- source table may not exist on fresh installs, so guard with a DO block).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'composer_user_sources') THEN
    INSERT INTO harvest_sources (label, url, type, category, visibility, credibility)
      SELECT label, url, 'web', 'custom', 'user', 'secondary'
      FROM composer_user_sources;
  END IF;
END $$;
