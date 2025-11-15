import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { tryVerifySessionToken } from "@/lib/auth";
import {
  buildShopeeAuthUrl,
  resolveShopeeCookieSettings,
  resolveShopeeCallbackUrl,
  saveShopeeOauthState,
} from "@/lib/shopee";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await tryVerifySessionToken(req.cookies.get("session")?.value);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
    }

    const partnerId = process.env.SHOPEE_PARTNER_ID;
    const partnerKey = process.env.SHOPEE_PARTNER_KEY;
    const redirectOrigin = process.env.SHOPEE_REDIRECT_ORIGIN;
    
    console.log('[Shopee Auth] Iniciando autenticação:', {
      hasPartnerId: !!partnerId,
      hasPartnerKey: !!partnerKey,
      redirectOrigin: redirectOrigin || 'NÃO DEFINIDO',
      host: req.headers.get("host"),
      forwardedHost: req.headers.get("x-forwarded-host"),
    });

    if (!partnerId || !partnerKey) {
      return NextResponse.json(
        { error: "Credenciais Shopee ausentes (defina SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY)" },
        { status: 500 },
      );
    }

    const isPopupFlow = req.nextUrl.searchParams.get("popup") === "1";

    // State para CSRF
    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos
    await saveShopeeOauthState(session.sub, state, expiresAt);

    // Shopee exige um redirect (URL completa onde ela vai devolver `code` e `shop_id`).
    // Use sempre a URL do callback para evitar carregar a raiz do app via ngrok (muitos assets/HMR).
    // Em ambientes NGROK, defina SHOPEE_REDIRECT_ORIGIN para garantir o domínio correto.
    const { domain, secure } = resolveShopeeCookieSettings(req);
    
    // Monta URL de autorizacao (já resolve callback URL internamente)
    const url = buildShopeeAuthUrl(req);
    
    console.log('[Shopee Auth] URL de autorização gerada:', url);

    const res = NextResponse.redirect(url, { status: 302 });
    res.cookies.set({
      name: "shopee_oauth_state",
      value: state,
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 600,
      ...(domain ? { domain } : {}),
    });
    res.cookies.set({
      name: "shopee_oauth_mode",
      value: isPopupFlow ? "popup" : "redirect",
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 600,
      ...(domain ? { domain } : {}),
    });
    return res;
  } catch (error) {
    console.error('[Shopee Auth] Erro durante autenticação:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json(
      { 
        error: 'Erro ao iniciar autenticação Shopee',
        details: errorMessage,
        suggestion: 'Verifique se a variável SHOPEE_REDIRECT_ORIGIN está configurada corretamente no .env'
      },
      { status: 500 }
    );
  }
}
