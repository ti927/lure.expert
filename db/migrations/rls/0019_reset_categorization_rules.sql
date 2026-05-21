-- Reset das categorization_rules para introduzir escopo por conta (description + accountId).
--
-- Motivação: as regras antigas matchavam apenas por descrição, gerando classificação
-- incorreta em transações de contas diferentes com a mesma descrição genérica
-- (ex: "RENDIMENTOS PAGO APLIC" aparece em todas as contas, mas CC/UN/LE são diferentes
-- por conta). Após este reset, novas classificações criam regras com chave composta
-- (description + accountId).
--
-- Aplicar manualmente no Supabase Studio.
DELETE FROM categorization_rules;
