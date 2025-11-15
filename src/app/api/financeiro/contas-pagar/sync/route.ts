import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import { getBlingContasPagar, getBlingContaPagarById, getBlingCategoriaById, refreshBlingAccountToken } from "@/lib/bling";
import { sendProgressToUser, closeUserConnection } from "../../sync-progress/route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let userId = "";
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
    }

    // Verificar o token JWT de sessao
    const session = await tryVerifySessionToken(sessionCookie.value);

    if (!session) {
      return NextResponse.json(
        { error: "Sessao invalida ou expirada" },
        { status: 401 },
      );
    }

    userId = session.sub;

    // Buscar conta do Bling (mesmo expirada) e tentar renovar automaticamente
    const blingAccount = await prisma.blingAccount.findFirst({
      where: { userId },
      orderBy: { updated_at: "desc" },
    });

    if (!blingAccount) {
      return NextResponse.json(
        {
          error: "Nenhuma conta Bling conectada. Conecte sua conta primeiro.",
        },
        { status: 404 },
      );
    }

    // Renovar token se necessário (força se expirado)
    let refreshedAccount;
    try {
      const isExpired = new Date(blingAccount.expires_at) <= new Date();
      refreshedAccount = await refreshBlingAccountToken(blingAccount, isExpired);
    } catch (error: unknown) {
      console.error("Erro ao renovar token Bling:", error);
      if (
        error instanceof Error &&
        (error.message?.includes("invalid_token") ||
          error.message?.includes("invalid_grant"))
      ) {
        await prisma.blingAccount.delete({ where: { id: blingAccount.id } });
        return NextResponse.json(
          {
            error:
              "Tokens do Bling expirados. Reconecte sua conta Bling para continuar.",
            requiresReconnection: true,
          },
          { status: 401 },
        );
      }
      // Rate limit do Bling: retorne erro amigável e evite 500
      if (error instanceof Error && (error.message?.includes("429") || error.message?.includes("rate") )) {
        return NextResponse.json(
          {
            error: "Limite de requisições do Bling atingido. Tente novamente em alguns segundos.",
          },
          { status: 429 },
        );
      }
      throw error;
    }

    // Helpers de parsing
    const parseMoney = (v: any): number => {
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const n = parseFloat(v.replace?.(".", "").replace?.(",", ".") || v);
        return isNaN(n) ? 0 : n;
      }
      return 0;
    };
    const parseDate = (v: any): Date | null => {
      if (!v) return null;
      try {
        if (typeof v === "number") return new Date(v);
        const d = new Date(String(v));
        return isNaN(d.getTime()) ? null : d;
      } catch {
        return null;
      }
    };
    const normalizeName = (s: string): string =>
      s
        ?.toString()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    // Helpers simples + fila controlada para detalhes (evita 429)
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let activeDetail = 0;
    // Aumenta concorrência controlada para acelerar sem estourar rate limit
    const maxConcurrentDetail = 8; // Otimizado para maior velocidade
    const fetchDetalheContaPagarCategoriaId = async (id: number): Promise<{ catId: string | null; competencia: Date | null; historico?: string | null } | null> => {
      while (activeDetail >= maxConcurrentDetail) {
        await sleep(50);
      }
      activeDetail++;
      try {
        console.log(`[Sync CP] Buscando detalhe da conta para categoria. ID=${id}`);
        const conta = await getBlingContaPagarById(refreshedAccount.access_token, id);
        const catId = conta?.categoria?.id ? String(conta.categoria.id) : null;
        if (catId) {
          console.log(`[Sync CP] Categoria pelo detalhe: conta ${id} -> catBlingId=${catId}`);
        }
        const competencia = parseDate((conta as any)?.competencia || (conta as any)?.dataCompetencia || null);
        const historico = (conta as any)?.historico || (conta as any)?.observacao || null;
        return { catId, competencia, historico };
      } catch (e) {
        console.error(`[Sync CP] Erro no detalhe da conta ${id}:`, e);
        return null;
      } finally {
        activeDetail--;
        // Pausa breve entre chamadas de detalhe (otimizado para velocidade)
        await sleep(80);
      }
    };

    // Enviar progresso inicial
    sendProgressToUser(userId, {
      type: "sync_start",
      title: "Sincronizando Contas a Pagar",
      message: "Iniciando sincronização com o Bling...",
      progressValue: 0,
      progressMax: 100,
      progressLabel: "Preparando sincronização"
    });

    // Buscar dados do Bling
    sendProgressToUser(userId, {
      type: "sync_progress",
      title: "Sincronizando Contas a Pagar",
      message: "Buscando dados do Bling...",
      progressValue: 10,
      progressMax: 100,
      progressLabel: "Buscando contas a pagar"
    });

    const contasBling: any[] = await getBlingContasPagar(
      refreshedAccount.access_token,
      userId,
    );
    
    // Debug: verificar estrutura das primeiras contas
    if (contasBling.length > 0) {
      console.log(`[Sync CP] 📊 Total de contas a pagar encontradas: ${contasBling.length}`);
      console.log(`[Sync CP] 📋 Estrutura da primeira conta a pagar:`, contasBling[0]);
      console.log(`[Sync CP] 🏷️ Categoria da primeira conta:`, contasBling[0]?.categoria);
      console.log(`[Sync CP] 🔑 Todos os campos da primeira conta:`, Object.keys(contasBling[0]));
      
      // Verificar se há algum campo relacionado a categoria
      const firstConta = contasBling[0];
      const categoriaFields = Object.keys(firstConta).filter(key => 
        key.toLowerCase().includes('categoria') || 
        key.toLowerCase().includes('category')
      );
      console.log(`[Sync CP] 🎯 Campos relacionados a categoria:`, categoriaFields);
      
      // Mostrar valores dos campos de categoria
      categoriaFields.forEach(field => {
        console.log(`[Sync CP] 📝 ${field}:`, firstConta[field]);
      });
      
      // Verificar campos que podem conter IDs
      const idFields = Object.keys(firstConta).filter(key => 
        key.toLowerCase().includes('id') && 
        firstConta[key] != null
      );
      console.log(`[Sync CP] 🆔 Campos com ID:`, idFields.map(field => `${field}=${firstConta[field]}`));
    }
    
    // Tentar obter o dicionário de categorias (id -> nome)
    sendProgressToUser(userId, {
      type: "sync_progress",
      title: "Sincronizando Contas a Pagar",
      message: "Carregando categorias...",
      progressValue: 20,
      progressMax: 100,
      progressLabel: "Carregando categorias"
    });

    const categoriasMap = new Map<string, string>();
    try {
      const categorias = await (await import("@/lib/bling")).getBlingCategorias(
        refreshedAccount.access_token,
      );
      console.log(`[Sync CP] Categorias do Bling encontradas: ${categorias?.length || 0}`);
      
      for (const c of categorias || []) {
        const cid = (c?.id ?? c?.idCategoria ?? c?.codigo)?.toString?.();
        const cname = c?.nome ?? c?.descricao;
        if (cid && cname) {
          categoriasMap.set(cid, String(cname));
          console.log(`[Sync CP] Categoria mapeada: ${cid} -> ${cname}`);
        }
      }
      
      console.log(`[Sync CP] Total de categorias mapeadas: ${categoriasMap.size}`);
    } catch (error) {
      console.error(`[Sync CP] Erro ao buscar categorias do Bling:`, error);
    }

    // Prefetch categorias e formas de pagamento existentes
    const catByBlingId = new Map<string, string>(); // blingId -> categoria.id
    const catByNormName = new Map<string, string>(); // nome normalizado -> categoria.id
    const fpByBlingId = new Map<string, string>(); // blingId -> formaPagamento.id
    const fpByNormName = new Map<string, string>(); // nome normalizado -> formaPagamento.id
    const catDetailCache = new Map<string, string | null>(); // blingId -> categoria.id (local nesta execução)
    try {
      const [cats, fps] = await Promise.all([
        prisma.categoria.findMany({ where: { userId }, select: { id: true, blingId: true, nome: true } }),
        prisma.formaPagamento.findMany({ where: { userId }, select: { id: true, blingId: true, nome: true } }),
      ]);
      console.log(`[Sync CP] Categorias existentes no banco: ${cats.length}`);
      console.log(`[Sync CP] Formas de pagamento existentes: ${fps.length}`);
      
      for (const c of cats) {
        if (c.blingId) catByBlingId.set(String(c.blingId), c.id);
        if (c.nome) {
          const n = normalizeName(String(c.nome));
          if (n) catByNormName.set(n, c.id);
        }
      }
      for (const f of fps) {
        if (f.blingId) fpByBlingId.set(String(f.blingId), f.id);
        if ((f as any).nome) {
          const n = normalizeName(String((f as any).nome));
          if (n) fpByNormName.set(n, f.id);
        }
      }
      
      console.log(`[Sync CP] Cache de categorias por blingId: ${catByBlingId.size} itens`);
      console.log(`[Sync CP] Cache de categorias por nome: ${catByNormName.size} itens`);
    } catch (error) {
      console.error(`[Sync CP] Erro ao carregar categorias existentes:`, error);
    }

    let synced = 0;
    const errors: string[] = [];
    const totalContas = contasBling.length;

    sendProgressToUser(userId, {
      type: "sync_progress",
      title: "Sincronizando Contas a Pagar",
      message: `Processando ${totalContas} contas a pagar...`,
      progressValue: 30,
      progressMax: 100,
      progressLabel: `Processando ${totalContas} contas`
    });

    // Processar em lotes concorrentes para acelerar
    // Aumenta tamanho do lote de processamento principal (controle via backoff no blingFetchJSON)
    const batchSize = 25; // Otimizado para maior velocidade
    for (let start = 0; start < contasBling.length; start += batchSize) {
      const end = Math.min(start + batchSize, contasBling.length);
      const batch = contasBling.slice(start, end);

      const progressValue = 30 + Math.floor((start / contasBling.length) * 60);
      sendProgressToUser(userId, {
        type: "sync_progress",
        title: "Sincronizando Contas a Pagar",
        message: `Processando ${end} de ${totalContas}...`,
        progressValue,
        progressMax: 100,
        progressLabel: `${end} de ${totalContas} contas processadas`
      });

      await Promise.all(batch.map(async (item) => {
        try {
          const blingId =
            item?.id?.toString?.() ||
            item?.numero?.toString?.() ||
            item?.codigo?.toString?.();
          if (!blingId) return;

        const descricao =
          item?.descricao || item?.historico || item?.observacao || "Despesa";
        const valor = parseMoney(
          item?.valor || item?.valorOriginal || item?.total || item?.valor_titulo,
        );
        const dataVencimento =
          parseDate(item?.dataVencimento || item?.data || item?.vencimento) ||
          new Date();
        const dataPagamento = parseDate(
          item?.dataPagamento || item?.dataLiquidacao || item?.pagamento,
        );
        let competenciaFromDetail: Date | null = null;

        // Data de competência (quando disponível no Bling) com fallback para vencimento
        const dataCompetencia =
          parseDate(
            (item as any)?.dataCompetencia ||
            (item as any)?.competencia ||
            (item as any)?.competenceDate ||
            (item as any)?.competenciaData ||
            (item as any)?.competencia_inicio ||
            (item as any)?.competenciaInicio
           );

        // Tentar extrair categoria diretamente (múltiplas variações da API)
        let categoriaBlingId =
          item?.categoria?.id?.toString?.() ||
          item?.categoria?.idCategoria?.toString?.() ||
          item?.categoriaId?.toString?.() ||
          item?.categoria_id?.toString?.() ||
          item?.idCategoria?.toString?.() ||
          item?.categoria?.codigo?.toString?.() ||
          item?.categoriaCodigo?.toString?.() ||
          item?.codigoCategoria?.toString?.();

        // Debug: log quando categoria não é encontrada diretamente
        if (!categoriaBlingId && item?.id) {
          console.log(`[Sync CP] Conta ${item.id} sem categoria direta. Estrutura:`, {
            categoria: item?.categoria,
            categoriaId: item?.categoriaId,
            categoria_id: item?.categoria_id,
            idCategoria: item?.idCategoria
          });
        }

        // Se não encontrou categoria, buscar individualmente (sempre tentar para as primeiras contas)
          // Tentar resolver já via fila com throttle antes de cair no bloco antigo
          if (!categoriaBlingId && item?.id) {
            const _resolvedByQueue = await fetchDetalheContaPagarCategoriaId(Number(item.id));
            if (_resolvedByQueue) {
              categoriaBlingId = _resolvedByQueue.catId || categoriaBlingId;
              competenciaFromDetail = _resolvedByQueue.competencia || competenciaFromDetail;
            }
          }

          // Limitar buscas individuais para evitar rate-limit do Bling (desativado; usamos fila acima)
          const detailLimit = 0;
          const currentDetailCount = (globalThis as any).__cz_cp_detailCount__ || 0;
          
          if (!categoriaBlingId && item?.id && currentDetailCount < detailLimit) {
            (globalThis as any).__cz_cp_detailCount__ = currentDetailCount + 1;
            console.log(`[Sync CP] 🔍 Buscando conta individual ${item.id} (${currentDetailCount + 1}/${detailLimit})`);
            
            try {
              console.log(`[Sync CP] Chamando getBlingContaPagarById para conta ${item.id}...`);
              const contaIndividual = await getBlingContaPagarById(refreshedAccount.access_token, item.id);
              console.log(`[Sync CP] 📋 Resposta da busca individual para conta ${item.id}:`, contaIndividual);
              
              if (contaIndividual?.categoria?.id) {
                categoriaBlingId = contaIndividual.categoria.id.toString();
                console.log(`[Sync CP] ✅ Categoria encontrada via busca individual para conta ${item.id}: ${categoriaBlingId}`);
              } else if (contaIndividual) {
                console.log(`[Sync CP] ❌ Conta encontrada mas sem categoria para ${item.id}`);
                console.log(`[Sync CP] Estrutura da conta individual:`, Object.keys(contaIndividual));
              } else {
                console.log(`[Sync CP] ❌ Conta individual não encontrada para ${item.id}`);
              }
            } catch (error) {
              console.error(`[Sync CP] 💥 Erro na busca individual para conta ${item.id}:`, error);
            }
          } else if (!categoriaBlingId && item?.id) {
            console.log(`[Sync CP] ⚠️ Limite de buscas individuais atingido (${currentDetailCount}/${detailLimit}) para conta ${item.id}`);
          }

        // Detectar forma de pagamento
        const formaBlingId =
          item?.formaPagamento?.id?.toString?.() ||
          item?.formaPagamentoId?.toString?.() ||
          item?.idFormaPagamento?.toString?.() ||
          item?.forma_pagamento_id?.toString?.();

          // Resolver categoria usando caches (sem múltiplas consultas)
          let categoriaId: string | null = null;
          let catNomeRaw = "";
          
          // 1) Tentar por blingId direto
          if (categoriaBlingId) {
            categoriaId = catByBlingId.get(categoriaBlingId) || null;
            if (!categoriaId) {
              // Se temos o blingId, tente obter o nome pelo mapa de categorias do Bling
              catNomeRaw = (categoriasMap.get(categoriaBlingId) || 
                String(
                  item?.categoria?.descricao ||
                  item?.categoria?.nome ||
                  item?.categoriaDescricao ||
                  ""
                ).trim()) as string;
            }
          }

          // 2) Se não achou por blingId ou não havia blingId, tente por nome presente no item
          if (!categoriaBlingId) {
            catNomeRaw = String(
              item?.categoria?.descricao ||
              item?.categoria?.nome ||
              item?.categoriaDescricao ||
              ""
            ).trim();
          }

          if (!categoriaId && catNomeRaw) {
            const keyName = normalizeName(catNomeRaw);
            categoriaId = (keyName ? catByNormName.get(keyName) : null) || null;
            if (!categoriaId) {
              try {
                console.log(
                  `[Sync CP] Criando categoria: blingId=${categoriaBlingId || "(sem_blingId)"}, nome=${catNomeRaw}`,
                );
                const created = await prisma.categoria.create({
                  data: {
                    userId,
                    blingId: categoriaBlingId || null,
                    nome: catNomeRaw,
                    descricao: catNomeRaw,
                    ativo: true,
                  },
                  select: { id: true },
                });
                categoriaId = created.id;
                if (keyName) catByNormName.set(keyName, categoriaId);
                if (categoriaBlingId) {
                  catByBlingId.set(categoriaBlingId, categoriaId);
                }
                console.log(`[Sync CP] Categoria criada com sucesso: id=${categoriaId}`);
              } catch (error) {
                console.error(`[Sync CP] Erro ao criar categoria:`, error);
              }
            }
          }

          // Fallback final: se temos categoriaBlingId mas ainda não resolvemos categoriaId,
          // buscar categoria detalhada no Bling e upsert no banco
          if (!categoriaId && categoriaBlingId) {
            const blingIdStr = String(categoriaBlingId);
            const cached = catDetailCache.get(blingIdStr);
            if (typeof cached === 'string') {
              categoriaId = cached;
            } else if (cached === null) {
              // já tentado e falhou
            } else {
              // tentar com pequenas tentativas progressivas (mitigar 429)
              let catDetail: any = null;
              for (let attempt = 0; attempt < 3 && !catDetail; attempt++) {
                try {
                  catDetail = await getBlingCategoriaById(refreshedAccount.access_token, Number(blingIdStr));
                  if (!catDetail) {
                    await sleep(400 * (attempt + 1));
                  }
                } catch (e) {
                  await sleep(400 * (attempt + 1));
                }
              }
              if (catDetail) {
                const nomeCat = String(catDetail.nome || catDetail.descricao || "Categoria");
                const up = await prisma.categoria.upsert({
                  where: { userId_blingId: { userId, blingId: blingIdStr } },
                  update: { nome: nomeCat, descricao: catDetail.descricao || null, ativo: (catDetail.situacao || "ativo") !== "inativo", atualizadoEm: new Date() },
                  create: { userId, blingId: blingIdStr, nome: nomeCat, descricao: catDetail.descricao || null, ativo: (catDetail.situacao || "ativo") !== "inativo" },
                  select: { id: true }
                });
                categoriaId = up.id;
                catByBlingId.set(blingIdStr, categoriaId);
                const n = normalizeName(nomeCat);
                if (n) catByNormName.set(n, categoriaId);
                catDetailCache.set(blingIdStr, categoriaId);
                console.log(`[Sync CP] Categoria resolvida via getBlingCategoriaById: id=${categoriaId}, blingId=${blingIdStr}`);
              } else {
                catDetailCache.set(blingIdStr, null);
              }
            }
          }

          let formaPagamentoId: string | null = null;
          if (formaBlingId) {
            formaPagamentoId = fpByBlingId.get(formaBlingId) || null;
          } else if (item?.formaPagamento?.nome) {
            const n = normalizeName(String(item.formaPagamento.nome));
            if (n) formaPagamentoId = fpByNormName.get(n) || null;
          }

        const baseStatus = (item?.situacao || item?.status || "")
          .toString()
          .toLowerCase();
        let status: string = baseStatus.includes("pago") ? "pago" : "pendente";
        if (status !== "pago" && dataPagamento) status = "pago";
        if (
          status !== "pago" &&
          dataVencimento &&
          dataVencimento.getTime() < Date.now()
        )
          status = "vencido";

        // Resolver data de competência final (detalhe > lista > vencimento)
        const competenciaFinal =
          competenciaFromDetail ||
          parseDate(
            (item as any)?.dataCompetencia ||
            (item as any)?.competencia ||
            (item as any)?.competenceDate ||
            (item as any)?.competenciaData ||
            (item as any)?.competencia_inicio ||
            (item as any)?.competenciaInicio
           );

        console.log(`[Sync CP] Salvando conta ${blingId}: categoriaId=${categoriaId}, categoriaBlingId=${categoriaBlingId}`);

        const updateData: any = {
          descricao,
          valor,
          dataVencimento,
          dataPagamento,
          status,
          categoriaId,
          formaPagamentoId,
          origem: "SINCRONIZACAO",
          atualizadoEm: new Date(),
        };
        const createData: any = {
          userId,
          blingId,
          descricao,
          valor,
          dataVencimento,
          dataPagamento,
          status,
          categoriaId,
          formaPagamentoId,
          origem: "SINCRONIZACAO",
        };
        // histórico vindo do item da listagem ou do detalhe (se disponível)
        const historicoStr: string | null = (item as any)?.historico || (item as any)?.observacao || null;
        if (historicoStr) {
          updateData.historico = historicoStr;
          createData.historico = historicoStr;
        }
        // se não tiver em listagem, tentar do detalhe resolvido
        if (!historicoStr && item?.id) {
          try {
            const _resolved = await fetchDetalheContaPagarCategoriaId(Number(item.id));
            if (_resolved?.historico) {
              updateData.historico = _resolved.historico;
              createData.historico = _resolved.historico;
            }
          } catch {}
        }
        if (competenciaFinal) {
          updateData.dataCompetencia = competenciaFinal;
          createData.dataCompetencia = competenciaFinal;
        }

        // Ajuste: garantir competência vinda do detalhe quando não presente na listagem (apenas Contas a Pagar)
        if (!((item as any)?.dataCompetencia || (item as any)?.competencia || (item as any)?.competenceDate || (item as any)?.competenciaData || (item as any)?.competencia_inicio || (item as any)?.competenciaInicio)) {
          try {
            if (!competenciaFromDetail && item?.id) {
              const _resolvedByQueue2 = await fetchDetalheContaPagarCategoriaId(Number(item.id));
              if (_resolvedByQueue2?.competencia) {
                updateData.dataCompetencia = _resolvedByQueue2.competencia;
                createData.dataCompetencia = _resolvedByQueue2.competencia;
              }
            }
          } catch {}
        }

        try {
          await prisma.contaPagar.upsert({
            where: { userId_blingId: { userId, blingId } },
            update: updateData,
            create: createData,
          });
        } catch (err: any) {
          const msg = String(err?.message || err);
          const code = String((err && (err as any).code) || "");
          if (
            msg.includes('Unknown argument `dataCompetencia`') ||
            msg.toLowerCase().includes('data_competencia') ||
            code === 'P2022'
          ) {
            delete updateData.dataCompetencia;
            delete createData.dataCompetencia;
            // tentar novamente sem dataCompetencia
            await prisma.contaPagar.upsert({
              where: { userId_blingId: { userId, blingId } },
              update: updateData,
              create: createData,
            });
          } else if (msg.includes('Unknown argument `historico`') || msg.toLowerCase().includes('historico') || code === 'P2022') {
            // remover historico se coluna não existir
            delete updateData.historico;
            delete createData.historico;
            await prisma.contaPagar.upsert({
              where: { userId_blingId: { userId, blingId } },
              update: updateData,
              create: createData,
            });
          } else {
            throw err;
          }
        }
          synced++;
        } catch (e) {
          console.error("Falha ao sincronizar conta a pagar:", e);
          errors.push(
            typeof item?.id !== "undefined"
              ? `ID ${item.id}: ${e}`
              : `Registro sem ID: ${e}`,
          );
        }
      }));
    }

    // Enviar progresso final
    sendProgressToUser(userId, {
      type: "sync_complete",
      title: "✅ Sincronização Concluída",
      message: `${synced} contas a pagar sincronizadas com sucesso!`,
      progressValue: 100,
      progressMax: 100,
      progressLabel: "Sincronização concluída"
    });

    // Fechar conexão após um delay
    setTimeout(() => {
      closeUserConnection(userId);
    }, 3000);

    return NextResponse.json({
      success: true,
      message: "Contas a pagar sincronizadas com sucesso",
      data: {
        synced,
        total: contasBling.length,
        errors,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Erro ao sincronizar contas a pagar:", error);
    
    // Enviar erro via SSE
    if (userId) {
      sendProgressToUser(userId, {
        type: "sync_error",
        title: "❌ Erro na Sincronização",
        message: `Erro ao sincronizar contas a pagar: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
        progressValue: 0,
        progressMax: 100,
        progressLabel: "Erro na sincronização"
      });
      // Fechar conexão após erro
      setTimeout(() => {
        closeUserConnection(userId);
      }, 5000);
    }

    return NextResponse.json(
      { error: "Erro ao sincronizar contas a pagar" },
      { status: 500 },
    );
  }
}

