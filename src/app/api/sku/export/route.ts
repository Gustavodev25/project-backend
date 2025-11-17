import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifySessionToken } from '@/lib/auth';
import * as XLSX from 'xlsx';

// GET /api/sku/export - Exportar Excel
export async function GET(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('session')?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    
    const session = await verifySessionToken(sessionCookie);

    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get('tipo') || '';
    const ativo = searchParams.get('ativo');

    // Construir filtros
    const where: any = {
      userId: session.sub,
    };

    if (tipo) {
      where.tipo = tipo;
    }

    if (ativo !== null) {
      where.ativo = ativo === 'true';
    }

    // Buscar SKUs
    const skus = await prisma.sKU.findMany({
      where,
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

    // Preparar dados para Excel
    const excelData = skus.map(sku => {
      // Parse seguro de skusFilhos
      let skusFilhosStr = '';
      if (sku.skusFilhos) {
        try {
          const parsed = typeof sku.skusFilhos === 'string'
            ? JSON.parse(sku.skusFilhos)
            : sku.skusFilhos;
          if (Array.isArray(parsed)) {
            skusFilhosStr = parsed.join(', ');
          }
        } catch (e) {
          console.warn(`Erro ao parsear skusFilhos do SKU ${sku.sku}:`, e);
        }
      }

      // Parse seguro de tags
      let tagsStr = '';
      if (sku.tags) {
        try {
          const parsed = typeof sku.tags === 'string'
            ? JSON.parse(sku.tags)
            : sku.tags;
          if (Array.isArray(parsed)) {
            tagsStr = parsed.join(', ');
          }
        } catch (e) {
          console.warn(`Erro ao parsear tags do SKU ${sku.sku}:`, e);
        }
      }

      return {
        'SKU': sku.sku,
        'Produto': sku.produto,
        'Tipo': sku.tipo === 'pai' ? 'Kit' : 'Individual',
        'SKU Pai': sku.skuPai || '',
        'Custo Unitário': Number(sku.custoUnitario).toString(),
        'Quantidade': Number(sku.quantidade).toString(),
        'Hierarquia 1': sku.hierarquia1 || '',
        'Hierarquia 2': sku.hierarquia2 || '',
        'Ativo': sku.ativo ? 'Sim' : 'Não',
        'Tem Estoque': sku.temEstoque ? 'Sim' : 'Não',
        'SKUs Filhos': skusFilhosStr,
        'Observações': sku.observacoes || '',
        'Tags': tagsStr,
        'Data Criação': sku.createdAt.toISOString().split('T')[0],
        'Última Atualização': sku.updatedAt.toISOString().split('T')[0],
      };
    });

    // Criar workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Ajustar largura das colunas
    const colWidths = [
      { wch: 15 }, // SKU
      { wch: 30 }, // Produto
      { wch: 12 }, // Tipo
      { wch: 15 }, // SKU Pai
      { wch: 15 }, // Custo Unitário
      { wch: 12 }, // Quantidade
      { wch: 20 }, // Hierarquia 1
      { wch: 20 }, // Hierarquia 2
      { wch: 8 },  // Ativo
      { wch: 12 }, // Tem Estoque
      { wch: 30 }, // SKUs Filhos
      { wch: 30 }, // Observações
      { wch: 20 }, // Tags
      { wch: 12 }, // Data Criação
      { wch: 15 }, // Última Atualização
    ];
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'SKUs');

    // Gerar buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Retornar arquivo
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="skus_${new Date().toISOString().split('T')[0]}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Erro ao exportar SKUs:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'N/A');
    console.error('Mensagem:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      {
        error: 'Erro interno do servidor',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
