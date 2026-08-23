-- Dashboard surface: persist the human-readable workflow name from the
-- workflow_run webhook (workflow_run.name) so the dashboard can show which
-- workflow a run belongs to without joining back to the GitHub API.

ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS workflow_name TEXT;
