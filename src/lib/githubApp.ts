import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export interface GithubAppCredentials {
  appId: string;
  privateKey: string;
}

const API_ROOT = "https://api.github.com";

/**
 * Load GitHub App credentials from the environment. Returns null when not
 * configured so annotation degrades gracefully (log-only) instead of failing.
 * The private key is accepted inline or via a file path; it is never logged.
 */
export function loadGithubAppCredentials(): GithubAppCredentials | null {
  const appId = process.env.GITHUB_APP_ID ?? "";
  const inlineKey = process.env.GITHUB_PRIVATE_KEY ?? "";
  const keyPath = process.env.GITHUB_PRIVATE_KEY_PATH ?? "";

  if (!appId || (!inlineKey && !keyPath)) return null;

  let privateKey = inlineKey;
  if (!privateKey && keyPath) {
    try {
      privateKey = readFileSync(keyPath, "utf8");
    } catch (err) {
      throw new Error(
        `GITHUB_PRIVATE_KEY_PATH points to an unreadable file: ${keyPath}`,
        { cause: err },
      );
    }
  }
  if (!privateKey.includes("PRIVATE KEY")) {
    throw new Error("GITHUB private key does not look like a PEM private key");
  }

  return { appId, privateKey };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Mint a short-lived (~9 min) RS256 JWT that identifies the GitHub App. */
export function createAppJwt(
  credentials: GithubAppCredentials,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: Number(credentials.appId), iat: nowSeconds - 60, exp: nowSeconds + 540 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = base64url(signer.sign(credentials.privateKey));
  return `${header}.${payload}.${signature}`;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

// installation_id -> cached installation token (1h TTL from GitHub; refresh at 50min)
const tokenCache = new Map<number, CachedToken>();

async function githubFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${API_ROOT}${path}`, {
    ...rest,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "FlakyGuard",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${init.method ?? "GET"} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Exchange the app JWT for a 1-hour installation token (cached until ~50min). */
export async function getInstallationToken(
  credentials: GithubAppCredentials,
  installationId: number,
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && Date.now() < cached.expiresAtMs) {
    return cached.token;
  }

  const jwt = createAppJwt(credentials);
  const res = await githubFetch<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    { method: "POST", token: jwt },
  );

  // Refresh 10 minutes before GitHub's own expiry.
  const expiresAtMs = Math.min(
    new Date(res.expires_at).getTime(),
    Date.now() + 50 * 60 * 1000,
  );
  tokenCache.set(installationId, { token: res.token, expiresAtMs });
  return res.token;
}

export interface GithubApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}

/** Small typed client bound to one installation token. */
export async function createInstallationClient(
  credentials: GithubAppCredentials,
  installationId: number,
): Promise<GithubApi> {
  const token = await getInstallationToken(credentials, installationId);
  return {
    get: (path) => githubFetch(path, { token }),
    post: (path, body) =>
      githubFetch(path, {
        method: "POST",
        token,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    patch: (path, body) =>
      githubFetch(path, {
        method: "PATCH",
        token,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}
