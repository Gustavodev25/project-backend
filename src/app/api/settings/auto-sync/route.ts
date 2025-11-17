import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

// GET - Obter configuração de auto-sync
export async function GET(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get("session")?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    
    const payload = await verifySessionToken(sessionCookie);

    // Buscar ou criar configurações do usuário
    let settings = await prisma.userSettings.findUnique({
      where: { userId: payload.sub },
    });

    if (!settings) {
      settings = await prisma.userSettings.create({
        data: { userId: payload.sub },
      });
    }

    return NextResponse.json({
      autoSyncEnabled: settings.autoSyncEnabled,
      lastAutoSyncAt: settings.lastAutoSyncAt?.toISOString() || null,
    });
  } catch (error) {
    console.error("Erro ao obter configurações:", error);
    return NextResponse.json(
      { error: "Erro ao obter configurações" },
      { status: 500 }
    );
  }
}

// POST - Atualizar configuração de auto-sync
export async function POST(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get("session")?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    
    const payload = await verifySessionToken(sessionCookie);

    const body = await req.json();
    const { enabled } = body;

    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "Campo 'enabled' é obrigatório e deve ser boolean" },
        { status: 400 }
      );
    }

    // Atualizar ou criar configurações
    const settings = await prisma.userSettings.upsert({
      where: { userId: payload.sub },
      update: { autoSyncEnabled: enabled },
      create: {
        userId: payload.sub,
        autoSyncEnabled: enabled,
      },
    });

    return NextResponse.json({
      success: true,
      autoSyncEnabled: settings.autoSyncEnabled,
    });
  } catch (error) {
    console.error("Erro ao atualizar configurações:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar configurações" },
      { status: 500 }
    );
  }
}