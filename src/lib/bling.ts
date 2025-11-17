import type { NextRequest } from "next/server";
import type { BlingAccount } from "@prisma/client";
import prisma from "@/lib/prisma";
import { retryWithBackoff } from "./retry";

export const BLING_API_BASE_URL = "https://www.bling.com.br/Api/v3";
export const BLING_OAUTH_AUTHORIZE_URL = "https://www.bling.com.br/Api/v3/oauth/authorize";
export const BLING_TOKEN_ENDPOINT = "https://www.bling.com.br/Api/v3/oauth/token";

const BLING_TOKEN_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function firstHeaderValue(v?: string | null): string | undefined {
  return v?.split(",")[0]?.trim() || undefined;
}

export function resolveBlingRedirectUri(req: NextRequest): string {
  const envUri = process.env.BLING_REDIRECT_URI?.trim();
  if (envUri) return envUri;

  const forwardedHost = firstHeaderValue(req.headers.get("x-forwarded-host"));
  const originalHost = firstHeaderValue(req.headers.get("x-original-host"));
  const forwardedServer = firstHeaderValue(req.headers.get("x-forwarded-server"));
  const hostHeader = firstHeaderValue(req.headers.get("host"));
  const nextHost = req.nextUrl.host;

  const candidates = [forwardedHost, originalHost, forwardedServer, hostHeader, nextHost].filter(
    (v): v is string => Boolean(v?.trim()),
  );

  const isLocalHost = (value: string) =>
    /(^localhost(:\d+)?$)|(^127\.)|(^0\.0\.0\.0$)|(\.local$)/i.test(value);

  const host = candidates.find((v) => !isLocalHost(v)) ?? candidates[0];
  if (!host) {
    throw new Error("NÃƒÂ£o foi possÃƒÂ­vel determinar o host atual. Defina BLING_REDIRECT_URI ou acesse via domÃƒÂ­nio pÃƒÂºblico.");
  }

  const forwardedProto = firstHeaderValue(req.headers.get("x-forwarded-proto"))?.toLowerCase();
  const proto = forwardedProto || (isLocalHost(host) ? req.nextUrl.protocol.replace(":", "") || "http" : "https");
  return `${proto}://${host}/api/bling/callback`;
}

export async function saveBlingOauthState(state: string, userId: string) {
  await prisma.blingOauthState.create({
    data: { state, userId, expires_at: new Date(Date.now() + 10 * 60 * 1000) },
  });
}
export async function findBlingOauthState(state: string) {
  return prisma.blingOauthState.findFirst({ where: { state, expires_at: { gt: new Date() } } });
}
export async function deleteBlingOauthState(state: string) {
  await prisma.blingOauthState.deleteMany({ where: { state } });
}

export function resolveBlingCookieSettings(req: NextRequest) {
  const redirectUrl = new URL(resolveBlingRedirectUri(req));
  const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const secure = fwdProto === "https" || redirectUrl.protocol === "https:";
  return { domain: undefined, secure } as const;
}

function needsBlingTokenRefresh(account: BlingAccount): boolean {
  const expiresAt = account.expires_at instanceof Date ? account.expires_at : new Date(account.expires_at);
  return expiresAt.getTime() - Date.now() <= BLING_TOKEN_REFRESH_THRESHOLD_MS;
}

