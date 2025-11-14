import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifySessionToken } from '@/lib/auth';

// PUT /api/sku/[id] - Atualizar SKU
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessionCookie = request.cookies.get('session')?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    
    const session = await verifySessionToken(sessionCookie);

    const body = await request.json();
    const {
      sku,
      produto,
      tipo,
      skuPai,
      custoUnitario,
      quantidade,
      hierarquia1,
      hierarquia2,
      ativo,
      temEstoque,
      skusFilhos,
      observacoes,
      tags,
    } = body;

    // Buscar SKU existente
    const existingSku = await prisma.sKU.findFirst({
      where: {
        id: id,
        userId: session.sub,
      },
    });

    if (!existingSku) {
      return NextResponse.json(
        { error: 'SKU não encontrado' },
        { status: 404 }
      );
    }

    // Verificar se novo SKU já existe (se mudou)
    if (sku && sku !== existingSku.sku) {
      const skuExists = await prisma.sKU.findFirst({
        where: {
          userId: session.sub,
          sku,
          id: { not: id },
        },
      });

      if (skuExists) {
        return NextResponse.json(
          { error: 'SKU já existe' },
          { status: 400 }
        );
      }
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
        return NextResponse.json(
          { error: 'SKU pai não encontrado' },
          { status: 400 }
        );
      }
    }

    // Atualizar SKU em uma transação
    const updatedSku = await prisma.$transaction(async (tx) => {
      // Atualizar o SKU
      const updated = await tx.sKU.update({
        where: { id: id },
        data: {
          sku: sku || existingSku.sku,
          produto: produto || existingSku.produto,
          tipo: tipo || existingSku.tipo,
          skuPai: skuPai !== undefined ? skuPai : existingSku.skuPai,
          custoUnitario: custoUnitario !== undefined ? custoUnitario : existingSku.custoUnitario,
          quantidade: quantidade !== undefined ? quantidade : existingSku.quantidade,
          hierarquia1: hierarquia1 !== undefined ? hierarquia1 : existingSku.hierarquia1,
          hierarquia2: hierarquia2 !== undefined ? hierarquia2 : existingSku.hierarquia2,
          ativo: ativo !== undefined ? ativo : existingSku.ativo,
          temEstoque: temEstoque !== undefined ? temEstoque : existingSku.temEstoque,
          skusFilhos: skusFilhos !== undefined ? (skusFilhos ? skusFilhos : null) : existingSku.skusFilhos,
          observacoes: observacoes !== undefined ? observacoes : existingSku.observacoes,
          tags: tags !== undefined ? (tags ? tags : null) : existingSku.tags,
        },
      });

      // Criar histórico de custo se custo mudou
      if (custoUnitario !== undefined && custoUnitario !== existingSku.custoUnitario) {
        await tx.sKUCustoHistorico.create({
          data: {
            skuId: id,
            userId: session.sub,
            custoAnterior: existingSku.custoUnitario,
            custoNovo: custoUnitario,
            quantidade: quantidade || existingSku.quantidade,
            motivo: 'Atualização manual do custo',
            tipoAlteracao: 'manual',
            alteradoPor: session.sub,
          },
        });
      }

      // Se é um kit e os filhos foram atualizados, sincronizar os vínculos
      const finalTipo = tipo || existingSku.tipo;
      if (finalTipo === 'pai' && skusFilhos !== undefined) {
        const newSkusFilhos = Array.isArray(skusFilhos) ? skusFilhos : [];
        const oldSkusFilhos = Array.isArray(existingSku.skusFilhos) 
          ? (existingSku.skusFilhos as string[])
          : [];

        console.log(`[KIT ATUALIZADO] Kit: ${updated.sku}, Filhos antigos:`, oldSkusFilhos, 'Novos:', newSkusFilhos);

        // Remover vínculo dos filhos que foram removidos do kit
        const removedFilhos = oldSkusFilhos.filter(s => !newSkusFilhos.includes(s));
        if (removedFilhos.length > 0) {
          console.log(`[KIT ATUALIZADO] Removendo vínculo de ${removedFilhos.length} itens:`, removedFilhos);
          await tx.sKU.updateMany({
            where: {
              userId: session.sub,
              sku: { in: removedFilhos },
              skuPai: existingSku.sku,
            },
            data: {
              skuPai: null,
            },
          });
        }

        // Adicionar vínculo aos novos filhos
        const addedFilhos = newSkusFilhos.filter(s => !oldSkusFilhos.includes(s));
        if (addedFilhos.length > 0) {
          console.log(`[KIT ATUALIZADO] Adicionando vínculo a ${addedFilhos.length} itens:`, addedFilhos);
          await tx.sKU.updateMany({
            where: {
              userId: session.sub,
              sku: { in: addedFilhos },
              tipo: 'filho',
            },
            data: {
              skuPai: updated.sku,
            },
          });
        }

        // Atualizar filhos existentes se o SKU do kit mudou
        if (sku && sku !== existingSku.sku) {
          console.log(`[KIT ATUALIZADO] SKU do kit mudou de ${existingSku.sku} para ${sku}, atualizando vínculos`);
          await tx.sKU.updateMany({
            where: {
              userId: session.sub,
              skuPai: existingSku.sku,
            },
            data: {
              skuPai: sku,
            },
          });
        }
      }

      return updated;
    });

    return NextResponse.json(updatedSku);
  } catch (error) {
    console.error('Erro ao atualizar SKU:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

// DELETE /api/sku/[id] - Excluir SKU
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessionCookie = request.cookies.get('session')?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    
    const session = await verifySessionToken(sessionCookie);

    // Verificar se SKU existe
    const existingSku = await prisma.sKU.findFirst({
      where: {
        id: id,
        userId: session.sub,
      },
    });

    if (!existingSku) {
      return NextResponse.json(
        { error: 'SKU não encontrado' },
        { status: 404 }
      );
    }

    // Verificar se há vendas associadas
    const vendasCount = await prisma.meliVenda.count({
      where: {
        sku: existingSku.sku,
        userId: session.sub,
      },
    });

    if (vendasCount > 0) {
      return NextResponse.json(
        { 
          error: 'Não é possível excluir SKU com vendas associadas',
          vendasCount 
        },
        { status: 400 }
      );
    }

    // Excluir SKU (histórico de custos será excluído automaticamente por cascade)
    await prisma.sKU.delete({
      where: { id: id },
    });

    return NextResponse.json({ message: 'SKU excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir SKU:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
