# Schema Decisions — Decisões que saíram do SCHEMA_INICIAL.md

Documento criado conforme `CLAUDE.md`. Registra toda decisão de implementação que diverge
ou complementa o schema original. Leia antes de qualquer nova migration ou mudança de schema.

---

## Decisão 1 — FKs removidas do Drizzle para quebrar referências circulares (Sessão 1.4 / 1.7)

**Tabelas afetadas:** `transactions`, `documents`

**O que o SCHEMA_INICIAL.md previa:**
- `transactions.credit_card_invoice_id` com `.references(() => creditCardInvoices.id)`
- `documents.template_id` com `.references(() => templates.id)`

**O que foi implementado:**
- Ambas as colunas existem como `uuid()` simples, sem `.references()` no Drizzle
- As constraints de FK **existem no banco** — foram criadas via SQL raw na migration `0004`
- O Drizzle não declara a relação explicitamente para evitar import circular em TypeScript
  (`transactions.ts` ↔ `credit-card-invoices.ts` e `documents.ts` ↔ `templates.ts`)

**Impacto prático:**
- Integridade referencial garantida pelo Postgres (FK existe no banco)
- Drizzle não consegue inferir a relação automaticamente via `relations()` nessas colunas
- Se precisar fazer join TypeScript-safe entre essas tabelas, use SQL raw ou declare a relação
  manualmente sem import circular

**Arquivos:**
- `db/schema/transactions.ts` — coluna `creditCardInvoiceId`
- `db/schema/documents.ts` — coluna `templateId`
- `db/migrations/0004_*.sql` — FK constraints criadas aqui

---

## Decisão 2 — Transação atômica no onboarding (Sessão 1.7)

**Contexto:** A action `createOrganization` em `src/app/onboarding/actions.ts` faz dois inserts:
`organizations` e `memberships`. O trigger no Postgres cria automaticamente as 52 categorias
DRE ao inserir em `organizations`.

**Decisão:** Ambos os inserts são envolvidos em `db.transaction()`. Se qualquer parte falhar
(incluindo o trigger), o Postgres faz rollback completo — nenhuma organização parcial fica
no banco.

**Tratamento de constraint único:**
- CNPJ duplicado (`23505` + constraint `cnpj`) → mensagem "Este CNPJ já está cadastrado."
- Slug duplicado (improvável) → mensagem "Nome de empresa já utilizado. Tente outro."

**Arquivo:** `src/app/onboarding/actions.ts`

---

## Decisão 3 — EmptyState.icon: ReactNode em vez de LucideIcon (Sessão 1.7)

**Contexto:** `EmptyState` em `src/components/states/empty-state.tsx` recebia `icon: LucideIcon`
(tipo componente). Server Components passavam `icon={Landmark}` — uma função React — como prop
para o Client Component `EmptyState`, causando erro de serialização RSC.

**Decisão:** Prop `icon` alterada para `React.ReactNode`. Todos os callers passam agora o
elemento já renderizado:
```tsx
// antes (quebrado)
icon={Landmark}

// depois (correto)
icon={<Landmark className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
```

**Arquivos afetados:**
- `src/components/states/empty-state.tsx` (definição)
- `src/app/(authenticated)/dashboard/page.tsx`
- `src/app/(authenticated)/transacoes/page.tsx`
- `src/app/(authenticated)/contas/page.tsx`
- `src/app/(authenticated)/dre/page.tsx`
- `src/app/(authenticated)/fluxo/page.tsx`
- `src/app/style-guide/components/page.tsx`

---

## Decisão 5 — Tabela `transactions_staging` adicionada na Fase 2 (Sessão 2.3)

**Contexto:** O `SCHEMA_INICIAL.md` v2.0 cobre as 18 tabelas da Fase 1. A Fase 2 adicionou
uma tabela de staging fora do schema original.

**Tabela:** `transactions_staging`

**Função:** armazena linhas extraídas de arquivos (Excel/CSV/PDF) antes da revisão humana.
Linhas ficam aqui até o usuário aprovar (→ viram `transactions`) ou rejeitar (→ descartadas).

**Colunas principais:**
- `organization_id`, `document_id` (FKs com CASCADE)
- `row_index` — posição original no arquivo
- `raw_data` (jsonb) — linha completa como veio do arquivo
- `date`, `effective_date`, `amount`, `direction`, `description` — campos extraídos pelo LLM
- `status` — `pending` | `approved` | `rejected`

**Regra de direção por source_type:**
- `credit_card` → todas as linhas forçadas como `outflow`
- Outros tipos → direção inferida por heurística (sinal do valor ou colunas crédito/débito)
- Extensível via `FORCE_OUTFLOW_SOURCES` em `src/jobs/process-document.ts`

**Atualização — migration 0021 (Fase 6):** coluna `effective_date text` (nullable) adicionada. Permite que parsers LLM extraiam a data de caixa (quando o dinheiro se moveu) separada da data de competência (`date`). Ver Decisão 7 para a arquitetura completa da distinção date/effective_date.

**Migrations:** `db/migrations/rls/0007_transactions_staging.sql` (criação) + `db/migrations/rls/0021_staging_effective_date.sql` (effective_date)
**Schema Drizzle:** `db/schema/transactions-staging.ts`

---

## Decisão 6 — Dimensões analíticas em transactions e categorization_rules (Sessão 3.0)

**Contexto:** A Fase 3 expande o modelo de categorização de uma dimensão (plano de contas) para
quatro dimensões analíticas independentes, todas configuráveis por organização.

**Tabelas novas:**
- `cost_centers` — centros de custo (departamentos/setores)
- `business_units` — unidades de negócio (ex: hotel → UHs, restaurante, eventos)
- `legal_entities` — entidades jurídicas (matrizes/filiais por CNPJ)

Estrutura comum: `id, organization_id, name, code (nullable), is_active, created_at`. Sem hierarquia. RLS por `organization_id`.

**Colunas adicionadas em `transactions`:**
- `cost_center_id` — FK → `cost_centers.id`, nullable, `ON DELETE SET NULL`
- `business_unit_id` — FK → `business_units.id`, nullable, `ON DELETE SET NULL`
- `legal_entity_id` — FK → `legal_entities.id`, nullable, `ON DELETE SET NULL`

**Colunas adicionadas em `categorization_rules`:**
- `target_cost_center_id`, `target_business_unit_id`, `target_legal_entity_id` — mesmas FKs nullable
- `target_category_id` tornou-se **nullable** (era NOT NULL): uma regra pode definir dimensões sem alterar a categoria financeira

**Por que `SET NULL` e não `RESTRICT` no DELETE?**
Se o cliente deletar um centro de custo, as transações históricas não devem quebrar — ficam sem
classificação nessa dimensão, o que é aceitável. `RESTRICT` bloquearia o delete e pioraria a UX.

**Decisões de design das dimensões:**
- Uma classificação por dimensão por lançamento — sem rateio
- Entidades jurídicas são classificação simples (como CC), não determinam isolamento entre orgs
- Todas as dimensões sempre visíveis na UI, vazias até o cliente configurar
- Motor de IA (3B) sugere todas as 4 dimensões com confidence score por dimensão

**Migration:** `db/migrations/rls/0008_dimensions.sql`
**Schemas Drizzle:** `db/schema/cost-centers.ts`, `db/schema/business-units.ts`, `db/schema/legal-entities.ts`

---

---

## Decisão 7 — Separação date (competência) vs effective_date (caixa) em transactions (Fase 6)

**Contexto:** a tabela `transactions` sempre teve dois campos de data — `date` (NOT NULL) e `effective_date` (nullable) — mas `effective_date` nunca era populado. Todos os pipelines gravavam apenas `date`, e todas as queries de fluxo de caixa também liam apenas `date`.

**Decisão:** distinguir os dois campos semanticamente:
- `date` → data de **competência** (quando o fato econômico ocorreu: emissão da NF, compra no cartão, lançamento no ERP). Alimenta **DRE** e **BP**.
- `effective_date` → data de **caixa** (quando o dinheiro efetivamente entrou ou saiu da conta). Alimenta **FC (fluxo de caixa)**, saldo de caixa e gráfico de fluxo.

**Impacto por fonte de dados:**

| Fonte | date | effective_date |
|---|---|---|
| Extrato bancário via Pluggy | data de posting no extrato | igual a `date` (posting date = cash date) |
| Upload de extrato bancário | data extraída pelo LLM | igual a `date` (LLM instruído a repetir quando há só uma data) |
| Upload de NF / relatório ERP | data de emissão / competência | data de pagamento / recebimento (campos distintos no documento) |
| Upload de fatura de cartão | data da compra | data do vencimento / pagamento da fatura |

**Regra COALESCE para compatibilidade retroativa:**
Todas as queries de caixa usam `COALESCE(t.effective_date, t.date)` em SELECT, WHERE e GROUP BY. Dados históricos com `effective_date = NULL` continuam aparecendo normalmente — o COALESCE cai de volta para `date`. A mudança é não-destrutiva para todos os dados existentes. Para extratos bancários (a maioria dos dados), `effective_date = date` e o comportamento visível é idêntico ao anterior.

**Queries de caixa alteradas (usam COALESCE):**
- `src/server/dashboard.ts`: `getDashboardKPIs` (saldoCaixa), `getTopExpenseCategories`, `getDashboardCategoryDrillDown`, `getCashFlowChart`
- `src/server/fluxo.ts`: histórico diário + CTE de recorrências
- `src/server/fluxo-mensal.ts`: agregação mensal

> **Onde essas queries vivem hoje** (a lista acima é de Fase 6 e envelheceu; a **convenção** segue
> valendo inteira). Fase 5.B/5.C: `getTopExpenseCategories` e `getCashFlowChart` viraram blocos por
> cima do motor, e o COALESCE passou a ser emitido por `lib/query/sources/` conforme o regime da
> consulta. 26/ago (Decisão 23): `src/server/fluxo.ts` **não existe mais** — a CTE de recorrências
> mudou para `lib/recurrence-detect.ts`, e `saldoCaixa` foi removido de `lib/dashboard/kpis.ts`
> junto com o KPI. Continuam de pé, com o COALESCE: `fluxo-mensal.ts`,
> `getDashboardCategoryDrillDown` e as fontes do motor no regime de caixa.

**Queries de competência — NÃO alterar (usam `date` direto):**
- `src/server/dre.ts` — DRE usa `date` (competência)
- `src/server/balance-sheet.ts` — BP usa `date` (posição de balanço na data de referência)
- `src/server/dashboard.ts` — KPIs de resultado (receita, despesas, lucro) e indicadores financeiros

**Pipeline de população do effective_date:**
- Parsers LLM (`excel-csv.ts`, `pdf.ts`): SYSTEM_PROMPT atualizado para extrair `effectiveDate` separado de `date`; fallback para `date` quando o LLM não retorna ou o documento só tem uma data.
- Pluggy sync (`sync-pluggy-item.ts`): `effectiveDate = date` (posting date IS cash date).
- `approveAndInsert` em `staging.ts`: `effectiveDate: r.effectiveDate ?? r.date` — fallback para `date` quando o staging não preencheu o campo.

**Migrations:** `db/migrations/rls/0021_staging_effective_date.sql` — adiciona `effective_date text` em `transactions_staging`.
**Schemas Drizzle afetados:** `db/schema/transactions-staging.ts` (nova coluna); `db/schema/transactions.ts` já tinha o campo desde a Fase 1.

