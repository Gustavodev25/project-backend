import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

async function testExport() {
  console.log('🧪 Testando exportação de SKUs...\n');

  try {
    // Buscar SKUs
    const skus = await prisma.sKU.findMany({
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

    console.log(`📊 Total de SKUs: ${skus.length}\n`);

    // Testar cada SKU individualmente
    for (const sku of skus) {
      console.log(`Processando SKU: ${sku.sku}`);
      console.log(`  Tipo: ${typeof sku.skusFilhos}, Valor: ${sku.skusFilhos}`);
      console.log(`  Tags Tipo: ${typeof sku.tags}, Valor: ${sku.tags}`);

      // Parse seguro de skusFilhos
      let skusFilhosStr = '';
      if (sku.skusFilhos) {
        try {
          const parsed = typeof sku.skusFilhos === 'string'
            ? JSON.parse(sku.skusFilhos)
            : sku.skusFilhos;
          if (Array.isArray(parsed)) {
            skusFilhosStr = parsed.join(', ');
            console.log(`  ✅ skusFilhos parseado: ${skusFilhosStr}`);
          }
        } catch (e) {
          console.error(`  ❌ Erro ao parsear skusFilhos:`, e);
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
            console.log(`  ✅ tags parseado: ${tagsStr}`);
          }
        } catch (e) {
          console.error(`  ❌ Erro ao parsear tags:`, e);
        }
      }

      console.log('');
    }

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
        'Custo Unitário': sku.custoUnitario.toString(),
        'Quantidade': sku.quantidade.toString(),
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

    console.log('\n✅ Dados parseados com sucesso!');
    console.log(`📄 Total de linhas no Excel: ${excelData.length}\n`);

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

    console.log('✅ Excel gerado com sucesso!');
    console.log(`📦 Tamanho do buffer: ${buffer.length} bytes\n`);

    // Salvar arquivo de teste
    const fs = require('fs');
    fs.writeFileSync('test-export.xlsx', buffer);
    console.log('✅ Arquivo salvo como test-export.xlsx');

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testExport();
