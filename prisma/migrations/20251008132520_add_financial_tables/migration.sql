/*
  Warnings:

  - You are about to drop the column `userId` on the `meli_oauth_state` table. All the data in the column will be lost.
  - Added the required column `user_id` to the `meli_oauth_state` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."meli_oauth_state" DROP CONSTRAINT "meli_oauth_state_userId_fkey";

-- AlterTable
ALTER TABLE "public"."meli_oauth_state" DROP COLUMN "userId",
ADD COLUMN     "user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."meli_venda" ADD COLUMN     "frete_adjustment" DECIMAL(10,2),
ADD COLUMN     "frete_ajuste" DECIMAL(12,2),
ADD COLUMN     "frete_base_cost" DECIMAL(10,2),
ADD COLUMN     "frete_calculation" JSONB,
ADD COLUMN     "frete_final_cost" DECIMAL(10,2),
ADD COLUMN     "frete_list_cost" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "public"."shopee_account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "shop_name" TEXT,
    "merchant_id" TEXT,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopee_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."shopee_oauth_state" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopee_oauth_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bling_account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bling_user_id" TEXT,
    "account_name" TEXT,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bling_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bling_oauth_state" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bling_oauth_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."shopee_venda" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "shopee_account_id" TEXT NOT NULL,
    "data_venda" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "conta" TEXT NOT NULL,
    "valor_total" DECIMAL(10,2) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "valor_unitario" DECIMAL(10,2) NOT NULL,
    "taxa_plataforma" DECIMAL(10,2),
    "valor_frete" DECIMAL(10,2) NOT NULL,
    "frete_ajuste" DECIMAL(12,2),
    "cmv" DECIMAL(10,2),
    "margem_contribuicao" DECIMAL(10,2),
    "is_margem_real" BOOLEAN NOT NULL DEFAULT false,
    "titulo" TEXT NOT NULL,
    "sku" TEXT,
    "comprador" TEXT NOT NULL,
    "logistic_type" TEXT,
    "envio_mode" TEXT,
    "shipping_status" TEXT,
    "shipping_id" TEXT,
    "payment_method" TEXT,
    "payment_status" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "frete_base_cost" DECIMAL(10,2),
    "frete_list_cost" DECIMAL(10,2),
    "frete_final_cost" DECIMAL(10,2),
    "frete_adjustment" DECIMAL(10,2),
    "frete_calculation" JSONB,
    "shipment_details" JSONB,
    "payment_details" JSONB,
    "plataforma" TEXT NOT NULL DEFAULT 'Shopee',
    "canal" TEXT NOT NULL DEFAULT 'SP',
    "tags" JSONB,
    "internal_tags" JSONB,
    "raw_data" JSONB,
    "sincronizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopee_venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sku" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'filho',
    "sku_pai" TEXT,
    "custo_unitario" DECIMAL(10,2) NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "proporcao" DECIMAL(5,4),
    "hierarquia_1" TEXT,
    "hierarquia_2" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "tem_estoque" BOOLEAN NOT NULL DEFAULT true,
    "skus_filhos" JSONB,
    "observacoes" TEXT,
    "tags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sku_custo_historico" (
    "id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "custo_anterior" DECIMAL(10,2),
    "custo_novo" DECIMAL(10,2) NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "motivo" TEXT,
    "tipo_alteracao" TEXT NOT NULL,
    "alterado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sku_custo_historico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."forma_pagamento" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bling_id" TEXT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sincronizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forma_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."categoria" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bling_id" TEXT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sincronizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conta_pagar" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bling_id" TEXT,
    "forma_pagamento_id" TEXT,
    "categoria_id" TEXT,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "data_vencimento" TIMESTAMP(3) NOT NULL,
    "data_pagamento" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "sincronizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conta_pagar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conta_receber" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bling_id" TEXT,
    "forma_pagamento_id" TEXT,
    "categoria_id" TEXT,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "data_vencimento" TIMESTAMP(3) NOT NULL,
    "data_recebimento" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "sincronizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conta_receber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopee_account_user_id_shop_id_key" ON "public"."shopee_account"("user_id", "shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "shopee_oauth_state_state_key" ON "public"."shopee_oauth_state"("state");

-- CreateIndex
CREATE INDEX "shopee_oauth_state_expires_at_idx" ON "public"."shopee_oauth_state"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "bling_account_user_id_bling_user_id_key" ON "public"."bling_account"("user_id", "bling_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bling_oauth_state_state_key" ON "public"."bling_oauth_state"("state");

-- CreateIndex
CREATE INDEX "bling_oauth_state_expires_at_idx" ON "public"."bling_oauth_state"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "shopee_venda_order_id_key" ON "public"."shopee_venda"("order_id");

-- CreateIndex
CREATE INDEX "shopee_venda_user_id_idx" ON "public"."shopee_venda"("user_id");

-- CreateIndex
CREATE INDEX "shopee_venda_shopee_account_id_idx" ON "public"."shopee_venda"("shopee_account_id");

-- CreateIndex
CREATE INDEX "shopee_venda_data_venda_idx" ON "public"."shopee_venda"("data_venda");

-- CreateIndex
CREATE INDEX "shopee_venda_order_id_idx" ON "public"."shopee_venda"("order_id");

-- CreateIndex
CREATE INDEX "sku_user_id_idx" ON "public"."sku"("user_id");

-- CreateIndex
CREATE INDEX "sku_sku_idx" ON "public"."sku"("sku");

-- CreateIndex
CREATE INDEX "sku_tipo_idx" ON "public"."sku"("tipo");

-- CreateIndex
CREATE INDEX "sku_ativo_idx" ON "public"."sku"("ativo");

-- CreateIndex
CREATE INDEX "sku_tem_estoque_idx" ON "public"."sku"("tem_estoque");

-- CreateIndex
CREATE UNIQUE INDEX "sku_user_id_sku_key" ON "public"."sku"("user_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "sku_sku_key" ON "public"."sku"("sku");

-- CreateIndex
CREATE INDEX "sku_custo_historico_sku_id_idx" ON "public"."sku_custo_historico"("sku_id");

-- CreateIndex
CREATE INDEX "sku_custo_historico_user_id_idx" ON "public"."sku_custo_historico"("user_id");

-- CreateIndex
CREATE INDEX "sku_custo_historico_created_at_idx" ON "public"."sku_custo_historico"("created_at");

-- CreateIndex
CREATE INDEX "forma_pagamento_user_id_idx" ON "public"."forma_pagamento"("user_id");

-- CreateIndex
CREATE INDEX "forma_pagamento_bling_id_idx" ON "public"."forma_pagamento"("bling_id");

-- CreateIndex
CREATE UNIQUE INDEX "forma_pagamento_user_id_bling_id_key" ON "public"."forma_pagamento"("user_id", "bling_id");

-- CreateIndex
CREATE INDEX "categoria_user_id_idx" ON "public"."categoria"("user_id");

-- CreateIndex
CREATE INDEX "categoria_bling_id_idx" ON "public"."categoria"("bling_id");

-- CreateIndex
CREATE UNIQUE INDEX "categoria_user_id_bling_id_key" ON "public"."categoria"("user_id", "bling_id");

-- CreateIndex
CREATE INDEX "conta_pagar_user_id_idx" ON "public"."conta_pagar"("user_id");

-- CreateIndex
CREATE INDEX "conta_pagar_bling_id_idx" ON "public"."conta_pagar"("bling_id");

-- CreateIndex
CREATE INDEX "conta_pagar_data_vencimento_idx" ON "public"."conta_pagar"("data_vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "conta_pagar_user_id_bling_id_key" ON "public"."conta_pagar"("user_id", "bling_id");

-- CreateIndex
CREATE INDEX "conta_receber_user_id_idx" ON "public"."conta_receber"("user_id");

-- CreateIndex
CREATE INDEX "conta_receber_bling_id_idx" ON "public"."conta_receber"("bling_id");

-- CreateIndex
CREATE INDEX "conta_receber_data_vencimento_idx" ON "public"."conta_receber"("data_vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "conta_receber_user_id_bling_id_key" ON "public"."conta_receber"("user_id", "bling_id");

-- AddForeignKey
ALTER TABLE "public"."meli_oauth_state" ADD CONSTRAINT "meli_oauth_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shopee_account" ADD CONSTRAINT "shopee_account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shopee_oauth_state" ADD CONSTRAINT "shopee_oauth_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bling_account" ADD CONSTRAINT "bling_account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bling_oauth_state" ADD CONSTRAINT "bling_oauth_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shopee_venda" ADD CONSTRAINT "shopee_venda_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shopee_venda" ADD CONSTRAINT "shopee_venda_shopee_account_id_fkey" FOREIGN KEY ("shopee_account_id") REFERENCES "public"."shopee_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sku" ADD CONSTRAINT "sku_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sku_custo_historico" ADD CONSTRAINT "sku_custo_historico_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sku_custo_historico" ADD CONSTRAINT "sku_custo_historico_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."forma_pagamento" ADD CONSTRAINT "forma_pagamento_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."categoria" ADD CONSTRAINT "categoria_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conta_pagar" ADD CONSTRAINT "conta_pagar_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conta_pagar" ADD CONSTRAINT "conta_pagar_forma_pagamento_id_fkey" FOREIGN KEY ("forma_pagamento_id") REFERENCES "public"."forma_pagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conta_pagar" ADD CONSTRAINT "conta_pagar_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conta_receber" ADD CONSTRAINT "conta_receber_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conta_receber" ADD CONSTRAINT "conta_receber_forma_pagamento_id_fkey" FOREIGN KEY ("forma_pagamento_id") REFERENCES "public"."forma_pagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conta_receber" ADD CONSTRAINT "conta_receber_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
