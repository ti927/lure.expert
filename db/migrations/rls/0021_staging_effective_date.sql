-- Adiciona effective_date à tabela transactions_staging.
-- A tabela transactions já tem o campo; agora a staging também o recebe
-- para que parsers e a tela de revisão possam propagar o valor até o insert final.

ALTER TABLE transactions_staging
  ADD COLUMN IF NOT EXISTS effective_date text;
