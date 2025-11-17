import { NextRequest, NextResponse } from "next/server";
import { markAccountAsInvalid, isAccountMarkedAsInvalid, clearAccountInvalidMark } from "@/lib/account-status";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { action, platform, accountId } = await req.json();

    if (!action || !platform || !accountId) {
      return NextResponse.json(
        { error: "action, platform e accountId são obrigatórios" },
        { status: 400 }
      );
    }

    switch (action) {
      case 'mark':
        await markAccountAsInvalid(accountId, platform);
        return NextResponse.json({
          success: true,
          message: `Conta ${platform} ${accountId} marcada como inválida`,
        });

      case 'check':
        const isInvalid = await isAccountMarkedAsInvalid(accountId, platform);
        return NextResponse.json({
          success: true,
          isInvalid,
          message: isInvalid ? 'Conta marcada como inválida' : 'Conta válida',
        });

      case 'clear':
        await clearAccountInvalidMark(accountId, platform);
        return NextResponse.json({
          success: true,
          message: `Conta ${platform} ${accountId} marcada como válida novamente`,
        });

      default:
        return NextResponse.json(
          { error: "Ação inválida. Use: mark, check ou clear" },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error("[TEST-ACCOUNT-STATUS] Erro:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 }
    );
  }
}
