import type { Queryable } from "./store.js";
import {
  createInstallationClient,
  loadGithubAppCredentials,
} from "./githubApp.js";

/**
 * PR correlation (Phase G).
 *
 * Resolves which pull request a run's head SHA belongs to and caches it in
 * `pull_requests`. Resolution order:
 *   1. Data already delivered by GitHub inside the workflow_run payload
 *      (`workflow_run.pull_requests[]`) — free, no API call.
 *   2. GitHub API `GET /repos/{o}/{r}/commits/{sha}/pulls` via the App's
 *      installation token (only when App credentials are configured).
 *
 * Everything here states timing alignment only. Callers must phrase output as
 * "first observed after PR #N" — never "PR #N caused it".
 */

export interface CorrelatedPr {
  prNumber: number;
  title: string | null;
  authorLogin: string | null;
  state: string | null;
  changedFiles: string[] | null;
}

interface PrRow {
  pr_number: number;
  title: string | null;
  author_login: string | null;
  state: string | null;
  changed_files: unknown;
}

function rowToCorrelated(row: PrRow): CorrelatedPr {
  return {
    prNumber: Number(row.pr_number),
    title: row.title,
    authorLogin: row.author_login,
    state: row.state,
    changedFiles: Array.isArray(row.changed_files)
      ? (row.changed_files as string[])
      : null,
  };
}

/** Cached PRs for a set of SHAs, keyed by sha. Pure read — never hits GitHub. */
export async function getPrsByShas(
  db: Queryable,
  repositoryId: number,
  shas: string[],
): Promise<Record<string, CorrelatedPr>> {
  const unique = [...new Set(shas.filter(Boolean))];
  if (unique.length === 0) return {};
  const result = await db.query(
    `SELECT DISTINCT ON (head_sha) head_sha, pr_number, title, author_login, state, changed_files
     FROM pull_requests
     WHERE repository_id = $1 AND head_sha = ANY($2)
     ORDER BY head_sha, fetched_at DESC`,
    [repositoryId, unique],
  );
  const out: Record<string, CorrelatedPr> = {};
  for (const row of result.rows as (PrRow & { head_sha: string })[]) {
    out[row.head_sha] = rowToCorrelated(row);
  }
  return out;
}

async function upsertPr(
  db: Queryable,
  input: {
    repositoryId: number;
    prNumber: number;
    headSha: string;
    title?: string | null;
    authorLogin?: string | null;
    state?: string | null;
    changedFiles?: string[] | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO pull_requests
       (repository_id, pr_number, head_sha, title, author_login, state, changed_files)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (repository_id, pr_number, head_sha) DO UPDATE SET
       title         = COALESCE(EXCLUDED.title, pull_requests.title),
       author_login  = COALESCE(EXCLUDED.author_login, pull_requests.author_login),
       state         = COALESCE(EXCLUDED.state, pull_requests.state),
       changed_files = COALESCE(EXCLUDED.changed_files, pull_requests.changed_files),
       fetched_at    = now()`,
    [
      input.repositoryId,
      input.prNumber,
      input.headSha,
      input.title ?? null,
      input.authorLogin ?? null,
      input.state ?? null,
      input.changedFiles ? JSON.stringify(input.changedFiles) : null,
    ],
  );
}

/**
 * Cache PR numbers that GitHub already included in the workflow_run payload.
 * Returns the primary PR number (first listed), or null when none were given.
 */
export async function cachePayloadPrs(
  db: Queryable,
  repositoryId: number,
  headSha: string,
  payload: unknown,
): Promise<number | null> {
  const run = (payload as { workflow_run?: { pull_requests?: unknown } }).workflow_run;
  const prs = Array.isArray(run?.pull_requests) ? run!.pull_requests : [];
  let primary: number | null = null;
  for (const raw of prs) {
    const number =
      typeof raw === "object" && raw !== null ? (raw as { number?: unknown }).number : undefined;
    if (typeof number !== "number") continue;
    if (primary === null) primary = number;
    await upsertPr(db, { repositoryId, prNumber: number, headSha });
  }
  return primary;
}

/**
 * Enrich a cached PR with title/author/changed files from the GitHub API.
 * Silent no-op when App credentials are absent or anything fails — callers
 * only lose detail, never correctness. Bounded to 50 files per PR.
 */
export async function enrichPrFromApi(
  db: Queryable,
  input: {
    repositoryId: number;
    fullName: string;
    installationId: number | null;
    prNumber: number;
    headSha: string;
  },
): Promise<void> {
  try {
    const credentials = loadGithubAppCredentials();
    if (!credentials || input.installationId == null) return;
    const client = await createInstallationClient(credentials, input.installationId);

    const pr = await client.get<{
      title?: string;
      state?: string;
      user?: { login?: string };
    }>(`/repos/${input.fullName}/pulls/${input.prNumber}`);

    let files: string[] | null = null;
    try {
      const fileRes = await client.get<{ filename: string }[]>(
        `/repos/${input.fullName}/pulls/${input.prNumber}/files?per_page=50`,
      );
      files = Array.isArray(fileRes) ? fileRes.map((f) => f.filename).slice(0, 50) : null;
    } catch {
      // Files are optional detail; keep the correlation without them.
    }

    await upsertPr(db, {
      repositoryId: input.repositoryId,
      prNumber: input.prNumber,
      headSha: input.headSha,
      title: pr?.title ?? null,
      authorLogin: pr?.user?.login ?? null,
      state: pr?.state ?? null,
      changedFiles: files,
    });
  } catch {
    // Non-fatal by design: correlation detail is best-effort.
  }
}

/**
 * Fire-and-forget hook for the workflow_run webhook path.
 */
export async function correlateRun(
  db: Queryable,
  input: {
    repositoryId: number;
    fullName: string;
    installationId: number | null;
    headSha: string;
    payload: unknown;
  },
): Promise<void> {
  if (!input.headSha) return;
  const prNumber = await cachePayloadPrs(db, input.repositoryId, input.headSha, input.payload);
  if (prNumber !== null) {
    await enrichPrFromApi(db, {
      repositoryId: input.repositoryId,
      fullName: input.fullName,
      installationId: input.installationId,
      prNumber,
      headSha: input.headSha,
    });
    return;
  }
  // Payload didn't include PRs (fork PRs often don't); resolve via API only
  // when we can — otherwise leave it to a future enriched webhook.
  if (!loadGithubAppCredentials() || input.installationId == null) return;
  try {
    const credentials = loadGithubAppCredentials()!;
    const client = await createInstallationClient(credentials, input.installationId);
    const pulls = await client.get<{ number: number }[]>(
      `/repos/${input.fullName}/commits/${input.headSha}/pulls`,
    );
    const first = Array.isArray(pulls) ? pulls[0] : undefined;
    if (first && typeof first.number === "number") {
      await enrichPrFromApi(db, {
        repositoryId: input.repositoryId,
        fullName: input.fullName,
        installationId: input.installationId,
        prNumber: first.number,
        headSha: input.headSha,
      });
    }
  } catch {
    // Unknown SHA (e.g. synthetic demo commits) → nothing to correlate.
  }
}
