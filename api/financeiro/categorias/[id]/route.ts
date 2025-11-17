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
    const { descricao, tipo } = body;

    if (!descricao || !tipo) {
      return NextResponse.json(
        { error: "Campos obrigatórios faltando" },
        { status: 400 }
      );
    }

    // Verificar se o registro pertence ao usuário
    const categoria = await prisma.categoria.findFirst({
      where: {
        id: id,
        userId: userId,
      },
    });

    if (!categoria) {
      return NextResponse.json(
        { error: "Registro não encontrado ou não pertence ao usuário" },
        { status: 404 }
      );
    }

    // Atualizar o registro
    const categoriaAtualizada = await prisma.categoria.update({
      where: {
        id: id,
      },
      data: {
        descricao,
        tipo,
      },
    });

    return NextResponse.json({
      success: true,
      data: categoriaAtualizada,
    });
  } catch (error) {
    console.error("Erro ao atualizar categoria:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar categoria" },
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
    const categoria = await prisma.categoria.findFirst({
      where: {
        id: id,
        userId: userId,
      },
    });

    if (!categoria) {
      return NextResponse.json(
        { error: "Registro não encontrado ou não pertence ao usuário" },
        { status: 404 }
      );
    }

    // Verificar se a categoria está sendo usada em contas
    const contasUsandoCategoria = await prisma.contaPagar.count({
      where: {
        categoriaId: id,
      },
    });

    const contasReceberUsandoCategoria = await prisma.contaReceber.count({
      where: {
        categoriaId: id,
      },
    });

    if (contasUsandoCategoria > 0 || contasReceberUsandoCategoria > 0) {
      return NextResponse.json(
        { error: "Não é possível excluir categoria que está sendo usada em contas" },
        { status: 400 }
      );
    }

    // Excluir o registro
    await prisma.categoria.delete({
      where: {
        id: id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Categoria excluída com sucesso",
    });
  } catch (error) {
    console.error("Erro ao excluir categoria:", error);
    return NextResponse.json(
      { error: "Erro ao excluir categoria" },
      { status: 500 }
    );
  }
}

