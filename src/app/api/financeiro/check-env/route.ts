import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const session = await tryVerifySessionToken(sessionCookie.value);
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
    }

    // Verificar variáveis de ambiente (sem expor valores sensíveis)
    const envCheck = {
      DATABASE_URL: !!process.env.DATABASE_URL,
      BLING_CLIENT_ID: !!process.env.BLING_CLIENT_ID,
      BLING_CLIENT_SECRET: !!process.env.BLING_CLIENT_SECRET,
      BLING_REDIRECT_URI: !!process.env.BLING_REDIRECT_URI,
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_MELI_REDIRECT_ORIGIN: !!process.env.NEXT_PUBLIC_MELI_REDIRECT_ORIGIN
    };

    return NextResponse.json({
      success: true,
      message: "Verificação de ambiente",
      data: {
        userId: session.sub,
        environment: envCheck,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error("Erro na verificação de ambiente:", error);
    return NextResponse.json({
      error: `Erro na verificação: ${error instanceof Error ? error.message : String(error)}`
    }, { status: 500 });
  }
}

