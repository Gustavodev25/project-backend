import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  try {
    console.log(`[Sync No Prisma] Iniciando teste sem Prisma...`);
    
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
    console.log(`[Sync No Prisma] Usuário: ${userId}`);

    // Simular dados de formas de pagamento
    const formasPagamentoSimuladas = [
      {
        id: "1",
        nome: "Dinheiro",
        descricao: "Pagamento em dinheiro",
        tipo: "dinheiro",
        situacao: "ativo"
      },
      {
        id: "2", 
        nome: "Cartão de Crédito",
        descricao: "Pagamento com cartão de crédito",
        tipo: "cartao",
        situacao: "ativo"
      }
    ];

    console.log(`[Sync No Prisma] Formas de pagamento simuladas: ${formasPagamentoSimuladas.length}`);

    return NextResponse.json({
      success: true,
      message: "Teste sem Prisma bem-sucedido",
      data: {
        userId,
        formasPagamento: formasPagamentoSimuladas,
        count: formasPagamentoSimuladas.length
      }
    });

  } catch (error) {
    console.error("Erro no teste sem Prisma:", error);
    return NextResponse.json({
      error: `Erro no teste sem Prisma: ${error instanceof Error ? error.message : String(error)}`,
      details: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}

