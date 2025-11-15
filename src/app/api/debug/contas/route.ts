import { NextRequest, NextResponse } from "next/server";
import { assertSessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get("session")?.value;
    const session = await assertSessionToken(sessionCookie);

    // Buscar todas as contas do usuário
    const [meliAccounts, shopeeAccounts] = await Promise.all([
      prisma.meliAccount.findMany({
        where: { userId: session.sub },
        select: {
          id: true,
          nickname: true,
          ml_user_id: true,
          createdAt: true,
        },
        orderBy: { nickname: "asc" },
      }),
      prisma.shopeeAccount.findMany({
        where: { userId: session.sub },
        select: {
          id: true,
          shopName: true,
          shopId: true,
          createdAt: true,
        },
        orderBy: { shopName: "asc" },
      })
    ]);

    // Contar vendas de ontem por conta
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const start = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 0, 0, 0, 0);
    const end = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 23, 59, 59, 999);

    const vendasPorContaMeli = await Promise.all(
      meliAccounts.map(async (conta) => {
        const vendas = await prisma.meliVenda.findMany({
          where: {
            meliAccountId: conta.id,
            dataVenda: { gte: start, lte: end },
          },
          select: {
            valorTotal: true,
            status: true,
          },
        });

        const totalGeral = vendas.reduce((acc, v) => acc + Number(v.valorTotal || 0), 0);
        const totalPagas = vendas
          .filter(v => v.status?.toLowerCase().includes('paid'))
          .reduce((acc, v) => acc + Number(v.valorTotal || 0), 0);

        return {
          id: conta.id,
          nickname: conta.nickname,
          plataforma: "Mercado Livre",
          vendasOntem: {
            total: vendas.length,
            valorGeral: totalGeral.toFixed(2),
            valorPagas: totalPagas.toFixed(2),
          },
        };
      })
    );

    const vendasPorContaShopee = await Promise.all(
      shopeeAccounts.map(async (conta) => {
        const vendas = await prisma.shopeeVenda.findMany({
          where: {
            shopeeAccountId: conta.id,
            dataVenda: { gte: start, lte: end },
          },
          select: {
            valorTotal: true,
            status: true,
          },
        });

        const totalGeral = vendas.reduce((acc, v) => acc + Number(v.valorTotal || 0), 0);
        const totalCompletas = vendas
          .filter(v => v.status?.toLowerCase().includes('completed'))
          .reduce((acc, v) => acc + Number(v.valorTotal || 0), 0);

        return {
          id: conta.id,
          nickname: conta.shopName,
          plataforma: "Shopee",
          vendasOntem: {
            total: vendas.length,
            valorGeral: totalGeral.toFixed(2),
            valorCompletas: totalCompletas.toFixed(2),
          },
        };
      })
    );

    return NextResponse.json({
      periodo: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      contas: {
        mercadoLivre: vendasPorContaMeli,
        shopee: vendasPorContaShopee,
      },
      resumo: {
        totalContas: meliAccounts.length + shopeeAccounts.length,
        mercadoLivre: meliAccounts.length,
        shopee: shopeeAccounts.length,
      },
    });

  } catch (error) {
    console.error("❌ [Debug Contas] Erro:", error);
    return NextResponse.json({ 
      error: "Erro ao buscar contas",
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
