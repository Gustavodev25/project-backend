import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  saveBlingOauthState,
  resolveBlingCookieSettings,
  resolveBlingRedirectUri,
} from "@/lib/bling";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const clientId = process.env.BLING_CLIENT_ID!;
  const authBase = "https://www.bling.com.br/Api/v3/oauth";
  const redirectUri = resolveBlingRedirectUri(req);
  const { domain, secure } = resolveBlingCookieSettings(req);

  const state = crypto.randomUUID();
  const session = await tryVerifySessionToken(req.cookies.get("session")?.value);
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  await saveBlingOauthState(state, session.sub);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });

  const url = `${authBase}/authorize?${params.toString()}`;

  const res = NextResponse.redirect(url, { status: 302 });
  res.cookies.set({
    name: "bling_oauth_state",
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
