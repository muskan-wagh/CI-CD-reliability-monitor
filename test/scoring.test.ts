import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFlakeScore,
  wilsonLowerBound,
  MIN_SAMPLES,
} from "../src/lib/scoring.js";
import type { TestStatus } from "../src/lib/junit.js";

function seq(s: string): TestStatus[] {
  return s.split(/\s+/).filter(Boolean).map((c) => {
    if (c === "P") return "passed";
    if (c === "F") return "failed";
    return "skipped";
  });
}

test("the blueprint golden case P P F P P F P P P F scores ~57 (FLAKY)", () => {
  const r = computeFlakeScore(seq("P P F P P F P P P F"));
  assert.equal(r.score, 57);
  assert.equal(r.category, "flaky");
  assert.equal(r.failureCount, 3);
});

test("30 passes -> score 0 STABLE", () => {
  const r = computeFlakeScore(seq("P ".repeat(30).trim()));
  assert.equal(r.score, 0);
  assert.equal(r.category, "stable");
});

test("perfect alternation -> ~100 CRITICAL", () => {
  const r = computeFlakeScore(seq("P F ".repeat(15).trim()));
  assert.ok(r.score >= 95 && r.score <= 100);
  assert.equal(r.category, "critical");
});

test("27 passes then 3 fails -> ~12 WATCH (early warning)", () => {
  const r = computeFlakeScore(seq("P ".repeat(27) + "F F F"));
  assert.equal(r.score, 12);
  assert.equal(r.category, "watch");
});

test("one ancient fail among 30 passes stays STABLE", () => {
  const r = computeFlakeScore(seq("F " + "P ".repeat(29).trim()));
  assert.equal(r.category, "stable");
  assert.ok(r.score <= 9);
});

test("trailing 5 failures flips to BROKEN regardless of score", () => {
  const r = computeFlakeScore(seq("P P F F F F F"));
  assert.equal(r.category, "broken");
  assert.equal(r.consecutiveFails, 5);
});

test("FAIL FAIL FAIL FAIL FAIL is BROKEN, not flaky", () => {
  const r = computeFlakeScore(seq("F F F F F F"));
  assert.equal(r.category, "broken");
});

test("insufficient data below MIN_SAMPLES", () => {
  const r = computeFlakeScore(seq("P F P"));
  assert.equal(r.category, "insufficient");
  assert.equal(r.score, 0);
  assert.equal(r.windowSize, 3);
});

test("exactly MIN_SAMPLES-1 is still insufficient", () => {
  const r = computeFlakeScore(seq("P P P P P P P"));
  assert.equal(r.category, "insufficient");
});

test("score is always within 0-100", () => {
  for (let n = 8; n <= 30; n++) {
    const outcomes = Array.from({ length: n }, (_, i) =>
      i % 3 === 0 ? "failed" : "passed",
    ) as TestStatus[];
    const r = computeFlakeScore(outcomes);
    assert.ok(r.score >= 0 && r.score <= 100);
  }
});

test("skipped outcomes are treated as non-failures", () => {
  const r = computeFlakeScore(seq("P F P S P F"));
  assert.equal(r.failureCount, 2);
});

test("wilsonLowerBound stays sane for tiny samples", () => {
  const low = wilsonLowerBound(1, 2); // 50% of 2 is not confident
  assert.ok(low !== null && low < 0.5);
  assert.equal(wilsonLowerBound(0, 0), null);
  assert.ok((wilsonLowerBound(0, 30) ?? -1) === 0);
});
