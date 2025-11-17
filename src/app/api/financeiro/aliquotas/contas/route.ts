import { NextRequest, NextResponse } from "next/server";
import { assertSessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

// GET - Listar todas as contas disponíveis do usuário (Mercado Livre e Shopee)
export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  try {
    session = await assertSessionToken(sessionCookie);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Buscar contas do Mercado Livre
    const meliAccounts = await prisma.meliAccount.findMany({
      where: { userId: session.sub },
      select: {
        id: true,
        nickname: true,
        ml_user_id: true,
      },
    });

    // Buscar contas do Shopee
    const shopeeAccounts = await prisma.shopeeAccount.findMany({
      where: { userId: session.sub },
      select: {
        id: true,
        shop_name: true,
        shop_id: true,
      },
    });

    // Formatar contas para retorno
    const contas = [
      ...meliAccounts.map((acc) => ({
        id: acc.id,
        nome: acc.nickname || `ML User ${acc.ml_user_id}`,
        plataforma: "Mercado Livre",
        tipo: "meli",
      })),
      ...shopeeAccounts.map((acc) => ({
        id: acc.id,
        nome: acc.shop_name || `Shopee ${acc.shop_id}`,
        plataforma: "Shopee",
        tipo: "shopee",
      })),
    ];

    return NextResponse.json({ data: contas });
  } catch (error) {
    console.error("Erro ao buscar contas:", error);
    return NextResponse.json(
      { error: "Erro ao buscar contas" },
      { status: 500 }
    );
  }
}