export async function refreshBlingAccountToken(account: BlingAccount, forceRefresh = false): Promise<BlingAccount> {
  if (!forceRefresh && !needsBlingTokenRefresh(account)) return account;

  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Variáveis BLING_CLIENT_ID e BLING_CLIENT_SECRET não configuradas no servidor.");
  }

  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: account.refresh_token });
  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  // Usar retry com backoff exponencial para renovação de token
  return await retryWithBackoff(async () => {
    const response = await fetch(BLING_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${authHeader}`,
        Accept: "application/json",
      },
      body,
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {}

    if (!response.ok) {
      const message =
        typeof payload?.error?.description === "string"
          ? payload.error.description
          : typeof payload?.message === "string"
          ? payload.message
          : `Status ${response.status}`;
      
      const error = new Error(`Falha ao renovar token Bling: ${message}`);
      (error as any).status = response.status;
      throw error;
    }

    const { access_token, refresh_token, expires_in } = payload ?? {};
    if (!access_token || typeof expires_in !== "number") {
      throw new Error("Resposta inválida ao renovar token de acesso do Bling.");
    }
    
    const safeExpiresIn = Math.max(expires_in - 60, 30);
    const expiresAt = new Date(Date.now() + safeExpiresIn * 1000);
    const nextRefreshToken = typeof refresh_token === "string" && refresh_token.length > 0 ? refresh_token : account.refresh_token;
    
    return await prisma.blingAccount.update({
      where: { id: account.id },
      data: { access_token, refresh_token: nextRefreshToken, expires_at: expiresAt, updated_at: new Date() },
    });
  }, 3, 1000, 10000); // 3 tentativas, delay base 1s, max delay 10s
}

export async function exchangeBlingCodeForTokens(code: string, redirectUri: string) {
  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("VariÃƒÂ¡veis BLING_CLIENT_ID e BLING_CLIENT_SECRET nÃƒÂ£o configuradas.");

  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(BLING_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${authHeader}`,
      Accept: "application/json",
    },
    body,
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {}

  if (!response.ok) {
    const message =
      typeof payload?.error?.description === "string"
        ? payload.error.description
        : typeof payload?.message === "string"
        ? payload.message
        : `Status ${response.status}`;
    throw new Error(`Erro ao trocar cÃƒÂ³digo por token: ${message}`);
  }

  const { access_token, refresh_token, expires_in } = payload ?? {};
  if (!access_token || !refresh_token || typeof expires_in !== "number") {
    throw new Error("Resposta invÃƒÂ¡lida da API Bling ao trocar cÃƒÂ³digo por token.");
  }

  const safeExpiresIn = Math.max(expires_in - 60, 30);
  const expiresAt = new Date(Date.now() + safeExpiresIn * 1000);
  return { access_token, refresh_token, expires_at: expiresAt };
}

// ----------------- HTTP util + paginaÃƒÂ§ÃƒÂ£o -----------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calcula as datas dos ÃƒÂºltimos 3 meses para filtros
 */
function getLast3MonthsDates() {
  const hoje = new Date();
  const tresMesesAtras = new Date();
  tresMesesAtras.setMonth(hoje.getMonth() - 3);

  return {
    dataInicial: tresMesesAtras.toISOString().split('T')[0], // YYYY-MM-DD
    dataFinal: hoje.toISOString().split('T')[0], // YYYY-MM-DD
  };
}

// Função para determinar o período de sincronização baseado no usuário
async function getSyncDateRange(userId?: string): Promise<{ dataInicial: string; dataFinal: string }> {
  // Se não tem userId, usar período padrão de 3 meses
  if (!userId) {
    return getLast3MonthsDates();
  }

  // Buscar o usuário para verificar se é o cliente Bonfim
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true }
  });

  // Cliente Bonfim: período fixo de 01/01/2024 - 31/08/2025
  // Identificar pelo email contendo "bonfim" (case-insensitive)
  if (user?.email && user.email.toLowerCase().includes('bonfim')) {
    console.log(`[Bling] Usuário Bonfim detectado - usando período histórico fixo`);
    return {
      dataInicial: '2024-01-01',
      dataFinal: '2025-08-31'
    };
  }

  // Outros clientes: período padrão de 3 meses
  return getLast3MonthsDates();
}

async function blingFetchJSON(
  url: string,
  accessToken: string,
  { retries = 1, initialDelayMs = 500 }: { retries?: number; initialDelayMs?: number } = {}, // Aumentado delay para rate limit
): Promise<any> {
  let attempt = 0;
  let delay = initialDelayMs;
  let lastErr: any = null;

  while (attempt <= retries) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    if (res.ok) {
      try {
        return await res.json();
      } catch {
        return null;
      }
    }

    if (res.status === 429) {
      // Rate limit - pausa maior
      console.log(`[Bling] Rate limit (429) - aguardando ${delay}ms`);
      await sleep(delay);
      attempt += 1;
      delay = Math.min(delay * 3, 5000); // Aumentado para 5 segundos
      continue;
    }

    if (res.status >= 500 && res.status <= 599) {
      await sleep(delay);
      attempt += 1;
      delay = Math.min(delay * 2, 2000);
      continue;
    }

    let msg = `Status ${res.status}`;
    try {
      const payload = await res.json();
      msg =
        typeof payload?.error?.description === "string"
          ? payload.error.description
          : typeof payload?.message === "string"
          ? payload.message
          : msg;
    } catch {}
    lastErr = new Error(msg);
    break;
  }
  throw lastErr ?? new Error("Falha desconhecida na chamada Bling.");
}

async function fetchAllPages(
  path: string,
  accessToken: string,
  baseQuery?: Record<string, string | number | undefined>,
  hardLimit = 100, // Otimizado para maior cobertura de dados
): Promise<any[]> {
  const results: any[] = [];

  // Usar apenas o estilo de paginaÃƒÂ§ÃƒÂ£o mais comum primeiro
  const pKey = "pagina";
  const lKey = "limite";
    let page = 1;
  const perPage = 100; // MÃƒÂ¡ximo por pÃƒÂ¡gina

    while (page <= hardLimit) {
      const q = new URLSearchParams();
      if (baseQuery) {
        for (const [k, v] of Object.entries(baseQuery)) {
          if (v !== undefined && v !== null) q.set(k, String(v));
        }
      }
      q.set(pKey, String(page));
      q.set(lKey, String(perPage));

      const url = `${BLING_API_BASE_URL}${path}?${q.toString()}`;
      let data: any = null;
      try {
        data = await blingFetchJSON(url, accessToken);
      } catch (e: any) {
        if (String(e?.message || "").startsWith("Status 404")) break;
        throw e;
      }

      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      if (list.length === 0) {
      break; // NÃƒÂ£o hÃƒÂ¡ mais dados
      }
      
      // Debug: log da primeira página para verificar estrutura
      if (page === 1) {
        console.log(`[Bling] 📄 Primeira página de ${path}:`, data);
        console.log(`[Bling] 📋 Lista extraída:`, list.slice(0, 1));
        if (list.length > 0) {
          console.log(`[Bling] 🔑 Campos do primeiro item:`, Object.keys(list[0]));
        }
      }
    
      results.push(...list);
    
    // Se retornou menos que o limite, chegou ao fim
      if (list.length < perPage) {
        break;
    }

    page += 1;
  }

  // Se nÃƒÂ£o encontrou nada, tentar sem paginaÃƒÂ§ÃƒÂ£o
  if (results.length === 0) {
  const url =
    `${BLING_API_BASE_URL}${path}` +
    (baseQuery ? `?${new URLSearchParams(Object.entries(baseQuery).map(([k, v]) => [k, String(v ?? "")]))}` : "");
  try {
    const data = await blingFetchJSON(url, accessToken);
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return list ?? [];
  } catch {
    return [];
  }
  }

  return results;
}

