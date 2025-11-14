import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import {
  extractCategoriasFromContas,
  getBlingContaPagarById,
  getBlingContaReceberById,
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
      tests: {},
    };

    // Teste 1: Buscar algumas contas individuais para ver se têm categoria
    try {
      console.log("[Debug] Testando busca de contas individuais...");
      
      // Buscar primeira conta a pagar individual
      const contasPagar = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/financeiro/contas-pagar`, {
        headers: {
          'Cookie': `session=${sessionCookie.value}`
        }
      }).then(r => r.json()).catch(() => ({ data: [] }));
      
      if (contasPagar.data && contasPagar.data.length > 0) {
        const primeiraContaPagar = contasPagar.data[0];
        const contaDetalhadaPagar = await getBlingContaPagarById(refreshedAccount.access_token, primeiraContaPagar.id);
        
        results.tests.contaPagarIndividual = {
          success: true,
          contaLista: primeiraContaPagar,
          contaDetalhada: contaDetalhadaPagar,
          temCategoria: !!contaDetalhadaPagar?.categoria?.id,
          categoriaId: contaDetalhadaPagar?.categoria?.id || null,
        };
      } else {
        results.tests.contaPagarIndividual = {
          success: false,
          message: "Nenhuma conta a pagar encontrada",
        };
      }
    } catch (error: any) {
      results.tests.contaPagarIndividual = {
        success: false,
        error: error.message,
      };
    }

    // Teste 2: Buscar algumas contas a receber individuais
    try {
      console.log("[Debug] Testando busca de contas a receber individuais...");
      
      const contasReceber = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/financeiro/contas-receber`, {
        headers: {
          'Cookie': `session=${sessionCookie.value}`
        }
      }).then(r => r.json()).catch(() => ({ data: [] }));
      
      if (contasReceber.data && contasReceber.data.length > 0) {
        const primeiraContaReceber = contasReceber.data[0];
        const contaDetalhadaReceber = await getBlingContaReceberById(refreshedAccount.access_token, primeiraContaReceber.id);
        
        results.tests.contaReceberIndividual = {
          success: true,
          contaLista: primeiraContaReceber,
          contaDetalhada: contaDetalhadaReceber,
          temCategoria: !!contaDetalhadaReceber?.categoria?.id,
          categoriaId: contaDetalhadaReceber?.categoria?.id || null,
        };
      } else {
        results.tests.contaReceberIndividual = {
          success: false,
          message: "Nenhuma conta a receber encontrada",
        };
      }
    } catch (error: any) {
      results.tests.contaReceberIndividual = {
        success: false,
        error: error.message,
      };
    }

    // Teste 3: Extração completa de categorias
    try {
      console.log("[Debug] Testando extração completa de categorias...");
      const startTime = Date.now();
      
      const categorias = await extractCategoriasFromContas(refreshedAccount.access_token);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      results.tests.extracaoCompleta = {
        success: true,
        count: categorias.length,
        duration: `${duration}ms`,
        data: categorias.slice(0, 5), // Primeiras 5 para debug
        receitas: categorias.filter(c => c.tipo === "RECEITA").length,
        despesas: categorias.filter(c => c.tipo === "DESPESA").length,
      };
    } catch (error: any) {
      results.tests.extracaoCompleta = {
        success: false,
        error: error.message,
      };
    }

    return NextResponse.json({
      success: true,
      message: "Teste de categorias individuais concluído",
      data: results,
    });

  } catch (error) {
    console.error("Erro no teste de categorias individuais:", error);
    return NextResponse.json(
      { error: `Erro no teste: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

