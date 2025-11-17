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
    const vendas = await prisma.meliVenda.findMany({
      where: whereClauseMeli,
      select: {
        valorTotal: true,
        tipoAnuncio: true,
        dataVenda: true,
      },
      distinct: ['orderId'],
      orderBy: { dataVenda: "desc" },
    });

    console.log(`[FaturamentoPorTipoAnuncio] Encontradas ${vendas.length} vendas Meli no período`);
    console.log(`[FaturamentoPorTipoAnuncio] Período: ${usarTodasVendas ? 'todos' : `${start.toISOString()} - ${end.toISOString()}`}`);

    if (vendas.length > 0) {
      const catalogo = vendas.filter(v => v.tipoAnuncio && v.tipoAnuncio.toLowerCase().includes('catálogo'));
      const proprio = vendas.filter(v => v.tipoAnuncio && v.tipoAnuncio.toLowerCase().includes('próprio'));
      const outros = vendas.filter(v => !v.tipoAnuncio || (!v.tipoAnuncio.toLowerCase().includes('catálogo') && !v.tipoAnuncio.toLowerCase().includes('próprio')));
      console.log(`[FaturamentoPorTipoAnuncio] Catálogo: ${catalogo.length}, Próprio: ${proprio.length}, Outros/Null: ${outros.length}`);
      console.log(`[FaturamentoPorTipoAnuncio] Exemplos tipo anúncio:`, vendas.slice(0, 5).map(v => ({ tipoAnuncio: v.tipoAnuncio, valor: v.valorTotal })));
    }

    // Agrupar por tipo de anúncio (Catálogo vs Próprio) - apenas Mercado Livre
    let faturamentoCatalogo = 0;
    let faturamentoProprio = 0;
    let quantidadeCatalogo = 0;
    let quantidadeProprio = 0;

    // Processar vendas do Mercado Livre (com tipoAnuncio)
    for (const venda of vendas) {
      const valor = toNumber(venda.valorTotal);
      const isCatalogo = venda.tipoAnuncio &&
                        venda.tipoAnuncio.toString().toLowerCase().includes('catálogo');

      if (isCatalogo) {
        faturamentoCatalogo += valor;
        quantidadeCatalogo += 1;
      } else {
        faturamentoProprio += valor;
        quantidadeProprio += 1;
      }
    }

    const faturamentoTotal = faturamentoCatalogo + faturamentoProprio;
    const quantidadeTotal = quantidadeCatalogo + quantidadeProprio;

    // Calcular percentuais de faturamento
    const percentualFaturamentoCatalogo = faturamentoTotal > 0 ? (faturamentoCatalogo / faturamentoTotal) * 100 : 0;
    const percentualFaturamentoProprio = faturamentoTotal > 0 ? (faturamentoProprio / faturamentoTotal) * 100 : 0;

    // Calcular percentuais de quantidade
    const percentualQuantidadeCatalogo = quantidadeTotal > 0 ? (quantidadeCatalogo / quantidadeTotal) * 100 : 0;
    const percentualQuantidadeProprio = quantidadeTotal > 0 ? (quantidadeProprio / quantidadeTotal) * 100 : 0;

    // Montar resultado
    const resultado = [];

    if (faturamentoCatalogo > 0) {
      resultado.push({
        tipoAnuncio: "Catálogo",
        faturamento: Math.round(faturamentoCatalogo * 100) / 100,
        quantidade: quantidadeCatalogo,
        percentual: Math.round(percentualFaturamentoCatalogo * 100) / 100,
        percentualFaturamento: Math.round(percentualFaturamentoCatalogo * 100) / 100,
        percentualQuantidade: Math.round(percentualQuantidadeCatalogo * 100) / 100,
      });
    }

    if (faturamentoProprio > 0) {
      resultado.push({
        tipoAnuncio: "Próprio",
        faturamento: Math.round(faturamentoProprio * 100) / 100,
        quantidade: quantidadeProprio,
        percentual: Math.round(percentualFaturamentoProprio * 100) / 100,
        percentualFaturamento: Math.round(percentualFaturamentoProprio * 100) / 100,
        percentualQuantidade: Math.round(percentualQuantidadeProprio * 100) / 100,
      });
    }

    console.log(`[FaturamentoPorTipoAnuncio] Resultado final:`, resultado);

    return NextResponse.json(resultado);
  } catch (err) {
    console.error("Erro ao calcular faturamento por tipo de anúncio:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
