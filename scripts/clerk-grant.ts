#!/usr/bin/env node
/**
 * Map a Clerk user to Echo tenants (GitHub App installations).
 *
 * The dashboard API derives the caller's tenant scope from the Clerk user's
 * metadata key `echoInstallations`. This CLI is the admin tool that
 * maintains it.
 *
 * Usage (requires CLERK_SECRET_KEY and DATABASE_URL in .env):
 *   npm run clerk:grant -- --list
 *   npm run clerk:grant -- --show --email you@example.com
 *   npm run clerk:grant -- --email you@example.com --installations 123,456
 *   npm run clerk:grant -- --email you@example.com --all
 *   npm run clerk:grant -- --email you@example.com --revoke
 */
import { createClerkClient } from "@clerk/backend";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";

const METADATA_KEY = "echoInstallations";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(name);

const config = loadConfig();
if (!config.clerkSecretKey) {
  console.error("CLERK_SECRET_KEY is required in .env for this command.");
  process.exit(1);
}

const clerk = createClerkClient({ secretKey: config.clerkSecretKey });
const pool = createPool(config.databaseUrl);

async function findUser(email: string) {
  const { data } = await clerk.users.getUserList({ emailAddress: [email] });
  if (data.length === 0) {
    console.error(`No Clerk user found for ${email}`);
    process.exit(1);
  }
  return data[0]!;
}

async function listInstallations() {
  const result = await pool.query(
    `SELECT installation_id, COUNT(DISTINCT r.id)::int AS repos,
            MIN(r.full_name) AS example_repo
     FROM repositories r WHERE installation_id IS NOT NULL
     GROUP BY installation_id ORDER BY installation_id`,
  );
  if (result.rows.length === 0) {
    console.log("No installations recorded yet.");
    return [];
  }
  console.table(
    result.rows.map((r) => ({
      installation_id: Number(r.installation_id),
      repositories: r.repos,
      example_repo: r.example_repo,
    })),
  );
  return result.rows.map((r) => Number(r.installation_id));
}

async function main() {
  try {
    if (hasFlag("--list")) {
      await listInstallations();
      return;
    }

    const email = arg("--email");
    if (!email) {
      console.log(
        [
          "Usage:",
          "  clerk-grant --list",
          "  clerk-grant --email <address> --show",
          "  clerk-grant --email <address> --installations <id,id,...>",
          "  clerk-grant --email <address> --all",
          "  clerk-grant --email <address> --revoke",
        ].join("\n"),
      );
      return;
    }

    const user = await findUser(email);
    const meta = { ...(user.privateMetadata ?? {}) };

    if (hasFlag("--show")) {
      console.log(`${user.id} ${user.primaryEmailAddress?.emailAddress ?? email}`);
      console.log(`${METADATA_KEY}:`, meta[METADATA_KEY] ?? "(none)");
      return;
    }

    let ids: number[];
    if (hasFlag("--all")) {
      const result = await pool.query(
        `SELECT DISTINCT installation_id FROM repositories WHERE installation_id IS NOT NULL`,
      );
      ids = result.rows.map((r) => Number(r.installation_id));
    } else if (hasFlag("--revoke")) {
      ids = [];
    } else {
      const raw = arg("--installations");
      if (!raw) {
        console.error("Provide --installations <ids>, --all, or --revoke.");
        process.exit(1);
      }
      ids = raw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    }

    meta[METADATA_KEY] = ids;
    await clerk.users.updateUser(user.id, { privateMetadata: meta });
    console.log(
      `${email} (${user.id}) -> ${METADATA_KEY}: [${ids.join(", ") || "none"}]`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