---

## Decisão 8 — Score de reconciliação NF-e × Transaction (`reconcile-invoices.ts`)

**Contexto:** o job `reconcile-invoices` cruza NFs inseridas via SEFAZ com transações bancárias existentes.

**Fórmula do score composto (0.0–1.0):**
- **40%** `pg_trgm similarity(tx.description, nome_contraparte)` — destinatário para NF saída; emitente para NF entrada
- **40%** match de valor binário: `1.0` se `amount` dentro de ±0.5% do `total_nf`; `0.0` caso contrário
- **20%** proximidade de data linear: `1.0` em 0 dias de diferença → `0.0` em 7 dias

**Filtro de candidatas:** mesma org, direção coerente (saída→inflow, entrada→outflow), amount ±0.5%, data ±7 dias, `status='confirmed'`, `invoice_id IS NULL`.

**Thresholds de decisão:**
- ≥ 0.85 → casa automático: `invoice.status='casada'`, `invoice.transactionId=tx.id`, `transactions.invoiceId=invoice.id`, **`transactions.date=invoice.dataEmissao`**
- 0.50–0.84 → `invoice.status='pendente_revisao'` (fila manual no painel /nfe)
- < 0.50 → invoice fica `'nova'` (A/R ou A/P em aberto, sem vínculo)

**Arquivo:** `src/jobs/reconcile-invoices.ts`

---

## Decisão 9 — `transactions.date` atualizado na reconciliação NF-e

**Contexto:** ao reconciliar uma NF com uma transação bancária, a data do extrato (data de caixa) é substituída pela data de emissão da NF (data de competência) no campo `transactions.date`.

**Por que:** o DRE é baseado em competência — o fato econômico (venda/compra) ocorreu na emissão da NF, não quando o banco registrou o crédito/débito. Sem essa atualização, o DRE refletiria a data do extrato, que pode diferir da NF em dias ou semanas.

**O que muda e o que NÃO muda:**
- `transactions.date` ← `invoice.dataEmissao` (atualizado na reconciliação)
- `transactions.effectiveDate` ← **não alterado** (permanece a data do extrato bancário, para o fluxo de caixa)

**Impacto:** DRE de competência passa a refletir a data real da NF. O fluxo de caixa (que usa `COALESCE(effective_date, date)`) não é afetado porque `effectiveDate` é preservado.

**Arquivos:** `src/jobs/reconcile-invoices.ts` (automático) e `src/server/invoices.ts:manualReconcile` (manual).

---

## Decisão 10 — Isolamento de domínio bp/dre no motor de categorização

**Contexto:** o sistema tem 15 tipos de categoria — 10 DRE e 5 BP. Uma regra ou sugestão que atribui uma categoria BP a uma transação de extrato DRE seria semanticamente incorreta.

**Implementação:** `categorizeTransaction(tx, ctx, documentDomain)` recebe o domínio do documento (`'dre'` | `'bp'`), derivado de `documents.reportType` via `domainFromReportType()`.

**Regra em cada camada:**
1. Regras (`applyRules`): ignora regras cujo `targetCategoryId` pertença ao domínio oposto
2. Recorrência: filtra por `inArray(categoryId, domainCategoryIds)` — só aceita precedentes do mesmo domínio
3. LLM (Haiku): prompt inclui a nota `CONTEXTO: DRE` ou `CONTEXTO: BP`; lista de categorias disponíveis já filtrada pelo domínio

**Por que não uma restrição no banco:** documentos diferentes da mesma org podem ter domínios diferentes (extrato bancário = DRE; upload de BP gerencial = BP). A restrição é por transação, não por org.

**Arquivo:** `src/lib/categorizer.ts` — `loadOrgContext` carrega todas as categorias ativas; `categorizeTransaction` filtra para o domínio antes de executar as 4 camadas.

---

## Decisão 11 — Tabelas `fixed_assets` / `loans` / `equity_movements` dropadas, mas schema TS permanece

**Contexto:** A migration `db/migrations/rls/0015_drop_bp_support_tables.sql` (Fase 6) executou `DROP TABLE IF EXISTS` em quatro tabelas — `fixed_assets`, `loans`, `equity_movements`, `inventory_snapshots`. Motivo registrado na própria migration: *"redesign do BP — os dados virão via importação de relatórios classificados como transações com categorias de tipo BP, igual ao fluxo do DRE. As tabelas são substituídas pelo modelo de transactions + document_type."*

**Estado atual do código:**
- ✅ Tabelas físicas: **não existem** no Supabase
- ⚠️ Arquivos TS: `db/schema/fixed-assets.ts`, `db/schema/loans.ts`, `db/schema/equity-movements.ts` **continuam no repo** descrevendo as tabelas dropadas
- ✅ Barrel `db/schema/index.ts`: **não exporta** esses módulos (foram intencionalmente omitidos quando a 0015 rodou)

**Por que isso é uma armadilha:**
Os arquivos TS ainda compilam e podem ser importados diretamente (`import { fixedAssets } from '@/db/schema/fixed-assets'`). Qualquer query Drizzle usando esses módulos passa TypeScript mas falha em runtime com `relation "fixed_assets" does not exist` (código Postgres `42P01`). O overlay do Next.js esconde a causa raiz atrás de "Failed query" — a mensagem do PG só aparece no terminal do dev server.

**Regra prática para futuras sessões:**
- **NÃO** referenciar `fixedAssets`, `loans`, `equityMovements`, nem `inventory_snapshots` em código novo
- **NÃO** adicionar exports desses arquivos ao `db/schema/index.ts` (mesmo se o TypeScript reclamar que algo "não está exportado" — investigue primeiro por que está omitido)
- Para limpar tabelas que referenciam `categories.id`, hoje só `transactions` e `categorization_rules` têm essa FK relevante

**Arquivos:**
- `db/migrations/rls/0015_drop_bp_support_tables.sql` — a migration de drop
- `db/schema/{fixed-assets,loans,equity-movements}.ts` — lápides que sobreviveram, mantidas por enquanto pra não criar diff vazio no git

---

## Decisão 4 — Policy SELECT de memberships sem auto-referência (Sessão 1.8)

**Contexto:** A policy SELECT original de `memberships` continha uma subquery na própria tabela:
```sql
-- ERRADO — causa recursão infinita
USING (
  user_id = auth.uid()
  OR organization_id IN (
    SELECT organization_id FROM memberships   -- ← lê memberships dentro de policy de memberships
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin') ...
  )
);
```
Quando qualquer outra policy (ex: `organizations`) fazia subquery em `memberships`, o Postgres
entrava em loop infinito avaliando a policy de `memberships` que por sua vez lia `memberships`.

**Decisão:** Simplificar para apenas `user_id = auth.uid()`:
```sql
-- CORRETO — sem auto-referência
USING (user_id = auth.uid());
```

**Impacto:** Cada usuário vê somente suas próprias memberships. Admins que precisam ver
memberships de outros usuários da org devem usar a conexão service_role (que bypassa RLS) —
o que já é o caso em todas as server actions via Drizzle.

**Arquivo:** `db/migrations/rls/` (aplicado diretamente no Supabase Studio na sessão 1.8)

---

## Decisão 12 — Camada 0 de categorização: match determinístico do CSV antes do LLM

**Contexto original (Fase 3):** a categorização foi desenhada como pipeline em camadas
1→2→3→4 (regra explícita → recorrência → embedding → Haiku LLM), assumindo que toda
transação chega sem nenhuma classificação prévia (caso bancário/Pluggy) e que sinais
de planilha (`Grupo`, `Família`, `Departamento`) são **advisory** — alimentam o prompt
do LLM mas não casam 1:1 com folhas do plano de contas.

**Problema descoberto na prática:** CSVs gerados pelo próprio ERP do cliente
frequentemente trazem **colunas explícitas** com nomes idênticos aos do plano de contas
do sistema (`Natureza pai`, `Natureza filho`). Pagar chamada Haiku pra fazer um lookup
que poderia ser direto no DB é desperdício de custo, latência e introduz risco de
hallucination do LLM.

**Decisão (commits `d587644` / `d72ec37` / `35400e6`):** adicionar **Camada 0** antes
das regras. Quando o parser detecta colunas autoritativas no CSV, o valor da célula é
tratado como nome canônico da folha do plano de contas e usado pra lookup determinístico.

**Headers reconhecidos como autoritativos:**
- `Categoria Filho` / `Natureza Filho` / `Conta Contábil` / `Plano de Contas`
- `Categoria Pai` / `Natureza Pai`
- `Tipo Natureza` / `Tipo de Natureza` / `Grupo Contábil`

Detecção 100% por nome (regex em header normalizado), **sem LLM** — pra garantir
determinismo. LLM continua sendo usado pra detectar `categoryHints` advisory.

**Pipeline de match em [src/lib/categorizer.ts:findCategoryByCsvMapping](src/lib/categorizer.ts):**
1. Normaliza nome da folha (lowercase, sem acento, colapsa dash/barra/parênteses em espaço)
2. Filtra folhas com `name` normalizado igual ao `categoriaFilho` do CSV
3. Se múltiplas, filtra por `tipoNatureza` mapeado pra código interno
   (`Receita`→`receita_operacional`, `CMV`/`CPV`→`cpv`, etc — ver `TIPO_ALIASES` no arquivo)
4. Se ainda múltiplas, filtra por `categoriaPai` (nome normalizado do pai)
5. Se exatamente 1 candidato → `categoryId`, `method='csv_match'`, `confidence=1.0`
6. Caso contrário → cai pra Camada 1 (regra) → 4 (LLM)

**Onde acontece o lookup:**
- [src/lib/parsers/excel-csv.ts](src/lib/parsers/excel-csv.ts) — `detectAuthoritativeColumns()`
  identifica as colunas por regex no header normalizado e grava o resultado em
  `rawData.__categoryMapping`.
- [src/server/staging.ts](src/server/staging.ts) — no `approveAndInsert`, carrega
  contexto da org uma vez por import e tenta match por linha antes do INSERT.
  Linhas casadas entram no DB já com `categoryId` preenchido e **não** entram no
  evento Inngest pra categorização LLM.
- [src/lib/categorizer.ts](src/lib/categorizer.ts) — Camada 0 dentro de
  `categorizeTransaction` cobre re-categorização posterior ("Categorizar agora")
  caso o usuário adicione folhas novas ao plano após o import.

**Resultado prático (caso ceramic-tile ERP, 7762 linhas):** importação vai já
classificada, 0 chamadas Haiku, latência de segundos em vez de minutos. Linhas
sem match exato continuam caindo pro LLM normalmente.

**Por que `'csv_match'` foi adicionado ao tipo `CategorizationResult.method`:**
auditoria — diferenciar no DB (`categorization_method`) quais linhas vieram do
lookup determinístico vs. as classificadas por regra/LLM. Aparece na UI de revisão.

**O que NÃO faz parte desta decisão:**
- Detecção do **tipo** (Receita/CMV) por sinal de `direction` da transação foi
  descartada em favor da coluna explícita `Tipo Natureza`. Discussão em
  [docs/SESSION_LOG.md](docs/SESSION_LOG.md) — usuário preferiu controle fino
  por coluna em vez de heurística automática por direção.
