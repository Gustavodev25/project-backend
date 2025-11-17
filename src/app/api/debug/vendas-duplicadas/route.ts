import { NextRequest, NextResponse } from "next/server";
import { assertSessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get("session")?.value;
    const session = await assertSessionToken(sessionCookie);

    const url = new URL(req.url);
    const accountIdParam = url.searchParams.get("accountId");
    const dateParam = url.searchParams.get("date"); // formato: YYYY-MM-DD

    if (!accountIdParam || !dateParam) {
      return NextResponse.json({ 
        error: "Parâmetros obrigatórios: accountId e date (YYYY-MM-DD)" 
      }, { status: 400 });
    }

    // Calcular início e fim do dia
    const [year, month, day] = dateParam.split('-').map(Number);
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day, 23, 59, 59, 999);

    console.log('[Debug] Buscando vendas duplicadas:', {
      accountId: accountIdParam,
      date: dateParam,
      start: start.toISOString(),
      end: end.toISOString(),
    });

    // Buscar TODAS as vendas do dia (sem distinct)
    const vendasMeliSemDistinct = await prisma.meliVenda.findMany({
      where: {
        userId: session.sub,
        meliAccountId: accountIdParam,
        dataVenda: { gte: start, lte: end },
      },
      select: {
        id: true,
        orderId: true,
        valorTotal: true,
        status: true,
        dataVenda: true,
      },
      orderBy: { orderId: "asc" },
    });

    const vendasShopeeSemDistinct = await prisma.shopeeVenda.findMany({
      where: {
        userId: session.sub,
        shopeeAccountId: accountIdParam,
        dataVenda: { gte: start, lte: end },
      },
      select: {
        id: true,
        orderId: true,
        valorTotal: true,
        status: true,
        dataVenda: true,
      },
      orderBy: { orderId: "asc" },
    });

    const todasVendas = [...vendasMeliSemDistinct, ...vendasShopeeSemDistinct];

    // Buscar vendas COM distinct (como o dashboard faz)
    const vendasMeliComDistinct = await prisma.meliVenda.findMany({
      where: {
        userId: session.sub,
        meliAccountId: accountIdParam,
        dataVenda: { gte: start, lte: end },
      },
      select: {
        orderId: true,
        valorTotal: true,
        status: true,
      },
      distinct: ['orderId'],
    });

    const vendasShopeeComDistinct = await prisma.shopeeVenda.findMany({
      where: {
        userId: session.sub,
        shopeeAccountId: accountIdParam,
        dataVenda: { gte: start, lte: end },
      },
      select: {
        orderId: true,
        valorTotal: true,
        status: true,
      },
      distinct: ['orderId'],
    });

    const vendasDistinct = [...vendasMeliComDistinct, ...vendasShopeeComDistinct];

    // Identificar duplicações
    const orderIdCount = new Map<string, number>();
    const orderIdDetails = new Map<string, any[]>();

    todasVendas.forEach(venda => {
      const count = orderIdCount.get(venda.orderId) || 0;
      orderIdCount.set(venda.orderId, count + 1);

      const details = orderIdDetails.get(venda.orderId) || [];
      details.push({
        id: venda.id,
        valorTotal: venda.valorTotal,
        status: venda.status,
        dataVenda: venda.dataVenda,
      });
      orderIdDetails.set(venda.orderId, details);
    });

    const duplicadas = Array.from(orderIdCount.entries())
      .filter(([_, count]) => count > 1)
      .map(([orderId, count]) => ({
        orderId,
        count,
        details: orderIdDetails.get(orderId),
      }));

    // Calcular totais
    const totalSemDistinct = todasVendas.reduce((acc, v) => acc + Number(v.valorTotal || 0), 0);
    const totalComDistinct = vendasDistinct.reduce((acc, v) => acc + Number(v.valorTotal || 0), 0);
    const diferenca = totalSemDistinct - totalComDistinct;

    return NextResponse.json({
      data: dateParam,
      accountId: accountIdParam,
      resumo: {
        totalVendasSemDistinct: todasVendas.length,
        totalVendasComDistinct: vendasDistinct.length,
        vendasDuplicadas: duplicadas.length,
        valorTotalSemDistinct: totalSemDistinct.toFixed(2),
        valorTotalComDistinct: totalComDistinct.toFixed(2),
        diferenca: diferenca.toFixed(2),
      },
      vendasDuplicadas: duplicadas,
      todasVendas: todasVendas.map(v => ({
        orderId: v.orderId,
        valorTotal: v.valorTotal,
        status: v.status,
      })),
    });

  } catch (error) {
    console.error("❌ [Debug] Erro:", error);
    return NextResponse.json({ 
      error: "Erro ao buscar vendas duplicadas",
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
