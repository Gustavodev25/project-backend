import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";
import { refreshMeliAccountToken } from "@/lib/meli";
import { calcularFreteAdjust } from "@/lib/frete";
import type { MeliAccount } from "@prisma/client";

export const runtime = "nodejs";

const MELI_API_BASE =
  process.env.MELI_API_BASE?.replace(/\/$/, "") ||
  "https://api.mercadolibre.com";
const PAGE_LIMIT = 50;
const MAX_OFFSET = 10000; // Limite máximo da API do Mercado Livre
const MAX_RESULTS_PER_RANGE = 9500;
const MIN_RANGE_DURATION_MS = 1000;
const MAX_RANGE_SPLIT_DEPTH = 32;
const DEFAULT_HISTORY_START =
  process.env.MELI_HISTORY_START_DATE ||
  process.env.MELI_SYNC_START_DATE ||
  "2024-01-01T00:00:00.000Z";

type FreightSource = "shipment" | "order" | "shipping_option" | null;

type MeliOrderFreight = {
  logisticType: string | null;
  logisticTypeSource: FreightSource | null;
  shippingMode: string | null;

  baseCost: number | null;             // shipment.base_cost
  listCost: number | null;             // shipment.shipping_option.list_cost
  shippingOptionCost: number | null;   // shipping_option.cost
  shipmentCost: number | null;         // shipment.cost
  orderCostFallback: number | null;    // order.shipping.cost
  finalCost: number | null;            // valor efetivamente cobrado
  finalCostSource: FreightSource;      // fonte do finalCost
  chargedCost: number | null;          // compatibilidade (mesmo que finalCost)
  chargedCostSource: FreightSource;    // compatibilidade (mesma fonte do finalCost)

  discount: number | null;             // listCost - chargedCost (quando ambos existirem)
  totalAmount: number | null;          // order.total_amount
  quantity: number | null;             // soma de order_items[].quantity
  unitPrice: number | null;            // totalAmount / quantity (quando aplicável)
  diffBaseList: number | null;         // baseCost - listCost
  
  // Novos campos para ajustes de frete
  adjustedCost: number | null;         // frete ajustado baseado na lógica específica
  adjustmentSource: string | null;     // fonte do ajuste (Agência, FLEX, etc.)
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
  
  // Conversões específicas
  if (logisticType === "xd_drop_off") return "Agência";
  if (logisticType === "self_service") return "FLEX";
  
  return logisticType;
}

