import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { refreshMeliAccountToken } from "@/lib/meli";
import { refreshShopeeAccountToken } from "@/lib/shopee";
import { refreshBlingAccountToken } from "@/lib/bling";
import { sendTokenRefreshNotification, createTokenRefreshMessage } from "@/lib/notifications";
import { isAccountMarkedAsInvalid } from "@/lib/account-status";

const CRON_SECRET = process.env.CRON_SECRET || "change-me-in-production";

export async function POST(req: NextRequest) {
  try {
    // Verificar autorização
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (token !== CRON_SECRET) {
      return NextResponse.json(
        { error: "Não autorizado" },
        { status: 401 }
      );
    }

    const results = {
      meliRefreshed: 0,
      meliErrors: 0,
      meliReactivated: 0,
      meliPreventive: 0,
      shopeeRefreshed: 0,
      shopeeErrors: 0,
      shopeeReactivated: 0,
      shopeePreventive: 0,
      blingRefreshed: 0,
      blingErrors: 0,
      blingReactivated: 0,
      blingPreventive: 0,
      errors: [] as string[],
    };

    // Renovar tokens do Mercado Livre
    const meliAccounts = await prisma.meliAccount.findMany();

    for (const account of meliAccounts) {
      try {
        // Pular contas marcadas como inválidas
        if (await isAccountMarkedAsInvalid(account.id, 'meli')) {
          console.log(`⏭️ Pulando conta ML ${account.ml_user_id} - marcada como inválida`);
          continue;
        }

        const now = new Date();
        const expiresAt = new Date(account.expires_at);
        const timeUntilExpiry = expiresAt.getTime() - now.getTime();
        const isExpired = timeUntilExpiry <= 0;
        const needsPreventiveRefresh = timeUntilExpiry <= (2 * 60 * 60 * 1000); // 2 horas antes de expirar

        // Renovar se expirado ou se precisa de renovação preventiva
        if (isExpired || needsPreventiveRefresh) {
          await refreshMeliAccountToken(account, true);
          results.meliRefreshed++;
          
          if (isExpired) {
            results.meliReactivated++;
            console.log(`🔄 Token Mercado Livre REATIVADO para conta ${account.ml_user_id}`);
            
            // Enviar notificação de reativação
            await sendTokenRefreshNotification({
              userId: account.userId,
              platform: 'Mercado Livre',
              accountId: account.id,
              accountName: String(account.ml_user_id) || 'Conta ML',
              action: 'reactivated',
              message: createTokenRefreshMessage('Mercado Livre', String(account.ml_user_id) || 'Conta ML', 'reactivated'),
            });
          } else if (needsPreventiveRefresh) {
            results.meliPreventive++;
            console.log(`🛡️ Token Mercado Livre renovado preventivamente para conta ${account.ml_user_id}`);
            
            // Enviar notificação preventiva
            await sendTokenRefreshNotification({
              userId: account.userId,
              platform: 'Mercado Livre',
              accountId: account.id,
              accountName: String(account.ml_user_id) || 'Conta ML',
              action: 'preventive',
              message: createTokenRefreshMessage('Mercado Livre', String(account.ml_user_id) || 'Conta ML', 'preventive'),
            });
          }
        }
      } catch (error) {
        results.meliErrors++;
        const errorMsg = `Erro ao renovar token ML para conta ${account.ml_user_id}: ${error}`;
        results.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    // Renovar tokens da Shopee
    const shopeeAccounts = await prisma.shopeeAccount.findMany();

    for (const account of shopeeAccounts) {
      try {
        const now = new Date();
        const expiresAt = new Date(account.expires_at);
        const timeUntilExpiry = expiresAt.getTime() - now.getTime();
        const isExpired = timeUntilExpiry <= 0;
        const needsPreventiveRefresh = timeUntilExpiry <= (2 * 60 * 60 * 1000); // 2 horas antes de expirar

        // Renovar se expirado ou se precisa de renovação preventiva
        if (isExpired || needsPreventiveRefresh) {
          await refreshShopeeAccountToken(account, true);
          results.shopeeRefreshed++;
          
          if (isExpired) {
            results.shopeeReactivated++;
            console.log(`🔄 Token Shopee REATIVADO para shop ${account.shop_id}`);
            
            // Enviar notificação de reativação
            await sendTokenRefreshNotification({
              userId: account.userId,
              platform: 'Shopee',
              accountId: account.id,
              accountName: account.shop_name || account.shop_id,
              action: 'reactivated',
              message: createTokenRefreshMessage('Shopee', account.shop_name || account.shop_id, 'reactivated'),
            });
          } else if (needsPreventiveRefresh) {
            results.shopeePreventive++;
            console.log(`🛡️ Token Shopee renovado preventivamente para shop ${account.shop_id}`);
            
            // Enviar notificação preventiva
            await sendTokenRefreshNotification({
              userId: account.userId,
              platform: 'Shopee',
              accountId: account.id,
              accountName: account.shop_name || account.shop_id,
              action: 'preventive',
              message: createTokenRefreshMessage('Shopee', account.shop_name || account.shop_id, 'preventive'),
            });
          }
        }
      } catch (error) {
        results.shopeeErrors++;
        const errorMsg = `Erro ao renovar token Shopee para shop ${account.shop_id}: ${error}`;
        results.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    // Renovar tokens do Bling
    const blingAccounts = await prisma.blingAccount.findMany();
    for (const account of blingAccounts) {
      try {
        const now = new Date();
        const expiresAt = new Date(account.expires_at);
        const timeUntilExpiry = expiresAt.getTime() - now.getTime();
        const isExpired = timeUntilExpiry <= 0;
        const needsPreventiveRefresh = timeUntilExpiry <= (2 * 60 * 60 * 1000); // 2 horas antes de expirar

        // Renovar se expirado ou se precisa de renovação preventiva
        if (isExpired || needsPreventiveRefresh) {
          await refreshBlingAccountToken(account, true);
          results.blingRefreshed++;
          
          if (isExpired) {
            results.blingReactivated++;
            console.log(`🔄 Token Bling REATIVADO para conta ${account.bling_user_id || account.id}`);
            
            // Enviar notificação de reativação
            await sendTokenRefreshNotification({
              userId: account.userId,
              platform: 'Bling',
              accountId: account.id,
              accountName: account.bling_user_id || 'Conta Bling',
              action: 'reactivated',
              message: createTokenRefreshMessage('Bling', account.bling_user_id || 'Conta Bling', 'reactivated'),
            });
          } else if (needsPreventiveRefresh) {
            results.blingPreventive++;
            console.log(`🛡️ Token Bling renovado preventivamente para conta ${account.bling_user_id || account.id}`);
            
            // Enviar notificação preventiva
            await sendTokenRefreshNotification({
              userId: account.userId,
              platform: 'Bling',
              accountId: account.id,
              accountName: account.bling_user_id || 'Conta Bling',
              action: 'preventive',
              message: createTokenRefreshMessage('Bling', account.bling_user_id || 'Conta Bling', 'preventive'),
            });
          }
        }
      } catch (error) {
        results.blingErrors++;
        const errorMsg = `Erro ao renovar token Bling para conta ${account.bling_user_id || account.id}: ${error}`;
        results.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    console.log("[CRON] Renovação preventiva de tokens concluída:", results);

    return NextResponse.json({
      success: true,
      message: "Renovação preventiva de tokens concluída",
      results,
    });

  } catch (error) {
    console.error("[CRON] Erro ao renovar tokens:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 }
    );
  }
}