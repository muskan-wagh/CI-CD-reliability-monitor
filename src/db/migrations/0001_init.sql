-- FlakyGuard baseline schema (matches the blueprint Part 11 design).
-- NOTE: the shared Supabase DB already has this applied as version 0001_init.sql;
-- this file exists so a fresh database can be bootstrapped identically.

CREATE TYPE test_status    AS ENUM ('passed','failed','skipped');
CREATE TYPE flake_category AS ENUM ('insufficient','stable','watch','flaky','critical','broken');

-- ── Tenancy ────────────────────────────────────────────────────────────
CREATE TABLE installations (
  id              BIGINT PRIMARY KEY,
  account_login   TEXT NOT NULL,
  account_type    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  installed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at      TIMESTAMPTZ
);

CREATE TABLE repositories (
  id              BIGSERIAL PRIMARY KEY,
  installation_id BIGINT NOT NULL REFERENCES installations(id),
  github_repo_id  BIGINT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_repos_installation ON repositories(installation_id);

CREATE TABLE api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id BIGINT NOT NULL REFERENCES installations(id),
  key_hash        TEXT NOT NULL UNIQUE,
  label           TEXT NOT NULL DEFAULT 'default',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ
);

-- ── Facts: runs & results ─────────────────────────────────────────────
CREATE TABLE workflow_runs (
  id              BIGSERIAL PRIMARY KEY,
  repository_id   BIGINT NOT NULL REFERENCES repositories(id),
  github_run_id   BIGINT NOT NULL,
  run_attempt     INT   NOT NULL DEFAULT 1,
  head_sha        TEXT NOT NULL,
  head_branch     TEXT,
  trigger_event   TEXT,
  conclusion      TEXT,
  results_state   TEXT NOT NULL DEFAULT 'pending',
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, github_run_id, run_attempt)
);

CREATE TABLE tests (
  id             BIGSERIAL PRIMARY KEY,
  repository_id  BIGINT NOT NULL REFERENCES repositories(id),
  identity_hash  TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  suite_path     TEXT NOT NULL DEFAULT '',
  name           TEXT NOT NULL,
  parent_hash    TEXT,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, identity_hash)
);

CREATE TABLE failure_signatures (
  id                BIGSERIAL PRIMARY KEY,
  repository_id     BIGINT NOT NULL REFERENCES repositories(id),
  fingerprint       TEXT NOT NULL,
  error_class       TEXT NOT NULL DEFAULT 'Unknown',
  sample_message    TEXT NOT NULL,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrence_count  INT NOT NULL DEFAULT 1,
  UNIQUE (repository_id, fingerprint)
);

CREATE TABLE test_results (
  id                   BIGSERIAL PRIMARY KEY,
  test_id              BIGINT NOT NULL REFERENCES tests(id),
  workflow_run_id      BIGINT NOT NULL REFERENCES workflow_runs(id),
  status               test_status NOT NULL,
  duration_ms          INT,
  failure_signature_id BIGINT REFERENCES failure_signatures(id),
  source_job_name      TEXT NOT NULL DEFAULT 'test',
  executed_at          TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (test_id, workflow_run_id, source_job_name)
);
CREATE INDEX idx_results_test_time ON test_results(test_id, executed_at DESC);
CREATE INDEX idx_results_run ON test_results(workflow_run_id);

-- ── Computed cache ────────────────────────────────────────────────────
CREATE TABLE flake_scores (
  test_id          BIGINT PRIMARY KEY REFERENCES tests(id),
  score            INT  NOT NULL,
  category         flake_category NOT NULL,
  window_size      INT  NOT NULL,
  failure_count    INT  NOT NULL,
  failure_rate     NUMERIC(5,4) NOT NULL,
  transition_rate  NUMERIC(5,4) NOT NULL,
  wilson_lower     NUMERIC(5,4),
  previous_score   INT,
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scores_category ON flake_scores(category)
  WHERE category IN ('flaky','critical');

-- ── Plumbing ──────────────────────────────────────────────────────────
CREATE TABLE webhook_deliveries (
  delivery_id  UUID PRIMARY KEY,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE pr_annotations (
  id             BIGSERIAL PRIMARY KEY,
  repository_id  BIGINT NOT NULL REFERENCES repositories(id),
  pr_number      INT NOT NULL,
  comment_id     BIGINT NOT NULL,
  body_snapshot  TEXT NOT NULL,
  posted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, pr_number)
);
