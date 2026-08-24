import { test } from "node:test";
import assert from "node:assert/strict";
import type { FailureEvidence } from "../src/lib/evidence.js";
import type { AiInvestigation } from "../src/lib/ai/types.js";
import type { CorrelatedPr } from "../src/lib/prCorrelation.js";
import {
  issueTitle,
  renderIssueBody,
  outcomeSequence,
} from "../src/lib/issueTemplate.js";

function evidence(): FailureEvidence {
  return {
    test: {
      id: 1,
      name: "testLogin",
      filePath: "src/auth/login.test.js",
      suitePath: "",
      repository: "acme/api",
      firstSeenAt: "2026-08-01T10:00:00.000Z",
      lastSeenAt: "2026-08-20T10:00:00.000Z",
    },
    score: {
      score: 57,
      category: "flaky",
      windowSize: 10,
      failureCount: 3,
      failureRate: 0.3,
      transitionRate: 0.5,
    },
    outcomes: [
      { status: "passed", durationMs: 100, executedAt: "2026-08-19T10:00:00.000Z", workflowRunId: 1, githubRunId: 101, headBranch: "main", headSha: null, errorClass: null },
      { status: "failed", durationMs: 5000, executedAt: "2026-08-20T10:00:00.000Z", workflowRunId: 2, githubRunId: 102, headBranch: "feat/x", headSha: "b".repeat(40), errorClass: "TimeoutError" },
    ],
    signatures: [
      { id: 9, fingerprint: "f1", errorClass: "TimeoutError", sampleMessage: "Exceeded 5000ms waiting for promise", occurrencesOnTest: 3, shareOfFailures: 1, firstSeenOnTest: null, lastSeenOnTest: null },
    ],
    stats: {
      avgFailedDurationMs: 5000,
      avgPassedDurationMs: 100,
      trailingConsecutiveFailures: 1,
      passToFailTransitions: 2,
      dominantSignatureSummary: "3 of 3 recorded failures share the same failure signature.",
    },
  };
}

const ai: AiInvestigation = {
  summary: "DB timeout pattern.",
  classification: "LIKELY",
  likely_cause: "Connection pool exhaustion",
  confidence: 0.9,
  evidence: ["All failures are TimeoutError"],
  possible_causes: ["pool exhaustion"],
  recommended_actions: ["inspect pool", "check DB latency"],
};

const pr: CorrelatedPr = {
  prNumber: 142,
  title: "Add refunds flow",
  authorLogin: "priya",
  state: "closed",
  changedFiles: ["src/payments/a.ts", "src/payments/b.ts"],
};

test("title follows the [Echo] name/category/score format", () => {
  assert.equal(
    issueTitle({ evidence: evidence(), ai: null, pr: null }),
    "[Echo] testLogin is flaky (flake score 57)",
  );
});

test("body contains every required section and field", () => {
  const body = renderIssueBody({ evidence: evidence(), ai, pr, testUrl: "https://fg.test/tests/1" });
  for (const needle of [
    "| Test | `testLogin` |",
    "| Repository | acme/api |",
    "**57/100** (flaky)",
    "30% (3/10 analyzed runs)",
    "PASS→FAIL flips | 2 |",
    "3 of 3 recorded failures share the same failure signature.",
    "`TimeoutError` ×3 (100%)",
    "Exceeded 5000ms waiting for promise",
    "## AI investigation — likely cause (LIKELY, 90% confidence)",
    "Connection pool exhaustion",
    "- → inspect pool",
    "first observed after **PR #142** — Add refunds flow",
    "timing correlation, not causation",
    "Changed files (2)",
    "`src/payments/a.ts`",
    "[Open in Echo](https://fg.test/tests/1)",
  ]) {
    assert.ok(body.includes(needle), `missing: ${needle}`);
  }
});

test("body falls back to commit + no-correlation note without a PR", () => {
  const body = renderIssueBody({ evidence: evidence(), ai: null, pr: null });
  assert.ok(body.includes("run #102"));
  assert.ok(body.includes("commit `bbbbbbb`"));
  assert.ok(body.includes("No pull-request correlation is available for this commit yet."));
  assert.ok(!body.includes("AI investigation — likely cause"));
  assert.ok(body.includes("Not run yet"));
});

test("UNKNOWN AI investigations are treated as not run", () => {
  const unknown = { ...ai, classification: "UNKNOWN" as const };
  const body = renderIssueBody({ evidence: evidence(), ai: unknown, pr: null });
  assert.ok(body.includes("Not run yet"));
});

test("secrets in failure text never reach the issue body", () => {
  const e = evidence();
  e.signatures[0]!.sampleMessage =
    "failed ghp_16C7e42F292c6912E7710c838347Ae178B4a password=hunter2";
  const body = renderIssueBody({ evidence: e, ai: null, pr: null });
  assert.ok(!body.includes("ghp_16C7"), body);
  assert.ok(!body.includes("hunter2"));
});

test("outcomeSequence maps statuses to glyphs oldest→newest", () => {
  const seq = outcomeSequence(evidence().outcomes);
  assert.equal(seq, "✅ ❌");
});
