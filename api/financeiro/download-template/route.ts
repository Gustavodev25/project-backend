import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { tryVerifySessionToken } from "@/lib/auth";
import * as XLSX from 'xlsx';

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Verificar o token JWT de sessão
    const session = await tryVerifySessionToken(sessionCookie.value);
    
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida ou expirada" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'contas_pagar';

    // Criar dados de exemplo baseados no tipo
    const getTemplateData = () => {
      switch (type) {
        case 'contas_pagar':
          return {
            'Descrição': 'Pagamento de fornecedor',
            'Valor': '150.00',
            'Data de Vencimento': '15/01/2024',
            'Data de Pagamento': '15/01/2024',
            'Categoria': 'Fornecedores',
            'Forma de Pagamento': 'PIX'
          };
        case 'contas_receber':
          return {
            'Descrição': 'Venda de produto',
            'Valor': '300.00',
            'Data de Vencimento': '20/01/2024',
            'Data de Recebimento': '20/01/2024',
            'Categoria': 'Vendas',
            'Forma de Pagamento': 'Cartão de Crédito'
          };
        case 'categorias':
          return {
            'Descrição': 'Fornecedores',
            'Tipo': 'despesa'
          };
        case 'formas_pagamento':
          return {
            'Nome': 'PIX'
          };
        default:
          return {};
      }
    };

    // Criar workbook
    const wb = XLSX.utils.book_new();
    
    // Criar dados do template
    const templateData = getTemplateData();
    const headers = Object.keys(templateData);
    const values = Object.values(templateData);
    
    // Criar worksheet
    const ws = XLSX.utils.aoa_to_sheet([headers, values]);
    
    // Configurar larguras das colunas
    const colWidths = headers.map(header => ({
      wch: Math.max(header.length, 15)
    }));
    ws['!cols'] = colWidths;
    
    // Adicionar worksheet ao workbook
    XLSX.utils.book_append_sheet(wb, ws, getTypeLabel(type));
    
    // Criar instruções em uma segunda aba
    const instructionsData = [
      [`INSTRUÇÕES PARA IMPORTAÇÃO DE ${getTypeLabel(type).toUpperCase()}`],
      [''],
      ['FORMATO DOS DADOS:'],
      ['• Datas: DD/MM/AAAA (ex: 15/01/2024)'],
      ['• Valores monetários: Use ponto como separador decimal (ex: 150.00)'],
      ['• Campos obrigatórios: ' + headers.join(', ')],
      [''],
      ['VALIDAÇÕES:'],
      ['• Valores devem ser números positivos'],
      ['• Datas devem estar no formato brasileiro'],
      ['• Categorias e formas de pagamento devem existir no sistema'],
      [''],
      ['DICAS:'],
      ['• Use este modelo como base'],
      ['• Mantenha os cabeçalhos na primeira linha'],
      ['• Não deixe linhas vazias entre os dados'],
      ['• Verifique se todos os campos obrigatórios estão preenchidos']
    ];

    if (type === 'categorias') {
      instructionsData.splice(6, 0, ['• Tipo deve ser "receita" ou "despesa"']);
    }
    
    const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData);
    wsInstructions['!cols'] = [{ wch: 50 }];
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instruções');
    
    // Gerar buffer do arquivo
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    // Retornar arquivo
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="modelo_${type}.xlsx"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Erro ao gerar modelo Excel:", error);
    return NextResponse.json(
      { error: "Erro ao gerar modelo Excel" },
      { status: 500 }
    );
  }
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'contas_pagar':
      return 'Contas a Pagar';
    case 'contas_receber':
      return 'Contas a Receber';
    case 'categorias':
      return 'Categorias';
    case 'formas_pagamento':
      return 'Formas de Pagamento';
    default:
      return 'Finanças';
  }
}

