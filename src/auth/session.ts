import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "rr_session";

export function createSessionToken(username: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ username, issuedAt: Date.now() })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string, secret: string): { username: string } | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { username: string };
  return { username: data.username };
}
