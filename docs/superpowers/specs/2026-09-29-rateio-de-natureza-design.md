# Rateio de natureza — desenho

**Data:** 29/set/2026 · **Status:** aprovado em conversa, aguardando revisão da spec escrita
**Revoga em parte:** `docs/SCHEMA_DECISIONS.md` Decisão 16 ("a natureza não se parte")

## Por quê

O banco junta vários pagamentos numa saída só no extrato (um TED para cinco fornecedores), e um
cliente às vezes paga num PIX só coisas de natureza diferente (serviço + devolução de outra quantia).
Hoje o rateio divide centro de custo, UEN, entidade e contato, mas não a natureza — então esses
lançamentos não têm como ser classificados corretamente na DRE.

## Decisões (Julio, 29/set)

1. **Estender o rateio**, não desmembrar em lançamentos. Um lançamento do extrato continua sendo
   UM lançamento: dedup, conciliação e Pluggy intactos.
2. **Mesmo sentido.** Toda parte herda entrada/saída do lançamento. A invariante Σ partes =
   `transactions.amount` (no centavo) não muda. Partes de sentido oposto (recebimento líquido de
   taxa) ficam **fora de escopo**.
3. **Com rateio, a natureza da origem fica vazia**, igual às dimensões hoje, e o banco recusa o
   contrário. Leitura esquecida mostra "sem natureza" (lacuna visível) em vez de atribuir o valor
   inteiro a uma natureza (erro silencioso).

## Consequência que não é opcional

A regra 3 vale para **todo** rateio, não só para os que dividem natureza: rateio que divide só centro
de custo também passa a carregar a natureza em cada parte (a mesma em todas). A tela esconde isso
pré-preenchendo a natureza atual. Hoje: **54 lançamentos rateados, 117 partes, 3 organizações, 1
modelo** — a migration copia a natureza da origem para as partes e esvazia a origem.

## Modelo de dados (migration 0033)

- `transaction_allocations.category_id uuid REFERENCES categories(id) ON DELETE SET NULL` + índice
  parcial `(organization_id, category_id)`.
- `allocation_template_lines.category_id` idem (modelo pode fixar natureza por linha; vazio =
  "usar a natureza atual do lançamento" ao aplicar).
- `assert_allocation_consistent`: `v_direct` passa a incluir `category_id IS NOT NULL`. Mensagem
  nomeia a natureza.
- Gatilho do lado do lançamento: `AFTER UPDATE OF amount, category_id, cost_center_id, …`.
- View `transaction_lines`: no ramo com rateio, `a.category_id` no lugar de `t.category_id`.
- Migração de dados, na mesma transação: `UPDATE transaction_allocations a SET category_id =
  t.category_id FROM transactions t WHERE …` e depois `UPDATE transactions SET category_id = NULL
  WHERE EXISTS (partes)`. Ordem importa: com o gatilho deferido, as duas ficam consistentes no commit.
- **Reversa (`0033_down`)**, escrita e validada junto: devolve à origem a natureza quando todas as
  partes têm a mesma; quando divergem, a da parte de maior valor (e lista quais foram achatadas);
  restaura gatilho e view antigos; dropa as colunas.

**Validação de domínio (na aplicação, Zod + consulta):** natureza da parte tem de ser folha
(`assertLeafCategory`), ativa e do mesmo domínio do documento (DRE × BP — mesma regra do
categorizador). Não é gatilho: é regra de negócio com mensagem boa, como o teto de linhas do modelo.

## Leituras — as 10 que leem `transactions` direto

Passam a ler `transaction_lines` (analíticas) ou a filtrar por `EXISTS` na view (operacionais),
seguindo a regra da Fase 1 (analítica → view + `COUNT(DISTINCT transaction_id)`):

