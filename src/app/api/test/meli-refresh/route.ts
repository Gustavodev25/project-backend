import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";
import { smartRefreshMeliAccountToken } from "@/lib/meli";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await assertSessionToken(req.cookies.get("session")?.value);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    // Buscar todas as contas MELI do usuário
    const accounts = await prisma.meliAccount.findMany({
      where: { userId: session.sub },
      orderBy: { created_at: "desc" },
    });

    if (accounts.length === 0) {
      return NextResponse.json({
        message: "Nenhuma conta MELI encontrada",
        accounts: [],
      });
    }

    const results = [];

    for (const account of accounts) {
      try {
        console.log(`[test-refresh] Testando renovação para conta ${account.id}`);
        
        const startTime = Date.now();
        const updated = await smartRefreshMeliAccountToken(account, 3);
        const endTime = Date.now();
        
        results.push({
          accountId: account.id,
          mlUserId: account.ml_user_id,
          nickname: account.nickname,
          success: true,
          message: "Token renovado com sucesso",
          duration: `${endTime - startTime}ms`,
          expiresAt: updated.expires_at.toISOString(),
        });
        
        console.log(`[test-refresh] ✅ Sucesso para conta ${account.id} em ${endTime - startTime}ms`);
        
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        
        results.push({
          accountId: account.id,
          mlUserId: account.ml_user_id,
          nickname: account.nickname,
          success: false,
          message,
          requiresReconnection: message.includes("REFRESH_TOKEN_INVALID"),
        });
        
        console.log(`[test-refresh] ❌ Falha para conta ${account.id}: ${message}`);
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    const reconnectionNeeded = results.filter(r => r.requiresReconnection).length;

    return NextResponse.json({
      message: `Teste de renovação concluído: ${successCount} sucessos, ${failureCount} falhas`,
      summary: {
        total: accounts.length,
        success: successCount,
        failure: failureCount,
        reconnectionNeeded,
      },
      results,
    });

  } catch (error) {
    console.error("[test-refresh] Erro geral:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao testar renovação de tokens",
      },
      { status: 500 }
    );
  }
}
