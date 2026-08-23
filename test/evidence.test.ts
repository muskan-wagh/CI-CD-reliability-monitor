import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dominantSignatureShare,
  summarizeDominantShare,
  trailingConsecutiveFailures,
  passToFailTransitions,
} from "../src/lib/evidence.js";

test("dominantSignatureShare computes total/dominant/share", () => {
  const r = dominantSignatureShare([
    { occurrencesOnTest: 5 },
    { occurrencesOnTest: 2 },
    { occurrencesOnTest: 1 },
  ]);
  assert.equal(r.total, 8);
  assert.equal(r.dominant, 5);
  assert.equal(r.share, 0.625);
});

test("dominantSignatureShare returns null share with no failures", () => {
  assert.equal(dominantSignatureShare([]).share, null);
});

test("summarizeDominantShare renders the human sentence", () => {
  assert.equal(
    summarizeDominantShare(5, 8),
    "5 of 8 recorded failures share the same failure signature.",
  );
  assert.equal(summarizeDominantShare(0, 0), null);
});

test("trailingConsecutiveFailures counts newest backwards", () => {
  const o = [
    { status: "passed" },
    { status: "failed" },
    { status: "failed" },
    { status: "failed" },
  ];
  assert.equal(trailingConsecutiveFailures(o), 3);
  assert.equal(trailingConsecutiveFailures([{ status: "passed" }]), 0);
  assert.equal(trailingConsecutiveFailures([]), 0);
});

test("passToFailTransitions counts only PASS->FAIL flips", () => {
  const o = [
    { status: "passed" },
    { status: "failed" },
    { status: "passed" },
    { status: "failed" },
    { status: "skipped" },
    { status: "passed" },
  ];
  assert.equal(passToFailTransitions(o), 2);
});
