# Folha de pagamento no orçamento — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quadro de pessoal por versão de orçamento (CLT, PJ, pró-labore, estagiário, vaga) que gera a folha do exercício — com encargos pelo regime da unidade jurídica — como lançamentos orçados de origem `folha`.

**Architecture:** cálculo **puro** em `src/lib/payroll-calc.ts` (pessoa → linhas por componente/mês/data de caixa) e `src/lib/payroll-build.ts` (linhas → lançamentos com natureza e alocação resolvidas, ou recusas). Escrita em `src/lib/payroll-write.ts` recebendo `tx`, gravando `budget_series` + `budget_entries` com `source='folha'` (as ocorrências gravadas direto, sem `expandSeries`). `src/server/payroll.ts` é casca. Tela nova: aba "Quadro de pessoal" em `/orcamento`.

**Tech Stack:** Next.js 14, Drizzle, Postgres/Supabase (RLS), Zod, `tsx` para os scripts de verificação.

**Spec:** `docs/superpowers/specs/2026-11-18-folha-no-orcamento-design.md` — ler inteiro antes da Task 1.

## Global Constraints

- Tudo em português (UI, identificadores de domínio, comentários). Agentes = "expert".
- `budget_entries` é a única fonte da verdade do orçado; nada calcula folha na leitura.
- `amount` sempre positivo, `direction='outflow'` em todo lançamento da folha.
- Natureza de destino tem de ser **Natureza Filho ativa**; recusa nomeando o componente caso contrário.
- Lógica em `/lib`, fora de `'use server'`; `src/server/payroll.ts` só resolve `getAuthContext` e chama `/lib`.
- Escrita do quadro e geração: **member+** via `recusaDePapel(papel, 'member', <ação>)` (`src/lib/members-types.ts`). Leitura: todo papel.
- Versão `arquivado` é só leitura (mesma regra de `carregarVersaoEditavel` em `src/lib/budget-write.ts`).
- Migration **0036** + reversa `0036_down_…`, validada com ROLLBACK antes de entregar; nunca aplicar na produção sem o aval do Julio (ou o roteiro de subida autônoma da memória).
- Scripts contra a produção: só com transação revertida e `SET lock_timeout = '3s'`; URL do **pooler**. Preferir o banco local (`scripts/local-db.sh up`) quando o Docker estiver disponível.
- Antes de qualquer tabela na tela: ler `docs/DATA_TABLE_PATTERN.md`. Os 5 estados.
- Toda escrita relevante registra em `agent_events` (padrão de `src/lib/lancamento-manual.ts:193`).
- Dinheiro em centavos inteiros nas contas (`toCents`/`fromCents`/`applyProportion` de `src/lib/allocation-math.ts`).
- Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git push origin main` só depois do merge autorizado.

## Review Focus

1. **Gerar duas vezes seguidas** → o mesmo resultado (mesma contagem e soma), nenhuma série manual tocada. Teste na Task 4.
2. **Alocação que não soma 100** (ex.: 60 + 39,99) → recusa na gravação da pessoa, nomeando a soma; pessoa **sem alocação** → lançamentos sem CC/UEN e aviso na prévia. Testes nas Tasks 2 e 3.
3. **Natureza mapeada arquivada, de nível pai ou de outra organização** → a prévia recusa nomeando o componente e a pessoa. Teste na Task 3/4.
4. **Datas impossíveis** — saída antes da entrada, PJ com lista de meses vazia, mês de férias fora de 1–12, vaga sem mês de entrada → Zod recusa. Teste na Task 2.
5. **Versão arquivada** → toda escrita do quadro e a geração recusadas. Teste na Task 4.

---

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `db/migrations/rls/0036_folha_orcamento.sql` / `0036_down_folha_orcamento.sql` | tabelas, colunas, CHECKs, RLS, gatilhos `updated_at`, `'folha'` no CHECK de `budget_series.source` |
| `db/schema/budget-payroll.ts` (+ export em `db/schema/index.ts`); `db/schema/legal-entities.ts` | Drizzle |
| `src/lib/payroll-types.ts` | constantes, Zod, tipos — importável pelo cliente |
| `src/lib/payroll-calc.ts` | cálculo puro de uma pessoa |
| `src/lib/payroll-build.ts` | natureza + alocação + descrição → lançamentos; recusas |
| `src/lib/payroll-write.ts` | leitura do quadro, CRUD, prévia, geração, cópia, desatualização |
| `src/lib/budget-copy.ts`, `src/lib/budget-scope.ts`, `src/lib/budget-types.ts`, `src/server/budget.ts` | duplicação preserva `folha`; edição de série/ocorrência `folha` recusada |
| `src/server/payroll.ts`; `src/server/dimensions.ts` | actions |
| `src/app/(authenticated)/orcamento/quadro-tab.tsx`, `pessoa-dialog.tsx`, `naturezas-folha-dialog.tsx`, `gerar-folha-dialog.tsx`, `copiar-quadro-dialog.tsx`; `orcamento-client.tsx`, `comparacao-tab.tsx`, `planejamento-tab.tsx` | telas |
| `src/app/(authenticated)/configuracoes/…/unidades-juridicas` (onde o `DimensionManager` de entidades é montado) | campos de regime |
| `scripts/verify-migration-0036.ts`, `scripts/verify-payroll-calc.ts`, `scripts/verify-payroll-write.ts` | verificação |
| `docs/SCHEMA_DECISIONS.md` (Decisão 32), `CLAUDE.md`, `docs/SESSION_LOG.md` | documentação |

---

### Task 1: Migration 0036 e schema Drizzle

**Files:**
- Create: `db/migrations/rls/0036_folha_orcamento.sql`, `db/migrations/rls/0036_down_folha_orcamento.sql`, `db/schema/budget-payroll.ts`, `scripts/verify-migration-0036.ts`
- Modify: `db/schema/legal-entities.ts`, `db/schema/index.ts`, `db/migrations/rls/test_rls_budget.sql`

**Interfaces:**
- Produces (Drizzle): `budgetPayrollSettings`, `budgetPeople`, `budgetPeopleAllocations`, `budgetPeopleBenefits`, `payrollCategoryMap`; colunas novas em `legalEntities`.

O DDL (seguir o estilo de cabeçalho e RLS de `0034_account_opening_balances.sql`: 4 policies por tabela via `memberships`, gatilho `updated_at`):

- `legal_entities` + `regime_tributario text NULL CHECK (IN ('lucro_real','lucro_presumido','simples'))`, `simples_anexo_iv boolean NOT NULL DEFAULT false`, `aliquota_inss_patronal numeric(6,4) NOT NULL DEFAULT 0.20`, `aliquota_rat_fap numeric(6,4) NOT NULL DEFAULT 0.02`, `aliquota_terceiros numeric(6,4) NOT NULL DEFAULT 0.058`, `aliquota_fgts numeric(6,4) NOT NULL DEFAULT 0.08`, `updated_at timestamptz NOT NULL DEFAULT now()` + gatilho. Alíquotas em **fração** (0.20), CHECK `BETWEEN 0 AND 1`.
- `budget_payroll_settings`: `id`, `organization_id`, `version_id UNIQUE → budget_versions ON DELETE CASCADE`, `modo_provisao text NOT NULL DEFAULT 'provisao' CHECK IN ('provisao','pagamento')`, `dissidio_mes int NULL CHECK 1..12`, `dissidio_pct numeric(7,4) NULL CHECK >= 0` (fração), `quadro_alterado_em timestamptz NOT NULL DEFAULT now()`, `gerado_em timestamptz NULL`, timestamps.
- `budget_people`: `id`, `organization_id`, `version_id → budget_versions CASCADE`, `nome text NULL`, `is_vaga boolean NOT NULL DEFAULT false`, `vinculo text NOT NULL CHECK IN ('clt','pj','pro_labore','estagio')`, `cargo text NULL`, `legal_entity_id → legal_entities RESTRICT NULL`, `contact_id → contacts SET NULL`, `valor_base numeric(15,2) NOT NULL CHECK > 0`, `outros_proventos numeric(15,2) NOT NULL DEFAULT 0 CHECK >= 0`, `mes_entrada int NOT NULL DEFAULT 1 CHECK 1..12`, `mes_saida int NOT NULL DEFAULT 12 CHECK 1..12`, `CHECK (mes_saida >= mes_entrada)`, `meses_pj int[] NULL`, `mes_ferias int NULL CHECK 1..12`, `dia_pagamento_pj int NOT NULL DEFAULT 10 CHECK 1..28`, `aplica_dissidio boolean NOT NULL DEFAULT true`, `reajuste_mes int NULL CHECK 1..12`, `reajuste_pct numeric(7,4) NULL CHECK >= 0`, `naturezas jsonb NOT NULL DEFAULT '{}'` (componente → category_id), `observacao text`, timestamps. `CHECK (is_vaga OR nome IS NOT NULL)`, `CHECK (vinculo NOT IN ('clt','pro_labore') OR legal_entity_id IS NOT NULL)`.
- `budget_people_allocations`: `id`, `organization_id`, `person_id → budget_people CASCADE`, `cost_center_id → cost_centers SET NULL`, `business_unit_id → business_units SET NULL`, `percentual numeric(5,2) NOT NULL CHECK (> 0 AND <= 100)`, `ordem int NOT NULL`. A soma = 100 é validada **na escrita** (Task 4), não no banco.
- `budget_people_benefits`: `id`, `organization_id`, `person_id → CASCADE`, `nome text NOT NULL`, `valor_mensal numeric(15,2) NOT NULL CHECK > 0`, `category_id → categories RESTRICT NULL`, `ordem int`.
- `payroll_category_map`: `organization_id`, `componente text NOT NULL`, `category_id → categories RESTRICT NOT NULL`, `updated_at`, `PRIMARY KEY (organization_id, componente)`.
- `budget_series`: `DROP CONSTRAINT budget_series_source_chk` e recriar com `'folha'` incluído.
- Reversa: dropa as 5 tabelas (ordem das FKs), as 7 colunas de `legal_entities`, e recria o CHECK antigo **depois** de `DELETE FROM budget_series WHERE source='folha'` (perda declarada no cabeçalho). Idempotente (`IF EXISTS`).

- [ ] **Step 1: Escrever `scripts/verify-migration-0036.ts`** — abre transação, `SET lock_timeout='3s'`, roda o arquivo inteiro, e afirma (contador `ok/falhas` no estilo de `verify-column-widths.ts`): as 5 tabelas existem com RLS ligado e 4 policies cada (map: 4); `legal_entities` tem as 7 colunas com os defaults 0.20/0.02/0.058/0.08; insert de `budget_series` com `source='folha'` aceito; insert de pessoa `clt` sem `legal_entity_id` recusado; pessoa com `mes_saida < mes_entrada` recusada; pessoa sem nome e `is_vaga=false` recusada; percentual 0 recusado; apagar a versão leva pessoas, alocações, benefícios e settings (CASCADE); depois roda a **reversa** e afirma que o CHECK antigo recusa `'folha'`; `ROLLBACK` ao fim.
- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --env-file=.env.local scripts/verify-migration-0036.ts` (com `DATABASE_URL` do banco local ou do pooler). Esperado: FALHA (arquivo de migration inexistente).
- [ ] **Step 3: Escrever as duas migrations e o schema Drizzle** conforme acima; acrescentar as 5 tabelas ao `test_rls_budget.sql`.
- [ ] **Step 4: Rodar de novo** — esperado: todas OK, 0 falhas, nada persiste (conferir com um `SELECT to_regclass('budget_people')` fora da transação → `null`).
- [ ] **Step 5: `npx tsc --noEmit`** sem erro. **Commit** `feat(folha): migration 0036 e schema do quadro de pessoal`.

