/**
 * API de SincronizaÃ§Ã£o de Vendas do Mercado Livre
 *
 * OTIMIZAÃ‡Ã•ES IMPLEMENTADAS:
 * ============================
 *
 * 1. SINCRONIZAÃ‡ÃƒO INCREMENTAL INTELIGENTE:
 *    - Busca vendas progressivamente sem dar timeout (respeitando limite de 60s do Vercel)
 *    - Prioriza vendas mais recentes (mais importantes)
 *    - Vendas jÃ¡ existentes sÃ£o atualizadas (UPDATE), nÃ£o duplicadas
 *    - SincronizaÃ§Ãµes subsequentes continuam de onde a anterior parou
 *    - Suporta contas com 1k atÃ© 50k+ vendas
 *
 * 2. DIVISÃƒO AUTOMÃTICA DE PERÃODOS:
 *    - Quando um perÃ­odo tem mais de 9.950 vendas (limite da API do ML):
 *      * Detecta automaticamente o total de vendas no perÃ­odo
 *      * Divide em sub-perÃ­odos menores (7 ou 14 dias dependendo do volume)
 *      * Busca recursivamente cada sub-perÃ­odo
 *      * Garante sincronizaÃ§Ã£o completa sem perda de dados
 *
 * 3. SALVAMENTO EM LOTES OTIMIZADO:
 *    - Salva vendas em lotes de 50
 *    - Usa Promise.allSettled para garantir que erros nÃ£o parem o processo
 *    - Cache de SKU para reduzir queries ao banco
 *    - Sem delays desnecessÃ¡rios para mÃ¡xima velocidade
 *
 * 4. RETRY AUTOMÃTICO COM BACKOFF:
 *    - Tentativas automÃ¡ticas em caso de erros temporÃ¡rios (429, 500, 502, 503, 504)
 *    - Exponential backoff: 1s, 2s, 4s
 *    - AtÃ© 3 tentativas por requisiÃ§Ã£o
 *
 * 5. PROGRESSO EM TEMPO REAL:
 *    - Server-Sent Events (SSE) para comunicaÃ§Ã£o em tempo real
 *    - Mensagens detalhadas de progresso (pÃ¡gina atual, perÃ­odo, porcentagem)
 *    - MantÃ©m conexÃ£o viva durante o processo
 *
 * 6. GESTÃƒO DE TIMEOUT (Vercel Pro):
 *    - Limite de 60 segundos por funÃ§Ã£o (58s efetivos + 2s margem)
 *    - Monitora tempo de execuÃ§Ã£o constantemente
 *    - Para busca antes de atingir timeout
 *    - SincronizaÃ§Ã£o subsequente continua automaticamente
 *
 * COMO FUNCIONA:
 * ==============
 * 1. Busca atÃ© 2.500 vendas mais recentes com paginaÃ§Ã£o
 * 2. Se sobrar tempo (>15s), busca vendas antigas por perÃ­odos mensais
 * 3. Se um mÃªs tem > 9.950 vendas, divide em perÃ­odos de 7-14 dias recursivamente
 * 4. Salva todas as vendas em lotes de 50 no banco de dados
 * 5. Envia progresso em tempo real via SSE
 * 6. Informa se hÃ¡ vendas restantes para prÃ³xima sincronizaÃ§Ã£o
 *
 * EXEMPLO DE USO (conta com 10k vendas):
 * ======================================
 * Sync 1: 2.500 vendas recentes + 1.000 histÃ³ricas = 3.500 vendas (55s)
 * Sync 2: Atualiza recentes + 3.000 histÃ³ricas = 3.000 novas (52s)
 * Sync 3: Atualiza recentes + 3.500 histÃ³ricas = 3.500 novas (54s)
 * Total: 3 sincronizaÃ§Ãµes = histÃ³rico completo de 10k vendas (~3 min)
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";
import { refreshMeliAccountToken } from "@/lib/meli";
import { calcularFreteAdjust } from "@/lib/frete";
import type { MeliAccount } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { sendProgressToUser, closeUserConnections } from "@/lib/sse-progress";
import { invalidateVendasCache } from "@/lib/cache";

export const runtime = "nodejs";
export const maxDuration = 60; // 60 segundos (Vercel Pro)

const MELI_API_BASE =
  process.env.MELI_API_BASE?.replace(/\/$/, "") ||
  "https://api.mercadolibre.com";
const PAGE_LIMIT = 50;
const PAGE_FETCH_CONCURRENCY = Math.min(
  5,
  Math.max(1, Number(process.env.MELI_PAGE_FETCH_CONCURRENCY ?? "2") || 2),
);

type FreightSource = "shipment" | "order" | "shipping_option" | null;

type MeliOrderFreight = {
  logisticType: string | null;
  logisticTypeSource: FreightSource | null;
  shippingMode: string | null;

  baseCost: number | null;
  listCost: number | null;
  shippingOptionCost: number | null;
  shipmentCost: number | null;
  orderCostFallback: number | null;
  finalCost: number | null;
  finalCostSource: FreightSource;
  chargedCost: number | null;
  chargedCostSource: FreightSource;

  discount: number | null;
  totalAmount: number | null;
  quantity: number | null;
  unitPrice: number | null;
  diffBaseList: number | null;
  
  adjustedCost: number | null;
  adjustmentSource: string | null;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function roundCurrency(v: number): number {
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function truncateString(str: string | null | undefined, maxLength: number): string {
  if (!str) return "";
  return str.length > maxLength ? str.substring(0, maxLength) : str;
}

// Preserve complete JSON payloads (no truncation to keep shipping data intact)
function truncateJsonData<T>(data: T): T {
  return data === undefined ? (null as T) : data;
}

function extractOrderDate(order: unknown): Date | null {
  if (!order || typeof order !== "object") return null;
  const rawDate =
    (order as any)?.date_closed ??
    (order as any)?.date_created ??
    (order as any)?.date_last_updated ??
    null;
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}


// FunÃ§Ã£o para debug - identificar qual campo estÃ¡ causando o problema
function debugFieldLengths(data: any, orderId: string) {
  const fieldLengths: { [key: string]: number } = {};
  
  // Verificar todos os campos de string
  const stringFields = [
    'orderId', 'userId', 'meliAccountId', 'status', 'conta', 'titulo', 'sku', 
    'comprador', 'logisticType', 'envioMode', 'shippingStatus', 'shippingId',
    'exposicao', 'tipoAnuncio', 'ads', 'plataforma', 'canal'
  ];
  
  stringFields.forEach(field => {
    if (data[field] && typeof data[field] === 'string') {
      fieldLengths[field] = data[field].length;
    }
  });
  
  // Log apenas se algum campo for muito longo
  const longFields = Object.entries(fieldLengths).filter(([_, length]) => length > 100);
  if (longFields.length > 0) {
    console.log(`[DEBUG] Venda ${orderId} - Campos longos:`, longFields);
  }
  
  return fieldLengths;
}

function sumOrderQuantities(items: unknown): number | null {
  if (!Array.isArray(items)) return null;
  let total = 0;
  let counted = false;
  for (const it of items) {
    const q = toFiniteNumber((it as any)?.quantity);
    if (q !== null) {
      total += q;
      counted = true;
    }
  }
  return counted ? total : null;
}

function convertLogisticTypeName(logisticType: string | null): string | null {
  if (!logisticType) return logisticType;

  if (logisticType === "xd_drop_off") return "AgÃªncia";
  if (logisticType === "self_service") return "FLEX";
  if (logisticType === "cross_docking") return "Coleta";

  return logisticType;
}

function mapListingTypeToExposure(listingType: string | null): string | null {
  if (!listingType) return null;
  const normalized = listingType.toLowerCase();

  // gold_pro Ã© Premium
  if (normalized === "gold_pro") return "Premium";

  // gold_special e outros tipos gold sÃ£o ClÃ¡ssico
  if (normalized.startsWith("gold")) return "ClÃ¡ssico";

  // Silver Ã© ClÃ¡ssico
  if (normalized === "silver") return "ClÃ¡ssico";

  // Outros tipos defaultam para ClÃ¡ssico
  return "ClÃ¡ssico";
}

function calculateFreightAdjustment(
  logisticType: string | null,
  unitPrice: number | null,
  quantity: number | null,
  baseCost: number | null,
  listCost: number | null,
  shippingOptionCost: number | null,
  shipmentCost: number | null
): { adjustedCost: number | null; adjustmentSource: string | null } {
  if (!logisticType) return { adjustedCost: null, adjustmentSource: null };

  // order_cost total = unitÃ¡rio * quantidade  (equivalente ao SQL)
  const orderCost = unitPrice !== null && quantity ? unitPrice * quantity : null;

  const freteAdjust = calcularFreteAdjust({
    shipment_logistic_type: logisticType,
    base_cost: baseCost,
    shipment_list_cost: listCost,
    shipping_option_cost: shippingOptionCost,
    shipment_cost: shipmentCost,
    order_cost: orderCost,
    quantity: quantity ?? 0,
  });

  // Se vier o sentinela (Â±999) do SQL, ignora override
  if (Math.abs(freteAdjust) === 999) {
    return { adjustedCost: null, adjustmentSource: null };
  }

  // IMPORTANTE: 0 Ã© override vÃ¡lido (zera frete nos < 79 para NÃƒO-FLEX)
  const adj = roundCurrency(freteAdjust);

  const label =
    logisticType === 'self_service' ? 'FLEX' :
    logisticType === 'drop_off' ? 'Correios' :
    logisticType === 'xd_drop_off' ? 'AgÃªncia' :
    logisticType === 'fulfillment' ? 'FULL' :
    logisticType === 'cross_docking' ? 'Coleta' : logisticType;

  return { adjustedCost: adj, adjustmentSource: label };
}


function calculateFreight(order: any, shipment: any): MeliOrderFreight {
  const o = order ?? {};
  const s = shipment ?? {};
  const orderShipping = (o && typeof o.shipping === "object") ? o.shipping ?? {} : {};

  const shippingMode: string | null =
    typeof orderShipping.mode === "string" ? orderShipping.mode : null;

  const logisticTypeRaw: string | null =
    typeof s.logistic_type === "string" ? s.logistic_type : null;

  const logisticTypeFallback = shippingMode;
  const logisticType = logisticTypeRaw ?? logisticTypeFallback ?? null;
  const logisticTypeSource: FreightSource =
    logisticTypeRaw ? "shipment" : logisticTypeFallback ? "order" : null;

  const shipOpt = (s && typeof s.shipping_option === "object") ? s.shipping_option ?? {} : {};

  const baseCost = toFiniteNumber(s.base_cost);
  const optCost = toFiniteNumber((shipOpt as any).cost);
  const listCost = toFiniteNumber((shipOpt as any).list_cost);
  const shipCost = toFiniteNumber(s.cost);
  const orderCost = toFiniteNumber(orderShipping.cost);

  let chargedCost: number | null = null;
  let chargedCostSource: FreightSource = null;

  if (optCost !== null) {
    chargedCost = optCost;
    chargedCostSource = "shipping_option";
  } else if (shipCost !== null) {
    chargedCost = shipCost;
    chargedCostSource = "shipment";
  } else if (orderCost !== null) {
    chargedCost = orderCost;
    chargedCostSource = "order";
  }

  if (chargedCost !== null) chargedCost = roundCurrency(chargedCost);

  const discount =
    listCost !== null && chargedCost !== null
      ? roundCurrency(listCost - chargedCost)
      : null;

  const totalAmount = toFiniteNumber(o.total_amount);

  const items = Array.isArray(o.order_items) ? o.order_items : [];
  let quantity = sumOrderQuantities(items);
  if (quantity === null) {
    if (Array.isArray(items) && items.length > 0) quantity = items.length;
    else if (totalAmount !== null) quantity = 1;
  }

  let unitPrice: number | null = null;
  if (totalAmount !== null && quantity && quantity > 0) {
    unitPrice = roundCurrency(totalAmount / quantity);
  } else if (totalAmount !== null) {
    unitPrice = roundCurrency(totalAmount);
  }

  const diffBaseList =
    baseCost !== null && listCost !== null ? roundCurrency(baseCost - listCost) : null;

  const convertedLogisticType = convertLogisticTypeName(logisticType);
  const { adjustedCost, adjustmentSource } = calculateFreightAdjustment(
    logisticType,
    unitPrice,
    quantity,
    baseCost,
    listCost,
    optCost,
    shipCost
  );

  return {
    logisticType: convertedLogisticType,
    logisticTypeSource,
    shippingMode,
    baseCost,
    listCost,
    shippingOptionCost: optCost !== null ? roundCurrency(optCost) : null,
    shipmentCost: shipCost !== null ? roundCurrency(shipCost) : null,
    orderCostFallback: orderCost !== null ? roundCurrency(orderCost) : null,
    finalCost: chargedCost,
    finalCostSource: chargedCostSource,
    chargedCost,
    chargedCostSource,
    discount,
    totalAmount,
    quantity,
    unitPrice,
    diffBaseList,
    adjustedCost,
    adjustmentSource,
  };
}

/**
 * Calcula a margem de contribuiÃ§Ã£o seguindo a fÃ³rmula:
 * Margem = Valor Total + Taxa Plataforma + Frete - CMV
 * 
 * @param valorTotal - Valor total da venda (POSITIVO)
 * @param taxaPlataforma - Taxa da plataforma (JÃ DEVE VIR NEGATIVA)
 * @param frete - Valor do frete (pode ser + ou -)
 * @param cmv - Custo da Mercadoria Vendida (POSITIVO)
 * @returns Margem de contribuiÃ§Ã£o e se Ã© margem real ou receita lÃ­quida
 */
