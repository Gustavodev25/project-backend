import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map para armazenar listeners por sessionId
const listeners = new Map<string, Set<(data: string) => void>>();

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

// Função helper para enviar progresso
export function sendImportProgress(sessionId: string, data: {
  type: 'import_start' | 'import_progress' | 'import_complete' | 'import_error';
  totalRows: number;
  processedRows: number;
  importedRows: number;
  errorRows: number;
  message?: string;
}) {
  const sessionListeners = listeners.get(sessionId);
  
  console.log(`[Import SSE] Tentando enviar para sessão ${sessionId}:`, {
    hasListeners: !!sessionListeners,
    listenersCount: sessionListeners?.size || 0,
    data
  });
  
  if (!sessionListeners || sessionListeners.size === 0) {
    console.warn(`[Import SSE] Nenhum listener encontrado para sessão: ${sessionId}`);
    console.log('[Import SSE] Sessões ativas:', Array.from(listeners.keys()));
    return;
  }

  const payload = JSON.stringify(data);
  sessionListeners.forEach(listener => {
    try {
      listener(payload);
      console.log(`[Import SSE] Evento enviado para sessão ${sessionId}`);
    } catch (error) {
      console.error(`[Import SSE] Erro ao enviar evento:`, error);
    }
  });
}
