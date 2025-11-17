/**
 * Cron Job para Sincronização Automática do Mercado Livre
 *
 * Este endpoint é chamado automaticamente pelo Vercel Cron
 * e também pode ser disparado via POST pelo servidor quando o usuário
 * clicar em sincronizar (sem expor o CRON_SECRET no cliente).
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutos para processar todas as contas

type CronBody = {
  accountIds?: string[];
  quickMode?: boolean;
  fullSync?: boolean;
  batchSize?: number;
};

async function runCron(req: NextRequest, options?: CronBody) {
  // Verificar autorização via CRON_SECRET
  const authHeader = req.headers.get("authorization");
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET) {
    console.error("[Cron] CRON_SECRET não configurado");
    return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 500 });
  }

  if (authHeader !== expectedAuth) {
    console.error("[Cron] Unauthorized - invalid CRON_SECRET");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  console.log("[Cron] 🕒 Iniciando sincronização automática do Mercado Livre...");

  try {
    // Buscar todas as contas Meli
    const accounts = await prisma.meliAccount.findMany({
      select: { id: true, userId: true, ml_user_id: true, nickname: true },
      orderBy: { created_at: "desc" },
    });

    // Filtrar por accountIds se fornecido
    const targetIds = (options?.accountIds || []).filter(Boolean);
    const targetAccounts =
      targetIds.length > 0 ? accounts.filter((a) => targetIds.includes(a.id)) : accounts;

    if (targetAccounts.length === 0) {
      console.log("[Cron] ℹ️ Nenhuma conta do Mercado Livre encontrada");
      return NextResponse.json({
        success: true,
        message: "Nenhuma conta encontrada",
        synced: 0,
        duration: Date.now() - startTime,
      });
    }

    console.log(`[Cron] 📊 Encontradas ${targetAccounts.length} contas do Mercado Livre`);

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    // Parâmetros de execução vindos do body (com padrões seguros)
    const quickMode = options?.quickMode !== false; // default true
    const fullSync = options?.fullSync === true; // default false
    const BATCH_SIZE = Math.max(1, Math.min(10, options?.batchSize ?? 3));

    const results: any[] = [];

    for (let i = 0; i < targetAccounts.length; i += BATCH_SIZE) {
      const batch = targetAccounts.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(targetAccounts.length / BATCH_SIZE);

      console.log(
        `[Cron] 🧰 Processando lote ${batchNumber}/${totalBatches} (${batch.length} contas)...`
      );

      const batchResults = await Promise.allSettled(
        batch.map(async (account) => {
          const accountStartTime = Date.now();
          try {
            console.log(`[Cron]   🔄 Sincronizando ${account.nickname || account.ml_user_id}...`);

            const response = await fetch(`${baseUrl}/api/meli/vendas/sync`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-cron-secret": process.env.CRON_SECRET || "",
              },
              body: JSON.stringify({ accountIds: [account.id], quickMode, fullSync }),
            });

            const data = await response.json().catch(() => ({}));
            const duration = Date.now() - accountStartTime;

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${data.error || "Erro desconhecido"}`);
            }

            console.log(
              `[Cron]   ✅ ${account.nickname}: ${data.totals?.saved || 0} vendas em ${duration}ms`
            );

            return {
              accountId: account.id,
              nickname: account.nickname,
              ml_user_id: account.ml_user_id,
              success: true,
              status: response.status,
              vendas: data.totals?.saved || 0,
              duration,
            };
          } catch (error) {
            const duration = Date.now() - accountStartTime;
            const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
            console.error(`[Cron]   ❌ ${account.nickname}: ${errorMessage}`);

            return {
              accountId: account.id,
              nickname: account.nickname,
              ml_user_id: account.ml_user_id,
              success: false,
              error: errorMessage,
              duration,
            };
          }
        })
      );

      results.push(...batchResults.map((r: any) => (r.status === "fulfilled" ? r.value : r.reason)));

      const batchSuccess = batchResults.filter(
        (r: any) => r.status === "fulfilled" && r.value?.success
      ).length;
      console.log(
        `[Cron] 📦 Lote ${batchNumber}/${totalBatches}: ${batchSuccess}/${batch.length} contas sincronizadas`
      );
    }

    const successCount = results.filter((r: any) => r.success).length;
    const totalVendas = results.reduce((sum: number, r: any) => sum + (r.vendas || 0), 0);
    const totalDuration = Date.now() - startTime;

    console.log(
      `[Cron] 🏁 Sincronização completa: ${successCount}/${results.length} contas, ${totalVendas} vendas, ${totalDuration}ms`
    );

    return NextResponse.json({
      success: true,
      message: `${successCount}/${results.length} contas sincronizadas`,
      totalVendas,
      totalAccounts: results.length,
      successCount,
      duration: totalDuration,
      results,
    });
  } catch (error) {
    console.error("[Cron] Erro crítico na sincronização automática:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return runCron(req);
}

export async function POST(req: NextRequest) {
  let body: CronBody | undefined;
  try {
    body = await req.json();
  } catch {}
  return runCron(req, body);
}

