import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifySessionToken } from '@/lib/auth';
import * as XLSX from 'xlsx';

// Aumentar timeout para suportar arquivos grandes
export const maxDuration = 60;

// POST /api/sku/import - Importar Excel de SKUs (otimizado)
export async function POST(request: NextRequest) {
  try {
    // Autenticação via cookie (consistente com export)
    const sessionCookie = request.cookies.get('session')?.value;

    if (!sessionCookie) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const session = await verifySessionToken(sessionCookie);
    const userId = session.sub;

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'Arquivo não fornecido' },
        { status: 400 }
      );
    }

    // Verificar tipo de arquivo
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      return NextResponse.json(
        { error: 'Formato de arquivo não suportado. Use .xlsx ou .xls' },
        { status: 400 }
      );
    }

    // Ler arquivo
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet) as any[];

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Arquivo vazio ou sem dados' },
        { status: 400 }
      );
    }

    // Resultados da importação
    const results = {
      success: 0,
      skipped: 0,
      errors: [] as string[],
    };

    // OTIMIZAÇÃO 1: Buscar todos os SKUs existentes de uma vez
    const existingSkus = await prisma.sKU.findMany({
      where: { userId },
      select: { sku: true, id: true },
    });

    const existingSkuMap = new Map(existingSkus.map(s => [s.sku, s.id]));

    // OTIMIZAÇÃO 2: Validar e preparar todos os dados primeiro
    const skusToCreate: any[] = [];
    const custoHistoricoToCreate: any[] = [];
    const skuIdMap = new Map<string, string>(); // Mapeia SKU para ID temporário

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 porque linha 1 é cabeçalho e arrays começam em 0

      try {
        // Validar campos obrigatórios
        if (!row['SKU'] || !row['Produto']) {
          results.errors.push(`Linha ${rowNumber}: SKU e Produto são obrigatórios`);
          continue;
        }

        const sku = String(row['SKU']).trim();

        // Verificar se SKU já existe no banco
        if (existingSkuMap.has(sku)) {
          results.skipped++;
          continue;
        }

        // Verificar se SKU já está na lista para criar (evitar duplicatas no próprio arquivo)
        if (skuIdMap.has(sku)) {
          results.errors.push(`Linha ${rowNumber}: SKU "${sku}" duplicado no arquivo`);
          continue;
        }

        // Processar tipo
        let tipo: 'pai' | 'filho' = 'filho';
        if (row['Tipo']) {
          const tipoStr = String(row['Tipo']).toLowerCase();
          if (tipoStr === 'kit' || tipoStr === 'pai') {
            tipo = 'pai';
          }
        }

        // Processar valores numéricos
        const custoUnitario = row['Custo Unitário']
          ? parseFloat(String(row['Custo Unitário']).replace(',', '.'))
          : 0;

        const quantidade = row['Quantidade']
          ? parseInt(String(row['Quantidade']))
          : 0;

        // Processar booleanos
        const ativo = row['Ativo']
          ? (String(row['Ativo']).toLowerCase() === 'sim' || String(row['Ativo']) === '1' || String(row['Ativo']).toLowerCase() === 'true')
          : true;

        const temEstoque = row['Tem Estoque']
          ? (String(row['Tem Estoque']).toLowerCase() === 'sim' || String(row['Tem Estoque']) === '1' || String(row['Tem Estoque']).toLowerCase() === 'true')
          : true;

        // Processar arrays (SKUs Filhos e Tags)
        let skusFilhos = null;
        if (row['SKUs Filhos'] && String(row['SKUs Filhos']).trim()) {
          const filhos = String(row['SKUs Filhos'])
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);
          if (filhos.length > 0) {
            skusFilhos = JSON.stringify(filhos);
          }
        }

        let tags = null;
        if (row['Tags'] && String(row['Tags']).trim()) {
          const tagArray = String(row['Tags'])
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);
          if (tagArray.length > 0) {
            tags = JSON.stringify(tagArray);
          }
        }

        // Preparar dados do SKU
        const skuData = {
          userId,
          sku,
          produto: String(row['Produto']).trim(),
          tipo,
          skuPai: row['SKU Pai'] ? String(row['SKU Pai']).trim() : null,
          custoUnitario,
          quantidade,
          hierarquia1: row['Hierarquia 1'] ? String(row['Hierarquia 1']).trim() : null,
          hierarquia2: row['Hierarquia 2'] ? String(row['Hierarquia 2']).trim() : null,
          ativo,
          temEstoque,
          skusFilhos,
          observacoes: row['Observações'] ? String(row['Observações']).trim() : null,
          tags,
        };

        skusToCreate.push(skuData);

        // Guardar para criar histórico depois (usaremos o ID retornado)
        custoHistoricoToCreate.push({
          sku, // Identificador temporário
          custoNovo: custoUnitario,
          quantidade,
        });

      } catch (error) {
        results.errors.push(
          `Linha ${rowNumber}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
        );
      }
    }

    // OTIMIZAÇÃO 3: Inserir todos os SKUs de uma vez (batch insert)
    if (skusToCreate.length > 0) {
      try {
        // Usar createManyAndReturn para obter os IDs dos registros criados
        const createdSkus = await prisma.sKU.createManyAndReturn({
          data: skusToCreate,
        });

        results.success = createdSkus.length;

        // OTIMIZAÇÃO 4: Criar histórico de custos em batch
        const historicosData = createdSkus.map((createdSku, index) => {
          const historicoInfo = custoHistoricoToCreate[index];
          return {
            skuId: createdSku.id,
            userId,
            custoNovo: historicoInfo.custoNovo,
            quantidade: historicoInfo.quantidade,
            motivo: 'Importação via Excel',
            tipoAlteracao: 'importacao' as const,
            alteradoPor: userId,
          };
        });

        if (historicosData.length > 0) {
          await prisma.sKUCustoHistorico.createMany({
            data: historicosData,
          });
        }

      } catch (error) {
        console.error('Erro ao criar SKUs em batch:', error);
        return NextResponse.json(
          {
            error: 'Erro ao salvar SKUs no banco de dados',
            details: error instanceof Error ? error.message : 'Erro desconhecido'
          },
          { status: 500 }
        );
      }
    }

    // Retornar resultados
    return NextResponse.json({
      message: 'Importação concluída',
      results: {
        total: rows.length,
        success: results.success,
        skipped: results.skipped,
        errors: results.errors.length,
        errorDetails: results.errors.slice(0, 10), // Limitar a 10 erros para não sobrecarregar
      },
    });

  } catch (error) {
    console.error('Erro ao importar SKUs:', error);
    return NextResponse.json(
      {
        error: 'Erro interno do servidor',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
