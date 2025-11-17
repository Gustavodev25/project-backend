-- Add missing data_competencia columns for finance tables
-- This aligns the database with prisma/schema.prisma models

-- Conta a Pagar
ALTER TABLE "public"."conta_pagar"
  ADD COLUMN IF NOT EXISTS "data_competencia" TIMESTAMP(3);

-- Conta a Receber
ALTER TABLE "public"."conta_receber"
  ADD COLUMN IF NOT EXISTS "data_competencia" TIMESTAMP(3);

