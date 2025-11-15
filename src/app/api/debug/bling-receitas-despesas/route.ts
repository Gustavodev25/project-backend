import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import {
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

    // Testar endpoint de categorias de receitas e despesas
    const endpoint = "/categorias/receitas-despesas";
    const queryParams = {
      tipo: 0, // 0 = Todas, 1 = Despesa, 2 = Receita, 3 = Receita e despesa
      situacao: 1, // 0 = Ativas e Inativas, 1 = Ativas, 2 = Inativas
      limite: 100,
    };

    try {
      console.log(`[Debug] Testando endpoint ${endpoint}...`);
      
      const url = `https://www.bling.com.br/Api/v3${endpoint}?${new URLSearchParams(Object.entries(queryParams).map(([k, v]) => [k, String(v)]))}`;
      console.log("[Debug] URL:", url);
      
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${refreshedAccount.access_token}`,
          Accept: "application/json",
        },
      });

      console.log("[Debug] Status da resposta:", response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log("[Debug] Dados recebidos:", data);
        
        const categorias = data?.data || [];
        const receitas = categorias.filter((c: any) => c.tipo === 2);
        const despesas = categorias.filter((c: any) => c.tipo === 1);
        
        results.tests.receitasDespesas = {
          success: true,
          status: response.status,
          total: categorias.length,
          receitas: receitas.length,
          despesas: despesas.length,
          data: categorias.slice(0, 10), // Primeiras 10 para debug
          sampleReceita: receitas[0] || null,
          sampleDespesa: despesas[0] || null,
        };
      } else {
        const errorText = await response.text();
        console.log("[Debug] Erro na resposta:", errorText);
        
        results.tests.receitasDespesas = {
          success: false,
          status: response.status,
          error: errorText,
        };
      }
    } catch (error: any) {
      console.error("[Debug] Erro ao testar endpoint:", error);
      results.tests.receitasDespesas = {
        success: false,
        error: error.message,
      };
    }

    return NextResponse.json({
      success: true,
      message: "Teste de categorias de receitas e despesas concluído",
      data: results,
    });

  } catch (error) {
    console.error("Erro no teste de receitas e despesas:", error);
    return NextResponse.json(
      { error: `Erro no teste: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

