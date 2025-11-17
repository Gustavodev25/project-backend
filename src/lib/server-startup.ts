let cronJobsStarted = false;

export async function initializeServer() {
  // Iniciar cron jobs apenas uma vez
  if (!cronJobsStarted) {
    try {
      const { startCronJobs } = await import("./cron");
      await startCronJobs();
      cronJobsStarted = true;
      
      if (process.env.NODE_ENV === "development") {
        console.log("✅ Cron jobs iniciados em desenvolvimento para testes");
      }
    } catch (err) {
      console.error("[CRON] Falha ao iniciar cron jobs:", err);
    }
  }
}

