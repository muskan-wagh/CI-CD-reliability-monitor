import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signSessionToken,
  verifySessionToken,
} from "../src/lib/session.js";

const SECRET = "test-secret";
const payload = { sub: "12345", login: "alice", installations: [1, 2, 3] };

test("sign + verify round-trips", () => {
  const token = signSessionToken(payload, SECRET, 3600);
  const session = verifySessionToken(token, SECRET);
  assert.ok(session);
  assert.equal(session.sub, "12345");
  assert.equal(session.login, "alice");
  assert.deepEqual(session.installations, [1, 2, 3]);
});

test("verify rejects a tampered token", () => {
  const token = signSessionToken(payload, SECRET, 3600);
  assert.equal(verifySessionToken(`${token}x`, SECRET), null);
  const dot = token.lastIndexOf(".");
  assert.equal(
    verifySessionToken(token.slice(0, dot) + ".deadbeef", SECRET),
    null,
  );
});

test("verify rejects a token signed with the wrong secret", () => {
  const token = signSessionToken(payload, SECRET, 3600);
  assert.equal(verifySessionToken(token, "other-secret"), null);
});

test("verify rejects an expired token", () => {
  const token = signSessionToken(payload, SECRET, -1);
  assert.equal(verifySessionToken(token, SECRET), null);
});

test("verify rejects malformed input", () => {
  assert.equal(verifySessionToken("", SECRET), null);
  assert.equal(verifySessionToken("no-dot", SECRET), null);
  assert.equal(verifySessionToken("a.b", SECRET), null);
});
