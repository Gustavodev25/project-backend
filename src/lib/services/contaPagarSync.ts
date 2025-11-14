import { prisma } from "@/lib/prisma";
import { getBlingContaPagarById, getBlingContasPagar } from "@/lib/bling";

type NotificationType = 'success' | 'error' | 'info' | 'warning';

type NotificationHandler = (notification: {
  type: NotificationType;
  title: string;
  message: string;
  duration?: number;
}) => void;

type SyncOptions = {
  userId: string;
  accessToken: string;
  onProgress?: (progress: { current: number; total: number; message: string }) => void;
  onNotification?: NotificationHandler;
};

export class ContaPagarSyncService {
  private userId: string;
  private accessToken: string;
  private onProgress: SyncOptions['onProgress'];
  private onNotification?: NotificationHandler;
  private processedAccounts = new Set<string>();
  private stats = {
    created: 0,
    updated: 0,
    skipped: 0,
    errored: 0,
    total: 0,
  };

  constructor({ userId, accessToken, onProgress, onNotification }: SyncOptions) {
    this.userId = userId;
    this.accessToken = accessToken;
    this.onProgress = onProgress;
    this.onNotification = onNotification;
  }

  private updateProgress(message: string, current?: number, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    const currentCount = current ?? this.stats.created + this.stats.updated + this.stats.skipped + this.stats.errored;
    const progress = Math.min(100, Math.round((currentCount / Math.max(1, this.stats.total)) * 100));
    
    if (this.onProgress) {
      this.onProgress({
        current: currentCount,
        total: this.stats.total,
        message,
      });
    }

    // Only show notifications for important events or errors
    if (this.onNotification) {
      const title = type === 'error' ? 'Erro na sincronização' :
                  type === 'warning' ? 'Aviso' :
                  type === 'success' ? 'Sucesso' : 'Sincronizando';
      
      this.onNotification({
        type,
        title,
        message: `${message} (${progress}%)`,
        duration: type === 'error' || type === 'success' ? 5000 : type === 'warning' ? 3000 : 2000
      });
    }
  }

  private async processContaPagar(contaBling: any, index: number) {
    try {
      // Skip if we've already processed this account in this sync
      if (this.processedAccounts.has(contaBling.id.toString())) {
        this.stats.skipped++;
        return;
      }

      this.processedAccounts.add(contaBling.id.toString());

      // Find existing account by blingId
      const existingAccount = await prisma.contaPagar.findFirst({
        where: {
          userId: this.userId,
          blingId: contaBling.id.toString(),
        },
        include: {
          categoria: true,
          formaPagamento: true,
        },
      });

      // Get or create category
      let categoriaId = null;
      if (contaBling.categoria?.id) {
        const categoria = await prisma.categoria.upsert({
          where: {
            userId_blingId: {
              userId: this.userId,
              blingId: contaBling.categoria.id.toString(),
            },
          },
          create: {
            userId: this.userId,
            blingId: contaBling.categoria.id.toString(),
            nome: `Categoria ${contaBling.categoria.id}`, // Default name, will be updated in next sync
            tipo: 'despesa',
          },
          update: {},
        });
        categoriaId = categoria.id;
      }

      // Get or create payment method
      let formaPagamentoId = null;
      if (contaBling.formaPagamento?.id) {
        const formaPagamento = await prisma.formaPagamento.upsert({
          where: {
            userId_blingId: {
              userId: this.userId,
              blingId: contaBling.formaPagamento.id.toString(),
            },
          },
          create: {
            userId: this.userId,
            blingId: contaBling.formaPagamento.id.toString(),
            nome: `Forma ${contaBling.formaPagamento.id}`, // Default name
            ativo: true,
          },
          update: {},
        });
        formaPagamentoId = formaPagamento.id;
      }

      // Determine status based on payment date and due date
      const dataVencimento = new Date(contaBling.vencimento);
      const dataPagamento = contaBling.dataPagamento ? new Date(contaBling.dataPagamento) : null;
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      
      let status = 'pendente';
      if (dataPagamento) {
        status = 'pago';
      } else if (dataVencimento < hoje) {
        status = 'vencido';
      }

      // Prepare data for upsert
      const contaData = {
        descricao: contaBling.historico || `Conta #${contaBling.id}`,
        valor: parseFloat(contaBling.valor),
        dataVencimento: dataVencimento,
        dataPagamento: dataPagamento,
        status,
        categoriaId,
        formaPagamentoId,
        atualizadoEm: new Date(),
      };

      if (existingAccount) {
        // Skip if no changes
        if (
          existingAccount.descricao === contaData.descricao &&
          existingAccount.valor === contaData.valor &&
          existingAccount.dataVencimento.getTime() === contaData.dataVencimento.getTime() &&
          existingAccount.status === contaData.status &&
          existingAccount.categoriaId === contaData.categoriaId &&
          existingAccount.formaPagamentoId === contaData.formaPagamentoId
        ) {
          this.stats.skipped++;
          return;
        }

        // Update existing account
        await prisma.contaPagar.update({
          where: { id: existingAccount.id },
          data: contaData,
        });
        this.stats.updated++;
        this.updateProgress(`Atualizada conta: ${contaData.descricao}`);
      } else {
        // Create new account
        await prisma.contaPagar.create({
          data: {
            ...contaData,
            userId: this.userId,
            blingId: contaBling.id.toString(),
          },
        });
        this.stats.created++;
        this.updateProgress(`Nova conta adicionada: ${contaData.descricao}`);
      }
    } catch (error) {
      console.error(`[ContaPagarSync] Erro ao processar conta ${contaBling.id}:`, error);
      this.stats.errored++;
      this.updateProgress(`Erro ao processar conta ${contaBling.id}`);
    }
  }

