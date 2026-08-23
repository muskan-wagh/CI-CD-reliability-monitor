import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless dashboard session tokens.
 *
 * The Next.js frontend owns GitHub OAuth and, after verifying the user, mints
 * a token signed with the shared SESSION_SECRET. The API independently verifies
 * that signature on every `/api/*` request — it never trusts the client to
 * supply its own installation ids.
 *
 * Token format: `base64url(json).hex(hmac_sha256(secret, base64url(json)))`.
 * The signed payload carries the caller's installations and an `exp` timestamp.
 */

export interface SessionPayload {
  /** GitHub user id (numeric string from the API). */
  sub: string;
  /** GitHub login, informational only. */
  login: string;
  /** Installation ids this user may access (their tenant scope). */
  installations: number[];
  /** Expiry, unix seconds. */
  exp: number;
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function signSessionToken(
  payload: Omit<SessionPayload, "exp">,
  secret: string,
  ttlSeconds: number,
): string {
  const body: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = base64url(JSON.stringify(body));
  return `${encoded}.${hmacHex(secret, encoded)}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!signature || !safeEqualHex(hmacHex(secret, encoded), signature)) {
    return null;
  }

  let body: SessionPayload;
  try {
    body = JSON.parse(fromBase64url(encoded)) as SessionPayload;
  } catch {
    return null;
  }

  if (
    typeof body.exp !== "number" ||
    body.exp < Math.floor(Date.now() / 1000) ||
    !Array.isArray(body.installations) ||
    typeof body.sub !== "string"
  ) {
    return null;
  }

  return body;
}
