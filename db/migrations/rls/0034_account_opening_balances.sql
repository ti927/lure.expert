-- Conferência de saldo — o saldo inicial de cada conta (27/out/2026).
--
-- A Decisão 23 tirou o saldo do app porque ele somava movimento e chamava de
-- posição: sem saldo inicial, "Saldo Atual" era a soma dos meses importados. O
-- que faltava era a ÂNCORA. Aqui ela é informada por quem confere, contra o
-- extrato do banco, e a tela de conferência (`/contas/[conta]`) parte dela.
-- Ver docs/SCHEMA_DECISIONS.md Decisão 29.
--
-- UMA linha por conta. `account_id` é `transactions.account_id` (o id do Pluggy
-- ou `arq:<slug>` da conta manual) — texto e sem FK, como as quatro colunas de
-- conta do lançamento, que são desnormalizadas.
--
-- `balance_date` é o saldo no INÍCIO do dia — a linha "saldo anterior" do
-- extrato. Lançamentos com data de caixa anterior a ela ficam sem saldo.
--
-- Rodar no Supabase Studio > SQL Editor. Reversa: 0034_down_account_opening_balances.sql

CREATE TABLE IF NOT EXISTS account_opening_balances (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id          text          NOT NULL,
  balance_date        date          NOT NULL,
  -- Pode ser negativo: conta no cheque especial.
  amount              numeric(15,2) NOT NULL,
  -- Quem informou. Sem FK: `auth.users` é do Supabase, e o padrão do schema
  -- (memberships, dashboards) é guardar o uuid cru.
  informed_by_user_id uuid,
  note                text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT account_opening_balances_account_chk CHECK (length(btrim(account_id)) > 0),
  CONSTRAINT account_opening_balances_unq UNIQUE (organization_id, account_id)
);

DROP TRIGGER IF EXISTS trg_account_opening_balances_updated_at ON account_opening_balances;
CREATE TRIGGER trg_account_opening_balances_updated_at
  BEFORE UPDATE ON account_opening_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE account_opening_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_opening_balances: leitura pela org" ON account_opening_balances;
CREATE POLICY "account_opening_balances: leitura pela org"
  ON account_opening_balances FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "account_opening_balances: insert pela org" ON account_opening_balances;
CREATE POLICY "account_opening_balances: insert pela org"
  ON account_opening_balances FOR INSERT
  WITH CHECK (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "account_opening_balances: update pela org" ON account_opening_balances;
CREATE POLICY "account_opening_balances: update pela org"
  ON account_opening_balances FOR UPDATE
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "account_opening_balances: delete pela org" ON account_opening_balances;
CREATE POLICY "account_opening_balances: delete pela org"
  ON account_opening_balances FOR DELETE
  USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL));