---

### Task 2: Tipos e cálculo puro de uma pessoa

**Files:**
- Create: `src/lib/payroll-types.ts`, `src/lib/payroll-calc.ts`, `scripts/verify-payroll-calc.ts`

**Interfaces:**
- Produces:
  ```ts
  // payroll-types.ts
  export const VINCULOS = ['clt','pj','pro_labore','estagio'] as const
  export const REGIMES = ['lucro_real','lucro_presumido','simples'] as const
  export const MODOS_PROVISAO = ['provisao','pagamento'] as const
  export const COMPONENTES = ['salario','outros_proventos','inss_patronal','fgts','decimo_terceiro',
    'terco_ferias','encargos_13_ferias','pro_labore','inss_pro_labore','bolsa_estagio',
    'honorario_pj','beneficios'] as const
  export const ROTULO_COMPONENTE: Record<Componente, string>  // "Salário", "INSS patronal + RAT + terceiros", …
  export const CODIGO_PADRAO: Partial<Record<Componente, string>> // ver Task 4
  export const pessoaSchema: z.ZodType<PessoaInput>   // inclui alocacoes[] e beneficios[]
  export const parametrosVersaoSchema                 // modoProvisao, dissidioMes, dissidioPct (PONTOS percentuais na entrada: 5 = 5%)
  export const unidadeJuridicaFolhaSchema             // regime, anexoIV, 4 alíquotas em pontos percentuais
  export type ParametrosUJ = { regime: Regime | null; anexoIV: boolean; inss: number; ratFap: number; terceiros: number; fgts: number } // frações
  export type LinhaCalculada = { componente: Componente; beneficio?: { nome: string; categoryId: string | null };
    competencia: string /* YYYY-MM */; caixa: string /* YYYY-MM-DD */; centavos: number }
  // payroll-calc.ts
  export function aliquotas(uj: ParametrosUJ, vinculo: Vinculo): { patronal: number; fgts: number } // patronal = inss+rat+terceiros onde incidem
  export function calcularPessoa(p: PessoaCalc, versao: ParametrosVersaoCalc, uj: ParametrosUJ | null, exercicio: number): LinhaCalculada[]
  export function custoAnual(linhas: LinhaCalculada[]): number // centavos
  ```
  `PessoaCalc`/`ParametrosVersaoCalc` são os campos da Task 1 em camelCase, percentuais em fração.

