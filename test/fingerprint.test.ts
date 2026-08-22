import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFailureFingerprint,
  normalizeFailureText,
} from "../src/lib/fingerprint.js";

test("redacts 4+ digit request ids but keeps status codes", () => {
  const out = normalizeFailureText(
    "expected request-98231 but received request-73192",
  );
  assert.equal(out, "expected request-<N> but received request-<N>");
});

test("keeps HTTP status codes 404/500 intact", () => {
  assert.equal(normalizeFailureText("expected 404 but received 500"), "expected 404 but received 500");
});

test("strips ANSI escape sequences", () => {
  assert.equal(normalizeFailureText("\u001b[31mfail\u001b[0m here"), "fail here");
});

test("normalizes the GitHub runner path to repo-relative", () => {
  assert.equal(
    normalizeFailureText("/home/runner/work/repo/repo/tests/a.ts failed"),
    "tests/a.ts failed",
  );
});

test("normalizes temp dirs", () => {
  assert.equal(normalizeFailureText("/tmp/xyz831/thing"), "<TMP>/thing");
});

test("normalizes UUIDs", () => {
  assert.equal(
    normalizeFailureText("id 6ba7b810-9dad-11d1-80b4-00c04fd430c8 failed"),
    "id <UUID> failed",
  );
});

test("normalizes long hex hashes", () => {
  assert.equal(
    normalizeFailureText("hash 3f2a1b9c4d5e6f708192a3b4c5d6e7f8"),
    "hash <HASH>",
  );
});

test("normalizes ISO timestamps before integers", () => {
  assert.equal(
    normalizeFailureText("at 2026-08-21T10:00:00Z and 2026-09-15T11:00:00Z"),
    "at <TS> and <TS>",
  );
});

test("collapses whitespace", () => {
  assert.equal(normalizeFailureText("a\n\n   b\t c"), "a b c");
});

test("two failures differing only by request id share a fingerprint", () => {
  const a = computeFailureFingerprint({
    errorClass: "AssertionError",
    message: "expected request-98231 but received request-73192",
  });
  const b = computeFailureFingerprint({
    errorClass: "AssertionError",
    message: "expected request-55123 but received request-99999",
  });
  assert.equal(a.fingerprint, b.fingerprint);
});

test("genuinely different failures get different fingerprints", () => {
  const a = computeFailureFingerprint({
    errorClass: "AssertionError",
    message: "expected 401 but received 500",
  });
  const b = computeFailureFingerprint({
    errorClass: "TimeoutError",
    message: "exceeded 5000ms",
  });
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test("fingerprint is deterministic", () => {
  const a = computeFailureFingerprint({ errorClass: "X", message: "boom" });
  const b = computeFailureFingerprint({ errorClass: "X", message: "boom" });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
});
