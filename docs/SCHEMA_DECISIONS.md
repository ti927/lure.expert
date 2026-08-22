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

A detecção do `/fluxo` trabalha em **dias** (agrupa por descrição nos últimos 180 dias e aceita
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