**Regras que o cálculo implementa (o spec seções 5.1–5.7 é a referência; aqui o que o spec deixa como algoritmo):**

- **Meses ativos:** `mesEntrada..mesSaida`; PJ = `mesesPj ∩ [mesEntrada..mesSaida]`.
- **Remuneração do mês** `rem(m) = (valorBase + outrosProventos) × fator(m)`; `fator(m) = 1 + pct` a partir do mês de reajuste — CLT usa o dissídio da versão (se `aplicaDissidio`), os demais vínculos usam `reajusteMes/Pct` da pessoa. `outros_proventos` vira linha própria (componente `outros_proventos`) com o mesmo fator.
- **Incidência** (`aliquotas`): `patronal` = `inss + ratFap` se regime ∈ {real, presumido} ou (simples e anexoIV), **+ terceiros** só em real/presumido; `fgts` só CLT. Pró-labore: patronal = só `inss` onde incide (sem RAT, sem terceiros), fgts 0. PJ e estágio: 0 e 0. CLT/pró-labore sem regime → **lançar erro** `RegimeAusente` (a Task 3 transforma em recusa).
- **13º (CLT):** alvo = `rem(últimoMêsAtivo) × avos / 12`, avos = nº de meses ativos. Provisão: cada mês ativo `round(rem(m)/12)`; o **último mês ativo** recebe `alvo − Σ(anteriores)` (complemento + resto de arredondamento). Pagamento: o alvo inteiro na competência do último mês ativo.
- **1/3 de férias (CLT):** alvo = `rem(últimoMêsAtivo) / 3 × avos / 12`. Provisão: `round(rem(m)/36)` por mês, complemento no último mês ativo. Pagamento: alvo inteiro na competência do **mês de férias** se ativo, senão do último mês ativo. Mês de férias padrão: `mesEntrada` se `mesEntrada > 1`, senão 12.
- **Encargos:** `inss_patronal` = round(rem × patronal) e `fgts` = round(rem × fgts) por mês; `encargos_13_ferias` = sobre o 13º e o terço de cada linha, separados em duas linhas (parte patronal e parte FGTS) por causa do caixa. **No modo provisão, as quatro séries de encargo do 13º/terço também têm alvo e complemento**: alvo = `round(alvo13 × patronal)`, `round(alvo13 × fgts)`, `round(alvoTerco × patronal)`, `round(alvoTerco × fgts)`, e a linha do último mês ativo leva `alvo − Σ anteriores` — é o que faz o custo anual ser idêntico nos dois modos ao centavo. `inss_pro_labore` sobre o pró-labore.
- **Datas de caixa** (`YYYY-MM-DD`; "M+1" = mês seguinte, pode cair em `exercicio+1`):
  | Linha | Caixa |
  |---|---|
  | salário, outros proventos, pró-labore, bolsa, benefícios | dia 05 de M+1; **no mês de férias** salário e outros proventos: dia 01 do mês de férias |
  | inss_patronal, fgts, inss_pro_labore | dia 20 de M+1 |
  | honorario_pj | `diaPagamentoPj` de M+1 |
  | decimo_terceiro | metade (centavos: `splitEqually(c,2)`) em `exercicio-11-30`, metade em `exercicio-12-20` |
  | encargos_13_ferias (13º, patronal) | `exercicio-12-20` |
  | encargos_13_ferias (13º, FGTS) | metade `exercicio-12-20`, metade `(exercicio+1)-01-20` |
  | terco_ferias | dia 01 do mês de férias; se a competência é posterior ao mês de férias, dia 01 do mês de férias de `exercicio+1` |
  | encargos_13_ferias (terço) | dia 20 do mês seguinte ao caixa do terço |
  | **saída antes de dezembro** (`mesSaida < 12`): 13º, terço e seus encargos | dia 10 do mês seguinte à saída (prazo da rescisão, CLT art. 477) |
