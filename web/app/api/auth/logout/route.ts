import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session";

/** Clear the session cookie and return home. */
export async function GET(request: Request) {
  const res = NextResponse.redirect(new URL("/", baseUrl(request)));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
