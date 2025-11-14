import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import {
  getBlingContasPagar,
  getBlingContasReceber,
  refreshBlingAccountToken,
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

    const results: any = {
      timestamp: new Date().toISOString(),
      userId,
      blingAccountId: refreshedAccount.id,
      analysis: {},
    };

    // Analisar estrutura das contas a pagar
    try {
      console.log("[Debug] Analisando estrutura das contas a pagar...");
      const contasPagar = await getBlingContasPagar(refreshedAccount.access_token);
      
      if (contasPagar.length > 0) {
        const primeiraConta = contasPagar[0];
        const camposComCategoria = Object.keys(primeiraConta).filter(key => 
          key.toLowerCase().includes('categoria') || 
          key.toLowerCase().includes('category')
        );
        
        const contasComCategoria = contasPagar.filter(c => c?.categoria);
        const contasComCategoriaId = contasPagar.filter(c => c?.categoriaId);
        const contasComIdCategoria = contasPagar.filter(c => c?.idCategoria);
        
        results.analysis.contasPagar = {
          total: contasPagar.length,
          camposComCategoria,
          contasComCategoria: contasPagar.filter(c => c?.categoria).length,
          contasComCategoriaId: contasPagar.filter(c => c?.categoriaId).length,
          contasComIdCategoria: contasPagar.filter(c => c?.idCategoria).length,
          estruturaPrimeiraConta: primeiraConta,
          camposDisponiveis: Object.keys(primeiraConta),
          amostras: contasPagar.slice(0, 3),
        };
      } else {
        results.analysis.contasPagar = {
          total: 0,
          message: "Nenhuma conta a pagar encontrada",
        };
      }
    } catch (error: any) {
      results.analysis.contasPagar = {
        error: error.message,
      };
    }

    // Analisar estrutura das contas a receber
    try {
      console.log("[Debug] Analisando estrutura das contas a receber...");
      const contasReceber = await getBlingContasReceber(refreshedAccount.access_token);
      
      if (contasReceber.length > 0) {
        const primeiraConta = contasReceber[0];
        const camposComCategoria = Object.keys(primeiraConta).filter(key => 
          key.toLowerCase().includes('categoria') || 
          key.toLowerCase().includes('category')
        );
        
        const contasComCategoria = contasReceber.filter(c => c?.categoria);
        const contasComCategoriaId = contasReceber.filter(c => c?.categoriaId);
        const contasComIdCategoria = contasReceber.filter(c => c?.idCategoria);
        
        results.analysis.contasReceber = {
          total: contasReceber.length,
          camposComCategoria,
          contasComCategoria: contasReceber.filter(c => c?.categoria).length,
          contasComCategoriaId: contasReceber.filter(c => c?.categoriaId).length,
          contasComIdCategoria: contasReceber.filter(c => c?.idCategoria).length,
          estruturaPrimeiraConta: primeiraConta,
          camposDisponiveis: Object.keys(primeiraConta),
          amostras: contasReceber.slice(0, 3),
        };
      } else {
        results.analysis.contasReceber = {
          total: 0,
          message: "Nenhuma conta a receber encontrada",
        };
      }
    } catch (error: any) {
      results.analysis.contasReceber = {
        error: error.message,
      };
    }

    return NextResponse.json({
      success: true,
      message: "Análise de estrutura das contas concluída",
      data: results,
    });

  } catch (error) {
    console.error("Erro na análise de estrutura:", error);
    return NextResponse.json(
      { error: `Erro na análise: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

