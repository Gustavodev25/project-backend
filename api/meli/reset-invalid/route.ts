import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";
import { smartRefreshMeliAccountToken } from "@/lib/meli";
import { clearAccountInvalidMark } from "@/lib/account-status";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await assertSessionToken(req.cookies.get("session")?.value);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    console.log(`[reset-invalid] Limpando todas as marcações de inválido para usuário ${session.sub}`);

    // Buscar todas as contas MELI do usuário marcadas como inválidas
    const invalidAccounts = await prisma.meliAccount.findMany({
      where: {
        userId: session.sub,
        refresh_token_invalid_until: {
          gt: new Date(), // Ainda marcada como inválida
        },
      },
    });

    console.log(`[reset-invalid] Encontradas ${invalidAccounts.length} contas marcadas como inválidas`);

    const results = [];

    for (const account of invalidAccounts) {
      try {
        // Limpar marcação de inválido
        await clearAccountInvalidMark(account.id, 'meli');
        
        // Tentar renovar o token
        console.log(`[reset-invalid] Tentando renovar token para conta ${account.id}`);
        const updated = await smartRefreshMeliAccountToken(account, 3);
        
        results.push({
          accountId: account.id,
          mlUserId: account.ml_user_id,
          nickname: account.nickname,
          success: true,
          message: "Conta resetada e token renovado com sucesso",
          expiresAt: updated.expires_at.toISOString(),
        });
        
        console.log(`[reset-invalid] ✅ Sucesso para conta ${account.id}`);
        
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        
        results.push({
          accountId: account.id,
          mlUserId: account.ml_user_id,
          nickname: account.nickname,
          success: false,
          message: `Falha ao renovar após reset: ${message}`,
          requiresReconnection: message.includes("REFRESH_TOKEN_INVALID"),
        });
        
        console.log(`[reset-invalid] ❌ Falha para conta ${account.id}: ${message}`);
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    const reconnectionNeeded = results.filter(r => r.requiresReconnection).length;

    return NextResponse.json({
      success: successCount > 0,
      message: `Reset concluído: ${successCount} contas recuperadas, ${failureCount} ainda precisam de reconexão`,
      summary: {
        total: invalidAccounts.length,
        success: successCount,
        failure: failureCount,
        reconnectionNeeded,
      },
      results,
    });

  } catch (error) {
    console.error("[reset-invalid] Erro geral:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao resetar contas inválidas",
      },
      { status: 500 }
    );
  }
}
