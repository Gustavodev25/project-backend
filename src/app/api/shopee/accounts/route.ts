import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await assertSessionToken(req.cookies.get("session")?.value);
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  try {
    // Usar raw query temporariamente até regenerar Prisma Client
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      shop_id: string;
      shop_name: string | null;
      merchant_id: string | null;
      access_token: string;
      refresh_token: string;
      expires_at: Date;
    }>>`
      SELECT
        id,
        shop_id,
        shop_name,
        merchant_id,
        access_token,
        refresh_token,
        expires_at
      FROM shopee_account
      WHERE user_id = ${session.sub}
      ORDER BY created_at DESC
    `;

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Erro ao buscar contas Shopee:", error);
    return NextResponse.json(
      { error: "Erro ao buscar contas" },
      { status: 500 }
    );
  }
}

