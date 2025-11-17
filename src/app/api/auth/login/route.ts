// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import prisma from "@/lib/prisma";
import { LoginSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rate limit simples (IP + email) — troque por Redis/Upstash em produção
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10; // Aumentado de 5 para 10
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

export async function POST(req: Request) {
  // 1) Content-Type
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type inválido" },
      { status: 415 },
    );
  }

  // 2) Body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // 3) Validação
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ error: msg }, { status: 422 });
  }
  const { email, senha } = parsed.data;

  // 4) Rate-limit (IP + email)
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

  // 5) Busca usuário
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

  // 6) Confere senha
  const ok = await bcrypt.compare(senha, user.passwordHash);
  if (!ok) {
    return NextResponse.json(
      { error: "Credenciais inválidas" },
      { status: 401 },
    );
  }

  // 7) Gera token de sessão (JWT em cookie HttpOnly)
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

  // Detectar se é desenvolvimento local (apenas localhost, não ngrok)
  const host = req.headers.get("host") || "";
  const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
  const isNgrok = host.includes("ngrok");

  const res = NextResponse.json({ ok: true }, { status: 200 });

  res.cookies.set("session", token, {
    httpOnly: true,
    secure: !isLocalhost, // true para ngrok e produção, false apenas para localhost
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 dias
  });

  console.log("🍪 Cookie definido:", {
    hasToken: !!token,
    secure: !isLocalhost,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });

  return res;
}
