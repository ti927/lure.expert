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
