#!/usr/bin/env node
/**
 * Echo deterministic end-to-end demo.
 *
 * Simulates a real GitHub Actions -> Echo flow WITHOUT GitHub, by
 * exercising the exact same HTTP endpoints the production system uses:
 *   - POST /v1/ingest            (the flakyguard-action path)
 *   - POST /webhooks/github      (the GitHub App webhook path, HMAC-signed)
 *
 * Every byte of data flows through the real parser -> store -> scoring code.
 * The demo repo is clearly named `flakyguard-demo/*` so it can never be
 * mistaken for real production data.
 *
 * Usage:
 *   npm run demo            # seed (idempotent: re-runs append/refresh)
 *   npm run demo -- --reset # wipe the demo repo first, then seed
 *
 * Requires the backend to be running (npm run dev) on PORT.
 */
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { sign } from "../src/lib/signature.js";
import { issueApiKey } from "../src/lib/apiKeys.js";
import { randomUUID } from "node:crypto";

const config = loadConfig();
const BASE = `http://127.0.0.1:${config.port}`;
const REPO_FULL_NAME = "flakyguard-demo/api-service";
const REPO_GITHUB_ID = 900_000_001;
const INSTALLATION_ID = 900_000_001;
const WORKFLOW_NAME = "CI";
const RUNS = 24;

interface DemoTest {
  name: string;
  file: string;
  /** returns true when the test FAILS on a given 1-indexed run number */
  failsOn: (run: number) => boolean;
  errorClass: string;
  message: string;
}

const DEMO_TESTS: DemoTest[] = [
  {
    name: "testLogin",
    file: "src/auth/login.test.js",
    failsOn: (run) => run % 4 === 0, // P P P F ... -> FLAKY
    errorClass: "TimeoutError",
    message: "Exceeded 5000ms waiting for promise",
  },
  {
    name: "testTimeout",
    file: "src/orders/timeout.test.js",
    failsOn: (run) => run % 2 === 0, // P F P F ... perfect alternation -> CRITICAL
    errorClass: "TimeoutError",
    message: "Exceeded 3000ms waiting for DB connection",
  },
  {
    name: "testRefund",
    file: "src/payments/refund.test.js",
    failsOn: (run) => run >= 20, // last 5 consecutive -> BROKEN
    errorClass: "AssertionError",
    message: "expected 200 but got 500",
  },
  {
    name: "testSearch",
    file: "src/search/search.test.js",
    failsOn: (run) => run === 14 || run === 17, // isolated blips -> WATCH
    errorClass: "TypeError",
    message: "Cannot read properties of undefined (reading 'id')",
  },
  {
    name: "testCheckout",
    file: "src/checkout/checkout.test.js",
    failsOn: () => false, // always green -> STABLE
    errorClass: "",
    message: "",
  },
];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function junitForRun(run: number): string {
  const cases = DEMO_TESTS.map((t) => {
    const failed = t.failsOn(run);
    const time = (0.5 + ((run * 7 + t.name.length) % 40) / 10).toFixed(3);
    const attrs = `classname="${escapeXml(t.file)}" name="${escapeXml(t.name)}" time="${time}"`;
    if (!failed) return `  <testcase ${attrs}/>`;
    return [
      `  <testcase ${attrs}>`,
      `    <failure message="${escapeXml(t.message)}" type="${escapeXml(t.errorClass)}">${escapeXml(t.message)}</failure>`,
      `  </testcase>`,
    ].join("\n");
  }).join("\n");

  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<testsuites>`,
    `  <testsuite name="${WORKFLOW_NAME}" tests="${DEMO_TESTS.length}">`,
    cases,
    `  </testsuite>`,
    `</testsuites>`,
  ].join("\n");
}

function shaFor(run: number): string {
  // deterministic 40-char hex, stable per run
  return `${run.toString(16)}`.padStart(40, "a").slice(-40);
}

function iso(run: number, offsetSeconds: number): string {
  // newest run is "now"; older runs are offset backwards
  const base = Date.now() - (RUNS - run) * 60_000;
  return new Date(base + offsetSeconds * 1000).toISOString();
}

async function postIngest(run: number, key: string): Promise<void> {
  const body = {
    repository: REPO_FULL_NAME,
    github_repo_id: REPO_GITHUB_ID,
    github_run_id: 100_000 + run,
    run_attempt: 1,
    head_sha: shaFor(run),
    head_branch: "main",
    job_name: "test",
    workflow_name: WORKFLOW_NAME,
    executed_at: iso(run, 0),
    report: junitForRun(run),
  };
  const res = await fetch(`${BASE}/v1/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`ingest run ${run} failed: HTTP ${res.status} ${await res.text()}`);
  }
  const summary = (await res.json()) as { passed: number; failed: number };
  console.log(`  run ${run}: ingested ${summary.passed}P / ${summary.failed}F`);
}

