import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPool } from "./pool.js";

/**
 * Minimal forward-only migration runner.
 *
 * Applies `src/db/migrations/*.sql` in lexicographic order, tracking applied
 * files in a `schema_migrations` table. Each migration runs in its own
 * transaction. Never edit an applied migration — add a new file instead.
 */
export async function migrate(databaseUrl: string): Promise<string[]> {
  const pool = createPool(databaseUrl);
  const applied: string[] = [];

  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version    TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);

      const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
      const files = (await readdir(dir))
        .filter((f) => f.endsWith(".sql"))
        .sort();

      for (const version of files) {
        const { rowCount } = await client.query(
          "SELECT 1 FROM schema_migrations WHERE version = $1",
          [version],
        );
        if (rowCount && rowCount > 0) {
          continue;
        }

        const sql = await readFile(join(dir, version), "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(
            "INSERT INTO schema_migrations (version) VALUES ($1)",
            [version],
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
        applied.push(version);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  return applied;
}
