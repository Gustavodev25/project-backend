import { NextRequest, NextResponse } from "next/server";
import { assertSessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

// PUT - Atualizar alíquota
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  try {
    session = await assertSessionToken(sessionCookie);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = params;
    const body = await req.json();
    const { conta, aliquota, dataInicio, dataFim, descricao, ativo } = body;

    // Verificar se a alíquota existe e pertence ao usuário
    // @ts-expect-error - modelo será disponível após executar migration
    const aliquotaExistente = await prisma.aliquotaImposto.findUnique({
      where: { id },
    });

    if (!aliquotaExistente || aliquotaExistente.userId !== session.sub) {
      return NextResponse.json(
        { error: "Alíquota não encontrada" },
        { status: 404 }
      );
    }

    // Validar que dataFim >= dataInicio se ambos forem fornecidos
    if (dataInicio && dataFim && new Date(dataFim) < new Date(dataInicio)) {
      return NextResponse.json(
        { error: "Data fim deve ser maior ou igual à data início" },
        { status: 400 }
      );
    }

    // Validar alíquota se fornecida
    if (aliquota !== undefined) {
      const aliquotaNum = parseFloat(aliquota);
      if (isNaN(aliquotaNum) || aliquotaNum < 0 || aliquotaNum > 100) {
        return NextResponse.json(
          { error: "Alíquota deve estar entre 0 e 100" },
          { status: 400 }
        );
      }
    }

    // @ts-expect-error - modelo será disponível após executar migration
    const aliquotaAtualizada = await prisma.aliquotaImposto.update({
      where: { id },
      data: {
        ...(conta && { conta }),
        ...(aliquota !== undefined && { aliquota: parseFloat(aliquota) }),
        ...(dataInicio && { dataInicio: new Date(dataInicio) }),
        ...(dataFim && { dataFim: new Date(dataFim) }),
        ...(descricao !== undefined && { descricao }),
        ...(ativo !== undefined && { ativo }),
      },
    });

    return NextResponse.json({ data: aliquotaAtualizada });
  } catch (error) {
    console.error("Erro ao atualizar alíquota:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar alíquota" },
      { status: 500 }
    );
  }
}

// DELETE - Deletar alíquota
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  try {
    session = await assertSessionToken(sessionCookie);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = params;

    // Verificar se a alíquota existe e pertence ao usuário
    // @ts-expect-error - modelo será disponível após executar migration
    const aliquota = await prisma.aliquotaImposto.findUnique({
      where: { id },
    });

    if (!aliquota || aliquota.userId !== session.sub) {
      return NextResponse.json(
        { error: "Alíquota não encontrada" },
        { status: 404 }
      );
    }

    // @ts-expect-error - modelo será disponível após executar migration
    await prisma.aliquotaImposto.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao deletar alíquota:", error);
    return NextResponse.json(
      { error: "Erro ao deletar alíquota" },
      { status: 500 }
    );
  }
}
