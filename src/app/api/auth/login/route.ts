// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import prisma from "@/lib/prisma";
import { LoginSchema } from "@/lib/validators";
import { withCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const buckets = new Map<string, { count: number; start: number }>();

function allow(ip: string, email: string) {
  const key = `${ip}:${email}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > WINDOW_MS) {
    buckets.set(key, { count: 1, start: now });
    return true;
  }
  if (b.count >= MAX_PER_WINDOW) return false;
  b.count++;
  return true;
}

export const OPTIONS = withCors(async () => new NextResponse(null, { status: 204 }));

export const POST = withCors(async (req: Request) => {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type inválido" },
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ error: msg }, { status: 422 });
  }
  const { email, senha } = parsed.data;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "0.0.0.0";
  if (!allow(ip, email)) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente de novo em instantes." },
      { status: 429 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, passwordHash: true },
  });

  if (!user) {
    return NextResponse.json(
      { error: "Credenciais inválidas" },
      { status: 401 },
    );
  }

  const ok = await bcrypt.compare(senha, user.passwordHash);
  if (!ok) {
    return NextResponse.json(
      { error: "Credenciais inválidas" },
      { status: 401 },
    );
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Faltando JWT_SECRET no .env" },
      { status: 500 },
    );
  }

  const token = await new SignJWT({
    sub: String(user.id),
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret));

  const host = req.headers.get("host") || "";
  const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
  const cookieSameSite = isLocalhost ? "lax" : "none";
  const cookieSecure = !isLocalhost;

  const res = NextResponse.json({ ok: true }, { status: 200 });

  res.cookies.set("session", token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
});

