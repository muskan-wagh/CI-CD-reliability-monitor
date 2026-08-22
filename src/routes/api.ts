import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";

export interface ApiOptions {
  pool: Pool;
}

/**
 * Read-only REST API for the dashboard. Deliberately unauthenticated for the
 * local dev phase; GitHub OAuth session + tenancy middleware arrive with the
 * multi-user phase (blueprint Part 13).
 */
const apiPlugin: FastifyPluginAsync<ApiOptions> = async (app, options) => {
  const { pool } = options;

  app.get("/api/repos", async () => {
    const result = await pool.query(`
      SELECT r.id,
             r.full_name,
             COALESCE(stats.total_tests, 0)::int          AS total_tests,
             COALESCE(stats.critical_tests, 0)::int       AS critical_tests,
             COALESCE(stats.flaky_tests, 0)::int          AS flaky_tests,
             COALESCE(stats.watch_tests, 0)::int          AS watch_tests,
             COALESCE(stats.broken_tests, 0)::int         AS broken_tests,
             COALESCE(stats.insufficient_tests, 0)::int   AS insufficient_tests,
             runs.last_run_at
      FROM repositories r
      LEFT JOIN (
        SELECT t.repository_id,
               COUNT(*) FILTER (WHERE s.category IS NOT NULL OR true)              AS total_tests,
               COUNT(*) FILTER (WHERE s.category = 'critical')::int                AS critical_tests,
               COUNT(*) FILTER (WHERE s.category = 'flaky')::int                   AS flaky_tests,
               COUNT(*) FILTER (WHERE s.category = 'watch')::int                   AS watch_tests,
               COUNT(*) FILTER (WHERE s.category = 'broken')::int                  AS broken_tests,
               COUNT(*) FILTER (WHERE s.category = 'insufficient')::int            AS insufficient_tests
        FROM tests t
        LEFT JOIN flake_scores s ON s.test_id = t.id
        GROUP BY t.repository_id
      ) stats ON stats.repository_id = r.id
      LEFT JOIN (
        SELECT repository_id, MAX(completed_at) AS last_run_at
        FROM workflow_runs GROUP BY repository_id
      ) runs ON runs.repository_id = r.id
      ORDER BY r.full_name ASC
    `);
    return { data: result.rows };
  });

  app.get("/api/repos/:id/tests", async (request, reply) => {
    const params = request.params as { id: string };
    const repoId = Number(params.id);
    if (!Number.isInteger(repoId)) {
      return reply.code(400).send({ error: "invalid_repo_id" });
    }

    const repo = await pool.query(
      `SELECT id, full_name FROM repositories WHERE id = $1`,
      [repoId],
    );
    if (repo.rows.length === 0) {
      return reply.code(404).send({ error: "not_found" });
    }

    const tests = await pool.query(
      `
      SELECT t.id,
             t.file_path,
             t.suite_path,
             t.name,
             s.score,
             s.category::text                        AS category,
             s.previous_score,
             s.window_size,
             s.failure_count,
             s.failure_rate::float8                  AS failure_rate,
             s.transition_rate::float8               AS transition_rate,
             s.wilson_lower::float8                  AS wilson_lower,
             s.computed_at,
             hist.recent_outcomes,
             sig.top_error_class,
             sig.top_sample_message,
             lf.last_failed_at
      FROM tests t
      LEFT JOIN flake_scores s ON s.test_id = t.id
      LEFT JOIN LATERAL (
        SELECT array_agg(x.status::text ORDER BY x.executed_at DESC, x.id DESC) AS recent_outcomes
        FROM (
          SELECT status, executed_at, id
          FROM test_results WHERE test_id = t.id
          ORDER BY executed_at DESC, id DESC LIMIT 20
        ) x
      ) hist ON TRUE
      LEFT JOIN LATERAL (
        SELECT fs.error_class AS top_error_class, fs.sample_message AS top_sample_message
        FROM failure_signatures fs
        JOIN test_results tr ON tr.failure_signature_id = fs.id
        WHERE tr.test_id = t.id
        GROUP BY fs.id
        ORDER BY COUNT(*) DESC, MAX(tr.executed_at) DESC
        LIMIT 1
      ) sig ON TRUE
      LEFT JOIN LATERAL (
        SELECT MAX(executed_at) AS last_failed_at
        FROM test_results WHERE test_id = t.id AND status = 'failed'
      ) lf ON TRUE
      WHERE t.repository_id = $1
      ORDER BY COALESCE(s.score, -1) DESC, t.name ASC
      `,
      [repoId],
    );

    // recent_outcomes arrives newest-first; reverse to oldest->newest.
    const data = (tests.rows as Record<string, unknown>[]).map((row) => ({
      ...row,
      recent_outcomes: Array.isArray(row.recent_outcomes)
        ? [...(row.recent_outcomes as string[])].reverse()
        : [],
    }));

    return { repo: repo.rows[0], data };
  });

  app.get("/api/tests/:id/history", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { limit?: string };
    const testId = Number(params.id);
    if (!Number.isInteger(testId)) {
      return reply.code(400).send({ error: "invalid_test_id" });
    }
    const limitRaw = Number(query.limit ?? 100);
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? limitRaw : 100;

    const test = await pool.query(
      `SELECT t.id, t.name, t.file_path, t.suite_path,
              t.repository_id,
              r.full_name AS repository_full_name
       FROM tests t JOIN repositories r ON r.id = t.repository_id
       WHERE t.id = $1`,
      [testId],
    );
    if (test.rows.length === 0) {
      return reply.code(404).send({ error: "not_found" });
    }

    const score = await pool.query(
      `SELECT score, category::text AS category, window_size, failure_count,
              failure_rate::float8 AS failure_rate, transition_rate::float8 AS transition_rate,
              wilson_lower::float8 AS wilson_lower, previous_score, computed_at
       FROM flake_scores WHERE test_id = $1`,
      [testId],
    );

    const outcomes = await pool.query(
      `SELECT tr.status::text AS status,
              tr.duration_ms,
              tr.executed_at,
              tr.source_job_name,
              w.github_run_id,
              w.head_sha,
              w.head_branch,
              fs.error_class,
              fs.sample_message
       FROM test_results tr
       JOIN workflow_runs w ON w.id = tr.workflow_run_id
       LEFT JOIN failure_signatures fs ON fs.id = tr.failure_signature_id
       WHERE tr.test_id = $1
       ORDER BY tr.executed_at DESC, tr.id DESC
       LIMIT $2`,
      [testId, limit],
    );

    const signatures = await pool.query(
      `SELECT fs.id, fs.error_class, fs.sample_message,
              fs.occurrence_count,
              COUNT(tr.id)::int AS times_seen_on_test
       FROM failure_signatures fs
       JOIN test_results tr ON tr.failure_signature_id = fs.id
       WHERE tr.test_id = $1
       GROUP BY fs.id
       ORDER BY times_seen_on_test DESC`,
      [testId],
    );

    return {
      test: test.rows[0],
      score: score.rows[0] ?? null,
      outcomes: outcomes.rows,
      signatures: signatures.rows,
    };
  });
};

export default apiPlugin;