function calculateFreightAdjustment(
  logisticType: string | null,
  unitPrice: number | null,
  quantity: number | null,           // << usa a quantidade real
  baseCost: number | null,
  listCost: number | null,
  shipmentCost: number | null
): { adjustedCost: number | null; adjustmentSource: string | null } {
  if (!logisticType) return { adjustedCost: null, adjustmentSource: null };

  const orderCost = unitPrice !== null && quantity !== null ? unitPrice * quantity : 0;

  const freteAdjust = calcularFreteAdjust({
    shipment_logistic_type: logisticType,
    base_cost: baseCost,
    shipment_list_cost: listCost,
    shipment_cost: shipmentCost,
    order_cost: orderCost,
    quantity: quantity ?? 0,
  });

  // se for o sentinela do SQL (±999), não aplica override
  if (Math.abs(freteAdjust) === 999) {
    return { adjustedCost: null, adjustmentSource: null };
  }

  // ATENÇÃO: 0 agora é override válido (zera frete)
  const adj = roundCurrency(freteAdjust);

  const label =
    logisticType === 'self_service' ? 'FLEX' :
    logisticType === 'drop_off' ? 'Correios' :
    logisticType === 'xd_drop_off' ? 'Agência' :
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
  const optCost = toFiniteNumber((shipOpt as any).cost);        // custo efetivamente cobrado (quando existir)
  const listCost = toFiniteNumber((shipOpt as any).list_cost);  // preço de tabela da opção
  const shipCost = toFiniteNumber(s.cost);
  const orderCost = toFiniteNumber(orderShipping.cost);

  // Prioridade: shipping_option.cost -> shipment.cost -> order.shipping.cost
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

  // Converter nome do tipo logístico e calcular ajustes
  const convertedLogisticType = convertLogisticTypeName(logisticType);
  const { adjustedCost, adjustmentSource } = calculateFreightAdjustment(
    logisticType,
    unitPrice,
    quantity,
    baseCost,
    listCost,
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

function getHistoryStartDate(): Date {
  const candidate = new Date(DEFAULT_HISTORY_START);
  if (Number.isNaN(candidate.getTime())) {
    return new Date("2024-01-01T00:00:00.000Z");
  }
  return candidate;
}

function createRangeLabel(from: Date, to: Date): string {
  return `${from.toISOString()} até ${to.toISOString()}`;
}

async function countOrdersInRange(
  account: MeliAccount,
  headers: Record<string, string>,
  from: Date,
  to: Date,
): Promise<number> {
  if (from > to) return 0;

  const url = new URL(`${MELI_API_BASE}/orders/search`);
  url.searchParams.set("seller", account.ml_user_id.toString());
  url.searchParams.set("sort", "date_desc");
  url.searchParams.set("limit", "1");
  url.searchParams.set("offset", "0");
  url.searchParams.set("order.date_created.from", from.toISOString());
  url.searchParams.set("order.date_created.to", to.toISOString());

  const response = await fetch(url.toString(), { headers });
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      typeof payload?.message === "string" ? payload.message : `Status ${response.status}`;
    throw new Error(`Erro ao contar pedidos da conta ${account.ml_user_id}: ${message}`);
  }

  const total = typeof payload?.paging?.total === "number" ? payload.paging.total : 0;
  if (total > MAX_RESULTS_PER_RANGE) {
    console.log(
      `[meli][orders] Intervalo ${createRangeLabel(from, to)} possui ${total} vendas - dividindo janelas.`,
    );
  }
  return total;
}

async function buildSafeDateRanges(
  account: MeliAccount,
  headers: Record<string, string>,
  from: Date,
  to: Date,
): Promise<DateRangeWindow[]> {
  const windows: DateRangeWindow[] = [];
  const queue: DateRangeWindow[] = [{ from, to, total: 0, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.from > current.to) continue;

    const total = await countOrdersInRange(account, headers, current.from, current.to);
    if (total === 0) continue;

    if (total > MAX_RESULTS_PER_RANGE && current.depth < MAX_RANGE_SPLIT_DEPTH) {
      const duration = current.to.getTime() - current.from.getTime();
      if (duration <= MIN_RANGE_DURATION_MS) {
        console.warn(
          `[meli][orders] Intervalo mínimo atingido para conta ${account.ml_user_id} em ${createRangeLabel(
            current.from,
            current.to,
          )}. Prosseguindo mesmo acima do limite.`,
        );
        windows.push({ ...current, total });
        continue;
      }

      const midMs = current.from.getTime() + Math.floor(duration / 2);
      if (midMs <= current.from.getTime() || midMs >= current.to.getTime()) {
        windows.push({ ...current, total });
        continue;
      }

      const leftTo = new Date(midMs);
      const rightFromMs = midMs + 1;
      if (rightFromMs > current.to.getTime()) {
        windows.push({ ...current, total });
        continue;
      }
      const rightFrom = new Date(rightFromMs);

      queue.unshift({ from: current.from, to: leftTo, total: 0, depth: current.depth + 1 });
      queue.unshift({ from: rightFrom, to: current.to, total: 0, depth: current.depth + 1 });
      continue;
    }

    windows.push({ ...current, total });
  }

  windows.sort((a, b) => b.from.getTime() - a.from.getTime());
  return windows;
}

async function fetchOrdersInRange(
  account: MeliAccount,
  headers: Record<string, string>,
  range: DateRangeWindow,
): Promise<MeliOrderPayload[]> {
  const results: MeliOrderPayload[] = [];
  let offset = 0;
  let total = range.total;
  let page = 0;
  const rangeLabel = createRangeLabel(range.from, range.to);

  while (offset < total && offset < MAX_OFFSET) {
    const limit = PAGE_LIMIT;
    const url = new URL(`${MELI_API_BASE}/orders/search`);
    url.searchParams.set("seller", account.ml_user_id.toString());
    url.searchParams.set("sort", "date_desc");
    url.searchParams.set("limit", limit.toString());
    url.searchParams.set("offset", offset.toString());
    url.searchParams.set("order.date_created.from", range.from.toISOString());
    url.searchParams.set("order.date_created.to", range.to.toISOString());

    const response = await fetch(url.toString(), { headers });
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message =
        typeof payload?.message === "string" ? payload.message : `Status ${response.status}`;
      console.error(
        `[meli][orders] Erro ${response.status} ao buscar pedidos da conta ${account.ml_user_id} (${rangeLabel}): ${message}`,
      );
      offset += limit;
      continue;
    }

    const orders = Array.isArray(payload?.results) ? payload.results : [];
    if (page === 0 && typeof payload?.paging?.total === "number") {
      total = payload.paging.total;
    }

    let detailedOrders: any[] = [];
    let shipments: any[] = [];

    try {
      const [orderDetailsResults, shipmentDetailsResults] = await Promise.all([
        Promise.allSettled(
          orders.map(async (order: any) => {
            const id = order?.id;
            if (!id) return order;
            try {
              const res = await fetch(`${MELI_API_BASE}/orders/${id}`, { headers });
              if (!res.ok) {
                console.warn(
                  `[meli][orders] Detalhes do pedido ${id} retornaram status ${res.status}, usando dados básicos...`,
                );
                return order;
              }
              const det = await res.json();
              return { ...order, ...det };
            } catch (error) {
              console.error(`[meli][orders] Erro ao buscar detalhes do pedido ${id}:`, error);
              return order;
            }
          }),
        ),
        Promise.allSettled(
          orders.map(async (order: any) => {
            const shippingId = order?.shipping?.id;
            if (!shippingId) return null;
            try {
              const res = await fetch(`${MELI_API_BASE}/shipments/${shippingId}`, { headers });
              if (!res.ok) {
                console.warn(
                  `[meli][orders] Detalhes do envio ${shippingId} retornaram status ${res.status}, continuando sem dados de envio...`,
                );
                return null;
              }
              const data = await res.json();
              return data;
            } catch (error) {
              console.error(`[meli][orders] Erro ao buscar envio ${shippingId}:`, error);
              return null;
            }
          }),
        ),
      ]);

      detailedOrders = orderDetailsResults.map((result, index) =>
        result.status === "fulfilled" ? result.value : orders[index],
      );
      shipments = shipmentDetailsResults.map((result) =>
        result.status === "fulfilled" ? result.value : null,
      );
    } catch (error) {
      console.error(`[meli][orders] Erro crítico ao buscar detalhes:`, error);
      detailedOrders = orders;
      shipments = orders.map(() => null);
    }

    detailedOrders.forEach((order: any, idx: number) => {
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

    const fetched = orders.length;
    offset += fetched;
    page += 1;

    console.log(
      `[meli][orders] Conta ${account.ml_user_id}: página ${page} (intervalo ${rangeLabel}), offset ${offset}, fetched ${fetched}, total ${total}`,
    );

    if (fetched === 0) {
      break;
    }
  }

  if (total > MAX_OFFSET && results.length >= MAX_OFFSET) {
    console.warn(
      `[meli][orders] Limite de ${MAX_OFFSET} vendas atingido para intervalo ${rangeLabel}.`,
    );
  }

  return results;
}

async function fetchOrdersForAccount(
  account: MeliAccount,
): Promise<OrdersFetchResult> {
  const results: MeliOrderPayload[] = [];
  const headers = { Authorization: `Bearer ${account.access_token}` };

  const historyStart = getHistoryStartDate();
  const now = new Date();
  const ranges = await buildSafeDateRanges(account, headers, historyStart, now);

  if (ranges.length === 0) {
    console.log(`[meli][orders] Conta ${account.ml_user_id} nao retornou vendas no intervalo analisado.`);
    return { orders: results, expectedTotal: 0 };
  }

  const expectedTotal = ranges.reduce((sum, range) => sum + range.total, 0);
  console.log(
    `[meli][orders] Conta ${account.ml_user_id}: ${ranges.length} janela(s) necessarias para cobrir o periodo. Total estimado: ${expectedTotal}.`,
  );

  for (const range of ranges) {
    const chunkOrders = await fetchOrdersInRange(account, headers, range);
    results.push(...chunkOrders);
  }

  return { orders: results, expectedTotal };
}

  
export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  try {
    session = await assertSessionToken(sessionCookie);
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const accounts = await prisma.meliAccount.findMany({
    where: { userId: session.sub },
    orderBy: { created_at: "desc" },
  });

  if (accounts.length === 0) {
    return NextResponse.json({
      syncedAt: new Date().toISOString(),
      accounts: [] as AccountSummary[],
      orders: [] as MeliOrderPayload[],
      errors: [] as SyncError[],
      totals: { expected: 0, fetched: 0 },
    });
  }

  const orders: MeliOrderPayload[] = [];
  const errors: SyncError[] = [];
  const summaries: AccountSummary[] = [];
  let totalExpectedOrders = 0;
  let totalFetchedOrders = 0;

  for (const account of accounts) {
    const summary: AccountSummary = {
      id: account.id,
      nickname: account.nickname,
      ml_user_id: account.ml_user_id,
      expires_at: account.expires_at.toISOString(),
    };
    summaries.push(summary);

    let current = account;
    try {
      current = await refreshMeliAccountToken(account);
      summary.expires_at = current.expires_at.toISOString();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao renovar token.";
      errors.push({ accountId: account.id, mlUserId: account.ml_user_id, message });
      console.error(`[meli][orders] Erro ao renovar token da conta ${account.id}:`, error);
      continue;
    }

    try {
      const { orders: accountOrders, expectedTotal } = await fetchOrdersForAccount(current);
      const accountExpected = expectedTotal || accountOrders.length;
      totalExpectedOrders += accountExpected;
      totalFetchedOrders += accountOrders.length;
      orders.push(...accountOrders);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao buscar pedidos.";
      errors.push({ accountId: current.id, mlUserId: current.ml_user_id, message });
      console.error(`[meli][orders] Erro ao buscar pedidos da conta ${current.id}:`, error);
    }
  }

  return NextResponse.json({
    syncedAt: new Date().toISOString(),
    accounts: summaries,
    orders,
    errors,
    totals: { expected: totalExpectedOrders, fetched: totalFetchedOrders },
  });
}
