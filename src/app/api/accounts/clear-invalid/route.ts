import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";
import { clearAccountInvalidMark } from "@/lib/account-status";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await assertSessionToken(req.cookies.get("session")?.value);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const { accountId, platform } = await req.json();

    if (!accountId || !platform) {
      return NextResponse.json(
        { error: "accountId e platform são obrigatórios" },
        { status: 400 }
      );
    }

    if (!['meli', 'shopee', 'bling'].includes(platform)) {
      return NextResponse.json(
        { error: "Platform deve ser 'meli', 'shopee' ou 'bling'" },
        { status: 400 }
      );
    }

    // Verificar se a conta pertence ao usuário
    let account = null;
    switch (platform) {
      case 'meli':
        account = await prisma.meliAccount.findFirst({
          where: { id: accountId, userId: session.sub },
        });
        break;
      case 'shopee':
        account = await prisma.shopeeAccount.findFirst({
          where: { id: accountId, userId: session.sub },
        });
        break;
      case 'bling':
        account = await prisma.blingAccount.findFirst({
          where: { id: accountId, userId: session.sub },
        });
        break;
    }

    if (!account) {
      return NextResponse.json(
        { error: "Conta não encontrada" },
        { status: 404 }
      );
    }

    // Limpar a marcação de inválida
    await clearAccountInvalidMark(accountId, platform as 'meli' | 'shopee' | 'bling');

    console.log(`[${platform}][clear-invalid] Marcação de inválida removida para conta ${accountId}`);

    return NextResponse.json({
      success: true,
      message: "Conta marcada como válida novamente",
      account: {
        id: accountId,
        platform,
      },
    });

  } catch (error) {
    console.error(`[clear-invalid] Erro ao limpar marcação de inválida:`, error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao limpar marcação de inválida",
      },
      { status: 500 }
    );
  }
}