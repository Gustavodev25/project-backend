import { PrismaClient } from "@prisma/client";

// Evita múltiplas instâncias no hot-reload do Next (dev)
declare global {

  var __prisma__: PrismaClient | undefined;
}

let prisma: PrismaClient;

// Configuração otimizada de connection pooling para Vercel Serverless
// Connection pool configurado para balance entre performance e limits do database
const connectionUrl = process.env.DATABASE_URL
  ? `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=10&pool_timeout=20&connect_timeout=10`
  : undefined;

const prismaConfig = {
  log: ["warn", "error"] as const,
  datasources: {
    db: {
      url: connectionUrl
    }
  },
};

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient(prismaConfig);
} else {
  if (!globalThis.__prisma__) {
    globalThis.__prisma__ = new PrismaClient(prismaConfig);
  }
  prisma = globalThis.__prisma__;
}

// Garantir que conexões sejam fechadas corretamente no shutdown
if (typeof window === 'undefined') {
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
}

export default prisma;
export { prisma };