- **Benefícios:** uma linha por benefício por mês ativo, `componente='beneficios'`, `beneficio = { nome, categoryId }`.
- **Estágio:** só `bolsa_estagio` + benefícios. **Pró-labore:** `pro_labore` + `inss_pro_labore` + benefícios. **PJ:** `honorario_pj` + benefícios.

- [ ] **Step 1: Escrever `scripts/verify-payroll-calc.ts`** (sem banco), com estes casos — `UJ_LP = { regime:'lucro_presumido', anexoIV:false, inss:.20, ratFap:.02, terceiros:.058, fgts:.08 }`, `UJ_SN = {…regime:'simples'}`, `UJ_SN4 = {…regime:'simples', anexoIV:true}`, exercício 2027:
  - `clt_lp_jan`: CLT 5.000, ano inteiro, provisão, LP → linhas de **janeiro**: salário 500000, inss_patronal 139000, fgts 40000, decimo_terceiro 41667, encargos do 13º (patronal 11583 + fgts 3333 = 14916), terco_ferias 13889, encargos do terço (3861 + 1111 = 4972).
  - `clt_lp_ano`: `custoAnual` = **9053333** centavos (90.533,33), e Σ decimo_terceiro = 500000, Σ terco_ferias = 166667, Σ encargos do 13º = 179000, Σ encargos do terço = 59666.
  - `modos_iguais`: o mesmo CLT em modo `pagamento` → mesmo `custoAnual`; e com dissídio 5% em maio, provisão e pagamento → mesmo `custoAnual` entre si, e Σ decimo_terceiro = round(5250 × 100) = 525000.
  - `clt_sn`: Simples Anexo III → nenhuma linha `inss_patronal`; fgts jan 40000; encargos 13º jan só FGTS 3333; terço-encargos só FGTS 1111.
  - `clt_sn4`: Anexo IV → inss_patronal jan = 500000 × 0,22 = 110000 (sem terceiros).
  - `pro_labore_lp`: 10.000 LP → pro_labore 1000000/mês, inss_pro_labore 200000, nenhum fgts, nenhum 13º.
  - `pro_labore_sn`: Simples Anexo III → nenhuma linha inss_pro_labore.
  - `pj_meses`: PJ 12.000, meses [1,2,3,10], dia 10 → 4 linhas honorario_pj, a de março com caixa `2027-04-10`, sem encargos.
  - `estagio`: bolsa 1.500 + benefício "Seguro" 30 → 12 bolsas, 12 benefícios, nada mais.
  - `admissao_marco`: CLT entrada 3 → nenhuma linha jan/fev; avos 10; Σ decimo_terceiro = round(500000×10/12) = 416667; mês de férias padrão = 3.
  - `saida_junho`: CLT saída 6 → 13º/terço com caixa `2027-07-10`; nenhuma linha depois de junho.
  - `caixa_datas`: no CLT ano inteiro, salário de janeiro caixa `2027-02-05`; inss de dezembro caixa `2028-01-20`; 13º de março: duas linhas, `2027-11-30` e `2027-12-20`; FGTS do 13º com uma metade em `2028-01-20`; com `mesFerias=7`, salário de julho caixa `2027-07-01` e terço de setembro caixa `2028-07-01`.
  - `sem_regime`: CLT com `uj=null` → lança `RegimeAusente`.
  - `zod`: `pessoaSchema` recusa saída < entrada, PJ com `mesesPj=[]`, `mesFerias=13`, vaga sem `mesEntrada` explícito… (vaga: `mesEntrada` obrigatório quando `isVaga`), alocações somando 99,99 (mensagem cita "99,99%"), CLT sem unidade jurídica.
