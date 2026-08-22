import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  COMMENT_MARKER,
  renderFlakyReport,
} from "../src/lib/prAnnotation.js";
import {
  createAppJwt,
  loadGithubAppCredentials,
} from "../src/lib/githubApp.js";

const TESTS = [
  {
    name: "refunds a user after dispute",
    filePath: "tests/payments/refunds.test.ts",
    score: 61,
    category: "critical",
    failureRate: 0.37,
    recentOutcomes: ["passed", "failed", "passed", "failed"],
    topErrorClass: "TimeoutError",
    topSampleMessage: "Exceeded 5000ms waiting for promise",
  },
];

test("comment contains the marker exactly once, at the top", () => {
  const body = renderFlakyReport({ repositoryFullName: "a/b", tests: TESTS });
  const count = body.split(COMMENT_MARKER).length - 1;
  assert.equal(count, 1);
  assert.ok(body.startsWith(COMMENT_MARKER));
});

test("comment lists test name, file, score and failure", () => {
  const body = renderFlakyReport({ repositoryFullName: "a/b", tests: TESTS });
  assert.ok(body.includes("refunds a user after dispute"));
  assert.ok(body.includes("tests/payments/refunds.test.ts"));
  assert.ok(body.includes("**61**"));
  assert.ok(body.includes("TimeoutError"));
});

test("ribbon maps outcomes to emoji", () => {
  const body = renderFlakyReport({ repositoryFullName: "a/b", tests: TESTS });
  assert.ok(body.includes("🟩🟥🟩🟥"));
});

test("throws when there is nothing flaky to report", () => {
  assert.throws(() => renderFlakyReport({ repositoryFullName: "a/b", tests: [] }));
});

test("app JWT has RS256 header and ~9min app-id subject", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const now = 1_700_000_000;
  const jwt = createAppJwt({ appId: "123456", privateKey: pem }, now);

  const [h, p] = jwt.split(".");
  if (!h || !p) throw new Error("malformed jwt");
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());

  assert.equal(header.alg, "RS256");
  assert.equal(payload.iss, 123456);
  assert.equal(payload.exp - payload.iat, 600); // +60 iat backdate
  assert.ok(payload.exp > now && payload.exp <= now + 540);
  assert.match(jwt, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  void publicKey;
});

test("credentials loader returns null when unconfigured", () => {
  const saved = { ...process.env };
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_PRIVATE_KEY;
  delete process.env.GITHUB_PRIVATE_KEY_PATH;
  try {
    assert.equal(loadGithubAppCredentials(), null);
  } finally {
    process.env = saved;
  }
});