function calculateMargemContribuicao(
  valorTotal: number,
  taxaPlataforma: number | null,
  frete: number,
  cmv: number | null
): { valor: number; isMargemReal: boolean } {
  // Valores base (taxa jÃ¡ vem negativa, frete pode ser + ou -)
  const taxa = taxaPlataforma || 0;
  
  // Se temos CMV, calculamos a margem de contribuiÃ§Ã£o real
  // FÃ³rmula: Margem = Valor Total + Taxa Plataforma + Frete - CMV
  if (cmv !== null && cmv !== undefined && cmv > 0) {
    const margemContribuicao = valorTotal + taxa + frete - cmv;
    return {
      valor: roundCurrency(margemContribuicao),
      isMargemReal: true
    };
  }
  
  // Se nÃ£o temos CMV, retornamos a receita lÃ­quida
  // Receita LÃ­quida = Valor Total + Taxa Plataforma + Frete
  const receitaLiquida = valorTotal + taxa + frete;
  return {
    valor: roundCurrency(receitaLiquida),
    isMargemReal: false
  };
}

type MeliOrderPayload = {
  accountId: string;
  accountNickname: string | null;
  mlUserId: number;
  order: unknown;
  shipment?: unknown;
  freight: MeliOrderFreight;
};

type OrdersFetchResult = {
  orders: MeliOrderPayload[];
  expectedTotal: number;
};

type FetchOrdersResult = {
  orders: MeliOrderPayload[];
  expectedTotal: number;
  forcedStop: boolean;
};

type SyncError = {
  accountId: string;
  mlUserId: number;
  message: string;
};

type AccountSummary = {
  id: string;
  nickname: string | null;
  ml_user_id: number;
  expires_at: string;
};

type DateRangeWindow = {
  from: Date;
  to: Date;
  total: number;
  depth: number;
};

type SkuCacheEntry = {
  custoUnitario: number | null;
  tipo: string | null;
};

type FetchOrdersPageOptions = {
  account: MeliAccount;
  headers: Record<string, string>;
  userId: string;
  offset: number;
  pageNumber: number;
  dateFrom?: Date;
  dateTo?: Date;
};

type FetchOrdersPageResult = {
  offset: number;
  pageNumber: number;
  total: number | null;
  orders: MeliOrderPayload[];
};

/**
 * Verifica se um erro HTTP Ã© temporÃ¡rio e pode ser retentado
 */
function isRetryableError(status: number): boolean {
  return [429, 500, 502, 503, 504].includes(status);
}

/**
 * Aguarda um tempo especÃ­fico (exponential backoff)
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Faz uma requisiÃ§Ã£o HTTP com retry automÃ¡tico para erros temporÃ¡rios
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  userId?: string
): Promise<Response> {
  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      lastResponse = response;

      // Se sucesso, retorna imediatamente
      if (response.ok) {
        return response;
      }

      // Erros de autenticaÃ§Ã£o (401, 403) nÃ£o devem ser retryable - falhar imediatamente
      if (response.status === 401 || response.status === 403) {
        console.error(`[Sync] Erro de autenticaÃ§Ã£o ${response.status} - Token pode estar invÃ¡lido`);
        if (userId) {
          sendProgressToUser(userId, {
            type: "sync_warning",
            message: `Erro de autenticaÃ§Ã£o ${response.status}. Verifique se a conta estÃ¡ conectada corretamente.`,
            errorCode: response.status.toString()
          });
        }
        return response; // Retornar resposta de erro para tratamento especÃ­fico
      }

      // Se erro nÃ£o-retryable (exceto auth), retorna imediatamente
      if (!isRetryableError(response.status)) {
        console.warn(`[Sync] Erro HTTP ${response.status} (nÃ£o-retryable) em ${url.substring(0, 80)}...`);
        return response;
      }

      // Erro retryable - tentar novamente
      lastError = new Error(`HTTP ${response.status}`);

      // Calcular delay com exponential backoff
      const baseDelay = 1000; // 1 segundo
      const delay = baseDelay * Math.pow(2, attempt); // 1s, 2s, 4s
      const jitter = Math.random() * 1000; // atÃ© 1s de jitter
      const totalDelay = delay + jitter;

      console.warn(
        `[Retry] Erro ${response.status} em ${url.substring(0, 80)}... ` +
        `Tentativa ${attempt + 1}/${maxRetries}. Aguardando ${Math.round(totalDelay)}ms`
      );

      // Enviar aviso via SSE apenas na primeira tentativa
      if (userId && attempt === 0) {
        sendProgressToUser(userId, {
          type: "sync_warning",
          message: `Erro temporÃ¡rio ${response.status} da API do Mercado Livre. Tentando novamente...`,
          errorCode: response.status.toString()
        });
      }

      // Aguardar antes de tentar novamente
      await sleep(totalDelay);

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Log do erro
      console.error(`[Retry] Erro na requisiÃ§Ã£o (tentativa ${attempt + 1}/${maxRetries}):`, lastError.message);

      // Se Ã© a Ãºltima tentativa, lanÃ§ar erro
      if (attempt === maxRetries - 1) {
        if (userId) {
          sendProgressToUser(userId, {
            type: "sync_warning",
            message: `Erro de conexÃ£o apÃ³s ${maxRetries} tentativas: ${lastError.message}`,
            errorCode: "NETWORK_ERROR"
          });
        }
        throw lastError;
      }

      const baseDelay = 1000;
      const delay = baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * 1000;
      const totalDelay = delay + jitter;

      console.warn(
        `[Retry] Erro de rede em ${url.substring(0, 80)}... ` +
        `Tentativa ${attempt + 1}/${maxRetries}. Aguardando ${Math.round(totalDelay)}ms`
      );

      // Enviar aviso via SSE apenas na primeira tentativa
      if (userId && attempt === 0) {
        sendProgressToUser(userId, {
          type: "sync_warning",
          message: `Erro de conexÃ£o. Tentando novamente...`,
          errorCode: "NETWORK_ERROR"
        });
      }

      await sleep(totalDelay);
    }
  }

  // Se chegou aqui, todas as tentativas falharam
  if (lastResponse && !lastResponse.ok) {
    return lastResponse; // Retornar Ãºltima resposta de erro
  }

  throw lastError || new Error('Falha apÃ³s mÃºltiplas tentativas');
}

async function fetchOrdersPage({
  account,
  headers,
  userId,
  offset,
  pageNumber,
  dateFrom,
  dateTo,
}: FetchOrdersPageOptions): Promise<FetchOrdersPageResult> {
  const limit = PAGE_LIMIT;
  const url = new URL(`${MELI_API_BASE}/orders/search`);
  url.searchParams.set("seller", account.ml_user_id.toString());
  url.searchParams.set("sort", "date_desc");
  url.searchParams.set("limit", limit.toString());
  url.searchParams.set("offset", offset.toString());
  if (dateFrom) {
    url.searchParams.set("order.date_created.from", dateFrom.toISOString());
  }
  if (dateTo) {
    url.searchParams.set("order.date_created.to", dateTo.toISOString());
  }

  const result: FetchOrdersPageResult = {
    offset,
    pageNumber,
    total: null,
    orders: [],
  };

  let response: Response;
  let payload: any = null;

  try {
    response = await fetchWithRetry(url.toString(), { headers }, 3, userId);
  } catch (error) {
    console.error(`[Sync] âš ï¸ Erro ao buscar pÃ¡gina ${pageNumber}:`, error);
    sendProgressToUser(userId, {
      type: "sync_warning",
      message: `Erro ao buscar pÃ¡gina ${pageNumber}: ${
        error instanceof Error ? error.message : "Falha desconhecida"
      }`,
      errorCode: "PAGE_FETCH_ERROR",
    });
    return result;
  }

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  result.total =
    typeof payload?.paging?.total === "number" && Number.isFinite(payload.paging.total)
      ? payload.paging.total
      : null;

  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : `Status ${response.status}`;
    console.error(`[Sync] âš ï¸ Erro HTTP ${response.status} ao buscar pÃ¡gina ${pageNumber}:`, message);
    if (response.status === 400) {
      console.log(`[Sync] âš ï¸ Limite da API atingido em offset ${offset}`);
    }
    sendProgressToUser(userId, {
      type: "sync_warning",
      message: `Erro HTTP ${response.status} na pÃ¡gina ${pageNumber}: ${message}`,
      errorCode: response.status.toString(),
    });
    return result;
  }

  const orders = Array.isArray(payload?.results) ? payload.results : [];
  if (orders.length === 0) {
    console.log(`[Sync] ðŸ“„ PÃ¡gina ${pageNumber}: 0 vendas (offset ${offset})`);
    return result;
  }

  console.log(
    `[Sync] ðŸ“„ PÃ¡gina ${pageNumber}: ${orders.length} vendas (offset ${offset})${
      result.total ? ` (${Math.min(offset + orders.length, result.total)}/${result.total})` : ""
    }`,
  );

  // OTIMIZAÇÃO: Fetch shipments em batches menores para evitar rate limiting
  // Limite de 10 shipments concorrentes (ao invés de 50) para não sobrecarregar API
  const SHIPMENT_BATCH_SIZE = 10;
  const shipments: any[] = new Array(orders.length).fill(null);

  for (let i = 0; i < orders.length; i += SHIPMENT_BATCH_SIZE) {
    const batchOrders = orders.slice(i, i + SHIPMENT_BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batchOrders.map(async (order: any) => {
        const shippingId = order?.shipping?.id;
        if (!shippingId) {
          return typeof order?.shipping === "object" ? order.shipping : null;
        }
        try {
          const res = await fetchWithRetry(`${MELI_API_BASE}/shipments/${shippingId}`, { headers }, 3, userId);
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      })
    );

    // Mapear resultados para array de shipments
    batchResults.forEach((result, idx) => {
      const originalIdx = i + idx;
      if (result.status === "fulfilled" && result.value) {
        shipments[originalIdx] = result.value;
      } else {
        shipments[originalIdx] = typeof orders[originalIdx]?.shipping === "object"
          ? orders[originalIdx].shipping
          : null;
      }
    });
  }

  result.orders = orders
    .map((order: any, idx: number) => {
      if (!order) return null;
      const shipment = shipments[idx] ?? undefined;
      return {
        accountId: account.id,
        accountNickname: account.nickname,
        mlUserId: account.ml_user_id,
        order,
        shipment,
        freight: calculateFreight(order, shipment),
      };
    })
    .filter(Boolean) as MeliOrderPayload[];

  return result;
}

/**
 * FUNÃ‡ÃƒO OTIMIZADA: Busca vendas com limite de tempo (58s mÃ¡ximo)
 * - Prioriza vendas mais recentes primeiro
 * - Busca progressivamente vendas antigas
 * - Evita timeout do Vercel (60s)
 * - SincronizaÃ§Ãµes subsequentes continuam de onde parou
 */
