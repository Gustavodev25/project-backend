// src/app/api/auth/register/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { RegisterSchema } from "@/lib/validators";

export const runtime = "nodejs"; // garante Map() para rate-limit em Node
export const dynamic = "force-dynamic";

// Rate limit simples (IP+email) — troque por Redis/Upstash em produção
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
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

  // 3) Validação (Zod)
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ error: msg }, { status: 422 });
  }
  const { nome, email, senha, pais } = parsed.data;

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

  // 5) Checagem existência (email case-insensitive via CITEXT)
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    return NextResponse.json({ error: "Email já cadastrado" }, { status: 409 });
  }

  // 6) Hash
  const passwordHash = await bcrypt.hash(senha, 12);

  // 7) Persistência
  await prisma.user.create({
    data: {
      name: nome,
      email,
      passwordHash,
      country: pais,
    },
  });

  // 8) Resposta + cabeçalhos de segurança úteis
  return new NextResponse(JSON.stringify({ ok: true }), {
    status: 201,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
