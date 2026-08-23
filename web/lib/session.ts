import { createHmac } from "node:crypto";

/**
 * Frontend-side session token minting.
 *
 * Mirrors the backend's token format exactly (see src/lib/session.ts):
 *   `base64url(json).hex(hmac_sha256(secret, base64url(json)))`.
 * The API independently verifies this signature — the frontend never authorizes
 * itself by passing raw installation ids it can be tricked into supplying.
 */

export interface SessionPayload {
  sub: string;
  login: string;
  installations: number[];
}

export const SESSION_COOKIE = "flakyguard_session";

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function signSessionToken(
  payload: SessionPayload,
  secret: string,
  ttlSeconds: number,
): string {
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = base64url(JSON.stringify(body));
  const sig = createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}
