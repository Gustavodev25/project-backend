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
      where: { id: session.sub },
      include: {
        meliAccounts: true,
        shopeeAccounts: true
      }
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const hasAccounts = user.meliAccounts.length > 0 || user.shopeeAccounts.length > 0;

    return NextResponse.json({
      hasAccounts,
      meliAccounts: user.meliAccounts.length,
      shopeeAccounts: user.shopeeAccounts.length
    });
  } catch (error) {
    console.error('Erro ao verificar contas:', error);
    return NextResponse.json({ error: 'Erro ao verificar contas' }, { status: 500 });
  }
}
