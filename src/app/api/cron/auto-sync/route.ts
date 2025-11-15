import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { refreshMeliAccountToken } from "@/lib/meli";

// Chave de segurança para o cron (deve estar no .env)
const CRON_SECRET = process.env.CRON_SECRET || "change-me-in-production";

export async function POST(req: NextRequest) {
  try {
    // Verificar autenticação do cron
    const authHeader = req.headers.get("authorization");
    const providedSecret = authHeader?.replace("Bearer ", "");

    if (providedSecret !== CRON_SECRET) {
      return NextResponse.json(
        { error: "Não autorizado" },
        { status: 401 }
      );
    }

    console.log("[CRON] Iniciando sincronização automática...");

    // Buscar todos os usuários que têm auto-sync ativado
    const usersWithAutoSync = await prisma.userSettings.findMany({
      where: { autoSyncEnabled: true },
      include: {
        user: {
          include: {
            meliAccounts: true,
          },
        },
      },
    });

    console.log(`[CRON] ${usersWithAutoSync.length} usuários com auto-sync ativado`);

    const results = [];

    for (const userSettings of usersWithAutoSync) {
      const user = userSettings.user;
      
      try {
        console.log(`[CRON] Sincronizando vendas para usuário ${user.email}...`);

        let totalNewOrders = 0;
        const errors = [];

        // Buscar contas ativas do Mercado Livre
        const activeAccounts = user.meliAccounts.filter(
          (acc) => new Date(acc.expires_at).getTime() > Date.now()
        );

        if (activeAccounts.length === 0) {
          console.log(`[CRON] Usuário ${user.email} não tem contas ativas`);
          continue;
        }

        // Para cada conta, buscar vendas
        for (const account of activeAccounts) {
          try {
            // Atualizar token se necessário
            const refreshedAccount = await refreshMeliAccountToken(account);
            const access_token = refreshedAccount.access_token;

            // Buscar pedidos dos últimos 30 dias
            const since = new Date();
            since.setDate(since.getDate() - 30);
            const sinceISO = since.toISOString();

            const searchUrl = `https://api.mercadolibre.com/orders/search?seller=${account.ml_user_id}&order.date_created.from=${sinceISO}&sort=date_desc&limit=50`;

            const response = await fetch(searchUrl, {
              headers: {
                Authorization: `Bearer ${access_token}`,
              },
            });

            if (!response.ok) {
              throw new Error(`Erro ${response.status} ao buscar pedidos`);
            }

            const data = await response.json();
            const orders = data.results || [];

            console.log(`[CRON] Conta ${account.nickname}: ${orders.length} pedidos encontrados`);

            // Verificar quais são novos
            for (const order of orders) {
              const orderId = String(order.id);
              
              // Verificar se já existe no banco
              const existing = await prisma.meliVenda.findUnique({
                where: { orderId },
              });

              if (!existing) {
                totalNewOrders++;
                
                // Aqui você pode adicionar a lógica completa de salvar a venda
                // Por agora, vou apenas contar as novas vendas
                console.log(`[CRON] Nova venda encontrada: ${orderId}`);
              }
            }
          } catch (error) {
            console.error(`[CRON] Erro ao processar conta ${account.nickname}:`, error);
            errors.push({
              accountId: account.id,
              mlUserId: account.ml_user_id,
              message: error instanceof Error ? error.message : "Erro desconhecido",
            });
          }
        }

        // Se houver novas vendas, criar notificação
        if (totalNewOrders > 0) {
          await prisma.syncNotification.create({
            data: {
              userId: user.id,
              type: "new_orders",
              title: "Novas vendas encontradas!",
              message: `${totalNewOrders} ${totalNewOrders === 1 ? "nova venda foi encontrada" : "novas vendas foram encontradas"} no Mercado Livre.`,
              newOrdersCount: totalNewOrders,
              metadata: {
                accounts: activeAccounts.map((a) => ({
                  id: a.id,
                  nickname: a.nickname,
                })),
              },
            },
          });

          console.log(`[CRON] Notificação criada para ${user.email}: ${totalNewOrders} novas vendas`);
        }

        // Atualizar timestamp da última sincronização automática
        await prisma.userSettings.update({
          where: { id: userSettings.id },
          data: { lastAutoSyncAt: new Date() },
        });

        results.push({
          userId: user.id,
          email: user.email,
          newOrders: totalNewOrders,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        console.error(`[CRON] Erro ao processar usuário ${user.email}:`, error);
        results.push({
          userId: user.id,
          email: user.email,
          error: error instanceof Error ? error.message : "Erro desconhecido",
        });
      }
    }

    console.log("[CRON] Sincronização automática concluída");

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      processedUsers: results.length,
      results,
    });
  } catch (error) {
    console.error("[CRON] Erro geral:", error);
    return NextResponse.json(
      {
        error: "Erro ao executar sincronização automática",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 }
    );
  }
}

// Permitir GET também para testes (remover em produção)
export async function GET(req: NextRequest) {
  return POST(req);
}
