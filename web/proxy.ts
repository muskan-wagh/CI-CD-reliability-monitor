import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) {
    return NextResponse.next();
  }
  await auth.protect();
});

export const config = {
  matcher: [
    // Run on everything except Next.js internals and static files.
    "/((?!_next|[^?]*\\.[^?]*$).*)",
  ],
};
