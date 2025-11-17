import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { assertSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isCanceled(status?: string | null): boolean {
  if (!status) return false;
  return status.toLowerCase().includes("cancel");
}

function isCMVCategory(nome?: string | null, descricao?: string | null): boolean {
  const normalized = `${nome || ""} ${descricao || ""}`.toLowerCase();
  return normalized.includes("cmv") || normalized.includes("cpv") || normalized.includes("csp");
}

// Helper para calcular período baseado no tipo
function calcularPeriodo(periodo: string | null, dataInicio: string | null, dataFim: string | null): { start: Date; end: Date } {
  const now = new Date();
  
  if (dataInicio && dataFim) {
    const start = new Date(dataInicio);
    const endBase = new Date(dataFim);
    return {
      start,
      end: new Date(endBase.getTime() + (24 * 60 * 60 * 1000 - 1))
    };
  }
  
  if (periodo) {
    switch (periodo) {
      case "hoje": {
        const inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const fim = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        return { start: inicio, end: fim };
      }
      case "ontem": {
        const ontem = new Date(now);
        ontem.setDate(ontem.getDate() - 1);
        const inicio = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 0, 0, 0, 0);
        const fim = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate(), 23, 59, 59, 999);
        return { start: inicio, end: fim };
      }
      case "mes_passado": {
        const primeiroDia = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const ultimoDia = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        return { start: primeiroDia, end: ultimoDia };
      }
      case "este_mes": {
        return { start: startOfMonth(now), end: endOfMonth(now) };
      }
      case "todos":
      default:
        return { start: new Date(0), end: new Date() };
    }
  }
  
  return { start: new Date(0), end: new Date() };
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
    
    // Filtros separados de pagamento e competência
    const filtroPeriodoPagamento = url.searchParams.get("filtroPeriodoPagamento");
    const filtroDataPagInicio = url.searchParams.get("filtroDataPagInicio");
    const filtroDataPagFim = url.searchParams.get("filtroDataPagFim");
    const filtroPeriodoCompetencia = url.searchParams.get("filtroPeriodoCompetencia");
    const filtroDataCompInicio = url.searchParams.get("filtroDataCompInicio");
    const filtroDataCompFim = url.searchParams.get("filtroDataCompFim");
    
    // Parâmetros gerais (backward compatibility)
    const periodoParam = url.searchParams.get("periodo");
    const dataInicioParam = url.searchParams.get("dataInicio");
    const dataFimParam = url.searchParams.get("dataFim");
    const portadorIdParam = url.searchParams.get("portadorId");
    const categoriaIdsParam = url.searchParams.get("categoriaIds");
    const tipoParam = (url.searchParams.get("tipo") || "caixa").toLowerCase() as "caixa" | "competencia";
    const categoriaIds = categoriaIdsParam ? categoriaIdsParam.split(",").filter(Boolean) : [];

    // Calcular períodos separados
    const periodoPagamento = calcularPeriodo(filtroPeriodoPagamento, filtroDataPagInicio, filtroDataPagFim);
    const periodoCompetencia = calcularPeriodo(filtroPeriodoCompetencia, filtroDataCompInicio, filtroDataCompFim);
    
    // Período geral para vendas (usar período antigo para backward compatibility)
    const periodoVendas = calcularPeriodo(periodoParam, dataInicioParam, dataFimParam);
    const { start, end } = periodoVendas;
    
    console.log('[Dashboard Stats] Filtros aplicados:', {
      pagamento: { periodo: filtroPeriodoPagamento, start: periodoPagamento.start.toISOString(), end: periodoPagamento.end.toISOString() },
      competencia: { periodo: filtroPeriodoCompetencia, start: periodoCompetencia.start.toISOString(), end: periodoCompetencia.end.toISOString() },
      vendas: { start: start.toISOString(), end: end.toISOString() },
      tipoVisualizacao: tipoParam
    });

    // 1) Vendas do período (inclui canceladas para alinhar com o DRE)
    const [vendasMeli, vendasShopee] = await Promise.all([
      prisma.meliVenda.findMany({
        where: { userId: session.sub, dataVenda: { gte: start, lte: end } },
        select: {
          valorTotal: true,
          taxaPlataforma: true,
          frete: true,
          quantidade: true,
          sku: true,
          plataforma: true,
          status: true,
          orderId: true,
        },
        distinct: ["orderId"],
      }),
      prisma.shopeeVenda.findMany({
        where: { userId: session.sub, dataVenda: { gte: start, lte: end } },
        select: {
          valorTotal: true,
          taxaPlataforma: true,
          frete: true,
          quantidade: true,
          sku: true,
          plataforma: true,
          status: true,
          orderId: true,
        },
        distinct: ["orderId"],
      }),
    ]);

    const vendasConfirmadas = [
      ...vendasMeli.filter((v) => !isCanceled(v.status)),
      ...vendasShopee.filter((v) => !isCanceled(v.status)),
    ];

    type VendaResumo = typeof vendasMeli[number] | typeof vendasShopee[number];

    // CMV com base em custos dos SKUs das vendas confirmadas
    const skusUnicos = Array.from(
      new Set(vendasConfirmadas.map((v) => v.sku).filter((s): s is string => Boolean(s))),
    );
    const skuCustos = skusUnicos.length
      ? await prisma.sKU.findMany({
          where: { userId: session.sub, sku: { in: skusUnicos } },
          select: { sku: true, custoUnitario: true },
        })
      : [];
    const mapaCustos = new Map(skuCustos.map((s) => [s.sku, toNumber(s.custoUnitario)]));

    let faturamentoTotal = 0;
    let deducoesReceita = 0;
    let taxasTotalAbs = 0;
    let freteTotalAbs = 0;
    let cmvTotal = 0;

    const taxasPorPlataforma = new Map<string, number>();
    const fretePorPlataforma = new Map<string, number>();

    const acumularPorPlataforma = (map: Map<string, number>, plataforma: string, valor: number) => {
      map.set(plataforma, (map.get(plataforma) || 0) + valor);
    };

    const processarVenda = (venda: VendaResumo, plataforma: "Mercado Livre" | "Shopee") => {
      const valorTotal = toNumber(venda.valorTotal);
      faturamentoTotal += valorTotal;

      if (isCanceled(venda.status)) {
        deducoesReceita += valorTotal;
        return;
      }

      const taxaAbs = Math.abs(toNumber(venda.taxaPlataforma));
      const freteAbs = Math.abs(toNumber(venda.frete));
      const quantidade = toNumber(venda.quantidade);
      const custoUnit = venda.sku && mapaCustos.has(venda.sku) ? mapaCustos.get(venda.sku)! : 0;

      taxasTotalAbs += taxaAbs;
      freteTotalAbs += freteAbs;
      acumularPorPlataforma(taxasPorPlataforma, plataforma, taxaAbs);
      acumularPorPlataforma(fretePorPlataforma, plataforma, freteAbs);
      cmvTotal += custoUnit * quantidade;
    };

    for (const venda of vendasMeli) {
      processarVenda(venda, "Mercado Livre");
    }
    for (const venda of vendasShopee) {
      processarVenda(venda, "Shopee");
    }

    // 2) Despesas operacionais no período (contas a pagar)
    let categoriaIdsParaFiltro = categoriaIds;
    if (categoriaIds.length === 0) {
      const todasCategoriasDespesa = await prisma.categoria.findMany({
        where: {
          userId: session.sub,
          tipo: { equals: "DESPESA", mode: "insensitive" },
          ativo: true  // Incluir apenas categorias ativas para consistência com o filtro
        },
        select: { id: true },
      });
      categoriaIdsParaFiltro = todasCategoriasDespesa.map((c) => c.id);
    }

    // Construir filtro de despesas com AMBOS os filtros (pagamento E competência)
    const whereDespesas: Prisma.ContaPagarWhereInput = {
      userId: session.sub,
      AND: []
    };
    
    // Aplicar filtro de pagamento (se não for "todos")
    if (filtroPeriodoPagamento && filtroPeriodoPagamento !== "todos") {
      (whereDespesas.AND as any[]).push({
        OR: [
          { dataPagamento: { gte: periodoPagamento.start, lte: periodoPagamento.end } },
          { AND: [{ dataPagamento: null }, { dataVencimento: { gte: periodoPagamento.start, lte: periodoPagamento.end } }] },
        ]
      });
    }
    
    // Aplicar filtro de competência (se não for "todos")
    if (filtroPeriodoCompetencia && filtroPeriodoCompetencia !== "todos") {
      (whereDespesas.AND as any[]).push({
        OR: [
          { dataCompetencia: { gte: periodoCompetencia.start, lte: periodoCompetencia.end } },
          { AND: [{ dataCompetencia: null }, { dataVencimento: { gte: periodoCompetencia.start, lte: periodoCompetencia.end } }] },
        ]
      });
    }
    
    // Se nenhum filtro específico, usar filtro antigo (backward compatibility)
    if ((!filtroPeriodoPagamento || filtroPeriodoPagamento === "todos") && 
        (!filtroPeriodoCompetencia || filtroPeriodoCompetencia === "todos")) {
      whereDespesas.OR = tipoParam === "caixa"
        ? [
            { dataPagamento: { gte: start, lte: end } },
            { AND: [{ dataPagamento: null }, { dataVencimento: { gte: start, lte: end } }] },
          ]
        : [
            { dataCompetencia: { gte: start, lte: end } },
            { AND: [{ dataCompetencia: { equals: null } }, { dataVencimento: { gte: start, lte: end } }] },
          ];
      delete whereDespesas.AND;
    } else if ((whereDespesas.AND as any[]).length === 0) {
      // Se AND está vazio, remover
      delete whereDespesas.AND;
    }
    
    if (portadorIdParam) whereDespesas.formaPagamentoId = String(portadorIdParam);
    if (categoriaIdsParaFiltro.length > 0) whereDespesas.categoriaId = { in: categoriaIdsParaFiltro };

    const despesas = await prisma.contaPagar.findMany({
      where: whereDespesas,
      select: {
        valor: true,
        categoriaId: true,
        categoria: { select: { nome: true, descricao: true } },
      },
    });

    const cmvCategoryCache = new Map<string, boolean>();
    let despesasOperacionais = 0;
    for (const despesa of despesas) {
      const valor = toNumber(despesa.valor);
      despesasOperacionais += valor;

      const categoriaId = despesa.categoriaId || "";
      let ehCMV = false;
      if (categoriaId && cmvCategoryCache.has(categoriaId)) {
        ehCMV = cmvCategoryCache.get(categoriaId)!;
      } else {
        ehCMV = isCMVCategory(despesa.categoria?.nome, despesa.categoria?.descricao);
        if (categoriaId) {
          cmvCategoryCache.set(categoriaId, ehCMV);
        }
      }
      if (ehCMV) {
        cmvTotal += valor;
      }
    }

    const receitaLiquida = faturamentoTotal - deducoesReceita;
    const receitaOperacionalLiquida = receitaLiquida - taxasTotalAbs - freteTotalAbs;
    const lucroBruto = receitaOperacionalLiquida - cmvTotal;
    const lucroLiquido = lucroBruto - despesasOperacionais;

    return NextResponse.json({
      faturamentoBruto: faturamentoTotal,
      deducoesReceita,
      taxasPlataformas: {
        total: taxasTotalAbs,
        mercadoLivre: taxasPorPlataforma.get("Mercado Livre") || 0,
        shopee: taxasPorPlataforma.get("Shopee") || 0,
      },
      custoFrete: {
        total: freteTotalAbs,
        mercadoLivre: fretePorPlataforma.get("Mercado Livre") || 0,
        shopee: fretePorPlataforma.get("Shopee") || 0,
      },
      receitaLiquida,
      receitaOperacionalLiquida,
      cmv: cmvTotal,
      lucroBruto,
      despesasOperacionais,
      lucroLiquido,
      periodo: { start: start.toISOString(), end: end.toISOString() },
    });
  } catch (err) {
    console.error("Erro ao calcular stats do dashboard financeiro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