- [ ] **Step 2: Rodar** `npx tsx scripts/verify-payroll-calc.ts` → FALHA (módulo inexistente).
- [ ] **Step 3: Implementar `payroll-types.ts` e `payroll-calc.ts`** com as assinaturas acima. Tudo em centavos; nenhuma importação de `@/db`.
- [ ] **Step 4: Rodar** → todas OK. `npx tsc --noEmit` limpo.
- [ ] **Step 5: Commit** `feat(folha): cálculo puro da pessoa`.

---

### Task 3: Montagem — natureza, alocação, descrição, recusas

**Files:**
- Create: `src/lib/payroll-build.ts`
- Modify: `scripts/verify-payroll-calc.ts` (seção nova, ainda sem banco)

**Interfaces:**
- Consumes: `calcularPessoa`, `LinhaCalculada`, `COMPONENTES`, `ROTULO_COMPONENTE` (Task 2); `applyProportion`, `fromCents` (`allocation-math.ts`).
- Produces:
  ```ts
  export type QuadroParaMontar = {
    exercicio: number
    versao: ParametrosVersaoCalc
    pessoas: Array<PessoaCalc & { id: string; nome: string | null; isVaga: boolean; cargo: string | null;
      legalEntityId: string | null; contactId: string | null;
      alocacoes: { costCenterId: string | null; businessUnitId: string | null; percentual: number }[]
      naturezas: Partial<Record<Componente, string>> }>
    unidades: Map<string, ParametrosUJ & { nome: string }>
    mapa: Partial<Record<Componente, string>>
    naturezasValidas: Map<string, { nome: string }>   // só Natureza Filho ativa da organização
  }
  export type LancamentoFolha = { personId: string; componente: Componente; alocacao: number;
    descricao: string; categoryId: string; costCenterId: string | null; businessUnitId: string | null;
    legalEntityId: string | null; contactId: string | null; competencia: string; caixa: string; centavos: number }
  export type RecusaFolha = { personId: string | null; pessoa: string; motivo: string }
  export function montarFolha(q: QuadroParaMontar): { lancamentos: LancamentoFolha[]; recusas: RecusaFolha[]; avisos: string[] }
  export function nomeDaPessoa(p: { nome: string | null; isVaga: boolean; cargo: string | null }): string // "Maria Silva" | "Vaga · Vendedor" | "Vaga"
  ```
- Natureza: `beneficio.categoryId ?? pessoa.naturezas[componente] ?? mapa[componente]`; precisa estar em `naturezasValidas`, senão **recusa** `"<Pessoa>: <Rótulo do componente> sem natureza válida"` (uma por pessoa × componente, sem repetir por mês). `RegimeAusente` vira recusa `"<Pessoa>: a unidade jurídica <nome> não tem regime tributário"`.
- Alocação: N alocações → cada linha partida com `applyProportion(centavos, percentuais)`; partes de 0 centavos são descartadas. Zero alocações → uma parte com CC/UEN nulos e aviso `"<Pessoa> sem centro de custo e unidade de negócio"`.
- Descrição: `"Folha · <nomeDaPessoa> · <ROTULO_COMPONENTE>"`; benefício: `"Folha · <pessoa> · <nome do benefício>"`.
- Se **houver qualquer recusa**, a geração inteira é recusada (a Task 4 respeita); os lançamentos ainda vêm para a prévia mostrar o resto.

