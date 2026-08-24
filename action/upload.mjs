#!/usr/bin/env node
// Echo upload — zero-dependency composite action script.
// Reads a JUnit XML report and POSTs it to the Echo ingest endpoint.

import { readFileSync, statSync } from "node:fs";

const MAX_REPORT_BYTES = 10 * 1024 * 1024; // matches server-side cap philosophy

function log(msg) {
  console.log(`[echo] ${msg}`);
}

function env(name) {
  return (process.env[name] ?? "").trim();
}

async function main() {
  const apiUrl = env("FG_API_URL").replace(/\/+$/, "");
  const apiKey = env("FG_API_KEY");
  const reportPath = env("FG_REPORT_PATH") || "junit.xml";

  // Skip-safe: fork PRs and repos without secrets stay green.
  if (!apiUrl || !apiKey) {
    log("skipped: echo api-url/api-key not configured");
    return;
  }

  let xml;
  try {
    if (statSync(reportPath).size > MAX_REPORT_BYTES) {
      throw new Error(`report larger than ${MAX_REPORT_BYTES} bytes`);
    }
    xml = readFileSync(reportPath, "utf8");
  } catch (err) {
    log(`skipped: could not read ${reportPath} (${err.message})`);
    return;
  }

  const payload = {
    repository: env("FG_REPOSITORY"),
    github_run_id: Number(env("FG_RUN_ID")),
    run_attempt: Number(env("FG_RUN_ATTEMPT")) || 1,
    head_sha: env("FG_HEAD_SHA"),
    head_branch: env("FG_HEAD_BRANCH"),
    job_name: env("FG_JOB_NAME") || "test",
    workflow_name: env("FG_WORKFLOW_NAME") || undefined,
    report: xml,
  };

  if (!payload.repository || !Number.isInteger(payload.github_run_id)) {
    throw new Error("missing FG_REPOSITORY or FG_RUN_ID metadata");
  }

  const res = await fetch(`${apiUrl}/v1/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ingest failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }

  const summary = await res.json().catch(() => ({}));
  log(
    `uploaded ${summary.testsReceived ?? "?"} tests ` +
      `(${summary.passed ?? "?"} passed / ${summary.failed ?? "?"} failed / ${summary.skipped ?? "?"} skipped)`,
  );
}

main().catch((err) => {
  console.error(`[echo] ${err.message}`);
  process.exit(1);
});
