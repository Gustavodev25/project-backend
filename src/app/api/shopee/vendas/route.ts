import { NextRequest, NextResponse } from "next/server";
import { assertSessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { cache, createCacheKey } from "@/lib/cache";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await assertSessionToken(req.cookies.get("session")?.value);
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  try {
    // Verificar cache primeiro (TTL de 5 minutos)
    const cacheKey = createCacheKey("vendas-shopee", session.sub);
    const cachedData = cache.get<any>(cacheKey, 300000);
    
    if (cachedData) {
      console.log(`[Cache Hit] Retornando vendas do Shopee do cache`);
      return NextResponse.json(cachedData);
    }

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "10000"); // Aumentado para 10000
    const offset = (page - 1) * limit;

    // Calcular data de início: 6 meses atrás para visualização na tabela
    const hoje = new Date();
    const dataInicio = new Date(hoje);
    dataInicio.setMonth(dataInicio.getMonth() - 6); // Voltar 6 meses
    
    console.log(`[Shopee] Filtrando vendas a partir de: ${dataInicio.toISOString()}`);

    // Buscar vendas Shopee do usuário
    const vendas = await prisma.shopeeVenda.findMany({
      where: { 
        userId: session.sub,
        dataVenda: {
          gte: dataInicio, // Filtrar vendas >= data de início (últimos 6 meses)
        }
      },
      select: {
        id: true, // Campo essencial para React keys
        orderId: true,
        dataVenda: true,
        status: true,
        conta: true,
        shopeeAccountId: true,
        valorTotal: true,
        quantidade: true,
        unitario: true,
        taxaPlataforma: true,
        frete: true,
        freteAjuste: true,
        margemContribuicao: true, // Campo essencial
        isMargemReal: true, // Campo essencial
        titulo: true,
        sku: true,
        comprador: true,
        logisticType: true,
        envioMode: true,
        shippingStatus: true,
        shippingId: true,
        paymentMethod: true,
        paymentStatus: true,
        latitude: true,
        longitude: true,
        plataforma: true,
        canal: true,
        tags: true,
        internalTags: true,
        sincronizadoEm: true,
        paymentDetails: true, // Dados do escrow para cálculos de frete
        shipmentDetails: true, // Dados de envio incluindo shipping_carrier
      },
      orderBy: { dataVenda: "desc" },
      skip: offset,
      take: limit,
    });

    // Contar total de vendas
    const total = await prisma.shopeeVenda.count({
      where: { 
        userId: session.sub,
        dataVenda: {
          gte: dataInicio, // Filtrar vendas >= data de início (últimos 6 meses)
        }
      },
    });

    // Buscar última sincronização
    const lastSync = await prisma.shopeeVenda.findFirst({
      where: { userId: session.sub },
      orderBy: { sincronizadoEm: "desc" },
      select: { sincronizadoEm: true },
    });

    console.log(`[Shopee API] ✅ Retornando ${vendas.length} vendas (total no banco: ${total})`);

    // Mapear vendas para usar orderId como id (assim como Mercado Livre)
    const vendasMapeadas = vendas.map((venda) => ({
      ...venda,
      id: venda.orderId, // Usar orderId como id para exibição
    }));

    const response = {
      vendas: vendasMapeadas,
      total,
      lastSync: lastSync?.sincronizadoEm?.toISOString() || null,
    };

    // Armazenar no cache
    cache.set(cacheKey, response);
    console.log(`[Cache Miss] Vendas do Shopee salvas no cache`);

    return NextResponse.json(response);
  } catch (error) {
    console.error("Erro ao buscar vendas Shopee:", error);
    return new NextResponse("Erro interno do servidor", { status: 500 });
  }
}
