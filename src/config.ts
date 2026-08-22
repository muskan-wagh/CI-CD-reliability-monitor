import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Minimum config needed to build the HTTP app (unit-test friendly). */
export interface AppConfig {
  githubWebhookSecret: string;
}

/** Full runtime config loaded from the environment. */
export interface Config extends AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  ingestApiKey: string;
}

function loadEnvFile(): void {
  try {
    const envPath = resolve(process.cwd(), ".env");
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  } catch {
    // Missing/unreadable .env is non-fatal; real misconfig is caught below.
  }
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name] ?? "";
  if (!value) {
    throw new Error(`${name} is required. Set it in .env or the environment.`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  loadEnvFile();

  const githubWebhookSecret = requireEnv(env, "GITHUB_WEBHOOK_SECRET");
  const databaseUrl = requireEnv(env, "DATABASE_URL");
  const ingestApiKey = requireEnv(env, "INGEST_API_KEY");

  const rawPort = env.PORT ?? "3000";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const host = env.HOST ?? "0.0.0.0";

  return { githubWebhookSecret, port, host, databaseUrl, ingestApiKey };
}
