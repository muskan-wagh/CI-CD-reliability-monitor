-- Phase 2 adjustments. The baseline schema requires every repository to be
-- linked to an installation and keyed by github_repo_id. Ingestion can arrive
-- before we know either, so relax those constraints and key on full_name.

ALTER TABLE repositories ALTER COLUMN installation_id DROP NOT NULL;
ALTER TABLE repositories ALTER COLUMN github_repo_id DROP NOT NULL;
ALTER TABLE repositories ADD CONSTRAINT repositories_full_name_key UNIQUE (full_name);
