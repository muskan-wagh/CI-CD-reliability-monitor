import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import { issueApiKey, revokeApiKeys } from "./apiKeys.js";
import { correlateRun } from "./prCorrelation.js";
import { upsertRepository, upsertWorkflowRun } from "./store.js";

export interface WebhookEnvelope {
  deliveryId: string;
  event: string;
  payload: unknown;
}

export type WebhookProcessor = (
  envelope: WebhookEnvelope,
  logger: FastifyBaseLogger,
) => Promise<void>;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null
    ? (value as JsonRecord)
    : {};
}

async function handleInstallation(
  db: Pool,
  payload: JsonRecord,
  logger: FastifyBaseLogger,
): Promise<void> {
  const installation = asRecord(payload.installation);
  const id = installation.id;
  if (typeof id !== "number") return;

  const account = asRecord(installation.account);
  const action = payload.action;

  if (action === "created") {
    await db.query(
      `INSERT INTO installations (id, account_login, account_type, status, installed_at)
       VALUES ($1, $2, $3, 'active', now())
       ON CONFLICT (id) DO UPDATE SET
         account_login = EXCLUDED.account_login,
         account_type  = EXCLUDED.account_type,
         status        = 'active',
         installed_at  = now(),
         removed_at    = NULL`,
      [id, account.login ?? "", account.type ?? "User"],
    );

    const repositories = Array.isArray(payload.repositories)
      ? (payload.repositories as unknown[])
      : [];
    for (const repo of repositories) {
      const r = asRecord(repo);
      if (typeof r.full_name !== "string") continue;
      await upsertRepository(db, {
        githubRepoId: typeof r.id === "number" ? r.id : null,
        fullName: r.full_name,
        installationId: id,
      });
    }

    // Mint the installation's ingest API key (plaintext visible only here; the
    // dashboard reveals/rotates it later). Hash is what we persist.
    await issueApiKey(db, id);
    logger.info({ installationId: id }, "installation created");
  } else if (action === "deleted") {
    await db.query(
      `UPDATE installations SET status = 'removed', removed_at = now() WHERE id = $1`,
      [id],
    );
    await revokeApiKeys(db, id);
    logger.info({ installationId: id }, "installation removed");
  }
}

async function handleWorkflowRun(
  db: Pool,
  payload: JsonRecord,
  logger: FastifyBaseLogger,
): Promise<void> {
  const run = asRecord(payload.workflow_run);
  if (payload.action !== "completed") return;

  if (typeof run.id !== "number") return;

  const repo = asRecord(run.repository);
  if (typeof repo.full_name !== "string") return;

  const installation = asRecord(payload.installation);
  const installationId = typeof installation.id === "number" ? installation.id : null;

  // Events can arrive out of order (workflow_run before installation.created),
  // so ensure a placeholder installation exists before linking the repo to it.
  if (installationId !== null) {
    await db.query(
      `INSERT INTO installations (id, account_login, account_type, status)
       VALUES ($1, '', 'Organization', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [installationId],
    );
  }

  console.log(`[WEBHOOK] workflow_run.completed received (run #${run.id}, ${repo.full_name})`);

  const repositoryId = await upsertRepository(db, {
    githubRepoId: typeof repo.id === "number" ? repo.id : null,
    fullName: repo.full_name,
    installationId,
  });

  await upsertWorkflowRun(db, {
    repositoryId,
    githubRunId: run.id,
    runAttempt: typeof run.run_attempt === "number" ? run.run_attempt : 1,
    headSha: typeof run.head_sha === "string" ? run.head_sha : "",
    headBranch: typeof run.head_branch === "string" ? run.head_branch : null,
    triggerEvent: typeof run.event === "string" ? run.event : null,
    conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
    startedAt: typeof run.created_at === "string" ? run.created_at : null,
    completedAt: typeof run.updated_at === "string" ? run.updated_at : null,
    workflowName: typeof run.name === "string" ? run.name : null,
  });

  console.log(`[RUN] workflow #${run.id} stored (${repo.full_name}, ${run.conclusion ?? "unknown"})`);

  // Phase G: cache which PR (if any) this run's head SHA belongs to. Payload
  // data first, GitHub API enrichment second — best-effort, never fatal.
  if (typeof run.head_sha === "string" && run.head_sha) {
    void correlateRun(db, {
      repositoryId,
      fullName: repo.full_name,
      installationId,
      headSha: run.head_sha,
      payload,
    }).catch((err) =>
      logger.warn({ err, runId: run.id }, "PR correlation failed"),
    );
  }

  logger.info(
    { runId: run.id, conclusion: run.conclusion, repo: repo.full_name },
    "workflow run completed",
  );
}

/**
 * Build the production webhook processor. Dispatches on `X-GitHub-Event` and
 * marks the delivery processed afterwards. Kept separate from the request
 * cycle so a slow handler never blocks GitHub's webhook ack.
 */
export function createWebhookProcessor(db: Pool): WebhookProcessor {
  return async (envelope, logger) => {
    const payload = asRecord(envelope.payload);
    try {
      switch (envelope.event) {
        case "installation":
          await handleInstallation(db, payload, logger);
          break;
        case "workflow_run":
          await handleWorkflowRun(db, payload, logger);
          break;
        default:
          logger.info({ event: envelope.event }, "unhandled webhook event");
      }

      await db.query(
        `UPDATE webhook_deliveries SET processed_at = now() WHERE delivery_id = $1`,
        [envelope.deliveryId],
      );
    } catch (err) {
      logger.error(
        { err, deliveryId: envelope.deliveryId, event: envelope.event },
        "webhook processing failed",
      );
    }
  };
}

/** No-op processor used when no DB is configured (unit tests). */
export const logOnlyProcessor: WebhookProcessor = async (envelope, logger) => {
  logger.info(
    { deliveryId: envelope.deliveryId, event: envelope.event },
    "webhook received (log-only processor)",
  );
};
