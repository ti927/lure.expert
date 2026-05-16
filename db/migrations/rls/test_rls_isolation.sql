-- =====================================================
-- SCRIPT DE TESTE: Isolamento RLS em 18 tabelas
-- =====================================================
-- Como usar:
--   1. Abrir Supabase Studio > SQL Editor
--   2. Colar e rodar este script inteiro de uma vez
--   3. Conferir RAISE NOTICE no output para ver resultados
--   4. O ROLLBACK no final descarta todos os dados de teste
--
-- Cada tabela deve retornar COUNT = 0 quando consultada por
-- user_b (que pertence somente à org_b).
-- =====================================================

BEGIN;

DO $$
DECLARE
  org_a   UUID := gen_random_uuid();
  org_b   UUID := gen_random_uuid();
  user_a  UUID := gen_random_uuid();
  user_b  UUID := gen_random_uuid();
  ds_a    UUID := gen_random_uuid();
  cat_a   UUID := gen_random_uuid();
  conv_a  UUID := gen_random_uuid();
  cnt     BIGINT;
  fails   INT  := 0;
  report  TEXT := '';
BEGIN

  -- ============================================================
  -- 1. INSERIR DADOS DE TESTE (como postgres — bypassa RLS)
  -- ============================================================

  INSERT INTO organizations(id, name, slug) VALUES
    (org_a, '_teste_org_alfa', '_t-alfa-' || left(org_a::text, 8)),
    (org_b, '_teste_org_beta', '_t-beta-' || left(org_b::text, 8));

  INSERT INTO memberships(user_id, organization_id, role, accepted_at) VALUES
    (user_a, org_a, 'owner', now()),
    (user_b, org_b, 'owner', now());

  INSERT INTO data_sources(id, organization_id, type, provider, name)
  VALUES (ds_a, org_a, 'bank', 'manual', '_teste_banco');

  INSERT INTO categories(id, organization_id, code, name, type)
  VALUES (cat_a, org_a, '_TESTE-001', '_Categoria Teste', 'expense');

  INSERT INTO contacts(organization_id, type, name)
  VALUES (org_a, 'supplier', '_Fornecedor Teste');

  INSERT INTO categorization_rules(organization_id, name, conditions, target_category_id)
  VALUES (org_a, '_Regra Teste', '{}', cat_a);

  INSERT INTO fixed_assets(organization_id, name, acquisition_date, acquisition_value, current_value)
  VALUES (org_a, '_Ativo Teste', '2024-01-01', 100000, 90000);

  INSERT INTO loans(organization_id, name, lender, type, original_amount, current_balance, start_date)
  VALUES (org_a, '_Emprestimo Teste', 'Banco', 'term', 50000, 45000, '2024-01-01');

  INSERT INTO equity_movements(organization_id, type, amount, direction, date, description)
  VALUES (org_a, 'capital', 100000, 'in', '2024-01-01', '_Aporte Teste');

  INSERT INTO inventory_snapshots(organization_id, snapshot_date, total_value)
  VALUES (org_a, '2024-01-31', 30000);

  INSERT INTO credit_card_invoices(organization_id, data_source_id, reference_month, total_amount)
  VALUES (org_a, ds_a, '2099-01', 5000);

  INSERT INTO documents(organization_id, type, filename, storage_path, mime_type, size_bytes)
  VALUES (org_a, 'bank_statement', '_extrato.pdf', '_teste/extrato.pdf', 'application/pdf', 102400);

  INSERT INTO transactions(organization_id, data_source_id, date, amount, direction, description)
  VALUES (org_a, ds_a, '2024-01-15', 1000, 'out', '_Pagamento Teste');

  INSERT INTO templates(organization_id, source_type, name, structure)
  VALUES (org_a, 'erp', '_Template Teste', '{}');

  INSERT INTO conversations(id, organization_id, user_id)
  VALUES (conv_a, org_a, user_a);

  INSERT INTO messages(conversation_id, role, content)
  VALUES (conv_a, 'user', '_Mensagem Teste');

  INSERT INTO organization_facts(organization_id, type, key, value)
  VALUES (org_a, 'context', '_setor', 'tecnologia');

  INSERT INTO agent_events(organization_id, type, payload)
  VALUES (org_a, 'test', '{"_teste": true}');

  -- ============================================================
  -- 2. SIMULAR user_b (pertence somente à org_b)
  -- set_config com is_local=true → descartado no ROLLBACK
  -- SET LOCAL ROLE → válido somente nesta transação
  -- ============================================================

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub": "' || user_b::text || '", "role": "authenticated"}',
    true
  );

  EXECUTE 'SET LOCAL ROLE authenticated';

  -- ============================================================
  -- 3. TESTAR ISOLAMENTO — cada COUNT deve retornar 0
  -- ============================================================

  SELECT COUNT(*) INTO cnt FROM organizations WHERE id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     organizations\n';
  ELSE report := report || '  [FALHOU] organizations (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM memberships WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     memberships\n';
  ELSE report := report || '  [FALHOU] memberships (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM data_sources WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     data_sources\n';
  ELSE report := report || '  [FALHOU] data_sources (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM contacts WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     contacts\n';
  ELSE report := report || '  [FALHOU] contacts (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM categories WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     categories\n';
  ELSE report := report || '  [FALHOU] categories (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM categorization_rules WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     categorization_rules\n';
  ELSE report := report || '  [FALHOU] categorization_rules (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM fixed_assets WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     fixed_assets\n';
  ELSE report := report || '  [FALHOU] fixed_assets (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM loans WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     loans\n';
  ELSE report := report || '  [FALHOU] loans (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM equity_movements WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     equity_movements\n';
  ELSE report := report || '  [FALHOU] equity_movements (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM inventory_snapshots WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     inventory_snapshots\n';
  ELSE report := report || '  [FALHOU] inventory_snapshots (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM credit_card_invoices WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     credit_card_invoices\n';
  ELSE report := report || '  [FALHOU] credit_card_invoices (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM documents WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     documents\n';
  ELSE report := report || '  [FALHOU] documents (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM transactions WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     transactions\n';
  ELSE report := report || '  [FALHOU] transactions (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  -- templates: org-específico da org_a não deve aparecer pra user_b
  SELECT COUNT(*) INTO cnt FROM templates WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     templates (org-especifico)\n';
  ELSE report := report || '  [FALHOU] templates (org-especifico) (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM conversations WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     conversations\n';
  ELSE report := report || '  [FALHOU] conversations (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  -- messages: via conversation_id da org_a (sem organization_id direto)
  SELECT COUNT(*) INTO cnt FROM messages WHERE conversation_id = conv_a;
  IF cnt = 0 THEN report := report || E'  [OK]     messages (via conversation)\n';
  ELSE report := report || '  [FALHOU] messages (via conversation) (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM organization_facts WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     organization_facts\n';
  ELSE report := report || '  [FALHOU] organization_facts (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt FROM agent_events WHERE organization_id = org_a;
  IF cnt = 0 THEN report := report || E'  [OK]     agent_events\n';
  ELSE report := report || '  [FALHOU] agent_events (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;

  -- ============================================================
  -- 4. RESULTADO FINAL
  -- ============================================================

  RAISE NOTICE E'\n========== RESULTADO RLS ==========\n%\nTotal: % de 18 tabelas com falha.',
    report, fails;

  IF fails > 0 THEN
    RAISE EXCEPTION '❌  ISOLAMENTO FALHOU em % tabela(s). Veja RAISE NOTICE acima.', fails;
  END IF;

  RAISE NOTICE '✅  Todos os 18 testes passaram — RLS está correto.';

END $$;

-- Descarta todos os dados de teste (e o SET LOCAL ROLE)
ROLLBACK;

-- =====================================================
-- SE ALGO FALHOU: listar policies existentes
-- =====================================================
-- SELECT tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
--
-- Tabelas sem RLS habilitado:
-- SELECT tablename FROM pg_tables
-- WHERE schemaname = 'public'
-- AND NOT rowsecurity;
-- =====================================================
