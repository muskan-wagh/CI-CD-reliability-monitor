import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { PostgresDeliveryStore } from "./db/postgresDeliveryStore.js";
import { createWebhookProcessor } from "./lib/processWebhook.js";
import { processIngest } from "./lib/ingest.js";
import { verifyApiKey } from "./lib/apiKeys.js";

const config = loadConfig();

const applied = await migrate(config.databaseUrl);
if (applied.length > 0) {
  console.log(`Applied migrations: ${applied.join(", ")}`);
}

const pool = createPool(config.databaseUrl);

const app = buildApp(
  { githubWebhookSecret: config.githubWebhookSecret },
  {
    deliveryStore: new PostgresDeliveryStore(pool),
    processor: createWebhookProcessor(pool),
    ingest: {
      verifyKey: (rawKey) => verifyApiKey(pool, rawKey),
      processIngest: (input) => processIngest(pool, input),
    },
    api: { pool, sessionSecret: config.sessionSecret },
  },
);

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
