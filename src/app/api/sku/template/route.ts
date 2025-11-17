import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/auth';
import * as XLSX from 'xlsx';

// GET /api/sku/template - Baixar template Excel para importação
export async function GET(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('session')?.value;

    if (!sessionCookie) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    await verifySessionToken(sessionCookie);

    // Dados de exemplo para o template
    const templateData = [
      {
        'SKU': 'SKU-001',
        'Produto': 'Produto Exemplo 1',
        'Tipo': 'Individual',
        'SKU Pai': '',
        'Custo Unitário': '10.50',
        'Quantidade': '100',
        'Hierarquia 1': 'Eletrônicos',
        'Hierarquia 2': 'Smartphones',
        'Ativo': 'Sim',
        'Tem Estoque': 'Sim',
        'SKUs Filhos': '',
        'Observações': 'Produto de exemplo',
        'Tags': 'novo, promo',
      },
      {
        'SKU': 'SKU-002',
        'Produto': 'Kit Completo',
        'Tipo': 'Kit',
        'SKU Pai': '',
        'Custo Unitário': '50.00',
        'Quantidade': '10',
        'Hierarquia 1': 'Kits',
        'Hierarquia 2': 'Combo',
        'Ativo': 'Sim',
        'Tem Estoque': 'Sim',
        'SKUs Filhos': 'SKU-001, SKU-003',
        'Observações': 'Kit com 2 produtos',
        'Tags': 'kit, combo',
      },
      {
        'SKU': 'SKU-003',
        'Produto': 'Produto Exemplo 2',
        'Tipo': 'Individual',
        'SKU Pai': 'SKU-002',
        'Custo Unitário': '5.00',
        'Quantidade': '200',
        'Hierarquia 1': 'Acessórios',
        'Hierarquia 2': 'Cabos',
        'Ativo': 'Sim',
        'Tem Estoque': 'Não',
        'SKUs Filhos': '',
        'Observações': '',
        'Tags': '',
      },
    ];

    // Criar workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);

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
    ];
    ws['!cols'] = colWidths;

    // Adicionar instruções em uma segunda aba
    const instructions = [
      { Campo: 'SKU', Descrição: 'Código único do produto (obrigatório)', Exemplo: 'SKU-001' },
      { Campo: 'Produto', Descrição: 'Nome do produto (obrigatório)', Exemplo: 'Camiseta Azul' },
      { Campo: 'Tipo', Descrição: 'Individual ou Kit', Exemplo: 'Individual' },
      { Campo: 'SKU Pai', Descrição: 'SKU do kit ao qual pertence (se aplicável)', Exemplo: 'SKU-KIT-01' },
      { Campo: 'Custo Unitário', Descrição: 'Custo do produto (use ponto como decimal)', Exemplo: '10.50' },
      { Campo: 'Quantidade', Descrição: 'Quantidade em estoque', Exemplo: '100' },
      { Campo: 'Hierarquia 1', Descrição: 'Categoria principal', Exemplo: 'Vestuário' },
      { Campo: 'Hierarquia 2', Descrição: 'Subcategoria', Exemplo: 'Camisetas' },
      { Campo: 'Ativo', Descrição: 'Sim ou Não', Exemplo: 'Sim' },
      { Campo: 'Tem Estoque', Descrição: 'Sim ou Não', Exemplo: 'Sim' },
      { Campo: 'SKUs Filhos', Descrição: 'SKUs que compõem o kit (separados por vírgula)', Exemplo: 'SKU-001, SKU-002' },
      { Campo: 'Observações', Descrição: 'Informações adicionais (opcional)', Exemplo: 'Produto novo' },
      { Campo: 'Tags', Descrição: 'Etiquetas separadas por vírgula (opcional)', Exemplo: 'novo, promo' },
    ];

    const wsInstructions = XLSX.utils.json_to_sheet(instructions);
    wsInstructions['!cols'] = [
      { wch: 20 }, // Campo
      { wch: 50 }, // Descrição
      { wch: 30 }, // Exemplo
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instruções');

    // Gerar buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Retornar arquivo
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="template_skus.xlsx"',
      },
    });
  } catch (error) {
    console.error('Erro ao gerar template:', error);
    return NextResponse.json(
      { error: 'Erro ao gerar template' },
      { status: 500 }
    );
  }
}
