import type { Pool } from "pg";
import { parseJunit } from "./junit.js";
import { computeIdentity } from "./identity.js";
import { computeFailureFingerprint } from "./fingerprint.js";
import { scoreTests } from "./score.js";
import { annotateRun } from "./prAnnotation.js";
import {
  bulkInsertTestResults,
  bulkUpsertFailureSignatures,
  bulkUpsertTests,
  upsertRepository,
  upsertWorkflowRun,
  type TestInput,
  type TestResultInput,
} from "./store.js";

export interface IngestInput {
  repositoryFullName: string;
  githubRepoId?: number | null;
  githubRunId: number;
  runAttempt: number;
  headSha: string;
  headBranch?: string | null;
  jobName?: string;
  executedAt?: string;
  reportXml: string;
}

export interface IngestSummary {
  testsReceived: number;
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * Parse a JUnit report and persist its tests/results in a single transaction,
 * using bulk inserts (one round trip per table, not per row).
 *
 * Idempotent: re-ingesting the same payload produces no duplicate rows (all
 * writes are upserts / ON CONFLICT DO NOTHING).
 *
 * Scoring is intentionally NOT awaited — it is scheduled asynchronously via
 * `scoreTests` so this request returns fast. Scores are a disposable cache
 * that can always be rebuilt from `test_results`.
 */
export async function processIngest(
  pool: Pool,
  input: IngestInput,
): Promise<IngestSummary> {
  const parsed = parseJunit(input.reportXml);

  const client = await pool.connect();
  let testIds: number[] = [];
  let workflowRunId: number | undefined;
  let summary: IngestSummary;

  try {
    await client.query("BEGIN");

    const repositoryId = await upsertRepository(client, {
      fullName: input.repositoryFullName,
      githubRepoId: input.githubRepoId ?? null,
    });

    workflowRunId = await upsertWorkflowRun(client, {
      repositoryId,
      githubRunId: input.githubRunId,
      runAttempt: input.runAttempt,
      headSha: input.headSha,
      headBranch: input.headBranch ?? null,
    });

    const executedAt = input.executedAt ? new Date(input.executedAt) : new Date();
    const sourceJobName = input.jobName ?? "test";

    // Normalize identities and dedupe within the batch (same test twice in a
    // report is a reporter bug; keep the first and skip the rest).
    const seen = new Set<string>();
    const testInputs: TestInput[] = [];
    const resultRows: { testIdx: number; t: (typeof parsed)[number] }[] = [];

    for (const t of parsed) {
      const identity = computeIdentity({ filePath: t.filePath, name: t.name });
      if (seen.has(identity.identityHash)) continue;
      seen.add(identity.identityHash);

      testInputs.push({
        repositoryId,
        identityHash: identity.identityHash,
        filePath: identity.filePath,
        suitePath: identity.suitePath,
        name: identity.name,
        parentHash: identity.parentHash,
      });
      resultRows.push({ testIdx: testInputs.length - 1, t });
    }

    testIds = await bulkUpsertTests(client, testInputs);

    // Aggregate failure fingerprints (dedupe by fingerprint, count occurrences).
    const signatureCounts = new Map<
      string,
      { errorClass: string; sampleMessage: string; count: number }
    >();
    for (const { t } of resultRows) {
      if (t.status !== "failed") continue;
      const fp = computeFailureFingerprint({
        errorClass: t.errorClass,
        message: t.failureMessage,
      });
      const existing = signatureCounts.get(fp.fingerprint);
      if (existing) {
        existing.count++;
      } else {
        signatureCounts.set(fp.fingerprint, {
          errorClass: fp.errorClass,
          sampleMessage: fp.sampleMessage,
          count: 1,
        });
      }
    }

    const signatureIdByFingerprint = await bulkUpsertFailureSignatures(
      client,
      [...signatureCounts.entries()].map(([fingerprint, s]) => ({
        repositoryId,
        fingerprint,
        errorClass: s.errorClass,
        sampleMessage: s.sampleMessage,
        occurrenceCount: s.count,
      })),
    );

    // Build result rows.
    const results: TestResultInput[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const { testIdx, t } of resultRows) {
      let failureSignatureId: number | null = null;
      if (t.status === "failed") {
        const fp = computeFailureFingerprint({
          errorClass: t.errorClass,
          message: t.failureMessage,
        });
        failureSignatureId = signatureIdByFingerprint.get(fp.fingerprint) ?? null;
      }

      results.push({
        testId: testIds[testIdx] as number,
        workflowRunId,
        status: t.status,
        durationMs: t.durationMs,
        failureSignatureId,
        sourceJobName,
        executedAt,
      });

      if (t.status === "passed") passed++;
      else if (t.status === "failed") failed++;
      else skipped++;
    }

    await bulkInsertTestResults(client, results);

    await client.query(
      `UPDATE workflow_runs SET results_state = 'received' WHERE id = $1`,
      [workflowRunId],
    );

    await client.query("COMMIT");
    summary = { testsReceived: parsed.length, passed, failed, skipped };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Fire-and-forget scoring + PR annotation: keep the ingest response fast.
  // Scoring first; annotation only sees fresh scores and runs off-path.
  void scoreTests(pool, testIds)
    .then(() => {
      if (workflowRunId !== undefined) return annotateRun(pool, workflowRunId);
    })
    .catch((err) => {
      console.error("async scoring/annotation failed", err);
    });

  return summary;
}
