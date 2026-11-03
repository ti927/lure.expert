-- 0035 — Correção de DADOS do Pluggy (sem mudança de estrutura). 03/nov/2026.
--
-- Relatório de 01/11 (agente do app.lure), conferido no código e no banco:
--
-- A) DATA UM DIA À FRENTE. O sync gravava `toISOString()` — a data em UTC. O
--    Pluggy manda horários como T02:59:59Z, que em Brasília é 23:59 do dia
--    ANTERIOR. Medido: 530 de 5.983 lançamentos, todos com exatamente a data UTC
--    (nenhum editado à mão). O código novo grava em America/Sao_Paulo; isto
--    alinha o passado. Julio autorizou mexer em meses fechados.
--    Fica de fora: lançamento casado com NF-e (a data é a da emissão) e o que não
--    tem mais a data UTC (alguém mexeu).
--
-- B) PENDENTE COM GÊMEA EFETIVADA. 35 lançamentos ficaram PENDING para sempre
--    enquanto o banco os efetivava com outro id. Não apaga nada: vão para a fila de
--    "lançamentos que podem estar em dobro" (/transacoes/reconciliacao), com a
--    efetivada ao lado, para Julio confirmar um a um. Pedido dele.
--
-- Idempotente: rodar de novo não acha mais nada em A, e B pula o que já está na fila.

BEGIN;
SET LOCAL lock_timeout = '3s';

-- A) datas
UPDATE transactions t
   SET date = ((t.raw_data->>'date')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,
       effective_date = CASE
         WHEN t.effective_date IS NULL
           OR t.effective_date = ((t.raw_data->>'date')::timestamptz AT TIME ZONE 'UTC')::date
         THEN ((t.raw_data->>'date')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
         ELSE t.effective_date END,
       updated_at = now()
  FROM data_sources ds
 WHERE ds.id = t.data_source_id
   AND ds.provider = 'pluggy'
   AND t.raw_data ? 'date'
   AND t.invoice_id IS NULL
   AND t.date = ((t.raw_data->>'date')::timestamptz AT TIME ZONE 'UTC')::date
   AND t.date <> ((t.raw_data->>'date')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date;

-- B) pendentes com gêmea efetivada → fila de revisão
WITH pares AS (
  SELECT DISTINCT ON (p.id)
         p.id AS pendente, q.id AS efetivada,
         round(similarity(q.description, p.description)::numeric, 4) AS score
    FROM transactions p
    JOIN transactions q
      ON q.organization_id = p.organization_id
     AND q.account_id      = p.account_id
     AND q.id <> p.id
     AND q.direction = p.direction
     AND q.amount    = p.amount
     AND abs(q.date - p.date) <= 3
     AND q.raw_data->>'status' = 'POSTED'
     AND q.status NOT IN ('duplicate', 'ignored')
     AND q.external_id IS NOT NULL
     AND similarity(q.description, p.description) > 0.5
   WHERE p.raw_data->>'status' = 'PENDING'
     AND p.status NOT IN ('duplicate', 'ignored')
     AND p.external_id IS NOT NULL
     AND COALESCE(p.metadata->>'reconciliationPending', '') <> 'true'
   ORDER BY p.id, similarity(q.description, p.description) DESC, abs(q.date - p.date)
)
UPDATE transactions t
   SET needs_review = true,
       metadata = t.metadata || jsonb_build_object(
         'reconciliationPending',     true,
         'reconciliationCandidateId', pares.efetivada,
         'reconciliationScore',       pares.score,
         'reconciliationKind',        'pendente'),
       updated_at = now()
  FROM pares
 WHERE t.id = pares.pendente;

COMMIT;
