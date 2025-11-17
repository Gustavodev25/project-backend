-- Migração: Corrigir sinal da taxaPlataforma e recalcular margemContribuicao
-- 
-- Esta migração converte a taxaPlataforma de POSITIVA para NEGATIVA nos registros existentes
-- e recalcula a margemContribuicao seguindo a nova fórmula:
-- Margem = Valor Total + Taxa Plataforma (negativa) + Frete - CMV
--
-- Antes: taxaPlataforma = 15.00 (positivo)
-- Depois: taxaPlataforma = -15.00 (negativo)

-- Passo 1: Converter taxaPlataforma de positiva para negativa
UPDATE "meli_venda"
SET "taxa_plataforma" = -ABS("taxa_plataforma")
WHERE "taxa_plataforma" IS NOT NULL 
  AND "taxa_plataforma" > 0;

-- Passo 2: Recalcular margemContribuicao com a nova fórmula
-- Se não há CMV (cmv IS NULL), calculamos Receita Líquida = valorTotal + taxaPlataforma + frete
-- Se há CMV, calculamos Margem Real = valorTotal + taxaPlataforma + frete - cmv
UPDATE "meli_venda"
SET "margem_contribuicao" = CASE
  -- Se tem CMV, calcular margem real
  WHEN "cmv" IS NOT NULL AND "cmv" > 0 THEN
    "valor_total" + COALESCE("taxa_plataforma", 0) + "valor_frete" - "cmv"
  -- Se não tem CMV, calcular receita líquida
  ELSE
    "valor_total" + COALESCE("taxa_plataforma", 0) + "valor_frete"
END
WHERE "margem_contribuicao" IS NOT NULL;