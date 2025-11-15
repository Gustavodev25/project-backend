import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDuplicateIds() {
  console.log('🔍 Verificando IDs duplicados...\n');

  try {
    // Buscar todos os SKUs
    const allSkus = await prisma.sKU.findMany({
      select: {
        id: true,
        sku: true,
        produto: true,
        userId: true,
      },
    });

    console.log(`📊 Total de SKUs: ${allSkus.length}\n`);

    // Agrupar por ID
    const idMap = new Map<string, typeof allSkus>();

    for (const sku of allSkus) {
      if (!idMap.has(sku.id)) {
        idMap.set(sku.id, []);
      }
      idMap.get(sku.id)!.push(sku);
    }

    // Encontrar IDs duplicados
    const duplicateIds = Array.from(idMap.entries()).filter(
      ([_, group]) => group.length > 1
    );

    if (duplicateIds.length === 0) {
      console.log('✅ Nenhum ID duplicado encontrado!\n');

      // Mostrar todos os IDs
      console.log('IDs únicos no banco:');
      const ids = Array.from(idMap.keys());
      ids.forEach((id, index) => {
        const sku = idMap.get(id)![0];
        console.log(`  ${index + 1}. ${id} - SKU: ${sku.sku} - ${sku.produto}`);
      });
    } else {
      console.log(`❌ PROBLEMA GRAVE: Encontrados ${duplicateIds.length} IDs duplicados!\n`);

      for (const [id, group] of duplicateIds) {
        console.log(`ID duplicado: ${id}`);
        group.forEach((sku, index) => {
          console.log(`  ${index + 1}. SKU: ${sku.sku} - ${sku.produto} - UserID: ${sku.userId}`);
        });
        console.log('');
      }
    }

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDuplicateIds();
