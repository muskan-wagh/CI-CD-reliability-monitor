import type { FastifyPluginAsync } from "fastify";
import {
  CrossTenantIngestError,
  type IngestInput,
  type IngestSummary,
} from "../lib/ingest.js";

export interface IngestOptions {
  /** Resolve an installation id from a raw API key (null = invalid/revoked). */
  verifyKey: (rawKey: string) => Promise<number | null>;
  processIngest: (input: IngestInput) => Promise<IngestSummary>;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return fallback;
  }
  return value;
}

function bearerToken(auth: string | undefined): string {
  if (!auth) return "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m?.[1] ?? "";
}

/**
 * Receives JUnit XML test reports from the upload action step.
 *
 * Auth is a per-installation API key: the key resolves the caller's
 * installation, which both authorizes the request and scopes which
 * repositories it may write (see CrossTenantIngestError).
 */
const ingestPlugin: FastifyPluginAsync<IngestOptions> = async (app, options) => {
  app.post("/v1/ingest", async (request, reply) => {
    const rawKey = bearerToken(request.headers.authorization);
    const installationId = await options.verifyKey(rawKey);
    if (installationId === null) {
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
      workflowName: typeof body.workflow_name === "string" ? body.workflow_name : null,
      installationId,
      reportXml,
    };

    try {
      const summary = await options.processIngest(input);
      return reply.code(202).send({ status: "accepted", ...summary });
    } catch (err) {
      if (err instanceof CrossTenantIngestError) {
        return reply.code(403).send({ error: "cross_tenant_ingest", detail: err.message });
      }
      throw err;
    }
  });
};

export default ingestPlugin;
