import type { NextRequest } from "next/server";
import type { MeliAccount } from "@prisma/client";
import prisma from "@/lib/prisma";
import { retryWithBackoff } from "./retry";
import { isAccountMarkedAsInvalid, markAccountAsInvalid, clearAccountInvalidMark } from "./account-status";

const MELI_API_BASE_URL =
  process.env.MELI_API_BASE?.replace(/\/$/, "") ||
  "https://api.mercadolibre.com";
const MELI_TOKEN_ENDPOINT = `${MELI_API_BASE_URL}/oauth/token`;
// Renovar se faltam menos de 24 horas para expirar
const MELI_TOKEN_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function firstHeaderValue(v?: string | null): string | undefined {
  return v?.split(",")[0]?.trim() || undefined;
}

export function resolveMeliRedirectUri(req: NextRequest): string {
  // 1) Prioriza ENV fixa (recomendado em ngrok/Vercel)
  const envUri = process.env.MELI_REDIRECT_URI?.trim();
  if (envUri) return envUri;

  // 2) Coleta candidatos de host
  const forwardedHost = firstHeaderValue(req.headers.get("x-forwarded-host"));
  const originalHost = firstHeaderValue(req.headers.get("x-original-host"));
  const forwardedServer = firstHeaderValue(
    req.headers.get("x-forwarded-server"),
  );
  const hostHeader = firstHeaderValue(req.headers.get("host"));
  const nextHost = req.nextUrl.host; // inclui hostname[:port]

  const candidates = [
    forwardedHost,
    originalHost,
    forwardedServer,
    hostHeader,
    nextHost,
  ].filter((v): v is string => Boolean(v?.trim()));

  const isLocalHost = (value: string) =>
    /(^localhost(:\d+)?$)|(^127\.)|(^0\.0\.0\.0$)|(\.local$)/i.test(value);

  const host = candidates.find((v) => !isLocalHost(v)) ?? candidates[0];
  if (!host) {
    throw new Error(
      "Não foi possível determinar o host atual. Defina MELI_REDIRECT_URI ou acesse via domínio público.",
    );
  }

  // 3) Protocolo: respeita X-Forwarded-Proto; senão, http p/ local e https p/ público
  const forwardedProto = firstHeaderValue(
    req.headers.get("x-forwarded-proto"),
  )?.toLowerCase();
  const proto =
    forwardedProto ||
    (isLocalHost(host)
      ? req.nextUrl.protocol.replace(":", "") || "http"
      : "https");

  return `${proto}://${host}/api/meli/callback`;
}