- [ ] **Step 1: Acrescentar a seção `montagem`** ao script: (a) CLT 5.000 com alocação 60/40 → para cada linha, as duas partes somam exatamente a linha (Σ de todos os lançamentos = `custoAnual`); salário de janeiro partido em 300000/200000; (b) alocação 33,33/33,33/33,34 de 100,01 → partes fecham ao centavo; (c) exceção da pessoa em `salario` → CPV vence o mapa; benefício com natureza própria vence a exceção; (d) natureza mapeada fora de `naturezasValidas` → 1 recusa nomeando "Salário" e a pessoa, mesmo com 12 meses; (e) UJ sem regime → recusa nomeando a unidade; (f) sem alocação → aviso e CC/UEN nulos; (g) `nomeDaPessoa` de vaga com e sem cargo.
- [ ] **Step 2: Rodar** → FALHA. **Step 3: Implementar.** **Step 4: Rodar** → OK; `tsc` limpo.
- [ ] **Step 5: Commit** `feat(folha): montagem dos lançamentos com natureza e alocação`.

---

### Task 4: Escrita — quadro, mapa, prévia, geração, cópia, desatualização

**Files:**
- Create: `src/lib/payroll-write.ts`, `scripts/verify-payroll-write.ts`
- Modify: `src/lib/budget-types.ts` (`'folha'` em `BUDGET_SOURCES`)

**Interfaces:**
- Consumes: `montarFolha` (Task 3), schemas da Task 2, `BudgetTx` (`budget-scope.ts`), `carregarVersaoEditavel` (`budget-write.ts`), tabelas da Task 1.
- Produces (todas recebem `exec`/`tx` e `organizationId`; erros são `{ error: string }`, nunca exceção para o usuário):
  ```ts
  export async function lerQuadro(exec, organizationId, versionId): Promise<QuadroDaVersao>
     // pessoas com alocações, benefícios e custoAnual (centavos) calculado; settings (cria padrão virtual se não houver);
     // desatualizado: boolean; geradoEm: string | null
  export async function salvarPessoa(tx, organizationId, userId, versionId, input: PessoaInput, personId?: string): Promise<{ id: string } | { error: string }>
     // substitui alocações e benefícios inteiros; toca quadro_alterado_em
  export async function apagarPessoa(tx, organizationId, versionId, personId): Promise<{ ok: true } | { error: string }>  // toca quadro_alterado_em
  export async function salvarParametrosVersao(tx, organizationId, versionId, input): Promise<…>
  export async function lerMapa(exec, organizationId): Promise<{ componente: Componente; categoryId: string | null; sugerida: boolean }[]>
  export async function salvarMapa(tx, organizationId, mapa: Partial<Record<Componente, string | null>>): Promise<…>
  export async function preverFolha(exec, organizationId, versionId): Promise<PreviaFolha>
     // { recusas, avisos, totalCentavos, porComponenteMes: {componente, mes, centavos}[], porPessoa: {personId, nome, centavos}[], seriesExistentes: number }
  export async function gerarFolha(tx, organizationId, userId, versionId): Promise<{ series: number; entries: number; substituidas: number } | { error: string }>
  export async function copiarQuadro(tx, organizationId, userId, origemVersionId, destinoVersionId): Promise<{ pessoas: number } | { error: string }>
  export async function quadroDesatualizado(exec, organizationId, versionId): Promise<boolean>
  ```
- **Mapa sugerido:** `CODIGO_PADRAO = { salario:'5.1.1', outros_proventos:'5.1.1', bolsa_estagio:'5.1.1', inss_patronal:'5.1.2', fgts:'5.1.2', encargos_13_ferias:'5.1.2', inss_pro_labore:'5.1.2', beneficios:'5.1.3', decimo_terceiro:'5.1.4', terco_ferias:'5.1.4', pro_labore:'5.1.5' }` — sem linha gravada, `lerMapa` sugere a Natureza Filho ativa com esse código (`sugerida: true`); `honorario_pj` não tem sugestão. A geração usa só o mapa **gravado** (sugestão não vale até salvar) — a prévia diz isso na recusa.
- **`gerarFolha`:** refaz `preverFolha` dentro do `tx`; recusa se houver recusa; `DELETE FROM budget_series WHERE organization_id AND version_id AND source='folha'`; agrupa `LancamentoFolha` por (personId, componente, nome do benefício, alocação) → **uma série** por grupo: `description` do primeiro, `direction 'outflow'`, dimensões e natureza do grupo, `start_month` = 1ª competência, `occurrences` = nº de ocorrências, `amount_mode 'sazonal'`, `seasonal_amounts` = valores em ordem, `interval_months 1`, `day_of_month 1`, `cash_lag_days 0`, `source 'folha'`, `metadata { folha: { personId, componente, alocacao } }`; ocorrências com `sequence` 1..N em ordem (competência, caixa), `competence_date` = `<competencia>-01`, `cash_date` = `caixa`. Inserts em lote (`ENTRY_INSERT_CHUNK` de `budget-copy.ts`). Atualiza `gerado_em = now()`. Registra `agent_events` (`tipo: 'folha_gerada'`, payload com versão, séries, ocorrências, total).
- **`quadroDesatualizado`:** `gerado_em IS NULL` com pessoas → true; senão true se `quadro_alterado_em`, `budget_payroll_settings.updated_at`, `max(payroll_category_map.updated_at)` ou `max(legal_entities.updated_at)` das unidades usadas > `gerado_em`.
- **`copiarQuadro`:** substitui pessoas/alocações/benefícios/settings do destino pelos da origem (mesma organização; destino editável); não gera; toca `quadro_alterado_em`.