async function fetchAllOrdersForAccount(
  account: MeliAccount,
  headers: Record<string, string>,
  userId: string,
  quickMode: boolean = false, // Novo parÃ¢metro para controle de modo
  fullSync: boolean = false, // Novo parÃ¢metro para sincronizaÃ§Ã£o completa desde 01/2025
): Promise<FetchOrdersResult> {
  const startTime = Date.now();
  // MUDANÃ‡A CRÃTICA: Em quickMode, buscar em 20s e deixar 40s para salvar no banco (total 60s)
  // Salvamento de 500 vendas ~5s, mas com margem de seguranÃ§a para contas grandes
  // Em background mode, pode usar atÃ© 45s de busca (deixa 15s para salvar ~1500 vendas)
  // OTIMIZAÇÃO: 30s fetch + 20s save = 50s total (margem 10s para 60s timeout)
  const MAX_EXECUTION_TIME = 30000; // SEMPRE 30 segundos
  const results: MeliOrderPayload[] = [];
  const logisticStats = new Map<string, number>();
  let forcedStop = false; // Declarar forcedStop localmente

  const modoTexto = fullSync
    ? 'FULL SYNC (buscar TODAS as vendas)'
    : (quickMode ? 'QUICK (20s busca + 40s salvar)' : 'BACKGROUND (45s busca + 15s salvar)');
  console.log(`[Sync] 🚀 Iniciando busca de vendas para conta ${account.ml_user_id} (${account.nickname}) - Modo: ${modoTexto}`);

  // Verificar venda mais antiga jÃ¡ sincronizada para continuar de onde parou
  const oldestSyncedOrder = await prisma.meliVenda.findFirst({
    where: { meliAccountId: account.id },
    orderBy: { dataVenda: 'asc' },
    select: { dataVenda: true }
  });

  const oldestSyncedDate = oldestSyncedOrder?.dataVenda;
  if (oldestSyncedDate) {
    console.log(`[Sync] ðŸ“… Venda mais antiga no banco: ${oldestSyncedDate.toISOString().split('T')[0]}`);
  } else {
    console.log(`[Sync] ðŸ“… Primeira sincronizaÃ§Ã£o - buscando desde o inÃ­cio`);
  }

  const MAX_OFFSET = 9950; // Limite seguro antes do 10k da API
  let total = 0;
  let discoveredTotal: number | null = null;
  let nextOffset = 0;
  // MUDANÃ‡A CRÃTICA: Em quickMode, buscar apenas 500 vendas para garantir tempo de salvar no banco
  // Salvamento de ~10k vendas demora ~30s, entÃ£o limitar busca para caber em 60s total
  // Em background, buscar 1500 vendas (mais conservador para evitar timeout)
  // LIMITE SEGURO: 100 vendas por sync (30s fetch + 15s save = 45s total)
  // 12k vendas = 120 syncs automáticos
  const SAFE_BATCH_SIZE = 100;
  let maxOffsetToFetch = Math.min(MAX_OFFSET, SAFE_BATCH_SIZE);
  const activePages = new Set<Promise<void>>();
  let oldestOrderDate: Date | null = null;

  const schedulePageFetch = (offsetValue: number) => {
    const pageNumber = Math.floor(offsetValue / PAGE_LIMIT) + 1;
    const pagePromise = (async () => {
      try {
        const pageResult = await fetchOrdersPage({
          account,
          headers,
          userId,
          offset: offsetValue,
          pageNumber,
        });

        if (
          typeof pageResult.total === "number" &&
          pageResult.total >= 0 &&
          discoveredTotal === null
        ) {
          discoveredTotal = pageResult.total;
          total = discoveredTotal;
          maxOffsetToFetch = Math.min(MAX_OFFSET, discoveredTotal);
          console.log(
            `[Sync] ?? Conta ${account.ml_user_id}: total estimado ${total} vendas`,
          );
        }

        if (pageResult.orders.length === 0) {
          return;
        }

        for (const payload of pageResult.orders) {
          results.push(payload);
          const logisticTypeRaw =
            payload.freight.logisticType || payload.freight.shippingMode || "sem_tipo";
          logisticStats.set(
            logisticTypeRaw,
            (logisticStats.get(logisticTypeRaw) || 0) + 1,
          );

          const createdAt = extractOrderDate(payload.order);
          if (createdAt && (!oldestOrderDate || createdAt < oldestOrderDate)) {
            oldestOrderDate = createdAt;
          }
        }

        sendProgressToUser(userId, {
          type: "sync_progress",
          message: `${account.nickname || `Conta ${account.ml_user_id}`}: ${
            results.length
          }/${discoveredTotal ?? results.length} vendas baixadas (pï¿½gina ${pageNumber})`,
          current: results.length,
          total: discoveredTotal ?? results.length,
          fetched: results.length,
          expected: discoveredTotal ?? results.length,
          accountId: account.id,
          accountNickname: account.nickname,
          page: pageNumber,
        });
      } catch (error) {
        console.error(`[Sync] ?? Erro inesperado na pï¿½gina ${pageNumber}:`, error);
        sendProgressToUser(userId, {
          type: "sync_warning",
          message: `Erro inesperado na pï¿½gina ${pageNumber}: ${
            error instanceof Error ? error.message : "Falha desconhecida"
          }`,
          errorCode: "PAGE_FETCH_ERROR",
        });
      }
    })();

    pagePromise.finally(() => activePages.delete(pagePromise));
    activePages.add(pagePromise);
  };

  // PASSO 1: Buscar vendas recentes (paginaÃ§Ã£o normal)
  while (activePages.size < PAGE_FETCH_CONCURRENCY && nextOffset < Math.min(MAX_OFFSET, maxOffsetToFetch)) {
    // Verificar tempo antes de continuar
    if (Date.now() - startTime > MAX_EXECUTION_TIME) {
      console.log(`[Sync] â±ï¸ Tempo limite atingido (${Math.round((Date.now() - startTime) / 1000)}s) - parando busca de vendas recentes`);
      forcedStop = true;
      break;
    }
    schedulePageFetch(nextOffset);
    nextOffset += PAGE_LIMIT;
  }

  while (activePages.size > 0) {
    await Promise.race(activePages);

    // Verificar tempo antes de continuar
    if (Date.now() - startTime > MAX_EXECUTION_TIME) {
      console.log(`[Sync] â±ï¸ Tempo limite atingido - parando paginaÃ§Ã£o`);
      forcedStop = true;
      break;
    }

    while (
      activePages.size < PAGE_FETCH_CONCURRENCY &&
      nextOffset < maxOffsetToFetch &&
      Date.now() - startTime < MAX_EXECUTION_TIME
    ) {
      schedulePageFetch(nextOffset);
      nextOffset += PAGE_LIMIT;
    }
  }

  if (discoveredTotal === null) {
    total = results.length;
  }

  // PASSO 2: Buscar vendas históricas apenas se NÃO atingiu o limite
  const timeRemaining = MAX_EXECUTION_TIME - (Date.now() - startTime);
  const reachedLimit = results.length >= SAFE_BATCH_SIZE;
  const shouldFetchHistory = !reachedLimit && timeRemaining > 10000;

  if (shouldFetchHistory && (total > results.length || oldestSyncedDate)) {
    console.log(`[Sync] ðŸ”„ Buscando vendas histÃ³ricas (tempo restante: ${Math.round(timeRemaining / 1000)}s)...`);

    // Determinar ponto de partida para busca histÃ³rica
    let searchStartDate: Date;

    if (oldestSyncedDate) {
      // Continuar de onde a Ãºltima sincronizaÃ§Ã£o parou
      searchStartDate = new Date(oldestSyncedDate);
      searchStartDate.setDate(searchStartDate.getDate() - 1); // Um dia antes da Ãºltima sincronizada
      console.log(`[Sync] ðŸ“… Continuando busca histÃ³rica a partir de ${searchStartDate.toISOString().split('T')[0]}`);
    } else {
      // Primeira vez: comeÃ§ar da venda mais antiga das recentes
      const fallbackOldest =
        results.length > 0
          ? extractOrderDate(results[results.length - 1].order) ?? new Date()
          : new Date();
      searchStartDate = oldestOrderDate ?? fallbackOldest;
      console.log(`[Sync] ðŸ“… Primeira busca histÃ³rica a partir de ${searchStartDate.toISOString().split('T')[0]}`);
    }

    // Buscar vendas mais antigas em blocos de 1 mÃªs
    const currentMonthStart = new Date(searchStartDate);
    currentMonthStart.setDate(1); // Primeiro dia do mÃªs
    currentMonthStart.setHours(0, 0, 0, 0);
    currentMonthStart.setMonth(currentMonthStart.getMonth() - 1); // ComeÃ§ar do mÃªs anterior

    // NOVA LÃ"GICA: Se fullSync, buscar TODAS as vendas (desde 2000). Caso contrÃ¡rio, buscar desde 2010.
    const startDate = fullSync ? new Date('2000-01-01') : new Date('2010-01-01');
    console.log(`[Sync] ${fullSync ? '🎯 FULL SYNC ativado - buscando TODAS as vendas (desde 2000)' : '📅 Modo incremental - buscando desde 2010'}`);

    // Buscar enquanto tiver tempo
    while (currentMonthStart > startDate && Date.now() - startTime < MAX_EXECUTION_TIME - 5000) {
      // Calcular fim do mÃªs
      const currentMonthEnd = new Date(currentMonthStart);
      currentMonthEnd.setMonth(currentMonthEnd.getMonth() + 1);
      currentMonthEnd.setDate(0); // Ãšltimo dia do mÃªs
      currentMonthEnd.setHours(23, 59, 59, 999);

      console.log(`[Sync] ðŸ“… Buscando: ${currentMonthStart.toISOString().split('T')[0]} a ${currentMonthEnd.toISOString().split('T')[0]}`);

      // Buscar vendas deste mÃªs
      const monthOrders = await fetchOrdersInDateRange(
        account,
        headers,
        userId,
        currentMonthStart,
        currentMonthEnd,
        logisticStats
      );

      console.log(`[Sync] âœ… Encontradas ${monthOrders.length} vendas neste perÃ­odo`);

      results.push(...monthOrders);

      sendProgressToUser(userId, {
        type: 'sync_progress',
        message: `${account.nickname || `Conta ${account.ml_user_id}`}: ${results.length} vendas baixadas (buscando histÃ³rico: ${currentMonthStart.toISOString().split('T')[0]})`,
        current: results.length,
        total: Math.max(total, results.length), // Usar o maior valor entre total estimado e vendas baixadas
        fetched: results.length,
        expected: Math.max(total, results.length),
        accountId: account.id,
        accountNickname: account.nickname,
      });

      // Se nÃ£o encontrou vendas neste mÃªs, chegou no inÃ­cio do histÃ³rico
      if (monthOrders.length === 0) {
        console.log(`[Sync] âœ… Nenhuma venda encontrada neste perÃ­odo - histÃ³rico completo!`);
        break;
      }

      // Ir para o mÃªs anterior
      currentMonthStart.setMonth(currentMonthStart.getMonth() - 1);
    }

    const elapsedTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`[Sync] âœ… Busca por perÃ­odo concluÃ­da em ${elapsedTime}s: ${results.length} vendas baixadas`);
    if (Date.now() - startTime >= MAX_EXECUTION_TIME - 5000 && currentMonthStart > startDate) {
      forcedStop = true;
    }
  } else if (!shouldFetchHistory && total > results.length) {
    if (timeRemaining <= 10000) {
      forcedStop = true;
    }
    console.log(`[Sync] â±ï¸ Tempo insuficiente para busca histÃ³rica - execute sincronizaÃ§Ã£o novamente para continuar`);
  }

  // Calcular estatÃ­sticas finais
  const elapsedTime = Math.round((Date.now() - startTime) / 1000);
  const finalTotal = Math.max(total, results.length);

  console.log(`[Sync] ðŸŽ‰ ${results.length} vendas baixadas em ${elapsedTime}s (total estimado: ${total})`);
  console.log(`[Sync] ðŸ“Š Tipos de logÃ­stica:`, Array.from(logisticStats.entries()));

  // Verificar se hÃ¡ mais vendas para sincronizar
  const totalInDatabase = await prisma.meliVenda.count({
    where: { meliAccountId: account.id }
  });

  if (totalInDatabase < total) {
    const remaining = total - totalInDatabase;
    console.log(`[Sync] ðŸ“Œ ${remaining} vendas restantes - execute sincronizaÃ§Ã£o novamente para continuar`);
    sendProgressToUser(userId, {
      type: 'sync_warning',
      message: `${remaining} vendas antigas ainda nÃ£o sincronizadas. Execute sincronizaÃ§Ã£o novamente para buscar o restante.`,
      accountId: account.id,
      accountNickname: account.nickname || undefined
    });
  } else {
    console.log(`[Sync] âœ… HistÃ³rico completo sincronizado!`);
  }

  return { orders: results, expectedTotal: finalTotal, forcedStop };
}

