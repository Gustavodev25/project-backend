import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  saveMeliOauthState,
  resolveMeliCookieSettings,
  resolveMeliRedirectUri,
} from "@/lib/meli";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const clientId = process.env.MELI_APP_ID!;
  const authBase =
    process.env.MELI_AUTH_BASE ?? "https://auth.mercadolibre.com";
  const redirectUri = resolveMeliRedirectUri(req);
  const { domain, secure } = resolveMeliCookieSettings(req);

  const state = crypto.randomUUID();
  const session = await tryVerifySessionToken(req.cookies.get("session")?.value);
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  await saveMeliOauthState(state, session.sub);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  const url = `${authBase}/authorization?${params.toString()}`;

  const res = NextResponse.redirect(url, { status: 302 });
  res.cookies.set({
    name: "meli_oauth_state",
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600, // 10 min
    ...(domain ? { domain } : {}),
  });
  return res;
}
