import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { sign } from "../src/lib/signature.js";
import { InMemoryDeliveryStore } from "../src/lib/deliveryStore.js";

const SECRET = "test-secret";

function createApp() {
  return buildApp({ githubWebhookSecret: SECRET }, { logger: false });
}

function postWebhook(
  app: ReturnType<typeof buildApp>,
  body: string,
  headers: Record<string, string> = {},
  secret: string = SECRET,
) {
  return app.inject({
    method: "POST",
    url: "/webhooks/github",
    headers: {
      "content-type": "application/json",
      "x-github-event": "workflow_run",
      "x-github-delivery": "delivery-1",
      "x-hub-signature-256": `sha256=${sign(Buffer.from(body, "utf8"), secret)}`,
      ...headers,
    },
    payload: body,
  });
}

test("accepts a valid, signed webhook with 202", async () => {
  const app = createApp();
  const res = await postWebhook(
    app,
    JSON.stringify({ action: "completed", repository: { full_name: "acme/repo" } }),
  );
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.json(), { status: "accepted" });
  await app.close();
});

test("rejects a forged webhook with 401", async () => {
  const app = createApp();
  const res = await postWebhook(
    app,
    JSON.stringify({ action: "completed" }),
    {},
    "wrong-secret",
  );
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: "invalid_signature" });
  await app.close();
});

test("rejects a request with no signature header with 401", async () => {
  const app = createApp();
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/github",
    headers: {
      "content-type": "application/json",
      "x-github-event": "workflow_run",
      "x-github-delivery": "delivery-1",
    },
    payload: JSON.stringify({ action: "completed" }),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("returns 401 when the body is tampered after signing", async () => {
  const app = createApp();
  const original = JSON.stringify({ action: "completed" });
  const signed = `sha256=${sign(Buffer.from(original, "utf8"), SECRET)}`;

  const res = await app.inject({
    method: "POST",
    url: "/webhooks/github",
    headers: {
      "content-type": "application/json",
      "x-github-event": "workflow_run",
      "x-github-delivery": "delivery-1",
      "x-hub-signature-256": signed,
    },
    payload: JSON.stringify({ action: "failed" }),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("ignores a duplicate delivery with 200 and does not reprocess", async () => {
  const app = createApp();
  const body = JSON.stringify({ action: "completed", repository: { full_name: "acme/repo" } });

  const first = await postWebhook(app, body);
  assert.equal(first.statusCode, 202);

  const second = await postWebhook(app, body);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json(), { status: "duplicate" });

  await app.close();
});

test("rejects a delivery missing the delivery id header with 400", async () => {
  const app = createApp();
  const body = JSON.stringify({ action: "completed" });
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/github",
    headers: {
      "content-type": "application/json",
      "x-github-event": "workflow_run",
      "x-hub-signature-256": `sha256=${sign(Buffer.from(body, "utf8"), SECRET)}`,
    },
    payload: body,
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "missing_delivery_id" });
  await app.close();
});

test("in-memory delivery store records each id once", async () => {
  const store = new InMemoryDeliveryStore();
  const entry = { deliveryId: "a", event: "workflow_run", payload: {} };
  assert.deepEqual(await store.record(entry), { accepted: true });
  assert.deepEqual(await store.record(entry), { accepted: false });
  assert.deepEqual(
    await store.record({ ...entry, deliveryId: "b" }),
    { accepted: true },
  );
});
