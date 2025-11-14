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

function formatPeriodo(date: Date, tipo: 'mensal' | 'semanal' | 'diario'): string {
  switch (tipo) {
    case 'mensal':
      return date.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '');
    case 'semanal':
      const startOfYear = new Date(date.getFullYear(), 0, 1);
      const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
      const weekOfYear = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);
      return `S${weekOfYear}/${date.getFullYear().toString().slice(-2)}`;
    case 'diario':
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    default:
      return date.toLocaleDateString('pt-BR');
  }
}

// Usa a data do Brasil (America/Sao_Paulo) para evitar perda de dados em "hoje/ontem" em servidores UTC
function getNowInBrazil(): { year: number; month: number; day: number } {
  const now = new Date();
  const brazilDateString = now.toLocaleString('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [month, day, year] = brazilDateString.split('/').map(Number);
  return { year, month, day };
}

function getDateRange(periodo: string): { start: Date; end: Date; tipo: 'mensal' | 'semanal' | 'diario' } {
  const brazilToday = getNowInBrazil();
  const now = new Date();

  switch (periodo) {
    case 'hoje': {
      const start = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, brazilToday.day, 3, 0, 0, 0));
      const end = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, brazilToday.day + 1, 2, 59, 59, 999));
      return { start, end, tipo: 'diario' };
    }
    case 'ontem': {
      const start = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, brazilToday.day - 1, 3, 0, 0, 0));
      const end = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, brazilToday.day, 2, 59, 59, 999));
      return { start, end, tipo: 'diario' };
    }
    case 'ultimos_7d': {
      const start = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, brazilToday.day - 6, 3, 0, 0, 0));
      const end = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, brazilToday.day + 1, 2, 59, 59, 999));
      return { start, end, tipo: 'diario' };
    }
    case 'ultimos_30d': {
      const start = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, brazilToday.day - 29, 3, 0, 0, 0));
      const end = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, brazilToday.day + 1, 2, 59, 59, 999));
      return { start, end, tipo: 'diario' };
    }
    case 'ultimos_12m': {
      const startRef = new Date(brazilToday.year, brazilToday.month - 13, brazilToday.day);
      const start = new Date(Date.UTC(startRef.getFullYear(), startRef.getMonth(), startRef.getDate(), 3, 0, 0, 0));
      const end = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, brazilToday.day + 1, 2, 59, 59, 999));
      return { start, end, tipo: 'mensal' };
    }
    case 'este_mes': {
      const lastDay = new Date(brazilToday.year, brazilToday.month, 0).getDate();
      const start = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, 1, 3, 0, 0, 0));
      const end = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, lastDay + 1, 2, 59, 59, 999));
      return { start, end, tipo: 'diario' };
    }
    case 'mes_passado': {
      const lastMonth = new Date(brazilToday.year, brazilToday.month - 2, 1);
      const lastDayOfLastMonth = new Date(brazilToday.year, brazilToday.month - 1, 0).getDate();
      const start = new Date(Date.UTC(lastMonth.getFullYear(), lastMonth.getMonth(), 1, 3, 0, 0, 0));
      const end = new Date(Date.UTC(lastMonth.getFullYear(), lastMonth.getMonth(), lastDayOfLastMonth + 1, 2, 59, 59, 999));
      return { start, end, tipo: 'diario' };
    }
    case 'ultimos_3_meses': {
      const startRef = new Date(brazilToday.year, brazilToday.month - 2, 1);
      const start = new Date(Date.UTC(startRef.getFullYear(), startRef.getMonth(), 1, 3, 0, 0, 0));
      const end = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, 1, 2, 59, 59, 999));
      return { start, end, tipo: 'mensal' };
    }
    case 'ultimos_6_meses': {
      const startRef = new Date(brazilToday.year, brazilToday.month - 5, 1);
      const start = new Date(Date.UTC(startRef.getFullYear(), startRef.getMonth(), 1, 3, 0, 0, 0));
      const end = new Date(Date.UTC(brazilToday.year, brazilToday.month - 1, 1, 2, 59, 59, 999));
      return { start, end, tipo: 'mensal' };
    }
    case 'todos':
    default: {
      return { start: new Date(0), end: now, tipo: 'mensal' };
    }
  }
}

