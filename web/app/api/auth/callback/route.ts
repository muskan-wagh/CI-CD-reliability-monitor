import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { baseUrl, oauthEnabled } from "@/lib/auth";
import { SESSION_COOKIE, signSessionToken } from "@/lib/session";

const TTL_SECONDS = 7 * 24 * 3600;

/** GitHub OAuth callback: exchange the code, mint a session token, set cookie. */
export async function GET(request: Request) {
  const home = new URL("/", baseUrl(request));
  if (!oauthEnabled()) {
    return NextResponse.redirect(home);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // CSRF: the state we issued at login must round-trip unchanged.
  const cookieStore = await cookies();
  const savedState = cookieStore.get("fg_oauth_state")?.value;
  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(home);
  }

  const redirectUri = `${baseUrl(request)}/api/auth/callback`;
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    return NextResponse.redirect(home);
  }

  const ghHeaders = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "FlakyGuard",
    Authorization: `Bearer ${tokenData.access_token}`,
  };

  const userRes = await fetch("https://api.github.com/user", { headers: ghHeaders });
  const user = (await userRes.json()) as { id: number; login: string };

  const instRes = await fetch("https://api.github.com/user/installations", {
    headers: ghHeaders,
  });
  const instData = (await instRes.json()) as {
    installations?: { id: number }[];
  };
  const installations = (instData.installations ?? []).map((i) => i.id);

  const token = signSessionToken(
    { sub: String(user.id), login: user.login, installations },
    process.env.SESSION_SECRET!,
    TTL_SECONDS,
  );

  const res = NextResponse.redirect(home);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
  res.cookies.delete("fg_oauth_state");
  return res;
}
