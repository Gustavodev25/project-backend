import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await assertSessionToken(req.cookies.get("session")?.value);
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  try {
    // Buscar contas Shopee ativas do usuário
    const contasAtivas = await prisma.shopeeAccount.findMany({
      where: { 
        userId: session.sub,
        expires_at: { gt: new Date() }
      },
    });

    if (contasAtivas.length === 0) {
      return NextResponse.json({
        newOrders: [],
        totals: { new: 0 },
        errors: [{
          accountId: "",
          shopId: "",
          message: "Nenhuma conta Shopee ativa encontrada."
        }]
      });
    }

    // TODO: Implementar verificação real com API da Shopee
    // Por enquanto, retornar dados mockados
    const mockNewOrders = contasAtivas.map(conta => ({
      accountId: conta.id,
      shopId: conta.shop_id,
      order: {
        order_id: `SP_NEW_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: "paid",
        create_time: Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000, // Últimos 7 dias
        total_amount: Math.random() * 500 + 100,
        item_list: [{
          item_name: "Novo Produto Shopee",
          item_sku: "SKU_SHOPEE_NEW_001",
          model_quantity_purchased: Math.floor(Math.random() * 3) + 1,
          model_original_price: Math.random() * 150 + 75,
        }],
        buyer_username: "novo_comprador",
        shipping_fee: Math.random() * 15 + 8,
        platform_fee: -(Math.random() * 30 + 15),
      }
    }));

    // Contar vendas por conta
    const newOrdersByAccount: Record<string, number> = {};
    contasAtivas.forEach(conta => {
      const ordersForAccount = mockNewOrders.filter(order => order.accountId === conta.id);
      newOrdersByAccount[conta.id] = ordersForAccount.length;
    });

    return NextResponse.json({
      newOrders: mockNewOrders,
      totals: { new: mockNewOrders.length },
      newOrdersByAccount,
      errors: []
    });

  } catch (error) {
    console.error("Erro ao verificar novas vendas Shopee:", error);
    return NextResponse.json({
      newOrders: [],
      totals: { new: 0 },
      errors: [{
        accountId: "",
        shopId: "",
        message: "Erro interno ao verificar novas vendas Shopee"
      }]
    }, { status: 500 });
  }
}
