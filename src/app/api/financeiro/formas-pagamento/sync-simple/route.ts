import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  try {
    console.log(`[Sync Simple] Iniciando sincronização simples...`);
    
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
    console.log(`[Sync Simple] Usuário: ${userId}`);

    // Testar apenas inserção no banco sem API do Bling
    const testForma = await prisma.formaPagamento.upsert({
      where: {
        userId_blingId: {
          userId: userId,
          blingId: "teste-simple"
        }
      },
      update: {
        nome: "Teste Simple",
        descricao: "Forma de pagamento para teste simples",
        tipo: "teste",
        ativo: true,
        atualizadoEm: new Date()
      },
      create: {
        userId: userId,
        blingId: "teste-simple",
        nome: "Teste Simple",
        descricao: "Forma de pagamento para teste simples",
        tipo: "teste",
        ativo: true
      }
    });

    console.log(`[Sync Simple] Forma de pagamento criada: ${testForma.id}`);

    // Remover o teste
    await prisma.formaPagamento.delete({
      where: { id: testForma.id }
    });

    console.log(`[Sync Simple] Forma de pagamento removida`);

    return NextResponse.json({
      success: true,
      message: "Sincronização simples bem-sucedida",
      data: {
        userId,
        testCreated: true,
        testRemoved: true
      }
    });

  } catch (error) {
    console.error("Erro na sincronização simples:", error);
    return NextResponse.json({
      error: `Erro na sincronização simples: ${error instanceof Error ? error.message : String(error)}`,
      details: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}

