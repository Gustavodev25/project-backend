import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
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
    const categoriaIds = categoriaIdsParam ? categoriaIdsParam.split(",").filter(Boolean) : [];
    const tipoParam = (url.searchParams.get("tipo") || "despesas").toLowerCase(); // despesas | receitas
    const tipoDataParam = (url.searchParams.get("tipoData") || "caixa").toLowerCase() as 'caixa' | 'competencia'; // caixa | competencia

    // Calcular períodos separados
    const periodoPagamento = calcularPeriodo(filtroPeriodoPagamento, filtroDataPagInicio, filtroDataPagFim);
    const periodoCompetencia = calcularPeriodo(filtroPeriodoCompetencia, filtroDataCompInicio, filtroDataCompFim);
    
    // Período geral (backward compatibility)
    const periodoGeral = calcularPeriodo(periodoParam, dataInicioParam, dataFimParam);
    const { start, end } = periodoGeral;

    if (tipoParam === "receitas") {
      // Contas a receber por categoria
      const where: any = {
        userId: session.sub,
        AND: []
      };
      
      // Aplicar filtros de data (pagamento ou competência)
      if (filtroPeriodoPagamento && filtroPeriodoPagamento !== "todos") {
        where.AND.push({
          OR: [
            { dataRecebimento: { gte: periodoPagamento.start, lte: periodoPagamento.end } },
            { AND: [{ dataRecebimento: null }, { dataVencimento: { gte: periodoPagamento.start, lte: periodoPagamento.end } }] },
          ]
        });
      } else if (!filtroPeriodoPagamento || filtroPeriodoPagamento === "todos") {
        // Backward compatibility
        where.OR = [
          { dataRecebimento: { gte: start, lte: end } },
          { AND: [{ dataRecebimento: null }, { dataVencimento: { gte: start, lte: end } }] },
        ];
        delete where.AND;
      }
      
      if (where.AND && where.AND.length === 0) delete where.AND;
      if (portadorIdParam) where.formaPagamentoId = String(portadorIdParam);
      if (categoriaIds.length > 0) where.categoriaId = { in: categoriaIds };

      const rows = await prisma.contaReceber.findMany({
        where,
        select: {
          valor: true,
          dataRecebimento: true,
          dataVencimento: true,
          categoria: { select: { id: true, nome: true, descricao: true } },
        },
      });

      const out = buildCategorySeries(rows.map(r => ({
        date: r.dataRecebimento || r.dataVencimento,
        valor: toNumber(r.valor),
        categoria: r.categoria?.descricao || r.categoria?.nome || "Sem categoria",
      })));
      return NextResponse.json(out);
    }

    // Default: despesas (contas a pagar)
    const where: any = {
      userId: session.sub,
      AND: []
    };
    
    // Aplicar filtro de pagamento (se não for "todos")
    if (filtroPeriodoPagamento && filtroPeriodoPagamento !== "todos") {
      where.AND.push({
        OR: [
          { dataPagamento: { gte: periodoPagamento.start, lte: periodoPagamento.end } },
          { AND: [{ dataPagamento: null }, { dataVencimento: { gte: periodoPagamento.start, lte: periodoPagamento.end } }] },
        ]
      });
    }
    
    // Aplicar filtro de competência (se não for "todos")
    if (filtroPeriodoCompetencia && filtroPeriodoCompetencia !== "todos") {
      where.AND.push({
        OR: [
          { dataCompetencia: { gte: periodoCompetencia.start, lte: periodoCompetencia.end } },
          { AND: [{ dataCompetencia: null }, { dataVencimento: { gte: periodoCompetencia.start, lte: periodoCompetencia.end } }] },
        ]
      });
    }
    
    // Se nenhum filtro específico, usar filtro antigo (backward compatibility)
    if ((!filtroPeriodoPagamento || filtroPeriodoPagamento === "todos") && 
        (!filtroPeriodoCompetencia || filtroPeriodoCompetencia === "todos")) {
      where.OR = tipoDataParam === 'caixa'
        ? [
            { dataPagamento: { gte: start, lte: end } },
            { AND: [{ dataPagamento: null }, { dataVencimento: { gte: start, lte: end } }] },
          ]
        : [
            { dataCompetencia: { gte: start, lte: end } },
            { AND: [{ dataCompetencia: null }, { dataVencimento: { gte: start, lte: end } }] },
          ];
      delete where.AND;
    } else if (where.AND.length === 0) {
      delete where.AND;
    }
    
    if (portadorIdParam) where.formaPagamentoId = String(portadorIdParam);
    if (categoriaIds.length > 0) where.categoriaId = { in: categoriaIds };

    const rows = await prisma.contaPagar.findMany({
      where,
      select: {
        valor: true,
        dataPagamento: true,
        dataVencimento: true,
        dataCompetencia: true,
        categoria: { select: { id: true, nome: true, descricao: true } },
      },
    });

    const data = rows.map(r => ({
      date: tipoDataParam === 'caixa'
        ? (r.dataPagamento || r.dataVencimento)
        : (r.dataCompetencia || r.dataVencimento),
      valor: toNumber(r.valor),
      categoria: r.categoria?.descricao || r.categoria?.nome || "Sem categoria",
    }));

    const out = buildCategorySeries(data);
    return NextResponse.json(out);
  } catch (err) {
    console.error("Erro ao calcular séries de categorias (financeiro):", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

function buildCategorySeries(rows: Array<{ date: Date | string | null; valor: number; categoria: string }>) {
  // Agrupar por dia e categoria
  const byDay = new Map<string, Map<string, number>>();
  const catTotals = new Map<string, number>();

  for (const r of rows) {
    if (!r.date) continue;
    const d = new Date(r.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const cat = r.categoria || "Sem categoria";
    const val = Number.isFinite(r.valor) ? r.valor : 0;

    if (!byDay.has(key)) byDay.set(key, new Map<string, number>());
    const dayMap = byDay.get(key)!;
    dayMap.set(cat, (dayMap.get(cat) || 0) + val);

    catTotals.set(cat, (catTotals.get(cat) || 0) + val);
  }

  // Top categorias
  const topN = 5;
  const sortedCats = Array.from(catTotals.entries()).sort((a, b) => b[1] - a[1]);
  const topCats = sortedCats.slice(0, topN).map(([c]) => c);

  // Montar série (datas ordenadas)
  const dates = Array.from(byDay.keys()).sort();
  const data = dates.map(date => {
    const entry: any = { date };
    const dayMap = byDay.get(date)!;
    let others = 0;
    for (const [cat, val] of dayMap.entries()) {
      if (topCats.includes(cat)) {
        entry[cat] = val;
      } else {
        others += val;
      }
    }
    if (others > 0) entry["Outras"] = others;
    // garantir zeros
    for (const c of topCats) entry[c] = entry[c] || 0;
    return entry;
  });

  const categories = [...topCats];
  if (sortedCats.length > topN) categories.push("Outras");

  return { categories, data };
}

