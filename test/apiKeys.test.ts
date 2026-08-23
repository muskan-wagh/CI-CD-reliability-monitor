import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateApiKey,
  hashApiKey,
  issueApiKey,
  verifyApiKey,
  revokeApiKeys,
} from "../src/lib/apiKeys.js";
import type { Queryable } from "../src/lib/store.js";

interface KeyRow {
  installation_id: number;
  key_hash: string;
  label: string;
  revoked_at: Date | null;
}

/** Minimal in-memory stand-in for the api_keys table. */
function fakeKeysDb(rows: KeyRow[] = []) {
  const query = async (sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> => {
    if (sql.includes("INSERT INTO api_keys")) {
      const [installation_id, key_hash, label] = params as [number, string, string];
      rows.push({ installation_id, key_hash, label, revoked_at: null });
      return { rows: [] };
    }
    if (sql.includes("UPDATE api_keys")) {
      const installationId = params[0] as number;
      for (const r of rows) {
        if (r.installation_id === installationId && r.revoked_at === null) {
          r.revoked_at = new Date();
        }
      }
      return { rows: [] };
    }
    if (sql.includes("SELECT installation_id FROM api_keys")) {
      const keyHash = params[0] as string;
      return {
        rows: rows
          .filter((r) => r.key_hash === keyHash && r.revoked_at === null)
          .map((r) => ({ installation_id: r.installation_id })),
      };
    }
    return { rows: [] };
  };
  const db = { query } as unknown as Queryable;
  return { db, rows };
}

test("generateApiKey returns a 64-char hex key", () => {
  assert.match(generateApiKey(), /^[0-9a-f]{64}$/);
});

test("hashApiKey is a deterministic SHA-256 hex digest", () => {
  assert.equal(hashApiKey("abc"), hashApiKey("abc"));
  assert.equal(hashApiKey("abc").length, 64);
  assert.notEqual(hashApiKey("abc"), hashApiKey("abd"));
});

test("issueApiKey stores the hash, never the plaintext", async () => {
  const { db, rows } = fakeKeysDb();
  const key = await issueApiKey(db, 42);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.key_hash, hashApiKey(key));
  assert.notEqual(rows[0]!.key_hash, key);
});

test("verifyApiKey resolves the installation for a valid key", async () => {
  const { db } = fakeKeysDb();
  const key = await issueApiKey(db, 42);
  assert.equal(await verifyApiKey(db, key), 42);
  assert.equal(await verifyApiKey(db, "wrong"), null);
});

test("issueApiKey rotates: the old key is revoked", async () => {
  const { db } = fakeKeysDb();
  const first = await issueApiKey(db, 42);
  const second = await issueApiKey(db, 42);
  assert.equal(await verifyApiKey(db, first), null);
  assert.equal(await verifyApiKey(db, second), 42);
});

test("revokeApiKeys invalidates all active keys", async () => {
  const { db } = fakeKeysDb();
  const key = await issueApiKey(db, 7);
  await revokeApiKeys(db, 7);
  assert.equal(await verifyApiKey(db, key), null);
});
