const CRON_SECRET = process.env.CRON_SECRET || "change-me-in-production";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export async function startCronJobs() {
  const { default: cron } = await import("node-cron");

  // Executar a cada 10 minutos
  const autoSyncJob = cron.schedule("*/10 * * * *", async () => {
    try {
      console.log("[CRON] Executando sincronização automática...");

      const response = await fetch(`${API_URL}/api/cron/auto-sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CRON_SECRET}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = (await response.json()) as unknown;
      console.log("[CRON] Sincronização concluída:", result);
    } catch (error) {
      console.error("[CRON] Erro ao executar sincronização:", error);
    }
  });

  // Executar renovação de tokens a cada 30 minutos (renovação preventiva)
  const tokenRefreshJob = cron.schedule("*/30 * * * *", async () => {
    try {
      console.log("[CRON] Executando renovação preventiva de tokens...");

      const response = await fetch(`${API_URL}/api/cron/refresh-tokens`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CRON_SECRET}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = (await response.json()) as unknown;
      console.log("[CRON] Renovação preventiva de tokens concluída:", result);
    } catch (error) {
      console.error("[CRON] Erro ao renovar tokens:", error);
    }
  });

  console.log("✅ Cron job de sincronização automática iniciado (a cada 10 minutos)");
  console.log("✅ Cron job de renovação preventiva de tokens iniciado (a cada 30 minutos)");

  return {
    autoSyncJob,
    tokenRefreshJob,
    stop: () => {
      autoSyncJob.stop();
      tokenRefreshJob.stop();
      console.log("⏹️ Cron jobs parados");
    },
  };
}

