export interface TokenRefreshNotification {
  userId: string;
  platform: 'Mercado Livre' | 'Shopee' | 'Bling';
  accountId: string;
  accountName: string;
  action: 'refreshed' | 'reactivated' | 'preventive';
  message: string;
}

/**
 * Envia notificação sobre renovação de token
 */
export async function sendTokenRefreshNotification(notification: TokenRefreshNotification) {
  try {
    // TODO: Implementar modelo Notification no Prisma schema antes de ativar
    // await prisma.notification.create({
    //   data: {
    //     userId: notification.userId,
    //     type: 'token_refresh',
    //     title: `Token ${notification.platform} ${getActionText(notification.action)}`,
    //     message: notification.message,
    //     data: {
    //       platform: notification.platform,
    //       accountId: notification.accountId,
    //       accountName: notification.accountName,
    //       action: notification.action,
    //     },
    //     read: false,
    //   },
    // });

    console.log(`📢 Notificação: ${notification.message}`);
  } catch (error) {
    console.error("Erro ao enviar notificação de renovação de token:", error);
  }
}

/**
 * Converte ação em texto legível
 */
function getActionText(action: TokenRefreshNotification['action']): string {
  switch (action) {
    case 'refreshed':
      return 'renovado';
    case 'reactivated':
      return 'reativado';
    case 'preventive':
      return 'renovado preventivamente';
    default:
      return 'atualizado';
  }
}

/**
 * Cria mensagem de notificação baseada na ação
 */
export function createTokenRefreshMessage(
  platform: TokenRefreshNotification['platform'],
  accountName: string,
  action: TokenRefreshNotification['action']
): string {
  const platformName = platform === 'Mercado Livre' ? 'Mercado Livre' : platform;
  
  switch (action) {
    case 'refreshed':
      return `Token da conta ${accountName} (${platformName}) foi renovado com sucesso.`;
    case 'reactivated':
      return `Token da conta ${accountName} (${platformName}) foi reativado após expiração.`;
    case 'preventive':
      return `Token da conta ${accountName} (${platformName}) foi renovado preventivamente para evitar expiração.`;
    default:
      return `Token da conta ${accountName} (${platformName}) foi atualizado.`;
  }
}
