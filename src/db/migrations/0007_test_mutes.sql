-- Mute / quarantine (Phase I).
-- Lets a developer acknowledge a known-flaky test without losing its history:
-- results keep flowing and scoring keeps running; only the Action Center
-- prominence changes. Multiple rows per test form the mute history; the active
-- mute is the latest row that has been neither lifted nor expired.

CREATE TYPE mute_kind AS ENUM ('muted', 'quarantined');

CREATE TABLE test_mutes (
  id          BIGSERIAL PRIMARY KEY,
  test_id     BIGINT NOT NULL REFERENCES tests(id),
  kind        mute_kind NOT NULL DEFAULT 'muted',
  reason      TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,   -- NULL = no expiry
  lifted_at   TIMESTAMPTZ    -- NULL = still in effect until expiry
);

CREATE INDEX idx_test_mutes_test ON test_mutes(test_id);
