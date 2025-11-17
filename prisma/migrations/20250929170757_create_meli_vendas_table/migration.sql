-- CreateTable
CREATE TABLE "public"."meli_venda" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "meli_account_id" TEXT NOT NULL,
    "data_venda" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "conta" TEXT NOT NULL,
    "valor_total" DECIMAL(10,2) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "valor_unitario" DECIMAL(10,2) NOT NULL,
    "taxa_plataforma" DECIMAL(10,2),
    "valor_frete" DECIMAL(10,2) NOT NULL,
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
    "exposicao" TEXT,
    "tipo_anuncio" TEXT,
    "ads" TEXT,
    "plataforma" TEXT NOT NULL DEFAULT 'Mercado Livre',
    "canal" TEXT NOT NULL DEFAULT 'ML',
    "tags" JSONB,
    "internal_tags" JSONB,
    "raw_data" JSONB,
    "sincronizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meli_venda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meli_venda_order_id_key" ON "public"."meli_venda"("order_id");

-- CreateIndex
CREATE INDEX "meli_venda_user_id_idx" ON "public"."meli_venda"("user_id");

-- CreateIndex
CREATE INDEX "meli_venda_meli_account_id_idx" ON "public"."meli_venda"("meli_account_id");

-- CreateIndex
CREATE INDEX "meli_venda_data_venda_idx" ON "public"."meli_venda"("data_venda");

-- CreateIndex
CREATE INDEX "meli_venda_order_id_idx" ON "public"."meli_venda"("order_id");

-- AddForeignKey
ALTER TABLE "public"."meli_venda" ADD CONSTRAINT "meli_venda_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."meli_venda" ADD CONSTRAINT "meli_venda_meli_account_id_fkey" FOREIGN KEY ("meli_account_id") REFERENCES "public"."meli_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
