import type { Pool } from "pg";
import { parseJunit } from "./junit.js";
import { computeIdentity } from "./identity.js";
import { computeFailureFingerprint } from "./fingerprint.js";
import {
  insertTestResult,
  upsertFailureSignature,
  upsertRepository,
  upsertTest,
  upsertWorkflowRun,
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
 * Parse a JUnit report and persist its tests/results in a single transaction.
 * Idempotent: re-ingesting the same payload produces no duplicate rows (all
 * writes are upserts / ON CONFLICT DO NOTHING).
 */
export async function processIngest(
  pool: Pool,
  input: IngestInput,
): Promise<IngestSummary> {
  const parsed = parseJunit(input.reportXml);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const repositoryId = await upsertRepository(client, {
      fullName: input.repositoryFullName,
      githubRepoId: input.githubRepoId ?? null,
    });

    const workflowRunId = await upsertWorkflowRun(client, {
      repositoryId,
      githubRunId: input.githubRunId,
      runAttempt: input.runAttempt,
      headSha: input.headSha,
      headBranch: input.headBranch ?? null,
    });

    const executedAt = input.executedAt ? new Date(input.executedAt) : new Date();
    const sourceJobName = input.jobName ?? "test";

    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const t of parsed) {
      const identity = computeIdentity({ filePath: t.filePath, name: t.name });

      const testId = await upsertTest(client, {
        repositoryId,
        identityHash: identity.identityHash,
        filePath: identity.filePath,
        suitePath: identity.suitePath,
        name: identity.name,
        parentHash: identity.parentHash,
      });

      let failureSignatureId: number | null = null;
      if (t.status === "failed") {
        const fp = computeFailureFingerprint({
          errorClass: t.errorClass,
          message: t.failureMessage,
        });
        failureSignatureId = await upsertFailureSignature(client, {
          repositoryId,
          fingerprint: fp.fingerprint,
          errorClass: fp.errorClass,
          sampleMessage: fp.sampleMessage,
        });
      }

      await insertTestResult(client, {
        testId,
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

    await client.query(
      `UPDATE workflow_runs SET results_state = 'received' WHERE id = $1`,
      [workflowRunId],
    );

    await client.query("COMMIT");
    return { testsReceived: parsed.length, passed, failed, skipped };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