// ----------------- DomÃƒÂ­nio -----------------

export async function getBlingUserInfo(accessToken: string) {
  const url = `${BLING_API_BASE_URL}/usuarios`;
  const data = await blingFetchJSON(url, accessToken);
  return {
    id: data?.data?.[0]?.id?.toString() || null,
    name: data?.data?.[0]?.nome || "Conta Bling",
  };
}

export async function getBlingFormasPagamento(accessToken: string) {
  const candidates = ["/formas-pagamentos", "/formas-pagamento"];
  
  console.log(`[Bling] Buscando formas de pagamento...`);
  
  for (const path of candidates) {
    console.log(`[Bling] Buscando formas de pagamento em: ${path}`);
    
    try {
      // Usar paginaÃƒÂ§ÃƒÂ£o otimizada
      const list = await fetchAllPages(path, accessToken, {
        limite: 100, // MÃƒÂ¡ximo por pÃƒÂ¡gina
      }, 10); // MÃƒÂ¡ximo 10 pÃƒÂ¡ginas (1000 formas de pagamento)
      
      if (list.length > 0) {
        console.log(`[Bling] Encontradas ${list.length} formas de pagamento em ${path}`);
        return list;
      }
    } catch (e: any) {
      const errorMsg = String(e?.message || "");
      console.log(`[Bling] Erro ao buscar formas de pagamento em ${path}:`, errorMsg);
      
      if (errorMsg.startsWith("Status 404")) {
        console.log(`[Bling] Endpoint ${path} nÃƒÂ£o encontrado (404)`);
        continue; // Tenta prÃƒÂ³ximo endpoint
      } else if (errorMsg.startsWith("Status 401") || errorMsg.startsWith("Status 403")) {
        console.log(`[Bling] Erro de autorizaÃƒÂ§ÃƒÂ£o em ${path}:`, errorMsg);
        throw e; // Erro de autorizaÃƒÂ§ÃƒÂ£o, propaga
      } else {
        console.log(`[Bling] Erro nÃƒÂ£o crÃƒÂ­tico em ${path}:`, errorMsg);
        // Continua tentando outros endpoints
      }
    }
  }
  
  console.log(`[Bling] Nenhuma forma de pagamento encontrada em nenhum endpoint`);
  return [];
}

/**
 * Categorias financeiras do Bling.
 * Busca categorias de lanÃƒÂ§amentos financeiros usando os endpoints corretos da API v3.
 */