export async function saveMeliOauthState(state: string, userId: string) {
  await prisma.meliOauthState.create({
    data: {
      state,
      userId,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
}

export async function findMeliOauthState(state: string) {
  return prisma.meliOauthState.findFirst({
    where: {
      state,
      expires_at: { gt: new Date() },
    },
  });
}

export async function deleteMeliOauthState(state: string) {
  await prisma.meliOauthState.deleteMany({ where: { state } });
}

// src/lib/meli.ts
export function resolveMeliCookieSettings(req: NextRequest) {
  const redirectUrl = new URL(resolveMeliRedirectUri(req));
  const fwdProto = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const secure = fwdProto === "https" || redirectUrl.protocol === "https:";
  return {
    domain: undefined, // <- não force domínio do ngrok
    secure,
  } as const;
}

function needsMeliTokenRefresh(account: MeliAccount): boolean {
  const expiresAt =
    account.expires_at instanceof Date
      ? account.expires_at
      : new Date(account.expires_at);
  return (
    expiresAt.getTime() - Date.now() <= MELI_TOKEN_REFRESH_THRESHOLD_MS
  );
}

async function _refreshMeliAccountToken(
  account: MeliAccount,
  forceRefresh = false,
): Promise<MeliAccount> {
  // Se forceRefresh for true, tenta renovar independente do estado
  if (!forceRefresh && !needsMeliTokenRefresh(account)) {
    return account;
  }

  // Verificar se a conta está marcada como inválida
  const isInvalid = await isAccountMarkedAsInvalid(account.id, 'meli');
  if (isInvalid && !forceRefresh) {
    // Se não é forceRefresh, apenas retorna erro informativo
    throw new Error("REFRESH_TOKEN_INVALID: Conta marcada como inválida. Use forceRefresh=true para tentar renovar.");
  }

  const clientId = process.env.MELI_APP_ID;
  const clientSecret = process.env.MELI_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Variáveis MELI_APP_ID e MELI_CLIENT_SECRET não configuradas no servidor.",
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: account.refresh_token,
  });

  // Usar retry com backoff exponencial para renovação de token
  const updated = await retryWithBackoff(async () => {
    const response = await fetch(MELI_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message =
        typeof payload?.message === "string"
          ? payload.message
          : `Status ${response.status}`;
      
      // Tratamento específico para diferentes tipos de erro
      if (response.status === 400) {
        // Verificar se é erro de refresh token inválido com mais precisão
        const isTokenInvalid = (
          payload?.error === "invalid_grant" ||
          (payload?.error_description && 
           (payload.error_description.includes("invalid_grant") ||
            payload.error_description.includes("refresh_token") ||
            payload.error_description.includes("expired"))) ||
          (message.includes("invalid_grant") && message.includes("refresh")) ||
          (message.includes("invalid") && message.includes("refresh_token"))
        );
        
        if (isTokenInvalid) {
          // NÃO marcar como inválido imediatamente - deixar para o sistema de retry inteligente
          console.log(`[meli][refresh] Token pode estar inválido para conta ${account.id}, mas não marcando como inválido ainda`);
          throw new Error("REFRESH_TOKEN_INVALID: Refresh token expirado ou inválido. Reconexão necessária.");
        }
        
        // Outros erros 400 - não são relacionados a token inválido
        console.log(`[meli][refresh] Erro 400 não relacionado a token para conta ${account.id}: ${message}`);
        throw new Error(`BAD_REQUEST: ${message}`);
      }
      
      if (response.status === 401) {
        throw new Error(`UNAUTHORIZED: ${message}`);
      }
      
      if (response.status === 429) {
        throw new Error(`RATE_LIMITED: ${message}`);
      }
      
      // Erro genérico
      const error = new Error(`Falha ao renovar token: ${message}`);
      (error as any).status = response.status;
      throw error;
    }

    const { access_token, refresh_token, expires_in } = payload ?? {};

    if (!access_token || typeof expires_in !== "number") {
      throw new Error("Resposta inválida ao renovar token de acesso.");
    }

    const safeExpiresIn = Math.max(expires_in - 60, 30);
    const expiresAt = new Date(Date.now() + safeExpiresIn * 1000);
    const nextRefreshToken =
      typeof refresh_token === "string" && refresh_token.length > 0
        ? refresh_token
        : account.refresh_token;

    return await prisma.meliAccount.update({
      where: { id: account.id },
      data: {
        access_token,
        refresh_token: nextRefreshToken,
        expires_at: expiresAt,
        updated_at: new Date(),
      },
    });
  }, 3, 1000, 10000); // 3 tentativas, delay base 1s, max delay 10s

  return updated;
}

export const refreshMeliAccountToken = _refreshMeliAccountToken;

/**
 * Sistema de contadores para rastrear falhas consecutivas de renovação
 */
const refreshFailureCounters = new Map<string, { count: number; lastFailure: Date }>();

/**
 * Incrementa contador de falhas para uma conta
 */
function incrementFailureCounter(accountId: string): number {
  const now = new Date();
  const existing = refreshFailureCounters.get(accountId);
  
  if (!existing) {
    refreshFailureCounters.set(accountId, { count: 1, lastFailure: now });
    return 1;
  }
  
  // Reset contador se passou mais de 1 hora desde a última falha
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  if (existing.lastFailure < oneHourAgo) {
    refreshFailureCounters.set(accountId, { count: 1, lastFailure: now });
    return 1;
  }
  
  existing.count++;
  existing.lastFailure = now;
  return existing.count;
}

/**
 * Limpa contador de falhas para uma conta (quando renovação é bem-sucedida)
 */
function clearFailureCounter(accountId: string): void {
  refreshFailureCounters.delete(accountId);
}

/**
 * Tenta renovar o token de uma conta MELI com estratégia ultra-agressiva
 * Esta função tenta múltiplas estratégias antes de desistir
 */
export async function smartRefreshMeliAccountToken(
  account: MeliAccount,
  maxRetries = 7
): Promise<MeliAccount> {
  let lastError: Error | null = null;
  let consecutiveFailures = 0;
  
  // Primeiro, verificar se a conta está marcada como inválida
  const isMarkedInvalid = await isAccountMarkedAsInvalid(account.id, 'meli');
  if (isMarkedInvalid) {
    console.log(`[meli][smart-refresh] Conta ${account.id} está marcada como inválida, mas tentando renovar mesmo assim...`);
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[meli][smart-refresh] Tentativa ${attempt}/${maxRetries} para conta ${account.id}`);
      
      // Estratégias diferentes baseadas no número da tentativa
      let forceRefresh = true;
      if (attempt <= 2) {
        // Primeiras tentativas: renovação normal
        forceRefresh = false;
      } else if (attempt <= 4) {
        // Tentativas intermediárias: força renovação
        forceRefresh = true;
      } else {
        // Últimas tentativas: força renovação com delay maior
        forceRefresh = true;
        await new Promise(resolve => setTimeout(resolve, 2000)); // Delay adicional
      }
      
      const result = await _refreshMeliAccountToken(account, forceRefresh);
      
      // Se chegou até aqui, renovação foi bem-sucedida
      clearFailureCounter(account.id);
      
      // Se a conta estava marcada como inválida, limpar a marcação
      if (isMarkedInvalid) {
        await clearAccountInvalidMark(account.id, 'meli');
        console.log(`[meli][smart-refresh] ✅ Conta ${account.id} recuperada! Limpando marcação de inválida.`);
      }
      
      console.log(`[meli][smart-refresh] ✅ Token renovado com sucesso para conta ${account.id} na tentativa ${attempt}`);
      return result;
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      consecutiveFailures = incrementFailureCounter(account.id);
      
      console.log(`[meli][smart-refresh] ❌ Tentativa ${attempt} falhou para conta ${account.id} (falhas consecutivas: ${consecutiveFailures})`);
      
      // Se é erro de token inválido, verificar se devemos marcar como inválido
      if (lastError.message.includes("REFRESH_TOKEN_INVALID")) {
        // Só marcar como inválido após 5 falhas consecutivas (mais tolerante)
        if (consecutiveFailures >= 5) {
          console.log(`[meli][smart-refresh] 🚫 Marcando conta ${account.id} como inválida após ${consecutiveFailures} falhas consecutivas`);
          await markAccountAsInvalid(account.id, 'meli');
          break;
        } else {
          console.log(`[meli][smart-refresh] ⚠️ Token pode estar inválido, mas tentando mais ${5 - consecutiveFailures} vezes antes de marcar como inválido`);
        }
      }
      
      // Para outros erros, aguardar antes da próxima tentativa
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(1.5, attempt - 1), 10000); // Backoff mais suave, max 10s
        console.log(`[meli][smart-refresh] ⏳ Aguardando ${delay}ms antes da próxima tentativa...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // Se chegou aqui, todas as tentativas falharam
  console.log(`[meli][smart-refresh] 💥 Todas as tentativas falharam para conta ${account.id}`);
  throw lastError || new Error("Falha ao renovar token após múltiplas tentativas");
}

/**
 * Tenta renovar tokens de contas que estão marcadas como ativas mas podem ter tokens expirados
 * Esta função é chamada antes de verificar vendas para garantir que os tokens estão válidos
 */
export async function ensureActiveAccountsHaveValidTokens(): Promise<{
  success: string[];
  failed: string[];
  recovered: string[];
}> {
  const success: string[] = [];
  const failed: string[] = [];
  const recovered: string[] = [];
  
  try {
    // Buscar TODAS as contas MELI (incluindo as marcadas como inválidas)
    const allAccounts = await prisma.meliAccount.findMany();
    
    console.log(`[meli][ensure-valid] Verificando ${allAccounts.length} contas (incluindo inválidas)...`);
    
    for (const account of allAccounts) {
      try {
        // Verificar se o token precisa ser renovado OU se a conta está marcada como inválida
        const needsRefresh = needsMeliTokenRefresh(account);
        const isMarkedInvalid = await isAccountMarkedAsInvalid(account.id, 'meli');
        
        if (needsRefresh || isMarkedInvalid) {
          console.log(`[meli][ensure-valid] Token da conta ${account.id} precisa ser renovado (needsRefresh: ${needsRefresh}, isMarkedInvalid: ${isMarkedInvalid})`);
          
          // Tentar renovação com estratégia agressiva
          const updated = await smartRefreshMeliAccountToken(account, 5);
          
          // Verificar se a conta estava marcada como inválida antes
          if (isMarkedInvalid) {
            recovered.push(account.id);
            console.log(`[meli][ensure-valid] ✅ Conta ${account.id} recuperada de estado inválido`);
          } else {
            success.push(account.id);
            console.log(`[meli][ensure-valid] ✅ Token da conta ${account.id} renovado com sucesso`);
          }
        } else {
          success.push(account.id);
          console.log(`[meli][ensure-valid] ✅ Token da conta ${account.id} ainda válido`);
        }
        
      } catch (error) {
        failed.push(account.id);
        console.log(`[meli][ensure-valid] ❌ Falha ao verificar/renovar conta ${account.id}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      }
    }
    
    console.log(`[meli][ensure-valid] Verificação concluída: ${success.length} sucessos, ${failed.length} falhas, ${recovered.length} recuperadas`);
    
  } catch (error) {
    console.error(`[meli][ensure-valid] Erro geral na verificação:`, error);
  }
  
  return { success, failed, recovered };
}

/**
 * Sistema de recuperação automática para contas marcadas como inválidas
 * Tenta renovar periodicamente para verificar se o token voltou a funcionar
 */
export async function attemptAccountRecovery(accountId: string): Promise<boolean> {
  try {
    const account = await prisma.meliAccount.findUnique({
      where: { id: accountId },
    });
    
    if (!account) {
      console.log(`[meli][recovery] Conta ${accountId} não encontrada`);
      return false;
    }
    
    // Verificar se ainda está marcada como inválida
    const isInvalid = await isAccountMarkedAsInvalid(accountId, 'meli');
    if (!isInvalid) {
      console.log(`[meli][recovery] Conta ${accountId} já não está mais marcada como inválida`);
      return true;
    }
    
    console.log(`[meli][recovery] Tentando recuperar conta ${accountId}...`);
    
    // Tentar renovação com estratégia mais agressiva
    try {
      const updated = await _refreshMeliAccountToken(account, true);
      
      // Se chegou até aqui, renovação foi bem-sucedida
      await clearAccountInvalidMark(accountId, 'meli');
      clearFailureCounter(accountId);
      
      console.log(`[meli][recovery] ✅ Conta ${accountId} recuperada com sucesso!`);
      return true;
      
    } catch (error) {
      console.log(`[meli][recovery] ❌ Falha ao recuperar conta ${accountId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      return false;
    }
    
  } catch (error) {
    console.error(`[meli][recovery] Erro geral ao tentar recuperar conta ${accountId}:`, error);
    return false;
  }
}

/**
 * Verifica e tenta recuperar todas as contas marcadas como inválidas
 */
export async function recoverAllInvalidAccounts(): Promise<{ recovered: string[]; failed: string[] }> {
  const recovered: string[] = [];
  const failed: string[] = [];
  
  try {
    // Buscar todas as contas MELI marcadas como inválidas
    const invalidAccounts = await prisma.meliAccount.findMany({
      where: {
        refresh_token_invalid_until: {
          gt: new Date(), // Ainda marcada como inválida
        },
      },
    });
    
    console.log(`[meli][recovery] Encontradas ${invalidAccounts.length} contas marcadas como inválidas`);
    
    for (const account of invalidAccounts) {
      const success = await attemptAccountRecovery(account.id);
      if (success) {
        recovered.push(account.id);
      } else {
        failed.push(account.id);
      }
      
      // Pequeno delay entre tentativas para não sobrecarregar a API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`[meli][recovery] Recuperação concluída: ${recovered.length} sucessos, ${failed.length} falhas`);
    
  } catch (error) {
    console.error(`[meli][recovery] Erro geral na recuperação:`, error);
  }
  
  return { recovered, failed };
}

export { MELI_API_BASE_URL };
