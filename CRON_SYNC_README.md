# 🔄 Sincronização Automática do Mercado Livre via Cron Jobs

## 📋 Visão Geral

O sistema de sincronização foi otimizado para usar **Cron Jobs do Vercel**, eliminando problemas de timeout e limites de execução.

## 🎯 Como Funciona

### 1. **Cron Job Automático** (`/api/cron/meli-sync`)
- **Execução**: A cada 2 horas (configurável em `vercel.json`)
- **Duração máxima**: 5 minutos (300 segundos)
- **Processamento**: Lotes paralelos de 3 contas por vez
- **Modo**: QuickMode (sincroniza apenas vendas recentes)

### 2. **Endpoint de Sincronização** (`/api/meli/vendas/sync`)
- **Duração máxima**: 60 segundos
- **Suporta**: Chamadas de usuários (com SSE) E cron jobs (sem SSE)
- **Autenticação**: Session token OU CRON_SECRET

## ⚙️ Configuração

### 1. Variáveis de Ambiente

```env
CRON_SECRET=sua-chave-secreta-aqui
NEXT_PUBLIC_APP_URL=https://seu-dominio.vercel.app
```

### 2. Vercel.json

```json
{
  "crons": [
    {
      "path": "/api/cron/meli-sync",
      "schedule": "0 */2 * * *"  // A cada 2 horas
    }
  ],
  "functions": {
    "src/app/api/cron/meli-sync/route.ts": {
      "maxDuration": 300  // 5 minutos
    },
    "src/app/api/meli/vendas/sync/route.ts": {
      "maxDuration": 60   // 1 minuto
    }
  }
}
```

### 3. Ativar Cron Jobs no Vercel

1. Acesse o projeto no [Vercel Dashboard](https://vercel.com/dashboard)
2. Vá em **Settings** → **Cron Jobs**
3. Verifique se o cron está ativo
4. Configure o `CRON_SECRET` em **Environment Variables**

## 🚀 Vantagens

### ✅ Sem Timeout
- Cron job tem 5 minutos para processar todas as contas
- Processa em lotes paralelos (3 contas por vez)
- Cada sincronização individual tem 60 segundos

### ✅ Sem Limite de Vendas
- Usa `quickMode: true` para sincronizar vendas recentes rapidamente
- A cada 2 horas, mantém todas as contas atualizadas
- Não tenta buscar todo o histórico de uma vez

### ✅ Eficiente
- Processamento paralelo reduz tempo total
- Promise.allSettled garante que um erro não pare o processo
- Logs detalhados de cada etapa

### ✅ Confiável
- Autenticação via CRON_SECRET
- Retry automático em caso de erros temporários
- Funciona sem SSE (modo cron) ou com SSE (modo usuário)

## 📊 Monitoramento

### Logs do Cron Job

```
[Cron] 🚀 Iniciando sincronização automática do Mercado Livre...
[Cron] 📊 Encontradas 6 contas do Mercado Livre
[Cron] 🔄 Processando lote 1/2 (3 contas)...
[Cron]   → Sincronizando Conta1...
[Cron]   → Sincronizando Conta2...
[Cron]   → Sincronizando Conta3...
[Cron]   ✅ Conta1: 15 vendas em 8500ms
[Cron]   ✅ Conta2: 23 vendas em 9200ms
[Cron]   ✅ Conta3: 8 vendas em 7800ms
[Cron] ✓ Lote 1/2: 3/3 contas sincronizadas
[Cron] 🔄 Processando lote 2/2 (3 contas)...
[Cron]   → Sincronizando Conta4...
[Cron]   → Sincronizando Conta5...
[Cron]   → Sincronizando Conta6...
[Cron]   ✅ Conta4: 12 vendas em 8100ms
[Cron]   ✅ Conta5: 19 vendas em 9500ms
[Cron]   ✅ Conta6: 7 vendas em 7200ms
[Cron] ✓ Lote 2/2: 3/3 contas sincronizadas
[Cron] 🎉 Sincronização completa: 6/6 contas, 84 vendas, 52300ms
```

### Verificar Logs no Vercel

1. Acesse o projeto no Vercel
2. Vá em **Deployments** → Última deployment
3. Clique em **Functions**
4. Selecione `/api/cron/meli-sync`
5. Veja os logs de execução

## 🔧 Ajustes de Performance

### Alterar Intervalo do Cron

Edite `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/meli-sync",
      "schedule": "0 */1 * * *"  // A cada 1 hora
      // ou
      "schedule": "0 */4 * * *"  // A cada 4 horas
      // ou
      "schedule": "*/30 * * * *" // A cada 30 minutos
    }
  ]
}
```

### Alterar Tamanho do Lote

Edite `src/app/api/cron/meli-sync/route.ts`:

```typescript
const BATCH_SIZE = 5; // Aumentar para processar mais contas em paralelo
```

**⚠️ Atenção**: Lotes maiores podem causar timeout se houver muitas vendas por conta.

## 🧪 Testar Localmente

```bash
# 1. Configurar CRON_SECRET no .env.local
echo "CRON_SECRET=test-secret" >> .env.local

# 2. Fazer requisição manual
curl -X GET http://localhost:3000/api/cron/meli-sync \
  -H "Authorization: Bearer test-secret"
```

## 🔐 Segurança

- ✅ CRON_SECRET obrigatório para executar o cron
- ✅ Vercel valida o CRON_SECRET automaticamente
- ✅ Cada conta é autenticada individualmente
- ✅ Tokens do Mercado Livre são renovados automaticamente

## 📝 Manutenção

### Sincronização Manual

Usuários podem sincronizar manualmente a qualquer momento através da interface.

### Desabilitar Cron

Remova ou comente a configuração em `vercel.json`:

```json
{
  "crons": [
    // {
    //   "path": "/api/cron/meli-sync",
    //   "schedule": "0 */2 * * *"
    // }
  ]
}
```

### Forçar Sincronização Completa

Para sincronizar TODO o histórico (não recomendado no cron):

```typescript
// Editar /api/cron/meli-sync/route.ts
body: JSON.stringify({
  accountIds: [account.id],
  quickMode: false,  // ⚠️ Pode dar timeout
  fullSync: true     // ⚠️ Pode dar timeout
})
```

## 🎉 Resultado Final

- ✅ **Sincronização automática** a cada 2 horas
- ✅ **Sem timeout** - processa todas as contas em 5 minutos
- ✅ **Sem limite** - suporta contas com milhares de vendas
- ✅ **Eficiente** - processamento paralelo otimizado
- ✅ **Confiável** - retry automático e logs detalhados
- ✅ **Seguro** - autenticação via CRON_SECRET

---

**Última atualização**: 2025-11-14
