-- Adiciona colunas de conta bancária diretamente em transactions.
-- Antes esses dados ficavam enterrados em metadata JSONB, impedindo filtragem
-- e indexação eficiente. O backfill lê do metadata existente.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS account_id     text,
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS account_type   text,  -- subtipo legível: CHECKING_ACCOUNT, CREDIT_CARD, SAVINGS_ACCOUNT
  ADD COLUMN IF NOT EXISTS account_name   text;

-- Backfill de registros Pluggy já existentes
UPDATE transactions
SET
  account_id     = metadata->>'accountId',
  account_number = metadata->>'accountNumber',
  account_type   = COALESCE(metadata->>'accountSubtype', metadata->>'accountType'),
  account_name   = metadata->>'accountName'
WHERE
  metadata IS NOT NULL
  AND metadata != '{}'::jsonb
  AND metadata->>'accountId' IS NOT NULL;

-- Índice para filtros por conta na tela de Transações
CREATE INDEX IF NOT EXISTS idx_tx_org_account_id
  ON transactions (organization_id, account_id)
  WHERE account_id IS NOT NULL;
