-- Atualizar origem de BLING para SINCRONIZACAO em contas a pagar
UPDATE "conta_pagar" 
SET "origem" = 'SINCRONIZACAO' 
WHERE "origem" = 'BLING';

-- Atualizar origem de BLING para SINCRONIZACAO em contas a receber
UPDATE "conta_receber" 
SET "origem" = 'SINCRONIZACAO' 
WHERE "origem" = 'BLING';

-- Verificar resultados
SELECT 'conta_pagar' as tabela, "origem", COUNT(*) as total 
FROM "conta_pagar" 
GROUP BY "origem"
UNION ALL
SELECT 'conta_receber' as tabela, "origem", COUNT(*) as total 
FROM "conta_receber" 
GROUP BY "origem"
ORDER BY tabela, origem;
