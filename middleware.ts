import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { tryVerifySessionToken } from "@/lib/auth";

// DESABILITADO para backend API-only
// Este middleware era para proteger páginas do frontend que não existem mais
// const protectedRoutes = ["/dashboard", "/contas"];
// const authRoutes = ["/login", "/register"];

export async function middleware(request: NextRequest) {
  const currentUrl = new URL(request.url);
  const { pathname } = request.nextUrl;

  // Para API-only backend, apenas processar lógica do Shopee
  const sessionCookie = request.cookies.get("session")?.value;
  const session = await tryVerifySessionToken(sessionCookie);
  const isAuthenticated = Boolean(session);

  if (currentUrl.searchParams.get("connect") === "shopee") {
    if (!isAuthenticated) {
      // API-only: retornar erro em vez de redirecionar para página de login
      return NextResponse.json(
        { error: "Authentication required for Shopee connection" },
        { status: 401 }
      );
    }

    const partnerId = process.env.SHOPEE_PARTNER_ID;
    const partnerKey = process.env.SHOPEE_PARTNER_KEY;
    const apiBase = (process.env.SHOPEE_API_BASE?.replace(/\/$/, "")) || "https://partner.shopeemobile.com";
    const path = "/api/v2/shop/auth_partner";

    if (!partnerId || !partnerKey) {
      const startUrl = new URL("/api/shopee/auth", request.url);
      if (startUrl.hostname === "localhost" || startUrl.hostname === "127.0.0.1") {
        startUrl.protocol = "http:";
      }
      return NextResponse.redirect(startUrl);
    }

    const ts = Math.floor(Date.now() / 1000);

    async function hmacSha256Hex(key: string, data: string): Promise<string> {
      const encoder = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(key),
        { name: "HMAC", hash: { name: "SHA-256" } },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
      const bytes = new Uint8Array(signature);
      let hex = "";
      for (let i = 0; i < bytes.length; i += 1) {
        hex += bytes[i].toString(16).padStart(2, "0");
      }
      return hex;
    }

    const baseString = `${partnerId}${path}${ts}`;
    const sign = await hmacSha256Hex(partnerKey, baseString);
    const origin = (process.env.SHOPEE_REDIRECT_ORIGIN || currentUrl.origin).replace(/\/$/, "");
    const url = new URL(`${apiBase}${path}`);
    url.searchParams.set("partner_id", String(partnerId));
    url.searchParams.set("timestamp", String(ts));
    url.searchParams.set("sign", sign);
    url.searchParams.set("redirect", origin);
    return NextResponse.redirect(url.toString());
  }

  if (
    currentUrl.searchParams.has("code") &&
    (currentUrl.searchParams.has("shop_id") || currentUrl.searchParams.has("shopid"))
  ) {
    const cbUrl = new URL("/api/shopee/callback", request.url);
    if (cbUrl.hostname === "localhost" || cbUrl.hostname === "127.0.0.1") {
      cbUrl.protocol = "http:";
    }
    for (const [key, value] of currentUrl.searchParams.entries()) {
      cbUrl.searchParams.set(key, value);
    }
    return NextResponse.redirect(cbUrl);
  }

  // REMOVIDO: Proteção de rotas de páginas que não existem mais
  // Backend API-only não precisa redirecionar para /dashboard, /login, etc.

  return NextResponse.next();
}

// Configuração atualizada para API-only backend
// Matcher específico apenas para rotas necessárias (callback do Shopee)
export const config = {
  matcher: [
    // Apenas processar a raiz (/) para callbacks do Shopee
    "/",
  ],
};
