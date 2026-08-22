import { Pool } from "pg";

function sslFor(url: string): { rejectUnauthorized: boolean } | undefined {
  try {
    const host = new URL(url).hostname;
    if (host.includes("supabase.co")) {
      return { rejectUnauthorized: false };
    }
  } catch {
    // fall through to no SSL
  }
  return undefined;
}

/**
 * Shared Postgres connection pool. Uses the standard DATABASE_URL.
 * Supabase hosts require SSL; we enable it automatically for `*.supabase.co`.
 */
export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    ssl: sslFor(databaseUrl),
    max: 10,
    connectionTimeoutMillis: 10_000,
  });
}
