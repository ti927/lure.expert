-- Migration 0020: adiciona coluna opex_capex às categorias.
--
-- Classifica Naturezas Pai como operacional (opex) ou não-operacional (capex).
-- Seed padrão financeiro:
--   emprestimos_amortizacoes, investimentos_retiradas, transfer → capex
--   todos os demais tipos → opex (default)
--
-- A coluna é irrelevante para Naturezas Filho (herdam do Pai via JOIN no fluxo).
--
-- Aplicar manualmente no Supabase Studio > SQL Editor.

BEGIN;

-- ─── 1. Adiciona coluna ────────────────────────────────────────────────────────

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS opex_capex text NOT NULL DEFAULT 'opex';

COMMENT ON COLUMN categories.opex_capex IS
  'Classifica naturezas pai: opex = operacional, capex = nao-operacional. Irrelevante em filhos (herdam do pai).';

-- ─── 2. Atualiza dados existentes ──────────────────────────────────────────────

UPDATE categories
SET opex_capex = 'capex'
WHERE parent_id IS NULL
  AND type IN ('emprestimos_amortizacoes', 'investimentos_retiradas', 'transfer');

-- ─── 3. Atualiza função seed para novas orgs ───────────────────────────────────

CREATE OR REPLACE FUNCTION seed_categories_for_org(org uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  p1  uuid; p2  uuid; p3  uuid; p4  uuid;
  p51 uuid; p52 uuid; p53 uuid;
  p61 uuid; p62 uuid;
  p7  uuid; p8  uuid; p9  uuid; p10 uuid;
BEGIN

  -- ── Receita Operacional ──────────────────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type)
    VALUES (gen_random_uuid(), org, '1', 'Receitas Operacionais', 'receita_operacional')
    RETURNING id INTO p1;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '1.1', 'Receitas de Serviços',   'receita_operacional', p1),
    (org, '1.2', 'Receitas de Produtos',   'receita_operacional', p1),
    (org, '1.3', 'Outras Receitas',        'receita_operacional', p1);

  -- ── Deduções Tributárias ─────────────────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type)
    VALUES (gen_random_uuid(), org, '2', 'Deduções Tributárias', 'deducoes_tributarias')
    RETURNING id INTO p2;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '2.1', 'ISS',                'deducoes_tributarias', p2),
    (org, '2.2', 'PIS',                'deducoes_tributarias', p2),
    (org, '2.3', 'COFINS',             'deducoes_tributarias', p2),
    (org, '2.4', 'ICMS',               'deducoes_tributarias', p2),
    (org, '2.5', 'Devoluções e Abatimentos', 'deducoes_tributarias', p2);

  -- ── Deduções Operacionais ────────────────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type)
    VALUES (gen_random_uuid(), org, '3', 'Deduções Operacionais', 'deducoes_operacionais')
    RETURNING id INTO p3;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '3.1', 'Comissões de Vendas',    'deducoes_operacionais', p3),
    (org, '3.2', 'Custos de Marketplace',  'deducoes_operacionais', p3);

  -- ── CPV / CMV / CSP ──────────────────────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type)
    VALUES (gen_random_uuid(), org, '4', 'Custo dos Produtos e Serviços', 'cpv')
    RETURNING id INTO p4;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '4.1', 'CMV / CME',              'cpv', p4),
    (org, '4.2', 'Mão de Obra Direta',     'cpv', p4),
    (org, '4.3', 'Subcontratados',         'cpv', p4),
    (org, '4.4', 'Insumos e Matérias-Primas', 'cpv', p4);

  -- ── SG&A — Pessoal ───────────────────────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type)
    VALUES (gen_random_uuid(), org, '5.1', 'Despesas com Pessoal', 'sga')
    RETURNING id INTO p51;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '5.1.1', 'Salários e Ordenados',       'sga', p51),
    (org, '5.1.2', 'Encargos Trabalhistas',       'sga', p51),
    (org, '5.1.3', 'Benefícios',                  'sga', p51),
    (org, '5.1.4', '13o Salário e Férias',        'sga', p51),
    (org, '5.1.5', 'Pró-labore',                  'sga', p51);

  -- ── SG&A — Administrativo ────────────────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type)
    VALUES (gen_random_uuid(), org, '5.2', 'Despesas Administrativas', 'sga')
    RETURNING id INTO p52;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '5.2.1', 'Aluguel e Condomínio',        'sga', p52),
    (org, '5.2.2', 'Energia, Água e Gás',         'sga', p52),
    (org, '5.2.3', 'Internet e Telefone',          'sga', p52),
    (org, '5.2.4', 'Software e Assinaturas',       'sga', p52),
    (org, '5.2.5', 'Material de Escritório',       'sga', p52),
    (org, '5.2.6', 'Contabilidade e Jurídico',     'sga', p52),
    (org, '5.2.7', 'Seguros',                      'sga', p52),
    (org, '5.2.8', 'Manutenção e Reparos',         'sga', p52),
    (org, '5.2.9', 'Outras Despesas Administrativas', 'sga', p52);

  -- ── SG&A — Comercial ─────────────────────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type)
    VALUES (gen_random_uuid(), org, '5.3', 'Despesas Comerciais', 'sga')
    RETURNING id INTO p53;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '5.3.1', 'Marketing e Publicidade',  'sga', p53),
    (org, '5.3.2', 'Viagens e Representação',  'sga', p53),
    (org, '5.3.3', 'Eventos',                  'sga', p53);

  -- ── Resultado Financeiro — Receitas ──────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type)
    VALUES (gen_random_uuid(), org, '6.1', 'Receitas Financeiras', 'resultado_financeiro')
    RETURNING id INTO p61;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '6.1.1', 'Juros e Rendimentos',        'resultado_financeiro', p61),
    (org, '6.1.2', 'Variação Cambial Ativa',      'resultado_financeiro', p61);

  -- ── Resultado Financeiro — Despesas ──────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type)
    VALUES (gen_random_uuid(), org, '6.2', 'Despesas Financeiras', 'resultado_financeiro')
    RETURNING id INTO p62;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '6.2.1', 'Juros e IOF',             'resultado_financeiro', p62),
    (org, '6.2.2', 'Tarifas Bancárias',        'resultado_financeiro', p62),
    (org, '6.2.3', 'Multas e Penalidades',     'resultado_financeiro', p62);

  -- ── Impostos Sobre Renda ─────────────────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type)
    VALUES (gen_random_uuid(), org, '7', 'Impostos sobre Resultado', 'ir')
    RETURNING id INTO p7;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '7.1', 'IRPJ',             'ir', p7),
    (org, '7.2', 'CSLL',             'ir', p7),
    (org, '7.3', 'Simples Nacional', 'ir', p7);

  -- ── Empréstimos & Amortizações (CAPEX) ──────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type, opex_capex)
    VALUES (gen_random_uuid(), org, '8', 'Empréstimos e Amortizações',
            'emprestimos_amortizacoes', 'capex')
    RETURNING id INTO p8;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '8.1', 'Empréstimos Tomados',            'emprestimos_amortizacoes', p8),
    (org, '8.2', 'Pagamento de Principal',         'emprestimos_amortizacoes', p8),
    (org, '8.3', 'Juros e Encargos de Empréstimo', 'emprestimos_amortizacoes', p8);

  -- ── Investimentos & Retiradas (CAPEX) ───────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type, opex_capex)
    VALUES (gen_random_uuid(), org, '9', 'Investimentos e Retiradas',
            'investimentos_retiradas', 'capex')
    RETURNING id INTO p9;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '9.1', 'Compra de Imobilizado',         'investimentos_retiradas', p9),
    (org, '9.2', 'Depreciação e Amortização',     'investimentos_retiradas', p9),
    (org, '9.3', 'Investimentos em Intangíveis',  'investimentos_retiradas', p9);

  -- ── Transferências (CAPEX) ───────────────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type, metadata, opex_capex)
    VALUES (gen_random_uuid(), org, '10', 'Transferências', 'transfer',
            '{"system": true}'::jsonb, 'capex')
    RETURNING id INTO p10;

  INSERT INTO categories (organization_id, code, name, type, parent_id, metadata) VALUES
    (org, '10.1', 'Transferências entre Contas', 'transfer', p10,
      '{"system": true}'::jsonb);
END;
$$;

COMMIT;