- Layer 0 só dispara quando há `categoriaFilho` no mapping. `categoriaPai` ou
  `tipoNatureza` sozinhos NÃO classificam — são apenas desempatadores.

---

## Decisão 13 — Modelo de dados do Orçamento (Sessão 9.0)

Três tabelas novas na migration `0024_budget.sql`: `budget_versions`, `budget_series`,
`budget_entries`. As decisões abaixo não são óbvias a partir do schema.

### 13.1 — Orçado em tabelas separadas, nunca uma flag em `transactions`

Orçado e realizado nunca compartilham tabela. Uma coluna `is_budget` em `transactions`
obrigaria **toda** query existente (DRE, BP, FC, dashboard, categorização, reconciliação,
drill-down) a ganhar um filtro — e uma única esquecida faria previsão virar resultado
sem nenhum sinal visível. A separação física é o que garante que isso não aconteça.

### 13.2 — Ocorrências materializadas, não regra expandida na leitura

`budget_series` guarda a regra ("12 meses a partir de jan/27, +5% ao ano"), mas quem
guarda os números é `budget_entries` — uma linha por ocorrência, gravada na criação.

O motivo não é performance (12 meses × 500 séries = 6 mil linhas; irrelevante dos dois
lados). É que o produto exige **editar uma ocorrência isolada**. Expandir na leitura
levaria ao modelo "regra + tabela de exceções", que é estritamente mais complexo que
materializar tudo, e destruiria a query de comparação: o `GROUP BY (category_id, mês)`
teria que virar `LATERAL generate_series` ou expansão em TS, reimplementando fora do SQL
a agregação que a DRE já faz.

**Invariante, escrita no topo de `db/schema/budget-entries.ts`:** `budget_entries` é a
única fonte de verdade para qualquer número exibido; `budget_series` é gerador + defaults.
Nenhuma leitura consolidada recomputa a série.

**Consequência aceita:** depois de "excluir somente este mês", `series.occurrences` passa
a significar "o que a regra geraria", não "o que existe". A UI exibe sempre o count real
de entries. `budget_entries.sequence` nunca é renumerada — buracos são válidos.

### 13.3 — `adjusted_fields text[]` em vez de `is_adjusted boolean`

Uma ocorrência editada à mão não pode ser sobrescrita por alteração em lote sem
confirmação. Com um booleano, uma ocorrência cujo único ajuste foi de **valor** ficaria
protegida também contra uma alteração em lote de **centro de custo** — forçando um dialog
de confirmação que o usuário não deveria ver. Com o array, a alteração em lote do campo F
pula apenas quem tem F no array.

**Auto-cura:** se o valor editado volta a coincidir com o que a série geraria, o campo sai
do array. Sem isso, linhas ficariam travadas para sempre por um ajuste que não existe mais.

### 13.4 — "Este e os próximos" não faz split da série

O padrão de agenda (Google Calendar) trunca a série original e cria uma nova a partir da
ocorrência âncora. Aqui não: a série é preservada e apenas as entries de `sequence >= N`
são alteradas, com os campos marcados em `adjusted_fields`.

Split fragmentaria a identidade — a aba Planejamento mostraria duas linhas onde o usuário
criou uma. **Preço aceito:** uma edição posterior de "toda a série" precisa de
`overwriteAdjusted` para retomar aquelas ocorrências. Aceitável num horizonte anual com
poucas revisões. **Exceção:** quando a âncora é a sequência 1, "daqui" equivale a "todas" —
a série também é atualizada e nada é marcado como ajustado.

### 13.5 — `cash_date` é NOT NULL e pode vazar do exercício

Ao contrário de `transactions.effective_date` (nullable só por retrocompatibilidade com
dados históricos), aqui a data de caixa é obrigatória — logo nenhuma query de regime caixa
do orçado precisa de `COALESCE`.

O exercício é o ano civil e valida apenas a **competência**. Competência de dez/27 com
prazo de 30 dias tem caixa em jan/28, e isso é a realidade, não um erro: o orçado que vaza
não aparece na matriz do exercício, e a tela de comparação informa o total vazado no rodapé
(`foraDoHorizonte`). A alternativa — proibir o lag na borda ou inventar orçamento plurianual —
seria mentira ou escopo desnecessário.

### 13.6 — Colunas que evitam armadilha, e por quê

- **`interval_months int`, não um enum de frequência.** O enum precisaria de um valor
  "único" redundante com `occurrences = 1` e de um mapa enum→meses em algum lugar do código.
- **`start_month date`, não texto `'YYYY-MM'`.** Duplicação de versão e copiar-do-realizado
  fazem aritmética SQL de data (`make_interval`), que texto quebraria — e é `make_interval`
  que faz o clamp correto de 29/02 → 28/02.
- **`total_amount` separado de `base_amount`.** Só o modo `parcelado` usa o total; sem coluna
  própria, depois de expandir não haveria como saber se 1.200 era a parcela ou o total.
- **`adjustment_rate` é fração decimal** (`0.05` = 5%) e **`adjustment_every` conta
  ocorrências**, não meses (com `interval_months` variável, meses seria ambíguo).
- **`seasonal_amounts`** é array em ordem de **sequência**, não indexado por mês do
  calendário — com `interval_months > 1` não existem 12 slots. Validado por CHECK contra
  `occurrences`.
- **`category_id NOT NULL ON DELETE RESTRICT`** nas duas tabelas: a comparação faz INNER JOIN
  em `categories` (igual à DRE), então orçado sem categoria sumiria em silêncio; e apagar uma
  categoria com orçado deve falhar de forma visível.
- **`source`** entrou já na 0024, embora só seja usado nas sessões 9.4/9.5 — custo zero agora,
  evita uma migration só para isso depois.

### 13.7 — Aritmética de valor

- **Reajuste** é sempre `base × (1+rate)^floor((i−1)/every)`, calculado a partir do valor
  inicial — nunca iterativamente sobre o valor arredondado anterior, que acumularia drift.
- **Parcelamento** divide em centavos e joga a sobra na **última** parcela, para a soma bater
  exatamente com o total. Se depois uma parcela do meio for ajustada à mão, a soma diverge de
  `total_amount` — e tudo bem: o total do ano exibido vem sempre das entries.

### 13.8 — Extrações que acompanharam a fase

O módulo seria a 4ª cópia de código já duplicado, então a 9.0 moveu (não duplicou):
`computeSubtotals`/`sumByTypes`/`generateMonthRange` → `src/lib/dre-calc.ts`; o trio de
filtros de dimensão → `src/lib/sql-dimensions.ts` (`dimensionFilters(alias, filtros)`, com
`alias` como union literal fechado — é o único trecho que entra via `sql.raw`);
`getAuthContext` → `src/lib/auth-context.ts`.

Os três vivem em `src/lib/` e **não** têm `'use server'`: essa diretiva só permite exportar
funções async, e a coluna "Projeção do ano" da tela de comparação roda `computeSubtotals` no
cliente. `getAuthContext` segue copiado nos 8+ arquivos antigos de `src/server/` — migração
incremental, não refactor horizontal de uma vez.

A 9.4 seguiu o mesmo critério: `budget-copy.ts` nasceu em `src/lib/` — server-only, importa
`db` — para que o miolo dos aceleradores pudesse ser exercitado direto contra o banco, sem
sessão HTTP. Nenhum componente client importa dele; os tipos que a UI precisa moram em
`budget-types.ts`.

### 13.9 — Copiar do realizado: dois eixos, e o mapeamento por número do mês (Sessão 9.4)

O plano previa um parâmetro `granularity`. Na implementação virou **dois**, porque
respondem a perguntas diferentes:

- **Formato** — `mensal` preserva a sazonalidade (cada mês recebe o valor do mês
  correspondente); `media` distribui o total em 12 parcelas iguais. É uma escolha sobre o
  **tempo**.
- **Detalhamento** — `categoria` gera um lançamento por categoria; `dimensoes` gera um por
  combinação de categoria com centro de custo, unidade e entidade. É uma escolha sobre a
  **dimensão**.

Um parâmetro só misturaria as duas e obrigaria o usuário a adivinhar qual metade estava
escolhendo.

**O mapeamento é por número do mês, não por posição na lista:** março de origem vira março
do exercício de destino, mesmo que o período comece em julho. Daí sai o **teto de 12 meses**
do período de origem — com 13, dois janeiros disputariam o mesmo alvo e o valor dobraria sem
nenhum sinal. A validação está no `superRefine` do `copyActualsInputSchema` e diz o número
de meses escolhido.

**Direção entra na chave de agrupamento.** Compensar entrada com saída dentro da mesma
categoria produziria meses de sinal trocado, e uma série tem uma direção só com `amount`
sempre positivo. Uma categoria com estorno gera dois lançamentos — que é o histórico real,
não um defeito.

**`adjustmentPct` ≠ `adjustment_rate`.** O primeiro é percentual de aplicação única sobre o
valor copiado (8 → ×1,08) e desaparece dentro do número gravado; o segundo é fração decimal
que se acumula a cada N ocorrências e fica na regra. A série copiada nasce em `fixo` ou
`sazonal`, nunca em `reajuste`.

**O que fica de fora é declarado.** Realizado sem categoria e em categoria desativada não
entram na cópia — a segunda porque `validateTargetsBelongToOrg` recusaria salvar um
lançamento nela depois, o que deixaria a linha impossível de editar. Os dois voltam como
número na prévia. Ocultas no regime, contas de balanço e `pending` seguem exatamente as
regras da `getBudgetVsActual`, para que "copiei o realizado" e "o realizado que a comparação
mostra" sejam o mesmo número.

### 13.10 — Duplicação de versão: o mapa de ids e o que NÃO se regenera (Sessão 9.4)

Duplicar copia séries e ocorrências num **único statement**. O problema é que `RETURNING`
não devolve o id de origem, então não há como ligar as ocorrências novas às séries novas
depois do INSERT. A solução é gerar o uuid **junto da leitura**:

```sql
WITH mapped AS MATERIALIZED (
  SELECT s.*, gen_random_uuid() AS new_id FROM budget_series s WHERE s.version_id = $src
)
```

`MATERIALIZED` é obrigatório, não estilo: `mapped` é referenciada duas vezes (pelo INSERT de
séries e pelo de ocorrências) e `gen_random_uuid()` é volátil. Sem a palavra, uma reavaliação
daria ids diferentes nas duas referências e as ocorrências apontariam para o nada. As FKs
funcionam dentro do mesmo statement porque os gatilhos de integridade referencial são AFTER
ROW e disparam no fim dele, quando as séries já existem.

**`adjusted_fields` e `sequence` são copiados, nunca regenerados.** Regenerar é o bug número
um dessa funcionalidade em produtos comerciais: apaga em silêncio exatamente o trabalho
manual que a duplicação existe para preservar. Buracos de sequência (de uma exclusão
pontual) também são preservados — buracos são válidos, ver 13.5.

**O deslocamento usa `make_interval(years => delta)`**, que já apara 29/02 → 28/02 ao cair
em ano não bissexto. Mas o **prazo de caixa é preservado em dias**
(`nova_competência + (cash_date − competence_date)`), não deslocado por ano: o lag é a regra
de negócio ("recebo em 30 dias") e a data é consequência dela. Deslocar as duas por ano
introduziria uma deriva de um ou dois dias no prazo.

