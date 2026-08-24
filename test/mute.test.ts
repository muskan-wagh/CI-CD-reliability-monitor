import { test } from "node:test";
import assert from "node:assert/strict";
import { isActiveMute } from "../src/lib/mutes.js";

test("active when never lifted and no expiry", () => {
  assert.equal(isActiveMute({ expires_at: null, lifted_at: null }), true);
});

test("inactive once lifted", () => {
  assert.equal(isActiveMute({ expires_at: null, lifted_at: "2026-01-01" }), false);
});

test("expires after expiry timestamp", () => {
  const now = new Date("2026-08-24T12:00:00Z");
  assert.equal(isActiveMute({ expires_at: "2026-08-24T11:00:00Z", lifted_at: null }, now), false);
  assert.equal(isActiveMute({ expires_at: "2026-08-24T13:00:00Z", lifted_at: null }, now), true);
});
