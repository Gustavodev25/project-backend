-- Remove data_competencia from conta_receber (competência só em contas a pagar)
ALTER TABLE "public"."conta_receber"
  DROP COLUMN IF EXISTS "data_competencia";

