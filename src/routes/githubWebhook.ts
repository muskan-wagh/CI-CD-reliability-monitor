import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { verifyGithubSignature } from "../lib/signature.js";
import type { DeliveryStore } from "../lib/deliveryStore.js";
import type { WebhookProcessor } from "../lib/processWebhook.js";

export interface GithubWebhookOptions {
  secret: string;
  deliveryStore: DeliveryStore;
  processor: WebhookProcessor;
}

function headerValue(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Receives GitHub webhook deliveries.
 *
 * Registered in its own plugin scope with a raw-body content type parser
 * (`parseAs: 'buffer'`) so the HMAC can be verified against the exact bytes
 * GitHub sent. It verifies, dedupes by delivery id, and acks in milliseconds;
 * actual processing is handed off to the injected processor and never awaited.
 */
const githubWebhookPlugin: FastifyPluginAsync<GithubWebhookOptions> = async (
  app,
  options,
) => {
  const { secret, deliveryStore, processor } = options;

  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post("/webhooks/github", async (request, reply) => {
    const rawBody = request.body as unknown as Buffer;

    const signature = headerValue(request, "x-hub-signature-256");
    if (!verifyGithubSignature(rawBody, signature, secret)) {
      request.log.warn("webhook rejected: invalid signature");
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const deliveryId = headerValue(request, "x-github-delivery");
    if (!deliveryId) {
      request.log.warn("webhook missing X-GitHub-Delivery header");
      return reply.code(400).send({ error: "missing_delivery_id" });
    }

    const event = headerValue(request, "x-github-event") ?? "unknown";

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      request.log.warn(
        { deliveryId, event },
        "webhook payload is not valid JSON",
      );
      return reply.code(400).send({ error: "invalid_json" });
    }

    const { accepted } = await deliveryStore.record({ deliveryId, event, payload });
    if (!accepted) {
      request.log.info(
        { deliveryId, event },
        "duplicate webhook delivery ignored",
      );
      return reply.code(200).send({ status: "duplicate" });
    }

    processor({ deliveryId, event, payload }, request.log).catch((err) => {
      request.log.error(
        { err, deliveryId, event },
        "webhook processing failed",
      );
    });

    request.log.info({ deliveryId, event }, "webhook accepted");
    return reply.code(202).send({ status: "accepted" });
  });
};

export default githubWebhookPlugin;
