-- Migração: Novos tipos de natureza financeira
-- Remapeia 7 tipos genéricos → 14 tipos específicos (DRE + BP)
-- Rodar no Supabase Studio > SQL Editor

-- ─── 1. Remapear tipos existentes ────────────────────────────────────────────

UPDATE categories SET type = 'receita_operacional' WHERE type = 'revenue';
UPDATE categories SET type = 'cpv'                  WHERE type = 'cost';
UPDATE categories SET type = 'sga'                  WHERE type = 'expense';
UPDATE categories SET type = 'ativo_circulante'     WHERE type = 'asset';
UPDATE categories SET type = 'passivo_circulante'   WHERE type = 'liability';
UPDATE categories SET type = 'patrimonio_liquido'   WHERE type = 'equity';
-- 'transfer' permanece igual

-- ─── 2. Recriar função de seed com novos tipos ───────────────────────────────

DROP TRIGGER IF EXISTS trg_seed_categories_on_org_create ON organizations;
DROP FUNCTION IF EXISTS seed_default_categories();

CREATE OR REPLACE FUNCTION seed_default_categories()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  org uuid := NEW.id;
  -- DRE pais
  p1  uuid; p2  uuid; p3  uuid; p4  uuid;
  p51 uuid; p52 uuid; p53 uuid;
  p61 uuid; p62 uuid;
  p7  uuid; p8  uuid; p9  uuid;
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

  -- ── Investimentos & Amortizações ─────────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type)
    VALUES (gen_random_uuid(), org, '8', 'Investimentos e Amortizações', 'investimento')
    RETURNING id INTO p8;

  INSERT INTO categories (organization_id, code, name, type, parent_id) VALUES
    (org, '8.1', 'Compra de Imobilizado',         'investimento', p8),
    (org, '8.2', 'Depreciação e Amortização',      'investimento', p8),
    (org, '8.3', 'Investimentos em Intangíveis',   'investimento', p8);

  -- ── Transferências ───────────────────────────────────────────────────────
  INSERT INTO categories (id, organization_id, code, name, type,
    metadata)
    VALUES (gen_random_uuid(), org, '9', 'Transferências', 'transfer',
      '{"system": true}'::jsonb)
    RETURNING id INTO p9;

  INSERT INTO categories (organization_id, code, name, type, parent_id,
    metadata) VALUES
    (org, '9.1', 'Transferências entre Contas', 'transfer', p9,
      '{"system": true}'::jsonb);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_categories_on_org_create
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION seed_default_categories();
