-- =====================================================
-- SCRIPT DE TESTE: migration 0024 (Orçamento)
-- =====================================================
-- Como usar:
--   1. Abrir Supabase Studio > SQL Editor
--   2. Colar e rodar este script inteiro de uma vez
--   3. Conferir o RAISE NOTICE no output
--   4. O ROLLBACK no final descarta todos os dados de teste
--
-- Cobre três coisas:
--   A. Estrutura   — tabelas, RLS habilitada, 12 policies, 3 triggers updated_at
--   B. Constraints — os CHECKs e índices únicos rejeitam o que deveriam rejeitar
--   C. Isolamento  — user_b (só da org_b) enxerga 0 linhas do orçamento da org_a
--
-- NOTA sobre `test_rls_isolation.sql` (o script irmão, da Fase 1.8): ele está
-- desatualizado e falha logo no início com `relation "fixed_assets" does not
-- exist`. As tabelas fixed_assets, loans, equity_movements e inventory_snapshots
-- foram dropadas na migration 0015 (redesign do BP). Ele também usa valores
-- antigos (categories.type = 'expense', transactions.direction = 'out').
-- =====================================================

BEGIN;

DO $$
DECLARE
  org_a    UUID := gen_random_uuid();
  org_b    UUID := gen_random_uuid();
  user_a   UUID := gen_random_uuid();
  user_b   UUID := gen_random_uuid();
  cat_pai  UUID := gen_random_uuid();
  cat_fil  UUID := gen_random_uuid();
  ver_a    UUID := gen_random_uuid();
  ser_a    UUID := gen_random_uuid();
  ent_a    UUID := gen_random_uuid();
  cnt      BIGINT;
  ts_antes TIMESTAMPTZ;
  ts_depois TIMESTAMPTZ;
  fails    INT  := 0;
  report   TEXT := '';