| Onde | Leitura |
|---|---|
| `lib/dashboard/kpis.ts` | KPIs do mês |
| `lib/dashboard/indicators.ts` (3 queries) | indicadores DRE, BP, lucro 12m |
| `server/balance-sheet.ts` `getBpData`, `getBpAllDates` | Balanço |
| `lib/budget-copy.ts` semCat + inativas | copiar do realizado |
| `lib/recurrence-detect.ts` | recorrências do orçamento |
| `server/categories.ts` contagem + `deleteCategory` | uso da natureza (conta partes também — senão apagar natureza em uso seria permitido) |
| `lib/rules-write.ts` `contarAlcance` | prévia de regra, "sem natureza" |
| `lib/mcp/tools.ts` `descrever_organizacao` | `semNatureza` |
| `server/transactions.ts` filtro de natureza + `idsNaoCategorizados` | `/transacoes` |
| `server/review.ts` filtro de natureza | fila de revisão |

"Sem natureza" passa a significar: sem natureza **e** sem rateio, **ou** alguma parte sem natureza.

## Escritas

- `classificarPorIds` / `classificarPorFiltro` / MCP classificação: `categoryId` entra em
  `DIMENSOES_RATEAVEIS`. Individual em rateado → recusa descritiva ("a classificação vive nas
  partes; edite o rateio"). Lote → rateados saem e a prévia conta quantos.
- `jobs/categorize-transaction.ts` e `idsNaoCategorizados`: ignoram lançamentos com partes. Isto
  também fecha um defeito latente de hoje (o job escreve dimensão em rateado e o gatilho derruba o
  bloco inteiro no commit).
- Camada de recorrência do categorizador: ignora predecessor rateado.
- `upsertRule` / `confirmSuggestions`: nunca aprendem de rateado.
- `gravarAllocations`: grava natureza por parte, zera a da origem, `needs_review = false`.
- `skipSuggestions` em rateado: não toca as partes.

## Telas

- `AllocationDialog`, `BatchAllocationDialog`, `WeightRowsEditor` (modelos): coluna **Natureza**
  (`CategoryCellCombobox`), pré-preenchida com a natureza atual; aviso quando alguma parte fica sem.
- `/transacoes`: célula de natureza do rateado = nome (se todas iguais) ou "N naturezas"; linha
  expandida mostra a natureza de cada parte; combobox travado como as dimensões.
- `DrillDownDialog`: combobox de natureza travado em linha de parte.

## MCP

`prever/aplicar_rateio_em_lote` e o rateio individual aceitam `natureza` por parte/peso, com
`.describe()` dizendo quando usar e que é obrigatória na prática (vazio = sem natureza). Sai a frase
"a natureza não é rateada". `prever_classificacao_em_lote` explica por que rateados ficaram de fora.
Teste afirma sobre o **JSON Schema publicado**.

## Sessões

| # | Entrega | Verificação | Volta |
|---|---|---|---|
| 1 | As 10 leituras migram para a view. **Sem migration** — a view ainda devolve a natureza da origem | Query antiga (via `git show`) × nova nas 7 organizações: números idênticos | `git revert` |
| 2 | Migration 0033 + reversa + escritas (recusas, categorizador, `gravarAllocations`) | 0033 e 0033_down com ROLLBACK; DRE/fluxo/dashboard idênticos antes e depois nas 7 orgs | `0033_down` + `git revert` |
| 3 | Telas | Julio na tela | `git revert` |
| 4 | MCP + docs (Decisão 16 revista em SCHEMA_DECISIONS, CLAUDE.md) | suítes do MCP + Julio no claude.ai | `git revert` |

**A sessão 1 vai para o ar antes da 0033.** Se a origem for esvaziada enquanto KPIs e Balanço
leem `transactions`, os 54 rateados somem do dashboard na hora.

**Backup (29/set):** tag `backup/antes-rateio-natureza-2026-09-29` (commit `1dc9469`) + dump
completo do banco em `C:\Users\Julio\backups\lure-expert\`, restauração conferida (13.269
lançamentos, soma idêntica). O dump é a última rede; a volta normal é a reversa por sessão.

## Fora de escopo

- Partes com sentido oposto ao do extrato.
- Regra automática "descrição → modelo de rateio".
- Achados do levantamento, anteriores a isto: `getBudgetVsActual`, `collectActuals` e
  `recurrence-detect` usam `hide_in_*` cru e não herdam o selo da natureza pai.
