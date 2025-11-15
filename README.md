# Backend API - Sistema de Gestão

Backend API para sistema de gestão de vendas e finanças integrado com Mercado Livre, Shopee e Bling.

## Estrutura do Projeto

```
project/
├── prisma/              # Schema e migrações do banco de dados
├── src/
│   ├── app/api/        # Endpoints da API
│   │   ├── auth/       # Autenticação e registro
│   │   ├── meli/       # Integração Mercado Livre
│   │   ├── shopee/     # Integração Shopee
│   │   ├── bling/      # Integração Bling
│   │   ├── financeiro/ # Gestão financeira
│   │   ├── dashboard/  # Endpoints de dashboard
│   │   ├── sku/        # Gestão de SKU
│   │   ├── cron/       # Jobs agendados
│   │   └── debug/      # Endpoints de debug
│   └── lib/            # Bibliotecas e utilitários
└── middleware.ts       # Middleware de autenticação

```

## Tecnologias

- **Next.js 15** - Framework API Routes
- **Prisma** - ORM para PostgreSQL
- **TypeScript** - Type-safe development
- **JWT** - Autenticação

## Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
# Database
DATABASE_URL="postgresql://..."

# Auth
JWT_SECRET="your-secret-key"

# Mercado Livre
NEXT_PUBLIC_MELI_APP_ID="your-app-id"
MELI_CLIENT_SECRET="your-client-secret"
MELI_REDIRECT_URI="your-redirect-uri"

# Shopee
SHOPEE_PARTNER_ID="your-partner-id"
SHOPEE_PARTNER_KEY="your-partner-key"
SHOPEE_REDIRECT_URL="your-redirect-url"

# Bling
BLING_CLIENT_ID="your-client-id"
BLING_CLIENT_SECRET="your-client-secret"
BLING_REDIRECT_URI="your-redirect-uri"
```

## Instalação

```bash
npm install
npx prisma generate
npx prisma migrate deploy
```

## Desenvolvimento

```bash
npm run dev
```

## Deploy

Este backend pode ser deployado em:
- Vercel
- Render
- Railway
- Heroku
- Qualquer serviço que suporte Node.js

## API Endpoints

### Autenticação
- `POST /api/auth/register` - Registrar usuário
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Dados do usuário autenticado
- `POST /api/auth/logout` - Logout

### Mercado Livre
- `GET /api/meli/auth` - Iniciar OAuth
- `GET /api/meli/callback` - Callback OAuth
- `GET /api/meli/accounts` - Listar contas
- `GET /api/meli/vendas` - Listar vendas
- `POST /api/meli/vendas/sync` - Sincronizar vendas

### Financeiro
- `GET /api/financeiro/contas-pagar` - Contas a pagar
- `GET /api/financeiro/contas-receber` - Contas a receber
- `GET /api/financeiro/categorias` - Categorias financeiras
- `GET /api/financeiro/dashboard/stats` - Estatísticas
- `GET /api/financeiro/dre/series` - DRE por período

### Dashboard
- `GET /api/dashboard/stats` - KPIs gerais
- `GET /api/dashboard/series` - Séries temporais
- `GET /api/dashboard/top-produtos-faturamento` - Top produtos
- `GET /api/dashboard/vendas-por-estado` - Vendas por estado

## Licença

Proprietário
