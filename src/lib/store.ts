import type { Pool, PoolClient } from "pg";

export type Queryable = Pool | PoolClient;

export interface RepoRef {
  githubRepoId?: number | null;
  fullName: string;
  installationId?: number | null;
}

/** Get-or-create a repository keyed by its globally unique full_name. */
export async function upsertRepository(
  db: Queryable,
  repo: RepoRef,
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO repositories (installation_id, github_repo_id, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (full_name) DO UPDATE SET
       github_repo_id = COALESCE(repositories.github_repo_id, EXCLUDED.github_repo_id),
       installation_id = COALESCE(repositories.installation_id, EXCLUDED.installation_id)
     RETURNING id`,
    [repo.installationId ?? null, repo.githubRepoId ?? null, repo.fullName],
  );
  const id = Number(result.rows[0]?.id);
  if (!Number.isInteger(id)) {
    throw new Error(`upsertRepository returned no id for ${repo.fullName}`);
  }
  return id;
}

export interface WorkflowRunInput {
  repositoryId: number;
  githubRunId: number;
  runAttempt: number;
  headSha: string;
  headBranch?: string | null;
  triggerEvent?: string | null;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

/** Idempotent workflow-run upsert; the (repo, run, attempt) unique key is the backbone. */
export async function upsertWorkflowRun(
  db: Queryable,
  input: WorkflowRunInput,
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO workflow_runs
       (repository_id, github_run_id, run_attempt, head_sha, head_branch, trigger_event, conclusion, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (repository_id, github_run_id, run_attempt) DO UPDATE SET
       head_sha      = EXCLUDED.head_sha,
       head_branch   = COALESCE(EXCLUDED.head_branch, workflow_runs.head_branch),
       trigger_event = COALESCE(EXCLUDED.trigger_event, workflow_runs.trigger_event),
       conclusion    = COALESCE(EXCLUDED.conclusion, workflow_runs.conclusion),
       started_at    = COALESCE(EXCLUDED.started_at, workflow_runs.started_at),
       completed_at  = COALESCE(EXCLUDED.completed_at, workflow_runs.completed_at)
     RETURNING id`,
    [
      input.repositoryId,
      input.githubRunId,
      input.runAttempt,
      input.headSha,
      input.headBranch ?? null,
      input.triggerEvent ?? null,
      input.conclusion ?? null,
      input.startedAt ?? null,
      input.completedAt ?? null,
    ],
  );
  const id = Number(result.rows[0]?.id);
  if (!Number.isInteger(id)) {
    throw new Error(`upsertWorkflowRun returned no id for run ${input.githubRunId}`);
  }
  return id;
}

export interface TestInput {
  repositoryId: number;
  identityHash: string;
  filePath: string;
  suitePath: string;
  name: string;
  parentHash?: string | null;
}

/** Get-or-create a test by (repository, identity_hash). */
export async function upsertTest(
  db: Queryable,
  input: TestInput,
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO tests (repository_id, identity_hash, file_path, suite_path, name, parent_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (repository_id, identity_hash) DO UPDATE SET
       file_path   = EXCLUDED.file_path,
       suite_path  = EXCLUDED.suite_path,
       name        = EXCLUDED.name,
       last_seen_at = now()
     RETURNING id`,
    [
      input.repositoryId,
      input.identityHash,
      input.filePath,
      input.suitePath,
      input.name,
      input.parentHash ?? null,
    ],
  );
  const id = Number(result.rows[0]?.id);
  if (!Number.isInteger(id)) {
    throw new Error(`upsertTest returned no id for ${input.identityHash}`);
  }
  return id;
}

export interface FailureSignatureInput {
  repositoryId: number;
  fingerprint: string;
  errorClass: string;
  sampleMessage: string;
}

/** Get-or-create a failure signature and bump its occurrence count. */
export async function upsertFailureSignature(
  db: Queryable,
  input: FailureSignatureInput,
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO failure_signatures (repository_id, fingerprint, error_class, sample_message)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (repository_id, fingerprint) DO UPDATE SET
       error_class      = EXCLUDED.error_class,
       sample_message   = EXCLUDED.sample_message,
       last_seen_at     = now(),
       occurrence_count = failure_signatures.occurrence_count + 1
     RETURNING id`,
    [input.repositoryId, input.fingerprint, input.errorClass, input.sampleMessage],
  );
  const id = Number(result.rows[0]?.id);
  if (!Number.isInteger(id)) {
    throw new Error(`upsertFailureSignature returned no id for ${input.fingerprint}`);
  }
  return id;
}

export interface TestResultInput {
  testId: number;
  workflowRunId: number;
  status: "passed" | "failed" | "skipped";
  durationMs?: number | null;
  failureSignatureId?: number | null;
  sourceJobName: string;
  executedAt: Date;
}

/** Insert a single result; the unique key makes reprocessing harmless. */
export async function insertTestResult(
  db: Queryable,
  input: TestResultInput,
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO test_results
       (test_id, workflow_run_id, status, duration_ms, failure_signature_id, source_job_name, executed_at)
     VALUES ($1, $2, $3::test_status, $4, $5, $6, $7)
     ON CONFLICT (test_id, workflow_run_id, source_job_name) DO NOTHING
     RETURNING id`,
    [
      input.testId,
      input.workflowRunId,
      input.status,
      input.durationMs ?? null,
      input.failureSignatureId ?? null,
      input.sourceJobName,
      input.executedAt,
    ],
  );
  return Number(result.rows[0]?.id ?? 0);
}
