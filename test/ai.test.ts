import { test } from "node:test";
import assert from "node:assert/strict";
import type { FailureEvidence } from "../src/lib/evidence.js";
import {
  parseAiResponse,
  computeInputHash,
  insufficientEvidenceResult,
  INSUFFICIENT_SUMMARY,
} from "../src/lib/ai/types.js";
import { StubProvider } from "../src/lib/ai/stub.js";

function evidence(overrides: Partial<FailureEvidence> = {}): FailureEvidence {
  return {
    test: {
      id: 1,
      name: "testLogin",
      filePath: "src/auth/login.test.js",
      suitePath: "",
      repository: "acme/api",
      firstSeenAt: null,
      lastSeenAt: null,
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
      { status: "passed", durationMs: 100, executedAt: "", workflowRunId: 1, githubRunId: 1, headBranch: "main", headSha: "a".repeat(40), errorClass: null },
      { status: "failed", durationMs: 120, executedAt: "", workflowRunId: 2, githubRunId: 2, headBranch: "main", headSha: "b".repeat(40), errorClass: "TimeoutError" },
    ],
    signatures: [
      { id: 9, fingerprint: "f1", errorClass: "TimeoutError", sampleMessage: "Exceeded 5000ms", occurrencesOnTest: 3, shareOfFailures: 1, firstSeenOnTest: null, lastSeenOnTest: null },
    ],
    stats: {
      avgFailedDurationMs: 120,
      avgPassedDurationMs: 100,
      trailingConsecutiveFailures: 0,
      passToFailTransitions: 1,
      dominantSignatureSummary: "3 of 3 recorded failures share the same failure signature.",
    },
    ...overrides,
  };
}

test("parseAiResponse accepts a plain JSON object", () => {
  const raw = JSON.stringify({
    summary: "DB timeout",
    classification: "LIKELY",
    likely_cause: "Connection pool exhausted",
    confidence: 0.87,
    evidence: ["3 prior timeouts"],
    possible_causes: ["pool exhaustion"],
    recommended_actions: ["inspect pool"],
  });
  const out = parseAiResponse(raw);
  assert.ok(out);
  assert.equal(out.classification, "LIKELY");
  assert.equal(out.confidence, 0.87);
  assert.deepEqual(out.recommended_actions, ["inspect pool"]);
});

test("parseAiResponse strips markdown fences and surrounding prose", () => {
  const content = 'Here you go:\n```json\n{"summary":"s","classification":"possible","confidence":2,"evidence":[],"possible_causes":[],"recommended_actions":[]}\n```';
  const out = parseAiResponse(content);
  assert.ok(out);
  assert.equal(out.classification, "POSSIBLE");
  assert.equal(out.confidence, 1); // clamped
});

test("parseAiResponse maps unknown classifications to UNKNOWN", () => {
  const out = parseAiResponse('{"summary":"x","classification":"GUESS","confidence":0.1,"evidence":["e"],"possible_causes":[],"recommended_actions":[]}');
  assert.ok(out);
  assert.equal(out.classification, "UNKNOWN");
});

test("parseAiResponse returns null for unusable output", () => {
  assert.equal(parseAiResponse("no json here"), null);
  assert.equal(parseAiResponse('{"unrelated":true}'), null);
});

test("computeInputHash is stable across volatile fields", () => {
  const a = evidence();
  const b = evidence({
    outcomes: a.outcomes.map((o) => ({ ...o, durationMs: o.durationMs! + 999, executedAt: "2030-01-01" })),
    stats: { ...a.stats, avgFailedDurationMs: 4242 },
  });
  assert.equal(computeInputHash(a), computeInputHash(b));
});

test("computeInputHash changes when the failure context changes", () => {
  const a = evidence();
  const b = evidence({
    outcomes: [...a.outcomes, { status: "failed", durationMs: 1, executedAt: "", workflowRunId: 3, githubRunId: 3, headBranch: "main", headSha: "c".repeat(40), errorClass: "TimeoutError" }],
  });
  assert.notEqual(computeInputHash(a), computeInputHash(b));
});

test("insufficientEvidenceResult uses the exact required sentence", () => {
  const r = insufficientEvidenceResult(["Observed error class: AssertionError"]);
  assert.equal(r.summary, INSUFFICIENT_SUMMARY);
  assert.equal(r.classification, "UNKNOWN");
  assert.equal(r.confidence, 0);
});

test("StubProvider restates facts, labels itself, invents nothing", async () => {
  const out = await new StubProvider().investigate(evidence());
  assert.equal(out.summary.startsWith("[stub]"), true);
  assert.equal(out.likely_cause, "TimeoutError");
  assert.ok(!out.summary.toLowerCase().includes("root cause is definitely"));
});