A versão duplicada nasce como `rascunho` e **não** assume a vigência do exercício de destino
se já houver uma vigente — duplicar é um ato de rascunho, não de publicação.

### 13.11 — Planilha de orçamento em grade de 12 meses (Sessão 9.5)

O import não usa uma linha por ocorrência. Usa **uma linha por lançamento com doze colunas de mês**
(`jan`..`dez`), que é o formato em que o orçamento já existe na mesa do cliente. Uma linha por
ocorrência explodiria doze vezes o que o módulo trata como um lançamento só, e obrigaria o usuário
a reconstruir a recorrência depois.

As colunas de mês são **do calendário do exercício da versão**, não posições relativas: a coluna
`mar` é março do exercício, sempre. Isso mantém o import coerente com o mapeamento da cópia do
realizado (13.9) e permite as duas features compartilharem `shapeMonthly` — pontas aparadas,
buracos internos zerados, valores uniformes virando `fixo` em vez de `sazonal` repetido.

**`categoria` aceita código ou nome.** Código é único por organização; nome não é. Quando o nome
bate em mais de uma folha, a linha é **recusada listando os códigos** em vez de escolher a primeira
— escolher errado aqui aloca dinheiro na conta errada e é invisível na conferência.

**Linha inválida não invalida o arquivo.** Ela aparece na prévia com o motivo e o número da linha
da planilha, e é a única que fica de fora. Recusar as 50 por causa de duas transformaria um
acelerador em obstáculo. Cabeçalho errado é diferente: sem nome de coluna não há como saber de que
mês é o número, então aí o arquivo inteiro para.

### 13.12 — Recorrências detectadas: a conversão dias → meses (Sessão 9.5)

> **Atualização de 26/ago (Decisão 23):** a detecção deixou de morar no `/fluxo` — a projeção de 90
> dias saiu do ar e a função virou `detectarRecorrencias`, em `lib/recurrence-detect.ts`. O
> `/orcamento` passou a ser o **único** consumidor, e nada abaixo mudou.

A detecção trabalha em **dias** (agrupa por descrição nos últimos 180 dias e aceita
intervalos médios de 7 a 40). O orçamento trabalha em **meses**. Copiar `valorMedio` direto para
uma série mensal seria um erro caro e silencioso: uma recorrência semanal de R$ 100 viraria
R$ 100/mês em vez de R$ 400/mês — quatro vezes menos.

`timesPerMonth(dias) = max(1, round(30 / dias))` e o valor mensal é `valorMedio × vezesPorMes`. O
inteiro é proposital: "a cada 7 dias, 4× por mês" é conferível de cabeça; 4,35 não é. O diálogo
mostra o valor detectado, o multiplicador e o valor mensal resultante, e deixa o número editável
antes de aceitar.

**A categoria é obrigatória e vem do usuário.** `RecorrenciaDetectada` não tem categoria — a
detecção agrupa por descrição, não por plano de contas. Sem escolher, o lançamento não apareceria
em relatório nenhum (a comparação faz INNER JOIN em `categories`). O botão fica travado enquanto
houver selecionada sem categoria.

**Recorrência que não cabe no exercício aparece bloqueada, não sumida.** Sumir faria o usuário
procurar por que a lista está menor que a do `/fluxo`. O mesmo vale para as já aceitas, marcadas
pelo nome normalizado contra as séries com `source = 'recorrencia_detectada'` da versão.

### 13.13 — `source` decide o que a substituição apaga (Sessão 9.5)

`applyCopyToBudget` virou `applyDraftsToBudget(tx, { source, ... })`, comum às três origens
geradas (cópia do realizado, planilha, recorrência aceita). O `replaceExisting` apaga apenas as
séries **daquela mesma origem**.

É o que torna as três reexecutáveis sem se destruírem: reimportar a planilha não pode levar junto
o que foi copiado do realizado, e nenhuma das duas pode tocar no que foi digitado à mão. Aceitar
recorrência não oferece substituição de propósito — é ato incremental ("essa aqui também"), não um
lote que se refaz inteiro.

### 13.14 — A terceira coluna da DRE troca de significado (Sessões 9.6–9.8)

Cada mês da `/dre` tem uma coluna a mais, que **existe sempre** e muda de sentido conforme o
orçamento esteja oculto ou visível:

| Orçamento | Colunas do mês | A terceira é |
|---|---|---|
| **Oculto** | `Valor` · `AV%` | **variação vertical** — participação na Receita Líquida do mês |
| **Visível** | `Real` · `Orç` · `Var%` | **variação horizontal** — desvio percentual sobre o orçado |

As duas leituras nunca aparecem juntas. Mostrar as duas exigiria uma quarta subcoluna por mês
(~3.700px de tabela), e a terceira troca de significado justamente para não acumular.

**AV% é cinza; Var% é colorida.** A distinção não é estética: proporção não é julgamento. Pintar
"Aluguel = 10,4% da receita" de verde inventaria um sinal que a coluna do valor, ao lado, já diz.
O desvio sobre o orçado, sim, é julgamento — e segue a convenção do módulo, em que **positivo é
favorável dos dois lados da DRE**: gastar menos que o previsto dá verde, faturar menos dá vermelho.

**A AV% de uma linha de conta e a de um subtotal não são a mesma coisa.** Numa conta é *consumo*, e
se lê em magnitude ("Habitação consome 30,3%"). Num subtotal é *margem*, e vai com sinal. Sem essa
distinção, um EBITDA de −11,6% aparece como "11,6%" — indistinguível de uma margem positiva, no
exato mês em que o número mais importa. O caso foi encontrado nos dados reais (mai/2026, com SGA em
111,6% da receita líquida) e é o que motivou o parâmetro `signed` de `verticalShare`.

**Consequência conhecida da magnitude:** quando um pai tem filhos de sinais opostos (um estorno
junto de despesas), as AV% dos filhos não somam a do pai. Medido nos dados reais: 213 grupos
pai→mês batem, 6 não. É inerente a ler magnitude, não é defeito de cálculo.

**A terceira coluna nunca é clicável.** `Valor`/`Real` abrem as transações, `Orç` abre o orçamento;
um terceiro destino para uma proporção ou um desvio seria adivinhação. O tooltip da célula mostra os
números que originaram o cálculo.

### 13.15 — União realizado ∪ orçado na DRE (Sessão 9.7)

`getDreData` devolve só categorias com realizado. Ligar o orçamento faz a malha unir os dois lados
por `categoryId:month`, porque **categoria orçada e não realizada tem de aparecer** — "orcei R$ 10
mil em marketing e não gastei nada" é a descoberta mais valiosa da tela, e a interseção a esconderia.

A malha trabalha sempre com um par `{realizado, orcado}`, mesmo com o orçamento desligado (aí
`orcado` é 0). Um caminho de código só: duas árvores de renderização divergiriam no primeiro ajuste.

**Célula zerada dos dois lados não vira linha** — mas só quando o zero vem do orçado. O orçamento
tem ocorrências de valor 0 por construção: `shapeMonthly` preenche com zero os meses de buraco de
uma série sazonal (13.11), e sem essa guarda elas trariam para a DRE categorias inteiras sem nada a
mostrar. Célula zerada vinda do **realizado** continua aparecendo: já era o comportamento da tela
(categoria com estorno que zera o mês), e mudá-lo seria alterar a DRE sem ninguém pedir.

**A leitura do orçado é a mesma dos dois lados.** `fetchBudgetRows`, em `src/lib/budget-read.ts`,
serve a `getBudgetVsActual` e a `getBudgetForPeriod`. Não é economia de linhas: a conciliação
verificada na 9.2 — o orçado da aba bate célula a célula com a DRE — só continua valendo se as duas
telas lerem pela mesma query. Uma segunda query "parecida" divergiria no primeiro filtro que alguém
esquecesse de replicar. Pelo mesmo motivo os filtros de dimensão vão **idênticos** para os dois
lados: filtrar só o orçado é o que faz a variação parecer melhor do que é.

---

## Decisão 14 — Contato como quarta dimensão analítica (Sessão 10.0)

**Contexto:** a Decisão 6 fixou três dimensões (centro de custo, unidade de negócio, entidade
jurídica) e registrou, três vezes em documentos diferentes, que não haveria rateio. A Fase 10
revisita as duas coisas. Esta sessão trata da primeira: o cadastro de cliente/fornecedor.

**O que já existia.** `contacts` nasceu na Fase 1 completa — `type`, nome, fantasia, documento,
e-mail, telefone, CNAE, RLS, trigger `updated_at`, índice GIN trigram em `name` e índice único
parcial em `(organization_id, document)`. `transactions.contact_id` existe desde a migration 0003,
com FK e índice `idx_tx_org_contact` cujo comentário diz *"relatório de fornecedor/cliente"*.
`categorization_rules.target_contact_id`, `invoices.contact_id`, `budget_series.contact_id` e
`budget_entries.contact_id` também existem.

**Nada disso jamais foi escrito por código algum**, exceto no orçamento — o `SeriesDialog` associa
contato ao lançamento desde a 9.1. Em `transactions`, a coluna trafega no payload de `/transacoes`
(via `getTableColumns`) e é sempre nula. Era infraestrutura dormente, não uma tabela a criar.

**Papel duplo em vez de `type` textual.** O mesmo CNPJ é cliente e fornecedor com frequência — a
transportadora que a empresa contrata também compra dela. Um `type` de valor único obrigaria a
escolher um lado ou a duplicar a ficha, e duplicar quebraria o índice único `(org, document)`, que
é justamente o que impede o mesmo CNPJ de entrar duas vezes. Daí o par `is_customer` / `is_supplier`.

`type` **continua NOT NULL** porque é assim que `docs/SCHEMA_INICIAL.md` o define, e aquele
documento se declara definitivo. Passa a ser **derivado** dos booleanos na escrita
(`both` / `customer` / `supplier` / `other`), com `DEFAULT 'other'` no banco para que um INSERT que
só informe os papéis não quebre. É redundância deliberada: a alternativa era mudar uma coluna
declarada definitiva para ganhar nada — ninguém lê `type`.

**`is_active` e `code` alinham contacts com as outras três.** O `DimensionManager` e o import de CSV
dependem dos dois; sem eles contato seria a única dimensão sem arquivamento.

**Faltavam duas coisas no banco, e são defeitos, não escolhas:**
- `contacts` tinha policy de SELECT, INSERT e UPDATE, e **nenhuma de DELETE** (migration 0002). Com
  RLS ativa isso torna a exclusão impossível pela sessão do usuário. As outras três dimensões têm as
  quatro desde a 0008.
- `transactions.contact_id` e `categorization_rules.target_contact_id` usavam `ON DELETE no action`,
  o que bloquearia apagar um contato em uso. Passam a `SET NULL`, pelo mesmo motivo registrado na
  Decisão 6: histórico não deve quebrar, só perder aquela classificação.

**Migration:** `db/migrations/rls/0025_contacts_dimension.sql`

---

## Decisão 15 — O sentinela `__null__` nos filtros de dimensão (Sessão 10.0)

