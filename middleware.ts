import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { tryVerifySessionToken } from "@/lib/auth";

const protectedRoutes = ["/dashboard", "/contas"];
const authRoutes = ["/login", "/register"];

export async function middleware(request: NextRequest) {
  const currentUrl = new URL(request.url);
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get("session")?.value;
  const session = await tryVerifySessionToken(sessionCookie);
  const isAuthenticated = Boolean(session);

  console.log("🔍 Middleware Debug:", {
    pathname,
    hasSessionCookie: !!sessionCookie,
    isAuthenticated,
    session: session ? { sub: session.sub, email: session.email } : null
  });

  if (currentUrl.searchParams.get("connect") === "shopee") {
    if (!isAuthenticated) {
      const loginUrl = new URL("/login", request.url);
      if (loginUrl.hostname === "localhost" || loginUrl.hostname === "127.0.0.1") {
        loginUrl.protocol = "http:";
      }
      loginUrl.searchParams.set("redirect", `${currentUrl.pathname}${currentUrl.search}`);
      return NextResponse.redirect(loginUrl);
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

  // Proteger rotas que precisam de autenticação
  if (protectedRoutes.some((route) => pathname.startsWith(route)) && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    if (loginUrl.hostname === "localhost" || loginUrl.hostname === "127.0.0.1") {
      loginUrl.protocol = "http:";
    }
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirecionar usuários autenticados que tentam acessar rotas de auth
  if (authRoutes.some((route) => pathname.startsWith(route)) && isAuthenticated) {
    const dashboardUrl = new URL("/dashboard", request.url);
    if (dashboardUrl.hostname === "localhost" || dashboardUrl.hostname === "127.0.0.1") {
      dashboardUrl.protocol = "http:";
    }
    console.log("🔄 Middleware: Usuário autenticado em rota de auth, redirecionando para dashboard");
    return NextResponse.redirect(dashboardUrl);
  }

  // Redirecionar root baseado em autenticação
  if (pathname === "/") {
    if (isAuthenticated) {
      const dashboardUrl = new URL("/dashboard", request.url);
      if (dashboardUrl.hostname === "localhost" || dashboardUrl.hostname === "127.0.0.1") {
        dashboardUrl.protocol = "http:";
      }
      return NextResponse.redirect(dashboardUrl);
    } else {
      const loginUrl = new URL("/login", request.url);
      if (loginUrl.hostname === "localhost" || loginUrl.hostname === "127.0.0.1") {
        loginUrl.protocol = "http:";
      }
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
