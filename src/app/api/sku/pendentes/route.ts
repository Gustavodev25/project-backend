import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifySessionToken } from '@/lib/auth';

// GET /api/sku/pendentes - Buscar SKUs pendentes das vendas
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
    const plataforma = searchParams.get('plataforma') || '';

    const skip = (page - 1) * limit;

    // Buscar SKUs únicos das vendas que não estão cadastrados
    const vendasComSKUsPendentes = await prisma.meliVenda.findMany({
      where: {
        userId: session.sub,
        sku: { not: null },
        plataforma: plataforma ? plataforma : undefined,
      },
      select: {
        sku: true,
        titulo: true,
        plataforma: true,
        dataVenda: true,
        valorTotal: true,
        quantidade: true,
        status: true,
      },
      distinct: ['sku'],
    });

    // Filtrar SKUs que não estão cadastrados
    const skusPendentes = [];
    
    for (const venda of vendasComSKUsPendentes) {
      if (!venda.sku) continue;

      const skuExistente = await prisma.sKU.findFirst({
        where: {
          userId: session.sub,
          sku: venda.sku,
        },
      });

      if (!skuExistente) {
        // Buscar estatísticas deste SKU nas vendas
        const estatisticasVendas = await prisma.meliVenda.findMany({
          where: {
            userId: session.sub,
            sku: venda.sku,
          },
          select: {
            dataVenda: true,
            valorTotal: true,
            quantidade: true,
            plataforma: true,
            status: true,
          },
        });

        const totalVendas = estatisticasVendas.length;
        const totalQuantidadeVendida = estatisticasVendas.reduce((sum, v) => sum + v.quantidade, 0);
        const totalValorVendido = estatisticasVendas.reduce((sum, v) => sum + Number(v.valorTotal), 0);
        const ultimaVenda = estatisticasVendas.length > 0 
          ? estatisticasVendas.sort((a, b) => b.dataVenda.getTime() - a.dataVenda.getTime())[0]
          : null;

        // Status por plataforma
        const statusPorPlataforma = estatisticasVendas.reduce((acc, venda) => {
          if (!acc[venda.plataforma]) {
            acc[venda.plataforma] = { vendas: 0, quantidade: 0, valor: 0 };
          }
          acc[venda.plataforma].vendas++;
          acc[venda.plataforma].quantidade += venda.quantidade;
          acc[venda.plataforma].valor += Number(venda.valorTotal);
          return acc;
        }, {} as Record<string, { vendas: number; quantidade: number; valor: number }>);

        skusPendentes.push({
          sku: venda.sku,
          produto: venda.titulo,
          plataforma: venda.plataforma,
          primeiraVenda: estatisticasVendas.length > 0 
            ? estatisticasVendas.sort((a, b) => a.dataVenda.getTime() - b.dataVenda.getTime())[0].dataVenda
            : null,
          ultimaVenda: ultimaVenda?.dataVenda || null,
          estatisticas: {
            totalVendas,
            totalQuantidadeVendida,
            totalValorVendido,
            statusPorPlataforma,
          },
        });
      }
    }

    // Ordenar por total de vendas (decrescente)
    skusPendentes.sort((a, b) => b.estatisticas.totalVendas - a.estatisticas.totalVendas);

    // Paginação
    const total = skusPendentes.length;
    const skusPaginados = skusPendentes.slice(skip, skip + limit);

    return NextResponse.json({
      skusPendentes: skusPaginados,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Erro ao buscar SKUs pendentes:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

// POST /api/sku/pendentes - Criar SKUs pendentes em lote
export async function POST(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('session')?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    
    const session = await verifySessionToken(sessionCookie);

    const body = await request.json();
    const { skus, custoUnitarioPadrao = 0 } = body;

    if (!Array.isArray(skus) || skus.length === 0) {
      return NextResponse.json(
        { error: 'Lista de SKUs é obrigatória' },
        { status: 400 }
      );
    }

    const results = {
      success: 0,
      errors: [] as string[],
      skipped: 0,
    };

    // Processar cada SKU
    for (const skuData of skus) {
      try {
        const { sku, produto, custoUnitario = custoUnitarioPadrao } = skuData;

        if (!sku || !produto) {
          results.errors.push(`SKU ${sku || 'N/A'}: SKU e produto são obrigatórios`);
          continue;
        }

        // Verificar se SKU já existe
        const existingSku = await prisma.sKU.findFirst({
          where: {
            userId: session.sub,
            sku,
          },
        });

        if (existingSku) {
          results.skipped++;
          continue;
        }

        // Criar SKU
        const newSku = await prisma.sKU.create({
          data: {
            userId: session.sub,
            sku,
            produto,
            tipo: 'filho',
            custoUnitario,
            quantidade: 0,
            // proporcao será sempre 1.0 para SKUs filhos (100%)
            proporcao: 1.0,
            ativo: true,
            temEstoque: true,
          },
        });

        // Criar histórico de custo
        await prisma.sKUCustoHistorico.create({
          data: {
            skuId: newSku.id,
            userId: session.sub,
            custoNovo: custoUnitario,
            quantidade: 0,
            motivo: 'Criação automática a partir de vendas',
            tipoAlteracao: 'sistema',
            alteradoPor: session.sub,
          },
        });

        results.success++;
      } catch (error) {
        results.errors.push(`SKU ${skuData.sku || 'N/A'}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      }
    }

    return NextResponse.json({
      message: 'Processamento concluído',
      results,
    });
  } catch (error) {
    console.error('Erro ao criar SKUs pendentes:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
