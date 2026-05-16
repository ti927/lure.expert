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
