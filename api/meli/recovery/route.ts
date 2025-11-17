import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";
import { recoverAllInvalidAccounts, attemptAccountRecovery } from "@/lib/meli";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Temporariamente sem autenticação para teste
    // const session = await assertSessionToken(req.cookies.get("session")?.value);
    // if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const { accountId } = await req.json();

    if (accountId) {
      // Tentar recuperar uma conta específica
      console.log(`[recovery] Tentando recuperar conta específica: ${accountId}`);
      
      const success = await attemptAccountRecovery(accountId);
      
      return NextResponse.json({
        success,
        message: success 
          ? "Conta recuperada com sucesso!" 
          : "Falha ao recuperar conta. Token ainda pode estar inválido.",
        accountId,
      });
      
    } else {
      // Tentar recuperar todas as contas marcadas como inválidas
      console.log(`[recovery] Tentando recuperar todas as contas inválidas`);
      
      const result = await recoverAllInvalidAccounts();
      
      return NextResponse.json({
        success: result.recovered.length > 0,
        message: `Recuperação concluída: ${result.recovered.length} sucessos, ${result.failed.length} falhas`,
        recovered: result.recovered,
        failed: result.failed,
        summary: {
          total: result.recovered.length + result.failed.length,
          recovered: result.recovered.length,
          failed: result.failed.length,
        },
      });
    }

  } catch (error) {
    console.error("[recovery] Erro ao tentar recuperação:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao tentar recuperação",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    // Temporariamente sem autenticação para teste
    // const session = await assertSessionToken(req.cookies.get("session")?.value);
    // if (!session) return new NextResponse("Unauthorized", { status: 401 });

    // Listar todas as contas marcadas como inválidas (sem filtro de usuário para teste)
    const invalidAccounts = await prisma.meliAccount.findMany({
      where: {
        // userId: session.sub, // Temporariamente comentado para teste
        refresh_token_invalid_until: {
          gt: new Date(), // Ainda marcada como inválida
        },
      },
      select: {
        id: true,
        ml_user_id: true,
        nickname: true,
        refresh_token_invalid_until: true,
        updated_at: true,
      },
    });

    return NextResponse.json({
      message: `Encontradas ${invalidAccounts.length} contas marcadas como inválidas`,
      accounts: invalidAccounts.map(account => ({
        id: account.id,
        mlUserId: account.ml_user_id,
        nickname: account.nickname,
        invalidUntil: account.refresh_token_invalid_until?.toISOString(),
        lastUpdated: account.updated_at.toISOString(),
      })),
    });

  } catch (error) {
    console.error("[recovery] Erro ao listar contas inválidas:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao listar contas inválidas",
      },
      { status: 500 }
    );
  }
}
