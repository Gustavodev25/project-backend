/**
 * Trigger para executar a sincronização via Cron a partir de um clique do usuário.
 *
 * Este endpoint é seguro (requer sessão) e aciona o cron interno usando o CRON_SECRET
 * no servidor, evitando expor o segredo no cliente.
 */
import { NextRequest, NextResponse } from "next/server";
import { assertSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Validar sessão do usuário (não expor CRON para anônimos)
  const sessionCookie = req.cookies.get("session")?.value;
  try {
    await assertSessionToken(sessionCookie);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.CRON_SECRET) {
    console.error("[Cron Trigger] CRON_SECRET não configurado");
    return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 500 });
  }

  let body: {
    accountIds?: string[];
    quickMode?: boolean;
    fullSync?: boolean;
    batchSize?: number;
  } = {};

  try {
    body = await req.json();
  } catch {}

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  try {
    const resp = await fetch(`${baseUrl}/api/cron/meli-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({
        accountIds: body.accountIds,
        quickMode: body.quickMode,
        fullSync: body.fullSync,
        batchSize: body.batchSize,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(data, { status: resp.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[Cron Trigger] Erro ao acionar cron:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

