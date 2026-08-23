import type { Pool } from "pg";
import type { Queryable } from "./store.js";
import { recordActivityEvent } from "./store.js";
import type { TestStatus } from "./junit.js";
import { WINDOW_SIZE, computeFlakeScore } from "./scoring.js";
import { investigateTest } from "./aiInvestigation.js";

/** Categories that count as "became unreliable" for activity + AI triggers. */
const PROBLEMATIC = new Set(["flaky", "critical", "broken"]);

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
): Promise<boolean> {
  const outcomes = await loadOutcomes(db, testId);
  const s = computeFlakeScore(outcomes);

  const previous = await db.query<{ category: string }>(
    `SELECT category::text AS category FROM flake_scores WHERE test_id = $1`,
    [testId],
  );
  const previousCategory = previous.rows[0]?.category ?? null;

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

  const meta = await db.query<{ name: string; full_name: string }>(
    `SELECT t.name, r.full_name FROM tests t JOIN repositories r ON r.id = t.repository_id WHERE t.id = $1`,
    [testId],
  );
  const name = meta.rows[0]?.name ?? `#${testId}`;
  console.log(`[SCORE] ${name} = ${s.score} ${s.category.toUpperCase()}`);

  // Record a one-shot "became flaky/critical/broken" activity event on the
  // crossing (previously non-problematic -> now problematic).
  const crossed =
    PROBLEMATIC.has(s.category) &&
    (!previousCategory || !PROBLEMATIC.has(previousCategory));
  if (crossed) {
    const verb =
      s.category === "critical"
        ? "became critical"
        : s.category === "broken"
          ? "became broken"
          : "became flaky";
    await recordActivityEvent(db, {
      kind: "flaky",
      entityKey: `test:${testId}`,
      repositoryFullName: meta.rows[0]?.full_name ?? "",
      message: `${name} ${verb} (score ${s.score})`,
    });
  }
  return crossed;
}

/** Recompute scores for a set of affected tests. Returns ids that crossed INTO flaky/critical/broken. */
export async function recomputeScores(
  db: Queryable,
  testIds: number[],
): Promise<number[]> {
  const unique = [...new Set(testIds)];
  const crossed: number[] = [];
  for (const testId of unique) {
    if (await computeAndUpsertScore(db, testId)) crossed.push(testId);
  }
  return crossed;
}

/**
 * Recompute scores on a dedicated connection, used for the async (fire-and-
 * forget) scoring path after ingest commits.
 *
 * Cost control (Phase E): when AI_AUTO_INVESTIGATE=true, tests that just
 * crossed into a problematic category get ONE cached AI investigation each —
 * identical contexts are served from cicd_ai_investigations, never re-billed.
 */
export async function scoreTests(
  pool: Pool,
  testIds: number[],
): Promise<void> {
  if (testIds.length === 0) return;
  let crossed: number[] = [];
  const client = await pool.connect();
  try {
    crossed = await recomputeScores(client, testIds);
  } finally {
    client.release();
  }

  if (process.env.AI_AUTO_INVESTIGATE !== "true" || crossed.length === 0) return;
  for (const testId of crossed) {
    void investigateTest(pool, testId)
      .then((r) =>
        console.log(
          `[AI] test ${testId} investigated (${r.provider}/${r.model}${r.cached ? ", cached" : ""}) → ${r.investigation.classification}`,
        ),
      )
      .catch((err) => console.error(`[AI] investigation failed for test ${testId}: ${(err as Error).message}`));
  }
}
