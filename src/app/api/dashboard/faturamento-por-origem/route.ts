import { NextRequest, NextResponse } from "next/server";
import { assertSessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getStatusWhere, getCanalWhere, getTipoAnuncioWhere, getModalidadeWhere } from "@/lib/dashboard-filters";

export const runtime = "nodejs";

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getNowInBrazil(): { year: number; month: number; day: number } {
  const now = new Date();
  const s = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const [month, day, year] = s.split('/').map(Number);
  return { year, month, day };
}

function getDateRange(periodo: string): { start: Date; end: Date } {
  const b = getNowInBrazil();
  const now = new Date();
  switch (periodo) {
    case 'hoje': {
      const start = new Date(Date.UTC(b.year, b.month - 1, b.day, 3, 0, 0, 0));
      const end = new Date(Date.UTC(b.year, b.month - 1, b.day + 1, 2, 59, 59, 999));
      return { start, end };
    }
    case 'ontem': {
      const start = new Date(Date.UTC(b.year, b.month - 1, b.day - 1, 3, 0, 0, 0));
      const end = new Date(Date.UTC(b.year, b.month - 1, b.day, 2, 59, 59, 999));
      return { start, end };
    }
    case 'ultimos_7d': {
      const start = new Date(Date.UTC(b.year, b.month - 1, b.day - 6, 3, 0, 0, 0));
      const end = new Date(Date.UTC(b.year, b.month - 1, b.day + 1, 2, 59, 59, 999));
      return { start, end };
    }
    case 'ultimos_30d': {
      const start = new Date(Date.UTC(b.year, b.month - 1, b.day - 29, 3, 0, 0, 0));
      const end = new Date(Date.UTC(b.year, b.month - 1, b.day + 1, 2, 59, 59, 999));
      return { start, end };
    }
    case 'ultimos_12m': {
      const ref = new Date(b.year, b.month - 13, b.day);
      const start = new Date(Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate(), 3, 0, 0, 0));
      const end = new Date(Date.UTC(b.year, b.month - 1, b.day + 1, 2, 59, 59, 999));
      return { start, end };
    }
    case 'este_mes': {
      const lastDay = new Date(b.year, b.month, 0).getDate();
      const start = new Date(Date.UTC(b.year, b.month - 1, 1, 3, 0, 0, 0));
      const end = new Date(Date.UTC(b.year, b.month - 1, lastDay + 1, 2, 59, 59, 999));
      return { start, end };
    }
    case 'mes_passado': {
      const lastMonth = new Date(b.year, b.month - 2, 1);
      const lastDayOfLastMonth = new Date(b.year, b.month - 1, 0).getDate();
      const start = new Date(Date.UTC(lastMonth.getFullYear(), lastMonth.getMonth(), 1, 3, 0, 0, 0));
      const end = new Date(Date.UTC(lastMonth.getFullYear(), lastMonth.getMonth(), lastDayOfLastMonth + 1, 2, 59, 59, 999));
      return { start, end };
    }
    case 'ultimos_3_meses': {
      const ref = new Date(b.year, b.month - 2, 1);
      const start = new Date(Date.UTC(ref.getFullYear(), ref.getMonth(), 1, 3, 0, 0, 0));
      const end = new Date(Date.UTC(b.year, b.month - 1, 1, 2, 59, 59, 999));
      return { start, end };
    }
    case 'ultimos_6_meses': {
      const ref = new Date(b.year, b.month - 5, 1);
      const start = new Date(Date.UTC(ref.getFullYear(), ref.getMonth(), 1, 3, 0, 0, 0));
      const end = new Date(Date.UTC(b.year, b.month - 1, 1, 2, 59, 59, 999));
      return { start, end };
    }
    case 'todos':
    default: {
      return { start: new Date(0), end: now };
    }
  }
}

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  try {
    session = await assertSessionToken(sessionCookie);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const periodoParam = url.searchParams.get("periodo") || "todos";
    const dataInicioParam = url.searchParams.get("dataInicio");
    const dataFimParam = url.searchParams.get("dataFim");
    const canalParam = url.searchParams.get("canal");
    const statusParam = url.searchParams.get("status");
    const tipoAnuncioParam = url.searchParams.get("tipoAnuncio");
    const modalidadeParam = url.searchParams.get("modalidade");
    const accountPlatformParam = url.searchParams.get("accountPlatform");
    const accountIdParam = url.searchParams.get("accountId");

    let start: Date;
    let end: Date;
    let usarTodasVendas = false;

    if (dataInicioParam && dataFimParam) {
      // Período personalizado
      // Incluir o dia final completamente, independente do fuso
      start = new Date(dataInicioParam);
      const endBase = new Date(dataFimParam);
      end = new Date(endBase.getTime() + (24 * 60 * 60 * 1000 - 1));
    } else if (periodoParam === "todos") {
      // Para "todos", buscar todas as vendas
      usarTodasVendas = true;
      start = new Date(0);
      end = new Date();
    } else {
      const range = getDateRange(periodoParam);
      start = range.start;
      end = range.end;
    }

    // Buscar vendas no período
    const statusWhere = getStatusWhere(statusParam);
    const canalWhere = getCanalWhere(canalParam);
    const tipoWhere = getTipoAnuncioWhere(tipoAnuncioParam);
    const modalidadeWhere = getModalidadeWhere(modalidadeParam);

    // WhereClause para Mercado Livre (com tipoAnuncio e modalidade)
    const whereClauseMeli = usarTodasVendas
      ? { userId: session.sub, ...(accountPlatformParam === 'meli' && accountIdParam ? { meliAccountId: accountIdParam } : {}), ...statusWhere, ...canalWhere, ...tipoWhere, ...modalidadeWhere }
      : { userId: session.sub, dataVenda: { gte: start, lte: end }, ...(accountPlatformParam === 'meli' && accountIdParam ? { meliAccountId: accountIdParam } : {}), ...statusWhere, ...canalWhere, ...tipoWhere, ...modalidadeWhere };

    // WhereClause para Shopee (sem tipoAnuncio e modalidade)
    const whereClauseShopee = usarTodasVendas
      ? { userId: session.sub, ...statusWhere, ...canalWhere }
      : { userId: session.sub, dataVenda: { gte: start, lte: end }, ...statusWhere, ...canalWhere };

    // Buscar vendas do Mercado Livre
    const vendasMeli = await prisma.meliVenda.findMany({
      where: whereClauseMeli,
      select: {
        valorTotal: true,
        ads: true,
        dataVenda: true,
      },
      distinct: ['orderId'],
      orderBy: { dataVenda: "desc" },
    });

    // Buscar vendas do Shopee
    const vendasShopee = await prisma.shopeeVenda.findMany({
      where: whereClauseShopee,
      select: {
        valorTotal: true,
        dataVenda: true,
      },
      distinct: ['orderId'],
      orderBy: { dataVenda: "desc" },
    });

    // Consolidar vendas baseado no filtro de canal
    let vendas;
    if (canalParam === 'mercado_livre') {
      vendas = vendasMeli;
    } else if (canalParam === 'shopee') {
      vendas = vendasShopee.map(v => ({ ...v, ads: null })); // Shopee não tem ads
    } else {
      // Se 'todos' ou não especificado, combinar ambas
      vendas = [...vendasMeli, ...vendasShopee.map(v => ({ ...v, ads: null }))];
    }

    console.log(`[FaturamentoPorOrigem] Encontradas ${vendas.length} vendas no período (Meli: ${vendasMeli.length}, Shopee: ${vendasShopee.length})`);
    console.log(`[FaturamentoPorOrigem] Período: ${usarTodasVendas ? 'todos' : `${start.toISOString()} - ${end.toISOString()}`}`);

    if (vendas.length > 0) {
      const comAds = vendas.filter(v => v.ads && v.ads !== null && v.ads.toString().toLowerCase() !== 'null');
      const semAds = vendas.filter(v => !v.ads || v.ads === null || v.ads.toString().toLowerCase() === 'null');
      console.log(`[FaturamentoPorOrigem] Com ADS: ${comAds.length}, Sem ADS: ${semAds.length}`);
      console.log(`[FaturamentoPorOrigem] Exemplos ADS:`, vendas.slice(0, 5).map(v => ({ ads: v.ads, valor: v.valorTotal })));
    }

    // Agrupar por origem (Com ADS vs Sem ADS)
    let faturamentoComAds = 0;
    let faturamentoSemAds = 0;
    let quantidadeComAds = 0;
    let quantidadeSemAds = 0;

    for (const venda of vendas) {
      const valor = toNumber(venda.valorTotal);
      
      // Verificar se a venda tem ADS (apenas para Mercado Livre)
      // Para vendas do Shopee, sempre considerar como "Sem ADS"
      const temAds = 'ads' in venda && venda.ads && 
                    venda.ads !== null && 
                    venda.ads.toString().toLowerCase() !== 'null' && 
                    venda.ads.toString().trim() !== '';

      if (temAds) {
        faturamentoComAds += valor;
        quantidadeComAds += 1;
      } else {
        faturamentoSemAds += valor;
        quantidadeSemAds += 1;
      }
    }

    const faturamentoTotal = faturamentoComAds + faturamentoSemAds;
    const quantidadeTotal = quantidadeComAds + quantidadeSemAds;

    // Calcular percentuais de faturamento
    const percentualFaturamentoComAds = faturamentoTotal > 0 ? (faturamentoComAds / faturamentoTotal) * 100 : 0;
    const percentualFaturamentoSemAds = faturamentoTotal > 0 ? (faturamentoSemAds / faturamentoTotal) * 100 : 0;

    // Calcular percentuais de quantidade
    const percentualQuantidadeComAds = quantidadeTotal > 0 ? (quantidadeComAds / quantidadeTotal) * 100 : 0;
    const percentualQuantidadeSemAds = quantidadeTotal > 0 ? (quantidadeSemAds / quantidadeTotal) * 100 : 0;

    // Montar resultado
    const resultado = [];

    if (faturamentoComAds > 0) {
      resultado.push({
        origem: "Com ADS",
        faturamento: Math.round(faturamentoComAds * 100) / 100,
        quantidade: quantidadeComAds,
        percentual: Math.round(percentualFaturamentoComAds * 100) / 100,
        percentualFaturamento: Math.round(percentualFaturamentoComAds * 100) / 100,
        percentualQuantidade: Math.round(percentualQuantidadeComAds * 100) / 100,
      });
    }

    if (faturamentoSemAds > 0) {
      resultado.push({
        origem: "Sem ADS",
        faturamento: Math.round(faturamentoSemAds * 100) / 100,
        quantidade: quantidadeSemAds,
        percentual: Math.round(percentualFaturamentoSemAds * 100) / 100,
        percentualFaturamento: Math.round(percentualFaturamentoSemAds * 100) / 100,
        percentualQuantidade: Math.round(percentualQuantidadeSemAds * 100) / 100,
      });
    }

    console.log(`[FaturamentoPorOrigem] Resultado final:`, resultado);

    return NextResponse.json(resultado);
  } catch (err) {
    console.error("Erro ao calcular faturamento por origem:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
