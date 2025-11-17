import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import { getBlingFormasPagamento, refreshBlingAccountToken } from "@/lib/bling";

export const runtime = "nodejs";

export async function GET() {
  try {
    console.log(`[Debug] Iniciando debug da API Bling...`);
    
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const session = await tryVerifySessionToken(sessionCookie.value);
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
    }

    const userId = session.sub;
    console.log(`[Debug] Usuário: ${userId}`);

    // Buscar conta Bling
    const blingAccount = await prisma.blingAccount.findFirst({
      where: { 
        userId: userId,
        expires_at: { gt: new Date() }
      },
    });

    if (!blingAccount) {
      return NextResponse.json({ 
        error: "Nenhuma conta Bling ativa encontrada" 
      }, { status: 404 });
    }

    console.log(`[Debug] Conta Bling encontrada: ${blingAccount.id}`);

    // Renovar token
    let refreshedAccount;
    try {
      refreshedAccount = await refreshBlingAccountToken(blingAccount);
      console.log(`[Debug] Token renovado com sucesso`);
    } catch (error) {
      console.error(`[Debug] Erro ao renovar token:`, error);
      return NextResponse.json({ 
        error: `Erro ao renovar token: ${error instanceof Error ? error.message : String(error)}` 
      }, { status: 500 });
    }

    // Testar busca de formas de pagamento
    console.log(`[Debug] Testando busca de formas de pagamento...`);
    let formasPagamento;
    try {
      formasPagamento = await getBlingFormasPagamento(refreshedAccount.access_token);
      console.log(`[Debug] Formas de pagamento encontradas: ${formasPagamento.length}`);
    } catch (error) {
      console.error(`[Debug] Erro ao buscar formas de pagamento:`, error);
      return NextResponse.json({ 
        error: `Erro ao buscar formas de pagamento: ${error instanceof Error ? error.message : String(error)}`,
        details: error instanceof Error ? error.stack : undefined
      }, { status: 500 });
    }

    // Testar inserção no banco
    console.log(`[Debug] Testando inserção no banco...`);
    let testInsert;
    try {
      if (formasPagamento.length > 0) {
        const primeiraForma = formasPagamento[0];
        const blingId = primeiraForma.id?.toString?.();
        
        if (blingId) {
          testInsert = await prisma.formaPagamento.upsert({
            where: {
              userId_blingId: {
                userId: userId,
                blingId: `debug-${blingId}`
              }
            },
            update: {
              nome: `Debug: ${primeiraForma.nome || primeiraForma.descricao || "Teste"}`,
              descricao: "Forma de pagamento para debug",
              tipo: "debug",
              ativo: true,
              atualizadoEm: new Date()
            },
            create: {
              userId: userId,
              blingId: `debug-${blingId}`,
              nome: `Debug: ${primeiraForma.nome || primeiraForma.descricao || "Teste"}`,
              descricao: "Forma de pagamento para debug",
              tipo: "debug",
              ativo: true
            }
          });
          console.log(`[Debug] Inserção de teste bem-sucedida: ${testInsert.id}`);
        }
      }
    } catch (error) {
      console.error(`[Debug] Erro ao inserir no banco:`, error);
      return NextResponse.json({ 
        error: `Erro ao inserir no banco: ${error instanceof Error ? error.message : String(error)}`,
        details: error instanceof Error ? error.stack : undefined
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Debug concluído com sucesso",
      data: {
        userId,
        blingAccountId: blingAccount.id,
        formasPagamentoCount: formasPagamento.length,
        primeiraForma: formasPagamento[0] || null,
        testInsertId: testInsert?.id || null
      }
    });

  } catch (error) {
    console.error("Erro no debug:", error);
    return NextResponse.json({
      error: `Erro no debug: ${error instanceof Error ? error.message : String(error)}`,
      details: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}

