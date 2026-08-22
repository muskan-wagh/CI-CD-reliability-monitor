import Fastify, { type FastifyInstance } from "fastify";
import githubWebhookPlugin from "./routes/githubWebhook.js";
import ingestPlugin, { type IngestOptions } from "./routes/ingest.js";
import apiPlugin, { type ApiOptions } from "./routes/api.js";
import {
  InMemoryDeliveryStore,
  type DeliveryStore,
} from "./lib/deliveryStore.js";
import {
  logOnlyProcessor,
  type WebhookProcessor,
} from "./lib/processWebhook.js";
import type { AppConfig } from "./config.js";

export interface BuildAppOptions {
  logger?: boolean;
  deliveryStore?: DeliveryStore;
  processor?: WebhookProcessor;
  /** Pass to enable the /v1/ingest route (requires a DB-backed processor). */
  ingest?: IngestOptions | null;
  /** Pass to enable the read-only /api/* dashboard routes (requires a pool). */
  api?: ApiOptions | null;
}

export function buildApp(
  config: AppConfig,
  options: BuildAppOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });

  app.get("/", async () => ({ message: "FlakyGuard is running" }));

  app.get("/healthz", async () => ({ status: "ok" }));

  const deliveryStore = options.deliveryStore ?? new InMemoryDeliveryStore();
  const processor = options.processor ?? logOnlyProcessor;

  app.register(githubWebhookPlugin, {
    secret: config.githubWebhookSecret,
    deliveryStore,
    processor,
  });

  if (options.ingest) {
    app.register(ingestPlugin, options.ingest);
  }

  if (options.api) {
    app.register(apiPlugin, options.api);
  }

  return app;
}
