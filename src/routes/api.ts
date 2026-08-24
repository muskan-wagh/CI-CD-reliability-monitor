import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";
import { issueApiKey } from "../lib/apiKeys.js";
import { verifySessionToken } from "../lib/session.js";
import { buildFailureEvidence } from "../lib/evidence.js";
import { investigateTest } from "../lib/aiInvestigation.js";
import { AiNotConfiguredError } from "../lib/ai/index.js";
import { getPrsByShas } from "../lib/prCorrelation.js";
import { loadGithubAppCredentials, createInstallationClient } from "../lib/githubApp.js";
import { issueTitle, renderIssueBody } from "../lib/issueTemplate.js";
import type { AiInvestigation } from "../lib/ai/types.js";
import type { CorrelatedPr } from "../lib/prCorrelation.js";

export interface ApiOptions {
  pool: Pool;
  /**
   * Shared HMAC secret for dashboard session tokens. When unset, the API runs
   * in an unauthenticated "dev" mode (all data visible) so local dev + the
   * demo keep working without OAuth. In production this MUST be set.
   */
  sessionSecret?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Caller's installation ids, or null in dev mode (access to everything). */
    installations: number[] | null;
  }
}

function bearerToken(auth: string | undefined): string {
  if (!auth) return "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m?.[1] ?? "";
}

/**
 * Read-only REST API for the dashboard. Every data route is scoped to the
 * caller's installations (derived server-side from the signed session token);
 * the frontend never supplies installation/repository ids to authorize itself.
 */
