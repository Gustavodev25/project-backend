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
    const agrupamentoSKUParam = url.searchParams.get("agrupamentoSKU") || "mlb";
    const accountIdParam = url.searchParams.get("accountId");

    let start: Date;
    let end: Date;
    let usarTodasVendas = false;

    if (dataInicioParam && dataFimParam) {
      // Período personalizado
      // Atenção: datas chegam em ISO (UTC) a partir do cliente. Para incluir o
      // dia final completo independentemente do fuso horário, somamos quase 24h.
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

    // Adicionar filtro de conta específica se fornecido
    const accountWhere = accountIdParam ? { meliAccountId: accountIdParam } : {};
    const accountWhereShopee = accountIdParam ? { shopeeAccountId: accountIdParam } : {};

    // WhereClause para Mercado Livre (com tipoAnuncio e modalidade)
    const whereClauseMeli = usarTodasVendas
      ? { userId: session.sub, ...statusWhere, ...canalWhere, ...tipoWhere, ...modalidadeWhere, ...accountWhere }
      : { userId: session.sub, dataVenda: { gte: start, lte: end }, ...statusWhere, ...canalWhere, ...tipoWhere, ...modalidadeWhere, ...accountWhere };

    // WhereClause para Shopee (sem tipoAnuncio e modalidade)
    const whereClauseShopee = usarTodasVendas
      ? { userId: session.sub, ...statusWhere, ...canalWhere, ...accountWhereShopee }
      : { userId: session.sub, dataVenda: { gte: start, lte: end }, ...statusWhere, ...canalWhere, ...accountWhereShopee };

    // Buscar vendas do Mercado Livre
    const vendasMeli = await prisma.meliVenda.findMany({
      where: whereClauseMeli,
      select: {
        titulo: true,
        sku: true,
        valorTotal: true,
        taxaPlataforma: true,
        frete: true,
        quantidade: true,
        dataVenda: true,
        plataforma: true,
      },
      distinct: ['orderId'],
      orderBy: { dataVenda: "desc" },
    });

    // Buscar vendas do Shopee
    const vendasShopee = await prisma.shopeeVenda.findMany({
      where: whereClauseShopee,
      select: {
        titulo: true,
        sku: true,
        valorTotal: true,
        taxaPlataforma: true,
        frete: true,
        quantidade: true,
        dataVenda: true,
        plataforma: true,
      },
      distinct: ['orderId'],
      orderBy: { dataVenda: "desc" },
    });

    // Consolidar vendas baseado no filtro de canal
    let vendas: any[];
    if (canalParam === 'mercado_livre') {
      vendas = vendasMeli;
    } else if (canalParam === 'shopee') {
      vendas = vendasShopee;
    } else {
      // Se 'todos' ou não especificado, combinar ambas
      vendas = [...vendasMeli, ...vendasShopee];
    }

    console.log(`[TopProdutosMargem] Encontradas ${vendas.length} vendas no período`);
    console.log(`[TopProdutosMargem] Filtro de conta: ${accountIdParam || 'todas'}`);
    if (vendas.length > 0) {
      console.log(`[TopProdutosMargem] Primeira venda: ${vendas[0].titulo} - Faturamento: ${vendas[0].valorTotal}`);
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

    // Buscar dados de SKU para agrupamento inteligente
    const skusData = await prisma.sKU.findMany({
      where: { userId: session.sub },
      select: {
        sku: true,
        produto: true,
        tipo: true,
        hierarquia1: true,
        hierarquia2: true,
      },
    });

    // Criar mapa de SKUs para lookup rápido
    const skuMap = new Map<string, typeof skusData[0]>();
    skusData.forEach(sku => {
      skuMap.set(sku.sku, sku);
    });

    // Função para determinar a chave de agrupamento baseada no filtro
    function getGroupingKey(venda: typeof vendas[0]): string {
      const skuData = skuMap.get(venda.sku || "");
      
      switch (agrupamentoSKUParam) {
        case "sku":
          return venda.sku || venda.titulo;
        case "hierarquia1":
          return skuData?.hierarquia1 || "Sem Hierarquia 1";
        case "hierarquia2":
          return skuData?.hierarquia2 || "Sem Hierarquia 2";
        case "kit":
          return skuData?.tipo === "pai" ? "Kits" : "Produtos Individuais";
        case "mlb":
        default:
          return venda.sku || venda.titulo;
      }
    }

    // Função para determinar o nome de exibição baseado no agrupamento
    function getDisplayName(venda: typeof vendas[0], groupingKey: string): string {
      const skuData = skuMap.get(venda.sku || "");
      
      switch (agrupamentoSKUParam) {
        case "sku":
          return venda.titulo.length > 30 
            ? venda.titulo.substring(0, 30) + "..." 
            : venda.titulo;
        case "hierarquia1":
          return groupingKey;
        case "hierarquia2":
          return groupingKey;
        case "kit":
          return groupingKey;
        case "mlb":
        default:
          return venda.titulo.length > 30 
            ? venda.titulo.substring(0, 30) + "..." 
            : venda.titulo;
      }
    }

    // Agrupar por produto/SKU baseado no filtro
    const produtosMap = new Map<string, {
      produto: string;
      sku: string;
      faturamento: number;
      taxaPlataforma: number;
      frete: number;
      cmv: number;
      quantidade: number;
    }>();

    for (const venda of vendas) {
      const groupingKey = getGroupingKey(venda);
      const faturamento = toNumber(venda.valorTotal);
      const taxaPlataforma = Math.abs(toNumber(venda.taxaPlataforma));
      const frete = Math.abs(toNumber(venda.frete));
      const quantidade = toNumber(venda.quantidade);
      const custoUnit = venda.sku && mapaCustos.has(venda.sku) ? mapaCustos.get(venda.sku)! : 0;
      const cmv = custoUnit * quantidade;

      const displayName = getDisplayName(venda, groupingKey);

      if (produtosMap.has(groupingKey)) {
        const existing = produtosMap.get(groupingKey)!;
        existing.faturamento += faturamento;
        existing.taxaPlataforma += taxaPlataforma;
        existing.frete += frete;
        existing.cmv += cmv;
        existing.quantidade += quantidade;
      } else {
        produtosMap.set(groupingKey, {
          produto: displayName,
          sku: venda.sku || "",
          faturamento,
          taxaPlataforma,
          frete,
          cmv,
          quantidade,
        });
      }
    }

    // Converter para array e calcular margem de contribuição
    const produtos = Array.from(produtosMap.values()).map(produto => {
      const margemContribuicao = produto.faturamento - produto.taxaPlataforma - produto.frete - produto.cmv;
      const percentualMargem = produto.faturamento > 0 ? (margemContribuicao / produto.faturamento) * 100 : 0;
      
      return {
        produto: produto.produto,
        sku: produto.sku,
        margemContribuicao: Math.round(margemContribuicao * 100) / 100,
        faturamento: Math.round(produto.faturamento * 100) / 100,
        cmv: Math.round(produto.cmv * 100) / 100,
        percentualMargem: Math.round(percentualMargem * 100) / 100,
        quantidade: produto.quantidade,
      };
    });

    // Ordenar por margem de contribuição (maior para menor) e pegar top 10
    const topProdutos = produtos
      .sort((a, b) => b.margemContribuicao - a.margemContribuicao)
      .slice(0, 10);

    console.log(`[TopProdutosMargem] Produtos processados: ${produtos.length}`);
    console.log(`[TopProdutosMargem] Top 3 produtos:`, topProdutos.slice(0, 3).map(p => ({
      produto: p.produto,
      margem: p.margemContribuicao,
      faturamento: p.faturamento
    })));

    return NextResponse.json(topProdutos);
  } catch (err) {
    console.error("Erro ao calcular top produtos margem:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
