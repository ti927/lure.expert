-- Análise de fornecedores: mesa de negociação e agrupamentos (24/nov/2026).
--
-- A tela /fornecedores consolida as despesas por FORNECEDOR (curva ABC 70/20/10,
-- matriz natureza × mês, lançamentos) e mantém uma MESA DE NEGOCIAÇÃO: os
-- fornecedores marcados para negociar, com a redução combinada. Ver Decisão 33 em
-- docs/SCHEMA_DECISIONS.md.
--
-- Duas tabelas novas, nenhuma coluna em tabela existente:
--
--   supplier_negotiations  — a mesa. Uma linha por organização e fornecedor.
--   supplier_groupings     — agrupamentos configuráveis por organização ("descrição
--                            contém X" → um fornecedor só), para o que a regra
--                            genérica não alcança: a folha paga em TED de lote, o
--                            câmbio pago a uma corretora antes de virar fornecedor.
--
-- O FORNECEDOR NÃO É UMA FK. Ele é uma CHAVE de texto calculada na leitura
-- (lib/fornecedores.ts): 'C:<contact_id>', 'G:<agrupamento_id>', 'J:<cnpj>' ou
-- 'D:<descrição normalizada>'. Metade do valor de uma base importada não tem
-- contato, e a mesa precisa negociar com esses também. `rotulo` guarda o nome como
-- estava ao marcar, para a mesa se explicar mesmo se a chave deixar de aparecer.
--
-- Rodar no Supabase Studio > SQL Editor. Reversa: 0037_down_fornecedores.sql
-- (perde a mesa e os agrupamentos).

-- ── a mesa ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_negotiations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  chave           text NOT NULL,
  rotulo          text NOT NULL,
  -- 'pct' = percentual sobre o gasto mensal; 'valor' = reais a menos por mês
  tipo            text NOT NULL DEFAULT 'pct',
  reducao         numeric(15,2) NOT NULL DEFAULT 0,
  nota            text NOT NULL DEFAULT '',
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_negotiations_tipo_chk    CHECK (tipo IN ('pct', 'valor')),
  CONSTRAINT supplier_negotiations_reducao_chk CHECK (reducao >= 0 AND (tipo <> 'pct' OR reducao <= 100)),
  CONSTRAINT supplier_negotiations_chave_chk   CHECK (length(chave) BETWEEN 3 AND 300),
  CONSTRAINT supplier_negotiations_nota_chk    CHECK (length(nota) <= 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_negotiations_org_chave_unq
  ON supplier_negotiations (organization_id, chave);

-- ── os agrupamentos ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_groupings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  -- trecho procurado na descrição já normalizada (minúsculas, sem acento, só letras)
  padrao          text NOT NULL,
  -- só casa lançamento desta Natureza Pai (nulo = qualquer natureza)
  natureza_pai_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  -- lançamentos DESTE contato também entram no grupo (ex.: a corretora de câmbio)
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- casa mesmo quando o lançamento já tem contato (a folha: as partes do rateio de
  -- uma TED em lote apontam para o banco ou para cada pessoa, e ainda assim é folha)
  sobrepoe_contato boolean NOT NULL DEFAULT false,
  ordem           integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_groupings_nome_chk   CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  CONSTRAINT supplier_groupings_padrao_chk CHECK (length(padrao) BETWEEN 3 AND 120)
);
CREATE INDEX IF NOT EXISTS idx_supplier_groupings_org ON supplier_groupings (organization_id, ordem);

-- ── updated_at ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_supplier_negotiations_updated_at ON supplier_negotiations;
CREATE TRIGGER trg_supplier_negotiations_updated_at
  BEFORE UPDATE ON supplier_negotiations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_supplier_groupings_updated_at ON supplier_groupings;
CREATE TRIGGER trg_supplier_groupings_updated_at
  BEFORE UPDATE ON supplier_groupings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE supplier_negotiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_groupings    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_negotiations', 'supplier_groupings']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': leitura pela org', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT
      USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL))$p$,
      t || ': leitura pela org', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': insert pela org', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT
      WITH CHECK (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL))$p$,
      t || ': insert pela org', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': update pela org', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE
      USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL))$p$,
      t || ': update pela org', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': delete pela org', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR DELETE
      USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND accepted_at IS NOT NULL))$p$,
      t || ': delete pela org', t);
  END LOOP;
END $$;