const apiPlugin: FastifyPluginAsync<ApiOptions> = async (app, options) => {
  const { pool, sessionSecret } = options;

  const authPreHandler = async (
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ): Promise<void> => {
    if (!sessionSecret) {
      request.installations = null;
      return;
    }
    const session = verifySessionToken(bearerToken(request.headers.authorization), sessionSecret);
    if (!session) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    request.installations = session.installations;
  };

  // Shared ownership guard for single-resource routes: 404 when the resource's
  // installation is not in the caller's scope (don't leak existence).
  const assertInstallationAccess = (
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
    installationId: number | null,
  ): boolean => {
    if (request.installations === null) return true;
    if (installationId === null || !request.installations.includes(installationId)) {
      reply.code(404).send({ error: "not_found" });
      return false;
    }
    return true;
  };

  app.get("/api/me", { preHandler: authPreHandler }, async (request) => ({
    installations: request.installations ?? [],
  }));

  app.get("/api/repos", { preHandler: authPreHandler }, async (request) => {
    const result = await pool.query(
      `
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
               COUNT(*) FILTER (WHERE s.category IS NOT NULL OR true)   AS total_tests,
               COUNT(*) FILTER (WHERE s.category = 'critical')::int     AS critical_tests,
               COUNT(*) FILTER (WHERE s.category = 'flaky')::int        AS flaky_tests,
               COUNT(*) FILTER (WHERE s.category = 'watch')::int        AS watch_tests,
               COUNT(*) FILTER (WHERE s.category = 'broken')::int       AS broken_tests,
               COUNT(*) FILTER (WHERE s.category = 'insufficient')::int AS insufficient_tests
        FROM tests t
        LEFT JOIN flake_scores s ON s.test_id = t.id
        GROUP BY t.repository_id
      ) stats ON stats.repository_id = r.id
      LEFT JOIN (
        SELECT repository_id, MAX(completed_at) AS last_run_at
        FROM workflow_runs GROUP BY repository_id
      ) runs ON runs.repository_id = r.id
      WHERE ($1::bigint[] IS NULL OR r.installation_id = ANY($1))
      ORDER BY r.full_name ASC
      `,
      [request.installations],
    );
    return { data: result.rows };
  });

  app.get("/api/repos/:id/tests", { preHandler: authPreHandler }, async (request, reply) => {
    const params = request.params as { id: string };
    const repoId = Number(params.id);
    if (!Number.isInteger(repoId)) {
      return reply.code(400).send({ error: "invalid_repo_id" });
    }

    const repo = await pool.query(
      `SELECT id, full_name, installation_id FROM repositories WHERE id = $1`,
      [repoId],
    );
    if (repo.rows.length === 0) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (
      !assertInstallationAccess(
        request,
        reply,
        repo.rows[0].installation_id === null
          ? null
          : Number(repo.rows[0].installation_id),
      )
    ) {
      return;
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

    return { repo: { id: repo.rows[0].id, full_name: repo.rows[0].full_name }, data };
  });

  app.get("/api/tests/:id/history", { preHandler: authPreHandler }, async (request, reply) => {
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
              t.first_seen_at, t.last_seen_at,
              r.full_name AS repository_full_name,
              r.installation_id
       FROM tests t JOIN repositories r ON r.id = t.repository_id
       WHERE t.id = $1`,
      [testId],
    );
    if (test.rows.length === 0) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (
      !assertInstallationAccess(
        request,
        reply,
        test.rows[0].installation_id === null ? null : Number(test.rows[0].installation_id),
      )
    ) {
      return;
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
              COUNT(tr.id)::int AS times_seen_on_test,
              MIN(tr.executed_at) AS first_seen_on_test
       FROM failure_signatures fs
       JOIN test_results tr ON tr.failure_signature_id = fs.id
       WHERE tr.test_id = $1
       GROUP BY fs.id
       ORDER BY times_seen_on_test DESC`,
      [testId],
    );

    const firstFailure = await pool.query(
      `SELECT tr.executed_at, w.head_sha
       FROM test_results tr
       JOIN workflow_runs w ON w.id = tr.workflow_run_id
       WHERE tr.test_id = $1 AND tr.status = 'failed'
       ORDER BY tr.executed_at ASC, tr.id ASC
       LIMIT 1`,
      [testId],
    );

    const flakyEvents = await pool.query(
      `SELECT message, created_at FROM activity_events
       WHERE kind = 'flaky' AND entity_key = $1
       ORDER BY created_at ASC`,
      [`test:${testId}`],
    );

    // Explainability: count PASS->FAIL / FAIL->PASS flips over the scoring window
    // (oldest -> newest), matching what the score was computed over.
    const windowSize = score.rows[0]?.window_size ?? outcomes.rows.length;
    const ordered = [...outcomes.rows]
      .map((r) => (r.status === "failed" ? "failed" : r.status === "skipped" ? "skipped" : "passed"))
      .reverse()
      .slice(-windowSize);
    let passToFail = 0;
    let failToPass = 0;
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const curr = ordered[i];
      if (prev !== curr && prev !== "skipped" && curr !== "skipped") {
        if (curr === "failed") passToFail++;
        else if (prev === "failed") failToPass++;
      }
    }

    // Reliability timeline: the key moments in this test's life, oldest first.
    // Everything here is a recorded fact (first seen, first failure, crossing
    // events, signature appearances) — never an attribution of cause.
    const events: {
      type: string;
      at: string;
      message: string;
      pr?: { number: number; title: string | null } | null;
    }[] = [];
    if (test.rows[0].first_seen_at) {
      events.push({
        type: "first_seen",
        at: test.rows[0].first_seen_at,
        message: "Test first recorded",
        pr: null,
      });
    }

    // Phase G: correlate recorded SHAs with cached pull requests (pure DB read
    // — resolution happens at webhook time; nothing here calls GitHub).
    const shas = [
      ...new Set(outcomes.rows.map((r) => r.head_sha).filter((s): s is string => Boolean(s))),
    ];
    const prsBySha = await getPrsByShas(
      pool,
      Number(test.rows[0].repository_id),
      shas,
    );

    if (firstFailure.rows[0]?.executed_at) {
      const sha = firstFailure.rows[0].head_sha
        ? String(firstFailure.rows[0].head_sha)
        : null;
      const pr = sha ? prsBySha[sha] ?? null : null;
      events.push({
        type: "first_failure",
        at: firstFailure.rows[0].executed_at,
        message: `First failure${sha ? ` (commit ${sha.slice(0, 7)})` : ""}`,
        pr: pr ? { number: pr.prNumber, title: pr.title } : null,
      });
    }
    for (const e of flakyEvents.rows) {
      events.push({ type: "became_flaky", at: e.created_at, message: e.message });
    }
    for (const s of signatures.rows) {
      if (s.first_seen_on_test) {
        events.push({
          type: "signature",
          at: s.first_seen_on_test,
          message: `New failure signature: ${s.error_class}`,
          pr: null,
        });
      }
    }
    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    return {
      test: {
        id: test.rows[0].id,
        name: test.rows[0].name,
        file_path: test.rows[0].file_path,
        suite_path: test.rows[0].suite_path,
        repository_id: test.rows[0].repository_id,
        repository_full_name: test.rows[0].repository_full_name,
        first_seen_at: test.rows[0].first_seen_at ?? null,
        last_seen_at: test.rows[0].last_seen_at ?? null,
      },
      score: score.rows[0] ?? null,
      transitions: { passToFail, failToPass },
      timeline: events,
      prsBySha,
      outcomes: outcomes.rows,
      signatures: signatures.rows,
    };
  });

  // ── Failure-evidence pack: the bounded, deterministic facts about one test.
  //    Rendered for humans, and the ONLY input the AI layer receives (Phase D).
  app.get("/api/tests/:id/evidence", { preHandler: authPreHandler }, async (request, reply) => {
    const params = request.params as { id: string };
    const testId = Number(params.id);
    if (!Number.isInteger(testId)) {
      return reply.code(400).send({ error: "invalid_test_id" });
    }
    const own = await pool.query(
      `SELECT r.installation_id
       FROM tests t JOIN repositories r ON r.id = t.repository_id
       WHERE t.id = $1`,
      [testId],
    );
    if (own.rows.length === 0) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (
      !assertInstallationAccess(
        request,
        reply,
        own.rows[0].installation_id === null ? null : Number(own.rows[0].installation_id),
      )
    ) {
      return;
    }
    const evidence = await buildFailureEvidence(pool, testId);
    return { evidence };
  });

  // ── AI failure investigation (Phase D). Tenancy-scoped; the AI provider
  //    receives only the redacted evidence pack, never repo contents. ─────
  app.post("/api/tests/:id/investigate", { preHandler: authPreHandler }, async (request, reply) => {
    const params = request.params as { id: string };
    const testId = Number(params.id);
    if (!Number.isInteger(testId)) {
      return reply.code(400).send({ error: "invalid_test_id" });
    }
    const own = await pool.query(
      `SELECT r.installation_id
       FROM tests t JOIN repositories r ON r.id = t.repository_id
       WHERE t.id = $1`,
      [testId],
    );
    if (own.rows.length === 0) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (
      !assertInstallationAccess(
        request,
        reply,
        own.rows[0].installation_id === null ? null : Number(own.rows[0].installation_id),
      )
    ) {
      return;
    }

    try {
      const out = await investigateTest(pool, testId);
      return {
        cached: out.cached,
        provider: out.provider,
        model: out.model,
        investigation: out.investigation,
      };
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        return reply.code(503).send({
          error: "ai_not_configured",
          detail: "Set AI_PROVIDER / AI_MODEL / AI_API_KEY to enable investigations.",
        });
      }
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) {
        return reply.code(404).send({ error: "not_found" });
      }
      request.log.error({ err }, "AI investigation failed");
      return reply.code(502).send({
        error: "ai_provider_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── Create a GitHub issue for a flaky test (Phase H). Uses the App's
  //    installation token server-side; the issue body is rendered from
  //    recorded evidence and redacted — no secrets, no causal claims. ─────
  app.post("/api/tests/:id/issue", { preHandler: authPreHandler }, async (request, reply) => {
    const params = request.params as { id: string };
    const testId = Number(params.id);
    if (!Number.isInteger(testId)) {
      return reply.code(400).send({ error: "invalid_test_id" });
    }

    const meta = await pool.query(
      `SELECT t.repository_id, r.installation_id, r.full_name
       FROM tests t JOIN repositories r ON r.id = t.repository_id
       WHERE t.id = $1`,
      [testId],
    );
    if (meta.rows.length === 0) {
      return reply.code(404).send({ error: "not_found" });
    }
    const row = meta.rows[0];
    const installationId =
      row.installation_id === null ? null : Number(row.installation_id);
    if (
      !assertInstallationAccess(request, reply, installationId)
    ) {
      return;
    }

    let credentials;
    try {
      credentials = loadGithubAppCredentials();
    } catch (err) {
      return reply.code(503).send({
        error: "github_app_not_configured",
        detail:
          err instanceof Error
            ? err.message
            : "GitHub App credentials are invalid or unreadable.",
      });
    }
    if (!credentials || installationId === null) {
      return reply.code(503).send({
        error: "github_app_not_configured",
        detail:
          "Set GITHUB_APP_ID and GITHUB_PRIVATE_KEY(_PATH) to create issues via the GitHub App.",
      });
    }

    try {
      const evidence = await buildFailureEvidence(pool, testId);
      if (!evidence) {
        return reply.code(404).send({ error: "not_found" });
      }

      // Latest cached AI investigation, if any.
      const aiRows = await pool.query(
        `SELECT result FROM cicd_ai_investigations WHERE test_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [testId],
      );
      const ai =
        aiRows.rows[0]
          ? ((typeof aiRows.rows[0].result === "string"
              ? JSON.parse(aiRows.rows[0].result)
              : aiRows.rows[0].result) as AiInvestigation | null)
          : null;

      // Correlated PR for the first failing commit.
      const firstFailed = [...evidence.outcomes].find((o) => o.status === "failed");
      let pr: CorrelatedPr | null = null;
      if (firstFailed?.headSha) {
        const bySha = await getPrsByShas(pool, Number(row.repository_id), [
          firstFailed.headSha,
        ]);
        pr = bySha[firstFailed.headSha] ?? null;
      }

      const input = {
        evidence,
        ai: ai && ai.classification !== "UNKNOWN" ? ai : null,
        pr,
        testUrl: process.env.DASHBOARD_URL
          ? `${process.env.DASHBOARD_URL.replace(/\/+$/, "")}/tests/${testId}`
          : null,
      };

      const client = await createInstallationClient(credentials, installationId);
      const created = await client.post<{ number: number; html_url?: string }>(
        `/repos/${row.full_name}/issues`,
        {
          title: issueTitle(input),
          body: renderIssueBody(input),
          labels: ["flakyguard"],
        },
      );

      return {
        number: created.number,
        url: created.html_url ?? null,
      };
    } catch (err) {
      request.log.error({ err }, "issue creation failed");
      return reply.code(502).send({
        error: "issue_creation_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Latest cached investigation for this test (fuel for the AI UI panel).
  app.get("/api/tests/:id/investigation", { preHandler: authPreHandler }, async (request, reply) => {
    const params = request.params as { id: string };
    const testId = Number(params.id);
    if (!Number.isInteger(testId)) {
      return reply.code(400).send({ error: "invalid_test_id" });
    }
    const own = await pool.query(
      `SELECT r.installation_id
       FROM tests t JOIN repositories r ON r.id = t.repository_id
       WHERE t.id = $1`,
      [testId],
    );
    if (own.rows.length === 0) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (
      !assertInstallationAccess(
        request,
        reply,
        own.rows[0].installation_id === null ? null : Number(own.rows[0].installation_id),
      )
    ) {
      return;
    }

    const rows = await pool.query(
      `SELECT provider, model, classification, confidence, result, created_at
       FROM cicd_ai_investigations WHERE test_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [testId],
    );
    if (rows.rows.length === 0) {
      return { investigation: null };
    }
    const row = rows.rows[0];
    return {
      investigation: {
        provider: row.provider,
        model: row.model,
        classification: row.classification,
        confidence: row.confidence,
        ...(typeof row.result === "string"
          ? { result: JSON.parse(row.result) }
          : { result: row.result }),
        created_at: row.created_at,
      },
    };
  });

  // ── Root-cause clustering for a repository: failures grouped by error class.
  app.get("/api/repos/:id/clusters", { preHandler: authPreHandler }, async (request, reply) => {
    const params = request.params as { id: string };
    const repoId = Number(params.id);
    if (!Number.isInteger(repoId)) {
      return reply.code(400).send({ error: "invalid_repo_id" });
    }
    const repo = await pool.query(
      `SELECT installation_id FROM repositories WHERE id = $1`,
      [repoId],
    );
    if (repo.rows.length === 0) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (
      !assertInstallationAccess(
        request,
        reply,
        repo.rows[0].installation_id === null ? null : Number(repo.rows[0].installation_id),
      )
    ) {
      return;
    }

    const clusters = await pool.query(
      `
      SELECT fs.error_class,
             COUNT(*)::int AS failures,
             ROUND((COUNT(*) * 100.0) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1)::float8 AS share_pct
      FROM test_results tr
      JOIN workflow_runs w ON w.id = tr.workflow_run_id
      JOIN failure_signatures fs ON fs.id = tr.failure_signature_id
      WHERE w.repository_id = $1 AND tr.status = 'failed'
      GROUP BY fs.error_class
      ORDER BY failures DESC
      LIMIT 10
      `,
      [repoId],
    );

    const totalFailures = clusters.rows.reduce((a, c) => a + Number(c.failures), 0);
    return { clusters: clusters.rows, totalFailures };
  });

  // ── Dashboard aggregate: the one screen that answers "which tests are the
  //    problem?" Everything is derived from real rows — no mock data. ──────
  app.get("/api/dashboard", { preHandler: authPreHandler }, async (request) => {
    const installations = request.installations;

    const stats = await pool.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM tests t JOIN repositories r ON r.id = t.repository_id
          WHERE ($1::bigint[] IS NULL OR r.installation_id = ANY($1)))                AS total_tests,
        (SELECT COUNT(*)::int FROM flake_scores s JOIN tests t ON t.id = s.test_id
          JOIN repositories r ON r.id = t.repository_id
          WHERE s.category = 'flaky' AND ($1::bigint[] IS NULL OR r.installation_id = ANY($1))) AS flaky_tests,
        (SELECT COUNT(*)::int FROM flake_scores s JOIN tests t ON t.id = s.test_id
          JOIN repositories r ON r.id = t.repository_id
          WHERE s.category = 'critical' AND ($1::bigint[] IS NULL OR r.installation_id = ANY($1))) AS critical_tests,
        (SELECT COUNT(*)::int FROM flake_scores s JOIN tests t ON t.id = s.test_id
          JOIN repositories r ON r.id = t.repository_id
          WHERE s.category = 'broken' AND ($1::bigint[] IS NULL OR r.installation_id = ANY($1))) AS broken_tests,
        (SELECT COUNT(*)::int FROM flake_scores s JOIN tests t ON t.id = s.test_id
          JOIN repositories r ON r.id = t.repository_id
          WHERE s.window_size >= 8 AND ($1::bigint[] IS NULL OR r.installation_id = ANY($1))) AS tests_analyzed
      `,
      [installations],
    );

    const mostFlaky = await pool.query(
      `
      SELECT t.id,
             t.name,
             t.file_path,
             r.id   AS repository_id,
             r.full_name AS repository,
             s.score,
             s.category::text AS category,
             s.failure_rate::float8 AS failure_rate,
             s.transition_rate::float8 AS transition_rate,
             s.failure_count,
             s.window_size,
             s.computed_at AS last_seen,
             hist.recent_status,
             sig.top_error_class,
             sig.top_sample_message,
             sigcount.signature_count
      FROM flake_scores s
      JOIN tests t ON t.id = s.test_id
      JOIN repositories r ON r.id = t.repository_id
      LEFT JOIN LATERAL (
        SELECT array_agg(x.status::text ORDER BY x.executed_at DESC, x.id DESC) AS recent_status
        FROM (
          SELECT status, executed_at, id FROM test_results
          WHERE test_id = t.id ORDER BY executed_at DESC, id DESC LIMIT 10
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
        SELECT COUNT(DISTINCT fs.id)::int AS signature_count
        FROM failure_signatures fs
        JOIN test_results tr ON tr.failure_signature_id = fs.id
        WHERE tr.test_id = t.id
      ) sigcount ON TRUE
      WHERE s.category IN ('flaky','critical','broken')
        AND ($1::bigint[] IS NULL OR r.installation_id = ANY($1))
      ORDER BY s.score DESC, s.computed_at DESC
      LIMIT 20
      `,
      [installations],
    );

    const recentRuns = await pool.query(
      `
      SELECT wr.id,
             r.full_name AS repository,
             wr.workflow_name,
             wr.github_run_id,
             wr.conclusion,
             wr.results_state,
             wr.started_at,
             wr.completed_at,
             rstat.test_count,
             rstat.flaky_count,
             rstat.failed_count
      FROM workflow_runs wr
      JOIN repositories r ON r.id = wr.repository_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS test_count,
               COUNT(*) FILTER (WHERE tr.status = 'failed')::int AS failed_count,
               COUNT(DISTINCT t.id) FILTER (WHERE s.category IN ('flaky','critical','broken'))::int AS flaky_count
        FROM test_results tr
        JOIN tests t ON t.id = tr.test_id
        LEFT JOIN flake_scores s ON s.test_id = t.id
        WHERE tr.workflow_run_id = wr.id
      ) rstat ON TRUE
      WHERE ($1::bigint[] IS NULL OR r.installation_id = ANY($1))
      ORDER BY COALESCE(wr.completed_at, wr.started_at, wr.created_at) DESC
      LIMIT 12
      `,
      [installations],
    );

    const activity = await pool.query(
      `
      SELECT ae.id::text AS key,
             ae.kind::text AS type,
             ae.repository_full_name AS repository,
             ae.message,
             ae.created_at AS at
      FROM activity_events ae
      LEFT JOIN repositories r ON r.full_name = ae.repository_full_name
      WHERE ($1::bigint[] IS NULL OR r.installation_id = ANY($1))
      ORDER BY ae.created_at DESC
      LIMIT 20
      `,
      [installations],
    );

    // CI reliability = average of (100 - flake score) over analyzed tests. A
    // stable test contributes 100, a critical one ~0. `previous` is the same
    // computed from the prior score snapshot — a real, not fabricated, delta.
    const reliability = await pool.query(
      `
      SELECT COALESCE(ROUND(AVG(100 - s.score))::int, NULL)     AS score,
             COALESCE(ROUND(AVG(100 - s.previous_score))::int, NULL) AS previous,
             COUNT(*)::int                                      AS analyzed
      FROM flake_scores s
      JOIN tests t ON t.id = s.test_id
      JOIN repositories r ON r.id = t.repository_id
      WHERE s.window_size >= 8
        AND ($1::bigint[] IS NULL OR r.installation_id = ANY($1))
      `,
      [installations],
    );

    const newlyFlaky = await pool.query(
      `
      SELECT t.id, t.name, t.file_path, r.full_name AS repository,
             s.score, s.category::text AS category,
             s.failure_rate::float8 AS failure_rate,
             s.computed_at
      FROM flake_scores s
      JOIN tests t ON t.id = s.test_id
      JOIN repositories r ON r.id = t.repository_id
      WHERE s.category IN ('flaky','critical','broken')
        AND (s.previous_score IS NULL OR s.previous_score < 30)
        AND ($1::bigint[] IS NULL OR r.installation_id = ANY($1))
      ORDER BY s.computed_at DESC
      LIMIT 10
      `,
      [installations],
    );

    const trendingWorse = await pool.query(
      `
      SELECT t.id, t.name, t.file_path, r.full_name AS repository,
             s.score, s.previous_score, s.category::text AS category,
             (s.score - s.previous_score) AS delta
      FROM flake_scores s
      JOIN tests t ON t.id = s.test_id
      JOIN repositories r ON r.id = t.repository_id
      WHERE s.previous_score IS NOT NULL
        AND s.score > s.previous_score
        AND ($1::bigint[] IS NULL OR r.installation_id = ANY($1))
      ORDER BY (s.score - s.previous_score) DESC
      LIMIT 10
      `,
      [installations],
    );

    const trendingBetter = await pool.query(
      `
      SELECT t.id, t.name, t.file_path, r.full_name AS repository,
             s.score, s.previous_score, s.category::text AS category,
             (s.previous_score - s.score) AS delta
      FROM flake_scores s
      JOIN tests t ON t.id = s.test_id
      JOIN repositories r ON r.id = t.repository_id
      WHERE s.previous_score IS NOT NULL
        AND s.score < s.previous_score
        AND ($1::bigint[] IS NULL OR r.installation_id = ANY($1))
      ORDER BY (s.previous_score - s.score) DESC
      LIMIT 10
      `,
      [installations],
    );

    // CI waste: failed-test duration, from real duration_ms. No monetary cost
    // is invented — time is the only unit we can measure honestly.
    const ciWaste = await pool.query(
      `
      SELECT COALESCE(SUM(tr.duration_ms) FILTER (WHERE tr.status = 'failed'), 0)::int AS failed_duration_ms,
             COUNT(*) FILTER (WHERE tr.status = 'failed')::int AS failed_results,
             COALESCE(SUM(tr.duration_ms) FILTER (WHERE tr.status = 'failed' AND s.category IN ('flaky','critical','broken')), 0)::int AS flaky_duration_ms
      FROM test_results tr
      JOIN tests t ON t.id = tr.test_id
      LEFT JOIN flake_scores s ON s.test_id = t.id
      JOIN repositories r ON r.id = t.repository_id
      WHERE ($1::bigint[] IS NULL OR r.installation_id = ANY($1))
      `,
      [installations],
    );

    return {
      stats: stats.rows[0],
      reliability: reliability.rows[0],
      mostFlakyTests: mostFlaky.rows,
      newlyFlaky: newlyFlaky.rows,
      trendingWorse: trendingWorse.rows,
      trendingBetter: trendingBetter.rows,
      ciWaste: ciWaste.rows[0],
      recentRuns: recentRuns.rows,
      recentActivity: activity.rows,
    };
  });

  // ── Reveal/rotate this installation's ingest API key. Session-scoped so a
  //    user can only mint a key for an installation they can access. ───────
  app.post("/api/installations/:id/key", { preHandler: authPreHandler }, async (request, reply) => {
    const params = request.params as { id: string };
    const installationId = Number(params.id);
    if (!Number.isInteger(installationId)) {
      return reply.code(400).send({ error: "invalid_installation_id" });
    }
    if (!assertInstallationAccess(request, reply, installationId)) {
      return;
    }
    const key = await issueApiKey(pool, installationId);
    return { key };
  });

  // ── Development-only debug status: row counts, no sensitive data. ─────
  const debugStatusHandler = async () => {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM installations)   AS installations,
        (SELECT COUNT(*)::int FROM repositories)    AS repositories,
        (SELECT COUNT(*)::int FROM workflow_runs)   AS workflow_runs,
        (SELECT COUNT(*)::int FROM tests)           AS tests,
        (SELECT COUNT(*)::int FROM test_results)    AS test_results,
        (SELECT COUNT(*)::int FROM flake_scores)    AS flake_scores,
        (SELECT COUNT(*)::int FROM flake_scores WHERE category IN ('flaky','critical')) AS flaky_tests,
        (SELECT COUNT(*)::int FROM failure_signatures) AS failure_signatures,
        (SELECT COUNT(*)::int FROM webhook_deliveries)  AS webhook_deliveries
    `);
    return result.rows[0];
  };
  app.get("/api/debug/status", debugStatusHandler);
  app.get("/v1/debug/status", debugStatusHandler);

  // ── System health: real checks, so the dashboard can say "it's working"
  //    instead of making the user guess. ──────────────────────────────────
  app.get("/api/health", async () => {
    let database = { status: "connected" as string };
    try {
      await pool.query("SELECT 1");
    } catch {
      database = { status: "down" };
    }

    const installations = await pool.query(
      `SELECT COUNT(*)::int AS n FROM installations`,
    ).catch(() => ({ rows: [{ n: 0 }] }));

    const webhook = await pool.query(
      `SELECT COUNT(*)::int AS n, MAX(received_at) AS last FROM webhook_deliveries`,
    ).catch(() => ({ rows: [{ n: 0, last: null }] }));

    const ingestion = await pool.query(
      `SELECT COUNT(*)::int AS n FROM test_results`,
    ).catch(() => ({ rows: [{ n: 0 }] }));

    const scoring = await pool.query(
      `SELECT COUNT(*)::int AS n FROM flake_scores WHERE window_size >= 8`,
    ).catch(() => ({ rows: [{ n: 0 }] }));

    const appId = process.env.GITHUB_APP_ID ?? "";
    const hasKey = Boolean(process.env.GITHUB_PRIVATE_KEY || process.env.GITHUB_PRIVATE_KEY_PATH);

    const allOk =
      database.status === "connected" &&
      (webhook.rows[0]?.n ?? 0) > 0 &&
      (ingestion.rows[0]?.n ?? 0) > 0;

    return {
      status: allOk ? "ok" : "degraded",
      checks: {
        githubApp: {
          status: (installations.rows[0]?.n ?? 0) > 0 ? "connected" : "not_installed",
          credentialsConfigured: hasKey && appId.length > 0,
          installations: installations.rows[0]?.n ?? 0,
        },
        database,
        webhook: {
          status: (webhook.rows[0]?.n ?? 0) > 0 ? "receiving" : "idle",
          deliveries: webhook.rows[0]?.n ?? 0,
          lastDelivery: webhook.rows[0]?.last ?? null,
        },
        ingestion: {
          status: (ingestion.rows[0]?.n ?? 0) > 0 ? "working" : "idle",
          resultsStored: ingestion.rows[0]?.n ?? 0,
        },
        scoring: {
          status: (scoring.rows[0]?.n ?? 0) > 0 ? "working" : "idle",
          testsScored: scoring.rows[0]?.n ?? 0,
        },
      },
    };
  });
};

export default apiPlugin;
