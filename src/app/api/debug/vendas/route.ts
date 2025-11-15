import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  try {
    session = await assertSessionToken(sessionCookie);
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    // Buscar todas as vendas do usuário
    const vendas = await prisma.meliVenda.findMany({
      where: { userId: session.sub },
      orderBy: { dataVenda: "desc" },
      take: 10, // Apenas as 10 mais recentes
      select: {
        orderId: true,
        dataVenda: true,
        status: true,
        conta: true,
        valorTotal: true,
        titulo: true,
        comprador: true,
        sincronizadoEm: true,
        meliAccountId: true
      }
    });

    // Buscar contas do usuário
    const contas = await prisma.meliAccount.findMany({
      where: { userId: session.sub },
      select: {
        id: true,
        nickname: true,
        ml_user_id: true
      }
    });

    // Contar total de vendas
    const totalVendas = await prisma.meliVenda.count({
      where: { userId: session.sub }
    });

    return NextResponse.json({
      debug: {
        userId: session.sub,
        totalVendas,
        vendasRecentes: vendas,
        contas: contas,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Erro no debug de vendas:", error);
    return NextResponse.json({
      error: "Erro interno do servidor",
      details: error instanceof Error ? error.message : "Erro desconhecido"
    }, { status: 500 });
  }
}
