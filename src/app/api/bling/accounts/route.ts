import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await tryVerifySessionToken(req.cookies.get("session")?.value);
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  try {
    const accounts = await prisma.blingAccount.findMany({
      where: { userId: session.sub },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        bling_user_id: true,
        account_name: true,
        access_token: true,
        refresh_token: true,
        expires_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    return NextResponse.json(accounts);
  } catch (error) {
    console.error("Erro ao listar contas Bling:", error);
    return NextResponse.json(
      { error: "Erro ao listar contas Bling" },
      { status: 500 }
    );
  }
}
