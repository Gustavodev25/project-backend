import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
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

    // Testar conexão com o banco
    console.log(`[Test] Testando conexão para usuário ${userId}...`);
    
    // Testar se consegue buscar formas de pagamento existentes
    const formasExistentes = await prisma.formaPagamento.findMany({
      where: { userId },
      take: 5
    });
    
    console.log(`[Test] Formas de pagamento existentes: ${formasExistentes.length}`);

    // Testar se consegue criar uma forma de pagamento de teste
    const formaTeste = await prisma.formaPagamento.upsert({
      where: {
        userId_blingId: {
          userId,
          blingId: "teste-connection"
        }
      },
      update: {
        nome: "Teste de Conexão",
        descricao: "Forma de pagamento para teste de conexão",
        tipo: "teste",
        ativo: true,
        atualizadoEm: new Date()
      },
      create: {
        userId,
        blingId: "teste-connection",
        nome: "Teste de Conexão",
        descricao: "Forma de pagamento para teste de conexão",
        tipo: "teste",
        ativo: true
      }
    });

    console.log(`[Test] Forma de pagamento de teste criada: ${formaTeste.id}`);

    // Remover a forma de pagamento de teste
    await prisma.formaPagamento.delete({
      where: { id: formaTeste.id }
    });

    console.log(`[Test] Forma de pagamento de teste removida`);

    return NextResponse.json({
      success: true,
      message: "Conexão com banco de dados funcionando",
      data: {
        userId,
        formasExistentes: formasExistentes.length,
        testeCriado: true,
        testeRemovido: true
      }
    });

  } catch (error) {
    console.error("Erro no teste de conexão:", error);
    
    return NextResponse.json({
      error: `Erro no teste de conexão: ${error instanceof Error ? error.message : String(error)}`,
      details: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}

