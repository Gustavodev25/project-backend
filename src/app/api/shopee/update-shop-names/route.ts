import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";
import { getShopInfo } from "@/lib/shopee";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await assertSessionToken(req.cookies.get("session")?.value);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const partnerId = process.env.SHOPEE_PARTNER_ID;
    const partnerKey = process.env.SHOPEE_PARTNER_KEY;

    if (!partnerId || !partnerKey) {
      return NextResponse.json(
        { error: "Credenciais Shopee não configuradas" },
        { status: 500 }
      );
    }

    // Buscar todas as contas do usuário que não têm shop_name
    const accounts = await prisma.shopeeAccount.findMany({
      where: {
        userId: session.sub,
      },
    });

    const results = {
      updated: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const account of accounts) {
      try {
        const shopInfo = await getShopInfo({
          partnerId,
          partnerKey,
          accessToken: account.access_token,
          shopId: account.shop_id,
        });

        const shopName = shopInfo?.shop_name || null;

        if (shopName) {
          await prisma.shopeeAccount.update({
            where: { id: account.id },
            data: { shop_name: shopName },
          });
          results.updated++;
          console.log(`✅ Nome atualizado para loja ${account.shop_id}: ${shopName}`);
        } else {
          results.failed++;
          results.errors.push(`Loja ${account.shop_id}: nome não disponível`);
        }
      } catch (error) {
        results.failed++;
        const errorMsg = `Erro na loja ${account.shop_id}: ${error instanceof Error ? error.message : "Erro desconhecido"}`;
        results.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Atualização de nomes concluída",
      results,
    });

  } catch (error) {
    console.error("[Shopee] Erro ao atualizar nomes:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao atualizar nomes",
      },
      { status: 500 }
    );
  }
}
