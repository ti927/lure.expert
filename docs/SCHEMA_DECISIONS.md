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
- `date`, `amount`, `direction`, `description` — campos mapeados pela heurística do parser
- `status` — `pending` | `approved` | `rejected`

**Regra de direção por source_type:**
- `credit_card` → todas as linhas forçadas como `outflow`
- Outros tipos → direção inferida por heurística (sinal do valor ou colunas crédito/débito)
- Extensível via `FORCE_OUTFLOW_SOURCES` em `src/jobs/process-document.ts`

**Migration:** `db/migrations/rls/0007_transactions_staging.sql`
**Schema Drizzle:** `db/schema/transactions-staging.ts`

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
