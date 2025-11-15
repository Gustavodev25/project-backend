import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { tryVerifySessionToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60s para Pro/Enterprise, 10s para Free

export async function POST(request: NextRequest) {
  console.log('[Import Excel] Iniciando importação...');
  
  // Validação inicial rápida
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");

  if (!sessionCookie?.value) {
    return new Response(JSON.stringify({ error: "Não autenticado" }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const session = await tryVerifySessionToken(sessionCookie.value);
  if (!session) {
    return new Response(JSON.stringify({ error: "Sessão inválida" }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const userId = session.sub;
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const type = formData.get('type') as string;
  
  console.log(`[Import Excel] Tipo: ${type}, Arquivo: ${file?.name}`);

  if (!file) {
    return new Response(JSON.stringify({ error: "Arquivo não fornecido" }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Criar stream de resposta SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {

        // Validar tipo de arquivo
        const validTypes = [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv'
        ];

        if (!validTypes.includes(file.type)) {
          sendEvent({ 
            type: 'import_error',
            message: 'Tipo de arquivo não suportado. Use .xlsx, .xls ou .csv'
          });
          controller.close();
          return;
        }

        // Ler arquivo
        console.log('[Import Excel] Lendo arquivo...');
        const ab = await file.arrayBuffer();
        const workbook = XLSX.read(ab, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        console.log(`[Import Excel] ${data.length} linhas encontradas`);

        if (data.length < 2) {
          sendEvent({ 
            type: 'import_error',
            message: 'Arquivo deve ter pelo menos uma linha de cabeçalho e uma linha de dados'
          });
          controller.close();
          return;
        }

        const headers = data[0] as string[];
        const rows = data.slice(1) as unknown[][];
        const totalRows = rows.length;
        
        // Enviar evento de início via stream
        sendEvent({
          type: 'import_start',
          totalRows,
          processedRows: 0,
          importedRows: 0,
          errorRows: 0,
          message: `Iniciando importação de ${totalRows} linhas...`
        });

        // Mapear campos para colunas do banco
        const fieldMapping = getFieldMappingNormalized(headers, type);
        
        let imported = 0;
        let errors = 0;
        const errorDetails: string[] = [];

        // Pré-carregar referências
        console.log('[Import Excel] Carregando categorias e formas...');
        const [categorias, formas] = await Promise.all([
          prisma.categoria.findMany({ where: { userId } }),
          prisma.formaPagamento.findMany({ where: { userId } })
        ]);
        console.log(`[Import Excel] ${categorias.length} categorias carregadas`);

        const categoriaById = new Map<string, string>(categorias.map(c => [c.id, c.id]));
        const categoriaByName = new Map<string, string>(
          categorias
            .map(c => ({
              key: ((c.descricao || c.nome || '').trim().toLowerCase()),
              id: c.id,
            }))
            .filter(c => c.key)
            .map(c => [c.key, c.id])
        );
        const formaById = new Map<string, string>(formas.map(f => [f.id, f.id]));
        const formaByName = new Map<string, string>(
          formas
            .map(f => ({ key: (f.nome || '').trim().toLowerCase(), id: f.id }))
            .filter(f => f.key)
            .map(f => [f.key, f.id])
        );

        // Helper para extrair valores
        const getRawCellValue = (rowArr: unknown[], field: string) => {
          const idxStr = (fieldMapping as Record<string,string>)[field];
          if (idxStr == null) return null;
          const idx = Number.parseInt(idxStr);
          if (!Number.isFinite(idx)) return null;
          return idx < rowArr.length ? rowArr[idx] : null;
        };

    // PRÉ-PROCESSAR: Criar todas as categorias e formas de pagamento necessárias ANTES do loop principal
    console.log('[Import Excel] Pré-processando categorias e formas de pagamento necessárias...');
    if (type === 'contas_pagar' || type === 'contas_receber') {
      const novasCategoriasSet = new Set<string>();
      const novasFormasSet = new Set<string>();
      const tipoDefault = type === 'contas_pagar' ? 'DESPESA' : 'RECEITA';
      
      // Coletar todas as categorias/formas únicas que não existem
      rows.forEach(row => {
        const rawCategoria = getRawCellValue(row, 'categoria');
        const rawForma = getRawCellValue(row, 'formaPagamento');
        
        if (rawCategoria && typeof rawCategoria === 'string') {
          const k = rawCategoria.trim().toLowerCase();
          if (k && !categoriaByName.has(k)) {
            novasCategoriasSet.add(rawCategoria.trim());
          }
        }
        
        if (rawForma && typeof rawForma === 'string') {
          const kf = rawForma.trim().toLowerCase();
          if (kf && !formaByName.has(kf)) {
            novasFormasSet.add(rawForma.trim());
          }
        }
      });
      
      // Criar categorias em lote
      if (novasCategoriasSet.size > 0) {
        console.log(`[Import Excel] Criando ${novasCategoriasSet.size} novas categorias...`);
        const novasCategorias = await prisma.categoria.createManyAndReturn({
          data: Array.from(novasCategoriasSet).map(nome => ({
            userId,
            nome,
            descricao: nome,
            tipo: tipoDefault,
            ativo: true,
          })),
        });
        
        // Atualizar maps
        novasCategorias.forEach(cat => {
          categoriaById.set(cat.id, cat.id);
          categoriaByName.set(cat.nome.toLowerCase(), cat.id);
        });
      }
      
      // Criar formas em lote
      if (novasFormasSet.size > 0) {
        console.log(`[Import Excel] Criando ${novasFormasSet.size} novas formas de pagamento...`);
        const novasFormas = await prisma.formaPagamento.createManyAndReturn({
          data: Array.from(novasFormasSet).map(nome => ({
            userId,
            nome,
            ativo: true,
          })),
        });
        
        // Atualizar maps
        novasFormas.forEach(forma => {
          formaById.set(forma.id, forma.id);
          formaByName.set(forma.nome.toLowerCase(), forma.id);
        });
      }
    }

    // Processar cada linha e preparar dados para inserção em lote
    console.log(`[Import Excel] Processando ${totalRows} linhas...`);
    const startTime = Date.now();
    const BATCH_SIZE = 100; // Processar 100 linhas por batch
    
    for (let batchStart = 0; batchStart < totalRows; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, rows.length);
      const batch = rows.slice(batchStart, batchEnd);
      
      console.log(`[Import Excel] Batch: linhas ${batchStart + 1} a ${batchEnd}`);
      
      // Preparar dados em paralelo
      const batchData: any[] = [];
      const batchErrors: string[] = [];
      
      await Promise.all(
        batch.map(async (row, batchIndex) => {
          const i = batchStart + batchIndex;
          
          if (!row || row.every(cell => !cell)) {
            return;
          }

          try {
            const itemData = parseRowData(row, fieldMapping, type, userId, {
              categoriaById,
              categoriaByName,
              formaById,
              formaByName,
            });
            
            batchData.push(itemData);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
            console.error(`[Import Excel] Erro na linha ${i + 2}: ${errorMsg}`);
            batchErrors.push(`Linha ${i + 2}: ${errorMsg}`);
          }
        })
      );
      
      // Inserir todos os dados do batch de uma vez
      if (batchData.length > 0) {
        try {
          switch (type) {
            case 'contas_pagar':
              await prisma.contaPagar.createMany({
                data: batchData,
                skipDuplicates: true,
              });
              imported += batchData.length;
              break;
            case 'contas_receber':
              await prisma.contaReceber.createMany({
                data: batchData,
                skipDuplicates: true,
              });
              imported += batchData.length;
              break;
            case 'categorias': {
              // Para categorias, filtrar duplicadas antes de inserir
              const nomesExistentes = await prisma.categoria.findMany({
                where: {
                  userId,
                  OR: batchData.map(d => ({
                    OR: [
                      { nome: d.nome },
                      { descricao: d.descricao },
                    ],
                  })),
                },
                select: { nome: true, descricao: true },
              });
              
              const existingSet = new Set(
                nomesExistentes.flatMap(c => [c.nome, c.descricao])
              );
              
              const dataToInsert = batchData.filter(
                d => !existingSet.has(d.nome) && !existingSet.has(d.descricao)
              );
              
              if (dataToInsert.length > 0) {
                await prisma.categoria.createMany({
                  data: dataToInsert,
                  skipDuplicates: true,
                });
                imported += dataToInsert.length;
              }
              break;
            }
            case 'formas_pagamento': {
              // Para formas, filtrar duplicadas antes de inserir
              const nomesExistentes = await prisma.formaPagamento.findMany({
                where: {
                  userId,
                  nome: { in: batchData.map(d => d.nome) },
                },
                select: { nome: true },
              });
              
              const existingSet = new Set(nomesExistentes.map(f => f.nome));
              const dataToInsert = batchData.filter(d => !existingSet.has(d.nome));
              
              if (dataToInsert.length > 0) {
                await prisma.formaPagamento.createMany({
                  data: dataToInsert,
                  skipDuplicates: true,
                });
                imported += dataToInsert.length;
              }
              break;
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
          console.error(`[Import Excel] Erro ao inserir batch: ${errorMsg}`);
          batchErrors.push(`Erro ao inserir lote: ${errorMsg}`);
        }
      }
      
      // Acumular erros
      errors += batchErrors.length;
      errorDetails.push(...batchErrors);
      
      const progress = ((batchEnd / totalRows) * 100).toFixed(1);
      console.log(`[Import Excel] Progresso: ${progress}% (${imported}/${totalRows})`);
      
      // Enviar progresso via stream
      sendEvent({
        type: 'import_progress',
        totalRows,
        processedRows: batchEnd,
        importedRows: imported,
        errorRows: errors,
        message: `Processando: ${imported} importados, ${errors} erros`
      });
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Import Excel] Concluído: ${imported} importados, ${errors} erros`);
    
    // Enviar evento de conclusão via stream
    sendEvent({
      type: 'import_complete',
      totalRows,
      processedRows: totalRows,
      importedRows: imported,
      errorRows: errors,
      message: `Importação concluída: ${imported} registros importados em ${duration}s`,
      success: true,
      errorDetails: errorDetails.slice(0, 10)
    });
    
    // Fechar stream
    controller.close();
    
  } catch (error) {
    console.error("[Import Excel] Erro:", error);
    const errorMessage = error instanceof Error ? error.message : "Erro ao processar arquivo";
    
    sendEvent({
      type: 'import_error',
      totalRows: 0,
      processedRows: 0,
      importedRows: 0,
      errorRows: 0,
      message: `Erro: ${errorMessage}`,
      success: false
    });
    
    controller.close();
  }
}
});

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function getFieldMapping(headers: string[], type: string) {
  const mapping: { [key: string]: string } = {};
  
  headers.forEach((header, index) => {
    const normalizedHeader = header.toLowerCase().trim();
    
    switch (type) {
      case 'contas_pagar':
      case 'contas_receber':
        if (normalizedHeader.includes('descrição') || normalizedHeader.includes('descricao')) {
          mapping['descricao'] = index.toString();
        } else if (normalizedHeader.includes('valor')) {
          mapping['valor'] = index.toString();
        } else if (normalizedHeader.includes('data de vencimento') || normalizedHeader.includes('data_vencimento')) {
          mapping['dataVencimento'] = index.toString();
        } else if (normalizedHeader.includes('data de pagamento') || normalizedHeader.includes('data_pagamento')) {
          mapping['dataPagamento'] = index.toString();
        } else if (normalizedHeader.includes('data de recebimento') || normalizedHeader.includes('data_recebimento')) {
          mapping['dataRecebimento'] = index.toString();
        } else if (normalizedHeader.includes('data de competencia') || normalizedHeader.includes('data_competencia') || normalizedHeader.includes('competencia')) {
          mapping['dataCompetencia'] = index.toString();
        } else if (normalizedHeader.includes('categoria')) {
          mapping['categoria'] = index.toString();
        } else if (normalizedHeader.includes('forma de pagamento') || normalizedHeader.includes('forma_pagamento')) {
          mapping['formaPagamento'] = index.toString();
        }
        break;
      case 'categorias':
        if (normalizedHeader.includes('descrição') || normalizedHeader.includes('descricao')) {
          mapping['descricao'] = index.toString();
        } else if (normalizedHeader.includes('tipo')) {
          mapping['tipo'] = index.toString();
        }
        break;
      case 'formas_pagamento':
        if (normalizedHeader.includes('nome')) {
          mapping['nome'] = index.toString();
        }
        break;
    }
  });
  
  return mapping;
}

function parseRowData(
  row: unknown[],
  mapping: { [key: string]: string },
  type: string,
  userId: string,
  refs?: {
    categoriaById: Map<string, string>;
    categoriaByName: Map<string, string>;
    formaById: Map<string, string>;
    formaByName: Map<string, string>;
  }
) {
  const getValue = (field: string) => {
    const index = parseInt(mapping[field]);
    return index !== undefined && index < row.length ? row[index] : null;
  };

  const parseDate = (dateStr: unknown) => {
    if (!dateStr) return new Date();
    // Já é Date
    if (dateStr instanceof Date && !isNaN(dateStr.getTime())) return dateStr;
    // Excel serial number
    if (typeof dateStr === 'number') {
      const excelEpoch = new Date(Math.round((dateStr - 25569) * 86400 * 1000));
      return excelEpoch;
    }
    
    // Tentar diferentes formatos de data
    const formats = [
      /^(\d{2})\/(\d{2})\/(\d{4})$/, // DD/MM/YYYY
      /^(\d{4})-(\d{2})-(\d{2})$/, // YYYY-MM-DD
      /^(\d{2})-(\d{2})-(\d{4})$/  // DD-MM-YYYY
    ];
    
    for (const format of formats) {
      const match = (dateStr as string).toString().match(format);
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
    
    // Tentar converter para string e criar Date, ou retornar data atual se falhar
    try {
      const dateString = String(dateStr);
      const parsedDate = new Date(dateString);
      return !isNaN(parsedDate.getTime()) ? parsedDate : new Date();
    } catch {
      return new Date();
    }
  };

  const parseDecimal = (value: unknown) => {
    if (!value) return 0;
    const str = value.toString().replace(',', '.');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  };

  switch (type) {
    case 'contas_pagar':
      const descricaoPagar = getValue('descricao');
      const valorPagar = getValue('valor');
      const dataVencimentoPagar = getValue('dataVencimento');

      if (!descricaoPagar || !valorPagar || !dataVencimentoPagar) {
        throw new Error('Campos obrigatórios faltando: Descrição, Valor, Data de Vencimento');
      }

      const dataPagamentoPagar = getValue('dataPagamento') ? parseDate(getValue('dataPagamento')!) : null;
      const dataVencParsed = parseDate(dataVencimentoPagar);

      // Data de competência: usar da planilha se existir, senão usar dataPagamento, senão dataVencimento
      let dataCompetenciaPagar: Date | null = null;
      if (getValue('dataCompetencia')) {
        dataCompetenciaPagar = parseDate(getValue('dataCompetencia')!);
      } else if (dataPagamentoPagar) {
        dataCompetenciaPagar = dataPagamentoPagar;
      } else {
        dataCompetenciaPagar = dataVencParsed;
      }

      return {
        userId,
        descricao: descricaoPagar.toString(),
        valor: parseDecimal(valorPagar),
        dataVencimento: dataVencParsed,
        dataPagamento: dataPagamentoPagar,
        dataCompetencia: dataCompetenciaPagar,
        status: dataPagamentoPagar ? 'pago' : 'pendente',
        categoriaId: resolveCategoriaId(getValue('categoria'), refs),
        formaPagamentoId: resolveFormaId(getValue('formaPagamento'), refs),
        origem: "EXCEL",
      };

    case 'contas_receber':
      const descricaoReceber = getValue('descricao');
      const valorReceber = getValue('valor');
      const dataVencimentoReceber = getValue('dataVencimento');

      if (!descricaoReceber || !valorReceber || !dataVencimentoReceber) {
        throw new Error('Campos obrigatórios faltando: Descrição, Valor, Data de Vencimento');
      }

      const dataRecebimentoReceber = getValue('dataRecebimento') ? parseDate(getValue('dataRecebimento')!) : null;
      const dataVencReceberParsed = parseDate(dataVencimentoReceber);

      // Data de competência: usar da planilha se existir, senão usar dataRecebimento, senão dataVencimento
      let dataCompetenciaReceber: Date | null = null;
      if (getValue('dataCompetencia')) {
        dataCompetenciaReceber = parseDate(getValue('dataCompetencia')!);
      } else if (dataRecebimentoReceber) {
        dataCompetenciaReceber = dataRecebimentoReceber;
      } else {
        dataCompetenciaReceber = dataVencReceberParsed;
      }

      return {
        userId,
        descricao: descricaoReceber.toString(),
        valor: parseDecimal(valorReceber),
        dataVencimento: dataVencReceberParsed,
        dataRecebimento: dataRecebimentoReceber,
        dataCompetencia: dataCompetenciaReceber,
        status: dataRecebimentoReceber ? 'recebido' : 'pendente',
        categoriaId: resolveCategoriaId(getValue('categoria'), refs),
        formaPagamentoId: resolveFormaId(getValue('formaPagamento'), refs),
        origem: "EXCEL",
      };

    case 'categorias':
      const descricaoCategoria = getValue('descricao');
      const tipoCategoria = getValue('tipo');
      
      if (!descricaoCategoria || !tipoCategoria) {
        throw new Error('Campos obrigatórios faltando: Descrição, Tipo');
      }

      if (!['receita', 'despesa'].includes(tipoCategoria.toString().toLowerCase())) {
        throw new Error('Tipo deve ser "receita" ou "despesa"');
      }

      return {
        userId,
        nome: descricaoCategoria.toString(),
        descricao: descricaoCategoria.toString(),
        tipo: tipoCategoria.toString().toUpperCase(),
        ativo: true,
      };

    case 'formas_pagamento':
      const nomeFormaPagamento = getValue('nome');
      
      if (!nomeFormaPagamento) {
        throw new Error('Campo obrigatório faltando: Nome');
      }

      return {
        userId,
        nome: nomeFormaPagamento.toString(),
      };

    default:
      throw new Error('Tipo de dados não suportado');
  }
}

function resolveCategoriaId(val: unknown, refs?: { categoriaById: Map<string,string>; categoriaByName: Map<string,string> }) {
  if (!val) return null;
  const s = val.toString().trim();
  if (!s) return null;
  // Tenta por ID direto
  if (refs?.categoriaById?.has(s)) return s;
  // Tenta por nome/descrição (case-insensitive)
  const key = s.toLowerCase();
  const id = refs?.categoriaByName?.get(key);
  if (!id) throw new Error(`Categoria não encontrada: "${s}"`);
  return id;
}


// Robust header mapping (normaliza acentos e espaços)
function getFieldMappingNormalized(headers: string[], type: string) {
  const mapping: { [key: string]: string } = {};
  const norm = (s: string) =>
    s.toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

  headers.forEach((header, index) => {
    const h = norm(header);
    switch (type) {
      case 'contas_pagar':
      case 'contas_receber': {
        if (h.includes('descricao')) mapping['descricao'] = index.toString();
        else if (h.includes('valor')) mapping['valor'] = index.toString();
        else if (h.includes('data de vencimento') || h.includes('data_vencimento') || h === 'vencimento')
          mapping['dataVencimento'] = index.toString();
        else if (h.includes('data de pagamento') || h.includes('data_pagamento') || h === 'pagamento')
          mapping['dataPagamento'] = index.toString();
        else if (h.includes('data de recebimento') || h.includes('data_recebimento') || h === 'recebimento')
          mapping['dataRecebimento'] = index.toString();
        else if (h.includes('data de competencia') || h.includes('data_competencia') || h.includes('competencia'))
          mapping['dataCompetencia'] = index.toString();
        else if (h.includes('categoria')) mapping['categoria'] = index.toString();
        else if (h.includes('forma de pagamento') || h.includes('forma_pagamento') || h.includes('portador'))
          mapping['formaPagamento'] = index.toString();
        break;
      }
      case 'categorias': {
        if (h.includes('descricao') || h.includes('nome')) mapping['descricao'] = index.toString();
        else if (h === 'tipo') mapping['tipo'] = index.toString();
        break;
      }
      case 'formas_pagamento': {
        if (h.includes('nome') || h.includes('forma de pagamento') || h.includes('portador'))
          mapping['nome'] = index.toString();
        break;
      }
    }
  });

  return mapping;
}
function resolveFormaId(val: unknown, refs?: { formaById: Map<string,string>; formaByName: Map<string,string> }) {
  if (!val) return null;
  const s = val.toString().trim();
  if (!s) return null;
  if (refs?.formaById?.has(s)) return s;
  const key = s.toLowerCase();
  const id = refs?.formaByName?.get(key);
  if (!id) throw new Error(`Forma de pagamento não encontrada: "${s}"`);
  return id;
}

