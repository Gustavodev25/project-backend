import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { tryVerifySessionToken } from "@/lib/auth";
import { getBlingFormasPagamento, refreshBlingAccountToken } from "@/lib/bling";

export const runtime = "nodejs";

export async function POST(_request: Request) {
  try {
    console.log(`[Sync] Iniciando sincronização de formas de pagamento...`);

    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session");

    if (!sessionCookie?.value) {
      console.log(`[Sync] Erro: Não autenticado`);
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Verificar o token JWT de sessão
    const session = await tryVerifySessionToken(sessionCookie.value);

    if (!session) {
      console.log(`[Sync] Erro: Sessão inválida ou expirada`);
      return NextResponse.json({ error: "Sessão inválida ou expirada" }, { status: 401 });
    }

    const userId = session.sub;
    console.log(`[Sync] Usuário autenticado: ${userId}`);

    // Buscar conta do Bling (mesmo expirada) e tentar renovar automaticamente
    console.log(`[Sync] Buscando conta Bling (ativa ou expirada) para usuário ${userId}...`);
    const blingAccount = await prisma.blingAccount.findFirst({
      where: { userId },
      orderBy: { updated_at: "desc" },
    });

    if (!blingAccount) {
      console.log(`[Sync] Erro: Nenhuma conta Bling conectada para o usuário`);
      return NextResponse.json(
        { error: "Nenhuma conta Bling conectada. Conecte sua conta primeiro." },
        { status: 404 },
      );
    }

    const isExpired = new Date(blingAccount.expires_at) <= new Date();
    console.log(`[Sync] Conta Bling encontrada: ${blingAccount.id} (expirada=${isExpired})`);

    // Renovar token: força renovação se expirado
    let refreshedAccount;
    try {
      refreshedAccount = await refreshBlingAccountToken(blingAccount, isExpired);
    } catch (error: unknown) {
      console.error("Erro ao renovar token Bling:", error);

      // Se o erro for de token inválido, remover a conta e pedir reconexão
      if (
        error instanceof Error &&
        (error.message?.includes("invalid_token") || error.message?.includes("invalid_grant"))
      ) {
        await prisma.blingAccount.delete({ where: { id: blingAccount.id } });

        return NextResponse.json(
          {
            error:
              "Tokens do Bling expirados. Reconecte sua conta Bling para continuar.",
            requiresReconnection: true,
          },
          { status: 401 },
        );
      }

      throw error;
    }

    // Buscar formas de pagamento do Bling
    console.log(`[Sync] Buscando formas de pagamento para usuário ${userId}...`);
    const formasPagamentoBling = await getBlingFormasPagamento(
      refreshedAccount.access_token,
    );
    console.log(
      `[Sync] Encontradas ${formasPagamentoBling.length} formas de pagamento do Bling`,
    );

    let syncedCount = 0;
    const errors: string[] = [];

    // Sincronizar cada forma de pagamento
    console.log(
      `[Sync] Iniciando sincronização de ${formasPagamentoBling.length} formas de pagamento...`,
    );
    await Promise.all(formasPagamentoBling.map(async (formaBling) => {
      try {
        const blingId = formaBling.id?.toString?.();
        if (!blingId) {
          console.log(
            `[Sync] Forma de pagamento sem ID válido, pulando:`,
            formaBling,
          );
          return;
        }

        console.log(
          `[Sync] Sincronizando forma de pagamento: ${
            formaBling.nome || formaBling.descricao
          } (ID: ${blingId})`,
        );

        await prisma.formaPagamento.upsert({
          where: {
            userId_blingId: {
              userId: userId,
              blingId,
            },
          },
          update: {
            nome: formaBling.nome || formaBling.descricao || "Forma de Pagamento",
            descricao: formaBling.descricao || null,
            tipo: formaBling.tipo || null,
            ativo: formaBling.situacao !== "inativo",
            atualizadoEm: new Date(),
          },
          create: {
            userId: userId,
            blingId,
            nome: formaBling.nome || formaBling.descricao || "Forma de Pagamento",
            descricao: formaBling.descricao || null,
            tipo: formaBling.tipo || null,
            ativo: formaBling.situacao !== "inativo",
          },
        });
        syncedCount++;
        console.log(
          `[Sync] Forma de pagamento sincronizada com sucesso: ${
            formaBling.nome || formaBling.descricao
          }`,
        );
      } catch (error) {
        console.error(
          `[Sync] Erro ao sincronizar forma de pagamento ${formaBling.id}:`,
          error,
        );
        errors.push(
          `Erro ao sincronizar ${formaBling.nome || formaBling.id}: ${error}`,
        );
      }
    }));

    return NextResponse.json({
      success: true,
      message: `Formas de pagamento sincronizadas com sucesso`,
      data: {
        synced: syncedCount,
        total: formasPagamentoBling.length,
        errors: errors,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Erro ao sincronizar formas de pagamento:", error);

    // Log mais detalhado do erro
    if (error instanceof Error) {
      console.error("Erro detalhado:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    } else {
      console.error("Erro não é uma instância de Error:", error);
    }

    return NextResponse.json(
      {
        error: `Erro ao sincronizar formas de pagamento: ${
          error instanceof Error ? error.message : String(error)
        }`,
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
