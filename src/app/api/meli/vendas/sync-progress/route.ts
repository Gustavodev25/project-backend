import { NextRequest } from "next/server";
import { assertSessionToken } from "@/lib/auth";
import { addConnection, removeConnection } from "@/lib/sse-progress";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  console.log('[SSE sync-progress] Nova requisição recebida');

  const sessionCookie = req.cookies.get("session")?.value;
  console.log('[SSE sync-progress] Session cookie:', sessionCookie ? 'presente' : 'ausente');

  let session;
  try {
    session = await assertSessionToken(sessionCookie);
    console.log('[SSE sync-progress] Autenticação bem-sucedida para usuário:', session.sub);
  } catch (error) {
    console.error('[SSE sync-progress] Erro de autenticação:', error);
    return new Response("Unauthorized", { status: 401 });
  }

  // Criar um ID único para esta conexão
  const connectionId = `${session.sub}-${Date.now()}`;
  console.log('[SSE sync-progress] ID da conexão:', connectionId);

  const stream = new ReadableStream({
    start(controller) {
      try {
        // Armazenar a conexão usando a função da lib
        addConnection(connectionId, controller);
        console.log('[SSE sync-progress] Conexão armazenada');

        // Enviar evento de conexão estabelecida
        const connectEvent = `data: ${JSON.stringify({
          type: "connected",
          message: "Conexão estabelecida para sincronização de vendas",
          timestamp: new Date().toISOString()
        })}\n\n`;

        controller.enqueue(new TextEncoder().encode(connectEvent));
        console.log(`[SSE] ✅ Conexão estabelecida para usuário ${session.sub} (${connectionId})`);
      } catch (error) {
        console.error('[SSE sync-progress] Erro ao inicializar stream:', error);
        throw error;
      }
    },

    cancel() {
      // Limpar conexão quando cancelada usando a função da lib
      removeConnection(connectionId);
      console.log(`[SSE] ❌ Conexão cancelada para usuário ${session.sub} (${connectionId})`);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  });
}
