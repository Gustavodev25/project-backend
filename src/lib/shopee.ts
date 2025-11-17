import crypto from "crypto";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { retryWithBackoff } from "./retry";

// Base URL for Shopee Open Platform (live)
export const SHOPEE_API_BASE = (
  process.env.SHOPEE_API_BASE?.replace(/\/$/, "") ||
  "https://partner.shopeemobile.com"
);

// Paths
export const SHOPEE_PATH_AUTH_PARTNER = "/api/v2/shop/auth_partner";
export const SHOPEE_PATH_TOKEN_GET = "/api/v2/auth/token/get";
export const SHOPEE_PATH_ACCESS_TOKEN_GET = "/api/v2/auth/access_token/get";

function firstHeaderValue(v?: string | null): string | undefined {
  return v?.split(",")[0]?.trim() || undefined;
}

function isLocalHost(value: string) {
  return /(^localhost(:\d+)?$)|(^127\.)|(^0\.0\.0\.0$)|(\.local$)/i.test(value);
}

// Resolve the public origin (protocol + host) without any path
export function resolveShopeeOrigin(req: NextRequest): string {
  const envOrigin = process.env.SHOPEE_REDIRECT_ORIGIN?.trim();
  if (envOrigin) return envOrigin.replace(/\/$/, "");

  const forwardedHost = firstHeaderValue(req.headers.get("x-forwarded-host"));
  const originalHost = firstHeaderValue(req.headers.get("x-original-host"));
  const forwardedServer = firstHeaderValue(req.headers.get("x-forwarded-server"));
  const hostHeader = firstHeaderValue(req.headers.get("host"));
  const nextHost = req.nextUrl.host;

  const candidates = [
    forwardedHost,
    originalHost,
    forwardedServer,
    hostHeader,
    nextHost,
  ].filter((v): v is string => Boolean(v?.trim()));

  const host = candidates.find((v) => !isLocalHost(v)) ?? candidates[0];
  if (!host) throw new Error("Não foi possível determinar o host público atual para Shopee.");

  const forwardedProto = firstHeaderValue(req.headers.get("x-forwarded-proto"))?.toLowerCase();
  const proto = forwardedProto || (isLocalHost(host) ? (req.nextUrl.protocol.replace(":", "") || "http") : "https");
  return `${proto}://${host}`;
}

export function resolveShopeeCallbackUrl(req: NextRequest): string {
  const origin = resolveShopeeOrigin(req);
  return `${origin}/api/shopee/callback`;
}

export function resolveShopeeCookieSettings(req: NextRequest) {
  const origin = resolveShopeeOrigin(req);
  const url = new URL(origin);
  const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const secure = fwdProto === "https" || url.protocol === "https:";
  return { domain: undefined as string | undefined, secure } as const;
}

// Shopee signature helper (HMAC-SHA256 hex lowercase)
export function signShopeeBaseString(
  partnerKey: string,
  baseString: string,
): string {
  return crypto.createHmac("sha256", partnerKey).update(baseString).digest("hex");
}

// Função auxiliar para construir URLs assinadas da Shopee
function buildShopeeSignedUrl(path: string, baseParams: Record<string, string | number>, opts: {
  partnerId: string;
  partnerKey: string;
  accessToken: string;
  shopId: string;
}): string {
  const ts = Math.floor(Date.now() / 1000);
  const commonParams = {
      partner_id: opts.partnerId,
      timestamp: ts,
      access_token: opts.accessToken,
      shop_id: opts.shopId,
  };
  const allParams = { ...commonParams, ...baseParams };
  
  // A assinatura da Shopee não inclui os parâmetros da query string, apenas os comuns
  const baseString = `${opts.partnerId}${path}${ts}${opts.accessToken}${opts.shopId}`;
  const sign = signShopeeBaseString(opts.partnerKey, baseString);

  const url = new URL(`${SHOPEE_API_BASE}${path}`);
  for (const [k, v] of Object.entries(allParams)) {
      url.searchParams.set(k, String(v));
  }
  url.searchParams.set("sign", sign);
  
  return url.toString();
}

