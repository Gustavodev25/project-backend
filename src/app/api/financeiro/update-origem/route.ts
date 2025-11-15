import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint temporário para atualizar origem de BLING para SINCRONIZACAO
 * Executar apenas uma vez e depois deletar este arquivo
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Update Origem] Iniciando atualização...');
    
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
    console.log(`[Update Origem] UserId: ${userId}`);

    // Atualizar contas a pagar
    console.log('[Update Origem] Atualizando contas a pagar...');
    const contasPagarUpdated = await prisma.contaPagar.updateMany({
      where: {
        origem: "BLING",
      },
      data: {
        origem: "SINCRONIZACAO",
      },
    });
    console.log(`[Update Origem] ✅ ${contasPagarUpdated.count} contas a pagar atualizadas`);

    // Atualizar contas a receber
    console.log('[Update Origem] Atualizando contas a receber...');
    const contasReceberUpdated = await prisma.contaReceber.updateMany({
      where: {
        origem: "BLING",
      },
      data: {
        origem: "SINCRONIZACAO",
      },
    });
    console.log(`[Update Origem] ✅ ${contasReceberUpdated.count} contas a receber atualizadas`);

    // Verificar resultados
    const contasPagarByOrigem = await prisma.contaPagar.groupBy({
      by: ['origem'],
      _count: {
        id: true,
      },
    });

    const contasReceberByOrigem = await prisma.contaReceber.groupBy({
      by: ['origem'],
      _count: {
        id: true,
      },
    });

    console.log('[Update Origem] === ATUALIZAÇÃO CONCLUÍDA ===');

    return NextResponse.json({
      success: true,
      message: "Origem atualizada com sucesso!",
      updated: {
        contasPagar: contasPagarUpdated.count,
        contasReceber: contasReceberUpdated.count,
        total: contasPagarUpdated.count + contasReceberUpdated.count,
      },
      summary: {
        contasPagar: contasPagarByOrigem,
        contasReceber: contasReceberByOrigem,
      },
    });
  } catch (error) {
    console.error("[Update Origem] ERRO:", error);
    return NextResponse.json(
      { 
        error: "Erro ao atualizar origem",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
