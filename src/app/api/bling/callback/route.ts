import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import {
  deleteBlingOauthState,
  findBlingOauthState,
  resolveBlingCookieSettings,
  resolveBlingRedirectUri,
  exchangeBlingCodeForTokens,
  getBlingUserInfo,
} from "@/lib/bling";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  const cookieState = req.cookies.get("bling_oauth_state")?.value;
  const stateRecord = state ? await findBlingOauthState(state) : null;

  const headers = new Headers();
  const redirectUri = resolveBlingRedirectUri(req);
  const { domain, secure } = resolveBlingCookieSettings(req);

  // Limpa cookie de state
  headers.append(
    "Set-Cookie",
    `bling_oauth_state=; Path=/; Max-Age=0; SameSite=Lax;${secure ? " Secure;" : ""} HttpOnly${domain ? `; Domain=${domain}` : ""}`
  );

  // Trata erros do Bling
  if (error) {
    console.error(`Erro do Bling: ${error} - ${errorDescription}`);
    const contasUrl = new URL("/contas", req.url);
    contasUrl.searchParams.set("error", "bling_auth_failed");
    contasUrl.searchParams.set("message", `Erro na autenticação do Bling: ${errorDescription || error}`);
    return NextResponse.redirect(contasUrl, { headers });
  }

  if (!code || !state || !cookieState || state !== cookieState) {
    console.error("Invalid state/code:", { code: !!code, state: !!state, cookieState: !!cookieState, stateMatch: state === cookieState });
    return new NextResponse("Invalid state/code", { status: 400, headers });
  }

  const userId = stateRecord?.userId;

  await deleteBlingOauthState(state);

  if (!userId) {
    console.error("Usuário não está logado para conectar conta do Bling");
    const loginUrl = new URL("/login", req.url);
    if (loginUrl.hostname === "localhost" || loginUrl.hostname === "127.0.0.1") {
      loginUrl.protocol = "http:";
    }
    loginUrl.searchParams.set("redirect", "/contas");
    loginUrl.searchParams.set("error", "session_expired");
    loginUrl.searchParams.set("message", "Você precisa estar logado para conectar sua conta do Bling");
    return NextResponse.redirect(loginUrl, { headers });
  }

  const session = await tryVerifySessionToken(req.cookies.get("session")?.value);
  if (!session) {
    console.error("Sessão inexistente no callback do Bling");
    const loginUrl = new URL("/login", req.url);
    if (loginUrl.hostname === "localhost" || loginUrl.hostname === "127.0.0.1") {
      loginUrl.protocol = "http:";
    }
    loginUrl.searchParams.set("redirect", "/contas");
    loginUrl.searchParams.set("error", "session_expired");
    loginUrl.searchParams.set("message", "Você precisa estar logado para conectar sua conta do Bling");
    return NextResponse.redirect(loginUrl, { headers });
  }

  if (session.sub !== userId) {
    console.error("Sessão atual não corresponde ao state registrado");
    const loginUrl = new URL("/login", req.url);
    if (loginUrl.hostname === "localhost" || loginUrl.hostname === "127.0.0.1") {
      loginUrl.protocol = "http:";
    }
    loginUrl.searchParams.set("redirect", "/contas");
    loginUrl.searchParams.set("error", "session_expired");
    loginUrl.searchParams.set("message", "Você precisa estar logado para conectar sua conta do Bling");
    return NextResponse.redirect(loginUrl, { headers });
  }

  let tokens;
  try {
    tokens = await exchangeBlingCodeForTokens(code, redirectUri);
  } catch (error: unknown) {
    console.error("Erro ao trocar código por token Bling:", error);
    return new NextResponse(
      `Erro na troca de token: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      { status: 400, headers }
    );
  }

  const { access_token, refresh_token, expires_at } = tokens;

  // Buscar informações do usuário Bling
  let blingUserId: string | null = null;
  let accountName: string | null = null;

  try {
    const userInfo = await getBlingUserInfo(access_token);
    blingUserId = userInfo.id;
    accountName = userInfo.name;
  } catch (error) {
    console.error("Erro ao buscar informações do usuário Bling:", error);
    // Continua mesmo sem as informações do usuário
  }

  try {
    await prisma.blingAccount.upsert({
      where: {
        userId_bling_user_id: {
          userId: session.sub,
          bling_user_id: blingUserId || "",
        },
      },
      update: {
        access_token,
        refresh_token,
        expires_at,
        account_name: accountName,
        updated_at: new Date(),
      },
      create: {
        userId,
        bling_user_id: blingUserId,
        access_token,
        refresh_token,
        expires_at,
        account_name: accountName,
      },
    });
  } catch (error) {
    console.error("Erro ao persistir conta do Bling", error);
    return new NextResponse("Erro interno ao salvar credenciais", {
      status: 500,
      headers,
    });
  }

  // Redirecionar para a página de contas com parâmetros de sucesso
  const contasUrl = new URL("/contas", req.url);
  contasUrl.searchParams.set("bling_connected", "true");
  if (blingUserId) {
    contasUrl.searchParams.set("bling_user_id", blingUserId);
  }
  if (accountName) {
    contasUrl.searchParams.set("bling_account_name", accountName);
  }

  return NextResponse.redirect(contasUrl, { headers, status: 302 });
}
