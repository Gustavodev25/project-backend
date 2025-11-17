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
} from "@/lib/bling";

export const runtime = "nodejs";

export async function GET(_request: Request) {
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

    const blingAccount = await prisma.blingAccount.findFirst({
      where: { userId, expires_at: { gt: new Date() } },
    });
    if (!blingAccount) {
      return NextResponse.json(
        { error: "Nenhuma conta Bling ativa encontrada. Conecte sua conta primeiro." },
        { status: 404 },
      );
    }

    // Refresh se necessário
    let refreshedAccount;
    try {
      refreshedAccount = await refreshBlingAccountToken(blingAccount);
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

    // Testar cada endpoint individualmente
    const results: any = {
      timestamp: new Date().toISOString(),
      userId,
      blingAccountId: refreshedAccount.id,
      tests: {},
    };

    // Teste 1: Categorias de anúncios
    try {
      console.log("[Debug] Testando categorias de anúncios...");
      const categorias = await getBlingCategorias(refreshedAccount.access_token);
      results.tests.categoriasAnuncios = {
        success: true,
        count: categorias.length,
        data: categorias.slice(0, 5), // Primeiras 5 para debug
        sample: categorias[0] || null,
        envConfig: {
          tipoIntegracao: process.env.BLING_TIPO_INTEGRACAO || "não configurado",
          idLoja: process.env.BLING_ID_LOJA || "não configurado",
        },
      };
    } catch (error: any) {
      results.tests.categoriasAnuncios = {
        success: false,
        error: error.message,
        count: 0,
        envConfig: {
          tipoIntegracao: process.env.BLING_TIPO_INTEGRACAO || "não configurado",
          idLoja: process.env.BLING_ID_LOJA || "não configurado",
        },
      };
    }

    // Teste 2: Contas a pagar
    try {
      console.log("[Debug] Testando contas a pagar...");
      const contasPagar = await getBlingContasPagar(refreshedAccount.access_token);
      
      // Analisar estrutura das contas para encontrar categorias
      const contasComCategoria = contasPagar.filter(c => c?.categoria);
      const categoriasPagar = contasComCategoria.map(c => c.categoria);
      
      // Verificar diferentes campos que podem conter categoria
      const contasComCategoriaField = contasPagar.filter(c => c?.categoria);
      const contasComCategoriaId = contasPagar.filter(c => c?.categoriaId);
      const contasComIdCategoria = contasPagar.filter(c => c?.idCategoria);
      
      results.tests.contasPagar = {
        success: true,
        count: contasPagar.length,
        contasComCategoria: contasComCategoria.length,
        contasComCategoriaId: contasComCategoriaId.length,
        contasComIdCategoria: contasComIdCategoria.length,
        categoriasCount: categoriasPagar.length,
        data: contasPagar.slice(0, 3), // Primeiras 3 para debug
        categorias: categoriasPagar.slice(0, 3),
        sampleConta: contasPagar[0] || null, // Estrutura completa de uma conta
      };
    } catch (error: any) {
      results.tests.contasPagar = {
        success: false,
        error: error.message,
        count: 0,
      };
    }

    // Teste 3: Contas a receber
    try {
      console.log("[Debug] Testando contas a receber...");
      const contasReceber = await getBlingContasReceber(refreshedAccount.access_token);
      
      // Analisar estrutura das contas para encontrar categorias
      const contasComCategoria = contasReceber.filter(c => c?.categoria);
      const categoriasReceber = contasComCategoria.map(c => c.categoria);
      
      // Verificar diferentes campos que podem conter categoria
      const contasComCategoriaField = contasReceber.filter(c => c?.categoria);
      const contasComCategoriaId = contasReceber.filter(c => c?.categoriaId);
      const contasComIdCategoria = contasReceber.filter(c => c?.idCategoria);
      
      results.tests.contasReceber = {
        success: true,
        count: contasReceber.length,
        contasComCategoria: contasComCategoria.length,
        contasComCategoriaId: contasComCategoriaId.length,
        contasComIdCategoria: contasComIdCategoria.length,
        categoriasCount: categoriasReceber.length,
        data: contasReceber.slice(0, 3), // Primeiras 3 para debug
        categorias: categoriasReceber.slice(0, 3),
        sampleConta: contasReceber[0] || null, // Estrutura completa de uma conta
      };
    } catch (error: any) {
      results.tests.contasReceber = {
        success: false,
        error: error.message,
        count: 0,
      };
    }

    // Teste 4: Extração de categorias das contas
    try {
      console.log("[Debug] Testando extração de categorias das contas...");
      const categoriasDasContas = await extractCategoriasFromContas(refreshedAccount.access_token);
      
      results.tests.extracaoDasContas = {
        success: true,
        count: categoriasDasContas.length,
        data: categoriasDasContas.slice(0, 5), // Primeiras 5 para debug
        sample: categoriasDasContas[0] || null,
      };
    } catch (error: any) {
      results.tests.extracaoDasContas = {
        success: false,
        error: error.message,
        count: 0,
      };
    }

    // Teste 5: Categorias existentes no banco
    try {
      const categoriasExistentes = await prisma.categoria.findMany({
        where: { userId },
        select: {
          id: true,
          blingId: true,
          nome: true,
          tipo: true,
          ativo: true,
          atualizadoEm: true,
        },
        orderBy: { atualizadoEm: 'desc' },
        take: 10,
      });

      results.tests.categoriasExistentes = {
        success: true,
        count: categoriasExistentes.length,
        data: categoriasExistentes,
      };
    } catch (error: any) {
      results.tests.categoriasExistentes = {
        success: false,
        error: error.message,
        count: 0,
      };
    }

    return NextResponse.json({
      success: true,
      message: "Debug de categorias Bling concluído",
      data: results,
    });

  } catch (error) {
    console.error("Erro no debug de categorias:", error);
    return NextResponse.json(
      { error: `Erro no debug: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
