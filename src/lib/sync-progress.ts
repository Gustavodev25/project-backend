// Store para manter as conexões SSE ativas
const connections = new Map<string, ReadableStreamDefaultController>();

// Função para enviar progresso para um usuário específico
export function sendProgressToUser(userId: string, progress: {
  type: "sync_start" | "sync_progress" | "sync_complete" | "sync_error" | "sync_warning";
  title?: string;
  message: string;
  progressValue?: number;
  progressMax?: number;
  progressLabel?: string;
  current?: number;
  total?: number;
  fetched?: number;
  expected?: number;
  accountId?: string;
  accountNickname?: string;
  page?: number;
  offset?: number;
  debugData?: unknown;
  mlUserId?: string;
}) {
  const controller = connections.get(userId);
  if (controller) {
    try {
      const data = JSON.stringify(progress);
      controller.enqueue(`data: ${data}\n\n`);
    } catch (error) {
      console.error("Erro ao enviar progresso:", error);
      connections.delete(userId);
    }
  }
}

// Função para limpar conexão de um usuário
export function closeUserConnection(userId: string) {
  const controller = connections.get(userId);
  if (controller) {
    try {
      controller.close();
    } catch (error) {
      console.error("Erro ao fechar conexão:", error);
    }
    connections.delete(userId);
  }
}

// Exportar connections para uso no route
export { connections };
