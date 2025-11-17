import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");
    const result: any = { ok: true };

    if (!sessionCookie?.value) {
      result.error = "Sem cookie de sessão";
      return NextResponse.json(result, { status: 200 });
    }

    const session = await tryVerifySessionToken(sessionCookie.value);
    if (!session) {
      result.error = "Sessão inválida";
      return NextResponse.json(result, { status: 200 });
    }

    const userId = session.sub;
    result.userId = userId;

    const [countAll, countByUser] = await Promise.all([
      prisma.contaReceber.count(),
      prisma.contaReceber.count({ where: { userId } }),
    ]);

    result.countAll = countAll;
    result.countByUser = countByUser;

    const [sampleByUser, sampleAny] = await Promise.all([
      prisma.contaReceber.findMany({
        where: { userId },
        orderBy: { dataVencimento: "desc" },
        take: 5,
        select: {
          id: true,
          userId: true,
          descricao: true,
          valor: true,
          dataVencimento: true,
          dataRecebimento: true,
          status: true,
          origem: true,
        },
      }),
      prisma.contaReceber.findMany({
        orderBy: { dataVencimento: "desc" },
        take: 5,
        select: {
          id: true,
          userId: true,
          descricao: true,
          valor: true,
          dataVencimento: true,
          dataRecebimento: true,
          status: true,
          origem: true,
        },
      }),
    ]);

    result.sampleByUser = sampleByUser;
    result.sampleAny = sampleAny;

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}

