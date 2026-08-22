-- Fase 10.5 — Modelos de rateio reutilizáveis.
--
-- Um modelo é a MESMA coisa que o diálogo de rateio em lote já monta: N partes,
-- cada uma com um peso relativo e as quatro dimensões. A diferença é que ele
-- fica salvo com nome e volta em um clique.
--
-- PESO, não valor. Um modelo é aplicado a lançamentos de valores diferentes —
-- o aluguel de 12.000 e a conta de luz de 340 podem seguir a mesma divisão
-- 60/40. Guardar valor amarraria o modelo a um lançamento só. Os centavos são
-- resolvidos na aplicação, pelo método do maior resto (`applyProportion`), que
-- é o que garante a soma exata exigida pela migration 0026.
--
-- Os pesos NÃO precisam somar 100: 60:40, 6:4 e 7200:4800 são o mesmo modelo.
-- Só a razão entre eles importa, e a exibição normaliza para percentual. Isso é
-- o que permite "Salvar como modelo" a partir de um rateio já feito em reais,
-- sem arredondar nada no caminho.
--
-- Rodar no Supabase Studio > SQL Editor.

-- ─────────────────────────────────────────
-- 1. TABELAS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS allocation_templates (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  description       text,

  -- Arquivar em vez de apagar: some do seletor mas preserva o rastro dos
  -- lançamentos que já foram rateados por ele. Mesmo padrão dos cadastros de
  -- dimensão (cost_centers, business_units, contacts).
  is_active         boolean     NOT NULL DEFAULT true,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT allocation_templates_name_chk CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS allocation_template_lines (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- CASCADE: apagar o modelo leva as linhas. Linha órfã não é nada.
  template_id       uuid          NOT NULL REFERENCES allocation_templates(id) ON DELETE CASCADE,

  -- Ordem de exibição dentro do modelo.
  sequence          integer       NOT NULL DEFAULT 1,

  -- Peso relativo, sempre positivo.
  --
  -- (18,6) e não (12,4): "Salvar como modelo" a partir do diálogo individual
  -- guarda os CENTAVOS do rateio como peso — é o que preserva a divisão exata
  -- sem arredondar. Um lançamento de R$ 1 milhão vira peso 100.000.000, que
  -- estoura os 8 dígitos inteiros de (12,4). Aqui cabem 12, até a casa dos
  -- bilhões. As 6 casas decimais cobrem proporções digitadas à mão (33,3333).
  weight            numeric(18,6) NOT NULL,

  -- As quatro dimensões, iguais às da parte que este modelo vai criar.
  -- SET NULL: apagar um centro de custo esvazia a linha em vez de destruir o
  -- modelo inteiro — o usuário conserta a linha e segue.
  cost_center_id    uuid          REFERENCES cost_centers(id)   ON DELETE SET NULL,
  business_unit_id  uuid          REFERENCES business_units(id) ON DELETE SET NULL,
  legal_entity_id   uuid          REFERENCES legal_entities(id) ON DELETE SET NULL,
  contact_id        uuid          REFERENCES contacts(id)       ON DELETE SET NULL,

  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT allocation_template_lines_weight_chk   CHECK (weight > 0),
  CONSTRAINT allocation_template_lines_sequence_chk CHECK (sequence >= 1)
);

-- O teto de 50 linhas por modelo NÃO é imposto aqui de propósito: um modelo
-- grande demais só falha quando aplicado, e ali o gatilho da 0026 e o Zod de
-- `saveAllocations` já recusam com mensagem boa. Um gatilho a mais seria uma
-- segunda fonte da mesma regra.

-- ─────────────────────────────────────────
-- 2. CARIMBO DE ORIGEM NA PARTE
-- ─────────────────────────────────────────
-- De qual modelo esta parte nasceu. Só isso permite responder "quantos
-- lançamentos usam este modelo?" antes de apagá-lo.
--
-- SET NULL: apagar o modelo não pode destruir o rateio já feito — os valores
-- continuam valendo, só perdem a etiqueta de origem.
--
-- O carimbo é gravado apenas quando o rateio foi aplicado a partir do modelo E
-- não sofreu edição depois; ver `allocation-dialog.tsx`. Contar a mais seria
-- pior que contar a menos numa tela que existe para decidir se dá para apagar.
ALTER TABLE transaction_allocations
  ADD COLUMN IF NOT EXISTS allocation_template_id uuid
    REFERENCES allocation_templates(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────
-- 3. ÍNDICES
-- ─────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_alloc_tpl_org_name
  ON allocation_templates (organization_id, lower(trim(name)));

CREATE INDEX IF NOT EXISTS idx_alloc_tpl_org
  ON allocation_templates (organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_alloc_tpl_line_template
  ON allocation_template_lines (template_id, sequence);

CREATE INDEX IF NOT EXISTS idx_alloc_tpl_line_org
  ON allocation_template_lines (organization_id);

-- A contagem de uso: quantos lançamentos distintos por modelo.
CREATE INDEX IF NOT EXISTS idx_alloc_template
  ON transaction_allocations (allocation_template_id)
  WHERE allocation_template_id IS NOT NULL;

-- ─────────────────────────────────────────
-- 4. TRIGGERS updated_at
-- ─────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_allocation_templates_updated_at ON allocation_templates;
CREATE TRIGGER trg_allocation_templates_updated_at
  BEFORE UPDATE ON allocation_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_allocation_template_lines_updated_at ON allocation_template_lines;
CREATE TRIGGER trg_allocation_template_lines_updated_at
  BEFORE UPDATE ON allocation_template_lines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────
ALTER TABLE allocation_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_template_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allocation_templates: leitura pela org" ON allocation_templates;
CREATE POLICY "allocation_templates: leitura pela org"
  ON allocation_templates FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "allocation_templates: insert pela org" ON allocation_templates;
CREATE POLICY "allocation_templates: insert pela org"
  ON allocation_templates FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "allocation_templates: update pela org" ON allocation_templates;
CREATE POLICY "allocation_templates: update pela org"
  ON allocation_templates FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "allocation_templates: delete pela org" ON allocation_templates;
CREATE POLICY "allocation_templates: delete pela org"
  ON allocation_templates FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "allocation_template_lines: leitura pela org" ON allocation_template_lines;
CREATE POLICY "allocation_template_lines: leitura pela org"
  ON allocation_template_lines FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "allocation_template_lines: insert pela org" ON allocation_template_lines;
CREATE POLICY "allocation_template_lines: insert pela org"
  ON allocation_template_lines FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "allocation_template_lines: update pela org" ON allocation_template_lines;
CREATE POLICY "allocation_template_lines: update pela org"
  ON allocation_template_lines FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "allocation_template_lines: delete pela org" ON allocation_template_lines;
CREATE POLICY "allocation_template_lines: delete pela org"
  ON allocation_template_lines FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );
