import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";
import { cache, createCacheKey } from "@/lib/cache";

export const runtime = "nodejs";

function roundCurrency(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

type JsonRecord = Record<string, unknown>;

type OrderItem = {
  item?: {
    listing_type_id?: string | null;
  } | null;
};

type RawDataWithOrder = JsonRecord & {
  order?: JsonRecord;
  freight?: JsonRecord;
  shipment?: JsonRecord | null;
};

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  try {
    session = await assertSessionToken(sessionCookie);
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    // Verificar cache primeiro (TTL de 5 minutos)
    const cacheKey = createCacheKey("vendas-geral", session.sub);
    const cachedData = cache.get<any>(cacheKey, 300000);
    
    if (cachedData) {
      console.log(`[Cache Hit] Retornando vendas gerais do cache`);
      return NextResponse.json(cachedData);
    }

    // Calcular data de início: 6 meses atrás (alinhado com ML e Shopee)
    const hoje = new Date();
    const dataInicio = new Date(hoje);
    dataInicio.setMonth(dataInicio.getMonth() - 6); // Voltar 6 meses
    
    console.log(`[Vendas Gerais] Filtrando vendas a partir de: ${dataInicio.toISOString()}`);
    console.log(`[Vendas Gerais] Buscando vendas para userId: ${session.sub}`);

    // Buscar vendas do Mercado Livre e Shopee em PARALELO para melhor performance
    const [vendasMeli, vendasShopee] = await Promise.all([
      prisma.meliVenda.findMany({
        where: { 
          userId: session.sub,
          dataVenda: {
            gte: dataInicio, // Filtrar vendas >= data de início (últimos 6 meses)
          }
        },
        select: {
          orderId: true,
          dataVenda: true,
          status: true,
          conta: true,
          meliAccountId: true,
          valorTotal: true,
          quantidade: true,
          unitario: true,
          taxaPlataforma: true,
          frete: true,
          freteAjuste: true,
          titulo: true,
          sku: true,
          comprador: true,
          logisticType: true,
          envioMode: true,
          shippingStatus: true,
          shippingId: true,
          exposicao: true,
          tipoAnuncio: true,
          ads: true,
          plataforma: true,
          canal: true,
          tags: true,
          internalTags: true,
          latitude: true,
          longitude: true,
          rawData: true,
          sincronizadoEm: true,
          meliAccount: {
            select: { nickname: true, ml_user_id: true },
          },
        },
        orderBy: { dataVenda: "desc" },
      }),
      prisma.shopeeVenda.findMany({
        where: { 
          userId: session.sub,
          dataVenda: {
            gte: dataInicio, // Filtrar vendas >= data de início (últimos 6 meses)
          }
        },
        select: {
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
          titulo: true,
          sku: true,
          comprador: true,
          logisticType: true,
          envioMode: true,
          shippingStatus: true,
          shippingId: true,
          plataforma: true,
          canal: true,
          tags: true,
          internalTags: true,
          sincronizadoEm: true,
          latitude: true,
          longitude: true,
          paymentDetails: true,
          shipmentDetails: true,
        },
        orderBy: { dataVenda: "desc" },
      })
    ]);

    console.log(`[Vendas Gerais] ✅ Mercado Livre: ${vendasMeli.length} vendas encontradas`);
    console.log(`[Vendas Gerais] ✅ Shopee: ${vendasShopee.length} vendas encontradas`);

    // Buscar SKUs únicos para cálculo de CMV
    const skusUnicos = Array.from(
      new Set([
        ...vendasMeli.map((v) => v.sku).filter(Boolean) as string[],
        ...vendasShopee.map((v) => v.sku).filter(Boolean) as string[],
      ]),
    );

    const skuCustos = await prisma.sKU.findMany({
      where: {
        userId: session.sub,
        sku: { in: skusUnicos },
      },
      select: {
        sku: true,
        custoUnitario: true,
      },
    });

    const mapaCustos = new Map(
      skuCustos.map((sku) => [sku.sku, Number(sku.custoUnitario)]),
    );

    // Formatar vendas do Mercado Livre
    const vendasMeliFormatted = vendasMeli.map((venda) => {
      let cmv: number | null = null;
      if (venda.sku && mapaCustos.has(venda.sku)) {
        const custoUnitario = mapaCustos.get(venda.sku)!;
        cmv = roundCurrency(custoUnitario * venda.quantidade);
      }

      const valorTotal = Number(venda.valorTotal);
      const taxaPlataforma = venda.taxaPlataforma
        ? Number(venda.taxaPlataforma)
        : 0;
      const frete = Number(venda.frete);

      let margemContribuicao: number;
      let isMargemReal: boolean;
      if (cmv !== null && cmv > 0) {
        margemContribuicao = roundCurrency(
          valorTotal + taxaPlataforma + frete - cmv,
        );
        isMargemReal = true;
      } else {
        margemContribuicao = roundCurrency(valorTotal + taxaPlataforma + frete);
        isMargemReal = false;
      }

      const rawData =
        venda.rawData && typeof venda.rawData === "object"
          ? (venda.rawData as RawDataWithOrder)
          : null;

      const freightData =
        rawData && rawData.freight && typeof rawData.freight === "object"
          ? (rawData.freight as JsonRecord)
          : {};

      const shipmentData =
        rawData && rawData.shipment && typeof rawData.shipment === "object"
          ? (rawData.shipment as JsonRecord)
          : null;

      const receiverAddress =
        shipmentData &&
        typeof (shipmentData as JsonRecord).receiver_address === "object"
          ? ((shipmentData as JsonRecord).receiver_address as JsonRecord)
          : null;

      const rawOrder =
        rawData && rawData.order && typeof rawData.order === "object"
          ? (rawData.order as JsonRecord)
          : null;

      let orderItems: OrderItem[] = [];
      if (rawOrder && "order_items" in rawOrder) {
        const maybeItems = (rawOrder as { order_items?: unknown }).order_items;
        if (Array.isArray(maybeItems)) {
          orderItems = maybeItems.filter(
            (entry): entry is OrderItem =>
              typeof entry === "object" && entry !== null,
          );
        }
      }

      const firstOrderItem = orderItems[0] ?? null;
      const listingTypeId =
        firstOrderItem && typeof firstOrderItem === "object"
          ? ((firstOrderItem.item?.listing_type_id as string | undefined) ??
            null)
          : null;

      return {
        id: venda.orderId,
        dataVenda: venda.dataVenda.toISOString(),
        status: venda.status,
        conta: venda.conta,
        meliAccountId: venda.meliAccountId,
        valorTotal,
        quantidade: venda.quantidade,
        unitario: Number(venda.unitario),
        taxaPlataforma: venda.taxaPlataforma
          ? Number(venda.taxaPlataforma)
          : null,
        frete,
        freteAjuste: venda.freteAjuste ? Number(venda.freteAjuste) : null,
        cmv,
        margemContribuicao,
        isMargemReal,
        titulo: venda.titulo,
        sku: venda.sku,
        comprador: venda.comprador,
        logisticType: venda.logisticType,
        envioMode: venda.envioMode,
        shippingStatus: venda.shippingStatus,
        shippingId: venda.shippingId,
        exposicao: venda.exposicao,
        tipoAnuncio: venda.tipoAnuncio,
        ads: venda.ads,
        plataforma: venda.plataforma,
        canal: venda.canal,
        tags: venda.tags,
        internalTags: venda.internalTags,
        latitude:
          venda.latitude !== null && venda.latitude !== undefined
            ? Number(venda.latitude)
            : null,
        longitude:
          venda.longitude !== null && venda.longitude !== undefined
            ? Number(venda.longitude)
            : null,
        raw: {
          listing_type_id: listingTypeId,
          tags: venda.tags,
          internal_tags: venda.internalTags,
        },
        preco: valorTotal,
        shipping: freightData,
        shipment: shipmentData,
        receiverAddress,
        sincronizadoEm: venda.sincronizadoEm.toISOString(),
      };
    });

    // Formatar vendas do Shopee
    const vendasShopeeFormatted = vendasShopee.map((venda) => {
      let cmv: number | null = null;
      if (venda.sku && mapaCustos.has(venda.sku)) {
        const custoUnitario = mapaCustos.get(venda.sku)!;
        cmv = roundCurrency(custoUnitario * venda.quantidade);
      }

      const valorTotal = Number(venda.valorTotal);
      const taxaPlataforma = venda.taxaPlataforma
        ? Number(venda.taxaPlataforma)
        : 0;
      const frete = Number(venda.frete);

      let margemContribuicao: number;
      let isMargemReal: boolean;
      if (cmv !== null && cmv > 0) {
        margemContribuicao = roundCurrency(
          valorTotal + taxaPlataforma + frete - cmv,
        );
        isMargemReal = true;
      } else {
        margemContribuicao = roundCurrency(valorTotal + taxaPlataforma + frete);
        isMargemReal = false;
      }

      return {
        id: venda.orderId,
        dataVenda: venda.dataVenda.toISOString(),
        status: venda.status,
        conta: venda.conta,
        valorTotal,
        quantidade: venda.quantidade,
        unitario: Number(venda.unitario),
        taxaPlataforma: venda.taxaPlataforma
          ? Number(venda.taxaPlataforma)
          : null,
        frete,
        freteAjuste: venda.freteAjuste ? Number(venda.freteAjuste) : null,
        cmv,
        margemContribuicao,
        isMargemReal,
        titulo: venda.titulo,
        sku: venda.sku,
        comprador: venda.comprador,
        logisticType: venda.logisticType,
        envioMode: venda.envioMode,
        shippingStatus: venda.shippingStatus,
        shippingId: venda.shippingId,
        exposicao: null, // Shopee não tem exposição
        tipoAnuncio: null, // Shopee não tem tipo de anúncio
        ads: null, // Shopee não tem ADS
        plataforma: venda.plataforma,
        canal: venda.canal,
        tags: venda.tags,
        internalTags: venda.internalTags,
        latitude: venda.latitude !== null && venda.latitude !== undefined
          ? Number(venda.latitude)
          : null,
        longitude: venda.longitude !== null && venda.longitude !== undefined
          ? Number(venda.longitude)
          : null,
        raw: {
          listing_type_id: null,
          tags: venda.tags,
          internal_tags: venda.internalTags,
          paymentDetails: (venda as any).paymentDetails || {},
          shipmentDetails: (venda as any).shipmentDetails || {},
        },
        paymentDetails: (venda as any).paymentDetails || {},
        shipmentDetails: (venda as any).shipmentDetails || {},
        preco: valorTotal,
        shipping: {},
        shipment: null,
        receiverAddress: null,
        sincronizadoEm: venda.sincronizadoEm.toISOString(),
      };
    });

    // Combinar e ordenar todas as vendas por data
    const todasVendas = [...vendasMeliFormatted, ...vendasShopeeFormatted].sort(
      (a, b) => new Date(b.dataVenda).getTime() - new Date(a.dataVenda).getTime()
    );

    // Buscar última sincronização geral
    const ultimaSyncMeli = vendasMeli.length > 0 ? vendasMeli[0].sincronizadoEm : null;
    const ultimaSyncShopee = vendasShopee.length > 0 ? vendasShopee[0].sincronizadoEm : null;
    
    let ultimaSyncGeral = null;
    if (ultimaSyncMeli && ultimaSyncShopee) {
      ultimaSyncGeral = ultimaSyncMeli > ultimaSyncShopee ? ultimaSyncMeli : ultimaSyncShopee;
    } else if (ultimaSyncMeli) {
      ultimaSyncGeral = ultimaSyncMeli;
    } else if (ultimaSyncShopee) {
      ultimaSyncGeral = ultimaSyncShopee;
    }

    const response = {
      vendas: todasVendas,
      total: todasVendas.length,
      lastSync: ultimaSyncGeral?.toISOString() || null,
    };

    // Armazenar no cache
    cache.set(cacheKey, response);
    console.log(`[Cache Miss] Vendas gerais (${todasVendas.length} vendas) salvas no cache`);
    console.log(`[Vendas Gerais] ✅ Retornando ${todasVendas.length} vendas combinadas (ML: ${vendasMeliFormatted.length}, Shopee: ${vendasShopeeFormatted.length})`);

    return NextResponse.json(response);
  } catch (error) {
    console.error("Erro ao buscar vendas gerais:", error);
    return new NextResponse("Erro interno do servidor", { status: 500 });
  }
}
