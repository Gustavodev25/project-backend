import { NextRequest, NextResponse } from "next/server";
import { assertSessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

// GET - Listar todas as alíquotas do usuário
export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  try {
    session = await assertSessionToken(sessionCookie);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // @ts-expect-error - modelo será disponível após executar migration
    const aliquotas = await prisma.aliquotaImposto.findMany({
      where: { userId: session.sub },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ data: aliquotas });
  } catch (error) {
    console.error("Erro ao buscar alíquotas:", error);
    return NextResponse.json(
      { error: "Erro ao buscar alíquotas" },
      { status: 500 }
    );
  }
}

// POST - Criar nova alíquota
export async function POST(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session;
  try {
    session = await assertSessionToken(sessionCookie);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { conta, aliquota, dataInicio, dataFim, descricao } = body;

    // Validações
    if (!conta || !aliquota || !dataInicio || !dataFim) {
      return NextResponse.json(
        { error: "Campos obrigatórios: conta, aliquota, dataInicio, dataFim" },
        { status: 400 }
      );
    }

    // Validar que dataFim >= dataInicio
    if (new Date(dataFim) < new Date(dataInicio)) {
      return NextResponse.json(
        { error: "Data fim deve ser maior ou igual à data início" },
        { status: 400 }
      );
    }

    // Validar alíquota (deve ser >= 0 e <= 100)
    const aliquotaNum = parseFloat(aliquota);
    if (isNaN(aliquotaNum) || aliquotaNum < 0 || aliquotaNum > 100) {
      return NextResponse.json(
        { error: "Alíquota deve estar entre 0 e 100" },
        { status: 400 }
      );
    }

    // @ts-expect-error - modelo será disponível após executar migration
    const novaAliquota = await prisma.aliquotaImposto.create({
      data: {
        userId: session.sub,
        conta,
        aliquota: aliquotaNum,
        dataInicio: new Date(dataInicio),
        dataFim: new Date(dataFim),
        descricao: descricao || null,
        ativo: true,
      },
    });

    return NextResponse.json({ data: novaAliquota }, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar alíquota:", error);
    return NextResponse.json(
      { error: "Erro ao criar alíquota" },
      { status: 500 }
    );
  }
}
