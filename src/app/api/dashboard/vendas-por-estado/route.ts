import { NextRequest, NextResponse } from "next/server";
import { assertSessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

// API para obter vendas agrupadas por estado (UF) do Brasil
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mapeamento de estados brasileiros
const ESTADOS_BR = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

/**
 * Extrai o estado (UF) do rawData de uma venda
 * Funciona para Mercado Livre e Shopee
 */
function extrairEstado(rawData: any): string | null {
  if (!rawData) return null;

  try {
    // Mercado Livre: shipping.receiver_address.state.id
    if (rawData.shipping?.receiver_address?.state?.id) {
      const uf = rawData.shipping.receiver_address.state.id.toUpperCase();
      if (ESTADOS_BR.includes(uf)) return uf;
    }

    // Shopee: recipient_address.state
    if (rawData.recipient_address?.state) {
      const uf = rawData.recipient_address.state.toUpperCase();
      if (ESTADOS_BR.includes(uf)) return uf;
    }

    // Shopee alternativo: shipping_address.state
    if (rawData.shipping_address?.state) {
      const uf = rawData.shipping_address.state.toUpperCase();
      if (ESTADOS_BR.includes(uf)) return uf;
    }

    // Fallback: buscar qualquer campo que tenha "state" ou "uf"
    const jsonStr = JSON.stringify(rawData).toUpperCase();
    for (const estado of ESTADOS_BR) {
      if (jsonStr.includes(`"${estado}"`)) {
        return estado;
      }
    }
  } catch (error) {
    console.error("[VendasPorEstado] Erro ao extrair estado:", error);
  }

  return null;
}

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  
  try {
    session = await assertSessionToken(sessionCookie);
  } catch (error) {
    console.error("[VendasPorEstado] Erro de autenticação:", error);
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  try {
    const userId = session.sub;
    if (!userId) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    // Obter filtros da query string
    const { searchParams } = new URL(req.url);
    const periodo = searchParams.get("periodo") || "todos";
    const canal = searchParams.get("canal") || "todos";
    const status = searchParams.get("status") || "pagos";

    // Calcular datas de filtro
    let dataInicio: Date | null = null;
    let dataFim: Date | null = null;

    if (periodo !== "todos") {
      const hoje = new Date();
      hoje.setHours(23, 59, 59, 999);

      if (periodo === "hoje") {
        dataInicio = new Date(hoje);
        dataInicio.setHours(0, 0, 0, 0);
      } else if (periodo === "ontem") {
        dataInicio = new Date(hoje);
        dataInicio.setDate(dataInicio.getDate() - 1);
        dataInicio.setHours(0, 0, 0, 0);
        dataFim = new Date(dataInicio);
        dataFim.setHours(23, 59, 59, 999);
      } else if (periodo === "ultimos7dias") {
        dataInicio = new Date(hoje);
        dataInicio.setDate(dataInicio.getDate() - 7);
        dataInicio.setHours(0, 0, 0, 0);
      } else if (periodo === "ultimos30dias") {
        dataInicio = new Date(hoje);
        dataInicio.setDate(dataInicio.getDate() - 30);
        dataInicio.setHours(0, 0, 0, 0);
      } else if (periodo === "mes_atual") {
        dataInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        dataInicio.setHours(0, 0, 0, 0);
      } else if (periodo === "mes_anterior") {
        dataInicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
        dataFim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
        dataFim.setHours(23, 59, 59, 999);
      }

      if (!dataFim) {
        dataFim = hoje;
      }
    }

    // Buscar vendas do Mercado Livre
    const vendasMeliPromise = canal === "shopee" 
      ? Promise.resolve([])
      : prisma.meliVenda.findMany({
          where: {
            userId,
            ...(dataInicio && { dataVenda: { gte: dataInicio } }),
            ...(dataFim && { dataVenda: { lte: dataFim } }),
            ...(status === "pagos" && { status: { in: ["paid", "delivered"] } }),
          },
          select: {
            id: true,
            valorTotal: true,
            rawData: true,
          },
        });

    // Buscar vendas do Shopee
    const vendasShopeePromise = canal === "mercado_livre"
      ? Promise.resolve([])
      : prisma.shopeeVenda.findMany({
          where: {
            userId,
            ...(dataInicio && { dataVenda: { gte: dataInicio } }),
            ...(dataFim && { dataVenda: { lte: dataFim } }),
            ...(status === "pagos" && { status: { in: ["COMPLETED", "SHIPPED"] } }),
          },
          select: {
            id: true,
            valorTotal: true,
            rawData: true,
          },
        });

    const [vendasMeli, vendasShopee] = await Promise.all([
      vendasMeliPromise,
      vendasShopeePromise,
    ]);

    // Agrupar vendas por estado
    const vendasPorEstado: Record<string, { quantidade: number; valor: number }> = {};

    // Inicializar todos os estados com 0
    ESTADOS_BR.forEach(uf => {
      vendasPorEstado[uf] = { quantidade: 0, valor: 0 };
    });

    // Processar vendas do Mercado Livre
    vendasMeli.forEach(venda => {
      const estado = extrairEstado(venda.rawData);
      if (estado && ESTADOS_BR.includes(estado)) {
        vendasPorEstado[estado].quantidade += 1;
        vendasPorEstado[estado].valor += Number(venda.valorTotal);
      }
    });

    // Processar vendas do Shopee
    vendasShopee.forEach(venda => {
      const estado = extrairEstado(venda.rawData);
      if (estado && ESTADOS_BR.includes(estado)) {
        vendasPorEstado[estado].quantidade += 1;
        vendasPorEstado[estado].valor += Number(venda.valorTotal);
      }
    });

    // Calcular totais
    const totalVendas = Object.values(vendasPorEstado).reduce((acc, e) => acc + e.quantidade, 0);
    const totalValor = Object.values(vendasPorEstado).reduce((acc, e) => acc + e.valor, 0);

    // Converter para array e ordenar
    const estados = Object.entries(vendasPorEstado).map(([uf, data]) => ({
      uf,
      quantidade: data.quantidade,
      valor: Math.round(data.valor * 100) / 100,
      percentual: totalVendas > 0 ? Math.round((data.quantidade / totalVendas) * 10000) / 100 : 0,
    })).sort((a, b) => b.quantidade - a.quantidade);

    return NextResponse.json({
      estados,
      totals: {
        vendas: totalVendas,
        valor: Math.round(totalValor * 100) / 100,
      },
    });
  } catch (error) {
    console.error("[VendasPorEstado] Erro:", error);
    return NextResponse.json(
      { error: "Erro ao buscar vendas por estado" },
      { status: 500 }
    );
  }
}