**Defeito encontrado ao mapear o sistema.** `DimFilter` oferece a opção "Sem centro de custo" e
emite o sentinela `DIM_NONE = '__null__'` dentro do array de ids. A aba Orçado × Realizado repassa
esse array cru como `costCenterIds`, e `dimensionFilters` fazia `${id}::uuid` em cada elemento —
`'__null__'::uuid` é erro de sintaxe no Postgres. Não havia sanitização em ponto algum do caminho, e
`getBudgetVsActual` não valida a entrada com Zod. Confirmado contra o banco real: a chamada lançava.

**A tradução certa é `IS NULL`, e a combinação é uma disjunção.** Marcar "Sem centro de custo"
*junto com* centros concretos tem de devolver a união dos dois conjuntos — como `AND`, devolveria
vazio sempre. Verificado sobre 10.329 lançamentos reais: `com CC + sem CC = total`, e
`1 CC + sem CC` é exatamente a soma dos dois.

**Onde o sentinela mora.** Foi promovido para `src/lib/dre-types.ts`, que não importa nada e se
declara importável por cliente e servidor. `dim-filter.tsx` (client) o reexporta para não quebrar
quem já importava de lá; `sql-dimensions.ts` (server-only, importa drizzle) o consome. Nenhum dos
dois pode importar do outro — o cliente puxaria drizzle para o bundle, e o servidor puxaria a árvore
de componentes.

---

## Decisão 16 — O rateio é sub-lançamento, não percentual por dimensão (Sessão 10.2)

**O desenho anterior, e por que caiu.** Até esta sessão o CLAUDE.md registrava rateio como
*"independente por dimensão"*: o cliente informaria a divisão de cada dimensão em separado
(centro de custo 60/40, contato 70/30) e uma view cruzaria as duas. Ao explicar o modelo para
decidir o schema, ficou claro que ele tem dois defeitos que nenhuma implementação conserta:

- **Inventa dado.** Cruzar 60/40 com 70/30 produz a célula "Admin + Cliente B", uma combinação
  que o cliente nunca afirmou ter acontecido. O sistema deduz repartição de fato econômico a
  partir de duas marginais — que é exatamente o que não se pode fazer em contabilidade.
- **Reintroduz a fração de centavo.** Mesmo com cada dimensão fechando exata, a multiplicação
  das proporções não fecha: 333,33 × 50% = 166,665.

**O modelo escolhido.** Um lançamento de R$ 999 vira N partes com valor próprio, e **cada parte
carrega o conjunto completo das quatro dimensões**. Só existe o que foi escrito, e 333+333+333
fecha 999 sem resíduo. É o que os ERPs fazem, e o custo — dividir por duas dimensões ao mesmo
tempo exige enumerar as combinações — quase nunca aparece na prática e é mais honesto que deduzir.

**A natureza não se parte.** A categoria continua sendo uma só, no lançamento pai; a parte
reparte apenas as dimensões. Nenhuma linha da DRE se divide por causa de rateio, e por isso a
Fase 10.3 pode migrar as sete leituras uma a uma sem que nenhum total mude.

**Soma exata como regra do banco, não da aplicação.** Ou o lançamento tem **zero** partes, ou a
soma delas é **exatamente** `transactions.amount`. Rateio que não fecha no centavo não entra —
decisão explícita, e é o que torna R$ 100 em três partes iguais impossível (o cliente faz
33,34 + 33,33 + 33,33).

**Por que `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` e não `CHECK`.** `CHECK` enxerga
uma linha por vez e a soma é propriedade do conjunto. Deferido até o COMMIT, dá para inserir as
três partes de 333 uma a uma sem que a primeira seja recusada por somar 333 e não 999. O mesmo
gatilho cobre, pela mesma porta: apagar uma parte de três, editar o valor de uma parte, e editar
o valor do lançamento pai — todos terminam em soma divergente no commit.

**As colunas de dimensão do lançamento ficam vazias quando há rateio**, e o gatilho recusa o
contrário. Se ficassem preenchidas, toda leitura ainda não migrada atribuiria o valor **integral**
a uma das partes — erro silencioso. Vazias, a leitura não migrada mostra "sem centro de custo",
que é uma lacuna visível.

**Teto de 50 partes.** No desenho anterior o limite existia para conter o produto cartesiano;
sem cruzamento, sobrou como sanidade.

**A view `transaction_lines`** (`security_invoker = true`, senão furaria a RLS das tabelas de
baixo) devolve uma linha por lançamento sem rateio — idêntica à de hoje — e uma por parte quando
há rateio. `amount` e as quatro dimensões vêm da parte; natureza, data e conta vêm do pai.

**Migration:** `db/migrations/rls/0026_transaction_allocations.sql`
**Schema Drizzle:** `db/schema/transaction-allocations.ts`

**Verificado antes de aplicar:** a migration inteira roda dentro de uma transação com ROLLBACK,
15/15 casos — soma exata aceita, soma curta e soma longa recusadas com a mensagem nomeando os
valores, dimensão no pai recusada, edição do valor do pai recusada, 51 partes recusadas e 50
aceitas, e a view devolvendo exatamente as 2.272 linhas e o mesmo total de `transactions` enquanto
não há rateio nenhum.

---

## Decisão 17 — Modelo de rateio guarda proporção, e o carimbo de origem conta a menos (Sessão 10.5)

**Contexto:** o rateio da 10.2–10.4 exige redigitar a divisão a cada lançamento. Um modelo salvo
resolve — mas o que exatamente ele guarda?

**Peso relativo, nunca valor.** O mesmo modelo tem de servir ao aluguel de R$ 12.000 e à conta de
luz de R$ 340. Guardar valor amarraria o modelo a um lançamento só. Os centavos são resolvidos na
aplicação, por `applyProportion` (maior resto) — o mesmo caminho do rateio em lote, que é o que
garante a soma exata que a migration 0026 cobra.

**Os pesos não precisam somar 100.** `60:40`, `6:4` e `7200:4800` descrevem a mesma divisão, e só a
razão entre eles é lida. Isso é o que permite **"Salvar como modelo" a partir de um rateio já feito
em reais**: os centavos das partes viram os pesos, sem arredondar nada no caminho. Normalizar para
percentual na gravação perderia precisão em divisões como 1/3; quem normaliza é só a exibição
(`normalizeWeights` / `formatProportion`).

**Redução pelo MDC ao salvar do diálogo individual.** Guardar os centavos crus funciona, mas quem
abrisse o modelo no editor veria campos de peso com `720000` e `480000`. `reduceWeights` divide
pelo MDC quando todos são inteiros — `[720000, 480000] → [3, 2]` — a única simplificação que
preserva a proporção exatamente. Pesos decimais digitados à mão (33,3333) passam intactos.

**`weight numeric(18,6)`, não `(12,4)`.** Consequência direta do acima: o peso pode ser um valor em
centavos. `(12,4)` comporta 8 dígitos inteiros e um lançamento de R$ 1 milhão vira peso
100.000.000 — estouro. `(18,6)` chega à casa dos bilhões. Defeito encontrado escrevendo os testes,
antes de a migration ser aplicada.

**Mínimo de 2 partes.** Um modelo de uma parte só não descreve divisão nenhuma — é classificação
direta, que o combobox da tela já faz.

**`transaction_allocations.allocation_template_id` — o carimbo.** É o que responde "quantos
lançamentos usam este modelo?" antes de apagá-lo. `ON DELETE SET NULL`: apagar um modelo **nunca**
desfaz rateio nem muda número de DRE, só remove a etiqueta.

**O carimbo conta a menos, de propósito.** Ele é gravado apenas quando o rateio veio do modelo **e
não foi editado depois** — qualquer mexida em valor, percentual, dimensão ou número de partes o
derruba para `null` no cliente. Contar a mais seria pior: a tela existe para decidir se dá para
apagar o modelo, e um número inflado por rateios que já divergiram dele mentiria exatamente na
pergunta que a tela responde. A contagem é `COUNT(DISTINCT transaction_id)`, não de partes — o
número promete lançamentos.

**Teto de 50 linhas fora do banco.** Diferente da soma exata da 0026, esta regra não precisa de
gatilho: um modelo grande demais só falha ao ser aplicado, e ali o Zod de `saveAllocations` e o
gatilho da 0026 já recusam com mensagem boa. Um gatilho a mais seria uma segunda fonte da mesma
regra.

**Arquivar convive com apagar.** Arquivado some do seletor e preserva o carimbo; apagado perde o
rastro. O diálogo de exclusão diz qual dos dois o usuário está escolhendo.

**Migration:** `db/migrations/rls/0027_allocation_templates.sql`
**Schema Drizzle:** `db/schema/allocation-templates.ts`

**Verificado antes de aplicar:** migration inteira dentro de uma transação com ROLLBACK, 19/19 —
estrutura, 5 índices, 8 policies, RLS, 2 triggers, nome duplicado recusado por caixa e espaço, nome
em branco recusado, peso zero e negativo recusados, peso de 9 dígitos aceito, contagem contando
lançamentos e não partes, e apagar o modelo zerando o carimbo sem tocar nas partes. Aritmética:
19/19, incluindo 2.500 aplicações sobre 500 valores reais fechando o centavo exato e o ciclo
rateio → modelo → rateio devolvendo as mesmas partes nos 500.

---

## Decisão 18 — `${tabela.coluna}` dentro de subconsulta correlacionada (Sessão 3.3)

Não é decisão de schema: é uma armadilha do Drizzle que **já quebrou duas features em produção, em
silêncio**, e mora aqui porque este é o único documento sempre carregado.

### A regra, medida com `toSQL()`

| Onde o `${tabela.coluna}` aparece | O que o Drizzle emite |
|---|---|
| lista do SELECT, consulta **sem** join | `"id"` — **sem qualificar** |
| lista do SELECT, consulta **com** join | `"categories"."id"` |
| cláusula WHERE, **sempre** | `"categories"."id"` |

### Por que falha calada

```sql
EXISTS (SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = "id")
```

O `"id"` sem qualificação é resolvido pelo escopo **interno** sempre que a tabela de dentro tiver
uma coluna com esse nome. A correlação vira `a.transaction_id = a.id` — sintaxe válida, resultado
constante, nenhum erro. O booleano fica preso em `false` (ou em `true`, num `NOT EXISTS`) para
sempre.

### As duas mordidas

| Onde | Sintoma | Quanto tempo |
|---|---|---|
| `jaRateado` de `preverLoteDeRateio` | O aviso *"N já rateados serão substituídos"* do diálogo de rateio em lote vivia **zerado** | desde a 10.4 |
| `atribuivel` de `listar_categorias` | `true` para **toda** natureza — o MCP anunciava natureza pai como destino válido. Medido: 152 de 180 são folha, e a ferramenta dizia 180 | desde a 3.2 |

Nos dois casos o defeito atravessou revisão porque a construção *parece* certa e o tipo é
`boolean`. Só aparece imprimindo o SQL ou testando o caso negativo — que é exatamente o caso que
ninguém escreve.

### A correção, e o que auditar

Escreva `${tabela}.coluna`, não `${tabela.coluna}`: `${transactions}` renderiza `"transactions"` e o
`.id` literal completa a qualificação, em qualquer posição.

Sites auditados e o veredito de cada um:

