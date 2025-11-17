import { NextRequest, NextResponse } from "next/server";
import { assertSessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

// API para obter coordenadas (lat/lng) das vendas do Mercado Livre para mapa de calor
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Extrai latitude e longitude do rawData de uma venda do Mercado Livre
 */
function extrairCoordenadas(rawData: any): { lat: number; lng: number } | null {
  if (!rawData) return null;

  try {
    // Mercado Livre: shipping.receiver_address.latitude e longitude
    const lat = rawData.shipping?.receiver_address?.latitude;
    const lng = rawData.shipping?.receiver_address?.longitude;

    if (typeof lat === "number" && typeof lng === "number") {
      // Validar se está dentro do Brasil aproximadamente
      // Brasil: lat ~-33 a 5, lng ~-73 a -34
      if (lat >= -34 && lat <= 6 && lng >= -74 && lng <= -33) {
        return { lat, lng };
      }
    }

    // Tentar campos alternativos
    const altLat = rawData.shipping?.receiver_address?.geolocation_source?.latitude ||
                   rawData.buyer?.billing_info?.doc_number?.latitude;
    const altLng = rawData.shipping?.receiver_address?.geolocation_source?.longitude ||
                   rawData.buyer?.billing_info?.doc_number?.longitude;

    if (typeof altLat === "number" && typeof altLng === "number") {
      if (altLat >= -34 && altLat <= 6 && altLng >= -74 && altLng <= -33) {
        return { lat: altLat, lng: altLng };
      }
    }
  } catch (error) {
    console.error("[VendasCoordenadas] Erro ao extrair coordenadas:", error);
  }

  return null;
}

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  
  try {
    session = await assertSessionToken(sessionCookie);
  } catch (error) {
    console.error("[VendasCoordenadas] Erro de autenticação:", error);
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

    // Buscar vendas do Mercado Livre (apenas ML tem coordenadas confiáveis)
    const vendasMeli = await prisma.meliVenda.findMany({
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

    // Extrair coordenadas válidas
    const coordenadas: Array<{ lat: number; lng: number; valor: number }> = [];
    
    vendasMeli.forEach(venda => {
      const coords = extrairCoordenadas(venda.rawData);
      if (coords) {
        coordenadas.push({
          lat: coords.lat,
          lng: coords.lng,
          valor: Number(venda.valorTotal),
        });
      }
    });

    console.log(`[VendasCoordenadas] ${coordenadas.length} vendas com coordenadas de ${vendasMeli.length} vendas totais`);

    return NextResponse.json({
      coordenadas,
      total: coordenadas.length,
      totalVendas: vendasMeli.length,
      percentualComCoordenadas: vendasMeli.length > 0 
        ? Math.round((coordenadas.length / vendasMeli.length) * 100) 
        : 0,
    });
  } catch (error) {
    console.error("[VendasCoordenadas] Erro:", error);
    return NextResponse.json(
      { error: "Erro ao buscar coordenadas das vendas" },
      { status: 500 }
    );
  }
}