/**
 * Busca vendas em um perÃ­odo especÃ­fico (para contornar limite de 10k)
 * Se o perÃ­odo tiver mais de 9.950 vendas, divide em sub-perÃ­odos automaticamente
 */
async function fetchOrdersInDateRange(
  account: MeliAccount,
  headers: Record<string, string>,
  userId: string,
  dateFrom: Date,
  dateTo: Date,
  logisticStats: Map<string, number>,
): Promise<MeliOrderPayload[]> {
  const results: MeliOrderPayload[] = [];
  let offset = 0;
  const MAX_OFFSET = 9950;
  let totalInPeriod = 0;
  let needsSplitting = false;

  // Primeira requisiÃ§Ã£o para verificar quantas vendas existem no perÃ­odo
  const checkUrl = new URL(`${MELI_API_BASE}/orders/search`);
  checkUrl.searchParams.set("seller", account.ml_user_id.toString());
  checkUrl.searchParams.set("sort", "date_desc");
  checkUrl.searchParams.set("limit", "1");
  checkUrl.searchParams.set("offset", "0");
  checkUrl.searchParams.set("order.date_created.from", dateFrom.toISOString());
  checkUrl.searchParams.set("order.date_created.to", dateTo.toISOString());

  try {
    const checkResponse = await fetchWithRetry(checkUrl.toString(), { headers }, 3, userId);
    if (checkResponse.ok) {
      const checkPayload = await checkResponse.json();
      totalInPeriod = checkPayload?.paging?.total || 0;
      console.log(`[Sync] ðŸ“Š PerÃ­odo ${dateFrom.toISOString().split('T')[0]} a ${dateTo.toISOString().split('T')[0]}: ${totalInPeriod} vendas`);

      // Se perÃ­odo tem mais de 9.950 vendas, precisa dividir
      if (totalInPeriod > MAX_OFFSET) {
        needsSplitting = true;
        console.log(`[Sync] ðŸ”„ PerÃ­odo tem ${totalInPeriod} vendas (> ${MAX_OFFSET}) - dividindo em sub-perÃ­odos`);
      }
    }
  } catch (error) {
    console.error(`[Sync] Erro ao verificar total do perÃ­odo:`, error);
    // Continuar mesmo com erro na verificaÃ§Ã£o
  }

  // Se precisa dividir, criar sub-perÃ­odos
  if (needsSplitting) {
    // Calcular duraÃ§Ã£o do perÃ­odo em dias
    const durationMs = dateTo.getTime() - dateFrom.getTime();
    const durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));

    console.log(`[Sync] ðŸ“… PerÃ­odo de ${durationDays} dias - dividindo em sub-perÃ­odos menores`);

    // Determinar tamanho ideal do sub-perÃ­odo
    // Se tem mais de 50k vendas, dividir em perÃ­odos de 7 dias
    // Se tem 10k-50k vendas, dividir em perÃ­odos de 14 dias
    const subPeriodDays = totalInPeriod > 50000 ? 7 : 14;

    console.log(`[Sync] ðŸ”„ Dividindo em sub-perÃ­odos de ${subPeriodDays} dias`);

    let currentStart = new Date(dateFrom);
    while (currentStart < dateTo) {
      const currentEnd = new Date(currentStart);
      currentEnd.setDate(currentEnd.getDate() + subPeriodDays);

      // Ajustar para nÃ£o ultrapassar dateTo
      if (currentEnd > dateTo) {
        currentEnd.setTime(dateTo.getTime());
      }

      console.log(`[Sync] ðŸ“† Buscando sub-perÃ­odo: ${currentStart.toISOString().split('T')[0]} a ${currentEnd.toISOString().split('T')[0]}`);

      // Buscar recursivamente (pode precisar dividir mais se ainda tiver >9.950)
      const subResults = await fetchOrdersInDateRange(
        account,
        headers,
        userId,
        currentStart,
        currentEnd,
        logisticStats
      );

      results.push(...subResults);
      console.log(`[Sync] âœ… Sub-perÃ­odo: ${subResults.length} vendas baixadas (total acumulado: ${results.length})`);

      // Enviar progresso
      sendProgressToUser(userId, {
        type: 'sync_progress',
        message: `${results.length}/${totalInPeriod} vendas baixadas (perÃ­odo histÃ³rico)`,
        current: results.length,
        total: totalInPeriod,
        fetched: results.length,
        expected: totalInPeriod,
        accountId: account.id,
        accountNickname: account.nickname,
      });

      // AvanÃ§ar para prÃ³ximo sub-perÃ­odo
      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() + 1); // PrÃ³ximo dia apÃ³s o fim
    }

    console.log(`[Sync] ðŸŽ‰ PerÃ­odo completo: ${results.length} vendas de ${totalInPeriod} totais`);
    return results;
  }

  // Se nÃ£o precisa dividir, buscar normalmente
  while (offset < MAX_OFFSET) {
    const url = new URL(`${MELI_API_BASE}/orders/search`);
    url.searchParams.set("seller", account.ml_user_id.toString());
    url.searchParams.set("sort", "date_desc");
    url.searchParams.set("limit", PAGE_LIMIT.toString());
    url.searchParams.set("offset", offset.toString());
    url.searchParams.set("order.date_created.from", dateFrom.toISOString());
    url.searchParams.set("order.date_created.to", dateTo.toISOString());

    try {
      const response = await fetchWithRetry(url.toString(), { headers }, 3, userId);

      if (!response.ok) {
        // Se der erro 400, parar (atingiu limite)
        if (response.status === 400) {
          console.log(`[Sync] âš ï¸ Atingiu limite no perÃ­odo - baixadas ${results.length} vendas`);
        }
        break;
      }

      const payload = await response.json();
      const orders = Array.isArray(payload?.results) ? payload.results : [];

      if (orders.length === 0) break;

      // Buscar detalhes dos orders
      const orderDetailsResults = await Promise.allSettled(
        orders.map(async (o: any) => {
          if (!o?.id) return o;
          try {
            const r = await fetchWithRetry(`${MELI_API_BASE}/orders/${o.id}`, { headers }, 3, userId);
            return r.ok ? await r.json() : o;
          } catch { return o; }
        })
      );

      const detailedOrders = orderDetailsResults.map((r, i) => r.status === "fulfilled" ? r.value : orders[i]);

      // OTIMIZAÇÃO: Buscar shipments em batches menores (10 por vez)
      const SHIPMENT_BATCH_SIZE = 10;
      const shipments: any[] = new Array(orders.length).fill(null);

      for (let i = 0; i < orders.length; i += SHIPMENT_BATCH_SIZE) {
        const batchOrders = orders.slice(i, i + SHIPMENT_BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batchOrders.map(async (o: any) => {
            const sid = o?.shipping?.id;
            if (!sid) return null;
            try {
              const r = await fetchWithRetry(`${MELI_API_BASE}/shipments/${sid}`, { headers }, 3, userId);
              return r.ok ? await r.json() : null;
            } catch { return null; }
          })
        );

        batchResults.forEach((result, idx) => {
          shipments[i + idx] = result.status === "fulfilled" ? result.value : null;
        });
      }

      detailedOrders.forEach((order: any, idx: number) => {
        if (!order) return;
        const shipment = shipments[idx];
        const freight = calculateFreight(order, shipment);
        const logType = shipment?.logistic_type || order?.shipping?.mode || "sem_tipo";
        logisticStats.set(logType, (logisticStats.get(logType) || 0) + 1);

        results.push({
          accountId: account.id,
          accountNickname: account.nickname,
          mlUserId: account.ml_user_id,
          order,
          shipment,
          freight,
        });
      });

      offset += orders.length;

      // IMPORTANTE: Parar antes de atingir limite
      if (offset >= MAX_OFFSET) {
        console.log(`[Sync] âš ï¸ Atingiu ${offset} vendas no perÃ­odo - parando antes do limite`);
        break;
      }
    } catch (error) {
      console.error(`[Sync] Erro ao buscar perÃ­odo:`, error);
      break;
    }
  }

  return results;
}

