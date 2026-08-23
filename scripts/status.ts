#!/usr/bin/env node
/**
 * Development-only status tool. Prints row counts and the dashboard summary
 * so you can verify at a glance that FlakyGuard is receiving real data.
 *
 * Usage: npm run db:status
 */
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);

try {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM installations)   AS installations,
      (SELECT COUNT(*)::int FROM repositories)    AS repositories,
      (SELECT COUNT(*)::int FROM workflow_runs)   AS workflow_runs,
      (SELECT COUNT(*)::int FROM tests)           AS tests,
      (SELECT COUNT(*)::int FROM test_results)    AS test_results,
      (SELECT COUNT(*)::int FROM flake_scores)    AS flake_scores,
      (SELECT COUNT(*)::int FROM flake_scores WHERE category IN ('flaky','critical')) AS flaky_tests,
      (SELECT COUNT(*)::int FROM failure_signatures) AS failure_signatures,
      (SELECT COUNT(*)::int FROM webhook_deliveries)  AS webhook_deliveries
  `);
  console.log("FlakyGuard database status");
  console.log("--------------------------");
  for (const [k, v] of Object.entries(result.rows[0])) {
    console.log(`  ${k.padEnd(22)} ${v}`);
  }

  const repos = await pool.query(
    `SELECT full_name, created_at FROM repositories ORDER BY full_name`,
  );
  console.log("\nRepositories:");
  for (const r of repos.rows) console.log(`  - ${r.full_name}`);
} finally {
  await pool.end();
}
