import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/meli/accounts/new
 * Retorna contas do Mercado Livre que foram adicionadas mas ainda não têm vendas sincronizadas
 */
export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;

  try {
    const { sub } = await assertSessionToken(sessionCookie);

    // Buscar todas as contas do usuário
    const allAccounts = await prisma.meliAccount.findMany({
      where: { userId: sub },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        nickname: true,
        ml_user_id: true,
        expires_at: true,
        created_at: true,
      },
    });

    if (allAccounts.length === 0) {
      return NextResponse.json({ newAccounts: [] });
    }

    // Verificar quais contas não têm vendas
    const accountsWithSales = await prisma.meliVenda.groupBy({
      by: ['meliAccountId'],
      where: {
        userId: sub,
        meliAccountId: {
          in: allAccounts.map(acc => acc.id)
        }
      },
      _count: {
        id: true
      }
    });

    const accountIdsWithSales = new Set(accountsWithSales.map(item => item.meliAccountId));

    // Filtrar contas que não têm vendas (contas novas)
    const newAccounts = allAccounts.filter(acc => !accountIdsWithSales.has(acc.id));

    return NextResponse.json({
      newAccounts,
      totalAccounts: allAccounts.length,
      accountsWithSales: accountIdsWithSales.size
    });

  } catch (error) {
    console.error("[meli][accounts/new] Erro:", error);
    return new NextResponse("Unauthorized", { status: 401 });
  }
}
