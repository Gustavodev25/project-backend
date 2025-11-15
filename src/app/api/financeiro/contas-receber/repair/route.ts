import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const owners = await prisma.contaReceber.groupBy({
      by: ['userId'],
      _count: { _all: true },
      orderBy: { _count: { _all: 'desc' } },
      where: {},
    });
    return NextResponse.json({ ok: true, owners });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");
    if (!sessionCookie?.value) {
      return NextResponse.json({ ok: false, error: 'Nao autenticado' }, { status: 401 });
    }
    const session = await tryVerifySessionToken(sessionCookie.value);
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Sessao invalida' }, { status: 401 });
    }
    const userId = session.sub;
    const body = await request.json().catch(() => ({}));
    const fromUserId: string | undefined = body?.fromUserId;
    if (!fromUserId) {
      return NextResponse.json({ ok: false, error: 'Parametro fromUserId obrigatorio' }, { status: 400 });
    }

    const result = await prisma.contaReceber.updateMany({
      where: { userId: fromUserId },
      data: { userId },
    });
    return NextResponse.json({ ok: true, updated: result.count });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}