- [ ] **Step 1: Escrever `scripts/verify-payroll-write.ts`** contra o banco (local, ou produção com transação revertida no fim): cria organização descartável (padrão de `verify-staging-import.ts`), duas UJs (LP e Simples) e versão 2027; afirma: (a) `salvarPessoa` com alocação 60+39,99 → erro citando 99,99%; (b) `preverFolha` sem mapa gravado → recusa citando "Salário" e "não gravado"; (c) com mapa salvo e CLT 5.000 LP + PJ meses [1,2] → `totalCentavos = 9053333 + 2400000`; (d) `gerarFolha` → séries e ocorrências gravadas, `Σ budget_entries.amount` da versão com `source='folha'` = 114.533,33, todas `outflow`, natureza = mapa; (e) uma série `manual` criada antes continua lá depois de gerar; (f) **gerar de novo** → mesma contagem e soma, `substituidas` = séries anteriores; (g) `quadroDesatualizado` false depois de gerar, true depois de `salvarPessoa`, true depois de mudar a alíquota da UJ; (h) arquivar a versão → `salvarPessoa` e `gerarFolha` recusados; (i) `copiarQuadro` para uma versão 2028 → mesmas pessoas, nenhuma série criada lá; (j) natureza do mapa arquivada → `preverFolha` recusa; (k) isolamento: nenhuma linha nova fora da organização de teste **desta execução** (filtrar por ids criados, não pelo banco inteiro — ver memória "asserção de isolamento com corte de tempo"). Limpeza ao fim.
- [ ] **Step 2: Rodar** → FALHA. **Step 3: Implementar.** **Step 4: Rodar** → OK; `tsc` limpo.
- [ ] **Step 5: Commit** `feat(folha): quadro, mapa e geração no orçamento`.

---

### Task 5: Proteções no orçamento existente

**Files:**
- Modify: `src/lib/budget-copy.ts` (`applyDuplicateVersion`), `src/lib/budget-scope.ts` (`applySeriesUpdate`, `applySeriesDelete`), `src/server/budget.ts` (`updateBudgetEntry`, `deleteBudgetEntry`, `duplicateBudgetVersion`)
- Modify: `scripts/verify-payroll-write.ts` (seção nova)

**Interfaces:**
- Produces: `export const RECUSA_FOLHA = 'Este lançamento vem da folha. Edite no Quadro de pessoal e gere a folha de novo.'` e `export async function recusaSeFolha(exec, organizationId, seriesId): Promise<string | null>` em `payroll-write.ts`.
- Duplicação: no `INSERT INTO budget_series … SELECT`, `CASE WHEN m.source = 'folha' THEN 'folha' ELSE 'duplicacao' END`; e, no mesmo `tx`, depois do statement, `copiarQuadro(tx, organizationId, userId, sourceId, novaVersao)` e copiar `gerado_em` da origem (o quadro copiado corresponde às séries copiadas, então não nasce desatualizado). Com `delta ≠ 0` (outro exercício) o quadro é copiado e as séries `folha` copiadas ficam marcadas desatualizadas (`gerado_em = NULL`), porque datas de caixa deslocadas em dias não seguem as regras de 5.5.
- `applySeriesUpdate`/`applySeriesDelete` e as duas actions de ocorrência chamam `recusaSeFolha` antes de qualquer escrita e devolvem `{ error: RECUSA_FOLHA }`. Conferir também `src/lib/mcp/` (escritas de orçamento): se alguma edita/apaga série existente, aplicar o mesmo guarda.

- [ ] **Step 1: Seção `protecoes`** no script: depois de gerar, `applySeriesUpdate` e `applySeriesDelete` numa série `folha` → `RECUSA_FOLHA` e nada muda; numa série manual → funcionam; duplicar a versão no mesmo exercício → a cópia tem séries `source='folha'` (nenhuma `'duplicacao'` entre elas), o quadro copiado e `quadroDesatualizado` false; gerar na cópia → mesmo total, sem dobrar; duplicar para 2028 → `quadroDesatualizado` true.
- [ ] **Step 2: Rodar** → FALHA. **Step 3: Implementar.** **Step 4: Rodar** a seção nova **e** as anteriores → OK.
- [ ] **Step 5: Commit** `feat(folha): orçamento protege os lançamentos da folha e a duplicação leva o quadro`.

---

### Task 6: Actions e unidade jurídica

**Files:**
- Create: `src/server/payroll.ts`
- Modify: `src/server/dimensions.ts` (`createLegalEntity`, `updateLegalEntity`, `getLegalEntities`), a página de `/configuracoes` que monta o `DimensionManager` de entidades (localizar por `getLegalEntities`)

