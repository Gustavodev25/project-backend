-- CreateTable
CREATE TABLE IF NOT EXISTS "aliquota_imposto" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "conta" TEXT NOT NULL,
    "aliquota" DECIMAL(5,2) NOT NULL,
    "data_inicio" TIMESTAMP(3) NOT NULL,
    "data_fim" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aliquota_imposto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "aliquota_imposto_user_id_idx" ON "aliquota_imposto"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "aliquota_imposto_conta_idx" ON "aliquota_imposto"("conta");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "aliquota_imposto_data_inicio_data_fim_idx" ON "aliquota_imposto"("data_inicio", "data_fim");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "aliquota_imposto_ativo_idx" ON "aliquota_imposto"("ativo");

-- AddForeignKey
ALTER TABLE "aliquota_imposto" ADD CONSTRAINT "aliquota_imposto_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
