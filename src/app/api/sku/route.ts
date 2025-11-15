import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifySessionToken } from '@/lib/auth';

// GET /api/sku - Listar SKUs
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
    const hierarquia1 = searchParams.get('hierarquia1') || '';
    const hierarquia2 = searchParams.get('hierarquia2') || '';

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

    if (hierarquia1) {
      where.hierarquia1 = hierarquia1;
    }

    if (hierarquia2) {
      where.hierarquia2 = hierarquia2;
    }

    const [skus, total] = await Promise.all([
      prisma.sKU.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { tipo: 'desc' }, // Kits primeiro
          { sku: 'asc' },
        ],
        include: {
          custoHistorico: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.sKU.count({ where }),
    ]);

    return NextResponse.json({
      skus,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Erro ao buscar SKUs:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

// POST /api/sku - Criar SKU
export async function POST(request: NextRequest) {
  try {
    console.log('API POST /api/sku chamada');
    
    const sessionCookie = request.cookies.get('session')?.value;
    
    if (!sessionCookie) {
      console.log('Erro: Não autenticado');
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    
    const session = await verifySessionToken(sessionCookie);
    console.log('Sessão verificada para usuário:', session.sub);

    const body = await request.json();
    console.log('Dados recebidos:', body);
    
    const {
      sku,
      produto,
      tipo = 'filho',
      skuPai,
      custoUnitario,
      quantidade = 0,
      hierarquia1,
      hierarquia2,
      ativo = true,
      temEstoque = true,
      skusFilhos,
      observacoes,
      tags,
    } = body;

    // Validações
    if (!sku || !produto) {
      console.log('Erro: SKU e produto são obrigatórios');
      return NextResponse.json(
        { error: 'SKU e produto são obrigatórios' },
        { status: 400 }
      );
    }

    // Para SKUs filhos, custo unitário é obrigatório
    // Para kits (pai), custo será calculado automaticamente como soma dos filhos
    if (tipo === 'filho' && custoUnitario === undefined) {
      console.log('Erro: Custo unitário é obrigatório para SKUs filhos');
      return NextResponse.json(
        { error: 'Custo unitário é obrigatório para SKUs filhos' },
        { status: 400 }
      );
    }

    // Verificar se SKU já existe
    const existingSku = await prisma.sKU.findFirst({
      where: {
        userId: session.sub,
        sku,
      },
    });

    if (existingSku) {
      console.log('Erro: SKU já existe');
      return NextResponse.json(
        { error: 'SKU já existe' },
        { status: 400 }
      );
    }

    // Verificar se SKU pai existe (se fornecido)
    if (skuPai) {
      const skuPaiExists = await prisma.sKU.findFirst({
        where: {
          userId: session.sub,
          sku: skuPai,
          tipo: 'pai',
        },
      });

      if (!skuPaiExists) {
        console.log('Erro: SKU pai não encontrado');
        return NextResponse.json(
          { error: 'SKU pai não encontrado' },
          { status: 400 }
        );
      }
    }

    console.log('Iniciando criação do SKU...');
    
    // Criar SKU em uma transação
    const newSku = await prisma.$transaction(async (tx) => {
      // Criar o SKU
      const createdSku = await tx.sKU.create({
        data: {
          userId: session.sub,
          sku,
          produto,
          tipo,
          skuPai,
          // Para kits (pai), custo será calculado automaticamente como soma dos filhos
          // Para filhos, usar o custo fornecido
          custoUnitario: tipo === 'pai' ? 0 : custoUnitario,
          quantidade,
          hierarquia1,
          hierarquia2,
          ativo,
          temEstoque,
          // proporcao será sempre 1.0 para SKUs filhos (100%)
          // Para kits, proporção será calculada pela soma dos custos dos filhos
          proporcao: tipo === 'filho' ? 1.0 : null,
          // Prisma JSON: gravar array/obj direto (sem stringify)
          skusFilhos: skusFilhos ?? null,
          observacoes,
          tags: tags ?? null,
        },
      });

      console.log('SKU criado:', createdSku);

      // Criar histórico de custo inicial apenas para SKUs filhos
      // Kits terão seu custo calculado automaticamente pelos triggers
      if (tipo === 'filho') {
        await tx.sKUCustoHistorico.create({
          data: {
            skuId: createdSku.id,
            userId: session.sub,
            custoNovo: custoUnitario,
            quantidade,
            motivo: 'Criação inicial do SKU',
            tipoAlteracao: 'manual',
            alteradoPor: session.sub,
          },
        });
        console.log('Histórico de custo criado');
      }

      // Se for um kit (tipo pai) com filhos, atualizar os filhos para apontarem para este kit
      if (tipo === 'pai' && skusFilhos && Array.isArray(skusFilhos) && skusFilhos.length > 0) {
        console.log(`[KIT CRIADO] Kit: ${createdSku.sku}, Atrelando ${skusFilhos.length} itens:`, skusFilhos);
        
        // Atualizar todos os SKUs filhos para terem este kit como pai
        const result = await tx.sKU.updateMany({
          where: {
            userId: session.sub,
            sku: { in: skusFilhos },
            tipo: 'filho',
          },
          data: {
            skuPai: createdSku.sku,
          },
        });
        
        console.log(`[KIT CRIADO] ${result.count} SKUs atualizados com skuPai = ${createdSku.sku}`);
      }

      return createdSku;
    });

    console.log('SKU criado com sucesso:', newSku);
    return NextResponse.json(newSku, { status: 201 });
  } catch (error) {
    console.error('Erro ao criar SKU:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
