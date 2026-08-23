-- Persistent activity feed. Derived feeds can't reliably capture one-shot
-- events like "test X became flaky" (the crossing is transient), so we record
-- the handful of events the dashboard surfaces as they happen. Idempotent via
-- the (kind, entity_key) unique key.

CREATE TABLE activity_events (
  id                    BIGSERIAL PRIMARY KEY,
  kind                  TEXT NOT NULL,
  entity_key            TEXT NOT NULL,
  repository_full_name  TEXT NOT NULL,
  message               TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, entity_key)
);

CREATE INDEX idx_activity_created ON activity_events(created_at DESC);
