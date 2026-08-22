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

/**
 * Get-or-create many tests in a single round trip. `inputs` MUST have unique
 * `identityHash` values (the caller dedupes) or Postgres rejects the batch
 * with "cannot affect row a second time".
 *
 * Returns test ids in the same order as `inputs`.
 */
export async function bulkUpsertTests(
  db: Queryable,
  inputs: TestInput[],
): Promise<number[]> {
  if (inputs.length === 0) return [];

  const values: string[] = [];
  const params: unknown[] = [];
  inputs.forEach((t, i) => {
    const b = i * 6;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
    params.push(
      t.repositoryId,
      t.identityHash,
      t.filePath,
      t.suitePath,
      t.name,
      t.parentHash ?? null,
    );
  });

  const result = await db.query<{ id: string }>(
    `INSERT INTO tests (repository_id, identity_hash, file_path, suite_path, name, parent_hash)
     VALUES ${values.join(", ")}
     ON CONFLICT (repository_id, identity_hash) DO UPDATE SET
       file_path    = EXCLUDED.file_path,
       suite_path   = EXCLUDED.suite_path,
       name         = EXCLUDED.name,
       last_seen_at = now()
     RETURNING id`,
    params,
  );

  return result.rows.map((r) => Number(r.id));
}

export interface FailureSignatureInput {
  repositoryId: number;
  fingerprint: string;
  errorClass: string;
  sampleMessage: string;
  /** How many failures in this batch share this signature (defaults to 1). */
  occurrenceCount?: number;
}

/**
 * Get-or-create failure signatures in one round trip, bumping occurrence
 * counts by each signature's count. `inputs` MUST have unique `fingerprint`
 * values (the caller aggregates duplicates before calling).
 *
 * Returns a map of fingerprint -> signature id.
 */
export async function bulkUpsertFailureSignatures(
  db: Queryable,
  inputs: FailureSignatureInput[],
): Promise<Map<string, number>> {
  const byFingerprint = new Map<string, number>();
  if (inputs.length === 0) return byFingerprint;

  const values: string[] = [];
  const params: unknown[] = [];
  inputs.forEach((s, i) => {
    const b = i * 5;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
    params.push(
      s.repositoryId,
      s.fingerprint,
      s.errorClass,
      s.sampleMessage,
      s.occurrenceCount ?? 1,
    );
  });

  const result = await db.query<{ id: string; fingerprint: string }>(
    `INSERT INTO failure_signatures (repository_id, fingerprint, error_class, sample_message, occurrence_count)
     VALUES ${values.join(", ")}
     ON CONFLICT (repository_id, fingerprint) DO UPDATE SET
       error_class      = EXCLUDED.error_class,
       sample_message   = EXCLUDED.sample_message,
       last_seen_at     = now(),
       occurrence_count = failure_signatures.occurrence_count + EXCLUDED.occurrence_count
     RETURNING fingerprint, id`,
    params,
  );

  for (const row of result.rows) {
    byFingerprint.set(row.fingerprint, Number(row.id));
  }
  return byFingerprint;
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

/** Insert many results in one round trip; the unique key makes reprocessing harmless. */
export async function bulkInsertTestResults(
  db: Queryable,
  inputs: TestResultInput[],
): Promise<void> {
  if (inputs.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [];
  inputs.forEach((r, i) => {
    const b = i * 7;
    values.push(
      `($${b + 1},$${b + 2},$${b + 3}::test_status,$${b + 4},$${b + 5},$${b + 6},$${b + 7})`,
    );
    params.push(
      r.testId,
      r.workflowRunId,
      r.status,
      r.durationMs ?? null,
      r.failureSignatureId ?? null,
      r.sourceJobName,
      r.executedAt,
    );
  });

  await db.query(
    `INSERT INTO test_results
       (test_id, workflow_run_id, status, duration_ms, failure_signature_id, source_job_name, executed_at)
     VALUES ${values.join(", ")}
     ON CONFLICT (test_id, workflow_run_id, source_job_name) DO NOTHING`,
    params,
  );
}

export interface PrAnnotationInput {
  repositoryId: number;
  prNumber: number;
  commentId: number;
  bodySnapshot: string;
}

/**
 * One living report comment per PR: the unique (repository, pr) key makes
 * re-annotation an UPDATE of our tracked comment id, never a duplicate post.
 */
export async function upsertPrAnnotation(
  db: Queryable,
  input: PrAnnotationInput,
): Promise<void> {
  await db.query(
    `INSERT INTO pr_annotations (repository_id, pr_number, comment_id, body_snapshot)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (repository_id, pr_number) DO UPDATE SET
       comment_id    = EXCLUDED.comment_id,
       body_snapshot = EXCLUDED.body_snapshot,
       posted_at     = now()`,
    [input.repositoryId, input.prNumber, input.commentId, input.bodySnapshot],
  );
}
