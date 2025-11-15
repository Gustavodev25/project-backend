import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { tryVerifySessionToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from 'xlsx';

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
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

    const userId = session.sub;
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const platform = formData.get('platform') as string;

    if (!file) {
      return NextResponse.json(
        { error: "Arquivo não fornecido" },
        { status: 400 }
      );
    }

    // Validar tipo de arquivo
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];

    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de arquivo não suportado. Use .xlsx, .xls ou .csv" },
        { status: 400 }
      );
    }

    // Ler arquivo
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (data.length < 2) {
      return NextResponse.json(
        { error: "Arquivo deve ter pelo menos uma linha de cabeçalho e uma linha de dados" },
        { status: 400 }
      );
    }

    const headers = data[0] as string[];
    const rows = data.slice(1) as unknown[][];

    // Mapear campos para colunas do banco
    const fieldMapping = getFieldMapping(headers, platform);
    
    let imported = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    // Processar cada linha
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      if (!row || row.every(cell => !cell)) {
        continue; // Pular linhas vazias
      }

      try {
        const vendaData = parseRowData(row, fieldMapping, platform, userId);
        
        if (platform === 'Mercado Livre' || platform === 'Geral') {
          await prisma.meliVenda.create({
            data: vendaData
          });
        } else if (platform === 'Shopee') {
          await prisma.shopeeVenda.create({
            data: vendaData
          });
        }
        
        imported++;
      } catch (error) {
        errors++;
        errorDetails.push(`Linha ${i + 2}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      errors,
      errorDetails: errorDetails.slice(0, 10) // Limitar a 10 erros para não sobrecarregar
    });

  } catch (error) {
    console.error("Erro ao processar importação:", error);
    return NextResponse.json(
      { error: "Erro ao processar arquivo" },
      { status: 500 }
    );
  }
}

function getFieldMapping(headers: string[], platform: string) {
  const mapping: { [key: string]: string } = {};
  
  headers.forEach((header, index) => {
    const normalizedHeader = header.toLowerCase().trim();
    
    // Mapear campos comuns
    if (normalizedHeader.includes('data da venda') || normalizedHeader.includes('data_venda')) {
      mapping['dataVenda'] = index.toString();
    } else if (normalizedHeader.includes('status')) {
      mapping['status'] = index.toString();
    } else if (normalizedHeader.includes('conta')) {
      mapping['conta'] = index.toString();
    } else if (normalizedHeader.includes('valor total') || normalizedHeader.includes('valor_total')) {
      mapping['valorTotal'] = index.toString();
    } else if (normalizedHeader.includes('quantidade')) {
      mapping['quantidade'] = index.toString();
    } else if (normalizedHeader.includes('valor unitário') || normalizedHeader.includes('valor_unitario')) {
      mapping['unitario'] = index.toString();
    } else if (normalizedHeader.includes('taxa') || normalizedHeader.includes('taxa_plataforma')) {
      mapping['taxaPlataforma'] = index.toString();
    } else if (normalizedHeader.includes('frete')) {
      mapping['frete'] = index.toString();
    } else if (normalizedHeader.includes('cmv')) {
      mapping['cmv'] = index.toString();
    } else if (normalizedHeader.includes('margem') || normalizedHeader.includes('margem_contribuicao')) {
      mapping['margemContribuicao'] = index.toString();
    } else if (normalizedHeader.includes('título') || normalizedHeader.includes('titulo')) {
      mapping['titulo'] = index.toString();
    } else if (normalizedHeader.includes('sku')) {
      mapping['sku'] = index.toString();
    } else if (normalizedHeader.includes('comprador')) {
      mapping['comprador'] = index.toString();
    } else if (normalizedHeader.includes('tipo de logística') || normalizedHeader.includes('logistic_type')) {
      mapping['logisticType'] = index.toString();
    } else if (normalizedHeader.includes('modo de envio') || normalizedHeader.includes('envio_mode')) {
      mapping['envioMode'] = index.toString();
    } else if (normalizedHeader.includes('status do envio') || normalizedHeader.includes('shipping_status')) {
      mapping['shippingStatus'] = index.toString();
    } else if (normalizedHeader.includes('id do envio') || normalizedHeader.includes('shipping_id')) {
      mapping['shippingId'] = index.toString();
    }
    
    // Campos específicos do Mercado Livre
    if (platform === 'Mercado Livre' || platform === 'Geral') {
      if (normalizedHeader.includes('exposição') || normalizedHeader.includes('exposicao')) {
        mapping['exposicao'] = index.toString();
      } else if (normalizedHeader.includes('tipo de anúncio') || normalizedHeader.includes('tipo_anuncio')) {
        mapping['tipoAnuncio'] = index.toString();
      } else if (normalizedHeader.includes('ads')) {
        mapping['ads'] = index.toString();
      } else if (normalizedHeader.includes('latitude')) {
        mapping['latitude'] = index.toString();
      } else if (normalizedHeader.includes('longitude')) {
        mapping['longitude'] = index.toString();
      }
    }
    
    // Campos específicos da Shopee
    if (platform === 'Shopee') {
      if (normalizedHeader.includes('método de pagamento') || normalizedHeader.includes('payment_method')) {
        mapping['paymentMethod'] = index.toString();
      } else if (normalizedHeader.includes('status do pagamento') || normalizedHeader.includes('payment_status')) {
        mapping['paymentStatus'] = index.toString();
      }
    }
    
    // Campos para Geral
    if (platform === 'Geral') {
      if (normalizedHeader.includes('plataforma')) {
        mapping['plataforma'] = index.toString();
      } else if (normalizedHeader.includes('canal')) {
        mapping['canal'] = index.toString();
      }
    }
  });
  
  return mapping;
}

function parseRowData(row: unknown[], mapping: { [key: string]: string }, platform: string, userId: string) {
  const getValue = (field: string) => {
    const index = parseInt(mapping[field]);
    return index !== undefined && index < row.length ? row[index] : null;
  };

  const parseDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    
    // Tentar diferentes formatos de data
    const formats = [
      /^(\d{2})\/(\d{2})\/(\d{4})$/, // DD/MM/YYYY
      /^(\d{4})-(\d{2})-(\d{2})$/, // YYYY-MM-DD
      /^(\d{2})-(\d{2})-(\d{4})$/  // DD-MM-YYYY
    ];
    
    for (const format of formats) {
      const match = dateStr.toString().match(format);
      if (match) {
        if (format === formats[0]) { // DD/MM/YYYY
          return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
        } else if (format === formats[1]) { // YYYY-MM-DD
          return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        } else { // DD-MM-YYYY
          return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
        }
      }
    }
    
    return new Date(dateStr);
  };

  const parseDecimal = (value: unknown) => {
    if (!value) return 0;
    const str = value.toString().replace(',', '.');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  };

  const parseInteger = (value: unknown) => {
    if (!value) return 1;
    const num = parseInt(value.toString());
    return isNaN(num) ? 1 : num;
  };

  // Validar campos obrigatórios
  const dataVenda = getValue('dataVenda');
  const status = getValue('status');
  const conta = getValue('conta');
  const valorTotal = getValue('valorTotal');
  const quantidade = getValue('quantidade');
  const titulo = getValue('titulo');
  const comprador = getValue('comprador');

  if (!dataVenda || !status || !conta || !valorTotal || !quantidade || !titulo || !comprador) {
    throw new Error('Campos obrigatórios faltando');
  }

  // Gerar orderId único se não fornecido
  const orderId = `IMPORT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const baseData = {
    orderId,
    userId,
    dataVenda: parseDate(dataVenda),
    status: status.toString(),
    conta: conta.toString(),
    valorTotal: parseDecimal(valorTotal),
    quantidade: parseInteger(quantidade),
    unitario: parseDecimal(getValue('unitario')) || parseDecimal(valorTotal) / parseInteger(quantidade),
    taxaPlataforma: parseDecimal(getValue('taxaPlataforma')),
    frete: parseDecimal(getValue('frete')) || 0,
    cmv: parseDecimal(getValue('cmv')),
    margemContribuicao: parseDecimal(getValue('margemContribuicao')),
    titulo: titulo.toString(),
    sku: getValue('sku')?.toString() || null,
    comprador: comprador.toString(),
    logisticType: getValue('logisticType')?.toString() || null,
    envioMode: getValue('envioMode')?.toString() || null,
    shippingStatus: getValue('shippingStatus')?.toString() || null,
    shippingId: getValue('shippingId')?.toString() || null,
    latitude: parseDecimal(getValue('latitude')) || null,
    longitude: parseDecimal(getValue('longitude')) || null,
    freteBaseCost: parseDecimal(getValue('freteBaseCost')),
    freteListCost: parseDecimal(getValue('freteListCost')),
    freteFinalCost: parseDecimal(getValue('freteFinalCost')),
    freteAdjustment: parseDecimal(getValue('freteAdjustment')),
  };

  if (platform === 'Mercado Livre' || platform === 'Geral') {
    return {
      ...baseData,
      meliAccountId: 'default', // Será necessário ajustar para contas reais
      exposicao: getValue('exposicao')?.toString() || null,
      tipoAnuncio: getValue('tipoAnuncio')?.toString() || null,
      ads: getValue('ads')?.toString() || null,
      plataforma: platform === 'Geral' ? (getValue('plataforma')?.toString() || 'Mercado Livre') : 'Mercado Livre',
      canal: platform === 'Geral' ? (getValue('canal')?.toString() || 'ML') : 'ML',
    };
  } else if (platform === 'Shopee') {
    return {
      ...baseData,
      shopeeAccountId: 'default', // Será necessário ajustar para contas reais
      paymentMethod: getValue('paymentMethod')?.toString() || null,
      paymentStatus: getValue('paymentStatus')?.toString() || null,
      plataforma: 'Shopee',
      canal: 'SP',
    };
  }

  return baseData;
}
