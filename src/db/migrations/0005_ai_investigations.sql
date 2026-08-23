-- AI failure investigations (Phase D/E).
-- One cached, structured investigation per unique evidence context.
-- input_hash is a SHA-256 over the deterministic evidence context (test identity,
-- failure sequence, signature fingerprints) — identical contexts are never
-- re-sent to the provider. Secrets are redacted before any provider call and
-- never stored here.

CREATE TABLE cicd_ai_investigations (
  id                   BIGSERIAL PRIMARY KEY,
  test_id              BIGINT NOT NULL REFERENCES tests(id),
  workflow_run_id      BIGINT REFERENCES workflow_runs(id),
  failure_signature_id BIGINT REFERENCES failure_signatures(id),
  provider             TEXT NOT NULL,
  model                TEXT NOT NULL,
  input_hash           TEXT NOT NULL UNIQUE,
  classification       TEXT,
  confidence           REAL,
  result               JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_inv_test_time ON cicd_ai_investigations(test_id, created_at DESC);

-- Leftover from the tenancy phase: per-installation key lookups filter on this.
CREATE INDEX idx_api_keys_installation ON api_keys(installation_id);