| Site | Posição | Veredito |
|---|---|---|
| `allocations-write.ts` · `jaRateado` | SELECT sem join | **corrigido** |
| `mcp/tools.ts` · `atribuivel` | SELECT sem join | **corrigido** |
| `rules-write.ts` · `folha` | SELECT sem join | nasceu corrigido |
| `server/transactions.ts` · `isAllocated` | SELECT **com** join | seguro |
| `transactions-write.ts` · `semRateio` | WHERE | seguro |
| `sql-dimensions.ts` · `dimensionExistsFilter` | WHERE | seguro — e **também** porque `transaction_lines` não tem coluna `id`. Se a view ganhar `id`, o segundo motivo evapora; o primeiro sobrevive |

A nota completa vive em `src/lib/sql-dimensions.ts`, junto do código que mais depende dela.

---

## Decisão 19 — `match_count` ganhou um escritor, e o passado fica declarado (Sessão 3.3)

`categorization_rules.match_count` nasceu na Fase 1 com `DEFAULT 0 NOT NULL` e **nunca foi
incrementada por nada**. No dia em que isso foi descoberto: **518 regras no banco, 518 com zero.**

O custo não foi o badge morto da tela (`aplicada N×`, invisível desde a Fase 6). Foi o dia em que a
ferramenta `listar_regras` publicou o contador como se fosse dado e o modelo concluiu, com toda a
lógica correta, que *"500 de 500 regras nunca foram aplicadas"* — resposta que teria saído idêntica
se cada uma pegasse mil lançamentos por dia. **Um número que sempre vale zero não é um número: é
ruído com aparência de evidência.**

### Como passou a ser escrito

`CategorizationResult.ruleId` é preenchido **só** pela camada 1. O job acumula num `Map` durante o
bloco e chama `somarMatchCount` uma vez, com um `UPDATE ... FROM (VALUES ...)`. Um UPDATE por
lançamento seriam 50 idas por bloco e 7.762 numa importação grande.

**`updated_at` fica de fora.** A tela e o MCP ordenam a lista de regras por ele; tocá-lo aqui faria
toda importação embaralhar a ordem que a pessoa usa para achar o que editou por último.

**Falha aqui não derruba a categorização.** O contador é informativo; perder uma contagem vale muito
menos que perder o lote de classificações.

### O passado não volta, e isso é dito

Uma regra da Fase 6 que pegou mil lançamentos continua marcando zero. Por isso `CONTADOR_VIVO_DESDE`
(`'2026-08-24'`, borda conservadora — regra criada mais cedo no mesmo dia ainda é anterior ao
deploy) e o campo `contadorConfiavel` **por linha**, mais um aviso na resposta da ferramenta.

A alternativa — esconder o contador até ele ter história — foi descartada: a tela já o mostrava, e
um dado marcado como não confiável vale mais que um dado ausente. A marcação some sozinha conforme
as regras antigas forem sendo tocadas, o que é a propriedade certa para uma ressalva de migração.

---

## Decisão 20 — A importação pelo MCP não sobe arquivo: sobem as linhas (Sessão 3.3)

### O que o plano dizia, e por que estava errado

O plano de 23/ago escreveu: *"`iniciar_importacao` devolve **URL assinada de upload** — o arquivo
nunca trafega em base64 dentro do JSON-RPC"*. A premissa está certa; a conclusão não.

**O modelo não tem arquivo para subir.** Quem tem é a pessoa, na máquina dela — e ela já o anexa na
própria conversa do claude.ai, que lê CSV, Excel e PDF. Uma URL assinada devolvida no chat só serve
se alguém fizer um `curl` nela, o que é um passo manual fora da conversa para um público de PME.

A conclusão certa: **o arquivo não trafega, ponto. As linhas trafegam.** O modelo tabula e chama
`prever_importacao` com as linhas prontas.

### O que isso apaga

Este caminho **não usa** Supabase Storage, `transactions_staging`, o job `process-document`, a tela
de revisão — e **não chama a Anthropic uma única vez**. Toda a camada de parsing existe porque o app
não sabe ler arquivo arbitrário. Aqui, quem lê já leu, e melhor.

### O que ele preserva, porque não é acessório

| | Por quê |
|---|---|
| Registro em `documents` | Sem ele o lote não tem origem rastreável nem aparece no filtro "importação" de `/transacoes`. `storage_path` é NOT NULL e não há arquivo: o esquema `mcp://` é a fachada, e `deleteDocument` aprendeu a pular a remoção no Storage quando vê esse prefixo |
| `data_sources` própria por origem | É ela que dá o rótulo da conta em `/transacoes` |
| Camada 0 | `categoria` da linha (código ou nome) casada contra as folhas do plano de contas — é o que faz export de ERP entrar já classificado, sem IA |
| Disparo da categorização | O que não casou vai para a fila, igual ao caminho da tela |

### A deduplicação é o coração disto

**O caminho de upload da tela nunca deduplicou nada.** Subir o mesmo extrato duas vezes dobra a
contabilidade. Isso sobreviveu porque uma pessoa não reenvia o mesmo arquivo sem perceber. **Um
modelo, sim** — ele tenta de novo quando a chamada *parece* ter falhado, que é exatamente quando ela
costuma ter dado certo.

Não precisou de migration: `idx_tx_dedup` já existe, único em `(data_source_id, external_id)` com
`external_id IS NOT NULL`. Cada linha recebe:

```
external_id = 'arq:' + sha256(data | valor | sentido | descrição normalizada | conta | ocorrência)
```

> **O prefixo mudou de `mcp:` para `arq:` na Sessão 4.5.A**, e a função mudou de casa (de
> `import-write.ts` para `import-dedup.ts`). Motivo na Decisão 21: a chave tem de ser **a mesma nas
> duas portas de arquivo**, e `mcp:` nomeava o transporte em vez do que a chave identifica. O hash
> **não inclui o prefixo**, então migrar o passado é `UPDATE ... SET external_id = 'arq:' ||
> substr(external_id, 5)` — hoje grátis, porque nenhuma linha com `mcp:` chegou a ser gravada.

**`ocorrencia` é o que faz a coisa funcionar.** Dois cafés de R$ 15 no mesmo dia são dois lançamentos
legítimos e precisam de duas chaves; numerando as repetições na ordem em que aparecem, o mesmo
arquivo reimportado produz exatamente as mesmas N chaves, e um arquivo com 3 linhas iguais produz 3
chaves distintas. Sem isso, ou a dedup mataria lançamento de verdade, ou não existiria.

A busca de duplicatas é por organização inteira, não pela fonte desta origem: o mesmo extrato
importado ontem sob outro nome continua sendo o mesmo lançamento.

`ON CONFLICT DO NOTHING` é a segunda barreira — entre prever e aplicar alguém pode ter importado o
mesmo arquivo pela tela. **O número relatado é o que entrou**, não o que foi prometido.

Efeito colateral que importa: **arquivo grande entra em lotes**, com a mesma origem, e sobreposição
entre lotes não duplica. O teto de 500 linhas por chamada deixa de ser uma limitação e vira um
detalhe de transporte.

### Desfazer continua sendo humano

O plano põe exclusão em massa fora da v1, e isso não mudou. O que a ferramenta devolve é o
`documentId` — `/transacoes` filtra por importação e apaga em lote até 1000. A escapatória existe e
é operada por gente, que é a postura do plano para operação destrutiva.

**Nota sobre `deleteDocument`:** ele **nulifica** `transactions.document_id` e apaga o documento —
não apaga os lançamentos. Vale para qualquer importação, não só as do MCP.

---

## Decisão 21 — O contrato de importação tem dois NÍVEIS, não dois layouts (Sessão 4.5.A)

**Contexto:** o pedido foi *"o arquivo para importar precisa ter um FORMATO PADRONIZADO DE COLUNAS,
podem até estar em branco, mas precisa ter o formato"*. Uma especificação, **três leitores**: a
pessoa que tabula à mão, a IA do MCP que converte qualquer extrato para este formato, e o parser do
app.

### O formato canônico é caminho rápido, nunca requisito

Esta é a cláusula que impede a decisão de se contradizer com a Fase 2. A Fase 2 matou o sistema de
templates registrando que *"LLM lida com qualquer formato sem template"*, e a promessa ao dono de PME
é *"sobe relatório, qualquer formato"*. **A promessa fica de pé:** cabeçalho desconhecido continua
caindo no parser LLM, inalterado. O que muda é que quem **pode** produzir o formato — a IA, o ERP, a
pessoa que baixa o modelo — ganha um caminho determinístico e sem custo de IA.

Os dois não são o mesmo problema:

| | O que a Fase 2 matou | O que a 4.5 constrói |
|---|---|---|
| Direção | o **sistema** infere o formato do arquivo do cliente | o **produtor** escreve no formato do sistema |
| Custo recai sobre | o parser | o artefato |

### Dois níveis: arquivo e linha

O desenho inicial tinha **dois layouts de planilha** — "Movimentos" e "Saldos" — e estava errado. A
migration 0015 já dizia, no próprio comentário, que o BP viria *"via importação de relatórios
classificados como transações com categorias de tipo BP, **igual ao fluxo do DRE**"*.

O balanço não precisa de outras colunas. Precisa que **o arquivo** declare duas coisas que a linha
não carrega:

| Nível | Campos | Quem preenche |
|---|---|---|
| **Arquivo** | origem, `tipoDeRelatorio` (`movimentos` \| `balanco`), `dataDeReferencia`, conta (nome, tipo, número), moeda | o formulário de `/upload` já coleta quase tudo; **o MCP não coletava nada** |
| **Linha** | 17 colunas canônicas, **4 obrigatórias** | o parser, a IA, ou a pessoa |

**Consequência imediata:** `aplicarImportacao` do MCP cravava `reportType: 'other'`, o que tornava
**BP pelo MCP impossível** — e pior, em silêncio, porque `domainFromReportType('other')` devolve
`'dre'` e a camada 0 passa a oferecer só naturezas de DRE.

**Correlato: documento de BP não deduplica.** Reenviar o balanço de janeiro corrigido geraria as
mesmas chaves, a segunda importação deduplicaria inteira, e o documento novo ficaria com zero
linhas — e `getBpAllDates` escolhe o documento **mais recente** da data, que passaria a ser o vazio.
Snapshot se substitui, não se acumula. Daí `deduplica(tipoDeRelatorio)` existir como função, em vez
de a dedup ser incondicional.

### Só duas datas vêm do arquivo

| Data | Coluna | Significa | Regra |
|---|---|---|---|
| **Competência** | `date` | quando o fato econômico ocorreu | obrigatória. Compra no cartão = data da compra |
| **Caixa** | `effective_date` | quando o dinheiro se moveu | opcional. **Em branco = igual à competência.** Compra no cartão = vencimento da fatura |

`created_at` / `updated_at` são de sistema. As datas de `documents` descrevem o **documento**, não a
linha. Era exatamente esta a dúvida que originou a fase, e não estava escrita em lugar nenhum que o
usuário veja.

### A chave de dedup é a mesma nas duas portas — daí o prefixo `arq:`

O prefixo `mcp:` nomeava o **transporte**. Se a tela usasse outro prefixo, subir pela tela o que a IA
importou duplicaria — a dedup ficaria cega justamente entre os dois caminhos que ela existe para
unir. `arq:` nomeia o que a chave identifica: **uma linha que veio de arquivo**, seja qual for a
porta.

### A divisão de arquivos é por onde o código RODA, não por assunto

