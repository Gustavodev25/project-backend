import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import {
  SHOPEE_API_BASE,
  SHOPEE_PATH_TOKEN_GET,
  deleteShopeeOauthState,
  resolveShopeeCookieSettings,
  signShopeeBaseString,
  getShopInfo,
} from "@/lib/shopee";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const shop_id = url.searchParams.get("shop_id") || url.searchParams.get("shopid");
  const oauthMode = req.cookies.get("shopee_oauth_mode")?.value ?? "redirect";
  const stateCookie = req.cookies.get("shopee_oauth_state")?.value;
  const cookieSettings = resolveShopeeCookieSettings(req);

  const clearAuthCookies = (res: NextResponse) => {
    const base = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: cookieSettings.secure,
      path: "/",
      maxAge: 0,
      ...(cookieSettings.domain ? { domain: cookieSettings.domain } : {}),
    };
    res.cookies.set({ name: "shopee_oauth_state", value: "", ...base });
    res.cookies.set({ name: "shopee_oauth_mode", value: "", ...base });
  };

  const respondWithPopup = (options: {
    success: boolean;
    message: string;
    data?: Record<string, unknown>;
    status?: number;
  }) => {
    const payload = {
      type: options.success ? "shopee:auth:success" : "shopee:auth:error",
      message: options.message,
      data: options.data ?? null,
    };
    const payloadJson = JSON.stringify(payload).replace(/</g, "\\u003c");
    const title = options.success ? "Conexao Shopee concluida" : "Conexao Shopee nao concluida";
    const description = options.success
      ? "Conta Shopee conectada com sucesso. Esta janela pode ser fechada."
      : "Nao foi possivel conectar a conta Shopee. Esta janela pode ser fechada.";
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; padding: 48px 32px; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f9fafb; color: #111827; }
    main { max-width: 420px; margin: 0 auto; text-align: center; }
    h1 { font-size: 20px; margin-bottom: 16px; }
    p { font-size: 15px; line-height: 1.5; margin-bottom: 12px; }
    .hint { color: #6b7280; font-size: 14px; margin-top: 28px; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${description}</p>
    <p class="hint">Esta janela sera fechada automaticamente.</p>
  </main>
  <script>
    (function() {
      const payload = ${payloadJson};
      try {
        if (window.opener) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch (err) {
        console.error('Failed to notify opener about Shopee auth result.', err);
      }
      setTimeout(function() { window.close(); }, 1600);
    })();
  </script>
</body>
</html>`;
    const res = new NextResponse(html, {
      status: options.status ?? (options.success ? 200 : 400),
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    clearAuthCookies(res);
    return res;
  };

  const respondWithText = (body: string, status: number) => {
    const res = new NextResponse(body, { status });
    clearAuthCookies(res);
    return res;
  };

  if (!code || !shop_id) {
    if (oauthMode === "popup") {
      return respondWithPopup({ success: false, message: "Missing code or shop_id", status: 400 });
    }
    return respondWithText("Missing code/shop_id", 400);
  }

  const session = await tryVerifySessionToken(req.cookies.get("session")?.value);
  if (!session) {
    if (oauthMode === "popup") {
      return respondWithPopup({ success: false, message: "Sessao expirada. Faca login novamente.", status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    if (loginUrl.hostname === "localhost" || loginUrl.hostname === "127.0.0.1") loginUrl.protocol = "http:";
    loginUrl.searchParams.set("redirect", "/contas");
    loginUrl.searchParams.set("error", "session_expired");
    loginUrl.searchParams.set("message", "Voce precisa estar logado para conectar sua conta Shopee");
    const redirectRes = NextResponse.redirect(loginUrl);
    clearAuthCookies(redirectRes);
    return redirectRes;
  }

  const partnerId = process.env.SHOPEE_PARTNER_ID!;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY!;
  if (!partnerId || !partnerKey) {
    if (oauthMode === "popup") {
      return respondWithPopup({ success: false, message: "Credenciais Shopee ausentes no servidor.", status: 500 });
    }
    return respondWithText("Shopee credentials missing", 500);
  }

  // Token exchange
  const ts = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${SHOPEE_PATH_TOKEN_GET}${ts}`;
  const sign = signShopeeBaseString(partnerKey, baseString);

  const tokenUrl = new URL(`${SHOPEE_API_BASE}${SHOPEE_PATH_TOKEN_GET}`);
  tokenUrl.searchParams.set("partner_id", String(partnerId));
  tokenUrl.searchParams.set("timestamp", String(ts));
  tokenUrl.searchParams.set("sign", sign);

  const body = {
    code,
    shop_id,
    partner_id: Number(partnerId),
  } as any;

  const tokenRes = await fetch(tokenUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok) {
    const message = `Erro ao obter token Shopee: ${JSON.stringify(payload)}`;
    if (oauthMode === "popup") {
      return respondWithPopup({ success: false, message, status: 400 });
    }
    return respondWithText(message, 400);
  }

  const access_token: string | undefined = payload?.access_token;
  const refresh_token: string | undefined = payload?.refresh_token;
  const expire_in: number | undefined = payload?.expire_in;
  const resp_shop_id: string | number | undefined = payload?.shop_id ?? shop_id;
  const merchant_id: string | number | undefined = payload?.merchant_id ?? null;

  if (!access_token || !refresh_token || !expire_in || !resp_shop_id) {
    const message = `Resposta invalida de token Shopee: ${JSON.stringify(payload)}`;
    if (oauthMode === "popup") {
      return respondWithPopup({ success: false, message, status: 400 });
    }
    return respondWithText(message, 400);
  }

  const expiresAt = new Date(Date.now() + Math.max(30, expire_in - 60) * 1000);
  const shopIdStr = String(resp_shop_id);
  const merchantIdStr = merchant_id ? String(merchant_id) : null;

  // Buscar nome da loja
  let shopName: string | null = null;
  try {
    const shopInfo = await getShopInfo({
      partnerId,
      partnerKey,
      accessToken: access_token,
      shopId: shopIdStr,
    });
    shopName = shopInfo?.shop_name || null;
  } catch (err) {
    console.warn("Não foi possível buscar nome da loja Shopee:", err);
  }

  try {
    // Usar raw query para não depender do Prisma Client regenerado
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM shopee_account
      WHERE user_id = ${session.sub} AND shop_id = ${shopIdStr}
      LIMIT 1
    `;

    if (existing.length > 0) {
      // Update
      await prisma.$executeRaw`
        UPDATE shopee_account
        SET
          access_token = ${access_token},
          refresh_token = ${refresh_token},
          expires_at = ${expiresAt},
          merchant_id = ${merchantIdStr},
          shop_name = ${shopName},
          updated_at = NOW()
        WHERE user_id = ${session.sub} AND shop_id = ${shopIdStr}
      `;
    } else {
      // Insert
      await prisma.$executeRaw`
        INSERT INTO shopee_account (
          id, user_id, shop_id, shop_name, merchant_id,
          access_token, refresh_token, expires_at, created_at, updated_at
        ) VALUES (
          gen_random_uuid()::text,
          ${session.sub},
          ${shopIdStr},
          ${shopName},
          ${merchantIdStr},
          ${access_token},
          ${refresh_token},
          ${expiresAt},
          NOW(),
          NOW()
        )
      `;
    }
  } catch (err) {
    console.error("Erro ao salvar conta Shopee:", err);
    const message = "Erro interno ao salvar credenciais Shopee";
    if (oauthMode === "popup") {
      return respondWithPopup({ success: false, message, status: 500 });
    }
    return respondWithText(message, 500);
  }

  if (stateCookie) {
    try {
      await deleteShopeeOauthState(stateCookie);
    } catch (err) {
      console.warn("Falha ao remover state Shopee utilizado:", err);
    }
  }

  const successData = {
    shopId: shopIdStr,
    merchantId: merchantIdStr,
    expiresAt: expiresAt.toISOString(),
  };

  if (oauthMode === "popup") {
    return respondWithPopup({
      success: true,
      message: "Conta Shopee conectada com sucesso.",
      data: successData,
      status: 200,
    });
  }

  const contasUrl = new URL("/contas", req.url);
  contasUrl.searchParams.set("shopee_connected", "true");
  contasUrl.searchParams.set("shopee_shop_id", shopIdStr);
  if (merchantIdStr) {
    contasUrl.searchParams.set("shopee_merchant_id", merchantIdStr);
  }
  const redirectRes = NextResponse.redirect(contasUrl, { status: 302 });
  clearAuthCookies(redirectRes);
  return redirectRes;
}






