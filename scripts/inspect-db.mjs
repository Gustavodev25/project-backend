import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const userId = process.argv[2];
  console.log('DB URL:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown');

  const totalMeli = await prisma.meliVenda.count();
  const totalShopee = await prisma.shopeeVenda.count();
  console.log('Totals:', { totalMeli, totalShopee, total: totalMeli + totalShopee });

  if (userId) {
    const userMeli = await prisma.meliVenda.count({ where: { userId } });
    const userShopee = await prisma.shopeeVenda.count({ where: { userId } });
    console.log('User totals:', { userId, userMeli, userShopee, total: userMeli + userShopee });

    const firstMeli = await prisma.meliVenda.findFirst({ where: { userId }, select: { dataVenda: true }, orderBy: { dataVenda: 'asc' } });
    const lastMeli = await prisma.meliVenda.findFirst({ where: { userId }, select: { dataVenda: true }, orderBy: { dataVenda: 'desc' } });
    const firstShopee = await prisma.shopeeVenda.findFirst({ where: { userId }, select: { dataVenda: true }, orderBy: { dataVenda: 'asc' } });
    const lastShopee = await prisma.shopeeVenda.findFirst({ where: { userId }, select: { dataVenda: true }, orderBy: { dataVenda: 'desc' } });
    console.log('User date range:', {
      meli: { first: firstMeli?.dataVenda, last: lastMeli?.dataVenda },
      shopee: { first: firstShopee?.dataVenda, last: lastShopee?.dataVenda },
    });

    // Sample statuses
    const meliStatuses = await prisma.meliVenda.findMany({ where: { userId }, select: { status: true }, take: 2000 });
    const shopeeStatuses = await prisma.shopeeVenda.findMany({ where: { userId }, select: { status: true }, take: 2000 });
    const countMap = (arr) => arr.reduce((map, x) => { const k = (x.status || '').toLowerCase(); map[k] = (map[k]||0)+1; return map; }, {});
    console.log('Status samples (meli):', Object.entries(countMap(meliStatuses)).slice(0,10));
    console.log('Status samples (shopee):', Object.entries(countMap(shopeeStatuses)).slice(0,10));
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
