import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { refreshMeliAccountToken } from "@/lib/meli";
import { refreshShopeeAccountToken } from "@/lib/shopee";
import { refreshBlingAccountToken } from "@/lib/bling";
import { sendTokenRefreshNotification, createTokenRefreshMessage } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { platform, accountId } = await req.json();

    if (!platform || !accountId) {
      return NextResponse.json(
        { error: "platform e accountId são obrigatórios" },
        { status: 400 }
      );
    }

    let result;
    let accountName;

    switch (platform.toLowerCase()) {
      case 'meli':
      case 'mercado livre':
        const meliAccount = await prisma.meliAccount.findFirst({
          where: { id: accountId }
        });
        
        if (!meliAccount) {
          return NextResponse.json(
            { error: "Conta Mercado Livre não encontrada" },
            { status: 404 }
          );
        }

        result = await refreshMeliAccountToken(meliAccount, true);
        accountName = meliAccount.ml_user_id || 'Conta ML';
        
        // Enviar notificação de teste
        await sendTokenRefreshNotification({
          userId: meliAccount.userId,
          platform: 'Mercado Livre',
          accountId: meliAccount.id,
          accountName,
          action: 'refreshed',
          message: createTokenRefreshMessage('Mercado Livre', accountName, 'refreshed'),
        });
        break;

      case 'shopee':
        const shopeeAccount = await prisma.shopeeAccount.findFirst({
          where: { id: accountId }
        });
        
        if (!shopeeAccount) {
          return NextResponse.json(
            { error: "Conta Shopee não encontrada" },
            { status: 404 }
          );
        }

        result = await refreshShopeeAccountToken(shopeeAccount, true);
        accountName = shopeeAccount.shop_name || shopeeAccount.shop_id;
        
        // Enviar notificação de teste
        await sendTokenRefreshNotification({
          userId: shopeeAccount.userId,
          platform: 'Shopee',
          accountId: shopeeAccount.id,
          accountName,
          action: 'refreshed',
          message: createTokenRefreshMessage('Shopee', accountName, 'refreshed'),
        });
        break;

      case 'bling':
        const blingAccount = await prisma.blingAccount.findFirst({
          where: { id: accountId }
        });
        
        if (!blingAccount) {
          return NextResponse.json(
            { error: "Conta Bling não encontrada" },
            { status: 404 }
          );
        }

        result = await refreshBlingAccountToken(blingAccount, true);
        accountName = blingAccount.bling_user_id || 'Conta Bling';
        
        // Enviar notificação de teste
        await sendTokenRefreshNotification({
          userId: blingAccount.userId,
          platform: 'Bling',
          accountId: blingAccount.id,
          accountName,
          action: 'refreshed',
          message: createTokenRefreshMessage('Bling', accountName, 'refreshed'),
        });
        break;

      default:
        return NextResponse.json(
          { error: "Plataforma não suportada" },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      message: `Token ${platform} renovado com sucesso`,
      result: {
        id: result.id,
        expires_at: result.expires_at,
        accountName,
      },
    });

  } catch (error) {
    console.error("[TEST] Erro ao testar renovação de token:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao renovar token",
      },
      { status: 500 }
    );
  }
}