BEGIN

  -- ============================================================
  -- A. ESTRUTURA
  -- ============================================================

  SELECT COUNT(*) INTO cnt
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename IN ('budget_versions', 'budget_series', 'budget_entries');
  IF cnt = 3 THEN report := report || E'  [OK]     3 tabelas criadas\n';
  ELSE report := report || '  [FALHOU] esperava 3 tabelas, achou ' || cnt || E'\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename IN ('budget_versions', 'budget_series', 'budget_entries')
    AND rowsecurity;
  IF cnt = 3 THEN report := report || E'  [OK]     RLS habilitada nas 3\n';
  ELSE report := report || '  [FALHOU] RLS habilitada em apenas ' || cnt || E' de 3\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('budget_versions', 'budget_series', 'budget_entries');
  IF cnt = 12 THEN report := report || E'  [OK]     12 policies (4 por tabela)\n';
  ELSE report := report || '  [FALHOU] esperava 12 policies, achou ' || cnt || E'\n'; fails := fails + 1; END IF;

  SELECT COUNT(*) INTO cnt
  FROM pg_trigger
  WHERE NOT tgisinternal
    AND tgname IN ('trg_budget_versions_updated_at', 'trg_budget_series_updated_at', 'trg_budget_entries_updated_at');
  IF cnt = 3 THEN report := report || E'  [OK]     3 triggers updated_at (lacuna das 0022/0023 corrigida)\n';
  ELSE report := report || '  [FALHOU] esperava 3 triggers updated_at, achou ' || cnt || E'\n'; fails := fails + 1; END IF;

  -- ============================================================
  -- B. DADOS DE TESTE (como postgres — bypassa RLS)
  -- ============================================================

  INSERT INTO organizations(id, name, slug) VALUES
    (org_a, '_teste_orc_alfa', '_t-orc-a-' || left(org_a::text, 8)),
    (org_b, '_teste_orc_beta', '_t-orc-b-' || left(org_b::text, 8));

  INSERT INTO memberships(user_id, organization_id, role, accepted_at) VALUES
    (user_a, org_a, 'owner', now()),
    (user_b, org_b, 'owner', now());

  -- Plano de contas de teste: pai + folha (só folha recebe lançamento)
  INSERT INTO categories(id, organization_id, code, name, type, parent_id) VALUES
    (cat_pai, org_a, '_T-ORC-P', '_Despesas Teste',  'sga', NULL),
    (cat_fil, org_a, '_T-ORC-F', '_Aluguel Teste',   'sga', cat_pai);

  INSERT INTO budget_versions(id, organization_id, name, fiscal_year, status, is_active)
  VALUES (ver_a, org_a, '_Orcamento Teste 2027', 2027, 'rascunho', true);

  INSERT INTO budget_series(
    id, organization_id, version_id, description, direction, category_id,
    start_month, occurrences, interval_months, day_of_month, cash_lag_days,
    amount_mode, base_amount
  ) VALUES (
    ser_a, org_a, ver_a, '_Aluguel', 'outflow', cat_fil,
    '2027-01-01', 12, 1, 5, 0,
    'fixo', 12000.00
  );

  INSERT INTO budget_entries(
    id, organization_id, version_id, series_id, sequence, description, direction,
    category_id, competence_date, cash_date, amount
  ) VALUES (
    ent_a, org_a, ver_a, ser_a, 1, '_Aluguel', 'outflow',
    cat_fil, '2027-01-05', '2027-01-05', 12000.00
  );

  report := report || E'  [OK]     insert do caminho feliz (versao + serie + ocorrencia)\n';

  -- ── Trigger updated_at realmente dispara ──
  -- now() é fixo dentro da transação, então antedatamos para ver a mudança.
  UPDATE budget_versions SET updated_at = '2000-01-01'::timestamptz WHERE id = ver_a;
  SELECT updated_at INTO ts_antes FROM budget_versions WHERE id = ver_a;
  UPDATE budget_versions SET description = '_toque' WHERE id = ver_a;
  SELECT updated_at INTO ts_depois FROM budget_versions WHERE id = ver_a;
  IF ts_depois > ts_antes THEN report := report || E'  [OK]     trigger updated_at dispara no UPDATE\n';
  ELSE report := report || E'  [FALHOU] trigger updated_at NAO disparou\n'; fails := fails + 1; END IF;

  -- ============================================================
  -- C. CONSTRAINTS — cada bloco DEVE ser rejeitado
  -- ============================================================

  -- Duas versões vigentes no mesmo exercício
  BEGIN
    INSERT INTO budget_versions(organization_id, name, fiscal_year, is_active)
    VALUES (org_a, '_Outra Vigente 2027', 2027, true);
    report := report || E'  [FALHOU] aceitou 2a versao vigente no mesmo exercicio\n'; fails := fails + 1;
  EXCEPTION WHEN unique_violation THEN
    report := report || E'  [OK]     rejeita 2a versao vigente no mesmo exercicio\n';
  END;

  -- Nome duplicado ignorando caixa e espaços
  BEGIN
    INSERT INTO budget_versions(organization_id, name, fiscal_year)
    VALUES (org_a, '  ORCAMENTO teste 2027 ', 2027);
    report := report || E'  [FALHOU] aceitou nome duplicado (caixa/espacos)\n'; fails := fails + 1;
  EXCEPTION WHEN unique_violation THEN
    report := report || E'  [OK]     rejeita nome duplicado ignorando caixa e espacos\n';
  END;

  -- Versão arquivada não pode ser a vigente
  BEGIN
    INSERT INTO budget_versions(organization_id, name, fiscal_year, status, is_active)
    VALUES (org_a, '_Arquivada Vigente', 2028, 'arquivado', true);
    report := report || E'  [FALHOU] aceitou versao arquivada como vigente\n'; fails := fails + 1;
  EXCEPTION WHEN check_violation THEN
    report := report || E'  [OK]     rejeita versao arquivada marcada como vigente\n';
  END;

  -- start_month tem que ser dia 1
  BEGIN
    INSERT INTO budget_series(organization_id, version_id, description, direction, category_id,
                              start_month, occurrences, amount_mode, base_amount)
    VALUES (org_a, ver_a, '_Meio do mes', 'outflow', cat_fil, '2027-01-15', 12, 'fixo', 100);
    report := report || E'  [FALHOU] aceitou start_month fora do dia 1\n'; fails := fails + 1;
  EXCEPTION WHEN check_violation THEN
    report := report || E'  [OK]     rejeita start_month que nao e dia 1\n';
  END;

  -- sazonal com array de tamanho diferente de occurrences
  BEGIN
    INSERT INTO budget_series(organization_id, version_id, description, direction, category_id,
                              start_month, occurrences, amount_mode, seasonal_amounts)
    VALUES (org_a, ver_a, '_Sazonal torto', 'inflow', cat_fil, '2027-01-01', 12, 'sazonal', '[100,200,300]'::jsonb);
    report := report || E'  [FALHOU] aceitou sazonal com array de tamanho errado\n'; fails := fails + 1;
  EXCEPTION WHEN check_violation THEN
    report := report || E'  [OK]     rejeita sazonal com array != occurrences\n';
  END;

  -- parcelado sem total_amount
  BEGIN
    INSERT INTO budget_series(organization_id, version_id, description, direction, category_id,
                              start_month, occurrences, amount_mode, base_amount)
    VALUES (org_a, ver_a, '_Parcelado sem total', 'outflow', cat_fil, '2027-01-01', 3, 'parcelado', 100);
    report := report || E'  [FALHOU] aceitou parcelado sem total_amount\n'; fails := fails + 1;
  EXCEPTION WHEN check_violation THEN
    report := report || E'  [OK]     rejeita parcelado sem total_amount\n';
  END;

  -- reajuste sem adjustment_rate
  BEGIN
    INSERT INTO budget_series(organization_id, version_id, description, direction, category_id,
                              start_month, occurrences, amount_mode, base_amount)
    VALUES (org_a, ver_a, '_Reajuste sem taxa', 'outflow', cat_fil, '2027-01-01', 12, 'reajuste', 100);
    report := report || E'  [FALHOU] aceitou reajuste sem adjustment_rate\n'; fails := fails + 1;
  EXCEPTION WHEN check_violation THEN
    report := report || E'  [OK]     rejeita reajuste sem adjustment_rate\n';
  END;

  -- ocorrência com valor negativo (o sinal vem de direction, não do amount)
  BEGIN
    INSERT INTO budget_entries(organization_id, version_id, series_id, sequence, description,
                               direction, category_id, competence_date, cash_date, amount)
    VALUES (org_a, ver_a, ser_a, 99, '_Negativo', 'outflow', cat_fil, '2027-02-05', '2027-02-05', -500);
    report := report || E'  [FALHOU] aceitou amount negativo\n'; fails := fails + 1;
  EXCEPTION WHEN check_violation THEN
    report := report || E'  [OK]     rejeita amount negativo (sinal vem de direction)\n';
  END;

  -- sequence duplicada na mesma série (rede contra duplo clique)
  BEGIN
    INSERT INTO budget_entries(organization_id, version_id, series_id, sequence, description,
                               direction, category_id, competence_date, cash_date, amount)
    VALUES (org_a, ver_a, ser_a, 1, '_Duplicada', 'outflow', cat_fil, '2027-01-05', '2027-01-05', 12000);
    report := report || E'  [FALHOU] aceitou sequence duplicada na mesma serie\n'; fails := fails + 1;
  EXCEPTION WHEN unique_violation THEN
    report := report || E'  [OK]     rejeita sequence duplicada na mesma serie\n';
  END;

  -- categoria com orçado não pode ser apagada em silêncio (ON DELETE RESTRICT)
  BEGIN
    DELETE FROM categories WHERE id = cat_fil;
    report := report || E'  [FALHOU] deixou apagar categoria que tem orcado\n'; fails := fails + 1;
  EXCEPTION WHEN foreign_key_violation THEN
    report := report || E'  [OK]     bloqueia delete de categoria com orcado (RESTRICT)\n';
  END;

  -- cash_date PODE vazar do exercício — é a cauda de caixa, não um erro
  BEGIN
    INSERT INTO budget_entries(organization_id, version_id, series_id, sequence, description,
                               direction, category_id, competence_date, cash_date, amount)
    VALUES (org_a, ver_a, ser_a, 12, '_Dezembro', 'outflow', cat_fil, '2027-12-05', '2028-01-04', 12000);
    report := report || E'  [OK]     aceita cash_date fora do exercicio (cauda de caixa)\n';
  EXCEPTION WHEN others THEN
    report := report || '  [FALHOU] rejeitou cauda de caixa: ' || SQLERRM || E'\n'; fails := fails + 1;
  END;

  -- ============================================================
  -- D. ISOLAMENTO — user_b pertence somente à org_b
  -- ============================================================

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub": "' || user_b::text || '", "role": "authenticated"}',
    true
  );

  EXECUTE 'SET LOCAL ROLE authenticated';

  -- Cada leitura é envelopada para que falta de GRANT apareça como diagnóstico
  -- claro em vez de abortar o bloco inteiro com uma mensagem enigmática.
  BEGIN
    SELECT COUNT(*) INTO cnt FROM budget_versions WHERE organization_id = org_a;
    IF cnt = 0 THEN report := report || E'  [OK]     budget_versions isolada\n';
    ELSE report := report || '  [FALHOU] budget_versions vazou (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    report := report || E'  [ATENCAO] sem GRANT de SELECT em budget_versions para authenticated\n';
  END;

  BEGIN
    SELECT COUNT(*) INTO cnt FROM budget_series WHERE organization_id = org_a;
    IF cnt = 0 THEN report := report || E'  [OK]     budget_series isolada\n';
    ELSE report := report || '  [FALHOU] budget_series vazou (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    report := report || E'  [ATENCAO] sem GRANT de SELECT em budget_series para authenticated\n';
  END;

  BEGIN
    SELECT COUNT(*) INTO cnt FROM budget_entries WHERE organization_id = org_a;
    IF cnt = 0 THEN report := report || E'  [OK]     budget_entries isolada\n';
    ELSE report := report || '  [FALHOU] budget_entries vazou (' || cnt || E' row(s))\n'; fails := fails + 1; END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    report := report || E'  [ATENCAO] sem GRANT de SELECT em budget_entries para authenticated\n';
  END;

  -- Escrita cruzada também tem que ser bloqueada
  BEGIN
    INSERT INTO budget_versions(organization_id, name, fiscal_year)
    VALUES (org_a, '_Invasao', 2029);
    report := report || E'  [FALHOU] user_b conseguiu inserir versao na org_a\n'; fails := fails + 1;
  EXCEPTION WHEN insufficient_privilege THEN
    report := report || E'  [OK]     bloqueia insert cruzado em budget_versions\n';
  END;

  -- ============================================================
  -- RESULTADO
  -- ============================================================

  RAISE NOTICE E'\n========== MIGRATION 0024 — ORCAMENTO ==========\n%\nTotal: % falha(s).', report, fails;

  IF fails > 0 THEN
    RAISE EXCEPTION 'Migration 0024 com % problema(s). Veja o RAISE NOTICE acima.', fails;
  END IF;

  RAISE NOTICE 'Todos os testes passaram — estrutura, constraints e isolamento OK.';

END $$;

-- Descarta todos os dados de teste (e o SET LOCAL ROLE)
ROLLBACK;