async function postWorkflowRun(run: number): Promise<void> {
  const failed = DEMO_TESTS.some((t) => t.failsOn(run));
  const payload = {
    action: "completed",
    installation: { id: INSTALLATION_ID, account: { login: "demo", type: "User" } },
    repository: { id: REPO_GITHUB_ID, full_name: REPO_FULL_NAME, name: "api-service" },
    workflow_run: {
      id: 100_000 + run,
      name: WORKFLOW_NAME,
      run_attempt: 1,
      head_sha: shaFor(run),
      head_branch: "main",
      event: "push",
      conclusion: failed ? "failure" : "success",
      created_at: iso(run, 0),
      updated_at: iso(run, 20),
      repository: { id: REPO_GITHUB_ID, full_name: REPO_FULL_NAME, name: "api-service" },
    },
  };
  const raw = JSON.stringify(payload);
  const res = await fetch(`${BASE}/webhooks/github`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "workflow_run",
      "X-GitHub-Delivery": randomUUID(),
      "X-Hub-Signature-256": `sha256=${sign(raw, config.githubWebhookSecret)}`,
    },
    body: raw,
  });
  if (!res.ok) {
    throw new Error(`webhook run ${run} failed: HTTP ${res.status} ${await res.text()}`);
  }
}

async function postInstallation(): Promise<void> {
  const payload = {
    action: "created",
    installation: { id: INSTALLATION_ID, account: { login: "demo", type: "User" } },
    repositories: [
      { id: REPO_GITHUB_ID, full_name: REPO_FULL_NAME },
    ],
  };
  const raw = JSON.stringify(payload);
  await fetch(`${BASE}/webhooks/github`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "installation",
      "X-GitHub-Delivery": randomUUID(),
      "X-Hub-Signature-256": `sha256=${sign(raw, config.githubWebhookSecret)}`,
    },
    body: raw,
  });
}

async function resetDemoData(): Promise<void> {
  const pool = createPool(config.databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Deletion order follows FK dependencies (children before parents).
    const repoFilter = `repository_id IN (SELECT id FROM repositories WHERE full_name = $1)`;
    const testFilter = `test_id IN (SELECT id FROM tests WHERE repository_id IN (SELECT id FROM repositories WHERE full_name = $1))`;

    await client.query(`DELETE FROM test_results WHERE ${testFilter}`, [REPO_FULL_NAME]);
    await client.query(`DELETE FROM flake_scores WHERE ${testFilter}`, [REPO_FULL_NAME]);
    await client.query(
      `DELETE FROM cicd_ai_investigations WHERE ${testFilter}`,
      [REPO_FULL_NAME],
    );
    await client.query(`DELETE FROM failure_signatures WHERE ${repoFilter}`, [REPO_FULL_NAME]);
    await client.query(`DELETE FROM tests WHERE ${repoFilter}`, [REPO_FULL_NAME]);
    await client.query(`DELETE FROM workflow_runs WHERE ${repoFilter}`, [REPO_FULL_NAME]);
    await client.query(`DELETE FROM pull_requests WHERE ${repoFilter}`, [REPO_FULL_NAME]);
    await client.query(`DELETE FROM repositories WHERE full_name = $1`, [REPO_FULL_NAME]);
    await client.query(`DELETE FROM api_keys WHERE installation_id = $1`, [INSTALLATION_ID]);
    await client.query(`DELETE FROM installations WHERE id = $1`, [INSTALLATION_ID]);
    await client.query(
      `DELETE FROM activity_events WHERE repository_full_name = $1`,
      [REPO_FULL_NAME],
    );
    await client.query("COMMIT");
    console.log("[demo] reset previous demo data");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const reset = process.argv.includes("--reset");
  if (reset) await resetDemoData();

  console.log(`Echo demo: seeding "${REPO_FULL_NAME}" (${RUNS} runs)`);

  await postInstallation();
  console.log("[demo] installation created");

  // The installation webhook issues its own key (fire-and-forget); wait for it,
  // then mint our own key for the ingest calls below.
  await sleep(1500);
  const keyPool = createPool(config.databaseUrl);
  let key: string;
  try {
    key = await issueApiKey(keyPool, INSTALLATION_ID);
  } finally {
    await keyPool.end();
  }
  console.log("[demo] issued per-installation ingest API key");

  for (let run = 1; run <= RUNS; run++) {
    await postIngest(run, key);
    await postWorkflowRun(run);
    // Pace the loop so fire-and-forget scoring keeps up with the pool.
    await sleep(300);
  }

  // Scoring is fire-and-forget after ingest; give the last batch a moment.
  await sleep(2000);

  // Align first_seen_at with the earliest recorded run so the reliability
  // timeline reads oldest-first (demo backdates executed_at into the past).
  const syncPool = createPool(config.databaseUrl);
  try {
    await syncPool.query(
      `UPDATE tests t
       SET first_seen_at = (SELECT MIN(tr.executed_at) FROM test_results tr WHERE tr.test_id = t.id)
       WHERE t.repository_id IN (SELECT id FROM repositories WHERE full_name = $1)`,
      [REPO_FULL_NAME],
    );
  } finally {
    await syncPool.end();
  }

  const status = await fetchJson<Record<string, number>>("/api/debug/status");
  console.log("\n=== /api/debug/status ===");
  console.log(JSON.stringify(status, null, 2));

  const dashboard = await fetchJson<{
    stats: Record<string, number>;
    mostFlakyTests: { name: string; score: number; category: string; failure_rate: number }[];
  }>("/api/dashboard");
  console.log("\n=== /api/dashboard stats ===");
  console.log(JSON.stringify(dashboard.stats, null, 2));
  console.log("\n=== flaky leaderboard ===");
  for (const t of dashboard.mostFlakyTests) {
    console.log(`  ${t.name.padEnd(16)} score=${t.score} ${t.category} failRate=${(t.failure_rate * 100).toFixed(0)}%`);
  }

  console.log("\nDemo complete. Open the dashboard to see the results.");
}

main().catch((err) => {
  console.error("[demo] failed:", (err as Error).message);
  process.exit(1);
});
