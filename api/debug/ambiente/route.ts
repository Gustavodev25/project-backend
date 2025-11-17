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

    // Data atual do servidor
    const now = new Date();
    
    // Calcular "ontem"
    const ontem = new Date(now);
    ontem.setDate(ontem.getDate() - 1);
    const start = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 0, 0, 0, 0);
    const end = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 23, 59, 59, 999);

    console.log('[Debug Ambiente] Calculando ontem:', {
      now: now.toISOString(),
      nowLocal: now.toString(),
      ontem: ontem.toISOString(),
      start: start.toISOString(),
      end: end.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffset: now.getTimezoneOffset(),
    });

    // Buscar vendas de ontem
    const where = accountIdParam 
      ? {
          userId: session.sub,
          meliAccountId: accountIdParam,
          dataVenda: { gte: start, lte: end },
        }
      : {
          userId: session.sub,
          dataVenda: { gte: start, lte: end },
        };

    const [vendasMeli, vendasShopee] = await Promise.all([
      prisma.meliVenda.findMany({
        where,
        select: {
          orderId: true,
          valorTotal: true,
          dataVenda: true,
          status: true,
          meliAccountId: true,
        },
        orderBy: { dataVenda: "asc" },
      }),
      prisma.shopeeVenda.findMany({
        where: accountIdParam 
          ? {
              userId: session.sub,
              shopeeAccountId: accountIdParam,
              dataVenda: { gte: start, lte: end },
            }
          : {
              userId: session.sub,
              dataVenda: { gte: start, lte: end },
            },
        select: {
          orderId: true,
          valorTotal: true,
          dataVenda: true,
          status: true,
          shopeeAccountId: true,
        },
        orderBy: { dataVenda: "asc" },
      })
    ]);

    const todasVendas = [...vendasMeli, ...vendasShopee];

    // Agrupar por status
    const porStatus = new Map<string, { count: number; total: number }>();
    todasVendas.forEach(v => {
      const status = v.status || 'unknown';
      const current = porStatus.get(status) || { count: 0, total: 0 };
      porStatus.set(status, {
        count: current.count + 1,
        total: current.total + Number(v.valorTotal || 0),
      });
    });

    // Calcular totais
    const totalGeral = todasVendas.reduce((acc, v) => acc + Number(v.valorTotal || 0), 0);
    const totalPagas = todasVendas
      .filter(v => v.status?.toLowerCase().includes('paid') || v.status?.toLowerCase().includes('completed'))
      .reduce((acc, v) => acc + Number(v.valorTotal || 0), 0);
    const totalCanceladas = todasVendas
      .filter(v => v.status?.toLowerCase().includes('cancel'))
      .reduce((acc, v) => acc + Number(v.valorTotal || 0), 0);

    // Informações do ambiente
    const ambiente = {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL || 'false',
      VERCEL_ENV: process.env.VERCEL_ENV || 'N/A',
      VERCEL_REGION: process.env.VERCEL_REGION || 'N/A',
      TZ: process.env.TZ || 'N/A',
      isProduction: process.env.NODE_ENV === 'production',
      isVercel: process.env.VERCEL === '1',
    };

    // Datas calculadas
    const datas = {
      serverNow: now.toISOString(),
      serverNowLocal: now.toString(),
      serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      serverTimezoneOffset: now.getTimezoneOffset(),
      periodoOntem: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      periodoOntemLocal: {
        start: start.toString(),
        end: end.toString(),
      },
    };

    // Primeiras e últimas vendas
    const primeiraVenda = todasVendas[0];
    const ultimaVenda = todasVendas[todasVendas.length - 1];

    return NextResponse.json({
      ambiente,
      datas,
      filtros: {
        accountId: accountIdParam || 'TODOS',
        userId: session.sub,
      },
      vendas: {
        total: todasVendas.length,
        mercadoLivre: vendasMeli.length,
        shopee: vendasShopee.length,
      },
      valores: {
        totalGeral: totalGeral.toFixed(2),
        totalPagas: totalPagas.toFixed(2),
        totalCanceladas: totalCanceladas.toFixed(2),
      },
      porStatus: Object.fromEntries(
        Array.from(porStatus.entries()).map(([status, data]) => [
          status,
          {
            count: data.count,
            total: data.total.toFixed(2),
          }
        ])
      ),
      primeiraVenda: primeiraVenda ? {
        orderId: primeiraVenda.orderId,
        valorTotal: primeiraVenda.valorTotal,
        dataVenda: primeiraVenda.dataVenda,
        status: primeiraVenda.status,
      } : null,
      ultimaVenda: ultimaVenda ? {
        orderId: ultimaVenda.orderId,
        valorTotal: ultimaVenda.valorTotal,
        dataVenda: ultimaVenda.dataVenda,
        status: ultimaVenda.status,
      } : null,
      amostraVendas: todasVendas.slice(0, 5).map(v => ({
        orderId: v.orderId,
        valorTotal: v.valorTotal,
        dataVenda: v.dataVenda,
        status: v.status,
      })),
    });

  } catch (error) {
    console.error("❌ [Debug Ambiente] Erro:", error);
    return NextResponse.json({ 
      error: "Erro ao buscar informações do ambiente",
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
