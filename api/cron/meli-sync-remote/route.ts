/**
 * Bridge para sincronização remota no Render
 *
 * Este endpoint funciona como um proxy entre o Vercel (frontend)
 * e o Render (backend). Ele chama a sincronização no servidor remoto.
 *
 * Fluxo:
 * 1. Usuario clica em "Sincronizar" no Vercel (frontend)
 * 2. Chama /api/cron/meli-sync/trigger no Vercel
 * 3. Este endpoint chama o backend no Render
 * 4. Render faz a sincronização real
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutos

type SyncBody = {
  accountIds?: string[];
  quickMode?: boolean;
  fullSync?: boolean;
  batchSize?: number;
};

export async function POST(req: NextRequest) {
  try {
    // Verificar CRON_SECRET
    const authHeader = req.headers.get("authorization");
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (!process.env.CRON_SECRET) {
      console.error("[Sync Remote] CRON_SECRET não configurado");
      return NextResponse.json(
        { error: "CRON_SECRET não configurado" },
        { status: 500 }
      );
    }

    if (authHeader !== expectedAuth) {
      console.error("[Sync Remote] Unauthorized - invalid CRON_SECRET");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Extrair body
    let body: SyncBody = {};
    try {
      body = await req.json();
    } catch {}

    // URL do backend remoto no Render
    const backendUrl = process.env.NEXT_PUBLIC_API_URL ||
      (process.env.RENDER_BACKEND_URL);

    if (!backendUrl) {
      console.error(
        "[Sync Remote] Backend URL não configurado. Configure NEXT_PUBLIC_API_URL ou RENDER_BACKEND_URL"
      );
      return NextResponse.json(
        { error: "Backend URL não configurado" },
        { status: 500 }
      );
    }

    console.log(
      `[Sync Remote] 🔄 Chamando backend remoto: ${backendUrl}/api/meli/vendas/sync`
    );

    // Chamar backend remoto
    const response = await fetch(
      `${backendUrl}/api/meli/vendas/sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Passar o CRON_SECRET para autenticar no backend remoto
          Authorization: authHeader,
        },
        body: JSON.stringify({
          accountIds: body.accountIds,
          quickMode: body.quickMode,
          fullSync: body.fullSync,
          batchSize: body.batchSize,
        }),
      }
    );

    const data = await response.json().catch(() => ({}));

    console.log(
      `[Sync Remote] ✅ Resposta do backend remoto: status=${response.status}`
    );

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[Sync Remote] Erro ao chamar backend remoto:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
