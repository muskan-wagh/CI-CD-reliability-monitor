-- Ownership (Phase J): a cached copy of the repository's CODEOWNERS content.
-- Ownership is DERIVED from this content at read time by the pure matcher in
-- src/lib/codeowners.ts — never invented, never hand-entered.

CREATE TABLE codeowners_cache (
  repository_id BIGINT PRIMARY KEY REFERENCES repositories(id),
  content       TEXT NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
