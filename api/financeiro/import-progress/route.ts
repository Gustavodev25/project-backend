import { NextRequest } from "next/server";
import { listeners } from "@/lib/import-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Obter sessionId da URL (query parameter)
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId') || 'default';
  
  console.log(`[Import SSE] Cliente conectado: ${sessionId}`);
  
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Função para enviar dados
      const sendData = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      // Adicionar listener para esta sessão
      if (!listeners.has(sessionId)) {
        listeners.set(sessionId, new Set());
      }
      listeners.get(sessionId)!.add(sendData);

      // Enviar mensagem de conexão
      sendData(JSON.stringify({ type: 'connected' }));

      // Cleanup quando a conexão fechar
      request.signal.addEventListener('abort', () => {
        const sessionListeners = listeners.get(sessionId);
        if (sessionListeners) {
          sessionListeners.delete(sendData);
          if (sessionListeners.size === 0) {
            listeners.delete(sessionId);
          }
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
