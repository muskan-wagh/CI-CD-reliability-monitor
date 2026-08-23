/** Shared OAuth helpers for the dashboard auth routes (server-side only). */

export function baseUrl(request: Request): string {
  const configured = process.env.FRONTEND_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

export function oauthEnabled(): boolean {
  return Boolean(
    process.env.SESSION_SECRET &&
      process.env.GITHUB_OAUTH_CLIENT_ID &&
      process.env.GITHUB_OAUTH_CLIENT_SECRET,
  );
}
