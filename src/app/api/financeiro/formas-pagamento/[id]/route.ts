import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { tryVerifySessionToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Verificar o token JWT de sessão
    const session = await tryVerifySessionToken(sessionCookie.value);
    
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida ou expirada" }, { status: 401 });
    }

    const userId = session.sub;
    const { id } = await params;
    const body = await request.json();
    const { nome } = body;

    if (!nome) {
      return NextResponse.json(
        { error: "Nome é obrigatório" },
        { status: 400 }
      );
    }

    // Verificar se o registro pertence ao usuário
    const formaPagamento = await prisma.formaPagamento.findFirst({
      where: {
        id: id,
        userId: userId,
      },
    });

    if (!formaPagamento) {
      return NextResponse.json(
        { error: "Registro não encontrado ou não pertence ao usuário" },
        { status: 404 }
      );
    }

    // Atualizar o registro
    const formaPagamentoAtualizada = await prisma.formaPagamento.update({
      where: {
        id: id,
      },
      data: {
        nome,
      },
    });

    return NextResponse.json({
      success: true,
      data: formaPagamentoAtualizada,
    });
  } catch (error) {
    console.error("Erro ao atualizar forma de pagamento:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar forma de pagamento" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Verificar o token JWT de sessão
    const session = await tryVerifySessionToken(sessionCookie.value);
    
    if (!session) {
      return NextResponse.json({ error: "Sessão inválida ou expirada" }, { status: 401 });
    }

    const userId = session.sub;
    const { id } = await params;

    // Verificar se o registro pertence ao usuário
    const formaPagamento = await prisma.formaPagamento.findFirst({
      where: {
        id: id,
        userId: userId,
      },
    });

    if (!formaPagamento) {
      return NextResponse.json(
        { error: "Registro não encontrado ou não pertence ao usuário" },
        { status: 404 }
      );
    }

    // Verificar se a forma de pagamento está sendo usada em contas
    const contasUsandoFormaPagamento = await prisma.contaPagar.count({
      where: {
        formaPagamentoId: id,
      },
    });

    const contasReceberUsandoFormaPagamento = await prisma.contaReceber.count({
      where: {
        formaPagamentoId: id,
      },
    });

    if (contasUsandoFormaPagamento > 0 || contasReceberUsandoFormaPagamento > 0) {
      return NextResponse.json(
        { error: "Não é possível excluir forma de pagamento que está sendo usada em contas" },
        { status: 400 }
      );
    }

    // Excluir o registro
    await prisma.formaPagamento.delete({
      where: {
        id: id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Forma de pagamento excluída com sucesso",
    });
  } catch (error) {
    console.error("Erro ao excluir forma de pagamento:", error);
    return NextResponse.json(
      { error: "Erro ao excluir forma de pagamento" },
      { status: 500 }
    );
  }
}

