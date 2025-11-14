import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import {
  getBlingContasPagar,
  getBlingContasReceber,
  getBlingFormasPagamento,
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
      dateRange: {
        dataInicial: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        dataFinal: new Date().toISOString().split('T')[0],
      },
      tests: {},
    };

    // Teste 1: Contas a pagar com filtro de data
    try {
      console.log("[Debug] Testando contas a pagar com filtro de data...");
      const startTime = Date.now();
      
      const contasPagar = await getBlingContasPagar(refreshedAccount.access_token);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      results.tests.contasPagar = {
        success: true,
        count: contasPagar.length,
        duration: `${duration}ms`,
        sample: contasPagar.slice(0, 3),
      };
    } catch (error: any) {
      results.tests.contasPagar = {
        success: false,
        error: error.message,
        count: 0,
      };
    }

    // Teste 2: Contas a receber com filtro de data
    try {
      console.log("[Debug] Testando contas a receber com filtro de data...");
      const startTime = Date.now();
      
      const contasReceber = await getBlingContasReceber(refreshedAccount.access_token);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      results.tests.contasReceber = {
        success: true,
        count: contasReceber.length,
        duration: `${duration}ms`,
        sample: contasReceber.slice(0, 3),
      };
    } catch (error: any) {
      results.tests.contasReceber = {
        success: false,
        error: error.message,
        count: 0,
      };
    }

    // Teste 3: Formas de pagamento
    try {
      console.log("[Debug] Testando formas de pagamento...");
      const startTime = Date.now();
      
      const formasPagamento = await getBlingFormasPagamento(refreshedAccount.access_token);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      results.tests.formasPagamento = {
        success: true,
        count: formasPagamento.length,
        duration: `${duration}ms`,
        sample: formasPagamento.slice(0, 3),
      };
    } catch (error: any) {
      results.tests.formasPagamento = {
        success: false,
        error: error.message,
        count: 0,
      };
    }

    return NextResponse.json({
      success: true,
      message: "Teste de filtros de data concluído",
      data: results,
    });

  } catch (error) {
    console.error("Erro no teste de filtros de data:", error);
    return NextResponse.json(
      { error: `Erro no teste: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}






