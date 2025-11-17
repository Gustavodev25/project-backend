import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { tryVerifySessionToken } from "@/lib/auth";
import { connections } from "@/lib/sync-progress";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      return new Response("Não autenticado", { status: 401 });
    }

    const session = await tryVerifySessionToken(sessionCookie.value);
    if (!session) {
      return new Response("Sessão inválida", { status: 401 });
    }

    const userId = session.sub;

    // Criar stream SSE
    const stream = new ReadableStream({
      start(controller) {
        // Armazenar a conexão
        connections.set(userId, controller);
        
        // Enviar evento de conexão estabelecida
        const data = JSON.stringify({
          type: "connected",
          message: "Conexão estabelecida para progresso da sincronização"
        });
        controller.enqueue(`data: ${data}\n\n`);

        // Limpar conexão quando o cliente desconectar
        request.signal.addEventListener("abort", () => {
          connections.delete(userId);
          controller.close();
        });
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control"
      }
    });
  } catch (error) {
    console.error("Erro no SSE de progresso:", error);
    return new Response("Erro interno", { status: 500 });
  }
}

