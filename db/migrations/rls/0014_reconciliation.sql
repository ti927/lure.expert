-- Sessão 4.D.1 — Reconciliação Pluggy × uploads manuais
-- Adiciona coluna duplicate_of em transactions para referenciar a transação canônica
-- quando uma transação de upload manual é identificada como duplicata de uma transação Pluggy.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS duplicate_of uuid
    REFERENCES transactions(id) ON DELETE SET NULL;

-- Índice para lookup reverso: quais transações apontam para uma canônica
CREATE INDEX IF NOT EXISTS idx_tx_duplicate_of
  ON transactions(duplicate_of)
  WHERE duplicate_of IS NOT NULL;
