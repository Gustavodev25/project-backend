import prisma from "@/lib/prisma";

/**
 * Marca uma conta como tendo refresh token inválido
 * Isso evita tentativas desnecessárias de renovação
 */
export async function markAccountAsInvalid(accountId: string, platform: 'meli' | 'shopee' | 'bling') {
  try {
    const now = new Date();
    const invalidUntil = new Date(now.getTime() + (24 * 60 * 60 * 1000)); // 24 horas

    switch (platform) {
      case 'meli':
        await prisma.meliAccount.update({
          where: { id: accountId },
          data: {
            refresh_token_invalid_until: invalidUntil,
            updated_at: now,
          },
        });
        break;
      case 'shopee':
        await prisma.shopeeAccount.update({
          where: { id: accountId },
          data: {
            refresh_token_invalid_until: invalidUntil,
            updated_at: now,
          },
        });
        break;
      case 'bling':
        await prisma.blingAccount.update({
          where: { id: accountId },
          data: {
            refresh_token_invalid_until: invalidUntil,
            updated_at: now,
          },
        });
        break;
    }

    console.log(`🔴 Conta ${platform} ${accountId} marcada como inválida até ${invalidUntil.toISOString()}`);
  } catch (error) {
    console.error(`Erro ao marcar conta ${platform} ${accountId} como inválida:`, error);
  }
}

/**
 * Verifica se uma conta está marcada como inválida
 */
export async function isAccountMarkedAsInvalid(accountId: string, platform: 'meli' | 'shopee' | 'bling'): Promise<boolean> {
  try {
    const now = new Date();
    let account: any = null;

    switch (platform) {
      case 'meli':
        account = await prisma.meliAccount.findUnique({
          where: { id: accountId },
          select: { refresh_token_invalid_until: true },
        });
        break;
      case 'shopee':
        account = await prisma.shopeeAccount.findUnique({
          where: { id: accountId },
          select: { refresh_token_invalid_until: true },
        });
        break;
      case 'bling':
        account = await prisma.blingAccount.findUnique({
          where: { id: accountId },
          select: { refresh_token_invalid_until: true },
        });
        break;
    }

    if (!account?.refresh_token_invalid_until) {
      return false;
    }

    const invalidUntil = new Date(account.refresh_token_invalid_until);
    return invalidUntil > now;
  } catch (error) {
    console.error(`Erro ao verificar se conta ${platform} ${accountId} está marcada como inválida:`, error);
    return false;
  }
}

/**
 * Limpa a marcação de inválido de uma conta (quando reconectada)
 */
export async function clearAccountInvalidMark(accountId: string, platform: 'meli' | 'shopee' | 'bling') {
  try {
    const now = new Date();

    switch (platform) {
      case 'meli':
        await prisma.meliAccount.update({
          where: { id: accountId },
          data: {
            refresh_token_invalid_until: null,
            updated_at: now,
          },
        });
        break;
      case 'shopee':
        await prisma.shopeeAccount.update({
          where: { id: accountId },
          data: {
            refresh_token_invalid_until: null,
            updated_at: now,
          },
        });
        break;
      case 'bling':
        await prisma.blingAccount.update({
          where: { id: accountId },
          data: {
            refresh_token_invalid_until: null,
            updated_at: now,
          },
        });
        break;
    }

    console.log(`✅ Conta ${platform} ${accountId} marcada como válida novamente`);
  } catch (error) {
    console.error(`Erro ao limpar marcação de inválido da conta ${platform} ${accountId}:`, error);
  }
}
