-- 0033_down — desfaz o rateio de natureza.
--
-- PERDA DECLARADA: um lançamento cujas partes têm naturezas DIFERENTES não cabe
-- no modelo antigo (uma natureza por lançamento). Ele volta com a natureza da
-- parte de MAIOR valor. Para ver quais serão achatados, rode ANTES, sozinho:
--
--   SELECT transaction_id, COUNT(DISTINCT category_id) AS naturezas
--     FROM transaction_allocations GROUP BY 1 HAVING COUNT(DISTINCT category_id) > 1;
--
-- Ordem: restaurar função e gatilho ANTES de repor a natureza no lançamento
-- (a função da 0033 recusaria natureza em lançamento rateado), e restaurar a
-- view ANTES de dropar a coluna (a view da 0033 depende de a.category_id).

-- O SQL Editor roda o arquivo numa transação só. Com os gatilhos do rateio
-- DEFERIDOS, um UPDATE deixa eventos pendentes e o Postgres recusa o ALTER TABLE
-- seguinte ("has pending trigger events") — achado validando esta reversa.
-- IMEDIATO faz cada verificação disparar no fim do próprio comando.
SET CONSTRAINTS ALL IMMEDIATE;

-- ─────────────────────────────────────────
-- 1. FUNÇÃO E GATILHO COMO NA 0026
-- ─────────────────────────────────────────
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

DROP TRIGGER IF EXISTS trg_transaction_allocation_guard ON transactions;
CREATE CONSTRAINT TRIGGER trg_transaction_allocation_guard
  AFTER UPDATE OF amount, cost_center_id, business_unit_id, legal_entity_id, contact_id
  ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_fn_transaction_allocation_guard();

-- ─────────────────────────────────────────
-- 2. A NATUREZA VOLTA PARA O LANÇAMENTO (a da parte de maior valor)
-- ─────────────────────────────────────────
UPDATE transactions t
   SET category_id = x.category_id
  FROM (
    SELECT DISTINCT ON (transaction_id) transaction_id, category_id
      FROM transaction_allocations
     WHERE category_id IS NOT NULL
     ORDER BY transaction_id, amount DESC, sequence
  ) x
 WHERE t.id = x.transaction_id
   AND t.category_id IS NULL;

-- ─────────────────────────────────────────
-- 3. A VIEW COMO NA 0026 (natureza do lançamento nos dois ramos)
-- ─────────────────────────────────────────
CREATE OR REPLACE VIEW transaction_lines
WITH (security_invoker = true) AS
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

-- ─────────────────────────────────────────
-- 4. COLUNAS E ÍNDICE
-- ─────────────────────────────────────────
DROP INDEX IF EXISTS idx_alloc_org_category;
ALTER TABLE allocation_template_lines DROP COLUMN IF EXISTS category_id;
ALTER TABLE transaction_allocations  DROP COLUMN IF EXISTS category_id;
