import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  try {
    const { sub } = await assertSessionToken(sessionCookie);
    const rows = await prisma.meliAccount.findMany({
      where: { userId: sub },
      orderBy: { created_at: "desc" },
    });
    return NextResponse.json(rows);
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  const sessionCookie = req.cookies.get("session")?.value;
  let session: Awaited<ReturnType<typeof assertSessionToken>>;

  try {
    session = await assertSessionToken(sessionCookie);
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let accountId =
    req.nextUrl.searchParams.get("id")?.trim() ||
    req.nextUrl.searchParams.get("accountId")?.trim() ||
    "";

  if (!accountId) {
    try {
      const body = await req.json();
      accountId =
        body?.accountId?.trim() ||
        body?.id?.trim() ||
        "";
    } catch {
      // Sem corpo JSON, mantém vazio
    }
  }

  if (!accountId) {
    return NextResponse.json(
      { error: "Conta inválida" },
      { status: 400 },
    );
  }

  try {
    const account = await prisma.meliAccount.findFirst({
      where: { id: accountId, userId: session.sub },
      select: { id: true },
    });

    if (!account) {
      return NextResponse.json(
        { error: "Conta não encontrada" },
        { status: 404 },
      );
    }

    await prisma.$transaction([
      prisma.meliVenda.deleteMany({
        where: { meliAccountId: accountId, userId: session.sub },
      }),
      prisma.meliAccount.delete({
        where: { id: accountId },
      }),
    ]);

    return NextResponse.json({ success: true, accountId });
  } catch (error) {
    console.error("[meli][accounts] erro ao excluir conta:", error);
    return NextResponse.json(
      { error: "Erro ao excluir conta" },
      { status: 500 },
    );
  }
}