**Interfaces:**
- Produces (`'use server'`, cada uma: `getAuthContext()` → `recusaDePapel(papel,'member',…)` nas escritas → `/lib` → `revalidatePath('/orcamento')`): `getQuadro(versionId)`, `savePessoa(versionId, input, personId?)`, `deletePessoa(versionId, personId)`, `saveParametrosFolha(versionId, input)`, `getMapaFolha()`, `saveMapaFolha(mapa)`, `previewFolha(versionId)`, `generateFolha(versionId)`, `copyQuadro(origem, destino)`.
- Unidade jurídica: os campos de 5.1 como `extraFields` (seleção de regime, caixa "Anexo IV" só com Simples, 4 alíquotas em **pontos percentuais** com os padrões 20 / 2 / 5,8 / 8). A dica do INSS: `"Desonerada? Lei 14.973/2024: 10% em 2026, 15% em 2027, 20% em 2028."`. Gravar converte para fração; editar só os parâmetros de folha é **admin+** (mesmo portão de contas), como o resto do cadastro de unidades.

- [ ] **Step 1:** implementar; **Step 2:** `npx tsc --noEmit` e `npm run lint` limpos; **Step 3:** `npm run build` limpo; **Step 4: Commit** `feat(folha): actions e regime da unidade jurídica`.

---

### Task 7: Telas

**Files:**
- Create: `src/app/(authenticated)/orcamento/quadro-tab.tsx`, `pessoa-dialog.tsx`, `naturezas-folha-dialog.tsx`, `gerar-folha-dialog.tsx`, `copiar-quadro-dialog.tsx`
- Modify: `orcamento-client.tsx` (aba "Quadro de pessoal" entre Planejamento e Orçado × Realizado), `planejamento-tab.tsx` (séries `folha` sem ações de editar/apagar, com selo "Folha" e o tooltip `RECUSA_FOLHA`; aviso de desatualização), `comparacao-tab.tsx` (nota do spec seção 8, só com `modo_provisao='provisao'`, regime Competência, nas linhas das naturezas que recebem `decimo_terceiro`/`terco_ferias`)

Ler `docs/DATA_TABLE_PATTERN.md` e reusar `ColHeader`/`MultiSelectFilter`/`DimFilter` de `components/transacoes-shared` antes de escrever. Componentes ficam na pasta da rota (só `/orcamento` os usa).

- **Aba:** layout do mockup da seção 9 do spec. Barra: modo 13º/férias (rádio), dissídio (mês + %), botões Naturezas, Copiar de…, Gerar folha. Faixa âmbar se `desatualizado`. Tabela: Nome/Vaga, Vínculo, Cargo, Und. jurídica, Alocação ("Financeiro 60 · Operações 40"), Contato, Base/mês, Meses ("jan–dez" ou "jan, fev, out"), Custo ano; filtros por vínculo, unidade jurídica, CC, UEN; rodapé com o total. 5 estados: sem versão → EmptyState "Crie uma versão"; quadro vazio → EmptyState com "Adicionar pessoa".
- **Diálogo da pessoa:** vínculo primeiro (mostra só os campos dele); "É vaga" desliga o nome e exige o mês de entrada; PJ = 12 caixas de mês; CLT = mês de férias + "aplicar dissídio"; alocações = linhas CC + UEN + %, com a soma ao vivo (vermelha ≠ 100); benefícios = linhas nome + valor + natureza opcional; "Naturezas desta pessoa" recolhido; **prévia ao vivo** do mês típico e do custo anual por componente via `calcularPessoa` (importado no cliente — por isso `payroll-calc.ts` não importa `@/db`).
- **Gerar folha:** abre com `previewFolha` → recusas (vermelho, bloqueiam o botão), avisos, total por componente × mês, por pessoa, e "substitui N lançamentos da folha anterior"; confirmar → `generateFolha`.
- Microcopy no padrão `docs/AI_VOICE.md` (calmo, direto, sem emoji).

- [ ] **Step 1:** implementar; **Step 2:** `tsc`, lint e `npm run build` limpos; **Step 3:** subir `npm run dev` e percorrer com o navegador (skill `run`): criar duas pessoas, salvar mapa, gerar, ver os lançamentos no Planejamento sem botão de editar e a DRE com orçado; anotar o que não deu para ver; **Step 4: Commit** `feat(folha): aba Quadro de pessoal`.

---

### Task 8: Documentação e entrega

**Files:** `docs/SCHEMA_DECISIONS.md` (Decisão 32 — folha no orçamento: quadro por versão, ocorrências gravadas sem `expandSeries`, só o terço de férias, complemento, alocação partida no orçado sem `transaction_allocations`, edição bloqueada), `CLAUDE.md` (sessão nova, arquivos em `/lib` na tabela, migration 0036 pendente de aplicação, confirmações de tela que Julio deve), `docs/SESSION_LOG.md`.

- [ ] **Step 1:** escrever; **Step 2:** rodar `verify-payroll-calc`, `verify-payroll-write`, `verify-migration-0036` uma última vez e registrar os placares; **Step 3: Commit** `docs: folha no orçamento`; **Step 4:** pedir ao Julio o "pode subir" (0036 primeiro, merge depois — a página lê as tabelas novas).
