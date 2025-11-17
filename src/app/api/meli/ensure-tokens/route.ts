import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";
import { ensureActiveAccountsHaveValidTokens } from "@/lib/meli";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Temporariamente sem autenticação para teste
    // const session = await assertSessionToken(req.cookies.get("session")?.value);
    // if (!session) return new NextResponse("Unauthorized", { status: 401 });

    console.log(`[meli][ensure-tokens] Iniciando verificação e renovação de tokens`);

    // Verificar e renovar tokens de todas as contas ativas
    const result = await ensureActiveAccountsHaveValidTokens();

    // Buscar informações das contas para retorno detalhado (sem filtro de usuário para teste)
    const accountDetails = await prisma.meliAccount.findMany({
      // where: { userId: session.sub },
      select: {
        id: true,
        ml_user_id: true,
        nickname: true,
        expires_at: true,
        refresh_token_invalid_until: true,
      },
    });

    const detailedResults = {
      success: result.success.map(id => {
        const account = accountDetails.find(a => a.id === id);
        return {
          id,
          mlUserId: account?.ml_user_id,
          nickname: account?.nickname,
          expiresAt: account?.expires_at?.toISOString(),
          status: 'valid'
        };
      }),
      failed: result.failed.map(id => {
        const account = accountDetails.find(a => a.id === id);
        return {
          id,
          mlUserId: account?.ml_user_id,
          nickname: account?.nickname,
          expiresAt: account?.expires_at?.toISOString(),
          status: 'failed'
        };
      }),
      recovered: result.recovered.map(id => {
        const account = accountDetails.find(a => a.id === id);
        return {
          id,
          mlUserId: account?.ml_user_id,
          nickname: account?.nickname,
          expiresAt: account?.expires_at?.toISOString(),
          status: 'recovered'
        };
      }),
    };

    return NextResponse.json({
      success: result.success.length > 0,
      message: `Verificação concluída: ${result.success.length} tokens válidos, ${result.failed.length} falhas, ${result.recovered.length} recuperados`,
      summary: {
        total: result.success.length + result.failed.length + result.recovered.length,
        success: result.success.length,
        failed: result.failed.length,
        recovered: result.recovered.length,
      },
      results: detailedResults,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("[meli][ensure-tokens] Erro ao verificar tokens:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao verificar tokens",
        timestamp: new Date().toISOString(),
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

    // Listar status atual das contas (sem filtro de usuário para teste)
    const accounts = await prisma.meliAccount.findMany({
      // where: { userId: session.sub },
      select: {
        id: true,
        ml_user_id: true,
        nickname: true,
        expires_at: true,
        refresh_token_invalid_until: true,
        updated_at: true,
      },
    });

    const now = new Date();
    const accountsWithStatus = accounts.map(account => {
      const isInvalid = account.refresh_token_invalid_until && account.refresh_token_invalid_until > now;
      const isExpired = account.expires_at <= now;
      const needsRefresh = account.expires_at.getTime() - now.getTime() <= 24 * 60 * 60 * 1000; // 24 horas

      return {
        id: account.id,
        mlUserId: account.ml_user_id,
        nickname: account.nickname,
        expiresAt: account.expires_at.toISOString(),
        invalidUntil: account.refresh_token_invalid_until?.toISOString(),
        lastUpdated: account.updated_at.toISOString(),
        status: isInvalid ? 'invalid' : isExpired ? 'expired' : needsRefresh ? 'needs_refresh' : 'valid',
        isInvalid,
        isExpired,
        needsRefresh,
      };
    });

    return NextResponse.json({
      message: `Status de ${accountsWithStatus.length} contas MELI`,
      accounts: accountsWithStatus,
      summary: {
        total: accountsWithStatus.length,
        valid: accountsWithStatus.filter(a => a.status === 'valid').length,
        needsRefresh: accountsWithStatus.filter(a => a.status === 'needs_refresh').length,
        expired: accountsWithStatus.filter(a => a.status === 'expired').length,
        invalid: accountsWithStatus.filter(a => a.status === 'invalid').length,
      },
    });

  } catch (error) {
    console.error("[meli][ensure-tokens] Erro ao listar status:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao listar status das contas",
      },
      { status: 500 }
    );
  }
}
