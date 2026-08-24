import { createClerkClient, verifyToken } from "@clerk/backend";

/**
 * Clerk-backed authentication for the dashboard API.
 *
 * The Next.js frontend forwards the caller's Clerk session JWT as a Bearer
 * token. This module verifies that signature against Clerk's JWKS and then
 * resolves the caller's tenant scope (installation ids) from the Clerk user's
 * metadata — so tenant scope is always decided server-side, never by the
 * client.
 *
 * Tenant mapping lives on the Clerk user under `echoInstallations`
 * (checked in privateMetadata, then publicMetadata). Manage it with
 * `npm run clerk:grant -- --email you@example.com --installations 123,456`.
 */

export interface AuthContext {
  /** Verified Clerk user id. */
  userId: string;
  /** Installation ids this caller may access (their tenant scope). */
  installations: number[];
}

/** Pluggable bearer-token verifier; implemented by Clerk in production. */
export interface TokenVerifier {
  verify(bearer: string): Promise<AuthContext | null>;
}

const METADATA_KEY = "echoInstallations";
const USER_CACHE_TTL_MS = 60_000;

function extractInstallations(user: {
  privateMetadata: Record<string, unknown>;
  publicMetadata: Record<string, unknown>;
}): number[] {
  for (const source of [user.privateMetadata, user.publicMetadata]) {
    const raw = source[METADATA_KEY];
    if (!Array.isArray(raw)) continue;
    const ids = raw
      .map((v) => (typeof v === "string" ? Number(v) : v))
      .filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0);
    if (ids.length > 0) return ids;
  }
  return [];
}

export function createClerkVerifier(secretKey: string): TokenVerifier {
  const client = createClerkClient({ secretKey });
  const cache = new Map<string, { installations: number[]; expiresAt: number }>();

  return {
    async verify(bearer) {
      let payload;
      try {
        payload = await verifyToken(bearer, { secretKey });
      } catch {
        return null;
      }
      if (!payload?.sub) return null;
      const userId = payload.sub as string;

      const cached = cache.get(userId);
      if (cached && cached.expiresAt > Date.now()) {
        return { userId, installations: cached.installations };
      }

      try {
        const user = await client.users.getUser(userId);
        const installations = extractInstallations(user);
        cache.set(userId, { installations, expiresAt: Date.now() + USER_CACHE_TTL_MS });
        return { userId, installations };
      } catch (err) {
        if ((err as { status?: number }).status === 404) {
          // Valid token for a deleted user: fail closed.
          return null;
        }
        throw err;
      }
    },
  };
}
