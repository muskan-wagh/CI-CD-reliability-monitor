import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { IngestInput, IngestSummary } from "../lib/ingest.js";

export interface IngestOptions {
  apiKey: string;
  processIngest: (input: IngestInput) => Promise<IngestSummary>;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return fallback;
  }
  return value;
}

/**
 * Receives JUnit XML test reports from the flakyguard-action step.
 * Auth is a shared API key for now; per-installation key hashing arrives with
 * the dashboard phase.
 */
const ingestPlugin: FastifyPluginAsync<IngestOptions> = async (app, options) => {
  app.post("/v1/ingest", async (request, reply) => {
    const auth = request.headers.authorization;
    const expected = `Bearer ${options.apiKey}`;
    if (!auth || !safeEqual(auth, expected)) {
      return reply.code(401).send({ error: "invalid_api_key" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;

    const reportXml = body.report;
    if (typeof reportXml !== "string" || reportXml.trim().length === 0) {
      return reply.code(422).send({ error: "invalid_report", detail: "missing report" });
    }

    const repositoryFullName = body.repository;
    if (typeof repositoryFullName !== "string" || repositoryFullName.length === 0) {
      return reply
        .code(422)
        .send({ error: "invalid_report", detail: "missing repository" });
    }

    const githubRunId = parsePositiveInt(body.github_run_id, 0);
    if (githubRunId === 0) {
      return reply
        .code(422)
        .send({ error: "invalid_report", detail: "missing github_run_id" });
    }

    const input: IngestInput = {
      repositoryFullName,
      githubRepoId:
        typeof body.github_repo_id === "number" ? body.github_repo_id : null,
      githubRunId,
      runAttempt: parsePositiveInt(body.run_attempt, 1),
      headSha: typeof body.head_sha === "string" ? body.head_sha : "",
      headBranch: typeof body.head_branch === "string" ? body.head_branch : null,
      jobName: typeof body.job_name === "string" ? body.job_name : undefined,
      executedAt: typeof body.executed_at === "string" ? body.executed_at : undefined,
      reportXml,
    };

    const summary = await options.processIngest(input);

    return reply.code(202).send({
      status: "accepted",
      ...summary,
    });
  });
};

export default ingestPlugin;
