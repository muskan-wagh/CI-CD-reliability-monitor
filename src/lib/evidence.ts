import type { Queryable } from "./store.js";

/**
 * Deterministic failure-evidence pipeline.
 *
 * Builds a bounded, structured evidence pack for one test from real rows:
 * outcomes, failure signatures, durations and score context. This is the single
 * source of "what do we actually know" — rendered on the investigation page and
 * consumed by the AI investigation layer (Phase D), which must never see more
 * than this.
 *
 * Pure helpers are exported separately so the math is unit-testable without a
 * database.
 */

export interface EvidenceOutcome {
  status: "passed" | "failed" | "skipped";
  durationMs: number | null;
  executedAt: string;
  /** Internal workflow_runs.id */
  workflowRunId: number;
  githubRunId: number;
  headBranch: string | null;
  headSha: string | null;
  errorClass: string | null;
}

export interface EvidenceSignature {
  id: number;
  fingerprint: string;
  errorClass: string;
  sampleMessage: string;
  occurrencesOnTest: number;
  /** Fraction of this test's signature-matched failures (0..1), or null. */
  shareOfFailures: number | null;
  firstSeenOnTest: string | null;
  lastSeenOnTest: string | null;
}

export interface FailureEvidence {
  test: {
    id: number;
    name: string;
    filePath: string;
    suitePath: string;
    repository: string;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
  score: {
    score: number;
    category: string;
    windowSize: number;
    failureCount: number;
    failureRate: number;
    transitionRate: number;
  } | null;
  /** Oldest -> newest, bounded to the most recent `outcomeLimit` runs. */
  outcomes: EvidenceOutcome[];
  signatures: EvidenceSignature[];
  stats: {
    avgFailedDurationMs: number | null;
    avgPassedDurationMs: number | null;
    trailingConsecutiveFailures: number;
    passToFailTransitions: number;
    dominantSignatureSummary: string | null;
  };
}

/** Largest signature vs total signature-matched failures. */
export function dominantSignatureShare(
  signatures: { occurrencesOnTest: number }[],
): { total: number; dominant: number; share: number | null } {
  const total = signatures.reduce((acc, s) => acc + s.occurrencesOnTest, 0);
  const dominant = signatures.reduce(
    (acc, s) => Math.max(acc, s.occurrencesOnTest),
    0,
  );
  const share = total > 0 ? dominant / total : null;
  return { total, dominant, share };
}

/** Human sentence for the dominant-signature fact, or null when no failures. */
export function summarizeDominantShare(
  dominant: number,
  total: number,
): string | null {
  if (total <= 0 || dominant <= 0) return null;
  return `${dominant} of ${total} recorded failures share the same failure signature.`;
}

/** Trailing consecutive failed outcomes, counting newest backwards. */
export function trailingConsecutiveFailures(
  outcomes: { status: string }[],
): number {
  let n = 0;
  for (let i = outcomes.length - 1; i >= 0; i--) {
    if (outcomes[i]!.status === "failed") n++;
    else break;
  }
  return n;
}

/** PASS->FAIL flips over the given (oldest -> newest) outcome list. */
export function passToFailTransitions(outcomes: { status: string }[]): number {
  let n = 0;
  for (let i = 1; i < outcomes.length; i++) {
    const prev = outcomes[i - 1]!.status;
    const curr = outcomes[i]!.status;
    if (prev !== "skipped" && curr !== "skipped" && prev !== curr && curr === "failed") {
      n++;
    }
  }
  return n;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Build the evidence pack for one test. Returns null when the test does not
 * exist. Tenancy authorization is the caller's responsibility.
 */
export async function buildFailureEvidence(
  db: Queryable,
  testId: number,
  outcomeLimit = 50,
): Promise<FailureEvidence | null> {
  const test = await db.query(
    `SELECT t.id, t.name, t.file_path, t.suite_path,
            t.first_seen_at, t.last_seen_at,
            r.full_name AS repository
     FROM tests t JOIN repositories r ON r.id = t.repository_id
     WHERE t.id = $1`,
    [testId],
  );
  const t = test.rows[0];
  if (!t) return null;

  const score = await db.query(
    `SELECT score, category::text AS category, window_size, failure_count,
            failure_rate::float8 AS failure_rate, transition_rate::float8 AS transition_rate
     FROM flake_scores WHERE test_id = $1`,
    [testId],
  );

  // Newest-first from SQL, reversed to oldest -> newest below.
  const outcomes = await db.query(
    `SELECT tr.status::text AS status,
            tr.duration_ms,
            tr.executed_at,
            w.id AS workflow_run_id,
            w.github_run_id,
            w.head_branch,
            w.head_sha,
            fs.error_class
     FROM test_results tr
     JOIN workflow_runs w ON w.id = tr.workflow_run_id
     LEFT JOIN failure_signatures fs ON fs.id = tr.failure_signature_id
     WHERE tr.test_id = $1
     ORDER BY tr.executed_at DESC, tr.id DESC
     LIMIT $2`,
    [testId, outcomeLimit],
  );

  const signatures = await db.query(
    `SELECT fs.id, fs.fingerprint, fs.error_class, fs.sample_message,
            COUNT(tr.id)::int AS occurrences_on_test,
            MIN(tr.executed_at) AS first_seen_on_test,
            MAX(tr.executed_at) AS last_seen_on_test
     FROM failure_signatures fs
     JOIN test_results tr ON tr.failure_signature_id = fs.id
     WHERE tr.test_id = $1
     GROUP BY fs.id
     ORDER BY occurrences_on_test DESC`,
    [testId],
  );

  const durations = await db.query(
    `SELECT (AVG(tr.duration_ms) FILTER (WHERE tr.status = 'failed'))::float8  AS avg_failed,
            (AVG(tr.duration_ms) FILTER (WHERE tr.status = 'passed'))::float8 AS avg_passed
     FROM test_results tr WHERE tr.test_id = $1`,
    [testId],
  );

  const orderedOutcomes: EvidenceOutcome[] = outcomes.rows
    .map((r) => ({
      status: r.status as EvidenceOutcome["status"],
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
      executedAt: new Date(r.executed_at).toISOString(),
      workflowRunId: Number(r.workflow_run_id),
      githubRunId: Number(r.github_run_id),
      headBranch: r.head_branch ?? null,
      headSha: r.head_sha ?? null,
      errorClass: r.error_class ?? null,
    }))
    .reverse();

  const sigRows = signatures.rows.map((s) => ({
    id: Number(s.id),
    fingerprint: String(s.fingerprint),
    errorClass: String(s.error_class),
    sampleMessage: String(s.sample_message),
    occurrencesOnTest: Number(s.occurrences_on_test),
    shareOfFailures: null as number | null,
    firstSeenOnTest: s.first_seen_on_test ? new Date(s.first_seen_on_test).toISOString() : null,
    lastSeenOnTest: s.last_seen_on_test ? new Date(s.last_seen_on_test).toISOString() : null,
  }));

  const { total, dominant, share } = dominantSignatureShare(sigRows);
  for (const s of sigRows) {
    s.shareOfFailures = total > 0 ? round1((s.occurrencesOnTest / total) * 100) / 100 : null;
  }

  const sc = score.rows[0];
  return {
    test: {
      id: Number(t.id),
      name: t.name,
      filePath: t.file_path,
      suitePath: t.suite_path,
      repository: t.repository,
      firstSeenAt: t.first_seen_at ? new Date(t.first_seen_at).toISOString() : null,
      lastSeenAt: t.last_seen_at ? new Date(t.last_seen_at).toISOString() : null,
    },
    score: sc
      ? {
          score: Number(sc.score),
          category: String(sc.category),
          windowSize: Number(sc.window_size),
          failureCount: Number(sc.failure_count),
          failureRate: Number(sc.failure_rate),
          transitionRate: Number(sc.transition_rate),
        }
      : null,
    outcomes: orderedOutcomes,
    signatures: sigRows,
    stats: {
      avgFailedDurationMs:
        durations.rows[0]?.avg_failed == null ? null : Math.round(Number(durations.rows[0].avg_failed)),
      avgPassedDurationMs:
        durations.rows[0]?.avg_passed == null ? null : Math.round(Number(durations.rows[0].avg_passed)),
      trailingConsecutiveFailures: trailingConsecutiveFailures(orderedOutcomes),
      passToFailTransitions: passToFailTransitions(orderedOutcomes),
      dominantSignatureSummary: summarizeDominantShare(dominant, total),
    },
  };
}
