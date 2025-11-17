import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import {
  getBlingContasPagar,
  getBlingContaPagarById,
  getBlingContasReceber,
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

    // Teste 1: Verificar contas a pagar da lista vs individual
    try {
      console.log("[Debug] Testando contas a pagar...");
      
      const contasPagar = await getBlingContasPagar(refreshedAccount.access_token);
      const primeiraConta = contasPagar[0];
      
      if (primeiraConta) {
        console.log("[Debug] Primeira conta da lista:", primeiraConta);
        
        const contaIndividual = await getBlingContaPagarById(refreshedAccount.access_token, primeiraConta.id);
        console.log("[Debug] Conta individual:", contaIndividual);
        
        results.tests.contasPagar = {
          success: true,
          contaLista: {
            id: primeiraConta.id,
            temCategoria: !!primeiraConta.categoria,
            categoria: primeiraConta.categoria,
          },
          contaIndividual: {
            id: contaIndividual?.id,
            temCategoria: !!contaIndividual?.categoria,
            categoria: contaIndividual?.categoria,
          },
        };
      } else {
        results.tests.contasPagar = {
          success: false,
          message: "Nenhuma conta a pagar encontrada",
        };
      }
    } catch (error: any) {
      results.tests.contasPagar = {
        success: false,
        error: error.message,
      };
    }

    // Teste 2: Verificar contas a receber da lista vs individual
    try {
      console.log("[Debug] Testando contas a receber...");
      
      const contasReceber = await getBlingContasReceber(refreshedAccount.access_token);
      const primeiraConta = contasReceber[0];
      
      if (primeiraConta) {
        console.log("[Debug] Primeira conta da lista:", primeiraConta);
        
        const contaIndividual = await getBlingContaReceberById(refreshedAccount.access_token, primeiraConta.id);
        console.log("[Debug] Conta individual:", contaIndividual);
        
        results.tests.contasReceber = {
          success: true,
          contaLista: {
            id: primeiraConta.id,
            temCategoria: !!primeiraConta.categoria,
            categoria: primeiraConta.categoria,
          },
          contaIndividual: {
            id: contaIndividual?.id,
            temCategoria: !!contaIndividual?.categoria,
            categoria: contaIndividual?.categoria,
          },
        };
      } else {
        results.tests.contasReceber = {
          success: false,
          message: "Nenhuma conta a receber encontrada",
        };
      }
    } catch (error: any) {
      results.tests.contasReceber = {
        success: false,
        error: error.message,
      };
    }

    // Teste 3: Verificar contas no banco de dados
    try {
      console.log("[Debug] Verificando contas no banco...");
      
      const contasPagarDb = await prisma.contaPagar.findMany({
        where: { userId },
        take: 5,
        include: { categoria: true },
        orderBy: { atualizadoEm: 'desc' },
      });
      
      const contasReceberDb = await prisma.contaReceber.findMany({
        where: { userId },
        take: 5,
        include: { categoria: true },
        orderBy: { atualizadoEm: 'desc' },
      });
      
      results.tests.bancoDados = {
        success: true,
        contasPagar: contasPagarDb.map(c => ({
          id: c.id,
          blingId: c.blingId,
          categoriaId: c.categoriaId,
          temCategoria: !!c.categoria,
          categoriaNome: c.categoria?.nome,
        })),
        contasReceber: contasReceberDb.map(c => ({
          id: c.id,
          blingId: c.blingId,
          categoriaId: c.categoriaId,
          temCategoria: !!c.categoria,
          categoriaNome: c.categoria?.nome,
        })),
      };
    } catch (error: any) {
      results.tests.bancoDados = {
        success: false,
        error: error.message,
      };
    }

    return NextResponse.json({
      success: true,
      message: "Teste de sincronização de categoria concluído",
      data: results,
    });

  } catch (error) {
    console.error("Erro no teste de sincronização de categoria:", error);
    return NextResponse.json(
      { error: `Erro no teste: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}