export async function getBlingCategorias(accessToken: string) {
  const seen = new Set<string>();
  const results: any[] = [];

  const pushIfValid = (arr: any[], source: string) => {
    console.log(`[Bling] Processando ${arr.length} categorias de ${source}`);
    let validCount = 0;
    let invalidCount = 0;
    
    for (const it of arr || []) {
      const id = it?.id ?? it?.idCategoria;
      const nome = it?.nome ?? it?.descricao ?? it?.descricaoCategoria;
      
      if (id == null || !nome || String(nome).trim() === "") {
        invalidCount++;
        continue;
      }

      const key = String(id);
      if (seen.has(key)) {
        continue; // Duplicada, ignora silenciosamente
      }
      seen.add(key);

      // Normaliza os dados da categoria
      let tipo = it?.tipo ?? null;
      let situacao = it?.situacao ?? it?.status ?? (typeof it?.ativo === "boolean" ? (it.ativo ? "ativo" : "inativo") : "ativo");
      
      // Converter tipo numÃƒÂ©rico para string (especÃƒÂ­fico para /categorias/receitas-despesas)
      if (typeof tipo === "number") {
        if (tipo === 1) tipo = "DESPESA";
        else if (tipo === 2) tipo = "RECEITA";
        else if (tipo === 3) tipo = "RECEITA_DESPESA";
        else tipo = null;
      }
      
      // Converter situaÃƒÂ§ÃƒÂ£o numÃƒÂ©rica para string (especÃƒÂ­fico para /categorias/receitas-despesas)
      if (typeof situacao === "number") {
        if (situacao === 1) situacao = "ativo";
        else if (situacao === 2) situacao = "inativo";
        else situacao = "ativo";
      }
      
      const categoria = {
        id,
        nome: String(nome).trim(),
        descricao: it?.descricao ?? it?.descricaoCategoria ?? null,
        tipo,
        situacao,
      };
      
      results.push(categoria);
      validCount++;
    }
    
    console.log(`[Bling] ${source}: ${validCount} vÃƒÂ¡lidas, ${invalidCount} invÃƒÂ¡lidas`);
  };

  // Endpoints possÃƒÂ­veis da API v3 do Bling para categorias FINANCEIRAS
  const endpoints = [
    "/categorias/receitas-despesas", // Categorias de receitas e despesas (PRINCIPAL)
  ];

  // Testar todos os endpoints possÃƒÂ­veis
  for (const endpoint of endpoints) {
    console.log(`[Bling] Tentando endpoint: ${endpoint}`);
    
    try {
      let queryParams: any = undefined;
      
      // ParÃƒÂ¢metros especÃƒÂ­ficos para categorias de receitas e despesas
      if (endpoint === "/categorias/receitas-despesas") {
        queryParams = {
          tipo: 0, // 0 = Todas, 1 = Despesa, 2 = Receita, 3 = Receita e despesa
          situacao: 1, // 0 = Ativas e Inativas, 1 = Ativas, 2 = Inativas
          limite: 100,
        };
      }
      // ParÃƒÂ¢metros especÃƒÂ­ficos para categorias de anÃƒÂºncios
      else if (endpoint === "/anuncios/categorias") {
        const tipoIntegracao = process.env.BLING_TIPO_INTEGRACAO?.trim();
        const idLoja = process.env.BLING_ID_LOJA?.trim();
        
        if (!tipoIntegracao || !idLoja) {
          console.log(`[Bling] ParÃƒÂ¢metros obrigatÃƒÂ³rios nÃƒÂ£o configurados para ${endpoint}: tipoIntegracao=${tipoIntegracao}, idLoja=${idLoja}`);
          continue;
        }
        
        queryParams = {
          tipoIntegracao,
          idLoja: parseInt(idLoja),
        };
      }
      
      console.log(`[Bling] Buscando categorias com parÃƒÂ¢metros:`, queryParams);
      
      const list = await fetchAllPages(endpoint, accessToken, queryParams);
      console.log(`[Bling] Endpoint ${endpoint} retornou ${list.length} itens`);
      
      if (list.length > 0) {
        pushIfValid(list, `${endpoint}`);
        console.log(`[Bling] Endpoint ${endpoint} funcionou, parando busca`);
        break; // Se encontrou resultados, para de tentar outros endpoints
      }
    } catch (e: any) {
      const errorMsg = String(e?.message || "");
      console.log(`[Bling] Erro no endpoint ${endpoint}:`, errorMsg);
      
      if (errorMsg.startsWith("Status 401") || errorMsg.startsWith("Status 403")) {
        console.log(`[Bling] Erro de autorizaÃƒÂ§ÃƒÂ£o no endpoint ${endpoint}:`, errorMsg);
        // NÃƒÂ£o propaga erro de autorizaÃƒÂ§ÃƒÂ£o, continua tentando outros endpoints
      } else if (errorMsg.startsWith("Status 404")) {
        console.log(`[Bling] Endpoint ${endpoint} nÃƒÂ£o encontrado (404)`);
      } else {
        console.log(`[Bling] Erro nÃƒÂ£o crÃƒÂ­tico no endpoint ${endpoint}:`, errorMsg);
      }
    }
  }

  // Se nÃƒÂ£o encontrou categorias nos endpoints principais, tenta extrair das contas
  if (results.length === 0) {
    console.log(`[Bling] Nenhuma categoria encontrada nos endpoints principais, tentando extrair das contas...`);
    try {
      const categoriasDasContas = await extractCategoriasFromContas(accessToken);
      results.push(...categoriasDasContas);
      console.log(`[Bling] ExtraÃƒÂ­das ${categoriasDasContas.length} categorias das contas`);
    } catch (error) {
      console.error(`[Bling] Erro ao extrair categorias das contas:`, error);
    }
  }

  console.log(`[Bling] Total de categorias encontradas: ${results.length}`);
  return results;
}

/**
 * Cria categorias padrÃƒÂ£o quando nÃƒÂ£o consegue sincronizar nenhuma do Bling
 */