// 1. Listar Pedidos - /api/v2/order/get_order_list
export async function getShopeeOrderList(opts: {
  partnerId: string;
  partnerKey: string;
  accessToken: string;
  shopId: string;
  createTimeFrom: number;
  createTimeTo: number;
  pageSize: number;
  cursor?: string;
}): Promise<{ order_list: { order_sn: string }[]; more: boolean; next_cursor?: string }> {
  const path = "/api/v2/order/get_order_list";
  const params: Record<string, string | number> = {
    time_range_field: "create_time",
    time_from: opts.createTimeFrom,
    time_to: opts.createTimeTo,
    page_size: opts.pageSize,
  };
  if (opts.cursor) params.cursor = opts.cursor;

  const url = buildShopeeSignedUrl(path, params, opts);

  const response = await fetch(url, { method: "GET" });
  
  // Verificar resposta HTTP primeiro
  if (!response.ok) {
    const errorText = await response.text().catch(() => `Status ${response.status}`);
    throw new Error(`Shopee get_order_list falhou: ${errorText}`);
  }
  
  const payload: any = await response.json();

  // Verificar erro na resposta do payload
  if (payload.error) {
    const errorMsg = payload.message || payload.error || "Erro desconhecido";
    throw new Error(`Shopee get_order_list falhou: ${errorMsg}`);
  }

  const resp = payload?.response || {};
  return {
    order_list: Array.isArray(resp.order_list) ? resp.order_list : [],
    more: Boolean(resp.more),
    next_cursor: resp.next_cursor,
  };
}

// 2. Detalhes do Pedido - /api/v2/order/get_order_detail
export async function getShopeeOrderDetail(opts: {
  partnerId: string;
  partnerKey: string;
  accessToken: string;
  shopId: string;
  orderSnList: string;
}): Promise<{ order_list: unknown[] }> {
    const path = "/api/v2/order/get_order_detail";
    const params = {
        order_sn_list: opts.orderSnList,
        // Campos otimizados para buscar tudo de uma vez
        response_optional_fields: "buyer_username,item_list,recipient_address,total_amount,order_status,shipping_carrier,package_list,create_time,pay_time,income_details"
    };
    
    const url = buildShopeeSignedUrl(path, params, opts);
    const response = await fetch(url, { method: "GET" });
    
    // Verificar resposta HTTP primeiro
    if (!response.ok) {
        const errorText = await response.text().catch(() => `Status ${response.status}`);
        throw new Error(`Shopee get_order_detail falhou: ${errorText}`);
    }
    
    const payload: any = await response.json();

    // Verificar erro na resposta do payload
    if (payload.error) {
        const errorMsg = payload.message || payload.error || "Erro desconhecido";
        throw new Error(`Shopee get_order_detail falhou: ${errorMsg}`);
    }

    const resp = payload?.response || {};
    return {
        order_list: Array.isArray(resp.order_list) ? resp.order_list : [],
    };
}


// 3. (NOVO) Detalhes de Pagamento/Escrow - /api/v2/payment/get_escrow_detail
export async function getShopeeEscrowDetail(opts: {
    partnerId: string;
    partnerKey: string;
    accessToken: string;
    shopId: string;
    orderSn: string;
}): Promise<{ escrow_detail: unknown }> {
    const path = "/api/v2/payment/get_escrow_detail";
    const params = {
        order_sn: opts.orderSn,
    };

    const url = buildShopeeSignedUrl(path, params, opts);
    const response = await fetch(url, { method: "GET" });
    
    // Verificar resposta HTTP primeiro
    if (!response.ok) {
        const errorText = await response.text().catch(() => `Status ${response.status}`);
        console.warn(`Shopee get_escrow_detail falhou para ${opts.orderSn}: ${errorText}`);
        return { escrow_detail: {} }; // Retorna objeto vazio em caso de erro para não parar a sincronização
    }
    
    const payload: any = await response.json();
    
    // É comum não encontrar detalhes de escrow para pedidos muito recentes ou cancelados
    if (payload.error === "error_not_found") {
        return { escrow_detail: {} };
    }

    // Verificar erro na resposta do payload
    if (payload.error) {
        const errorMsg = payload.message || payload.error || "Erro desconhecido";
        console.warn(`Shopee get_escrow_detail falhou para ${opts.orderSn}: ${errorMsg}`);
        return { escrow_detail: {} };
    }

    const resp = payload?.response || {};
    return {
        escrow_detail: resp || {},
    };
}

