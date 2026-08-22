import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeIdentity,
  normalizeFilePath,
  parameterizedParent,
} from "../src/lib/identity.js";

test("normalizeFilePath converts backslashes and strips ./", () => {
  assert.equal(normalizeFilePath("tests\\auth.test.ts"), "tests/auth.test.ts");
  assert.equal(normalizeFilePath("./tests/auth.test.ts"), "tests/auth.test.ts");
});

test("normalizeFilePath strips the GitHub runner prefix", () => {
  assert.equal(
    normalizeFilePath("/home/runner/work/repo/repo/tests/auth.test.ts"),
    "tests/auth.test.ts",
  );
});

test("normalizeFilePath leaves a clean relative path untouched", () => {
  assert.equal(normalizeFilePath("tests/auth.test.ts"), "tests/auth.test.ts");
});

test("parameterizedParent strips a bracket suffix", () => {
  assert.equal(parameterizedParent("login validates [case=empty]"), "login validates");
});

test("parameterizedParent returns null when there is no suffix", () => {
  assert.equal(parameterizedParent("login validates"), null);
});

test("computeIdentity is stable for the same input", () => {
  const a = computeIdentity({ filePath: "tests/auth.test.ts", name: "login works" });
  const b = computeIdentity({ filePath: "tests/auth.test.ts", name: "login works" });
  assert.equal(a.identityHash, b.identityHash);
  assert.match(a.identityHash, /^[0-9a-f]{64}$/);
});

test("computeIdentity differs across names", () => {
  const a = computeIdentity({ filePath: "tests/auth.test.ts", name: "login works" });
  const b = computeIdentity({ filePath: "tests/auth.test.ts", name: "login fails" });
  assert.notEqual(a.identityHash, b.identityHash);
});

test("computeIdentity derives a parent hash for parameterized tests", () => {
  const id = computeIdentity({
    filePath: "tests/auth.test.ts",
    name: "login validates [case=empty]",
  });
  assert.ok(id.parentHash);
  assert.match(id.parentHash, /^[0-9a-f]{64}$/);
});

test("computeIdentity has no parent hash for plain tests", () => {
  const id = computeIdentity({ filePath: "tests/auth.test.ts", name: "login validates" });
  assert.equal(id.parentHash, null);
});

test("computeIdentity normalizes the runner path inside identity", () => {
  const a = computeIdentity({
    filePath: "/home/runner/work/repo/repo/tests/auth.test.ts",
    name: "login works",
  });
  const b = computeIdentity({ filePath: "tests/auth.test.ts", name: "login works" });
  assert.equal(a.identityHash, b.identityHash);
});
