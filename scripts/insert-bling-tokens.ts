import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function insertBlingTokens() {
  try {
    // Tokens fornecidos pelo usuário
    const accessToken = 'a87c421b4fe78ef093397897a96e12cd6f09dcff';
    const refreshToken = 'c5a5c7c2a4f9e6dd5db78b7e1ce6157cc7675b01';
    
    // Calcular data de expiração (geralmente tokens duram 1 hora, mas vamos colocar 24h para segurança)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    
    // Buscar o primeiro usuário (assumindo que você é o único usuário)
    const user = await prisma.user.findFirst();
    
    if (!user) {
      console.error('Nenhum usuário encontrado no banco de dados');
      return;
    }
    
    console.log(`Inserindo tokens do Bling para o usuário: ${user.email}`);
    
    // Inserir ou atualizar a conta do Bling
    const blingAccount = await prisma.blingAccount.upsert({
      where: {
        userId_bling_user_id: {
          userId: user.id,
          bling_user_id: 'manual_insert', // ID manual para identificar
        },
      },
      update: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        account_name: 'Conta Bling Manual',
        updated_at: new Date(),
      },
      create: {
        userId: user.id,
        bling_user_id: 'manual_insert',
        account_name: 'Conta Bling Manual',
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
      },
    });
    
    console.log('✅ Tokens do Bling inseridos com sucesso!');
    console.log('Detalhes da conta:');
    console.log(`- ID: ${blingAccount.id}`);
    console.log(`- Usuário: ${user.email}`);
    console.log(`- Nome da Conta: ${blingAccount.account_name}`);
    console.log(`- Expira em: ${blingAccount.expires_at}`);
    
  } catch (error) {
    console.error('❌ Erro ao inserir tokens do Bling:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar o script
insertBlingTokens();
