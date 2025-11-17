import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifySessionToken } from '@/lib/auth';

// GET /api/sku/com-status-vendas - Listar com status de vendas
export async function GET(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('session')?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    
    const session = await verifySessionToken(sessionCookie);

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '25');
    const search = searchParams.get('search') || '';
    const tipo = searchParams.get('tipo') || '';
    const ativo = searchParams.get('ativo');
    const temEstoque = searchParams.get('temEstoque');

    const skip = (page - 1) * limit;

    // Construir filtros
    const where: any = {
      userId: session.sub,
    };

    if (search) {
      where.OR = [
        { sku: { contains: search, mode: 'insensitive' } },
        { produto: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (tipo) {
      where.tipo = tipo;
    }

    if (ativo !== null) {
      where.ativo = ativo === 'true';
    }

    if (temEstoque !== null) {
      where.temEstoque = temEstoque === 'true';
    }

    // Buscar SKUs com informações de vendas
    const skus = await prisma.sKU.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { tipo: 'desc' },
        { sku: 'asc' },
      ],
      include: {
        custoHistorico: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Buscar estatísticas de vendas para cada SKU
    const skusComStatus = await Promise.all(
      skus.map(async (sku) => {
        // Buscar vendas do SKU
        const vendas = await prisma.meliVenda.findMany({
          where: {
            userId: session.sub,
            sku: sku.sku,
          },
          select: {
            dataVenda: true,
            valorTotal: true,
            quantidade: true,
            plataforma: true,
            status: true,
          },
        });

        // Calcular estatísticas
        const totalVendas = vendas.length;
        const totalQuantidadeVendida = vendas.reduce((sum, venda) => sum + venda.quantidade, 0);
        const totalValorVendido = vendas.reduce((sum, venda) => sum + Number(venda.valorTotal), 0);
        const ultimaVenda = vendas.length > 0 ? vendas.sort((a, b) => b.dataVenda.getTime() - a.dataVenda.getTime())[0] : null;

        // Calcular margem média
        const vendasComMargem = vendas.filter(venda => venda.valorTotal && sku.custoUnitario);
        const margemMedia = vendasComMargem.length > 0 
          ? vendasComMargem.reduce((sum, venda) => {
              const margem = Number(venda.valorTotal) - Number(sku.custoUnitario) * venda.quantidade;
              return sum + margem;
            }, 0) / vendasComMargem.length
          : 0;

        // Status por plataforma
        const statusPorPlataforma = vendas.reduce((acc, venda) => {
          if (!acc[venda.plataforma]) {
            acc[venda.plataforma] = { vendas: 0, quantidade: 0, valor: 0 };
          }
          acc[venda.plataforma].vendas++;
          acc[venda.plataforma].quantidade += venda.quantidade;
          acc[venda.plataforma].valor += Number(venda.valorTotal);
          return acc;
        }, {} as Record<string, { vendas: number; quantidade: number; valor: number }>);

        return {
          ...sku,
          statusVendas: {
            totalVendas,
            totalQuantidadeVendida,
            totalValorVendido,
            margemMedia,
            ultimaVenda: ultimaVenda ? {
              data: ultimaVenda.dataVenda,
              valor: ultimaVenda.valorTotal,
              quantidade: ultimaVenda.quantidade,
              plataforma: ultimaVenda.plataforma,
              status: ultimaVenda.status,
            } : null,
            statusPorPlataforma,
          },
        };
      })
    );

    // Contar total para paginação
    const total = await prisma.sKU.count({ where });

    return NextResponse.json({
      skus: skusComStatus,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Erro ao buscar SKUs com status de vendas:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
