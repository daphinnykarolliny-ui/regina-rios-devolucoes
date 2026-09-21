import { describe, it, expect } from "vitest";
import { config } from "./middleware";

// Next.js interprets a matcher entry that starts with `/(` as a raw regex path
// pattern (this is the documented "negative lookahead" idiom for excluding
// paths from a middleware matcher), matched against the request pathname.
// We reproduce that matching here to verify the excluded/included paths
// without needing to boot the Next.js dev server.
function matches(pathname: string): boolean {
  const [pattern] = config.matcher;
  const re = new RegExp(`^${pattern}$`);
  return re.test(pathname);
}

describe("middleware matcher", () => {
  it("excludes /api/health so Task 13's Docker HEALTHCHECK can reach it unauthenticated", () => {
    expect(matches("/api/health")).toBe(false);
  });

  it("excludes /login", () => {
    expect(matches("/login")).toBe(false);
  });

  it("excludes /api/login", () => {
    expect(matches("/api/login")).toBe(false);
  });

  it("excludes /_next/static assets", () => {
    expect(matches("/_next/static/x.js")).toBe(false);
  });

  it("includes /dashboard (protected)", () => {
    expect(matches("/dashboard")).toBe(true);
  });
});
