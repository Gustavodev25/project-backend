import { NextRequest, NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET || "change-me-in-production";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    console.log("[TEST] Testando sistema de renovação automática de tokens...");

    const response = await fetch(`${API_URL}/api/cron/refresh-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    
    console.log("[TEST] Resultado do teste:", result);

    return NextResponse.json({
      success: true,
      message: "Teste de renovação automática executado com sucesso",
      result,
    });

  } catch (error) {
    console.error("[TEST] Erro ao testar renovação automática:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao testar renovação automática",
      },
      { status: 500 }
    );
  }
}
