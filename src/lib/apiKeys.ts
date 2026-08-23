import { createHash, randomBytes } from "node:crypto";
import type { Queryable } from "./store.js";

/**
 * Per-installation ingest API keys.
 *
 * A key is minted per GitHub App installation (not per user or globally), so
 * the ingest endpoint can resolve the caller's tenant (`installation_id`) from
 * the key alone. Only the SHA-256 hash is stored — the plaintext is returned
 * exactly once at issue/rotate time and never persisted or logged.
 */

export function generateApiKey(): string {
  return randomBytes(32).toString("hex");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Rotate + return a fresh key for an installation: revoke any active key, then
 * insert the new one. The returned plaintext is the only time it is visible.
 */
export async function issueApiKey(
  db: Queryable,
  installationId: number,
  label = "default",
): Promise<string> {
  const key = generateApiKey();
  const hash = hashApiKey(key);

  await db.query(
    `UPDATE api_keys SET revoked_at = now() WHERE installation_id = $1 AND revoked_at IS NULL`,
    [installationId],
  );
  await db.query(
    `INSERT INTO api_keys (installation_id, key_hash, label) VALUES ($1, $2, $3)`,
    [installationId, hash, label],
  );

  return key;
}

/**
 * Resolve an installation id from a raw key. Returns null when the key is
 * unknown or revoked. `installation_id` is a BIGINT, so it may arrive as a
 * string from pg — coerce to number for callers.
 */
export async function verifyApiKey(
  db: Queryable,
  rawKey: string,
): Promise<number | null> {
  if (!rawKey) return null;
  const hash = hashApiKey(rawKey);
  const result = await db.query<{ installation_id: string | number }>(
    `SELECT installation_id FROM api_keys
     WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hash],
  );
  const id = result.rows[0]?.installation_id;
  const n = typeof id === "number" ? id : id === undefined ? null : Number(id);
  return n === null || !Number.isInteger(n) ? null : n;
}

/** Revoke all active keys for an installation (e.g. on app uninstall). */
export async function revokeApiKeys(
  db: Queryable,
  installationId: number,
): Promise<void> {
  await db.query(
    `UPDATE api_keys SET revoked_at = now() WHERE installation_id = $1 AND revoked_at IS NULL`,
    [installationId],
  );
}
