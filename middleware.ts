import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/src/auth/session";

export function middleware(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? verifySessionToken(token, process.env.SESSION_SECRET!) : null;
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

// Excludes /_next (framework assets), /api/health (Task 13's Docker HEALTHCHECK
// must reach this unauthenticated), /api/login and /login (the login flow itself)
// from the auth gate. Everything else is protected.
//
// runtime: "nodejs" forces this middleware to run on the Node.js runtime
// instead of the Edge runtime (Next.js's default for middleware). session.ts
// uses node:crypto's createHmac/timingSafeEqual, which the Edge runtime does
// not fully support; without this opt-in the whole auth gate could throw (or
// fail open) at request time. Supported as a `config.runtime` value in
// Next.js 16.3.5 (see node_modules/next/dist/build/segment-config/pages/pages-segment-config.d.ts).
export const config = {
  matcher: ["/((?!_next|api/health|api/login|login).*)"],
  runtime: "nodejs",
};
