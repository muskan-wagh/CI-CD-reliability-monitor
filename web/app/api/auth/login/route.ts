import { NextResponse } from "next/server";
import { baseUrl, oauthEnabled } from "@/lib/auth";

/** Start GitHub OAuth: redirect the browser to GitHub's authorize page. */
export async function GET(request: Request) {
  if (!oauthEnabled()) {
    return NextResponse.json({ error: "oauth_not_configured" }, { status: 500 });
  }

  const state = crypto.randomUUID();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_OAUTH_CLIENT_ID!);
  url.searchParams.set("redirect_uri", `${baseUrl(request)}/api/auth/callback`);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("fg_oauth_state", state, {
    httpOnly: true,
    path: "/",
    maxAge: 600,
    sameSite: "lax",
  });
  return res;
}
