import { PrismaClient } from "@prisma/client";

// Evita múltiplas instâncias no hot-reload do Next (dev)
declare global {
  var __prisma__: PrismaClient | undefined;
}

let prismaInstance: PrismaClient | undefined;

/**
 * Obtém a instância singleton do Prisma Client com inicialização lazy
 * Isso garante que o cliente só é inicializado quando realmente necessário,
 * evitando erros durante o build quando DATABASE_URL não está disponível
 */
function getPrismaClient(): PrismaClient {
  // Retornar instância global se já existe (development)
  if (typeof globalThis !== "undefined" && globalThis.__prisma__) {
    return globalThis.__prisma__;
  }

  // Verificar se já foi criada nesta execução
  if (prismaInstance) {
    return prismaInstance;
  }

  // Configuração otimizada de connection pooling para Vercel Serverless
  // Connection pool configurado para balance entre performance e limits do database
  const connectionUrl = process.env.DATABASE_URL
    ? `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=10&pool_timeout=20&connect_timeout=10`
    : undefined;

  const prismaConfig = {
    log: ["warn", "error"] as const,
    ...(connectionUrl ? {
      datasources: {
        db: {
          url: connectionUrl
        }
      }
    } : {})
  };

  // Criar nova instância
  const client = new PrismaClient(prismaConfig);

  // Armazenar referência global em dev
  if (process.env.NODE_ENV !== "production" && typeof globalThis !== "undefined") {
    globalThis.__prisma__ = client;
  }

  prismaInstance = client;
  return client;
}

// Proxy para a instância com lazy initialization
const prisma = new Proxy(
  {},
  {
    get: (_, prop) => {
      const client = getPrismaClient();
      return (client as any)[prop];
    },
  }
) as PrismaClient;

// Garantir que conexões sejam fechadas corretamente no shutdown
if (typeof window === "undefined") {
  process.on("beforeExit", async () => {
    if (prismaInstance) {
      await prismaInstance.$disconnect();
    }
  });
}

export default prisma;
export { prisma, getPrismaClient };
