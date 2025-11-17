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
    const { descricao, valor, dataRecebimento, categoriaId, formaPagamentoId } = body;

    if (!descricao || !valor || !dataRecebimento) {
      return NextResponse.json(
        { error: "Campos obrigatórios faltando" },
        { status: 400 }
      );
    }

    // Verificar se o registro pertence ao usuário
    const contaReceber = await prisma.contaReceber.findFirst({
      where: {
        id: id,
        userId: userId,
      },
    });

    if (!contaReceber) {
      return NextResponse.json(
        { error: "Registro não encontrado ou não pertence ao usuário" },
        { status: 404 }
      );
    }

    // Atualizar o registro
    const contaReceberAtualizada = await prisma.contaReceber.update({
      where: {
        id: id,
      },
      data: {
        descricao,
        valor: parseFloat(valor),
        dataVencimento: new Date(dataRecebimento),
        dataRecebimento: new Date(dataRecebimento),
        categoriaId: categoriaId ? String(categoriaId) : null,
        formaPagamentoId: formaPagamentoId ? String(formaPagamentoId) : null,
      },
      include: {
        categoria: true,
        formaPagamento: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: contaReceberAtualizada,
    });
  } catch (error) {
    console.error("Erro ao atualizar conta a receber:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar conta a receber" },
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
    const contaReceber = await prisma.contaReceber.findFirst({
      where: {
        id: id,
        userId: userId,
      },
    });

    if (!contaReceber) {
      return NextResponse.json(
        { error: "Registro não encontrado ou não pertence ao usuário" },
        { status: 404 }
      );
    }

    // Excluir o registro
    await prisma.contaReceber.delete({
      where: {
        id: id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Conta a receber excluída com sucesso",
    });
  } catch (error) {
    console.error("Erro ao excluir conta a receber:", error);
    return NextResponse.json(
      { error: "Erro ao excluir conta a receber" },
      { status: 500 }
    );
  }
}

