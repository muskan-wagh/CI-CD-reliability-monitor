-- PR correlation (Phase G).
-- Pull requests are resolved lazily from run head SHAs and cached here so the
-- investigation timeline can say "reliability degradation was first observed
-- after PR #N" without hitting the GitHub API on every request.
-- Correlation, never causation: nothing in this table implies a PR caused a
-- failure — only that timing aligns with recorded runs.

CREATE TABLE pull_requests (
  id             BIGSERIAL PRIMARY KEY,
  repository_id  BIGINT NOT NULL REFERENCES repositories(id),
  pr_number      INT NOT NULL,
  title          TEXT,
  author_login   TEXT,
  state          TEXT,
  -- The run/commit SHA this PR was resolved from (a PR may appear for several
  -- SHAs across force-pushes; each pairing is cached separately).
  head_sha       TEXT NOT NULL,
  changed_files  JSONB,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, pr_number, head_sha)
);

CREATE INDEX idx_pull_requests_sha ON pull_requests(repository_id, head_sha);