  public async sync() {
    const startTime = Date.now();
    this.updateProgress('🔍 Iniciando sincronização de contas a pagar...', 0, 'info');
    
    try {
      // Get all accounts from Bling
      this.updateProgress('🔄 Buscando contas no Bling...', 0, 'info');
      const contasBling = await getBlingContasPagar(this.accessToken);
      this.stats.total = contasBling.length;
      
      if (contasBling.length === 0) {
        this.updateProgress('ℹ️ Nenhuma conta a pagar encontrada no Bling', 0, 'info');
        return {
          success: true,
          stats: this.stats,
          message: 'Nenhuma conta a pagar encontrada para sincronização'
        };
      }

      this.updateProgress(`🔍 Encontradas ${this.stats.total} contas no Bling`, 0, 'info');

      // Process each account with progress updates
      for (let i = 0; i < contasBling.length; i++) {
        const contaBling = contasBling[i];
        try {
          await this.processContaPagar(contaBling, i);
          
          // Update progress every 5 accounts or if it's the last one
          if (i % 5 === 0 || i === contasBling.length - 1) {
            const progress = i + 1;
            const progressPercent = Math.round((progress / contasBling.length) * 100);
            this.updateProgress(
              `🔄 Processando contas... (${progress}/${contasBling.length})`,
              progress,
              'info'
            );
          }
        } catch (error) {
          console.error(`[ContaPagarSync] Erro ao processar conta ${i + 1}/${contasBling.length}:`, error);
          this.stats.errored++;
          this.updateProgress(
            `❌ Erro ao processar conta ${i + 1}/${contasBling.length}`,
            i + 1,
            'error'
          );
        }
      }

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(1);
      
      // Prepare summary message
      const summary = [
        this.stats.created > 0 ? `${this.stats.created} novas` : null,
        this.stats.updated > 0 ? `${this.stats.updated} atualizadas` : null,
        this.stats.skipped > 0 ? `${this.stats.skipped} sem alterações` : null,
        this.stats.errored > 0 ? `${this.stats.errored} com erro` : null
      ].filter(Boolean).join(', ');

      // Show success/warning based on results
      const hasErrors = this.stats.errored > 0;
      const noChanges = this.stats.created === 0 && this.stats.updated === 0;
      
      if (hasErrors) {
        this.updateProgress(
          `⚠️ Sincronização concluída com ${this.stats.errored} erro(s) em ${duration}s`,
          contasBling.length,
          'warning'
        );
      } else if (noChanges) {
        this.updateProgress(
          '✅ Nenhuma alteração necessária',
          contasBling.length,
          'info'
        );
      } else {
        this.updateProgress(
          `✅ Sincronização concluída em ${duration}s`,
          contasBling.length,
          'success'
        );
      }

      console.log('[ContaPagarSync] Sincronização concluída:', {
        ...this.stats,
        duration: `${duration}s`
      });

      return {
        success: !hasErrors,
        stats: this.stats,
        duration: `${duration}s`,
        message: `Sincronização concluída: ${summary}`
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      console.error('[ContaPagarSync] Erro durante a sincronização:', error);
      
      this.updateProgress(
        `❌ Falha na sincronização: ${errorMessage}`,
        this.stats.total,
        'error'
      );
      
      return {
        success: false,
        error: errorMessage,
        stats: this.stats,
        message: `Falha na sincronização: ${errorMessage}`
      };
    }
  }
}

// Helper function to sync a single account by ID
export async function syncContaPagarById(
  userId: string,
  accessToken: string,
  contaId: string,
  onNotification?: NotificationHandler
) {
  try {
    const contaBling = await getBlingContaPagarById(accessToken, parseInt(contaId));
    if (!contaBling) {
      return { success: false, error: 'Conta não encontrada no Bling' };
    }

    const syncService = new ContaPagarSyncService({
      userId,
      accessToken,
      onNotification
    });

    await syncService.processContaPagar(contaBling);
    return { success: true };
  } catch (error) {
    console.error(`[syncContaPagarById] Erro ao sincronizar conta ${contaId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}
