-- Add optional "historico" text column to conta_pagar
ALTER TABLE "conta_pagar"
  ADD COLUMN IF NOT EXISTS "historico" TEXT;

