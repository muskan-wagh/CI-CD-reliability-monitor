import type { Pool } from "pg";
import type { Queryable } from "./store.js";
import type { TestStatus } from "./junit.js";
import { WINDOW_SIZE, computeFlakeScore } from "./scoring.js";

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Load the last N ordered outcomes for a test (oldest -> newest), using the
 * `(test_id, executed_at DESC)` index.
 */
export async function loadOutcomes(
  db: Queryable,
  testId: number,
  limit: number = WINDOW_SIZE,
): Promise<TestStatus[]> {
  const result = await db.query<{ status: TestStatus }>(
    `SELECT status FROM test_results
     WHERE test_id = $1
     ORDER BY executed_at DESC, id DESC
     LIMIT $2`,
    [testId, limit],
  );
  return result.rows.map((r) => r.status).reverse();
}

/**
 * Recompute and upsert the flake score for a single test. The row is a
 * disposable cache of the math; it can always be rebuilt from test_results.
 */
export async function computeAndUpsertScore(
  db: Queryable,
  testId: number,
): Promise<void> {
  const outcomes = await loadOutcomes(db, testId);
  const s = computeFlakeScore(outcomes);

  await db.query(
    `INSERT INTO flake_scores
       (test_id, score, category, window_size, failure_count, failure_rate, transition_rate, wilson_lower, previous_score, computed_at)
     VALUES ($1, $2, $3::flake_category, $4, $5, $6, $7, $8, NULL, now())
     ON CONFLICT (test_id) DO UPDATE SET
       score           = EXCLUDED.score,
       category        = EXCLUDED.category,
       window_size     = EXCLUDED.window_size,
       failure_count   = EXCLUDED.failure_count,
       failure_rate    = EXCLUDED.failure_rate,
       transition_rate = EXCLUDED.transition_rate,
       wilson_lower    = EXCLUDED.wilson_lower,
       previous_score  = flake_scores.score,
       computed_at     = now()`,
    [
      testId,
      s.score,
      s.category,
      s.windowSize,
      s.failureCount,
      round4(s.failureRate),
      round4(s.transitionRate),
      s.wilsonLower === null ? null : round4(s.wilsonLower),
    ],
  );
}

/** Recompute scores for a set of affected tests (deduplicated). */
export async function recomputeScores(
  db: Queryable,
  testIds: number[],
): Promise<void> {
  const unique = [...new Set(testIds)];
  for (const testId of unique) {
    await computeAndUpsertScore(db, testId);
  }
}

/**
 * Recompute scores on a dedicated connection, used for the async (fire-and-
 * forget) scoring path after ingest commits.
 */
export async function scoreTests(
  pool: Pool,
  testIds: number[],
): Promise<void> {
  if (testIds.length === 0) return;
  const client = await pool.connect();
  try {
    await recomputeScores(client, testIds);
  } finally {
    client.release();
  }
}