export function getCategoriasPadrao() {
  console.log(`[Bling] Criando categorias padrÃƒÂ£o...`);
  
  const categoriasPadrao = [
    // Receitas
    {
      id: "padrao-receita-1",
      nome: "Vendas de Produtos",
      descricao: "Receitas com vendas de produtos",
      tipo: "RECEITA",
      situacao: "ativo",
    },
    {
      id: "padrao-receita-2", 
      nome: "PrestaÃƒÂ§ÃƒÂ£o de ServiÃƒÂ§os",
      descricao: "Receitas com prestaÃƒÂ§ÃƒÂ£o de serviÃƒÂ§os",
      tipo: "RECEITA",
      situacao: "ativo",
    },
    {
      id: "padrao-receita-3",
      nome: "Outras Receitas",
      descricao: "Outras receitas diversas",
      tipo: "RECEITA",
      situacao: "ativo",
    },
    // Despesas
    {
      id: "padrao-despesa-1",
      nome: "SalÃƒÂ¡rios e Encargos",
      descricao: "Despesas com salÃƒÂ¡rios e encargos sociais",
      tipo: "DESPESA", 
      situacao: "ativo",
    },
    {
      id: "padrao-despesa-2",
      nome: "CombustÃƒÂ­vel",
      descricao: "Despesas com combustÃƒÂ­vel",
      tipo: "DESPESA",
      situacao: "ativo",
    },
    {
      id: "padrao-despesa-3",
      nome: "Aluguel",
      descricao: "Despesas com aluguel",
      tipo: "DESPESA",
      situacao: "ativo",
    },
    {
      id: "padrao-despesa-4",
      nome: "Energia ElÃƒÂ©trica",
      descricao: "Despesas com energia elÃƒÂ©trica",
      tipo: "DESPESA",
      situacao: "ativo",
    },
    {
      id: "padrao-despesa-5",
      nome: "Telefone/Internet",
      descricao: "Despesas com telefone e internet",
      tipo: "DESPESA",
      situacao: "ativo",
    },
    {
      id: "padrao-despesa-6",
      nome: "Material de EscritÃƒÂ³rio",
      descricao: "Despesas com material de escritÃƒÂ³rio",
      tipo: "DESPESA",
      situacao: "ativo",
    },
    {
      id: "padrao-despesa-7",
      nome: "Marketing/Publicidade",
      descricao: "Despesas com marketing e publicidade",
      tipo: "DESPESA",
      situacao: "ativo",
    },
    {
      id: "padrao-despesa-8",
      nome: "ManutenÃƒÂ§ÃƒÂ£o",
      descricao: "Despesas com manutenÃƒÂ§ÃƒÂ£o",
      tipo: "DESPESA",
      situacao: "ativo",
    },
    {
      id: "padrao-despesa-9",
      nome: "Impostos e Taxas",
      descricao: "Despesas com impostos e taxas",
      tipo: "DESPESA",
      situacao: "ativo",
    },
    {
      id: "padrao-despesa-10",
      nome: "Outras Despesas",
      descricao: "Outras despesas diversas",
      tipo: "DESPESA",
      situacao: "ativo",
    },
  ];
  
  console.log(`[Bling] Criadas ${categoriasPadrao.length} categorias padrÃƒÂ£o`);
  return categoriasPadrao;
}

/**
 * SincronizaÃƒÂ§ÃƒÂ£o incremental de categorias - sÃƒÂ³ busca o que nÃƒÂ£o existe
 */
export async function syncCategoriasIncremental(accessToken: string, categoriasExistentes: string[]) {
  console.log(`[Bling] SincronizaÃƒÂ§ÃƒÂ£o incremental de categorias...`);
  const seen = new Set<string>();
  const results: any[] = [];
  const idsParaBuscar = new Set<number>();

  try {
    const [contasPagar, contasReceber] = await Promise.all([
      getBlingContasPagar(accessToken).catch(() => []),
      getBlingContasReceber(accessToken).catch(() => []),
    ]);

    console.log(`[Bling] Contas a pagar: ${contasPagar.length}, Contas a receber: ${contasReceber.length}`);
    
    // EstratÃƒÂ©gia super otimizada: buscar apenas 5 contas de cada tipo
    const buscarCategoriasDasContas = async (contas: any[], tipo: string) => {
      console.log(`[Bling] Buscando categorias de ${contas.length} ${tipo} (amostragem mÃƒÂ­nima)...`);
      let contasComCategoria = 0;
      
      // Limitar drasticamente a busca
      const maxContas = Math.min(contas.length, 3); // MÃƒÂ¡ximo 3 contas por tipo
      const contasParaBuscar = contas.slice(0, maxContas);
      
      console.log(`[Bling] Buscando apenas ${maxContas} ${tipo} para mÃƒÂ¡xima performance`);
      
      // Processar uma por vez para evitar rate limit
      for (const conta of contasParaBuscar) {
        try {
          let contaDetalhada = null;
          
          if (tipo === "contas a pagar") {
            contaDetalhada = await getBlingContaPagarById(accessToken, conta.id);
          } else {
            contaDetalhada = await getBlingContaReceberById(accessToken, conta.id);
          }
          
          if (contaDetalhada?.categoria?.id) {
            const categoriaId = contaDetalhada.categoria.id;
            if (typeof categoriaId === 'number') {
              const categoriaIdStr = String(categoriaId);
              
              // SÃƒÂ³ busca se nÃƒÂ£o existe no banco
              if (!categoriasExistentes.includes(categoriaIdStr)) {
                idsParaBuscar.add(categoriaId);
                contasComCategoria++;
              }
            }
          }
          
          // Pausa entre cada conta para evitar rate limit
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          // Ignora erros silenciosamente
          continue;
        }
      }
      
      console.log(`[Bling] ${tipo}: ${contasComCategoria} novas categorias encontradas`);
    };

    // Buscar categorias das contas (limitado a 5 de cada tipo)
    await buscarCategoriasDasContas(contasPagar, "contas a pagar");
    await buscarCategoriasDasContas(contasReceber, "contas a receber");

    console.log(`[Bling] Total de IDs de categoria novos encontrados: ${idsParaBuscar.size}`);

    // Buscar categorias completas pelos IDs (apenas as novas)
    if (idsParaBuscar.size > 0) {
      console.log(`[Bling] Buscando categorias completas pelos IDs...`);
      
      const idsArray = Array.from(idsParaBuscar);
      
      // Buscar uma por vez para evitar rate limit
      for (const id of idsArray) {
        try {
          const categoria = await getBlingCategoriaById(accessToken, id);
          if (categoria && !seen.has(categoria.id)) {
            seen.add(categoria.id);
            results.push(categoria);
          }
          
          // Pausa entre cada categoria
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          // Ignora erros silenciosamente
          continue;
        }
      }
    }

    console.log(`[Bling] Total de categorias novas extraÃƒÂ­das: ${results.length}`);
    return results;
  } catch (error) {
    console.error(`[Bling] Erro na sincronizaÃƒÂ§ÃƒÂ£o incremental:`, error);
    return [];
  }
}

