-- Fase 10.2 — Rateio de um lançamento entre dimensões.
--
-- MODELO: sub-lançamentos. Um lançamento de R$ 999 vira N partes com valor
-- próprio, e CADA parte carrega o conjunto completo de dimensões. Não são
-- percentuais por dimensão cruzados pelo sistema — esse desenho anterior,
-- registrado no CLAUDE.md até esta sessão, deduzia combinações que o cliente
-- nunca afirmou (rateio 60/40 de centro de custo somado a 70/30 de contato
-- inventa a célula "40% + 30%") e reintroduzia fração de centavo na
-- multiplicação. Aqui só existe o que foi escrito, e 333+333+333 fecha 999.
--
-- A natureza NÃO se parte: a categoria continua sendo uma só, no lançamento
-- pai. Nenhuma linha da DRE se divide por causa de rateio.
--
-- Rodar no Supabase Studio > SQL Editor.

-- ─────────────────────────────────────────
-- 1. TABELA
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_allocations (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- CASCADE: apagar o lançamento leva o rateio junto. Um rateio órfão não
  -- significa nada.
  transaction_id    uuid          NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,

  -- Ordem de exibição dentro do lançamento. Sem índice único: repetir a mesma
  -- combinação de dimensões é esquisito mas não é erro, e bloquear obrigaria a
  -- inventar regra de desempate.
  sequence          integer       NOT NULL DEFAULT 1,

  -- SEMPRE positivo, como em transactions e budget_entries: o sinal vem da
  -- `direction` do lançamento pai, que a parte herda.
  amount            numeric(15,2) NOT NULL,

  -- As quatro dimensões. Sem category_id de propósito (ver cabeçalho).
  cost_center_id    uuid          REFERENCES cost_centers(id)   ON DELETE SET NULL,
  business_unit_id  uuid          REFERENCES business_units(id) ON DELETE SET NULL,
  legal_entity_id   uuid          REFERENCES legal_entities(id) ON DELETE SET NULL,
  contact_id        uuid          REFERENCES contacts(id)       ON DELETE SET NULL,

  notes             text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT transaction_allocations_amount_chk CHECK (amount > 0),
  CONSTRAINT transaction_allocations_sequence_chk CHECK (sequence >= 1)
);

-- ─────────────────────────────────────────
-- 2. ÍNDICES
-- ─────────────────────────────────────────
-- O acesso dominante é "todas as partes deste lançamento" — a view e a linha
-- expansível de /transacoes.
CREATE INDEX IF NOT EXISTS idx_alloc_transaction
  ON transaction_allocations (transaction_id);

CREATE INDEX IF NOT EXISTS idx_alloc_org
  ON transaction_allocations (organization_id);

-- Um por dimensão: são estes que a 10.3 vai usar ao filtrar e agrupar a DRE,
-- o fluxo e o balanço pela view.
CREATE INDEX IF NOT EXISTS idx_alloc_org_cost_center
  ON transaction_allocations (organization_id, cost_center_id)
  WHERE cost_center_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alloc_org_business_unit
  ON transaction_allocations (organization_id, business_unit_id)
  WHERE business_unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alloc_org_legal_entity
  ON transaction_allocations (organization_id, legal_entity_id)
  WHERE legal_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alloc_org_contact
  ON transaction_allocations (organization_id, contact_id)
  WHERE contact_id IS NOT NULL;

-- ─────────────────────────────────────────
-- 3. TRIGGER updated_at
-- ─────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_transaction_allocations_updated_at ON transaction_allocations;
CREATE TRIGGER trg_transaction_allocations_updated_at
  BEFORE UPDATE ON transaction_allocations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- 4. A INVARIANTE DO RATEIO
-- ─────────────────────────────────────────
-- Regra: ou o lançamento tem ZERO partes, ou a soma delas é EXATAMENTE o valor
-- do lançamento. Nada de peso com dízima — foi decisão explícita: rateio que
-- não fecha no centavo não entra.
--
-- Por que CONSTRAINT TRIGGER DEFERRABLE e não CHECK: CHECK enxerga uma linha
-- por vez, e a soma é uma propriedade do conjunto. Deferido até o COMMIT, dá
-- para inserir as três partes de 333 uma a uma sem que a primeira seja
-- recusada por somar 333 e não 999.
--
-- A mesma função cobre, pela mesma porta: apagar uma parte de três, editar o
-- valor de uma parte, e editar o valor do lançamento pai.

CREATE OR REPLACE FUNCTION assert_allocation_consistent(p_tx uuid)
RETURNS void AS $$
DECLARE
  v_amount  numeric(15,2);
  v_sum     numeric(15,2);
  v_count   integer;
  v_direct  boolean;
BEGIN
  SELECT amount,
         (cost_center_id IS NOT NULL OR business_unit_id IS NOT NULL
          OR legal_entity_id IS NOT NULL OR contact_id IS NOT NULL)
    INTO v_amount, v_direct
    FROM transactions WHERE id = p_tx;

  -- Lançamento já apagado (o CASCADE levou as partes junto): nada a validar.
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
    INTO v_count, v_sum
    FROM transaction_allocations WHERE transaction_id = p_tx;

  -- Sem rateio é o estado normal da maioria esmagadora dos lançamentos.
  IF v_count = 0 THEN RETURN; END IF;

  IF v_count > 50 THEN
    RAISE EXCEPTION 'Rateio do lançamento % tem % partes, acima do limite de 50.',
      p_tx, v_count;
  END IF;

  IF v_sum <> v_amount THEN
    RAISE EXCEPTION 'O rateio do lançamento % soma % e o lançamento vale %. As partes têm de fechar o valor exato.',
      p_tx, v_sum, v_amount;
  END IF;

  -- A verdade mora num lugar só: com rateio, as colunas de dimensão do
  -- lançamento ficam vazias. Se ficassem preenchidas, toda leitura ainda não
  -- migrada atribuiria o valor INTEGRAL a uma das partes.
  IF v_direct THEN
    RAISE EXCEPTION 'O lançamento % tem rateio: as dimensões dele têm de ficar vazias (a classificação vive nas partes).',
      p_tx;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Gatilho pelo lado das partes.