async function fetchOrdersForWindow(

  account: MeliAccount,

  userId: string,

  window?: SyncWindow,

  specificOrderIds?: string[], // IDs especificos para buscar

): Promise<OrdersFetchResult> {

  const results: MeliOrderPayload[] = [];

  const headers = { Authorization: `Bearer ${account.access_token}` };

  if (specificOrderIds && specificOrderIds.length > 0) {

    console.log(`[Sync] Buscando ${specificOrderIds.length} pedidos especificos para conta ${account.ml_user_id}`);



    const detailedOrders = await Promise.all(

      specificOrderIds.map(async (orderId) => {

        try {

          const res = await fetchWithRetry(`${MELI_API_BASE}/orders/${orderId}`, { headers }, 3, userId);

          if (!res.ok) {

            console.warn(`[Sync] Pedido ${orderId} retornou status ${res.status}, ignorando...`);

            return null;

          }

          const data = await res.json();

          return data;

        } catch (error) {

          console.error(`[Sync] Erro ao buscar pedido especifico ${orderId}:`, error);

          sendProgressToUser(userId, {

            type: 'sync_warning',

            message: `Erro ao buscar pedido ${orderId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,

            errorCode: 'ORDER_FETCH_ERROR',

          });

          return null;

        }

      })

    );



    const shipments = await Promise.all(

      detailedOrders.map(async (order: any) => {

        if (!order) return null;

        const shippingId = order?.shipping?.id;

        if (!shippingId) return null;

        try {

          const res = await fetchWithRetry(`${MELI_API_BASE}/shipments/${shippingId}`, { headers }, 3, userId);

          if (!res.ok) {

            console.warn(`[Sync] Envio ${shippingId} retornou status ${res.status}, continuando sem dados de envio...`);

            return null;

          }

          const data = await res.json();

          return data;

        } catch (error) {

          console.error(`[Sync] Erro ao buscar envio ${shippingId}:`, error);

          return null;

        }

      })

    );



    detailedOrders.forEach((order: any, idx: number) => {

      if (!order) return;

      const shipment = shipments[idx] ?? undefined;

      const freight = calculateFreight(order, shipment);

      results.push({

        accountId: account.id,

        accountNickname: account.nickname,

        mlUserId: account.ml_user_id,

        order,

        shipment,

        freight,

      });

    });



    return { orders: results, expectedTotal: specificOrderIds.length };

  }



  if (!window) {



    throw new Error("Sync window is required when no specific order IDs are provided.");



  }



  const now = window.to;



  const fetchFrom = window.from;



  const fetchMode = window.mode;



  const logisticStats = new Map<string, number>();

  const windowLabel =

    fetchMode === "initial"

      ? "janela inicial"

      : fetchMode === "historical"

        ? "historico"

        : fetchMode === "manual"

          ? "manual"

          : "ultimas 48h";



  try {



    sendProgressToUser(userId, {



      type: "sync_progress",



      message: `Conta ${account.nickname || account.ml_user_id}: preparando janelas (${windowLabel})...`,



      current: 0,



      total: 0,



      accountId: account.id,



      accountNickname: account.nickname,



      debugData: { mode: fetchMode },



    });



  } catch (sseError) {



    console.warn("[Sync] Erro ao enviar aviso de preparacao de janelas:", sseError);



  }







  const ranges = await buildSafeDateRanges(account, headers, fetchFrom, now, userId);



  if (ranges.length === 0) {

    console.log(

      `[Sync] Conta ${account.ml_user_id} nao retornou vendas no intervalo selecionado (${windowLabel}).`,

    );

    try {

      sendProgressToUser(userId, {

        type: "sync_warning",

        message: `Conta ${account.nickname || account.ml_user_id} nao possui vendas na janela ().`,

        accountId: account.id,

        accountNickname: account.nickname,

        debugData: { mode: fetchMode },

      });

    } catch (sseError) {

      console.warn("[Sync] Erro ao enviar aviso de ausencia de vendas:", sseError);

    }

    return { orders: results, expectedTotal: 0 };

  }



  let expectedTotal = ranges.reduce((sum, range) => sum + range.total, 0);

  let totalFetchedAcrossRanges = 0;



  try {

    sendProgressToUser(userId, {

      type: "sync_progress",

      message: `Conta ${account.nickname || account.ml_user_id}: ${ranges.length} janela(s) detectadas (${expectedTotal} vendas estimadas).`,

      current: 0,

      total: expectedTotal,

      accountId: account.id,

      accountNickname: account.nickname,

      debugData: { mode: fetchMode, ranges: ranges.length },

    });

  } catch (sseError) {

    console.warn("[Sync] Erro ao enviar resumo das janelas:", sseError);

  }



  console.log(

    `[Sync] Conta ${account.ml_user_id}: ${ranges.length} janela(s) para ${windowLabel}, total esperado inicial ${expectedTotal}.`,

  );



  for (const range of ranges) {

    const chunkOrders = await fetchOrdersInRange(

      account,

      headers,

      userId,

      range,

      logisticStats,

      {

        onPageFetched: ({ fetched, chunkOffset, chunkTotal, rangeLabel, page }) => {

          totalFetchedAcrossRanges += fetched;

          try {

            sendProgressToUser(userId, {

              type: 'sync_progress',

              message: `Conta ${account.nickname || account.ml_user_id}: ${totalFetchedAcrossRanges}/${expectedTotal || chunkTotal} vendas baixadas (${windowLabel} - ${rangeLabel})`,

              current: totalFetchedAcrossRanges,

              total: expectedTotal || chunkTotal,

              fetched: totalFetchedAcrossRanges,

              expected: expectedTotal || chunkTotal,

              accountId: account.id,

              accountNickname: account.nickname,

              page,

              offset: chunkOffset,

              debugData: {

                range: rangeLabel,

                chunkTotal,

              },

            });

          } catch (sseError) {

            console.warn('[Sync] Erro ao enviar progresso SSE (nao critico):', sseError);

          }

        },

        onRangeTotalAdjusted: (delta) => {

          if (!delta) return;

          expectedTotal += delta;

        },

        onRangeLimitReached: ({ total, rangeLabel }) => {

          const vendasRestantes = total - MAX_OFFSET;

          console.log(

            `[Sync] Aviso: limite de ${MAX_OFFSET} vendas atingido no intervalo ${rangeLabel}. ${vendasRestantes} vendas podem ter ficado de fora.`,

          );

          sendProgressToUser(userId, {

            type: 'sync_warning',

            message: `Limite de 10.000 vendas por intervalo atingido (${rangeLabel}). Sincronizadas ${MAX_OFFSET} de ${total} vendas disponiveis.`,

            errorCode: 'MAX_OFFSET_REACHED',

          });

        },

      },

    );



    results.push(...chunkOrders);

  }



  console.log(`[Sync] Conta ${account.ml_user_id} - tipos de logistica encontrados:`);

  const sortedStats = Array.from(logisticStats.entries()).sort((a, b) => b[1] - a[1]);

  sortedStats.forEach(([type, count]) => {

    console.log(`  ${type}: ${count} vendas`);

  });



  if (!logisticStats.has('cross_docking')) {

    console.log(

      `[Sync] Nenhuma venda com cross_docking (Coleta) foi encontrada na API do Mercado Livre para esta conta.`,

    );

  }



  return { orders: results, expectedTotal };

}





async function buildSkuCache(
  orders: MeliOrderPayload[],
  userId: string
): Promise<Map<string, SkuCacheEntry>> {
  const skuSet = new Set<string>();

  for (const payload of orders) {
    const rawOrder: any = payload.order ?? {};
    const orderItems: any[] = Array.isArray(rawOrder.order_items) ? rawOrder.order_items : [];

    for (const item of orderItems) {
      const itemData = typeof item?.item === "object" && item?.item !== null ? item.item : {};
      const candidate =
        itemData?.seller_sku ||
        itemData?.sku ||
        item?.seller_sku ||
        item?.sku ||
        null;

      if (candidate) {
        const normalized = truncateString(String(candidate), 255);
        if (normalized) {
          skuSet.add(normalized);
        }
      }
    }
  }

  if (skuSet.size === 0) {
    return new Map();
  }

  const skuList = Array.from(skuSet);
  const skuRecords = await prisma.sKU.findMany({
    where: {
      userId,
      sku: { in: skuList }
    },
    select: {
      sku: true,
      custoUnitario: true,
      tipo: true
    }
  });

  const cache = new Map<string, SkuCacheEntry>();
  for (const record of skuRecords) {
    cache.set(record.sku, {
      custoUnitario: record.custoUnitario !== null ? Number(record.custoUnitario) : null,
      tipo: record.tipo ?? null
    });
  }

  return cache;
}

// FunÃ§Ã£o para salvar vendas em lotes - OTIMIZADA
function extractOrderIdFromPayload(order: MeliOrderPayload): string | null {
  const rawOrder = (order?.order ?? null) as any;
  if (!rawOrder || rawOrder.id === undefined || rawOrder.id === null) {
    return null;
  }
  const id = String(rawOrder.id).trim();
  return id.length === 0 ? null : id;
}

function deduplicateOrders(
  orders: MeliOrderPayload[]
): { uniqueOrders: MeliOrderPayload[]; duplicates: number } {
  const seen = new Set<string>();
  const uniqueOrders: MeliOrderPayload[] = [];
  let duplicates = 0;

  for (const order of orders) {
    const orderId = extractOrderIdFromPayload(order);
    if (!orderId) {
      uniqueOrders.push(order);
      continue;
    }
    if (seen.has(orderId)) {
      duplicates += 1;
      continue;
    }
    seen.add(orderId);
    uniqueOrders.push(order);
  }

  return { uniqueOrders, duplicates };
}

async function saveVendasBatch(
  orders: MeliOrderPayload[],
  userId: string,
  batchSize: number = 100 // OTIMIZADO: aumentado para 100 para batch operations
): Promise<{ saved: number; errors: number }> {
  let saved = 0;
  let errors = 0;

  const { uniqueOrders, duplicates } = deduplicateOrders(orders);
  const totalOrders = uniqueOrders.length;

  if (duplicates > 0) {
    console.warn(
      `[Sync] ${duplicates} venda(s) duplicada(s) detectada(s) no retorno do Mercado Livre. Ignorando duplicatas para evitar salvar pedidos repetidos.`
    );
  }

  if (totalOrders === 0) {
    return { saved, errors };
  }

  try {
    const skuCache = await buildSkuCache(uniqueOrders, userId);
    let processedCount = 0;

    // OTIMIZAÇÃO CRÍTICA: Processar em lotes com batch UPSERT
    // Reduz de 500 queries individuais para 5-10 queries em lote
    for (let i = 0; i < totalOrders; i += batchSize) {
      const batch = uniqueOrders.slice(i, i + batchSize);

      try {
        // Preparar todos os dados do batch primeiro
        const preparedData = await Promise.all(
          batch.map(order => prepareVendaData(order, userId, skuCache))
        );

        // Filtrar dados válidos
        const validData = preparedData.filter(d => d !== null);

        if (validData.length === 0) {
          errors += batch.length;
          processedCount += batch.length;
          continue;
        }

        // Buscar IDs existentes para dividir em creates vs updates
        const orderIds = validData.map(d => d!.orderId);
        const existingOrders = await prisma.meliVenda.findMany({
          where: { orderId: { in: orderIds } },
          select: { orderId: true }
        });

        const existingOrderIdSet = new Set(existingOrders.map(o => o.orderId));

        const toCreate = validData.filter(d => !existingOrderIdSet.has(d!.orderId));
        const toUpdate = validData.filter(d => existingOrderIdSet.has(d!.orderId));

        // BATCH CREATE: insere múltiplos registros de uma vez
        if (toCreate.length > 0) {
          try {
            await prisma.meliVenda.createMany({
              data: toCreate.map(d => d!.createData),
              skipDuplicates: true // Evita erro se já existir
            });
            saved += toCreate.length;
          } catch (createError) {
            console.error(`[Sync] Erro em batch create:`, createError);
            errors += toCreate.length;
          }
        }

        // BATCH UPDATE: atualiza múltiplos registros em uma transação
        if (toUpdate.length > 0) {
          try {
            await prisma.$transaction(
              toUpdate.map(d =>
                prisma.meliVenda.update({
                  where: { orderId: d!.orderId },
                  data: { ...d!.updateData, atualizadoEm: new Date() }
                })
              )
            );
            saved += toUpdate.length;
          } catch (updateError) {
            console.error(`[Sync] Erro em batch update:`, updateError);
            errors += toUpdate.length;
          }
        }

      } catch (batchError) {
        console.error(`[Sync] Erro crítico no batch ${i}-${i + batchSize}:`, batchError);
        errors += batch.length;
      }

      // Enviar progresso SSE apenas a cada lote (nao a cada venda) para reduzir overhead
      processedCount += batch.length;
      const percentage = Math.round((processedCount / totalOrders) * 100);
      try {
        sendProgressToUser(userId, {
          type: "sync_progress",
          message: `Salvando no banco: ${processedCount}/${totalOrders} vendas (${percentage}%)`,
          current: processedCount,
          total: totalOrders,
          fetched: processedCount,
          expected: totalOrders
        });
      } catch (sseError) {
        // Ignorar erros de SSE - nao sao criticos
        console.warn(`[Sync] Erro ao enviar progresso SSE (nao critico):`, sseError);
      }
    }
  } catch (error) {
    console.error(`[Sync] Erro critico em saveVendasBatch:`, error);
    // Retornar o que foi salvo ate agora
    errors = totalOrders - saved;
  }

  return { saved, errors };
}

// Nova função auxiliar para preparar dados da venda sem salvar
async function prepareVendaData(
  order: MeliOrderPayload,
  userId: string,
  skuCache: Map<string, SkuCacheEntry>
): Promise<{ orderId: string; createData: any; updateData: any } | null> {
  const extractedOrderId = extractOrderIdFromPayload(order);

  if (!extractedOrderId) {
    console.error(`[Sync] Venda sem ID valido, pulando...`);
    return null;
  }

  const orderId = extractedOrderId;

  try {
    const o: any = order.order ?? {};
    const freight = order.freight;
    const normalizedMlUserId =
      (order as any)?.mlUserId ??
      (order as any)?.ml_user_id ??
      (typeof o?.seller?.id === 'number' ? o.seller.id : null);

    const orderItems: any[] = Array.isArray(o.order_items) ? o.order_items : [];
    const firstItem = orderItems[0] ?? {};
    const orderItem = typeof firstItem === 'object' && firstItem !== null ? firstItem : {};
    const itemData = typeof orderItem?.item === 'object' && orderItem.item !== null ? orderItem.item : {};

    const firstItemTitle =
      itemData?.title ??
      orderItems.find((entry: any) => entry?.item?.title)?.item?.title ??
      o.title ??
      'Pedido';

    const quantity = orderItems.reduce((sum, item) => {
      const qty = toFiniteNumber(item?.quantity) ?? 0;
      return sum + qty;
    }, 0);

    const totalAmount =
      toFiniteNumber(o.total_amount) ??
      orderItems.reduce((acc, item) => {
        const qty = toFiniteNumber(item?.quantity) ?? 0;
        const price = toFiniteNumber(item?.unit_price) ?? 0;
        return acc + qty * price;
      }, 0);

    const buyerName =
      o?.buyer?.nickname ||
      [o?.buyer?.first_name, o?.buyer?.last_name].filter(Boolean).join(' ') ||
      'Comprador';

    const dateString = o.date_closed || o.date_created || o.date_last_updated;

    const tags: string[] = Array.isArray(o.tags)
      ? o.tags.map((t: unknown) => String(t))
      : [];

    const internalTags: string[] = Array.isArray(o.internal_tags)
      ? o.internal_tags.map((t: unknown) => String(t))
      : [];

    const shippingStatus = (order.shipment as any)?.status || o?.shipping?.status || undefined;
    const shippingId = (order.shipment as any)?.id?.toString() || o?.shipping?.id?.toString();

    const receiverAddress =
      (order.shipment as any)?.receiver_address ??
      (o?.shipping && typeof o.shipping === 'object' ? (o as any).shipping?.receiver_address : undefined) ??
      undefined;
    const latitude = toFiniteNumber((receiverAddress as any)?.latitude ?? (receiverAddress as any)?.geo?.latitude);
    const longitude = toFiniteNumber((receiverAddress as any)?.longitude ?? (receiverAddress as any)?.geo?.longitude);

    const saleFee = orderItems.reduce((acc, item) => {
      const fee = toFiniteNumber(item?.sale_fee) ?? 0;
      const qty = toFiniteNumber(item?.quantity) ?? 1;
      return acc + fee * qty;
    }, 0);

    const unitario =
      toFiniteNumber(orderItem?.unit_price) ??
      (quantity > 0 && totalAmount !== null ? roundCurrency(totalAmount / quantity) : 0);

    const taxaPlataforma = saleFee > 0 ? -roundCurrency(saleFee) : null;
    const frete = freight.adjustedCost ?? freight.finalCost ?? freight.orderCostFallback ?? 0;

    const skuVendaRaw = itemData?.seller_sku || itemData?.sku || null;
    const skuVenda = skuVendaRaw ? truncateString(String(skuVendaRaw), 255) || null : null;
    let cmv: number | null = null;

    if (skuVenda) {
      const cachedSku = skuCache.get(skuVenda);

      if (cachedSku) {
        if (cachedSku.custoUnitario !== null) {
          cmv = roundCurrency(cachedSku.custoUnitario * quantity);
        }
      }
    }

    const { valor: margemContribuicao, isMargemReal } = calculateMargemContribuicao(
      totalAmount,
      taxaPlataforma,
      frete,
      cmv
    );

    const contaLabel = truncateString(order.accountNickname ?? String(normalizedMlUserId ?? order.accountId), 255);

    const vendaBaseData = {
      dataVenda: dateString ? new Date(dateString) : new Date(),
      status: truncateString(String(o.status ?? 'desconhecido').replaceAll('_', ' '), 100),
      conta: contaLabel,
      valorTotal: new Decimal(totalAmount),
      quantidade: quantity > 0 ? quantity : 1,
      unitario: new Decimal(unitario),
      taxaPlataforma: taxaPlataforma ? new Decimal(taxaPlataforma) : null,
      frete: new Decimal(frete),
      cmv: cmv !== null ? new Decimal(cmv) : null,
      margemContribuicao: new Decimal(margemContribuicao),
      isMargemReal,
      titulo: truncateString(firstItemTitle, 500) || 'Produto sem titulo',
      sku: skuVenda,
      comprador: truncateString(buyerName, 255) || 'Comprador',
      logisticType: truncateString(freight.logisticType, 100) || null,
      envioMode: truncateString(freight.shippingMode, 100) || null,
      shippingStatus: truncateString(shippingStatus, 100) || null,
      shippingId: truncateString(shippingId, 255) || null,
      exposicao: (() => {
        const listingTypeId = (orderItem?.listing_type_id ?? itemData?.listing_type_id) ?? null;
        return mapListingTypeToExposure(listingTypeId);
      })(),
      tipoAnuncio: tags.includes('catalog') ? 'Catalogo' : 'Proprio',
      ads: internalTags.includes('ads') ? 'ADS' : null,
      plataforma: 'Mercado Livre',
      canal: 'ML',
      tags: truncateJsonData(tags),
      internalTags: truncateJsonData(internalTags),
      rawData: truncateJsonData({
        order: o,
        shipment: order.shipment as any,
        freight: freight
      })
    };

    // Tentar incluir geo se disponível
    const geoData = latitude !== null && longitude !== null ? {
      latitude: new Decimal(latitude),
      longitude: new Decimal(longitude)
    } : {};

    const createData = {
      orderId: truncateString(orderId, 255),
      userId: truncateString(userId, 50),
      meliAccountId: truncateString(order.accountId, 25),
      ...vendaBaseData,
      ...geoData
    };

    const updateData = {
      ...vendaBaseData,
      ...geoData
    };

    return { orderId, createData, updateData };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Sync] Erro ao preparar venda ${orderId}:`, errorMsg);
    return null;
  }
}

// REMOVIDA: saveVendaToDatabase() - refatorada em prepareVendaData() + batch operations
export async function POST(req: NextRequest) {
  // Suportar tanto autenticação de usuário quanto cron job
  const sessionCookie = req.cookies.get("session")?.value;
  const cronSecret = req.headers.get('x-cron-secret');

  // Ler body primeiro (só pode ser lido uma vez)
  let requestBody: {
    accountIds?: string[];
    orderIdsByAccount?: Record<string, string[]>;
    quickMode?: boolean;
    fullSync?: boolean;
  } = {};

  try {
    const bodyText = await req.text();
    if (bodyText) {
      requestBody = JSON.parse(bodyText);
    }
  } catch (error) {
    console.error('[Sync] Erro ao parsear body:', error);
  }

  let userId: string;

  // Autenticar via cron secret OU sessão de usuário
  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    // Requisição de cron job - pegar userId do body
    const accountId = requestBody.accountIds?.[0];
    if (!accountId) {
      return new NextResponse("Missing accountId for cron job", { status: 400 });
    }

    // Buscar userId da conta
    const account = await prisma.meliAccount.findUnique({
      where: { id: accountId },
      select: { userId: true }
    });

    if (!account) {
      return new NextResponse("Account not found", { status: 404 });
    }

    userId = account.userId;
    console.log(`[Sync] Cron job autenticado para userId: ${userId}`);
  } else {
    // Autenticação normal via sessão
    let session;
    try {
      session = await assertSessionToken(sessionCookie);
    } catch {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    userId = session.sub;
  }

  // Por padrÃ£o, usar quickMode=true para evitar timeout
  const quickMode = requestBody.quickMode !== false; // true por padrÃ£o, false apenas se explicitamente passado
  const fullSync = requestBody.fullSync === true; // fullSync apenas se explicitamente true

  console.log(`[Sync] Iniciando sincronizaÃ§Ã£o para usuÃ¡rio ${userId}`, {
    accountIds: requestBody.accountIds,
    hasOrderIds: !!requestBody.orderIdsByAccount,
    quickMode: quickMode, // Log do modo
    fullSync: fullSync // Log do modo fullSync
  });

  // Dar um delay para garantir que o SSE estÃ¡ conectado
  await new Promise(resolve => setTimeout(resolve, 500));

  // Enviar evento de inÃ­cio da sincronizaÃ§Ã£o
  sendProgressToUser(userId, {
    type: "sync_start",
    message: "Conectando ao Mercado Livre...",
    current: 0,
    total: 0,
    fetched: 0,
    expected: 0
  });

  // Buscar contas - filtrar por IDs se fornecidos
  const accountsWhere: any = { userId };
  if (requestBody.accountIds && requestBody.accountIds.length > 0) {
    accountsWhere.id = { in: requestBody.accountIds };
  }
  
  const accounts = await prisma.meliAccount.findMany({
    where: accountsWhere,
    orderBy: { created_at: "desc" },
  });

  console.log(`[Sync] Encontradas ${accounts.length} conta(s) do Mercado Livre`);

  if (accounts.length === 0) {
    sendProgressToUser(userId, {
      type: "sync_complete",
      message: "Nenhuma conta do MercadoLivre encontrada",
      current: 0,
      total: 0,
      fetched: 0,
      expected: 0
    });
    
    return NextResponse.json({
      syncedAt: new Date().toISOString(),
      accounts: [] as AccountSummary[],
      orders: [] as MeliOrderPayload[],
      errors: [] as SyncError[],
      totals: { expected: 0, fetched: 0, saved: 0 },
    });
  }

  const errors: SyncError[] = [];
  const summaries: AccountSummary[] = [];
  let totalExpectedOrders = 0;
  let totalFetchedOrders = 0;
  let totalSavedOrders = 0;
  let forcedStop = false;
  
  // Preparar steps para cada conta
  const steps = accounts.map(acc => ({
    accountId: acc.id,
    accountName: acc.nickname || `Conta ${acc.ml_user_id}`,
    currentStep: 'pending' as 'pending' | 'fetching' | 'saving' | 'completed' | 'error',
    progress: 0,
    fetched: 0,
    expected: 0,
    error: undefined as string | undefined
  }));

  for (let accountIndex = 0; accountIndex < accounts.length; accountIndex++) {
    const account = accounts[accountIndex];
    const summary: AccountSummary = {
      id: account.id,
      nickname: account.nickname,
      ml_user_id: account.ml_user_id,
      expires_at: account.expires_at.toISOString(),
    };
    summaries.push(summary);

    try {
      // Atualizar step para fetching
      steps[accountIndex].currentStep = 'fetching';

      // Enviar progresso: processando conta
      sendProgressToUser(userId, {
        type: "sync_progress",
        message: `Buscando vendas da conta ${account.nickname || account.ml_user_id}...`,
        current: accountIndex,
        total: accounts.length,
        fetched: totalFetchedOrders,
        expected: totalExpectedOrders,
        accountId: account.id,
        accountNickname: account.nickname || `Conta ${account.ml_user_id}`,
        steps: steps
      });

      let current = account;
      try {
        current = await refreshMeliAccountToken(account);
        summary.expires_at = current.expires_at.toISOString();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido ao renovar token.";
        errors.push({ accountId: account.id, mlUserId: account.ml_user_id, message });
        console.error(`[Sync] Erro ao renovar token da conta ${account.id}:`, error);

        // Atualizar step para erro
        steps[accountIndex].currentStep = 'error';
        steps[accountIndex].error = message;

        // Enviar erro via SSE
        sendProgressToUser(userId, {
          type: "sync_warning",
          message: `Erro ao renovar token da conta ${account.nickname || account.ml_user_id}: ${message}. Continuando com prÃ³xima conta...`,
          errorCode: "TOKEN_REFRESH_FAILED"
        });
        continue;
      }

      try {
        const specificOrderIds = requestBody.orderIdsByAccount?.[account.id];

        const existingVendasCount = await prisma.meliVenda.count({

          where: { meliAccountId: account.id },

        });

        const now = new Date();



        const processAndSave = async (

          fetchedOrders: MeliOrderPayload[],

          expectedTotal: number,

          label: string,

        ) => {

          const effectiveExpected = expectedTotal || fetchedOrders.length;

          totalExpectedOrders += effectiveExpected;

          totalFetchedOrders += fetchedOrders.length;



          steps[accountIndex].expected += effectiveExpected;

          steps[accountIndex].fetched += fetchedOrders.length;

          steps[accountIndex].progress = fetchedOrders.length > 0 ? 50 : steps[accountIndex].progress;



          console.log(

            `[Sync] Conta ${account.nickname}: ${fetchedOrders.length} venda(s) encontradas na janela ${label}`,

          );



          if (fetchedOrders.length === 0) {

            return;

          }



          steps[accountIndex].currentStep = 'saving';

          sendProgressToUser(userId, {

            type: "sync_progress",

            message: `Salvando ${fetchedOrders.length} venda(s) (${label}) da conta ${account.nickname || account.ml_user_id}...`,

            current: accountIndex,

            total: accounts.length,

            fetched: totalFetchedOrders,

            expected: totalExpectedOrders,

            accountId: account.id,

            accountNickname: account.nickname || `Conta ${account.ml_user_id}`,

            steps,

          });



          try {

            const batchResult = await saveVendasBatch(fetchedOrders, userId, 50);

            totalSavedOrders += batchResult.saved;



            console.log(

              `[Sync] Conta ${account.nickname}: ${batchResult.saved} vendas salvas (${label}), ${batchResult.errors} erros`,

            );



            if (batchResult.errors > 0) {

              console.warn(`[Sync] ${batchResult.errors} vendas falharam ao salvar para conta ${current.id}`);

              sendProgressToUser(userId, {

                type: "sync_warning",

                message: `${batchResult.errors} vendas da conta ${account.nickname || account.ml_user_id} nao puderam ser salvas (${label})`,

                errorCode: "SAVE_ERRORS",

              });

            }

          } catch (saveError) {

            const saveErrorMsg = saveError instanceof Error ? saveError.message : 'Erro desconhecido';

            console.error(`[Sync] Erro ao salvar vendas da conta ${current.id}:`, saveError);

            errors.push({

              accountId: current.id,

              mlUserId: current.ml_user_id,

              message: `Erro ao salvar vendas: ${saveErrorMsg}`

            });



            sendProgressToUser(userId, {

              type: "sync_warning",

              message: `Erro ao salvar vendas da conta ${account.nickname || account.ml_user_id}: ${saveErrorMsg}`,

              errorCode: "SAVE_BATCH_ERROR",

            });

          }

        };



        steps[accountIndex].expected = 0;

        steps[accountIndex].fetched = 0;



        // NOVA LÃ“GICA SIMPLES: Buscar TODAS as vendas sem janelas complexas
        const headers = { Authorization: `Bearer ${current.access_token}` };

        console.log(`[Sync] ðŸš€ Buscando TODAS as vendas da conta ${current.ml_user_id} (${current.nickname})`);
        console.log(`[Sync] Debug - accountIndex: ${accountIndex}, userId: ${userId}`);

        let allOrders: MeliOrderPayload[] = [];
        let expectedTotal = 0;
        let accountForcedStop = false;

        try {
          const result = await fetchAllOrdersForAccount(
            current,
            headers,
            userId,
            quickMode, // NOVO: passa o modo de sincronizaÃ§Ã£o
            fullSync, // NOVO: passa o modo fullSync
          );
          allOrders = result.orders;
          expectedTotal = result.expectedTotal;
          accountForcedStop = result.forcedStop;
          forcedStop = forcedStop || accountForcedStop;

          console.log(`[Sync] âœ… Conta ${current.ml_user_id}: ${allOrders.length} vendas baixadas de ${expectedTotal} totais`);
          console.log(`[Sync] Debug - allOrders.length: ${allOrders.length}, expectedTotal: ${expectedTotal}`);
        } catch (fetchError) {
          const fetchMsg = fetchError instanceof Error ? fetchError.message : 'Erro ao buscar vendas';
          console.error(`[Sync] âŒ Erro ao buscar vendas da conta ${current.ml_user_id}:`, fetchError);
          throw new Error(`Falha ao buscar vendas: ${fetchMsg}`);
        }

        console.log(`[Sync] ðŸ“¥ Iniciando salvamento de ${allOrders.length} vendas no banco...`);

        // Enviar evento SSE informando que vai comeÃ§ar a salvar
        sendProgressToUser(userId, {
          type: "sync_progress",
          message: `Preparando para salvar ${allOrders.length} vendas no banco de dados...`,
          current: 0,
          total: allOrders.length,
          fetched: 0,
          expected: allOrders.length,
          accountId: current.id,
          accountNickname: current.nickname || `Conta ${current.ml_user_id}`
        });

        try {
          await processAndSave(allOrders, expectedTotal, 'completo');
          console.log(`[Sync] âœ… Salvamento concluÃ­do para conta ${current.ml_user_id}`);

          // Enviar evento SSE confirmando conclusÃ£o do salvamento
          sendProgressToUser(userId, {
            type: "sync_progress",
            message: `âœ… Salvamento concluÃ­do para ${current.nickname || current.ml_user_id}`,
            current: allOrders.length,
            total: allOrders.length,
            fetched: allOrders.length,
            expected: allOrders.length,
            accountId: current.id,
            accountNickname: current.nickname || `Conta ${current.ml_user_id}`
          });
        } catch (saveError) {
          const saveMsg = saveError instanceof Error ? saveError.message : 'Erro ao salvar vendas';
          console.error(`[Sync] âŒ Erro ao salvar vendas da conta ${current.ml_user_id}:`, saveError);
          throw new Error(`Falha ao salvar vendas: ${saveMsg}`);
        }

      } catch (error) {
        steps[accountIndex].currentStep = 'error';
        steps[accountIndex].error = error instanceof Error ? error.message : 'Erro desconhecido';
        const message = error instanceof Error ? error.message : "Erro desconhecido ao processar pedidos.";
        errors.push({ accountId: current.id, mlUserId: current.ml_user_id, message });
        console.error(`[Sync] Erro ao processar conta ${current.id}:`, error);

        // Enviar erro via SSE
        sendProgressToUser(userId, {
          type: "sync_warning",
          message: `Erro na conta ${current.nickname || current.ml_user_id}: ${message}. Continuando com prÃ³xima conta...`,
          errorCode: "ACCOUNT_PROCESSING_ERROR"
        });

        // Atualizar progresso mesmo com erro
        sendProgressToUser(userId, {
          type: "sync_progress",
          message: `Conta ${current.nickname || current.ml_user_id} com erro`,
          current: accountIndex + 1,
          total: accounts.length,
          fetched: totalFetchedOrders,
          expected: totalExpectedOrders,
          accountId: current.id,
          accountNickname: current.nickname || `Conta ${current.ml_user_id}`,
          steps: steps
        });
      }
    } catch (error) {
      // Erro catastrÃ³fico na conta - continuar com prÃ³xima
      const errorMsg = error instanceof Error ? error.message : 'Erro crÃ­tico desconhecido';
      console.error(`[Sync] Erro catastrÃ³fico ao processar conta ${account.id}:`, error);

      steps[accountIndex].currentStep = 'error';
      steps[accountIndex].error = errorMsg;
      errors.push({ accountId: account.id, mlUserId: account.ml_user_id, message: errorMsg });

      sendProgressToUser(userId, {
        type: "sync_warning",
        message: `Erro crÃ­tico na conta ${account.nickname || account.ml_user_id}: ${errorMsg}. Continuando com prÃ³xima conta...`,
        errorCode: "CRITICAL_ERROR"
      });
    }
  }

  // Verificar se hÃ¡ mais vendas antigas para sincronizar
  // Em fullSync ou quickMode, indicar se ainda faltam vendas
  const pendingVolume = totalFetchedOrders < totalExpectedOrders;
  const hasMoreToSync = forcedStop || ((fullSync || quickMode) && pendingVolume);

  // Enviar evento de conclusão da sincronização
  let mensagemFinal = '';
  if (forcedStop) {
    mensagemFinal = `⚠️ ${totalSavedOrders} vendas processadas até agora. Tempo limite atingido, continuaremos automaticamente.`;
  } else if (fullSync && hasMoreToSync) {
    mensagemFinal = `✅ ${totalSavedOrders} vendas sincronizadas de ${totalExpectedOrders}! Clique novamente para continuar...`;
  } else if (fullSync) {
    mensagemFinal = `✅ Sincronização completa! ${totalSavedOrders} vendas processadas de ${totalExpectedOrders}`;
  } else if (quickMode) {
    mensagemFinal = `Vendas recentes sincronizadas! ${totalSavedOrders} vendas processadas${hasMoreToSync ? '. Sincronizando vendas antigas em background...' : ''}`;
  } else {
    mensagemFinal = `Sincronização completa! ${totalSavedOrders} vendas processadas de ${totalExpectedOrders} esperadas`;
  }

  sendProgressToUser(userId, {
    type: "sync_complete",
    message: mensagemFinal,
    current: totalSavedOrders,
    total: totalExpectedOrders,
    fetched: totalSavedOrders,
    expected: totalExpectedOrders,
    hasMoreToSync // NOVO: indica se hÃ¡ mais vendas antigas
  });

  // Invalidar cache de vendas apÃ³s sincronizaÃ§Ã£o
  invalidateVendasCache(userId);
  console.log(`[Cache] Cache de vendas invalidado para usuÃ¡rio ${userId}`);

  // AUTO-SYNC: Continuar automaticamente se houver mais vendas
  if (hasMoreToSync) {
    console.log(`[Sync] Iniciando proximo sync automaticamente...`);

    sendProgressToUser(userId, {
      type: "sync_continue",
      message: `Continuando... ${totalSavedOrders} vendas salvas.`,
      current: totalSavedOrders,
      total: totalExpectedOrders,
      fetched: totalFetchedOrders,
      expected: totalExpectedOrders
    });

    // Trigger próximo sync (fire-and-forget - não espera resposta)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    fetch(`${baseUrl}/api/meli/vendas/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `session=${sessionCookie}`
      },
      body: JSON.stringify({
        accountIds: requestBody.accountIds,
        quickMode: requestBody.quickMode,
        fullSync: requestBody.fullSync
      })
    }).catch(err => console.error(`[Sync] Erro ao continuar:`, err));
  } else {
    // Fechar SSE apenas quando completar tudo
    setTimeout(() => closeUserConnections(userId), 2000);
  }

  return NextResponse.json({
    syncedAt: new Date().toISOString(),
    accounts: summaries,
    orders: [] as MeliOrderPayload[],
    errors,
    totals: {
      expected: totalExpectedOrders,
      fetched: totalFetchedOrders,
      saved: totalSavedOrders
    },
    hasMoreToSync, // NOVO: flag indicando se hÃ¡ vendas antigas pendentes
    quickMode, // NOVO: indica qual modo foi usado
    autoSyncTriggered: hasMoreToSync
  });
}

