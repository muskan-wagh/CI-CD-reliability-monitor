import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, redactDeep } from "../src/lib/redact.js";

test("redacts GitHub tokens", () => {
  const out = redactSecrets("failed to fetch with ghp_16C7e42F292c6912E7710c838347Ae178B4a");
  assert.ok(!out.includes("ghp_"));
  assert.ok(out.includes("<REDACTED>"));
});

test("redacts fine-grained GitHub PATs", () => {
  const out = redactSecrets("github_pat_11ABCDEF2abcdefghijklmnopqrstuv");
  assert.ok(!out.includes("github_pat_"));
});

test("redacts AWS access keys", () => {
  const out = redactSecrets("AKIAIOSFODNN7EXAMPLE rejected");
  assert.ok(!out.includes("AKIAIOSFODNN7EXAMPLE"));
});

test("redacts sk- style keys", () => {
  const out = redactSecrets("key sk-abc123def456ghi789 invalid");
  assert.ok(!out.includes("sk-abc123def456"));
});

test("redacts Bearer tokens but keeps the word Bearer", () => {
  const out = redactSecrets("Authorization: Bearer abc.def.ghi failed");
  assert.ok(!out.includes("abc.def.ghi"));
  assert.match(out, /Bearer\s*<REDACTED>|<REDACTED>/i);
});

test("redacts PEM private key blocks including contents", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK\n-----END RSA PRIVATE KEY-----";
  const out = redactSecrets(`boom:\n${pem}\ndone`);
  assert.ok(!out.includes("MIIEowIBAAK"));
  assert.ok(out.includes("<REDACTED>"));
});

test("redacts URL credentials", () => {
  const out = redactSecrets("connect postgres://admin:hunter2@db.host:5432/prod");
  assert.ok(!out.includes("hunter2"), out);
  assert.ok(out.includes("<REDACTED>"));
});

test("redacts password=/token= assignments but keeps the label", () => {
  const out = redactSecrets('password=hunter2 and API_KEY: sk-abc123def456');
  assert.ok(!out.includes("hunter2"));
  assert.ok(/password\s*=\s*<REDACTED>/.test(out), out);
  assert.ok(/API_KEY:\s*<REDACTED>/i.test(out) || out.includes("<REDACTED>"), out);
});

test("leaves ordinary failure text untouched", () => {
  const msg = "TimeoutError: Exceeded 5000ms waiting for promise at login (src/auth.ts:42)";
  assert.equal(redactSecrets(msg), msg);
});

test("redactDeep walks nested structures", () => {
  const out = redactDeep({
    summary: "used token ghp_16C7e42F292c6912E7710c838347Ae178B4a",
    evidence: ["password=topsecret", "clean"],
    nested: { url: "postgres://u:p@h/x" },
    n: 5,
  });
  const s = JSON.stringify(out);
  assert.ok(!s.includes("ghp_") && !s.includes("topsecret") && !s.includes(":p@h"));
});
