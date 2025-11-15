import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { BLING_API_BASE_URL, refreshBlingAccountToken } from "@/lib/bling";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
    }

    const session = await tryVerifySessionToken(sessionCookie.value);
    if (!session) {
      return NextResponse.json({ error: "Sessao invalida ou expirada" }, { status: 401 });
    }
    const userId = session.sub;

    const blingAccount = await prisma.blingAccount.findFirst({
      where: { userId },
      orderBy: { updated_at: "desc" },
    });
    if (!blingAccount) {
      return NextResponse.json({ error: "Nenhuma conta Bling conectada." }, { status: 404 });
    }

    const isExpired = new Date(blingAccount.expires_at) <= new Date();
    const refreshed = await refreshBlingAccountToken(blingAccount, isExpired);

    const qs = req.nextUrl.searchParams.toString();
    const url = `${BLING_API_BASE_URL}/contas/receber/boletos${qs ? `?${qs}` : ""}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${refreshed.access_token}`,
        Accept: "application/json",
      },
    });

    const text = await resp.text();
    return new NextResponse(text, {
      status: resp.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Proxy Bling] Erro GET /contas/receber/boletos:", err);
    return NextResponse.json({ error: "Erro ao consultar Bling" }, { status: 500 });
  }
}

