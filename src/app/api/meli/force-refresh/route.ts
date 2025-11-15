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

    const { accountId } = await req.json();

    if (!accountId) {
      return NextResponse.json(
        { error: "accountId é obrigatório" },
        { status: 400 }
      );
    }

    // Buscar a conta
    const account = await prisma.meliAccount.findFirst({
      where: {
        id: accountId,
        userId: session.sub,
      },
    });

    if (!account) {
      return NextResponse.json(
        { error: "Conta não encontrada" },
        { status: 404 }
      );
    }

    // Verificar se o refresh_token ainda é válido
    if (!account.refresh_token || account.refresh_token.trim() === '') {
      return NextResponse.json(
        { 
          success: false,
          error: "Refresh token inválido. É necessário reconectar a conta.",
          requiresReconnection: true
        },
        { status: 400 }
      );
    }

    console.log(`[meli][force-refresh] Tentando renovação forçada para conta ${accountId}`);

    // Tentar renovação inteligente com mais tentativas
    const updated = await smartRefreshMeliAccountToken(account, 5);

    // Se chegou até aqui, a renovação foi bem-sucedida
    // Limpar a marcação de inválida
    await clearAccountInvalidMark(account.id, 'meli');

    console.log(`[meli][force-refresh] Token renovado com sucesso para conta ${accountId}`);

    return NextResponse.json({
      success: true,
      message: "Token renovado com sucesso após tentativas múltiplas",
      account: {
        id: updated.id,
        ml_user_id: updated.ml_user_id,
        expires_at: updated.expires_at,
      },
    });

  } catch (error) {
    console.error("[Meli] Erro ao renovar token forçadamente:", error);
    
    // Tratamento específico de erros
    if (error instanceof Error) {
      if (error.message.includes("invalid_grant") || error.message.includes("invalid refresh token")) {
        return NextResponse.json(
          {
            success: false,
            error: "Refresh token expirado ou inválido. É necessário reconectar a conta.",
            requiresReconnection: true,
          },
          { status: 400 }
        );
      }
      
      if (error.message.includes("network") || error.message.includes("timeout")) {
        return NextResponse.json(
          {
            success: false,
            error: "Erro de conexão. Tente novamente em alguns minutos.",
            retryable: true,
          },
          { status: 503 }
        );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao renovar token",
      },
      { status: 500 }
    );
  }
}
