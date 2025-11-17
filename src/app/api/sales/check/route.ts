import { NextRequest, NextResponse } from 'next/server';
import { tryVerifySessionToken } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const sessionToken = req.cookies.get('session')?.value;
    const session = await tryVerifySessionToken(sessionToken);

    if (!session?.sub) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.sub }
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    // Verificar se há vendas do Mercado Livre
    const meliSalesCount = await prisma.meliVenda.count({
      where: { userId: user.id }
    });

    // Verificar se há vendas da Shopee
    const shopeeSalesCount = await prisma.shopeeVenda.count({
      where: { userId: user.id }
    });

    const hasSales = meliSalesCount > 0 || shopeeSalesCount > 0;

    return NextResponse.json({
      hasSales,
      meliSales: meliSalesCount,
      shopeeSales: shopeeSalesCount,
      totalSales: meliSalesCount + shopeeSalesCount
    });
  } catch (error) {
    console.error('Erro ao verificar vendas:', error);
    return NextResponse.json({ error: 'Erro ao verificar vendas' }, { status: 500 });
  }
}
