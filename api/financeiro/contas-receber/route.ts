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
    const { descricao, valor, dataPagamento, categoriaId, formaPagamentoId } = body;

    if (!descricao || !valor || !dataPagamento) {
      return NextResponse.json(
        { error: "Campos obrigatórios faltando" },
        { status: 400 }
      );
    }

    const contaReceber = await prisma.contaReceber.create({
      data: ({
        userId: userId,
        descricao,
        valor: parseFloat(valor),
        dataVencimento: new Date(dataPagamento),
        dataRecebimento: new Date(dataPagamento),
        status: "recebido",
        categoriaId: categoriaId ? String(categoriaId) : null,
        formaPagamentoId: formaPagamentoId ? String(formaPagamentoId) : null,
      } as any),
      include: {
        categoria: true,
        formaPagamento: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: contaReceber,
    });
  } catch (error) {
    console.error("Erro ao criar conta a receber:", error);
    return NextResponse.json(
      { error: "Erro ao criar conta a receber" },
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

    let contasReceber: any[] = [];
    try {
      contasReceber = await prisma.contaReceber.findMany({
        where: { userId },
        include: { categoria: true, formaPagamento: true },
        orderBy: { dataVencimento: "desc" },
      });
    } catch (err: any) {
      const msg = String(err?.message || err);
      const code = String((err && (err as any).code) || "");
      if (code === 'P2022' || msg.toLowerCase().includes('data_competencia')) {
        // Fallback seguro via SQL bruto quando o client do Prisma ainda estiver desatualizado
        const rows = await prisma.$queryRawUnsafe<any[]>(
          `
          SELECT 
            cr.id,
            cr.user_id     AS "userId",
            cr.bling_id    AS "blingId",
            cr.descricao,
            cr.valor,
            cr.data_vencimento  AS "dataVencimento",
            cr.data_recebimento AS "dataRecebimento",
            cr.status,
            cr.origem,
            cr.sincronizado_em  AS "sincronizadoEm",
            cr.atualizado_em    AS "atualizadoEm",
            json_build_object(
              'id', c.id,
              'nome', c.nome,
              'descricao', c.descricao
            ) AS categoria,
            json_build_object(
              'id', fp.id,
              'nome', fp.nome,
              'descricao', fp.descricao,
              'tipo', fp.tipo
            ) AS "formaPagamento"
          FROM conta_receber cr
          LEFT JOIN categoria c ON c.id = cr.categoria_id
          LEFT JOIN forma_pagamento fp ON fp.id = cr.forma_pagamento_id
          WHERE cr.user_id = $1
          ORDER BY cr.data_vencimento DESC
          `,
          userId,
        );
        contasReceber = rows || [];
      } else {
        throw err;
      }
    }

    return NextResponse.json({
      success: true,
      data: contasReceber,
    });
  } catch (error) {
    console.error("Erro ao buscar contas a receber:", error);
    return NextResponse.json(
      { error: "Erro ao buscar contas a receber" },
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
    const { descricao, valor, dataRecebimento, categoriaId, formaPagamentoId } = body;

    if (!id) {
      return NextResponse.json(
        { error: "ID do registro não fornecido" },
        { status: 400 }
      );
    }

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
      data: ({
        descricao,
        valor: parseFloat(valor),
        dataVencimento: new Date(dataRecebimento),
        dataRecebimento: new Date(dataRecebimento),
        categoriaId: categoriaId ? String(categoriaId) : null,
        formaPagamentoId: formaPagamentoId ? String(formaPagamentoId) : null,
      } as any),
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