// Função para construir URL de autenticação Shopee
export function buildShopeeAuthUrl(req: NextRequest): string {
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  
  if (!partnerId || !partnerKey) {
    throw new Error("SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY são obrigatórios");
  }

  const callbackUrl = resolveShopeeCallbackUrl(req);
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${SHOPEE_PATH_AUTH_PARTNER}${timestamp}`;
  const sign = signShopeeBaseString(partnerKey, baseString);

  const url = new URL(`${SHOPEE_API_BASE}${SHOPEE_PATH_AUTH_PARTNER}`);
  url.searchParams.set("partner_id", partnerId);
  url.searchParams.set("timestamp", timestamp.toString());
  url.searchParams.set("redirect", callbackUrl);
  url.searchParams.set("sign", sign);

  return url.toString();
}

// Função para salvar estado OAuth Shopee
export async function saveShopeeOauthState(
  userId: string,
  state: string,
  expiresAt: Date
): Promise<void> {
  await prisma.shopeeOauthState.create({
    data: {
      userId,
      state,
      expires_at: expiresAt,
    },
  });
}

// Função para deletar estado OAuth Shopee
export async function deleteShopeeOauthState(state: string): Promise<void> {
  await prisma.shopeeOauthState.deleteMany({
    where: { state },
  });
}

// Função para obter informações da loja Shopee
export async function getShopInfo(opts: {
  partnerId: string;
  partnerKey: string;
  accessToken: string;
  shopId: string;
}): Promise<{ shop_name: string; shop_id: string }> {
  const path = "/api/v2/shop/get_shop_info";
  const params: Record<string, string | number> = {};
  
  const url = buildShopeeSignedUrl(path, params, opts);
  
  const response = await fetch(url, { method: "GET" });
  
  // Verificar resposta HTTP primeiro
  if (!response.ok) {
    const errorText = await response.text().catch(() => `Status ${response.status}`);
    throw new Error(`Shopee get_shop_info falhou: ${errorText}`);
  }
  
  const payload: any = await response.json();

  // Verificar erro na resposta do payload
  if (payload.error) {
    const errorMsg = payload.message || payload.error || "Erro desconhecido";
    throw new Error(`Shopee get_shop_info falhou: ${errorMsg}`);
  }

  const resp = payload?.response || {};
  return {
    shop_name: resp.shop_name || "",
    shop_id: resp.shop_id || opts.shopId,
  };
}

// Função para renovar token de conta Shopee usando a API oficial
export async function refreshShopeeAccountToken(
  account: { id: string; shop_id: string; access_token: string; refresh_token: string; expires_at: Date },
  forceRefresh: boolean = false
): Promise<{ id: string; shop_id: string; access_token: string; refresh_token: string; expires_at: Date }> {
  const now = new Date();
  const expiresAt = new Date(account.expires_at);
  
  // Se não for refresh forçado e o token ainda não expirou (margem de 5 minutos), retornar a conta atual
  if (!forceRefresh && expiresAt.getTime() > now.getTime() + (5 * 60 * 1000)) {
    return {
      id: account.id,
      shop_id: account.shop_id,
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expires_at: expiresAt,
    };
  }

  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  
  if (!partnerId || !partnerKey) {
    throw new Error("SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY são obrigatórios para renovar tokens");
  }

  // Usar retry com backoff exponencial para renovação de token
  return await retryWithBackoff(async () => {
    console.log(`[Shopee Token Refresh] Renovando token para loja ${account.shop_id}...`);
    
    // Construir URL e assinatura para a API de renovação de token
    // IMPORTANTE: Para refresh, usamos /api/v2/auth/access_token/get
    const ts = Math.floor(Date.now() / 1000);
    const baseString = `${partnerId}${SHOPEE_PATH_ACCESS_TOKEN_GET}${ts}`;
    const sign = signShopeeBaseString(partnerKey, baseString);

    const tokenUrl = new URL(`${SHOPEE_API_BASE}${SHOPEE_PATH_ACCESS_TOKEN_GET}`);
    tokenUrl.searchParams.set("partner_id", partnerId);
    tokenUrl.searchParams.set("timestamp", ts.toString());
    tokenUrl.searchParams.set("sign", sign);

    // Body com refresh_token para renovação
    const body = {
      refresh_token: account.refresh_token,
      shop_id: Number(account.shop_id),
      partner_id: Number(partnerId),
    };

    const response = await fetch(tokenUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => `Status ${response.status}`);
      throw new Error(`Shopee token refresh falhou: ${errorText}`);
    }

    const payload: any = await response.json();

    if (payload.error) {
      const errorMsg = payload.message || payload.error || "Erro desconhecido";
      throw new Error(`Shopee token refresh falhou: ${errorMsg}`);
    }

    const newAccessToken = payload.access_token;
    const newRefreshToken = payload.refresh_token;
    const expireIn = payload.expire_in;

    if (!newAccessToken || !newRefreshToken || !expireIn) {
      throw new Error(`Resposta inválida ao renovar token: ${JSON.stringify(payload)}`);
    }

    // Calcular nova data de expiração (com margem de 60 segundos)
    const newExpiresAt = new Date(Date.now() + Math.max(30, expireIn - 60) * 1000);
    
    // Atualizar no banco de dados
    const updated = await prisma.shopeeAccount.update({
      where: { id: account.id },
      data: {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_at: newExpiresAt,
        updated_at: new Date(),
      },
    });

    console.log(`[Shopee Token Refresh] Token renovado com sucesso para loja ${account.shop_id}. Expira em: ${newExpiresAt.toISOString()}`);

    return {
      id: updated.id,
      shop_id: updated.shop_id,
      access_token: updated.access_token,
      refresh_token: updated.refresh_token,
      expires_at: updated.expires_at,
    };
  }, 3, 1000, 10000); // 3 tentativas, delay base 1s, max delay 10s
}