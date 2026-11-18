-- Reversa da 0036. Perda declarada: o quadro de pessoal inteiro (pessoas,
-- alocações, benefícios, configurações e o mapa de naturezas) e as séries de
-- orçamento geradas pela folha (source = 'folha'), que o CHECK antigo recusaria.

-- O DELETE vem ANTES de recriar o CHECK: com linhas 'folha' presentes, o ADD
-- CONSTRAINT falharia. As entradas (budget_entries) caem por CASCADE.
DELETE FROM budget_series WHERE source = 'folha';

ALTER TABLE budget_series DROP CONSTRAINT IF EXISTS budget_series_source_chk;
ALTER TABLE budget_series ADD CONSTRAINT budget_series_source_chk
  CHECK (source IN ('manual', 'copia_realizado', 'csv', 'recorrencia_detectada', 'duplicacao'));

-- Ordem das FKs: filhas de budget_people, depois ela, depois as demais.
DROP TABLE IF EXISTS budget_people_allocations;
DROP TABLE IF EXISTS budget_people_benefits;
DROP TABLE IF EXISTS budget_people;
DROP TABLE IF EXISTS budget_payroll_settings;
DROP TABLE IF EXISTS payroll_category_map;

DROP TRIGGER IF EXISTS trg_legal_entities_updated_at ON legal_entities;
ALTER TABLE legal_entities DROP CONSTRAINT IF EXISTS legal_entities_regime_chk;
ALTER TABLE legal_entities DROP CONSTRAINT IF EXISTS legal_entities_aliquotas_chk;
ALTER TABLE legal_entities
  DROP COLUMN IF EXISTS regime_tributario,
  DROP COLUMN IF EXISTS simples_anexo_iv,
  DROP COLUMN IF EXISTS aliquota_inss_patronal,
  DROP COLUMN IF EXISTS aliquota_rat_fap,
  DROP COLUMN IF EXISTS aliquota_terceiros,
  DROP COLUMN IF EXISTS aliquota_fgts,
  DROP COLUMN IF EXISTS updated_at;
