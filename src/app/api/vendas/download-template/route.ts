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
    const platform = searchParams.get('platform') || 'Geral';

    // Criar dados de exemplo baseados na plataforma
    const getTemplateData = () => {
      const commonFields = {
        'Data da Venda': '15/01/2024',
        'Status': 'paid',
        'Conta': 'Minha Conta',
        'Valor Total': '150.00',
        'Quantidade': '1',
        'Valor Unitário': '150.00',
        'Taxa da Plataforma': '15.00',
        'Frete': '10.00',
        'CMV': '80.00',
        'Margem de Contribuição': '45.00',
        'Título do Produto': 'Produto Exemplo',
        'SKU': 'SKU001',
        'Comprador': 'João Silva',
        'Tipo de Logística': 'Fulfillment',
        'Modo de Envio': 'Standard',
        'Status do Envio': 'shipped',
        'ID do Envio': 'SHIP123456'
      };

      if (platform === 'Mercado Livre') {
        return {
          ...commonFields,
          'Exposição': 'Premium',
          'Tipo de Anúncio': 'Catálogo',
          'ADS': 'ADS',
          'Latitude': '-23.5505',
          'Longitude': '-46.6333',
          'Custo Base do Frete': '8.00',
          'Custo Lista do Frete': '10.00',
          'Custo Final do Frete': '10.00',
          'Ajuste do Frete': '0.00'
        };
      } else if (platform === 'Shopee') {
        return {
          ...commonFields,
          'Método de Pagamento': 'Credit Card',
          'Status do Pagamento': 'paid',
          'Latitude': '-23.5505',
          'Longitude': '-46.6333',
          'Custo Base do Frete': '8.00',
          'Custo Lista do Frete': '10.00',
          'Custo Final do Frete': '10.00',
          'Ajuste do Frete': '0.00'
        };
      } else {
        return {
          ...commonFields,
          'Plataforma': 'Mercado Livre',
          'Canal': 'ML'
        };
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
    XLSX.utils.book_append_sheet(wb, ws, 'Vendas');
    
    // Criar instruções em uma segunda aba
    const instructionsData = [
      ['INSTRUÇÕES PARA IMPORTAÇÃO DE VENDAS'],
      [''],
      ['FORMATO DOS DADOS:'],
      ['• Data da Venda: DD/MM/AAAA (ex: 15/01/2024)'],
      ['• Valores monetários: Use ponto como separador decimal (ex: 150.00)'],
      ['• Status: paid, pending, cancelled, shipped, delivered'],
      ['• Campos obrigatórios: Data da Venda, Status, Conta, Valor Total, Quantidade, Título do Produto, Comprador'],
      [''],
      ['VALIDAÇÕES:'],
      ['• Valores devem ser números positivos'],
      ['• Datas devem estar no formato brasileiro'],
      ['• SKU é opcional mas recomendado'],
      ['• Campos de localização (Latitude/Longitude) são opcionais'],
      [''],
      ['DICAS:'],
      ['• Use este modelo como base'],
      ['• Mantenha os cabeçalhos na primeira linha'],
      ['• Não deixe linhas vazias entre os dados'],
      ['• Verifique se todos os campos obrigatórios estão preenchidos']
    ];
    
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
        'Content-Disposition': `attachment; filename="modelo_vendas_${platform.toLowerCase().replace(' ', '_')}.xlsx"`,
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

