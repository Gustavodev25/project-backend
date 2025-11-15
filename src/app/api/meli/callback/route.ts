import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import { clearAccountInvalidMark } from "@/lib/account-status";
import {
  deleteMeliOauthState,
  findMeliOauthState,
  resolveMeliCookieSettings,
  resolveMeliRedirectUri,
} from "@/lib/meli";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("meli_oauth_state")?.value;
  const stateRecord = state ? await findMeliOauthState(state) : null;

  const headers = new Headers();
  // limpa cookie de state
  const redirectUri = resolveMeliRedirectUri(req);
  const { domain, secure } = resolveMeliCookieSettings(req);

  headers.append(
    "Set-Cookie",
    `meli_oauth_state=; Path=/; Max-Age=0; SameSite=Lax;${secure ? " Secure;" : ""} HttpOnly${domain ? `; Domain=${domain}` : ""}`
  );

  if (!code || !state || !cookieState || state !== cookieState) {
    return new NextResponse("Invalid state/code", { status: 400, headers });
  }

  const userId = stateRecord?.userId;

  await deleteMeliOauthState(state);
  
  if (!userId) {
    console.error("Usuário não está logado para conectar conta do MercadoLibre");
    // Redirecionar para login com parâmetro de callback
    const loginUrl = new URL("/login", req.url);
    // Forçar HTTP em desenvolvimento local
    if (loginUrl.hostname === "localhost" || loginUrl.hostname === "127.0.0.1") {
      loginUrl.protocol = "http:";
    }
    loginUrl.searchParams.set("redirect", "/contas");
    loginUrl.searchParams.set("error", "session_expired");
    loginUrl.searchParams.set("message", "Você precisa estar logado para conectar sua conta do MercadoLibre");
    return NextResponse.redirect(loginUrl, { headers });
  }

  const session = await tryVerifySessionToken(req.cookies.get("session")?.value);
  if (!session) {
    console.error("Sessão inexistente no callback do MercadoLibre");
    const loginUrl = new URL("/login", req.url);
    if (loginUrl.hostname === "localhost" || loginUrl.hostname === "127.0.0.1") {
      loginUrl.protocol = "http:";
    }
    loginUrl.searchParams.set("redirect", "/contas");
    loginUrl.searchParams.set("error", "session_expired");
    loginUrl.searchParams.set(
      "message",
      "Você precisa estar logado para conectar sua conta do MercadoLibre",
    );
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
    loginUrl.searchParams.set(
      "message",
      "Você precisa estar logado para conectar sua conta do MercadoLibre",
    );
    return NextResponse.redirect(loginUrl, { headers });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.MELI_APP_ID!,
    client_secret: process.env.MELI_CLIENT_SECRET!,
    code,
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokens = await tokenRes.json();

  if (!tokenRes.ok) {
    return new NextResponse(
      `Erro na troca de token: ${JSON.stringify(tokens)}`,
      { status: 400, headers }
    );
  }

  const { access_token, refresh_token, expires_in, user_id } = tokens as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user_id?: number;
  };

  if (!access_token || !refresh_token || !expires_in || !user_id) {
    return new NextResponse(
      `Resposta inválida do Mercado Livre: ${JSON.stringify(tokens)}`,
      { status: 400, headers }
    );
  }
  const expiresAt = new Date(Date.now() + (expires_in - 60) * 1000);

  // (Opcional) buscar nickname
  let nickname: string | null = null;
  try {
    const u = await fetch(`https://api.mercadolibre.com/users/${user_id}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (u.ok) {
      const j = await u.json();
      nickname = j?.nickname ?? null;
    }
  } catch {}

  try {
    const result = await prisma.meliAccount.upsert({
      where: {
        userId_ml_user_id: {
          userId: session.sub,
          ml_user_id: user_id,
        },
      },
      update: {
        access_token,
        refresh_token,
        expires_at: expiresAt,
        nickname,
        updated_at: new Date(),
      },
      create: {
        userId,
        ml_user_id: user_id,
        access_token,
        refresh_token,
        expires_at: expiresAt,
        nickname,
      },
    });

    // Limpar marcação de inválido se existir
    await clearAccountInvalidMark(result.id, 'meli');
    
  } catch (error) {
    console.error("Erro ao persistir conta do Mercado Livre", error);
    return new NextResponse("Erro interno ao salvar credenciais", {
      status: 500,
      headers,
    });
  }

  // Redirecionar para a página de contas com parâmetros de sucesso
  const contasUrl = new URL("/contas", req.url);
  contasUrl.searchParams.set("meli_connected", "true");
  contasUrl.searchParams.set("meli_user_id", String(user_id));
  if (nickname) {
    contasUrl.searchParams.set("meli_nickname", nickname);
  }
  
  return NextResponse.redirect(contasUrl, { headers, status: 302 });
}
