import { NextRequest, NextResponse } from "next/server";
import { recoverAllInvalidAccounts } from "@/lib/meli";

export const runtime = "nodejs";

// Executar a cada 30 minutos
export async function GET(_req: NextRequest) {
  try {
    console.log(`[cron][recovery] Iniciando recuperação automática de contas MELI...`);
    
    const result = await recoverAllInvalidAccounts();
    
    const message = `Recuperação automática concluída: ${result.recovered.length} contas recuperadas, ${result.failed.length} ainda inválidas`;
    console.log(`[cron][recovery] ${message}`);
    
    return NextResponse.json({
      success: true,
      message,
      timestamp: new Date().toISOString(),
      recovered: result.recovered,
      failed: result.failed,
      summary: {
        total: result.recovered.length + result.failed.length,
        recovered: result.recovered.length,
        failed: result.failed.length,
      },
    });

  } catch (error) {
    console.error("[cron][recovery] Erro na recuperação automática:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro na recuperação automática",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
