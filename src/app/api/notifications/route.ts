import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

// GET - Obter notificações não lidas do usuário
export async function GET(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get("session")?.value;

    if (!sessionCookie) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const payload = await verifySessionToken(sessionCookie);

    const notifications = await prisma.syncNotification.findMany({
      where: {
        userId: payload.sub,
        isRead: false,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    });

    return NextResponse.json({ notifications });
  } catch (error) {
    console.error("Erro ao buscar notificações:", error);
    return NextResponse.json(
      { error: "Erro ao buscar notificações" },
      { status: 500 }
    );
  }
}

// POST - Marcar notificação como lida
export async function POST(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get("session")?.value;

    if (!sessionCookie) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const payload = await verifySessionToken(sessionCookie);

    const body = await req.json();
    const { notificationId } = body;

    if (!notificationId) {
      return NextResponse.json(
        { error: "Campo 'notificationId' é obrigatório" },
        { status: 400 }
      );
    }

    await prisma.syncNotification.update({
      where: {
        id: notificationId,
        userId: payload.sub, // Garantir que só possa marcar suas próprias notificações
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao marcar notificação:", error);
    return NextResponse.json(
      { error: "Erro ao marcar notificação" },
      { status: 500 }
    );
  }
}

// DELETE - Marcar todas as notificações como lidas
export async function DELETE(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get("session")?.value;

    if (!sessionCookie) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const payload = await verifySessionToken(sessionCookie);

    await prisma.syncNotification.updateMany({
      where: {
        userId: payload.sub,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro ao marcar todas notificações:", error);
    return NextResponse.json(
      { error: "Erro ao marcar todas notificações" },
      { status: 500 }
    );
  }
}