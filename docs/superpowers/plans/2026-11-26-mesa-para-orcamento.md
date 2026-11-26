# Da mesa de negociação para o orçamento — plano para execução futura

> **Estado: PLANO, não iniciado.** Levantamento feito em 26/nov/2026 a pedido do Julio, que pediu
> para guardá-lo. **Antes da Task 1, responder as 4 decisões abertas** (seção *Decisões*) — o plano
> abaixo assume as recomendações marcadas, e muda se a resposta for outra.

**Goal:** em `/fornecedores` → aba **Mesa de negociação**, um botão **"Levar ao orçamento"** que
grava o fornecedor numa versão de orçamento já criada, com a redução negociada aplicada.

**Architecture:** lógica em `src/lib/fornecedores-orcamento.ts` (fora de `'use server'`): `planejarEnvio`
(puro: fornecedor + meses-base + redução → séries por natureza), `preverEnvio` e `aplicarEnvio`
(recebem `tx`). Grava `budget_series` + `budget_entries` com `source = 'fornecedor'` e a identidade
do fornecedor em `budget_series.metadata`. Reenviar **substitui só as séries daquele fornecedor
naquela versão** — o mesmo modelo da origem `folha` (Decisão 32). `src/server/fornecedores.ts` é casca.

**Tech Stack:** Next.js 14, Drizzle, Postgres/Supabase (RLS), Zod, `tsx` nos scripts de verificação.

**Ler antes:** `docs/SCHEMA_DECISIONS.md` Decisões 13 (orçamento), 32 (folha — o modelo de
substituição por origem) e 33 (fornecedores — a chave de texto e o rateio desconsiderado);
`docs/DATA_TABLE_PATTERN.md` antes da janela de prévia.

---

## O que já existe e o plano reaproveita

| Peça | Onde | Uso aqui |
|---|---|---|
| "Mensal antes", redução, "mensal depois" | `mesesBase`, `mediaMensal`, `aplicarReducao` em `src/lib/fornecedores-types.ts` | o valor enviado é calculado pela MESMA função que a mesa mostra — calcular por outro caminho faria a prévia discordar da linha |
| Lançamentos do fornecedor por natureza e mês | `lerSaidasPorFornecedor` em `src/lib/fornecedores.ts` (`LancamentoFornecedor.natureza`, `.mes`, `.valor`) | a divisão por natureza |
| Gravar série com prévia | `preverSerie` / `criarSerie` / `validarAlvos` em `src/lib/budget-write.ts` | validação de natureza e dimensões |
| Versão editável | `carregarVersaoEditavel` (`src/lib/budget-write.ts`) | recusa versão arquivada |
| Origem + campo livre | `budget_series.source` e `budget_series.metadata jsonb` | rastreabilidade sem coluna nova |
| Substituição por origem | `payroll-write.ts` (gera só sobre `source = 'folha'`) e `payroll-guard.ts` (`recusaSeFolha`) | reenvio e trava de edição |
| Contato | chave `C:<contact_id>` | preenche `contact_id` da série; as chaves `G:`, `J:` e `D:` vão sem contato |

## As dificuldades, e o que o plano faz com cada uma

1. **Contagem dupla — a principal.** O orçamento é por NATUREZA; se a versão foi montada por
   "copiar do realizado" ou digitada, a natureza já contém esse fornecedor, e somá-lo dobra o gasto.
   Dois modos:
   - **Só a economia** (padrão quando a versão já tem valor nas naturezas do fornecedor): uma série
     redutora "Economia negociada — <fornecedor>" na mesma natureza, `direction = 'inflow'`, valor =
     economia mensal. A leitura do orçado soma `inflow` positivo e `outflow` negativo
     (`src/lib/budget-read.ts`), então ela abate o que já está orçado sem tocar em série de outra origem.
     **Conferir na Task 1** se nenhuma tela/validação recusa `inflow` em natureza de despesa (o
     diálogo deduz a direção do tipo da categoria; o Zod aceita as duas).
   - **Gasto completo**: o fornecedor entra com o valor "depois", `outflow`, natureza a natureza.
   - **Descartado:** "substituir a fatia" dentro da série existente — mexe em lançamento de outra
     origem, que é onde se apaga trabalho alheio.
2. **Várias naturezas por fornecedor.** Divide na proporção do gasto de cada Natureza Filho nos
   meses-base (centavos inteiros, maior resto — `applyProportion` de `src/lib/allocation-math.ts`).
   Gasto **sem natureza** não pode ser gravado (a série exige natureza): a prévia mostra quanto é e
   a pessoa escolhe a natureza ou deixa de fora.
3. **Centro de custo / UEN.** A análise de fornecedores desconsidera o rateio (Decisão 33). v1 envia
   **sem** dimensões; v1.1 pode distribuir pela proporção das partes dos lançamentos do fornecedor.
4. **Formato.** Média fixa nos 12 meses (o que a mesa mostra) ou perfil mês a mês do mesmo período do
   ano anterior com a redução aplicada (fornecedor sazonal). Ver Decisão B.
5. **A mesa muda depois do envio.** Selo "No orçamento — <versão>" na linha; aviso **desatualizado**
   quando `supplier_negotiations.updated_at` > o `enviadoEm` gravado no metadata (o mesmo desenho
   do `gerado_em` da folha, com o mesmo falso positivo: editar só a observação acende o aviso —
   declarar ou comparar `tipo`/`reducao` em vez da data).