/**
 * Busca uma categoria especÃƒÂ­fica pelo ID no endpoint /categorias/receitas-despesas
 */
export async function getBlingCategoriaById(accessToken: string, idCategoria: number) {
  try {
    const url = `${BLING_API_BASE_URL}/categorias/receitas-despesas/${idCategoria}`;
    console.log(`[Bling] Buscando categoria por ID: ${idCategoria}`);
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json();
      const categoria = data?.data;
      
      if (categoria) {
        // Normalizar os dados da categoria
        let tipo = categoria.tipo;
        let situacao = categoria.situacao;
        
        // Converter tipo numÃƒÂ©rico para string
        if (typeof tipo === "number") {
          if (tipo === 1) tipo = "DESPESA";
          else if (tipo === 2) tipo = "RECEITA";
          else if (tipo === 3) tipo = "RECEITA_DESPESA";
          else tipo = null;
        }
        
        // Converter situaÃƒÂ§ÃƒÂ£o numÃƒÂ©rica para string
        if (typeof situacao === "number") {
          if (situacao === 1) situacao = "ativo";
          else if (situacao === 2) situacao = "inativo";
          else situacao = "ativo";
        }
        
        const categoriaNormalizada = {
          id: String(categoria.id),
          nome: categoria.descricao || categoria.nome,
          descricao: categoria.descricao || null,
          tipo,
          situacao,
        };
        
        console.log(`[Bling] Categoria encontrada por ID ${idCategoria}:`, categoriaNormalizada);
        return categoriaNormalizada;
      }
    } else {
      console.log(`[Bling] Categoria com ID ${idCategoria} nÃƒÂ£o encontrada (${response.status})`);
    }
  } catch (error) {
    console.error(`[Bling] Erro ao buscar categoria por ID ${idCategoria}:`, error);
  }
  
  return null;
}

/**
 * Busca uma conta a pagar individual pelo ID para obter categoria
 */
export async function getBlingContaPagarById(accessToken: string, idConta: number) {
  console.log(`[Bling] 🚀 Iniciando busca individual para conta a pagar ${idConta}`);
  
  // Tentar diferentes endpoints para contas a pagar
  const endpoints = [
    `/contas/pagar/${idConta}`,
    `/financeiro/contas-pagar/${idConta}`,
    `/contas-pagar/${idConta}`
  ];
  
  for (const endpoint of endpoints) {
    try {
      const url = `${BLING_API_BASE_URL}${endpoint}`;
      console.log(`[Bling] 🔗 Tentando endpoint: ${endpoint} para conta ${idConta}`);
      console.log(`[Bling] 🌐 URL completa: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      
      console.log(`[Bling] 📡 Status da resposta: ${response.status} para ${endpoint}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`[Bling] Resposta completa da API para conta ${idConta} (${endpoint}):`, data);
        
        const conta = data?.data;
        
        if (conta) {
          console.log(`[Bling] Conta a pagar encontrada por ID ${idConta} (${endpoint}):`, conta);
          console.log(`[Bling] Categoria da conta a pagar ${idConta}:`, conta?.categoria);
          console.log(`[Bling] Todos os campos da conta ${idConta}:`, Object.keys(conta));
          return conta;
        } else {
          console.log(`[Bling] Conta ${idConta} não encontrada na resposta da API (${endpoint})`);
        }
      } else {
        console.log(`[Bling] Endpoint ${endpoint} falhou para conta ${idConta} (${response.status})`);
        const errorText = await response.text();
        console.log(`[Bling] Erro da API:`, errorText);
      }
    } catch (error) {
      console.error(`[Bling] Erro ao buscar conta ${idConta} no endpoint ${endpoint}:`, error);
    }
  }
  
  console.log(`[Bling] Nenhum endpoint funcionou para conta a pagar ${idConta}`);
  return null;
}

