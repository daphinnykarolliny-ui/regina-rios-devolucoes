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
export const config = { matcher: ["/((?!_next|api/health|api/login|login).*)"] };
