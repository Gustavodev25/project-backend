import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // Evita cache estático

export async function POST(request: NextRequest) {
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
    const body = await request.json();
    const { descricao, valor, dataPagamento, categoriaId, formaPagamentoId, historico } = body;

    if (!descricao || !valor || !dataPagamento) {
      return NextResponse.json(
        { error: "Campos obrigatórios faltando" },
        { status: 400 }
      );
    }

    let contaPagar;
    try {
    contaPagar = await prisma.contaPagar.create({
      data: ({
        userId: userId,
        descricao,
        valor: parseFloat(valor),
        dataVencimento: new Date(dataPagamento),
        dataPagamento: new Date(dataPagamento),
        status: "pago",
        categoriaId: categoriaId ? String(categoriaId) : null,
        formaPagamentoId: formaPagamentoId ? String(formaPagamentoId) : null,
        historico: historico ? String(historico) : undefined,
      } as any),
      include: {
        categoria: true,
        formaPagamento: true,
      },
    });
    } catch (err: any) {
      const msg = String(err?.message || err);
      const code = String((err && (err as any).code) || "");
      if (msg.includes('Unknown argument `historico`') || msg.toLowerCase().includes('historico') || code === 'P2022') {
        contaPagar = await prisma.contaPagar.create({
          data: ({
            userId: userId,
            descricao,
            valor: parseFloat(valor),
            dataVencimento: new Date(dataPagamento),
            dataPagamento: new Date(dataPagamento),
            status: "pago",
            categoriaId: categoriaId ? String(categoriaId) : null,
            formaPagamentoId: formaPagamentoId ? String(formaPagamentoId) : null,
          } as any),
          include: {
            categoria: true,
            formaPagamento: true,
          },
        });
      } else {
        throw err;
      }
    }

    return NextResponse.json({
      success: true,
      data: contaPagar,
    });
  } catch (error) {
    console.error("Erro ao criar conta a pagar:", error);
    return NextResponse.json(
      { error: "Erro ao criar conta a pagar" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
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

    const contasPagar = await prisma.contaPagar.findMany({
      where: {
        userId: userId,
      },
      include: {
        categoria: true,
        formaPagamento: true,
      },
      orderBy: {
        dataVencimento: "desc",
      },
    });

    return NextResponse.json({
      success: true,
      data: contasPagar,
    });
  } catch (error) {
    console.error("Erro ao buscar contas a pagar:", error);
    return NextResponse.json(
      { error: "Erro ao buscar contas a pagar" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
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
    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();
    const body = await request.json();
    const { descricao, valor, dataPagamento, categoriaId, formaPagamentoId, historico } = body;

    if (!id) {
      return NextResponse.json(
        { error: "ID do registro não fornecido" },
        { status: 400 }
      );
    }

    if (!descricao || !valor || !dataPagamento) {
      return NextResponse.json(
        { error: "Campos obrigatórios faltando" },
        { status: 400 }
      );
    }

    // Verificar se o registro pertence ao usuário
    const contaPagar = await prisma.contaPagar.findFirst({
      where: {
        id: id,
        userId: userId,
      },
    });

    if (!contaPagar) {
      return NextResponse.json(
        { error: "Registro não encontrado ou não pertence ao usuário" },
        { status: 404 }
      );
    }

    // Atualizar o registro
    let contaPagarAtualizada;
    try {
    contaPagarAtualizada = await prisma.contaPagar.update({
      where: {
        id: id,
      },
      data: ({
        descricao,
        valor: parseFloat(valor),
        dataVencimento: new Date(dataPagamento),
        dataPagamento: new Date(dataPagamento),
        categoriaId: categoriaId ? String(categoriaId) : null,
        formaPagamentoId: formaPagamentoId ? String(formaPagamentoId) : null,
        historico: historico ? String(historico) : undefined,
      } as any),
      include: {
        categoria: true,
        formaPagamento: true,
      },
    });
    } catch (err: any) {
      const msg = String(err?.message || err);
      const code = String((err && (err as any).code) || "");
      if (msg.includes('Unknown argument `historico`') || msg.toLowerCase().includes('historico') || code === 'P2022') {
        contaPagarAtualizada = await prisma.contaPagar.update({
          where: { id: id },
          data: ({
            descricao,
            valor: parseFloat(valor),
            dataVencimento: new Date(dataPagamento),
            dataPagamento: new Date(dataPagamento),
            categoriaId: categoriaId ? String(categoriaId) : null,
            formaPagamentoId: formaPagamentoId ? String(formaPagamentoId) : null,
          } as any),
          include: { categoria: true, formaPagamento: true },
        });
      } else {
        throw err;
      }
    }

    return NextResponse.json({
      success: true,
      data: contaPagarAtualizada,
    });
  } catch (error) {
    console.error("Erro ao atualizar conta a pagar:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar conta a pagar" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
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
    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();

    if (!id) {
      return NextResponse.json(
        { error: "ID do registro não fornecido" },
        { status: 400 }
      );
    }

    // Verificar se o registro pertence ao usuário
    const contaPagar = await prisma.contaPagar.findFirst({
      where: {
        id: id,
        userId: userId,
      },
    });

    if (!contaPagar) {
      return NextResponse.json(
        { error: "Registro não encontrado ou não pertence ao usuário" },
        { status: 404 }
      );
    }

    // Excluir o registro
    await prisma.contaPagar.delete({
      where: {
        id: id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Conta a pagar excluída com sucesso",
    });
  } catch (error) {
    console.error("Erro ao excluir conta a pagar:", error);
    return NextResponse.json(
      { error: "Erro ao excluir conta a pagar" },
      { status: 500 }
    );
  }
}
