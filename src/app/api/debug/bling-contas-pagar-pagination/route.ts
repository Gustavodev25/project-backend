import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import {
  getBlingContasPagar,
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
      test: {},
    };

    // Testar busca de contas a pagar com paginação
    try {
      console.log("[Debug] Testando busca de contas a pagar com paginação...");
      const startTime = Date.now();
      
      const contasPagar = await getBlingContasPagar(refreshedAccount.access_token);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      results.test = {
        success: true,
        count: contasPagar.length,
        duration: `${duration}ms`,
        sample: contasPagar.slice(0, 3), // Primeiras 3 para debug
        fields: contasPagar.length > 0 ? Object.keys(contasPagar[0]) : [],
      };
    } catch (error: any) {
      console.error("[Debug] Erro ao testar contas a pagar:", error);
      results.test = {
        success: false,
        error: error.message,
        count: 0,
      };
    }

    return NextResponse.json({
      success: true,
      message: "Teste de paginação de contas a pagar concluído",
      data: results,
    });

  } catch (error) {
    console.error("Erro no teste de paginação:", error);
    return NextResponse.json(
      { error: `Erro no teste: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

