// Store para manter as conexões SSE ativas
const activeConnections = new Map<string, ReadableStreamDefaultController>();

// Função para enviar progresso para todas as conexões ativas de um usuário
export function sendProgressToUser(userId: string, progress: {
  type: "sync_start" | "sync_progress" | "sync_complete" | "sync_error" | "sync_warning" | "sync_debug" | "sync_continue";
  message: string;
  current?: number;
  total?: number;
  accountId?: string;
  accountNickname?: string;
  page?: number;
  offset?: number;
  fetched?: number;
  expected?: number;
  timestamp?: string;
  errorCode?: string;
  debugData?: any;
  hasMoreToSync?: boolean;
  steps?: Array<{
    accountId: string;
    accountName: string;
    currentStep: 'pending' | 'fetching' | 'saving' | 'completed' | 'error';
    progress: number;
    fetched?: number;
    expected?: number;
    error?: string;
  }>;
}) {
  const timestamp = progress.timestamp || new Date().toISOString();
  const eventData = {
    ...progress,
    timestamp,
    userId
  };

  const event = `data: ${JSON.stringify(eventData)}\n\n`;
  
  // Encontrar todas as conexões do usuário
  let sentCount = 0;
  for (const [connectionId, controller] of activeConnections) {
    if (connectionId.startsWith(userId)) {
      try {
        controller.enqueue(new TextEncoder().encode(event));
        sentCount++;
      } catch (error) {
        console.error(`[SSE] Erro ao enviar progresso para ${connectionId}:`, error);
        // Remover conexão com erro
        activeConnections.delete(connectionId);
      }
    }
  }
  
  // Log apenas para debug se não houver conexões SSE (modo cron)
  if (sentCount > 0) {
    console.log(`[SSE] Progresso enviado para ${sentCount} conexão(ões) do usuário ${userId}:`, progress.message);
  } else {
    // Modo cron: apenas log de debug
    console.log(`[Cron] ${progress.message}`);
  }
}

// Função para fechar todas as conexões de um usuário
export function closeUserConnections(userId: string) {
  let closedCount = 0;
  for (const [connectionId, controller] of activeConnections) {
    if (connectionId.startsWith(userId)) {
      try {
        controller.close();
        activeConnections.delete(connectionId);
        closedCount++;
      } catch (error) {
        console.error(`[SSE] Erro ao fechar conexão ${connectionId}:`, error);
        activeConnections.delete(connectionId);
      }
    }
  }
  
  if (closedCount > 0) {
    console.log(`[SSE] ${closedCount} conexão(ões) fechada(s) para usuário ${userId}`);
  }
}

// Função para adicionar uma conexão (usada pelo endpoint SSE)
export function addConnection(connectionId: string, controller: ReadableStreamDefaultController) {
  activeConnections.set(connectionId, controller);
}

// Função para remover uma conexão (usada pelo endpoint SSE)
export function removeConnection(connectionId: string) {
  activeConnections.delete(connectionId);
}