CREATE OR REPLACE FUNCTION trg_fn_allocation_consistent()
RETURNS trigger AS $$
BEGIN
  PERFORM assert_allocation_consistent(COALESCE(NEW.transaction_id, OLD.transaction_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_allocation_consistent ON transaction_allocations;
CREATE CONSTRAINT TRIGGER trg_allocation_consistent
  AFTER INSERT OR UPDATE OR DELETE ON transaction_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_fn_allocation_consistent();

-- Gatilho pelo lado do lançamento: cobre "editar o valor de um lançamento já
-- rateado" e "preencher dimensão em lançamento rateado". Só dispara quando algo
-- que importa muda, para não pagar a validação em todo UPDATE de transactions.
CREATE OR REPLACE FUNCTION trg_fn_transaction_allocation_guard()
RETURNS trigger AS $$
BEGIN
  PERFORM assert_allocation_consistent(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transaction_allocation_guard ON transactions;
CREATE CONSTRAINT TRIGGER trg_transaction_allocation_guard
  AFTER UPDATE OF amount, cost_center_id, business_unit_id, legal_entity_id, contact_id
  ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_fn_transaction_allocation_guard();

-- ─────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ─────────────────────────────────────────
ALTER TABLE transaction_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transaction_allocations: leitura pela org" ON transaction_allocations;
CREATE POLICY "transaction_allocations: leitura pela org"
  ON transaction_allocations FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "transaction_allocations: insert pela org" ON transaction_allocations;
CREATE POLICY "transaction_allocations: insert pela org"
  ON transaction_allocations FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "transaction_allocations: update pela org" ON transaction_allocations;
CREATE POLICY "transaction_allocations: update pela org"
  ON transaction_allocations FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "transaction_allocations: delete pela org" ON transaction_allocations;
CREATE POLICY "transaction_allocations: delete pela org"
  ON transaction_allocations FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- ─────────────────────────────────────────
-- 6. VIEW transaction_lines
-- ─────────────────────────────────────────
-- O que as leituras da 10.3 vão consumir no lugar de `transactions`.
--
-- Sem rateio devolve EXATAMENTE a linha de hoje — é o que permite migrar as
-- sete leituras uma a uma sem que nenhum número mude enquanto ninguém rateia
-- nada.
--
-- `security_invoker = true`: sem isso a view rodaria com os direitos de quem a
-- criou e furaria a RLS das tabelas de baixo. Com isso, as policies de
-- `transactions` e `transaction_allocations` continuam valendo para quem
-- consulta.
DROP VIEW IF EXISTS transaction_lines;
CREATE VIEW transaction_lines
WITH (security_invoker = true) AS
  -- ── Lançamentos sem rateio ──
  SELECT
    t.id                        AS transaction_id,
    NULL::uuid                  AS allocation_id,
    1                           AS sequence,
    false                       AS is_allocated,
    t.organization_id,
    t.data_source_id,
    t.document_id,
    t.invoice_id,
    t.date,
    t.effective_date,
    t.amount,
    t.currency,
    t.direction,
    t.description,
    t.cleaned_description,
    t.status,
    t.category_id,
    t.cost_center_id,
    t.business_unit_id,
    t.legal_entity_id,
    t.contact_id,
    t.categorization_confidence,
    t.categorization_method,
    t.needs_review,
    t.account_id,
    t.account_number,
    t.account_type,
    t.account_name,
    t.metadata,
    t.created_at,
    t.updated_at
  FROM transactions t
  WHERE NOT EXISTS (
    SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = t.id
  )

  UNION ALL

  -- ── Uma linha por parte ──
  -- Valor e dimensões vêm da parte; todo o resto (data, natureza, conta,
  -- descrição) continua vindo do lançamento pai.
  SELECT
    t.id                        AS transaction_id,
    a.id                        AS allocation_id,
    a.sequence,
    true                        AS is_allocated,
    t.organization_id,
    t.data_source_id,
    t.document_id,
    t.invoice_id,
    t.date,
    t.effective_date,
    a.amount,
    t.currency,
    t.direction,
    t.description,
    t.cleaned_description,
    t.status,
    t.category_id,
    a.cost_center_id,
    a.business_unit_id,
    a.legal_entity_id,
    a.contact_id,
    t.categorization_confidence,
    t.categorization_method,
    t.needs_review,
    t.account_id,
    t.account_number,
    t.account_type,
    t.account_name,
    t.metadata,
    t.created_at,
    t.updated_at
  FROM transactions t
  JOIN transaction_allocations a ON a.transaction_id = t.id;

COMMENT ON VIEW transaction_lines IS
  'Uma linha por lançamento sem rateio, uma por parte quando há rateio. Amount e as quatro dimensões vêm da parte; natureza e data vêm do lançamento. Fonte das leituras analíticas a partir da Fase 10.3.';
