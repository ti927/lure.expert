-- 0013 — Fase 4 (Open Finance via Pluggy): scaffolding em data_sources
--
-- Contexto:
--   data_sources já tem credentials_encrypted, last_sync_at, last_sync_status,
--   last_sync_error, status, metadata (jsonb). Só falta a chave externa do
--   provedor — o "itemId" que o Pluggy retorna quando uma conexão é criada.
--
--   provider = 'pluggy'        (constante)
--   type     = 'bank' | 'credit_card' | 'investment' (espelha o categories.type do Pluggy)
--   external_item_id           uuid emitido pelo Pluggy, único dentro do provedor
--   metadata                   guarda o resto sem inflar o schema:
--     {
--       "connectorId": 123,                -- id do conector (banco) no catálogo Pluggy
--       "institutionName": "Itaú Unibanco",
--       "institutionImageUrl": "...",
--       "products": ["ACCOUNTS","CREDIT_CARDS","TRANSACTIONS"],
--       "accountsCount": 2,
--       "executionStatus": "SUCCESS",
--       "nextAutoSyncAt": "2026-05-19T03:00:00Z",
--       "lastTransactionFetchedAt": "2026-05-18T14:32:00Z"
--     }
--
-- Decisões:
--   - external_item_id é nullable (uploads manuais e seeds não têm).
--   - Unicidade só faz sentido por provedor — duas orgs distintas podem ter
--     o mesmo item_id em provedores diferentes (defensivo: o item_id do Pluggy
--     já é globalmente único, mas o índice composto é mais correto).
--   - RLS de data_sources já está ativa desde a migration 0001 — nada a alterar.

ALTER TABLE data_sources
  ADD COLUMN IF NOT EXISTS external_item_id text;

-- Unicidade por (provider, external_item_id), só quando preenchido.
CREATE UNIQUE INDEX IF NOT EXISTS data_sources_provider_external_item_id_uniq
  ON data_sources (provider, external_item_id)
  WHERE external_item_id IS NOT NULL;

-- Lookup rápido por org + provider (lista "minhas conexões Pluggy").
CREATE INDEX IF NOT EXISTS data_sources_org_provider_idx
  ON data_sources (organization_id, provider);