/**
 * Busca uma conta a receber individual pelo ID para obter categoria
 */
export async function getBlingContaReceberById(accessToken: string, idConta: number) {
  try {
    const url = `${BLING_API_BASE_URL}/contas/receber/${idConta}`;
    console.log(`[Bling] Buscando conta a receber por ID: ${idConta}`);
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json();
      const conta = data?.data;
      
      if (conta) {
        console.log(`[Bling] Conta a receber encontrada por ID ${idConta}:`, conta);
        console.log(`[Bling] Categoria da conta a receber ${idConta}:`, conta?.categoria);
        return conta;
      }
    } else {
      console.log(`[Bling] Conta a receber com ID ${idConta} nÃƒÂ£o encontrada (${response.status})`);
    }
  } catch (error) {
    console.error(`[Bling] Erro ao buscar conta a receber por ID ${idConta}:`, error);
  }
  
  return null;
}

/**
 * Extrai categorias das contas a pagar e receber quando nÃƒÂ£o hÃƒÂ¡ endpoint especÃƒÂ­fico
 */
export async function extractCategoriasFromContas(accessToken: string) {
  console.log(`[Bling] Extraindo categorias das contas (versÃƒÂ£o otimizada)...`);
  const seen = new Set<string>();
  const results: any[] = [];
  const idsParaBuscar = new Set<number>();

  try {
    const [contasPagar, contasReceber] = await Promise.all([
      getBlingContasPagar(accessToken).catch(() => []),
      getBlingContasReceber(accessToken).catch(() => []),
    ]);

    console.log(`[Bling] Contas a pagar: ${contasPagar.length}, Contas a receber: ${contasReceber.length}`);
    
    // EstratÃƒÂ©gia otimizada: buscar apenas algumas contas para obter IDs de categoria
    const buscarCategoriasDasContas = async (contas: any[], tipo: string) => {
      console.log(`[Bling] Buscando categorias de ${contas.length} ${tipo} (amostragem)...`);
      let contasComCategoria = 0;
      
      // Limitar a busca para nÃƒÂ£o sobrecarregar a API
      const maxContas = Math.min(contas.length, 20); // MÃƒÂ¡ximo 20 contas por tipo
      const contasParaBuscar = contas.slice(0, maxContas);
      
      console.log(`[Bling] Buscando apenas ${maxContas} ${tipo} para otimizar performance`);
      
      // Processar em lotes muito pequenos
      const batchSize = 2; // Reduzido para 2
      for (let i = 0; i < contasParaBuscar.length; i += batchSize) {
        const batch = contasParaBuscar.slice(i, i + batchSize);
        
        const contasDetalhadas = await Promise.all(
          batch.map(async (conta) => {
            try {
              if (tipo === "contas a pagar") {
                return await getBlingContaPagarById(accessToken, conta.id);
              } else {
                return await getBlingContaReceberById(accessToken, conta.id);
              }
            } catch (error) {
              // Ignora erros 429 silenciosamente
              return null;
            }
          })
        );
        
        // Extrair IDs de categoria das contas detalhadas
        for (const contaDetalhada of contasDetalhadas) {
          if (contaDetalhada?.categoria?.id) {
            const categoriaId = contaDetalhada.categoria.id;
            if (typeof categoriaId === 'number') {
              idsParaBuscar.add(categoriaId);
              contasComCategoria++;
            }
          }
        }
        
        // Pausa maior entre lotes para evitar rate limit
        if (i + batchSize < contasParaBuscar.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log(`[Bling] ${tipo}: ${contasComCategoria} contas com categoria encontradas`);
    };

    // Buscar categorias das contas a pagar e receber (limitado)
    await buscarCategoriasDasContas(contasPagar, "contas a pagar");
    await buscarCategoriasDasContas(contasReceber, "contas a receber");

    console.log(`[Bling] Total de IDs de categoria ÃƒÂºnicos encontrados: ${idsParaBuscar.size}`);

    // Buscar categorias completas pelos IDs
    if (idsParaBuscar.size > 0) {
      console.log(`[Bling] Buscando categorias completas pelos IDs...`);
      
      // Buscar categorias em paralelo (limitado a 5 por vez)
      const idsArray = Array.from(idsParaBuscar);
      const batchSize = 5; // Reduzido para 5
      
      for (let i = 0; i < idsArray.length; i += batchSize) {
        const batch = idsArray.slice(i, i + batchSize);
        
        const categoriasBatch = await Promise.all(
          batch.map(async (id) => {
            const categoria = await getBlingCategoriaById(accessToken, id);
            return categoria;
          })
        );
        
        // Adicionar categorias vÃƒÂ¡lidas aos resultados
        for (const categoria of categoriasBatch) {
          if (categoria && !seen.has(categoria.id)) {
            seen.add(categoria.id);
            results.push(categoria);
          }
        }
        
        // Pausa maior entre lotes
        if (i + batchSize < idsArray.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }

    console.log(`[Bling] Total de categorias extraÃƒÂ­das das contas: ${results.length}`);
    return results;
  } catch (error) {
    console.error(`[Bling] Erro ao extrair categorias das contas:`, error);
    return [];
  }
}

export async function getBlingContasPagar(accessToken: string, userId?: string) {
  const candidates = ["/contas/pagar", "/financeiro/contas-pagar", "/contas-pagar"];
  const { dataInicial, dataFinal } = await getSyncDateRange(userId);

  console.log(`[Bling] Buscando contas a pagar: ${dataInicial} até ${dataFinal}`);
  
  for (const path of candidates) {
    console.log(`[Bling] Buscando contas a pagar em: ${path}`);
    
    try {
      // Usar paginaÃƒÂ§ÃƒÂ£o otimizada com filtros de data
      const list = await fetchAllPages(path, accessToken, {
        limite: 100, // MÃƒÂ¡ximo por pÃƒÂ¡gina
        situacao: 1, // Apenas ativas (1=ativa, 2=inativa, 0=todas)
        tipoFiltroData: "V", // V = Data de vencimento (igual ao contas a receber)
        dataInicial: dataInicial, // Filtro de data inicial
        dataFinal: dataFinal, // Filtro de data final
      }, 50); // MÃƒÂ¡ximo 50 pÃƒÂ¡ginas (5000 contas)
      
      if (list.length > 0) {
        console.log(`[Bling] Encontradas ${list.length} contas a pagar em ${path} (ÃƒÂºltimos 3 meses)`);
        console.log(`[Bling] 📋 Estrutura da primeira conta da listagem:`, list[0]);
        console.log(`[Bling] 🔑 Campos da primeira conta:`, Object.keys(list[0]));
        return list;
      }
    } catch (e: any) {
      const errorMsg = String(e?.message || "");
      console.log(`[Bling] Erro ao buscar contas a pagar em ${path}:`, errorMsg);
      
      if (errorMsg.startsWith("Status 404")) {
        console.log(`[Bling] Endpoint ${path} nÃƒÂ£o encontrado (404)`);
        continue; // Tenta prÃƒÂ³ximo endpoint
      } else if (errorMsg.startsWith("Status 401") || errorMsg.startsWith("Status 403")) {
        console.log(`[Bling] Erro de autorizaÃƒÂ§ÃƒÂ£o em ${path}:`, errorMsg);
        throw e; // Erro de autorizaÃƒÂ§ÃƒÂ£o, propaga
      } else {
        console.log(`[Bling] Erro nÃƒÂ£o crÃƒÂ­tico em ${path}:`, errorMsg);
        // Continua tentando outros endpoints
      }
    }
  }
  
  console.log(`[Bling] Nenhuma conta a pagar encontrada em nenhum endpoint`);
  return [];
}

export async function getBlingContasReceber(accessToken: string, userId?: string) {
  const candidates = ["/contas/receber", "/financeiro/contas-receber", "/contas-receber"];
  const { dataInicial, dataFinal } = await getSyncDateRange(userId);

  console.log(`[Bling] Buscando contas a receber: ${dataInicial} até ${dataFinal}`);
  
  for (const path of candidates) {
    console.log(`[Bling] Buscando contas a receber em: ${path}`);
    
    try {
      // Usar paginaÃƒÂ§ÃƒÂ£o otimizada com filtros de data
      const list = await fetchAllPages(path, accessToken, {
        limite: 100, // MÃƒÂ¡ximo por pÃƒÂ¡gina
        situacao: 1, // Apenas ativas (1=ativa, 2=inativa, 0=todas)
        tipoFiltroData: "V", // V = Data de vencimento
        dataInicial: dataInicial, // Filtro de data inicial
        dataFinal: dataFinal, // Filtro de data final
      }, 50); // MÃƒÂ¡ximo 50 pÃƒÂ¡ginas (5000 contas)
      
      if (list.length > 0) {
        console.log(`[Bling] Encontradas ${list.length} contas a receber em ${path} (ÃƒÂºltimos 3 meses)`);
        return list;
      }
    } catch (e: any) {
      const errorMsg = String(e?.message || "");
      console.log(`[Bling] Erro ao buscar contas a receber em ${path}:`, errorMsg);
      
      if (errorMsg.startsWith("Status 404")) {
        console.log(`[Bling] Endpoint ${path} nÃƒÂ£o encontrado (404)`);
        continue; // Tenta prÃƒÂ³ximo endpoint
      } else if (errorMsg.startsWith("Status 401") || errorMsg.startsWith("Status 403")) {
        console.log(`[Bling] Erro de autorizaÃƒÂ§ÃƒÂ£o em ${path}:`, errorMsg);
        throw e; // Erro de autorizaÃƒÂ§ÃƒÂ£o, propaga
      } else {
        console.log(`[Bling] Erro nÃƒÂ£o crÃƒÂ­tico em ${path}:`, errorMsg);
        // Continua tentando outros endpoints
      }
    }
  }
  
  console.log(`[Bling] Nenhuma conta a receber encontrada em nenhum endpoint`);
  return [];
}
