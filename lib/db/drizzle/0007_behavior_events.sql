-- 0007 — Behavior Agent event log (§2A)
CREATE TABLE IF NOT EXISTS behavior_events (
  id serial PRIMARY KEY,
  session_id text NOT NULL,
  kind text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_behavior_events_session ON behavior_events (session_id);
