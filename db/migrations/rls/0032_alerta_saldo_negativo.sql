-- ============================================================================
-- 0032 — A regra de alerta `saldo-negativo` sai das specs já gravadas
-- ----------------------------------------------------------------------------
-- Sessão de 26/ago (corte do saldo). Não cria, não altera e não apaga estrutura
-- nenhuma: mexe só no conteúdo `jsonb` de `dashboard_blocks.spec`.
--
-- POR QUE ELA É NECESSÁRIA
--
-- `REGRAS_DE_ALERTA` (em `src/lib/dashboard/block-spec.ts`) é validado nas DUAS
-- direções — na escrita e na LEITURA, que é a decisão da 1.4 que faz uma spec
-- corrompida quebrar só o próprio bloco em vez de derrubar o painel. Tirar
-- `saldo-negativo` do enum sem tocar no que já está gravado transformaria os
-- blocos de alerta existentes em blocos quebrados: eles guardam a lista das 8
-- regras por extenso, porque o Zod materializa o `.default([...])` na gravação.
--
-- Conferido no banco antes de escrever isto: 3 painéis materializados, 17
-- blocos, e os 2 blocos `alertas` carregam as 8 regras — incluindo a que sai.
--
-- POR QUE A REGRA SAI
--
-- Ela lia `kpis.saldoCaixa`, que não era saldo: somava todo lançamento
-- importado até o fim do mês, sem saldo inicial de conta nenhuma. Num alerta
-- isso é pior que num cartão — o cartão informa mal, o alerta INTERROMPE, e um
-- "saldo negativo" que na verdade diz "importei mais saída que entrada" manda o
-- cliente caçar um problema que não existe.
--
-- ORDEM DAS DUAS SENTENÇAS, QUE IMPORTA
--
-- `regras` tem `.min(1)`: uma lista vazia falharia na leitura tão bem quanto o
-- valor removido. A 1ª sentença trata o caso extremo (bloco cuja ÚNICA regra
-- era essa) apagando a chave, para que o `.default` do Zod devolva as 7 na
-- leitura. Só depois a 2ª remove o elemento de quem tem outras. Invertidas, a
-- primeira já teria zerado a lista e a segunda não teria como saber.
--
-- Nenhum bloco no banco hoje cai no 1º caso — as duas listas têm as 8. A
-- sentença existe porque a spec PERMITE escolher regras, e uma escrita futura
-- pelo MCP poderia ter escolhido só essa.
-- ============================================================================

-- 1. Blocos cuja única regra era a que sai: apaga a chave e deixa o default valer.
UPDATE dashboard_blocks
   SET spec = spec - 'regras'
 WHERE spec->>'tipo' = 'alertas'
   AND spec->'regras' = '["saldo-negativo"]'::jsonb;

-- 2. Os demais: remove só o elemento, preservando a ordem dos que ficam.
UPDATE dashboard_blocks
   SET spec = jsonb_set(spec, '{regras}', (
         SELECT COALESCE(jsonb_agg(r ORDER BY o), '[]'::jsonb)
           FROM jsonb_array_elements(spec->'regras') WITH ORDINALITY AS t(r, o)
          WHERE r <> '"saldo-negativo"'::jsonb
       ))
 WHERE spec->>'tipo' = 'alertas'
   AND spec->'regras' @> '["saldo-negativo"]'::jsonb;
