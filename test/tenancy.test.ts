import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { signSessionToken } from "../src/lib/session.js";
import { CrossTenantIngestError } from "../src/lib/ingest.js";

const SECRET = "test-secret";

function fakePool(calls: { sql: string; params?: unknown[] }[] = []) {
  return {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes("SELECT 1")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("AS total_tests")) return { rows: [{}] };
      return { rows: [] };
    },
  } as unknown as Pool;
}

function token(installations: number[]) {
  return signSessionToken(
    { sub: "123", login: "alice", installations },
    SECRET,
    3600,
  );
}

test("dashboard requires a session token when auth is enabled", async () => {
  const app = buildApp(
    { githubWebhookSecret: "x" },
    { api: { pool: fakePool(), sessionSecret: SECRET }, logger: false },
  );
  const res = await app.inject({ method: "GET", url: "/api/dashboard" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("dashboard rejects a tampered token", async () => {
  const good = token([5]);
  const tampered = good.slice(0, -2) + "zz";
  const app = buildApp(
    { githubWebhookSecret: "x" },
    { api: { pool: fakePool(), sessionSecret: SECRET }, logger: false },
  );
  const res = await app.inject({
    method: "GET",
    url: "/api/dashboard",
    headers: { authorization: `Bearer ${tampered}` },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("dashboard scopes its queries to the caller's installations", async () => {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const app = buildApp(
    { githubWebhookSecret: "x" },
    { api: { pool: fakePool(calls), sessionSecret: SECRET }, logger: false },
  );
  const res = await app.inject({
    method: "GET",
    url: "/api/dashboard",
    headers: { authorization: `Bearer ${token([5, 7])}` },
  });
  assert.equal(res.statusCode, 200);
  const statsCall = calls.find((c) => c.sql.includes("AS total_tests"));
  assert.ok(statsCall, "stats query was issued");
  assert.deepEqual(statsCall.params?.[0], [5, 7]);
  await app.close();
});

test("dashboard is open in dev mode (no session secret)", async () => {
  const app = buildApp(
    { githubWebhookSecret: "x" },
    { api: { pool: fakePool() }, logger: false },
  );
  const res = await app.inject({ method: "GET", url: "/api/dashboard" });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("test history 404s when it belongs to another installation", async () => {
  const otherPool = {
    async query() {
      return {
        rows: [
          {
            id: "1",
            name: "t",
            file_path: "f",
            suite_path: "",
            repository_id: "1",
            repository_full_name: "a/b",
            installation_id: "99",
          },
        ],
      };
    },
  } as unknown as Pool;

  const app = buildApp(
    { githubWebhookSecret: "x" },
    { api: { pool: otherPool, sessionSecret: SECRET }, logger: false },
  );
  const res = await app.inject({
    method: "GET",
    url: "/api/tests/1/history",
    headers: { authorization: `Bearer ${token([5])}` },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("ingest rejects an invalid API key", async () => {
  const app = buildApp(
    { githubWebhookSecret: "x" },
    {
      ingest: {
        verifyKey: async () => null,
        processIngest: async () => ({ testsReceived: 0, passed: 0, failed: 0, skipped: 0 }),
      },
      logger: false,
    },
  );
  const res = await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { "content-type": "application/json", authorization: "Bearer bad" },
    payload: JSON.stringify({ report: "<x/>", repository: "a/b", github_run_id: 1 }),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("ingest returns 403 on a cross-tenant ingest", async () => {
  const app = buildApp(
    { githubWebhookSecret: "x" },
    {
      ingest: {
        verifyKey: async () => 5,
        processIngest: async () => {
          throw new CrossTenantIngestError("a/b");
        },
      },
      logger: false,
    },
  );
  const res = await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { "content-type": "application/json", authorization: "Bearer ok" },
    payload: JSON.stringify({ report: "<x/>", repository: "a/b", github_run_id: 1 }),
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});