`src/lib/csv-templates.ts` roda **no navegador** e importa o contrato para gerar a planilha modelo. O
contrato tinha `node:crypto`. **O `tsc --noEmit` passa limpo; o `next build` quebra.** Por isso o
hash mora em `src/lib/import-dedup.ts`, separado de `src/lib/import-contract.ts`, que é isomórfico
(sem `node:crypto`, sem `'use server'`, sem SDK).

É a mesma classe de restrição que criou `src/lib/transactions-page-size.ts` na Fase 5 — lá porque
`'use server'` não deixa exportar constante; aqui porque o bundle do cliente não tem Node.

### A planilha modelo é gerada a partir das colunas, nunca redigitada

`buildImportTemplateCsv(tipo)` monta o cabeçalho a partir de `colunasDe(tipo)`. Redigitar faria
nascer **dois formatos canônicos no primeiro dia**, e a divergência só apareceria quando alguém
usasse o modelo — isto é, no pior momento possível.

### O que foi unificado, e o que ficou separado de propósito

`parseDate` (de `parsers/excel-csv.ts`) e `norm` (de `budget-import.ts`) foram para `format.ts` —
eram a 3ª e a 4ª cópias.

**`normalizeForMatch` de `categorizer.ts` NÃO foi unificada**, e o motivo está escrito no arquivo:
ela decide **classificação**. As outras normalizam para comparar texto; esta escolhe em que natureza
um lançamento cai. Unificá-las faria uma mudança de formatação alterar o resultado contábil.

### Compartilhar a normalização, não o insert

Os quatro `INSERT INTO transactions` (`sync-pluggy`, `approveAndInsert`, `import-write`,
`sync-acquirer`) têm envelopes irreconciliáveis: cursor e memoização do Inngest; lote de 100 com
evento de categorização; `ON CONFLICT` sobre plano prévio. Um `inserirLancamentos()` comum absorveria
os três e viraria o arquivo mais frágil do projeto. **O contrato entrega
`normalizarLancamento(bruto, contexto)` e cada porta mantém o seu `db.insert`.**

### O que NÃO é divergência a normalizar

**`status`.** Pluggy grava `pending` porque nenhum humano viu aquelas linhas — o portão é
`confirmPendingTransactions` em `/contas`. Upload e MCP gravam `confirmed` porque houve aceite
explícito. **Uniformizar faria lançamento de banco entrar na DRE sem revisão.** O contrato declara a
regra e para aí.

**A conta é do DOCUMENTO, não da linha.** Um extrato é de uma conta só; `account_type` e
`account_number` nunca variam entre linhas do mesmo arquivo.

---

### Adendo da 4.5.C — o caminho rápido, e o defeito que ele expôs

O parser de planilha passou a testar o cabeçalho contra o formato publicado **antes** de qualquer
chamada de IA (`canonicalMapping` em `parsers/excel-csv.ts`). Três regras que não podem se perder:

1. **Coluna extra desconhecida não desqualifica.** Export de ERP sempre traz colunas a mais.
2. **Cabeçalho que não casa cai no caminho de hoje, inalterado.** É o que mantém a promessa da
   Fase 2 ao dono de PME.
3. **`extraction_method='template'` mudou de significado.** Era o sistema de fingerprint da Fase 2,
   descartado e sem escritor desde então; agora quer dizer "lido pelo formato canônico, sem IA", e é
   o que `verify-import-contract.ts` conta.

**O defeito que só apareceu ao fechar o laço:** `deriveDirection` comparava a coluna de sentido com
`/^(d|debito|saida|…)/` sobre o texto apenas em minúsculas. `"Saída".toLowerCase()` mantém o acento,
e o regex tem `saida` — **nunca casava**. Toda linha de saída de um CSV que escrevesse a palavra
corretamente saía com `direction: null`, mascarado por três fallbacks (sinal negativo no valor,
`DEFAULT_OUTFLOW_SOURCES` do cartão, e o botão "Marcar todas como Saída" na revisão). Só apareceu
quando a planilha modelo — que escreve "Saída", porque é o certo — foi lida pelo próprio parser.

**A lição, e ela vale além deste arquivo:** o artefato que o produto **oferece** ao usuário tem de
ser exercitado pelo código do produto num teste. A planilha era gerada a partir das colunas (o que
garantia que ela casasse com a *especificação*) e ninguém tinha verificado que ela casava com o
*parser*.

---

## Decisão 22 — Conta manual é uma `data_sources`, não uma tabela nova (Sessão 4.5.B)

**A pergunta que originou a decisão**, do Julio: *"tem que existir um cadastro de contas em algum
lugar, onde está puxando essa lista de contas na página /contas?"*

### A resposta medida: existe cadastro de CONEXÃO, não de conta

| Onde | O quê | Quem escreve | Quem lê |
|---|---|---|---|
| `data_sources` (a linha) | a **conexão** (um item do Pluggy), não a conta | Pluggy, upload, MCP | `/contas`, filtrando `provider='pluggy'` |
| `data_sources.metadata.accounts` | array JSON com as contas daquela conexão | **só** `sync-pluggy-item.ts` | a sub-linha dos cards de `/contas` |
| `transactions.account_id/name/type/number` | 4 colunas de texto, **sem FK** | pluggy, adquirente, MCP | o filtro de `/transacoes`, por `GROUP BY t.account_id` |

**Nada liga o segundo ao terceiro.** `metadata.accounts[].id` e `transactions.account_id` batem
porque o mesmo job escreve os dois; não há FK nem constraint que perceba se divergirem.

Consequências medidas em 24/ago: **13 contas na base, todas do Pluggy**; **7.762 de 7.762**
lançamentos importados por arquivo sem conta nenhuma; e **conta caixa não tinha como existir**,
nem conta corrente que o Open Finance não alcança — o único escritor do array era o sync.

### A escolha: `provider='manual'`, sem tabela nova e sem migration

`data_sources` **já é** "uma fonte de lançamentos" — é o que ela significa para o Pluggy e para o
upload. Uma conta manual é uma fonte cujo sync não existe, e só isso.

O argumento que decidiu: `getDataSourcesWithTransactions` (o filtro de `/transacoes`) já faz
`JOIN data_sources` para pegar o nome da instituição. Com a conta manual sendo uma fonte própria
com `institutionName`, **o rótulo sai certo sem tocar naquela query**. A alternativa — conta só nas
colunas de `transactions` — faria o filtro exibir a palavra **"Banco"** literal, porque `?? 'Banco'`
é o fallback de quem não tem instituição.

O `metadata.accounts` da conta manual usa o **mesmo formato do Pluggy**, de propósito: é o que
`/contas` já sabe desenhar.

### A identidade é o slug do nome, não o texto

