import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const count = await prisma.user.count();
    console.log('Total de usuários no banco:', count);

    if (count > 0) {
      const users = await prisma.user.findMany({
        select: { id: true, email: true, name: true }
      });
      console.log('Usuários:', JSON.stringify(users, null, 2));
    }
  } catch (error) {
    console.error('Erro:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