6. **Edição no orçamento.** Ver Decisão C.
7. **Papel.** A mesa é admin+ (Decisão 33); o botão segue a mesa — `recusaDePapel(papel, 'admin', …)`.
8. **Banco.** Migration pequena: `'fornecedor'` no CHECK de `budget_series.source` (e no de
   `budget_entries` se existir lá também — conferir) + `BUDGET_SOURCES`/`BUDGET_SOURCE_LABELS` em
   `src/lib/budget-types.ts` ("Mesa de negociação"). **Migration antes do deploy.**

## Decisões abertas (responder antes de codificar)

| # | Pergunta | Recomendação |
|---|---|---|
| A | Modos: "só a economia" + "gasto completo", com a prévia sugerindo? Ou só um? | os dois, prévia sugere |
| B | Formato: só média fixa, ou também o mês a mês do ano anterior? | os dois; média como padrão |
| C | Série vinda da mesa: travada como a folha ("edite na mesa e reenvie") ou editável? | travada |
| D | "Levar todos" já na v1, ou só o botão por linha? | por linha na v1; "todos" é um laço sobre a mesma função, barato depois |

---

## Tasks

### Task 1 — Migration e tipos

- [ ] `db/migrations/rls/0038_orcamento_origem_fornecedor.sql` + `0038_down_…` (reversa apaga as séries
      `source='fornecedor'` antes de devolver o CHECK antigo; idempotente). Conferir o número livre no
      dia — 0038 era o próximo em 26/nov.
- [ ] `BUDGET_SOURCES` + rótulo "Mesa de negociação" em `src/lib/budget-types.ts`.
- [ ] Conferir que `inflow` em natureza de despesa não é recusado em nenhum caminho (Zod, gatilho,
      telas de orçamento, DRE orçada, Orçado × Realizado).
- [ ] Validar com ROLLBACK contra a produção (pooler, `SET LOCAL lock_timeout = '3s'`). **Quem aplica é
      o Julio, pelo Studio** (o auto mode bloqueia migration na produção).

### Task 2 — `planejarEnvio` (puro)

- [ ] Entrada: lançamentos do fornecedor nos meses-base, item da mesa, ano do exercício, mês de início,
      modo, formato. Saída: séries por natureza (descrição, direção, valor por mês) + avisos (gasto sem
      natureza, natureza arquivada/pai, valor zero).
- [ ] O total mensal enviado = `aplicarReducao(...).depois` (gasto completo) ou `.economiaMensal`
      (economia), **ao centavo**, depois da divisão por natureza.
- [ ] Teste em `scripts/verify-mesa-orcamento.ts`: soma por natureza fecha o total; 1 natureza; 3
      naturezas com sobra de centavo; redução 0 (modo economia recusa: "nada a economizar"); redução
      em R$ maior que o gasto.

### Task 3 — `preverEnvio` / `aplicarEnvio` (com `tx`)

- [ ] Prévia: natureza × mês, total anual, e **quanto a versão já tem orçado nessas naturezas**
      (`fetchBudgetRows` de `src/lib/budget-read.ts`) — é esse número que sugere o modo.
- [ ] Aplicar: apaga as séries `source='fornecedor'` com `metadata->>'chave' = <chave>` NA versão, grava
      as novas com `metadata = { chave, rotulo, tipo, reducao, modo, formato, mesesBase, enviadoEm, userId }`
      e `contact_id` quando a chave é `C:`. Registro em `agent_events` (`fornecedor.levado_ao_orcamento`).
- [ ] Prévia e aplicação pelo MESMO `planejarEnvio`; aplicar recalcula e recusa se divergir da prévia
      (a defesa de fotografia velha dos pares do MCP).
- [ ] Se Decisão C = travada: estender `recusaSeFolha` (ou irmã `recusaSeOrigemProtegida`) para
      `fornecedor`, com "edite na mesa de negociação e reenvie".
- [ ] Testes: enviar duas vezes = mesmo resultado e nada duplicado; série manual e `folha` da mesma
      versão intocadas; versão arquivada recusa; viewer/member recusados; outra organização recusada.

### Task 4 — Tela

- [ ] `src/server/fornecedores.ts`: `preverEnvioAoOrcamento`, `levarAoOrcamento` (casca).
- [ ] Botão "Levar ao orçamento" na linha de `aba-mesa.tsx` (só admin+); janela: versão (não arquivadas
      da organização), modo, formato, mês de início (padrão jan do exercício); prévia em tabela pelo
      `DATA_TABLE_PATTERN`; confirmar.
- [ ] Selo na linha: versão(ões) onde está e aviso "desatualizado". Lido das séries `source='fornecedor'`.
- [ ] Os 5 estados na janela. Versão nenhuma criada → estado vazio com link para `/orcamento`.

### Task 5 — Documentação e subida

- [ ] Decisão 34 em `docs/SCHEMA_DECISIONS.md`; CLAUDE.md (frentes + histórico).
- [ ] Subida: 0038 no Studio → merge → deploy. Confirmação na tela pelo Julio.

## Fora da v1 (declarado)

Dimensões CC/UEN; "Levar todos" (se D = por linha); par `prever_`/`aplicar_` no MCP; enviar fornecedor
que não está na mesa.

**Tamanho estimado:** 2 sessões — (1) Tasks 1–3 com o script de verificação; (2) Tasks 4–5.
