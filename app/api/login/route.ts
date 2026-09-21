import { NextRequest, NextResponse } from "next/server";
import { loadUsers } from "@/src/auth/config";
import { verifyPassword } from "@/src/auth/verify";
import { createSessionToken, COOKIE_NAME } from "@/src/auth/session";

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();
  const user = loadUsers().find((u) => u.username === username);
  const salt = process.env.APP_PASSWORD_SALT!;

  if (!user || !verifyPassword(password, salt, user.passwordHash)) {
    return NextResponse.json({ error: "Usuário ou senha inválidos" }, { status: 401 });
  }

  const token = createSessionToken(user.username, process.env.SESSION_SECRET!);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", path: "/" });
  return response;
}
