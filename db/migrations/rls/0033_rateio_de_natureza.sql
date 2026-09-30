-- 0033 — Rateio de natureza (29/set/2026).
--
-- Revoga em parte a Decisão 16 ("a natureza não se parte"). Um TED que paga
-- cinco fornecedores de naturezas diferentes é UM lançamento no extrato; a
-- parte do rateio passa a carregar a natureza, ao lado das quatro dimensões.
--
-- REGRA: com rateio, a natureza do lançamento fica VAZIA — a mesma das
-- dimensões desde a 0026. Leitura esquecida mostra "sem natureza" (lacuna
-- visível) em vez de atribuir o valor inteiro a uma natureza (erro silencioso).
--
-- ORDEM IMPORTA, e funciona com ou sem transação envolvendo o arquivo:
--   1. colunas novas
--   2. copia a natureza do lançamento para as partes (gatilho antigo ignora)
--   3. esvazia a natureza dos lançamentos rateados (gatilho antigo não olha)
--   4. só então troca função, gatilho e view — quando os dados já cumprem a regra.
--
-- Idempotente: pode rodar de novo sem efeito.
-- Rodar no Supabase Studio > SQL Editor. Reversa: 0033_down_rateio_de_natureza.sql

-- O SQL Editor roda o arquivo numa transação só. Com os gatilhos do rateio
-- DEFERIDOS, um UPDATE deixa eventos pendentes e o Postgres recusa o ALTER TABLE
-- seguinte ("has pending trigger events") — achado validando a reversa.
-- IMEDIATO faz cada verificação disparar no fim do próprio comando: o passo 2
-- é conferido pela função ANTIGA (que ignora natureza), o passo 3 não dispara
-- nada (o gatilho antigo não olha category_id).
SET CONSTRAINTS ALL IMMEDIATE;

-- ─────────────────────────────────────────
-- 1. COLUNAS
-- ─────────────────────────────────────────
ALTER TABLE transaction_allocations
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id) ON DELETE SET NULL;

-- No modelo, vazio significa "usar a natureza atual do lançamento" ao aplicar.
ALTER TABLE allocation_template_lines
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alloc_org_category
  ON transaction_allocations (organization_id, category_id)
  WHERE category_id IS NOT NULL;

-- ─────────────────────────────────────────
-- 2. AS PARTES HERDAM A NATUREZA QUE O LANÇAMENTO TEM HOJE
-- ─────────────────────────────────────────
UPDATE transaction_allocations a
   SET category_id = t.category_id
  FROM transactions t
 WHERE t.id = a.transaction_id
   AND a.category_id IS NULL
   AND t.category_id IS NOT NULL;

-- ─────────────────────────────────────────
-- 3. O LANÇAMENTO RATEADO FICA SEM NATUREZA
-- ─────────────────────────────────────────
UPDATE transactions t
   SET category_id = NULL
 WHERE t.category_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = t.id);

-- ─────────────────────────────────────────
-- 4a. A INVARIANTE PASSA A COBRIR A NATUREZA
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
         (category_id IS NOT NULL
          OR cost_center_id IS NOT NULL OR business_unit_id IS NOT NULL
          OR legal_entity_id IS NOT NULL OR contact_id IS NOT NULL)
    INTO v_amount, v_direct
    FROM transactions WHERE id = p_tx;

  -- Lançamento já apagado (o CASCADE levou as partes junto): nada a validar.
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
    INTO v_count, v_sum
    FROM transaction_allocations WHERE transaction_id = p_tx;

  IF v_count = 0 THEN RETURN; END IF;

  IF v_count > 50 THEN
    RAISE EXCEPTION 'Rateio do lançamento % tem % partes, acima do limite de 50.',
      p_tx, v_count;
  END IF;

  IF v_sum <> v_amount THEN
    RAISE EXCEPTION 'O rateio do lançamento % soma % e o lançamento vale %. As partes têm de fechar o valor exato.',
      p_tx, v_sum, v_amount;
  END IF;

  -- A verdade mora num lugar só: com rateio, a natureza e as dimensões do
  -- lançamento ficam vazias. Preenchidas, toda leitura que ainda lesse o
  -- lançamento atribuiria o valor INTEGRAL a uma das partes.
  IF v_direct THEN
    RAISE EXCEPTION 'O lançamento % tem rateio: a natureza e as dimensões dele têm de ficar vazias (a classificação vive nas partes).',
      p_tx;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────
-- 4b. O GATILHO DO LANÇAMENTO PASSA A OLHAR category_id
-- ─────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_transaction_allocation_guard ON transactions;
CREATE CONSTRAINT TRIGGER trg_transaction_allocation_guard
  AFTER UPDATE OF amount, category_id, cost_center_id, business_unit_id, legal_entity_id, contact_id
  ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_fn_transaction_allocation_guard();

-- ─────────────────────────────────────────
-- 4c. A VIEW: no ramo com rateio, a natureza vem da PARTE
-- ─────────────────────────────────────────
-- Mesmas colunas, mesma ordem e mesmos tipos da 0026 — por isso OR REPLACE.
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
    a.category_id,
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
  'Uma linha por lançamento sem rateio, uma por parte quando há rateio. Amount, natureza e as quatro dimensões vêm da parte; data e conta vêm do lançamento. Natureza por parte desde a 0033.';
