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
      config: {
        tipoIntegracao: process.env.BLING_TIPO_INTEGRACAO || "não configurado",
        idLoja: process.env.BLING_ID_LOJA || "não configurado",
      },
      test: {},
    };

    // Verificar configuração
    const tipoIntegracao = process.env.BLING_TIPO_INTEGRACAO?.trim();
    const idLoja = process.env.BLING_ID_LOJA?.trim();
    
    if (!tipoIntegracao || !idLoja) {
      results.test.error = "Configuração incompleta";
      results.test.message = "Configure BLING_TIPO_INTEGRACAO e BLING_ID_LOJA no .env";
      return NextResponse.json({
        success: false,
        message: "Configuração incompleta para categorias de anúncios",
        data: results,
      });
    }

    // Testar endpoint de categorias de anúncios
    try {
      console.log("[Debug] Testando endpoint /anuncios/categorias...");
      
      const url = `https://www.bling.com.br/Api/v3/anuncios/categorias?tipoIntegracao=${tipoIntegracao}&idLoja=${idLoja}`;
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
        
        results.test.success = true;
        results.test.status = response.status;
        results.test.data = data;
        results.test.categorias = data?.data || [];
        results.test.count = (data?.data || []).length;
      } else {
        const errorText = await response.text();
        console.log("[Debug] Erro na resposta:", errorText);
        
        results.test.success = false;
        results.test.status = response.status;
        results.test.error = errorText;
      }
    } catch (error: any) {
      console.error("[Debug] Erro ao testar endpoint:", error);
      results.test.success = false;
      results.test.error = error.message;
    }

    return NextResponse.json({
      success: true,
      message: "Teste de categorias de anúncios concluído",
      data: results,
    });

  } catch (error) {
    console.error("Erro no teste de categorias de anúncios:", error);
    return NextResponse.json(
      { error: `Erro no teste: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

