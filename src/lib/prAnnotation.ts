import type { Pool } from "pg";
import {
  createInstallationClient,
  loadGithubAppCredentials,
} from "./githubApp.js";
import { upsertPrAnnotation } from "./store.js";

export const COMMENT_MARKER = "<!-- echo:report:v1 -->";

export interface FlakyTestForReport {
  name: string;
  filePath: string;
  score: number;
  category: string;
  failureRate: number;
  recentOutcomes: string[];
  topErrorClass?: string | null;
  topSampleMessage?: string | null;
}

function ribbon(outcomes: string[], max = 10): string {
  const recent = outcomes.slice(-max);
  if (recent.length === 0) return "–";
  return recent
    .map((s) => (s === "failed" ? "🟥" : s === "skipped" ? "⬜" : "🟩"))
    .join("");
}

/**
 * Render the single living report comment for a PR. The marker line lets us
 * find and UPDATE our own comment later instead of posting duplicates.
 */
export function renderFlakyReport(input: {
  repositoryFullName: string;
  tests: FlakyTestForReport[];
  dashboardUrl?: string;
}): string {
  if (input.tests.length === 0) {
    throw new Error("renderFlakyReport called with no flaky tests");
  }

  const rows = input.tests
    .map((t) => {
      const failure = t.topSampleMessage
        ? `${t.topErrorClass ?? "Error"}: ${t.topSampleMessage}`
        : "–";
      return `| \`${t.name}\` | \`${t.filePath}\` | **${t.score}** ${t.category === "critical" ? "🔴" : "🟠"} | ${ribbon(t.recentOutcomes)} | ${failure.replace(/\|/g, "\\|")} |`;
    })
    .join("\n");

  const dashboardLine = input.dashboardUrl
    ? `\n[View on Echo](${input.dashboardUrl})`
    : "";

  return [
    COMMENT_MARKER,
    `## ⚠️ Echo: ${input.tests.length} flaky test${input.tests.length === 1 ? "" : "s"} detected`,
    "",
    "| Test | File | Score | Recent runs | Top failure |",
    "|---|---|---|---|---|",
    rows,
    "",
    "These tests flip between passing and failing on identical code — likely unrelated to this PR.",
    "Scores are statistical triage over recent CI history, not a verdict." +
      dashboardLine,
    "",
    "<sub>Echo • every failure leaves a signal • one living report per PR, updated not spammed</sub>",
  ].join("\n");
}

interface CrossedTestRow {
  id: number;
  name: string;
  file_path: string;
  score: number;
  category: string;
  failure_rate: number;
  recent_outcomes: string[] | null;
  top_error_class: string | null;
  top_sample_message: string | null;
}

/** Tests in this run that just crossed INTO flaky/critical. */
async function findCrossedTests(
  pool: Pool,
  workflowRunId: number,
): Promise<CrossedTestRow[]> {
  const result = await pool.query(
    `
    SELECT t.id,
           t.name,
           t.file_path,
           s.score,
           s.category::text AS category,
           s.failure_rate::float8 AS failure_rate,
           hist.recent_outcomes,
           sig.top_error_class,
           sig.top_sample_message
    FROM test_results tr
    JOIN tests t ON t.id = tr.test_id
    JOIN flake_scores s ON s.test_id = t.id
    LEFT JOIN LATERAL (
      SELECT array_agg(x.status::text ORDER BY x.executed_at DESC, x.id DESC) AS recent_outcomes
      FROM (
        SELECT status, executed_at, id FROM test_results
        WHERE test_id = t.id ORDER BY executed_at DESC, id DESC LIMIT 10
      ) x
    ) hist ON TRUE
    LEFT JOIN LATERAL (
      SELECT fs.error_class AS top_error_class, fs.sample_message AS top_sample_message
      FROM failure_signatures fs
      JOIN test_results tr2 ON tr2.failure_signature_id = fs.id
      WHERE tr2.test_id = t.id
      GROUP BY fs.id ORDER BY COUNT(*) DESC LIMIT 1
    ) sig ON TRUE
    WHERE tr.workflow_run_id = $1
      AND s.category IN ('flaky', 'critical')
      AND (s.previous_score IS NULL OR s.previous_score < 30)
    `,
    [workflowRunId],
  );
  return result.rows as CrossedTestRow[];
}

/**
 * Post/update the living Echo report comment on the PR that owns this
 * run. Runs after async scoring; every failure path is non-fatal.
 */
export async function annotateRun(
  pool: Pool,
  workflowRunId: number,
): Promise<void> {
  const credentials = loadGithubAppCredentials();
  if (!credentials) return; // App not configured -> annotation disabled

  const runInfo = await pool.query(
    `SELECT wr.head_sha, wr.trigger_event,
            r.id AS repository_id, r.full_name, r.installation_id
     FROM workflow_runs wr
     JOIN repositories r ON r.id = wr.repository_id
     WHERE wr.id = $1`,
    [workflowRunId],
  );
  const run = runInfo.rows[0];
  if (
    !run ||
    !run.installation_id ||
    run.trigger_event !== "pull_request" ||
    typeof run.head_sha !== "string" ||
    run.head_sha.length === 0
  ) {
    return;
  }

  // Detect upward crossings BEFORE rendering anything.
  const crossed = await findCrossedTests(pool, workflowRunId);
  if (crossed.length === 0) return;

  const client = await createInstallationClient(credentials, Number(run.installation_id));

  // workflow_run.pull_requests[] is frequently empty (fork PRs) — resolve via SHA.
  const pulls = await client.get<{ number: number; state: string }[]>(
    `/repos/${run.full_name}/commits/${run.head_sha}/pulls`,
  );
  const openPull = pulls.find((p) => p.state === "open") ?? pulls[0];
  if (!openPull) return;

  const existing = await pool.query(
    `SELECT comment_id FROM pr_annotations WHERE repository_id = $1 AND pr_number = $2`,
    [run.repository_id, openPull.number],
  );

  const body = renderFlakyReport({
    repositoryFullName: run.full_name,
    tests: crossed.map((t) => ({
      name: t.name,
      filePath: t.file_path,
      score: t.score,
      category: t.category,
      failureRate: t.failure_rate,
      recentOutcomes: t.recent_outcomes ?? [],
      topErrorClass: t.top_error_class,
      topSampleMessage: t.top_sample_message,
    })),
    dashboardUrl: process.env.DASHBOARD_URL || undefined,
  });

  let commentId: number;
  if (existing.rows.length > 0 && existing.rows[0].comment_id) {
    commentId = Number(existing.rows[0].comment_id);
    await client.patch(`/repos/${run.full_name}/issues/comments/${commentId}`, { body });
  } else {
    const created = await client.post<{ id: number }>(
      `/repos/${run.full_name}/issues/${openPull.number}/comments`,
      { body },
    );
    commentId = created.id;
  }

  await upsertPrAnnotation(pool, {
    repositoryId: Number(run.repository_id),
    prNumber: openPull.number,
    commentId,
    bodySnapshot: body,
  });
}
