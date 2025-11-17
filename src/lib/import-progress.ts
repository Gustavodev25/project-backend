// Map para armazenar listeners por sessionId
const listeners = new Map<string, Set<(data: string) => void>>();

// Função helper para enviar progresso de importação
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

// Exportar listeners para uso no route
export { listeners };
