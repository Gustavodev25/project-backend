import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function findAndFixDuplicates() {
  console.log('🔍 Procurando SKUs duplicados...\n');

  try {
    // Buscar todos os SKUs
    const allSkus = await prisma.sKU.findMany({
      select: {
        id: true,
        userId: true,
        sku: true,
        produto: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc', // Mais antigos primeiro
      },
    });

    console.log(`📊 Total de SKUs no banco: ${allSkus.length}\n`);

    // Agrupar por userId + sku para encontrar duplicatas
    const skuGroups = new Map<string, typeof allSkus>();

    for (const sku of allSkus) {
      const key = `${sku.userId}_${sku.sku}`;
      if (!skuGroups.has(key)) {
        skuGroups.set(key, []);
      }
      skuGroups.get(key)!.push(sku);
    }

    // Encontrar duplicatas
    const duplicates = Array.from(skuGroups.entries()).filter(
      ([_, group]) => group.length > 1
    );

    if (duplicates.length === 0) {
      console.log('✅ Nenhuma duplicata encontrada!\n');
      return;
    }

    console.log(`⚠️  Encontradas ${duplicates.length} SKUs com duplicatas:\n`);

    // Mostrar duplicatas
    for (const [key, group] of duplicates) {
      console.log(`SKU: ${group[0].sku}`);
      console.log(`  Produto: ${group[0].produto}`);
      console.log(`  Registros duplicados: ${group.length}`);
      group.forEach((sku, index) => {
        console.log(`    ${index + 1}. ID: ${sku.id} | Criado em: ${sku.createdAt}`);
      });
      console.log('');
    }

    // Perguntar se deve remover duplicatas
    console.log('🗑️  Removendo duplicatas (mantendo o registro mais antigo)...\n');

    let totalRemoved = 0;

    for (const [key, group] of duplicates) {
      // Manter o primeiro (mais antigo), remover o resto
      const toKeep = group[0];
      const toDelete = group.slice(1);

      console.log(`Mantendo: ${toKeep.id} (${toKeep.sku})`);

      for (const sku of toDelete) {
        console.log(`  Removendo: ${sku.id}`);

        try {
          // Remover histórico de custos primeiro (foreign key)
          await prisma.sKUCustoHistorico.deleteMany({
            where: { skuId: sku.id },
          });

          // Remover o SKU
          await prisma.sKU.delete({
            where: { id: sku.id },
          });

          totalRemoved++;
        } catch (error) {
          console.error(`    ❌ Erro ao remover ${sku.id}:`, error);
        }
      }
      console.log('');
    }

    console.log(`✅ Processo concluído!`);
    console.log(`   Total de duplicatas removidas: ${totalRemoved}\n`);

    // Verificar se ainda há duplicatas
    const remaining = await prisma.sKU.groupBy({
      by: ['userId', 'sku'],
      having: {
        userId: {
          _count: {
            gt: 1,
          },
        },
      },
    });

    if (remaining.length > 0) {
      console.log(`⚠️  Ainda existem ${remaining.length} grupos com duplicatas`);
    } else {
      console.log('✅ Todas as duplicatas foram removidas com sucesso!');
    }

  } catch (error) {
    console.error('❌ Erro ao processar duplicatas:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar
findAndFixDuplicates();