function groupByPeriod(vendas: any[], tipo: 'mensal' | 'semanal' | 'diario') {
  const grupos = new Map<string, any[]>();
  
  for (const venda of vendas) {
    const data = new Date(venda.dataVenda);
    let chave: string;
    
    switch (tipo) {
      case 'mensal':
        chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
        break;
      case 'semanal':
        // Melhor cálculo para semana
        const startOfYear = new Date(data.getFullYear(), 0, 1);
        const dayOfYear = Math.floor((data.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
        const weekOfYear = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);
        chave = `${data.getFullYear()}-W${String(weekOfYear).padStart(2, '0')}`;
        break;
      case 'diario':
        chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
        break;
      default:
        chave = data.toISOString().split('T')[0];
    }
    
    if (!grupos.has(chave)) {
      grupos.set(chave, []);
    }
    grupos.get(chave)!.push(venda);
  }
  
  return grupos;
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
    const accountPlatformParam = url.searchParams.get("accountPlatform"); // 'meli' | 'shopee'
    const accountIdParam = url.searchParams.get("accountId");

    let start: Date;
    let end: Date;
    let tipo: 'mensal' | 'semanal' | 'diario';
    let usarTodasVendas = false;

    if (dataInicioParam && dataFimParam) {
      // Período personalizado
      // Ajuste para incluir o dia final por completo (fuso-independente)
      start = new Date(dataInicioParam);
      const endBase = new Date(dataFimParam);
      end = new Date(endBase.getTime() + (24 * 60 * 60 * 1000 - 1));
      
      // Determinar tipo baseado na duração
      const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 31) {
        tipo = 'diario';
      } else if (diffDays <= 90) {
        tipo = 'semanal';
      } else {
        tipo = 'mensal';
      }
    } else if (periodoParam === "todos") {
      // Para "todos", buscar todas as vendas primeiro para determinar o range real
      usarTodasVendas = true;
      start = new Date(0);
      end = new Date();
      tipo = 'mensal'; // Padrão, será ajustado depois
    } else {
      const range = getDateRange(periodoParam);
      start = range.start;
      end = range.end;
      tipo = range.tipo;
    }

    // Aplicar filtros usando helpers centralizados
    const statusWhere = getStatusWhere(statusParam);
    const canalWhere = getCanalWhere(canalParam);
    const tipoWhere = getTipoAnuncioWhere(tipoAnuncioParam);
    const modalidadeWhere = getModalidadeWhere(modalidadeParam);
    // WhereClause para Mercado Livre (com tipoAnuncio e modalidade)
    const whereClauseMeli = usarTodasVendas
      ? { 
          userId: session.sub, 
          ...(accountPlatformParam === 'meli' && accountIdParam ? { meliAccountId: accountIdParam } : {}),
          ...statusWhere, 
          ...canalWhere, 
          ...tipoWhere, 
          ...modalidadeWhere 
        }
      : { 
          userId: session.sub, 
          dataVenda: { gte: start, lte: end }, 
          ...(accountPlatformParam === 'meli' && accountIdParam ? { meliAccountId: accountIdParam } : {}),
          ...statusWhere, 
          ...canalWhere, 
          ...tipoWhere, 
          ...modalidadeWhere 
        };

    // WhereClause para Shopee (sem tipoAnuncio e modalidade)
    const whereClauseShopee = usarTodasVendas
      ? { 
          userId: session.sub, 
          ...(accountPlatformParam === 'shopee' && accountIdParam ? { shopeeAccountId: accountIdParam } : {}),
          ...statusWhere, 
          ...canalWhere 
        }
      : { 
          userId: session.sub, 
          dataVenda: { gte: start, lte: end }, 
          ...(accountPlatformParam === 'shopee' && accountIdParam ? { shopeeAccountId: accountIdParam } : {}),
          ...statusWhere, 
          ...canalWhere 
        };

    // Buscar vendas do Mercado Livre
    const vendasMeli = await prisma.meliVenda.findMany({
      where: whereClauseMeli,
      select: {
        dataVenda: true,
        valorTotal: true,
        taxaPlataforma: true,
        frete: true,
        quantidade: true,
        sku: true,
      },
      distinct: ['orderId'],
      orderBy: { dataVenda: "asc" },
    });

    // Buscar vendas do Shopee
    const vendasShopee = await prisma.shopeeVenda.findMany({
      where: whereClauseShopee,
      select: {
        dataVenda: true,
        valorTotal: true,
        taxaPlataforma: true,
        frete: true,
        quantidade: true,
        sku: true,
      },
      distinct: ['orderId'],
      orderBy: { dataVenda: "asc" },
    });

    // Consolidar vendas baseado no filtro de canal
    let vendas;
    if (canalParam === 'mercado_livre') {
      vendas = vendasMeli;
    } else if (canalParam === 'shopee') {
      vendas = vendasShopee;
    } else {
      // Se 'todos' ou não especificado, combinar ambas
      vendas = [...vendasMeli, ...vendasShopee];
    }

    // Se não há vendas, retornar array vazio
    if (vendas.length === 0) {
      return NextResponse.json([]);
    }

    // Para "todos", determinar o range real baseado nas vendas existentes
    if (usarTodasVendas) {
      const primeiraVenda = new Date(vendas[0].dataVenda);
      const ultimaVenda = new Date(vendas[vendas.length - 1].dataVenda);
      
      // Calcular duração total em dias
      const diffDays = Math.ceil((ultimaVenda.getTime() - primeiraVenda.getTime()) / (1000 * 60 * 60 * 24));
      
      // Ajustar tipo baseado na duração real das vendas
      if (diffDays <= 31) {
        tipo = 'diario';
      } else if (diffDays <= 180) {
        tipo = 'semanal';
      } else {
        tipo = 'mensal';
      }
      
      start = primeiraVenda;
      end = ultimaVenda;
    }

    // Buscar custos dos SKUs
    const skusUnicos = Array.from(
      new Set(vendas.map((v) => v.sku).filter((s): s is string => Boolean(s)))
    );

    const skuCustos = skusUnicos.length
      ? await prisma.sKU.findMany({
          where: { userId: session.sub, sku: { in: skusUnicos } },
          select: { sku: true, custoUnitario: true },
        })
      : [];

    const mapaCustos = new Map(skuCustos.map((s) => [s.sku, toNumber(s.custoUnitario)]));

    // Agrupar vendas por período
    const gruposPorPeriodo = groupByPeriod(vendas, tipo);

    // Processar cada período
    const dadosGrafico = [];
    const periodosOrdenados = Array.from(gruposPorPeriodo.keys()).sort();

    for (const chave of periodosOrdenados) {
      const vendasPeriodo = gruposPorPeriodo.get(chave)!;
      
      let faturamento = 0;
      let taxaPlataforma = 0;
      let frete = 0;
      let cmv = 0;

      for (const venda of vendasPeriodo) {
        const vt = toNumber(venda.valorTotal);
        const tp = Math.abs(toNumber(venda.taxaPlataforma));
        const fr = Math.abs(toNumber(venda.frete));
        const qtd = toNumber(venda.quantidade);
        const custoUnit = venda.sku && mapaCustos.has(venda.sku) ? mapaCustos.get(venda.sku)! : 0;

        faturamento += vt;
        taxaPlataforma += tp;
        frete += fr;
        cmv += custoUnit * qtd;
      }

      // Calcular métricas derivadas
      const impostos = 0; // Ainda não implementado
      const margemContribuicao = faturamento - taxaPlataforma - frete;
      const lucroBruto = margemContribuicao - cmv;

      // Usar a primeira venda do período para determinar a data de referência
      const dataReferencia = vendasPeriodo[0]?.dataVenda ? new Date(vendasPeriodo[0].dataVenda) : new Date();
      const periodoFormatado = formatPeriodo(dataReferencia, tipo);

      dadosGrafico.push({
        periodo: periodoFormatado,
        faturamento: Math.round(faturamento * 100) / 100,
        impostos: Math.round(impostos * 100) / 100,
        taxaPlataforma: Math.round(taxaPlataforma * 100) / 100,
        frete: Math.round(frete * 100) / 100,
        margemContribuicao: Math.round(margemContribuicao * 100) / 100,
        cmv: Math.round(cmv * 100) / 100,
        lucroBruto: Math.round(lucroBruto * 100) / 100,
        _dataReferencia: dataReferencia, // Campo interno para debug
        _chave: chave, // Campo interno para debug
      });
    }

    // Se não há dados, retornar array vazio
    if (dadosGrafico.length === 0) {
      return NextResponse.json([]);
    }

    return NextResponse.json(dadosGrafico);
  } catch (err) {
    console.error("Erro ao calcular dados da série temporal:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
