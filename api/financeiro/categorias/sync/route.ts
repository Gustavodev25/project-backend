import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import {
  getBlingCategorias,
  getBlingContasPagar,
  getBlingContasReceber,
  refreshBlingAccountToken,
  extractCategoriasFromContas,
  getCategoriasPadrao,
  syncCategoriasIncremental,
} from "@/lib/bling";

export const runtime = "nodejs";

export async function POST(_request: Request) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const session = await tryVerifySessionToken(sessionCookie.value);
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida ou expirada" }, { status: 401 });
    }
    const userId = session.sub;

    // Buscar conta do Bling (mesmo expirada) e tentar renovar automaticamente
    const blingAccount = await prisma.blingAccount.findFirst({
      where: { userId },
      orderBy: { updated_at: "desc" },
    });
    if (!blingAccount) {
      return NextResponse.json(
        { error: "Nenhuma conta Bling conectada. Conecte sua conta primeiro." },
        { status: 404 },
      );
    }

    // Refresh se necessário (força se expirado)
    let refreshedAccount;
    try {
      const isExpired = new Date(blingAccount.expires_at) <= new Date();
      refreshedAccount = await refreshBlingAccountToken(blingAccount, isExpired);
    } catch (error: any) {
      console.error("Erro ao renovar token Bling:", error);
      if (
        error instanceof Error &&
        (error.message?.includes("invalid_token") || error.message?.includes("invalid_grant"))
      ) {
        await prisma.blingAccount.delete({ where: { id: blingAccount.id } });
        return NextResponse.json(
          {
            error: "Tokens do Bling expirados. Reconecte sua conta Bling para continuar.",
            requiresReconnection: true,
          },
          { status: 401 },
        );
      }
      throw error;
    }

    // ---------- Coleta ----------
    console.log(`[Sync] Iniciando coleta de categorias para usuário ${userId}`);
    
    let diretas: any[] = [];
    let viaPagar: any[] = [];
    let viaReceber: any[] = [];
    
    try {
      console.log(`[Sync] Buscando categorias diretas do Bling...`);
      diretas = await getBlingCategorias(refreshedAccount.access_token);
      console.log(`[Sync] Encontradas ${diretas.length} categorias diretas`);
      
      // Se não encontrou categorias diretas, tenta extrair das contas
      if (diretas.length === 0) {
        console.log(`[Sync] Nenhuma categoria direta encontrada, tentando extrair das contas...`);
        const categoriasDasContas = await extractCategoriasFromContas(refreshedAccount.access_token);
        diretas = categoriasDasContas;
        console.log(`[Sync] Extraídas ${diretas.length} categorias das contas`);
      }
    } catch (error: any) {
      console.error(`[Sync] Erro ao buscar categorias diretas:`, error);
      // Continua mesmo com erro nas categorias diretas
    }

    try {
      console.log(`[Sync] Buscando categorias via contas a pagar e receber...`);
      [viaPagar, viaReceber] = await Promise.all([
        getBlingContasPagar(refreshedAccount.access_token).catch((e) => {
          console.error(`[Sync] Erro ao buscar contas a pagar:`, e);
          return [];
        }),
        getBlingContasReceber(refreshedAccount.access_token).catch((e) => {
          console.error(`[Sync] Erro ao buscar contas a receber:`, e);
          return [];
        }),
      ]);
      console.log(`[Sync] Encontradas ${viaPagar.length} contas a pagar e ${viaReceber.length} contas a receber`);
    } catch (error: any) {
      console.error(`[Sync] Erro ao buscar contas:`, error);
      // Continua mesmo com erro nas contas
    }

    type Cat = {
      id: string;
      nome: string;
      descricao: string | null;
      tipo: string | null;
      situacao: "ativo" | "inativo";
    };

    const map = new Map<string, Cat>();

    // Aceita somente objetos que PARECEM categoria (id + nome/descricao)
    const tryAdd = (raw: any) => {
      const idRaw = raw?.id ?? raw?.idCategoria;
      const nomeRaw = raw?.nome ?? raw?.descricao ?? raw?.descricaoCategoria;
      if (idRaw == null) return;
      if (!nomeRaw || String(nomeRaw).trim() === "") return;

      const id = String(idRaw);
      const nome = String(nomeRaw).trim();
      const descricao = (raw?.descricao ?? raw?.descricaoCategoria ?? null) as string | null;

      let tipo: string | null = null;
      if (raw?.tipo) tipo = String(raw.tipo).toUpperCase(); // RECEITA/DESPESA (quando vier)

      let situacao: "ativo" | "inativo" = "ativo";
      const s = raw?.situacao ?? raw?.status;
      if (typeof s === "string") {
        const sv = s.toLowerCase();
        situacao = sv.includes("inativ") ? "inativo" : "ativo";
      } else if (typeof raw?.ativo === "boolean") {
        situacao = raw.ativo ? "ativo" : "inativo";
      }

      const prev = map.get(id);
      if (!prev) {
        map.set(id, { id, nome, descricao, tipo, situacao });
      } else {
        map.set(id, {
          id,
          nome: prev.nome?.length >= nome.length ? prev.nome : nome,
          descricao: prev.descricao ?? descricao,
          tipo: prev.tipo ?? tipo,
          situacao: prev.situacao === "inativo" || situacao === "inativo" ? "inativo" : "ativo",
        });
      }
    };

    // 1) Processar categorias diretas
    console.log(`[Sync] Processando ${diretas.length} categorias diretas...`);
    for (const c of diretas) {
      tryAdd(c);
    }

    // 2) Sincronização incremental de categorias das contas
    console.log(`[Sync] Sincronização incremental de categorias das contas...`);
    try {
      // Obter categorias existentes no banco para evitar re-busca
      const categoriasExistentes = await prisma.categoria.findMany({
        where: { userId },
        select: { blingId: true },
      });
      const idsExistentes = categoriasExistentes.map(c => String(c.blingId));
      
      console.log(`[Sync] ${idsExistentes.length} categorias já existem no banco`);
      
      const categoriasDasContas = await syncCategoriasIncremental(refreshedAccount.access_token, idsExistentes);
      console.log(`[Sync] Extraídas ${categoriasDasContas.length} novas categorias das contas`);
      
      // Adicionar categorias extraídas das contas
      for (const cat of categoriasDasContas) {
        tryAdd(cat);
      }
    } catch (error: any) {
      console.error(`[Sync] Erro na sincronização incremental:`, error);
    }

    let categoriasBling = Array.from(map.values());
    console.log(`[Sync] Total de categorias únicas coletadas: ${categoriasBling.length}`);
    
    // Se não encontrou nenhuma categoria, usar categorias padrão
    if (categoriasBling.length === 0) {
      console.log(`[Sync] Nenhuma categoria encontrada, usando categorias padrão...`);
      const categoriasPadrao = getCategoriasPadrao();
      
      // Adicionar categorias padrão ao mapa
      for (const cat of categoriasPadrao) {
        map.set(cat.id, {
          id: cat.id,
          nome: cat.nome,
          descricao: cat.descricao,
          tipo: cat.tipo,
          situacao: cat.situacao as "ativo" | "inativo",
        });
      }
      
      categoriasBling = Array.from(map.values());
      console.log(`[Sync] Adicionadas ${categoriasPadrao.length} categorias padrão`);
    }

    // ---------- Persistência ----------
    console.log(`[Sync] Iniciando persistência das categorias...`);
    
    const existentes = await prisma.categoria.findMany({
      where: { userId },
      select: { blingId: true },
    });
    const existentesSet = new Set(existentes.map((c) => String(c.blingId)));
    const atuaisSet = new Set(categoriasBling.map((c) => c.id));
    
    console.log(`[Sync] Categorias existentes no banco: ${existentes.length}`);
    console.log(`[Sync] Categorias para sincronizar: ${categoriasBling.length}`);

    let syncedCount = 0;
    let updatedCount = 0;
    let createdCount = 0;
    const errors: string[] = [];

    // Processar em lotes para melhor performance
    const batchSize = 50;
    for (let i = 0; i < categoriasBling.length; i += batchSize) {
      const batch = categoriasBling.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (cat) => {
          try {
            const blingId = cat.id;
            const isNew = !existentesSet.has(blingId);
            
            await prisma.categoria.upsert({
              where: { userId_blingId: { userId, blingId } },
              update: {
                nome: cat.nome,
                descricao: cat.descricao,
                tipo: cat.tipo,
                ativo: cat.situacao !== "inativo",
                atualizadoEm: new Date(),
              },
              create: {
                userId,
                blingId,
                nome: cat.nome,
                descricao: cat.descricao,
                tipo: cat.tipo,
                ativo: cat.situacao !== "inativo",
              },
            });
            
            if (isNew) {
              createdCount++;
            } else {
              updatedCount++;
            }
            
            syncedCount++;
          } catch (err) {
            console.error(`[Sync] Erro ao sincronizar categoria ${cat.id}:`, err);
            errors.push(`Erro ao sincronizar ${cat.nome || cat.id}`);
          }
        })
      );
    }

    // Desativar categorias que sumiram
    const paraDesativar = [...existentesSet].filter((blingId) => !atuaisSet.has(blingId));
    if (paraDesativar.length > 0) {
      console.log(`[Sync] Desativando ${paraDesativar.length} categorias que não existem mais no Bling`);
      await prisma.categoria.updateMany({
        where: { userId, blingId: { in: paraDesativar } },
        data: { ativo: false, atualizadoEm: new Date() },
      });
    }
    
    console.log(`[Sync] Sincronização concluída: ${createdCount} criadas, ${updatedCount} atualizadas, ${paraDesativar.length} desativadas`);

    return NextResponse.json({
      success: true,
      message: "Categorias sincronizadas com sucesso",
      data: {
        synced: syncedCount,
        created: createdCount,
        updated: updatedCount,
        deactivated: paraDesativar.length,
        totalColetadas: categoriasBling.length,
        errors,
        timestamp: new Date().toISOString(),
        details: {
          diretas: diretas.length,
          viaPagar: viaPagar.length,
          viaReceber: viaReceber.length,
        },
      },
    });
  } catch (error) {
    console.error("Erro ao sincronizar categorias:", error);
    return NextResponse.json(
      { error: `Erro ao sincronizar categorias: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