`accountId = arq:<slug de norm(nome)>`. É o que faz "Itaú PJ", "itau pj" e "  ITAU PJ  " serem a
mesma conta em arquivos diferentes. Grafias realmente distintas ("Itaú PJ" × "Itaú Pessoa
Jurídica") continuam sendo duas contas — é risco inerente a não ter cadastro forte, e a mitigação é
a tela **oferecer as existentes** antes de aceitar nome novo.

### A conta existente vence no nome

`garantirContaManual` é idempotente, mas **não renomeia**. Importar um arquivo que escreve "caixa"
não pode mudar em silêncio o rótulo "Caixa" que a pessoa vê em `/contas` e no filtro. Tipo e número
só são preenchidos quando faltavam: o arquivo **completa** o cadastro, nunca o sobrescreve.

### Apagar conta com lançamento é recusado, com o número

`transactions.data_source_id` é `NOT NULL` e a FK não tem `ON DELETE` — o banco recusaria de
qualquer forma, com um erro de constraint em vez de uma frase. A alternativa (apagar os lançamentos
junto) transformaria "arrumei o nome da conta" em "apaguei a contabilidade". Há uma segunda barreira
em `try/catch` porque a contagem é fotografia e a FK é a verdade.

### O que esta decisão NÃO faz

Não cria tabela `accounts`, não põe FK em `transactions.account_id`, e **não migra as 13 contas do
Pluggy** de `metadata.accounts` para linhas. Isso seria o cadastro estruturalmente correto — e exige
migration, backfill de 2.594 lançamentos, mudança no sync do Pluggy e reescrita de `/contas`. Fica
como fase própria, com a desconexão entre `metadata.accounts` e `transactions.account_id` registrada
aqui.

---

## Decisão 23 — O app não afirma saldo, e apertar vocabulário publicado custa migration (26/ago)

**O pedido do Julio:** *"na página /fluxo existem indicadores de saldo, coisa que não controlamos no
nosso sistema, e também gráficos baseados em recorrência encontrada; quero retirar esses indicadores
e gráficos; vamos concentrar tudo no dashboard e agora com orçamento não faz sentido essa projeção
baseada em recorrência."*

São **duas decisões independentes** que o mesmo pedido carrega, e vale separá-las porque cada uma
vai reaparecer sozinha.

### 23.1 — Medida de movimento não pode ser apresentada como medida de posição

O "Saldo Atual" do `/fluxo` era:

```sql
SELECT SUM(CASE WHEN direction='inflow' THEN amount ELSE -amount END) FROM transactions
```

Sem corte de data. Sem saldo inicial de conta nenhuma. Numa organização que importou seis meses de
extrato, aquilo era **a soma desses seis meses** — o resultado de caixa do período, exibido com o
rótulo de posição patrimonial. O KPI do dashboard (`kpis.saldoCaixa`) tinha o mesmo defeito,
apenas limitado ao fim do mês de referência.

E os dois **discordavam entre si**: o do `/fluxo` filtrava `hide_in_cashflow = false`, o do
dashboard não. Duas telas do mesmo produto afirmando dois saldos diferentes, nenhum dos quais era o
dinheiro em conta.

**A regra que fica:** o produto só afirma um número quando controla o que ele mede. Saldo bancário
exige saldo inicial ou leitura de posição da instituição — o Pluggy traz isso em
`data_sources.metadata.accounts`, e enquanto ninguém decidir usá-lo como âncora, o app não tem
saldo para mostrar. Somar movimento e chamar de saldo é pior que não mostrar nada, porque o número
parece responder à pergunta.

**Corolário, e é a parte que quase passou batido:** a regra de alerta `saldo-negativo` lia esse
mesmo número. **Alerta é o pior destino possível para uma medida que não mede o que promete** — o
cartão errado informa mal; o alerta errado *interrompe*. Um "saldo em caixa negativo" que na verdade
diz "importei mais saída que entrada" manda o cliente caçar um problema que não existe. Ao remover
um número, procurar quem mais o consome não é higiene: é parte da decisão.

### 23.2 — Projeção estatística morre quando existe projeção declarada

A projeção de 90 dias do `/fluxo` extrapolava o futuro pela média dos intervalos entre ocorrências
passadas. Era a melhor resposta possível **enquanto não havia orçamento**. Desde a Fase 9 há, com
data de competência, data de caixa, versão, responsável e histórico de edição.

Manter as duas produziria **dois futuros na mesma tela, derivados de regras diferentes** — e o
derivado de regra estatística é o que ninguém consegue corrigir, porque não há onde discordar dele.

**O que sobreviveu, e por quê:** a *detecção* de recorrências ≠ a *projeção*. Desde a Sessão 9.5 ela
tem segundo dono: em `/orcamento`, "aceitar recorrências detectadas" a usa para **sugerir o que
orçar**. Ali ela não prevê — preenche um formulário que a pessoa revisa. É o oposto de substituir o
orçamento: é atalho para escrevê-lo. Por isso a função mudou de casa
(`server/fluxo.ts` → `lib/recurrence-detect.ts`) em vez de ser apagada, e `server/fluxo.ts` deixou
de existir: com o último export sem chamador, um arquivo `'use server'` é endpoint HTTP aberto sem
propósito (mesma razão que apagou quatro funções de `server/dashboard.ts` na 5.C).

### 23.3 — Enum validado na LEITURA: apertar o vocabulário exige migration de dados

Esta é a parte que não estava no pedido e teria quebrado a tela do Julio.

Remover a regra `saldo-negativo` obriga a tirá-la de `REGRAS_DE_ALERTA`, em `block-spec.ts`. Mas
aquele enum é validado **nas duas direções** — na escrita e na leitura —, que é a decisão da Sessão
1.4 responsável por uma spec corrompida quebrar só o próprio bloco em vez de derrubar o painel.

E o Zod **materializa o `.default([...])` na gravação**: um bloco `alertas` criado sem escolher
regras não guarda "nenhuma regra escolhida", guarda **a lista inteira por extenso**. Conferido no
banco antes de decidir: 3 painéis materializados, 17 blocos, e os blocos `alertas` carregavam as 8
regras. Apertar o enum sem tocar no gravado transformaria o bloco de alertas de quem personalizou em
bloco com `erroDeSpec`.

**A regra de método:** antes de estreitar qualquer vocabulário publicado (enum de spec, lista de
medidas do motor, tipos de bloco), **consultar o banco pelos valores já gravados**. Se houver, a
migration de dados vai no mesmo commit — não como limpeza, como pré-requisito do deploy.

A migration 0032 não toca estrutura; edita `jsonb`. Duas sentenças, e **a ordem importa**:

1. Apaga a chave `regras` de quem tinha *só* a regra removida. Lista vazia falharia no `.min(1)`;
   sem a chave, o `.default` volta a valer na leitura.
2. Remove o elemento de quem tem outras, preservando a ordem original — reordenar em silêncio é
   ruído numa auditoria.

Invertidas, a primeira já teria zerado a lista e a segunda não teria como distinguir os casos.
Nenhum bloco de hoje cai no caso 1; a sentença existe porque a spec **permite** escolher regras, e
uma escrita futura pelo MCP poderia ter escolhido só aquela.

**Aplicada e conferida em 26/ago**, e a conferência reforçou o ponto de um jeito não previsto. A
asserção "todo bloco `alertas` carrega as 7 regras" **falhou** — um bloco criado pelo expert via
MCP tinha três (`lucro-negativo`, `despesas-alta`, `receita-queda`). O erro era da asserção, não da
migration: lista parcial é o uso que a spec permite, e é exatamente o que a 2ª sentença trata. Vale
registrar porque a asserção errada era a **otimista**: ela teria passado em silêncio enquanto todos
os blocos viessem do painel padrão, e só quebraria depois que alguém personalizasse. Ao conferir
dado escrito por um LLM, **assuma que ele usou a liberdade que a spec oferece**.

### O que NÃO muda

**Painel já materializado não é reescrito.** O padrão caiu de 8 para 7 blocos, mas quem personalizou
continua com os blocos que escolheu — reescrever o painel de alguém para acompanhar o padrão seria
desfazer trabalho que a pessoa fez. Medido: os dois painéis "Visão geral" do banco já estavam com 7
blocos e nenhum de saldo, porque o Julio já havia removido o cartão à mão pelo Organizar.

**A janela `acumulado` continua no schema.** Nenhum bloco do padrão a usa agora, mas ela é
capacidade genérica dos blocos e segue alcançável pelo expert via MCP. Por isso o teste que a
provava não foi apagado junto com o bloco — foi reescrito sobre uma spec montada à mão. Capacidade
publicada sem teste é capacidade que ninguém sabe se responde.

---

## Decisão 24 — O selo de visibilidade herda do pai (26/ago)

**O que Julio pediu:** *"faça um levantamento se eu posso deixar em branco o selo capex/opex das
categorias financeiras... eu tenho categorias de transferências; e elas não devem aparecer em
análises, nem dre, nem fc, nem opex, nem capex."*

O levantamento mostrou que a pergunta e o problema eram coisas diferentes, e que havia um defeito.

### O selo OPEX/CAPEX não é o mecanismo — e por isso não precisa ficar em branco

`opex_capex` é lido em **um lugar só**: o `/fluxo`, do PAI, para decidir se o ramo entra na seção
OPEX ou na CAPEX. DRE, Balanço, dashboard e orçamento não o leem. É selo de **seção**, não de
**exclusão** — deixá-lo vazio faria a categoria continuar aparecendo, só sem saber onde ficar.

Fica como está: `NOT NULL DEFAULT 'opex'`, e só na linha do pai na tela — que é o único lugar onde
o valor é consultado. O motor já publica `opex_capex` como agrupamento, com `rotuloVazio: 'Não
classificado'` previsto, então se um dia a coluna admitir nulo o motor já sabe o que dizer.

### O defeito: o selo do PAI era inerte, sempre

A tela oferece os botões **DRE** e **FC** nas duas linhas da árvore. O do pai salvava, mudava de
cor e **não afetava número nenhum**.

A causa é estrutural: só Natureza Filho recebe lançamento — conferido no banco, **zero lançamentos
em categoria de nível 1** nas seis organizações — e as cinco leituras consultavam o selo da
categoria DO LANÇAMENTO. Um selo que só existe no pai nunca era alcançado.

Julio encontrou marcando "Devoluções" como oculta no fluxo e vendo o ramo continuar na tela: os 26
lançamentos estavam no filho "Devolução de pagamentos (+)". As "Transferências entre contas" tinham
sumido porque ali ele marcara os **filhos**.

**A regra agora:** uma categoria entra na leitura quando **nem ela nem o pai dela** estão ocultos
naquele regime. `lib/category-visibility.ts` a escreve uma vez; as cinco leituras a importam
(`dre.ts`, `fluxo-mensal.ts`, `budget-read.ts`, e as fontes `realizado` e `orcado` do motor).

**Por que `EXISTS` com alias próprio e não a coluna qualificada:** Decisão 18. O Drizzle só
qualifica a coluna quando a consulta tem join, e dentro de subconsulta correlacionada uma coluna
sem qualificação é capturada pelo escopo interno — a correlação vira constante, **sem erro**. Já
mordeu três vezes. Aqui o alias externo entra como string via `sql.raw` (o padrão de
`dimensionFilters`) e o interno é `cat_pai`, que não colide com alias nenhum das chamadoras. O
`EXISTS` também dispensa join do pai, o que importa no motor, onde a consulta nem sempre agrupa por
natureza pai.

**Um salto basta:** a árvore tem dois níveis de LINHA (Tipo é coluna, não linha), conferido no banco
antes de escrever. Nada de CTE recursiva.

### O que o teste provou, e o que ele encontrou

`scripts/verify-category-visibility.ts`, 22/22 — incluindo os dois sentidos: ocultar o pai tira o
ramo **e** não mexe no outro regime; ocultar um filho tira só ele; pai oculto vence filho
explicitamente visível.

A parte que dá confiança é a **conciliação contra as organizações reais**: onde não há pai oculto, o
predicado novo devolve exatamente o que o antigo devolvia. **Cinco das seis organizações idênticas**;
só "Financeiro Pessoal" muda, em 31 lançamentos, e os dois pais ocultos que explicam a diferença são
nomeados na saída. Uma correção de regra de leitura que mudasse número de cliente sem explicação
seria pior que o defeito.

**O teste encontrou uma divergência legítima em `verify-query-engine.ts`:** a réplica de
`fetchBudgetRows` escrita à mão fixava a regra antiga, então o motor (correto) e a réplica (velha)
discordavam justamente em "Devolução de pagamentos (+)". As réplicas de teste foram atualizadas
**com `JOIN`**, e não com o helper — duas formulações independentes de SQL concordando valem mais
que a implementação repetida contra si mesma.

### O que NÃO mudou, por decisão de Julio

**`type = 'transfer'` continua apenas semântico.** Foi oferecido excluí-lo das análises por padrão,
e a resposta foi *"não — sigo marcando à mão"*. Motivo prático: a ZARUR tem 123 lançamentos de
transfer hoje visíveis, e um padrão novo mudaria os números dela sem ninguém pedir. A DRE segue
mostrando `transfer` **abaixo da linha**, no bloco "Variação de Caixa", onde não contamina o Lucro
Líquido.

**As transferências não fecham em zero** (+29.680 no período do print, +46.738 na base da Financeiro
Pessoal; −212.657 na ZARUR). Levantado e **deixado como está**, a pedido: *"não vai fechar, eu não
tenho todas as contas registradas"*. Fica registrado para que ninguém trate o desequilíbrio como
defeito no futuro.

### 24.1 — O objetivo real era um gráfico, e a causa era descoberta

Só depois de tudo entregue Julio contou **por que** queria o selo em branco: *"o claude.ai falou que
não pode montar um gráfico usando as classificações opex/capex porque está puxando as
transferências"*. A pergunta que ele fez era sobre o meio; o fim era outro.

E o fim **já estava resolvido** pelo que a Decisão 24 entregou — medido na base real, agrupando por
`opex_capex` no período do print:

| filtro | CAPEX líquido | lançamentos |
|---|---:|---:|
| `visibilidade: 'todas'` (o padrão, o que o expert usou) | −50.572,86 | 131 |
| `visibilidade: 'caixa'` | **−88.528,41** | **20** |

O segundo número é exatamente o total de "Investimentos Financeiros e Patrimoniais" da tela. As 111
linhas de transferência e devolução saem, e o CAPEX passa a ser investimento de verdade.

**A causa de o expert não conseguir era de DESCOBERTA, não de capacidade** — a mesma classe dos
achados 7 e 9 do hardening. `spec.ts` não tinha **uma única `.describe()`**: toda a documentação dos
filtros estava em JSDoc, e `z.toJSONSchema` publica apenas o que vem de `.describe()`. O modelo
recebia `visibilidade` como o enum cru `['dre','caixa','todas']`, sem uma palavra sobre o que
significavam. Ele tinha a ferramenta na mão e nenhuma pista de que era ela.

Corrigido em `visibilidade`, `excluirBalanco` e `agruparPor`, este último dizendo explicitamente que
`opex_capex` vem da natureza PAI e precisa do filtro de visibilidade.

**A regra que fica, e ela é geral:** documentação que não chega ao modelo é documentação que não
existe — e nada quebra quando ela some, porque o schema segue válido. Por isso `verify-query-engine`
ganhou uma seção que **afirma sobre o JSON Schema publicado**, não sobre o código-fonte. Sem essa
asserção, remover uma `.describe()` seria uma regressão invisível.

**E a lição de método:** eu respondi à pergunta literal ("posso deixar em branco?") com um
levantamento correto, e só descobri o objetivo depois. Perguntar *para que serve* teria chegado ao
mesmo lugar por um caminho mais curto — embora o defeito do selo do pai, que o caminho longo achou,
fosse real e valesse a viagem.
