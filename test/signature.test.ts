import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyGithubSignature, sign } from "../src/lib/signature.js";

const SECRET = "test-secret";
const BODY = Buffer.from('{"action":"completed"}', "utf8");

test("verifies a valid signature", () => {
  const header = `sha256=${sign(BODY, SECRET)}`;
  assert.equal(verifyGithubSignature(BODY, header, SECRET), true);
});

test("rejects a tampered body", () => {
  const header = `sha256=${sign(BODY, SECRET)}`;
  const tampered = Buffer.from('{"action":"failed"}', "utf8");
  assert.equal(verifyGithubSignature(tampered, header, SECRET), false);
});

test("rejects a signature computed with the wrong secret", () => {
  const header = `sha256=${sign(BODY, "other-secret")}`;
  assert.equal(verifyGithubSignature(BODY, header, SECRET), false);
});

test("rejects a missing signature header", () => {
  assert.equal(verifyGithubSignature(BODY, undefined, SECRET), false);
});

test("rejects a malformed signature header", () => {
  assert.equal(verifyGithubSignature(BODY, "not-a-valid-prefix", SECRET), false);
  assert.equal(verifyGithubSignature(BODY, "", SECRET), false);
});

test("sign returns a lowercase hex digest", () => {
  const digest = sign(BODY, SECRET);
  assert.match(digest, /^[0-9a-f]{64}$/);
});
