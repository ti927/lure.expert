# Rateio de natureza — Sessões 1 e 2 (leituras + migration) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a parte do rateio passa a carregar natureza própria, sem que nenhum número de DRE, fluxo, dashboard ou balanço mude para quem não rateou natureza.

**Architecture:** Sessão 1 faz as 10 leituras que ainda leem `transactions` passarem pela view `transaction_lines` (ou por `EXISTS` nela) — enquanto a 0033 não existe a view devolve a natureza do lançamento, então tudo fica idêntico e é conciliável. Sessão 2 aplica a migration 0033 (natureza na parte, origem vazia, gatilho e view) e ensina as escritas (rateio, classificação, categorizador) a respeitar a regra nova.

**Tech Stack:** Next.js 14 · Drizzle 0.45 (postgres-js) · Postgres 17 (Supabase) · Zod · scripts `tsx` de verificação contra o banco (o projeto não tem framework de teste — o padrão é `scripts/verify-*.ts` com placar `N/N`).

**Spec:** `docs/superpowers/specs/2026-09-29-rateio-de-natureza-design.md`

**Fora deste plano:** Sessão 3 (telas) e Sessão 4 (MCP + docs) ganham plano próprio depois que esta estiver verificada — dependem de componentes que só valem ser lidos com o modelo pronto.

## Global Constraints

- **Nada vai para `main` nem para produção.** Todo commit na branch `feat/rateio-natureza`; `git push origin feat/rateio-natureza` ao fim de cada tarefa (regra de backup do CLAUDE.md, adaptada à decisão do Julio de 29/set: "pode desenvolver mas não sobe"). A migration **não** é aplicada no Supabase de produção — só no banco local.
- **Todo teste que escreve roda contra o banco LOCAL** (Tarefa 0), nunca o de produção. Leitura de conciliação também roda no local (dump de 29/set, idêntico à produção naquele momento).
- Tudo em português (código, comentários, mensagens). Nunca "IA"/"assistente" em texto do produto — "expert".
- Regra analítica × operacional (CLAUDE.md, Fase 1): analítica lê `transaction_lines` e conta com `COUNT(DISTINCT transaction_id)`; operacional lê `transactions` e filtra dimensão com `dimensionExistsFilter`.
- **Decisão 18:** dentro de subconsulta correlacionada, nunca `${tabela.coluna}` em posição de SELECT sem join — usar `${tabela}.coluna` ou alias explícito em SQL cru.
- Editar arquivos só com Edit/Write — PowerShell 5.1 corrompe acentos.
- Não editar o `.env.local` do Julio. Sobrescrever `DATABASE_URL` só na execução.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Lançamento rateado cuja origem não tem natureza** (existe 1 hoje) — continua contando como "sem natureza" antes e depois da 0033; teste na Tarefa 13.
2. **Remover o rateio** (lista vazia) de um lançamento cujas partes tinham a mesma natureza — a natureza volta para o lançamento, senão ele cai em "sem natureza" sem ninguém pedir; teste na Tarefa 10.
3. **Remover o rateio com partes de naturezas diferentes** — a origem fica sem natureza (lacuna visível) e volta à fila de categorização; teste na Tarefa 10.
4. **Chamador antigo (tela e MCP ainda não atualizados) grava rateio sem mandar `categoryId`** — a parte herda a natureza do lançamento, e o comportamento de hoje é preservado; teste na Tarefa 10.
5. **"Categorizar agora" com lançamento rateado sem natureza** — não é enviado ao expert nem sobrescrito; teste na Tarefa 12.

---

## Mapa de arquivos

| Arquivo | Sessão | Responsabilidade |
|---|---|---|
| `scripts/local-db.sh` (novo) | 0 | sobe/derruba o Postgres local restaurado do dump |
| `src/lib/sql-dimensions.ts` | 1 | `DimensionColumn` ganha `category_id`; `semNaturezaFilter` |
| `src/lib/dashboard/kpis.ts`, `indicators.ts` | 1 | leem a view |
| `src/lib/balance-sheet-read.ts` (novo) | 1 | miolo SQL do Balanço, fora de `'use server'` |
| `src/server/balance-sheet.ts` | 1 | vira casca sobre o anterior |
| `src/lib/budget-copy.ts` | 1 | `semCat`/`inativas` pela view |
| `src/lib/recurrence-detect.ts` | 1 | ocultação por linha |
| `src/lib/category-usage.ts` (novo) | 1 | contagem de uso de natureza (corrige Decisão 18) |
| `src/server/categories.ts` | 1 | usa o anterior |
| `src/lib/rules-write.ts`, `src/lib/mcp/tools.ts` | 1 | "sem natureza" pela view |
| `src/server/transactions.ts`, `src/server/review.ts` | 1 | filtro de natureza por `EXISTS` |
| `scripts/verify-rateio-natureza-leituras.ts` (novo) | 1 | conciliação antigo × novo |
| `db/migrations/rls/0033_rateio_de_natureza.sql` + `0033_down.sql` (novos) | 2 | a migration e a reversa |
| `scripts/verify-migration-0033.ts` (novo) | 2 | valida ida e volta com ROLLBACK |
| `db/schema/transaction-allocations.ts`, `allocation-templates.ts` | 2 | coluna `categoryId` |
| `src/lib/allocations-write.ts` | 2 | natureza por parte, padrão, validação, remoção |
| `src/lib/transactions-write.ts`, `src/server/transactions.ts` | 2 | classificação recusa rateado |
| `src/jobs/categorize-transaction.ts` | 2 | ignora rateado |
| `scripts/verify-rateio-natureza-escrita.ts` (novo) | 2 | escritas + conciliação antes/depois da 0033 |

---

## Tarefa 0: Banco local restaurado do dump

**Files:**
- Create: `scripts/local-db.sh`

**Interfaces:**
- Produces: Postgres em `localhost:55432`, usuário `postgres`, senha `local`, banco `postgres`, com o dump de 29/set restaurado. Todas as tarefas seguintes usam `LOCAL_URL=postgresql://postgres:local@localhost:55432/postgres`.

- [ ] **Step 1: Escrever o script**

```bash
#!/usr/bin/env bash
# Banco LOCAL para desenvolver e testar sem tocar a produção.
#
#   bash scripts/local-db.sh up     # cria o contêiner e restaura o dump
#   bash scripts/local-db.sh down   # apaga o contêiner (o dump fica)
#
# O dump mora FORA do repositório (tem dado de cliente): por padrão
# C:/Users/Julio/backups/lure-expert/. Sobrescreva com DUMP=/caminho/arquivo.dump.
# Usa pgvector/pgvector:pg17 porque a imagem postgres padrão não tem a extensão
# `vector`, e sem ela `transactions` não é criada (erro visto em 29/set).
set -euo pipefail
NOME=lure-local
PORTA=55432
DUMP="${DUMP:-C:/Users/Julio/backups/lure-expert/lure-expert-2026-09-29-antes-rateio-natureza.dump}"
PASTA=$(dirname "$DUMP"); ARQ=$(basename "$DUMP")

case "${1:-}" in
  up)
    docker rm -f "$NOME" >/dev/null 2>&1 || true
    MSYS_NO_PATHCONV=1 docker run -d --name "$NOME" -p "$PORTA:5432" \
      -e POSTGRES_PASSWORD=local -v "$PASTA:/out" pgvector/pgvector:pg17 >/dev/null
    for i in $(seq 1 60); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
    sleep 2
    # Papéis que o dump do Supabase referencia; sem eles as policies não restauram.
    MSYS_NO_PATHCONV=1 docker exec "$NOME" sh -c '
      for r in anon authenticated service_role supabase_admin supabase_auth_admin \
               supabase_storage_admin authenticator dashboard_user pgbouncer \
               supabase_realtime_admin supabase_replication_admin supabase_read_only_user; do
        psql -U postgres -qc "create role $r" 2>/dev/null || true
      done'
    MSYS_NO_PATHCONV=1 docker exec "$NOME" pg_restore -U postgres -d postgres \
      --no-owner --no-privileges "/out/$ARQ" 2>&1 | grep -c "error:" || true
    MSYS_NO_PATHCONV=1 docker exec "$NOME" psql -U postgres -Atc \
      "select count(*)||' lançamentos, '||(select count(*) from transaction_allocations)||' partes' from transactions"
    ;;
  down) docker rm -f "$NOME" ;;
  *) echo "uso: $0 up|down"; exit 1 ;;
esac
```

- [ ] **Step 2: Subir e conferir**

Run: `bash scripts/local-db.sh up`
Expected: `3` (erros só de extensões exclusivas do Supabase: vault, pg_stat_statements…) e `13269 lançamentos, 117 partes`.

- [ ] **Step 3: Conferir que o app enxerga o banco local**

Run:
```bash
DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres npx tsx --env-file=.env.local -e "import('@/db').then(async ({db})=>{const {sql}=await import('drizzle-orm');console.log(await db.execute(sql\`select count(*) from transaction_lines\`));process.exit(0)})"
```
Expected: uma linha com `count` = 13332 (13.269 − 54 rateados + 117 partes). Se o `-e` não resolver o alias `@/`, rodar o mesmo SELECT num script de uma linha em `scripts/`.

- [ ] **Step 4: Commit**

```bash
git add scripts/local-db.sh
git commit -m "chore: banco local restaurado do dump, para desenvolver sem tocar a producao"
git push origin feat/rateio-natureza
```

---

# SESSÃO 1 — as leituras passam pela view (sem migration)

**Princípio de verificação da sessão:** enquanto a 0033 não existe, `transaction_lines.category_id` é sempre o `category_id` do lançamento. Então **toda** leitura migrada tem de devolver exatamente o que devolvia. O script da Tarefa 7 roda a versão antiga (SQL copiado verbatim do commit `1dc9469`, a tag de backup) contra a nova, em todas as organizações do banco local.

## Tarefa 1: `semNaturezaFilter` e natureza como coluna de `EXISTS`

**Files:**
- Modify: `src/lib/sql-dimensions.ts:58-59` e fim do arquivo

**Interfaces:**
- Produces:
  - `type DimensionColumn = 'cost_center_id' | 'business_unit_id' | 'legal_entity_id' | 'contact_id' | 'category_id'`
  - `dimensionExistsFilter(txIdColumn, 'category_id', f)` — já existente, passa a aceitar natureza
  - `semNaturezaFilter(txIdColumn: SQL): SQL` — "alguma linha do lançamento está sem natureza"

- [ ] **Step 1: Estender o tipo**

Em `src/lib/sql-dimensions.ts`, substituir:

```ts
export type DimensionColumn =
  | 'cost_center_id' | 'business_unit_id' | 'legal_entity_id' | 'contact_id'
```

por:

```ts
/**
 * As colunas que um filtro pode perguntar às LINHAS de um lançamento. Natureza
 * entrou em 29/set (rateio de natureza): com rateio ela vive nas partes, então
 * a pergunta "tem esta natureza?" é sobre as linhas, como já era para as quatro
 * dimensões.
 */
export type DimensionColumn =
  | 'cost_center_id' | 'business_unit_id' | 'legal_entity_id' | 'contact_id'
  | 'category_id'
```

- [ ] **Step 2: Acrescentar `semNaturezaFilter` ao fim do arquivo**

```ts
/**
 * "Sem natureza", dito sobre as LINHAS: o lançamento tem alguma linha sem
 * natureza. Sem rateio é exatamente `category_id IS NULL`; com rateio, basta
 * uma parte sem natureza para o lançamento pedir classificação.
 *
 * Passe a coluna JÁ QUALIFICADA (`sql\`${transactions}.id\`` ou `sql.raw('t.id')`)
 * — ver a nota da Decisão 18 acima.
 */
export function semNaturezaFilter(txIdColumn: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM transaction_lines tl
    WHERE tl.transaction_id = ${txIdColumn}
      AND tl.category_id IS NULL
  )`
}
```

- [ ] **Step 3: Conferir o tipo**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sql-dimensions.ts
git commit -m "feat(rateio): natureza entra nos filtros que perguntam as linhas do lancamento"
git push origin feat/rateio-natureza
```

## Tarefa 2: KPIs e indicadores leem a view

**Files:**
- Modify: `src/lib/dashboard/kpis.ts:108-126`
- Modify: `src/lib/dashboard/indicators.ts:53-110`

**Interfaces:**
- Consumes: nada novo. `calcularKpisDoMes` e `calcularIndicadores` mantêm assinatura.

- [ ] **Step 1: `kpis.ts`** — na `monthQuery`, trocar

```ts
      COUNT(*)::text AS tx_count
    FROM transactions t
```

por

```ts
      -- DISTINCT: a view devolve uma linha por parte, e o campo conta lançamentos.
      COUNT(DISTINCT t.transaction_id)::text AS tx_count
    -- Pela view: com rateio de natureza (29/set) cada parte tem a sua, e ler
    -- `transactions` jogaria o valor inteiro na natureza do lançamento — que,
    -- rateado, é vazia. As somas são idênticas enquanto ninguém rateia natureza.
    FROM transaction_lines t
```

- [ ] **Step 2: `indicators.ts`** — nas TRÊS queries, trocar `FROM transactions t` por `FROM transaction_lines t`, e acima da primeira acrescentar:

```ts
    // As três leituras passam pela view desde o rateio de natureza (29/set): com
    // rateio a natureza vive nas partes. Nenhuma usa `t.id`, e as colunas lidas
    // (amount, direction, date, status, category_id) existem na view.
```

- [ ] **Step 3: Conferir tipos**

Run: `npx tsc --noEmit -p .`
Expected: sem erros. (A conciliação numérica é a Tarefa 7.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/dashboard/kpis.ts src/lib/dashboard/indicators.ts
git commit -m "feat(rateio): KPIs e indicadores do dashboard leem as linhas do rateio"
git push origin feat/rateio-natureza
```

## Tarefa 3: Balanço sai de `'use server'` e lê a view

**Files:**
- Create: `src/lib/balance-sheet-read.ts`
- Modify: `src/server/balance-sheet.ts:50-73` e `:181-208`

**Interfaces:**
- Produces:
  - `lerLinhasDoBalanco(organizationId: string, documentId: string, exec?: Exec): Promise<BpRowRaw[]>` com `BpRowRaw = { childId; childName; childCode: string|null; parentId; parentName; parentCode: string|null; parentType: string; total: number }`
  - `somarBalancoPorDocumento(organizationId: string, docIds: string[], exec?: Exec): Promise<{ documentId: string; categoryId: string; total: number }[]>`

- [ ] **Step 1: Criar `src/lib/balance-sheet-read.ts`**

```ts
// O SQL do Balanço, fora de `'use server'` — para ser exercitável por script e
// conciliável contra a versão antiga. `server/balance-sheet.ts` é casca.
//
// Lê `transaction_lines` desde o rateio de natureza (29/set): com rateio a
// natureza vive nas partes. Um balanço é fotografia por documento e raramente é
// rateado, mas a regra é uma só — ler `transactions` aqui voltaria a atribuir o
// valor inteiro à natureza (vazia) do lançamento.

import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { BP_TYPES } from '@/lib/bp-types'

type Exec = Pick<typeof db, 'execute'>

const LISTA_BP = sql.join(BP_TYPES.map(t => sql`${t}`), sql`, `)

export interface BpRowRaw {
  childId: string
  childName: string
  childCode: string | null
  parentId: string
  parentName: string
  parentCode: string | null
  parentType: string
  total: number
}

/** As somas por Natureza Filho de UM documento de balanço. */
export async function lerLinhasDoBalanco(
  organizationId: string,
  documentId: string,
  exec: Exec = db,
): Promise<BpRowRaw[]> {
  const rows = await exec.execute<{
    child_id: string; child_name: string; child_code: string | null
    parent_id: string; parent_name: string; parent_code: string | null
    parent_type: string; total: string | null
  }>(sql`
    SELECT c.id::text AS child_id, c.name AS child_name, c.code AS child_code,
           p.id::text AS parent_id, p.name AS parent_name, p.code AS parent_code,
           p.type AS parent_type, SUM(tl.amount)::text AS total
      FROM transaction_lines tl
      JOIN categories c ON tl.category_id = c.id
      JOIN categories p ON c.parent_id    = p.id
     WHERE tl.document_id     = ${documentId}::uuid
       AND tl.organization_id = ${organizationId}::uuid
       AND p.type IN (${LISTA_BP})
     GROUP BY c.id, c.name, c.code, p.id, p.name, p.code, p.type
     ORDER BY p.code, c.code
  `)
  return rows.map(r => ({
    childId: r.child_id, childName: r.child_name, childCode: r.child_code,
    parentId: r.parent_id, parentName: r.parent_name, parentCode: r.parent_code,
    parentType: r.parent_type, total: Number(r.total ?? 0),
  }))
}

/** As somas por (documento, natureza) de vários documentos — a tabela multi-data. */
export async function somarBalancoPorDocumento(
  organizationId: string,
  docIds: string[],
  exec: Exec = db,
): Promise<{ documentId: string; categoryId: string; total: number }[]> {
  if (docIds.length === 0) return []
  const rows = await exec.execute<{ document_id: string; category_id: string; total: string | null }>(sql`
    SELECT tl.document_id::text AS document_id, tl.category_id::text AS category_id,
           SUM(tl.amount)::text AS total
      FROM transaction_lines tl
     WHERE tl.organization_id = ${organizationId}::uuid
       AND tl.document_id IN (${sql.join(docIds.map(id => sql`${id}::uuid`), sql`, `)})
       AND tl.category_id IS NOT NULL
     GROUP BY tl.document_id, tl.category_id
  `)
  return rows.map(r => ({ documentId: r.document_id, categoryId: r.category_id, total: Number(r.total ?? 0) }))
}
```

Nota: o `ORDER BY p.code, c.code` antigo era do Drizzle sobre as mesmas colunas — mesma ordenação.

- [ ] **Step 2: `getBpData` vira casca** — em `src/server/balance-sheet.ts`, substituir o bloco `const rows = await db.select({...}).from(transactions)...orderBy(parent.code, categories.code)` e o `rows.map(...)` do retorno por:

```ts
  const rows = await lerLinhasDoBalanco(organizationId, latestDoc.id)

  return {
    referenceDate: latestDoc.referenceDate,
    documentId: latestDoc.id,
    rows: rows.map(r => ({ ...r, parentType: r.parentType as BpType })),
  }
```

e remover `const parent = alias(categories, 'parent')` do início da função.

- [ ] **Step 3: `getBpAllDates`** — substituir o `const sums = await db.select({...}).from(transactions)...groupBy(...)` por:

```ts
    const sums = await somarBalancoPorDocumento(organizationId, docIds)
```

(o laço seguinte já lê `row.documentId`, `row.categoryId`, `row.total`.)

- [ ] **Step 4: Imports** — acrescentar `import { lerLinhasDoBalanco, somarBalancoPorDocumento } from '@/lib/balance-sheet-read'`; remover de `drizzle-orm` e do schema o que o `tsc`/lint acusar sem uso (`transactions`, `sum`, `alias` se não houver outro uso no arquivo — o drill-down na linha ~351 usa SQL cru, conferir).

Run: `npx tsc --noEmit -p . && npx next lint --file src/server/balance-sheet.ts --file src/lib/balance-sheet-read.ts`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/balance-sheet-read.ts src/server/balance-sheet.ts
git commit -m "feat(rateio): o Balanco le as linhas do rateio, com o SQL fora de use server"
git push origin feat/rateio-natureza
```

## Tarefa 4: Copiar do realizado e recorrências

**Files:**
- Modify: `src/lib/budget-copy.ts:375-397`
- Modify: `src/lib/recurrence-detect.ts:74-86`

- [ ] **Step 1: `semCat` e `inativas` pela view** — em `budget-copy.ts`, nas duas queries trocar `SELECT COUNT(*)::int AS count` por `SELECT COUNT(DISTINCT t.transaction_id)::int AS count` e `FROM transactions t` por `FROM transaction_lines t`, com o comentário acima de `semCat`:

```ts
  // Pela view, como a query principal: com rateio de natureza (29/set) uma parte
  // pode estar sem natureza enquanto as outras têm. `total` soma as PARTES sem
  // natureza, e `count` conta lançamentos — é o que a prévia promete.
```

- [ ] **Step 2: Recorrência ocultada por linha** — em `recurrence-detect.ts`, remover `LEFT JOIN categories c ON t.category_id = c.id` e trocar

```sql
        AND (c.id IS NULL OR c.hide_in_cashflow = false)
```

por

```sql
        -- A recorrência é da DESCRIÇÃO do lançamento inteiro; a natureza só
        -- decide se ele fica de fora. Desde o rateio de natureza (29/set) ela
        -- vive nas linhas: basta uma linha em natureza oculta no fluxo para o
        -- lançamento sair. Sem rateio é exatamente a regra anterior.
        AND NOT EXISTS (
          SELECT 1 FROM transaction_lines tl
          JOIN categories c ON c.id = tl.category_id
          WHERE tl.transaction_id = t.id AND c.hide_in_cashflow = true
        )
```

(`hide_in_cashflow` é `NOT NULL DEFAULT false` desde a 0017, então `= true` equivale ao `= false` antigo invertido.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/budget-copy.ts src/lib/recurrence-detect.ts
git commit -m "feat(rateio): copiar do realizado e recorrencias leem as linhas do rateio"
git push origin feat/rateio-natureza
```

## Tarefa 5: Uso de natureza — e o defeito da Decisão 18

**Contexto:** `getCategories` calcula `txCount` com `WHERE category_id = ${categories.id}` numa consulta **sem join**; o Drizzle emite `"id"` sem qualificar e o escopo interno (`transactions.id`) captura a coluna. Medido em 29/set com `toSQL()`: `category_id = "id"` — **o contador de uso das naturezas vive em zero**. Terceira mordida da Decisão 18.

**Files:**
- Create: `src/lib/category-usage.ts`
- Modify: `src/server/categories.ts:69-73` e `:184-189`

**Interfaces:**
- Produces:
  - `contarUsoPorNatureza(organizationId: string, exec?: Exec): Promise<Map<string, number>>` — lançamentos distintos por natureza (partes contam)
  - `contarUsoDaNatureza(organizationId: string, categoryId: string, exec?: Exec): Promise<number>`

- [ ] **Step 1: Criar `src/lib/category-usage.ts`**

```ts
// Quantos lançamentos usam cada natureza. Pela view, porque com rateio de
// natureza (29/set) a natureza vive nas partes — contar só `transactions`
// autorizaria apagar natureza em uso numa parte.
//
// Substitui o subselect de `getCategories`, que tinha o defeito da Decisão 18:
// `${categories.id}` numa consulta sem join virava `"id"` sem qualificação,
// capturado por `transactions.id`, e o contador vivia em ZERO.

import { sql } from 'drizzle-orm'
import { db } from '@/db'

type Exec = Pick<typeof db, 'execute'>

export async function contarUsoPorNatureza(
  organizationId: string,
  exec: Exec = db,
): Promise<Map<string, number>> {
  const rows = await exec.execute<{ category_id: string; n: number }>(sql`
    SELECT tl.category_id::text AS category_id, COUNT(DISTINCT tl.transaction_id)::int AS n
      FROM transaction_lines tl
     WHERE tl.organization_id = ${organizationId}::uuid
       AND tl.category_id IS NOT NULL
     GROUP BY tl.category_id
  `)
  return new Map(rows.map(r => [r.category_id, Number(r.n)]))
}

export async function contarUsoDaNatureza(
  organizationId: string,
  categoryId: string,
  exec: Exec = db,
): Promise<number> {
  const [r] = await exec.execute<{ n: number }>(sql`
    SELECT COUNT(DISTINCT tl.transaction_id)::int AS n
      FROM transaction_lines tl
     WHERE tl.organization_id = ${organizationId}::uuid
       AND tl.category_id     = ${categoryId}::uuid
  `)
  return Number(r?.n ?? 0)
}
```

- [ ] **Step 2: `getCategories`** — remover o campo `txCount: sql<number>\`(...)\`` do select, e antes do `return rows.sort(numericCodeSort)` fazer:

```ts
  const uso = await contarUsoPorNatureza(organizationId)
  return rows.map(r => ({ ...r, txCount: uso.get(r.id) ?? 0 })).sort(numericCodeSort)
```

(conferir que `numericCodeSort` aceita o objeto com `txCount` — o tipo de retorno segue igual.)

- [ ] **Step 3: `deleteCategory`** — substituir o bloco `const [{ txCount }] = await db.select({ txCount: count() }).from(transactions)...` por:

```ts
  const txCount = await contarUsoDaNatureza(organizationId, id)
```

Remover imports sem uso apontados pelo lint.

- [ ] **Step 4: Commit**

```bash
git add src/lib/category-usage.ts src/server/categories.ts
git commit -m "fix(categorias): contagem de uso vivia em zero (Decisao 18) e passa a contar partes do rateio"
git push origin feat/rateio-natureza
```

## Tarefa 6: "Sem natureza" e filtro de natureza nas telas operacionais

**Files:**
- Modify: `src/lib/rules-write.ts:434-444`
- Modify: `src/lib/mcp/tools.ts:134-142`
- Modify: `src/server/transactions.ts:84-85`
- Modify: `src/server/review.ts:56-65`

- [ ] **Step 1: `contarAlcance`** — trocar

```sql
           COUNT(t.id) FILTER (WHERE t.category_id IS NULL)::int AS sem_natureza
```

por

```sql
           COUNT(t.id) FILTER (WHERE ${semNaturezaFilter(sql.raw('t.id'))})::int AS sem_natureza
```

com `import { semNaturezaFilter } from '@/lib/sql-dimensions'`.

- [ ] **Step 2: `descrever_organizacao`** — trocar

```ts
        semNatureza: sql<number>`COUNT(*) FILTER (WHERE ${transactions.categoryId} IS NULL)::int`,
```

por

```ts
        // `${transactions}.id` e NÃO `${transactions.id}`: consulta sem join, e
        // dentro do EXISTS o `"id"` cru seria capturado pela view (Decisão 18).
        semNatureza: sql<number>`COUNT(*) FILTER (WHERE ${semNaturezaFilter(sql`${transactions}.id`)})::int`,
```

- [ ] **Step 3: `/transacoes`** — trocar

```ts
  const catFilter = buildMultiFilterCondition(transactions.categoryId, parseMultiFilter(category))
```

por

```ts
  // Natureza pergunta às LINHAS, como as dimensões: com rateio ela vive nas partes.
  const catFilter = dimensionExistsFilter(transactions.id, 'category_id', parseMultiFilter(category))
```

(Se `buildMultiFilterCondition` ficar sem outro uso, remover; o lint aponta.)

- [ ] **Step 4: fila de revisão** — substituir o bloco `if (filters.category) { ... }` por:

```ts
    if (filters.category) {
      const ids = filters.category.split(',').filter(Boolean)
      const f = dimensionExistsFilter(transactions.id, 'category_id', {
        ids: ids.filter(id => id !== '__none__'),
        includeNone: ids.includes('__none__'),
        includeClassified: false,
      })
      if (f) conditions.push(f)
    }
```

e, se `isNull`/`or` ficarem sem uso, remover do import.

- [ ] **Step 5: Tipos e lint**

Run: `npx tsc --noEmit -p . && npx next lint`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rules-write.ts src/lib/mcp/tools.ts src/server/transactions.ts src/server/review.ts
git commit -m "feat(rateio): sem natureza e filtro de natureza perguntam as linhas do lancamento"
git push origin feat/rateio-natureza
```

## Tarefa 7: Conciliação antigo × novo

**Files:**
- Create: `scripts/verify-rateio-natureza-leituras.ts`

- [ ] **Step 1: Escrever o script**

```ts
/**
 * Sessão 1 do rateio de natureza: as leituras migradas para `transaction_lines`
 * devolvem EXATAMENTE o que devolviam. Enquanto a 0033 não existe, a natureza
 * da linha é a do lançamento — então qualquer diferença é defeito.
 *
 *   DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres \
 *     npx tsx --env-file=.env.local scripts/verify-rateio-natureza-leituras.ts
 *
 * As queries "antigas" são cópias VERBATIM do commit 1dc9469 (tag
 * backup/antes-rateio-natureza-2026-09-29). Só leitura.
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { calcularKpisDoMes, TIPOS_DESPESA, TIPOS_FORA_DO_RESULTADO } from '@/lib/dashboard/kpis'
import { calcularIndicadores } from '@/lib/dashboard/indicators'
import { lerLinhasDoBalanco, somarBalancoPorDocumento } from '@/lib/balance-sheet-read'
import { contarUsoPorNatureza } from '@/lib/category-usage'
import { semNaturezaFilter, dimensionExistsFilter } from '@/lib/sql-dimensions'
import { detectarRecorrencias } from '@/lib/recurrence-detect'

let ok = 0, falhas = 0
const t = (c: boolean, l: string) => { if (c) { ok++ } else { falhas++; console.log(`FALHA| ${l}`) } }
const lista = (xs: readonly string[]) => sql.join(xs.map(x => sql`${x}`), sql`, `)
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

async function kpisAntigos(org: string, de: string, ate: string) {
  const [r] = await db.execute<{ receita: string; despesas: string; lucro: string; n: string }>(sql`
    SELECT
      COALESCE(SUM(CASE WHEN c.type = 'receita_operacional'
        THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
        ELSE 0 END), 0)::text AS receita,
      COALESCE(SUM(CASE WHEN c.type IN (${lista(TIPOS_DESPESA)})
        THEN (CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
        ELSE 0 END), 0)::text AS despesas,
      COALESCE(SUM(CASE WHEN c.type NOT IN (${lista(TIPOS_FORA_DO_RESULTADO)})
        THEN (CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE -t.amount::numeric END)
        ELSE 0 END), 0)::text AS lucro,
      COUNT(*)::text AS n
    FROM transactions t JOIN categories c ON t.category_id = c.id
    WHERE t.organization_id = ${org}::uuid AND t.status NOT IN ('pending', 'duplicate')
      AND t.date::date >= ${de}::date AND t.date::date <= ${ate}::date
  `)
  return { receita: Number(r.receita), despesas: Number(r.despesas), lucro: Number(r.lucro), n: Number(r.n) }
}

async function main() {
  const orgs = await db.execute<{ id: string; nome: string }>(sql`
    SELECT o.id::text AS id, o.name AS nome FROM organizations o
    WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.organization_id = o.id)
  `)
  console.log(`${orgs.length} organizações com dado`)

  for (const o of orgs) {
    // ── KPIs e indicadores: todos os meses com dado ──────────────────────────
    const meses = await db.execute<{ m: string }>(sql`
      SELECT DISTINCT TO_CHAR(date::date, 'YYYY-MM') AS m FROM transactions
      WHERE organization_id = ${o.id}::uuid ORDER BY 1
    `)
    for (const { m } of meses) {
      const [y, mm] = m.split('-').map(Number)
      const de = `${m}-01`
      const ate = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10)
      const antigo = await kpisAntigos(o.id, de, ate)
      const novo = await calcularKpisDoMes(o.id, m)
      t(Math.abs(antigo.receita - novo.receita.current) < 0.005
        && Math.abs(antigo.despesas - novo.despesas.current) < 0.005
        && Math.abs(antigo.lucro - novo.lucroLiquido.current) < 0.005,
        `${o.nome} ${m} KPIs ${JSON.stringify(antigo)} × ${JSON.stringify(novo)}`)
    }

    // ── Indicadores: a versão antiga é a nova com `transactions` no FROM. ────
    // Em vez de copiar 60 linhas, conferimos o invariante que a prova precisa:
    // para cada mês, a soma por tipo de natureza pela view = pelo lançamento.
    const porTipo = async (tabela: 'transactions' | 'transaction_lines') => db.execute<{ tipo: string; m: string; v: string }>(sql`
      SELECT c.type AS tipo, TO_CHAR(t.date::date,'YYYY-MM') AS m,
             SUM(CASE WHEN t.direction='inflow' THEN t.amount ELSE -t.amount END)::text AS v
        FROM ${sql.raw(tabela)} t JOIN categories c ON t.category_id = c.id
       WHERE t.organization_id = ${o.id}::uuid AND t.status NOT IN ('pending','duplicate')
       GROUP BY 1,2 ORDER BY 1,2
    `)
    t(igual(await porTipo('transactions'), await porTipo('transaction_lines')),
      `${o.nome}: soma por tipo × mês idêntica (base dos indicadores)`)
    const ind = await calcularIndicadores(o.id, meses.at(-1)?.m)
    t(typeof ind.meses12mDisponiveis === 'number', `${o.nome}: indicadores calculam`)

    // ── Balanço: todo documento de balanço ───────────────────────────────────
    const docs = await db.execute<{ id: string }>(sql`
      SELECT id::text AS id FROM documents
      WHERE organization_id = ${o.id}::uuid AND report_type = 'balance_sheet'
    `)
    for (const d of docs) {
      const antigo = await db.execute<{ child_id: string; total: string }>(sql`
        SELECT c.id::text AS child_id, SUM(t.amount)::text AS total
          FROM transactions t JOIN categories c ON t.category_id = c.id
          JOIN categories p ON c.parent_id = p.id
         WHERE t.document_id = ${d.id}::uuid AND t.organization_id = ${o.id}::uuid
         GROUP BY c.id ORDER BY 1
      `)
      const novo = (await lerLinhasDoBalanco(o.id, d.id))
        .map(r => ({ child_id: r.childId, total: r.total })).sort((a, b) => a.child_id.localeCompare(b.child_id))
      t(igual(antigo.map(r => ({ child_id: r.child_id, total: Number(r.total) })), novo),
        `${o.nome}: balanço do documento ${d.id} idêntico`)
    }
    const somas = await somarBalancoPorDocumento(o.id, docs.map(d => d.id))
    t(Array.isArray(somas), `${o.nome}: soma multi-data roda`)

    // ── Uso por natureza: o antigo era SEMPRE zero (Decisão 18). Conferimos
    //    contra um JOIN correto sobre `transactions`. ─────────────────────────
    const usoJoin = await db.execute<{ id: string; n: number }>(sql`
      SELECT c.id::text AS id, COUNT(t.id)::int AS n FROM categories c
      JOIN transactions t ON t.category_id = c.id
      WHERE c.organization_id = ${o.id}::uuid GROUP BY c.id
    `)
    const uso = await contarUsoPorNatureza(o.id)
    t(usoJoin.every(r => uso.get(r.id) === Number(r.n)) && usoJoin.length === uso.size,
      `${o.nome}: uso por natureza bate com o JOIN (${usoJoin.length} naturezas em uso)`)

    // ── Sem natureza: antigo `category_id IS NULL` × `semNaturezaFilter` ─────
    const [sn] = await db.execute<{ antigo: number; novo: number }>(sql`
      SELECT COUNT(*) FILTER (WHERE t.category_id IS NULL)::int AS antigo,
             COUNT(*) FILTER (WHERE ${semNaturezaFilter(sql.raw('t.id'))})::int AS novo
        FROM transactions t WHERE t.organization_id = ${o.id}::uuid
    `)
    t(sn.antigo === sn.novo, `${o.nome}: sem natureza ${sn.antigo} × ${sn.novo}`)

    // ── Filtro de natureza de /transacoes: antigo IN × EXISTS nas linhas ─────
    const cats = await db.execute<{ id: string }>(sql`
      SELECT DISTINCT category_id::text AS id FROM transactions
      WHERE organization_id = ${o.id}::uuid AND category_id IS NOT NULL LIMIT 3
    `)
    if (cats.length > 0) {
      const ids = cats.map(c => c.id)
      const f = dimensionExistsFilter(sql`t.id`, 'category_id', { ids, includeNone: true, includeClassified: false })!
      const [r] = await db.execute<{ antigo: number; novo: number }>(sql`
        SELECT COUNT(*) FILTER (WHERE t.category_id IS NULL
                 OR t.category_id IN (${sql.join(ids.map(i => sql`${i}::uuid`), sql`, `)}))::int AS antigo,
               COUNT(*) FILTER (WHERE ${f})::int AS novo
          FROM transactions t WHERE t.organization_id = ${o.id}::uuid
      `)
      t(r.antigo === r.novo, `${o.nome}: filtro de natureza ${r.antigo} × ${r.novo}`)
    }

    // ── Recorrências: roda e devolve lista (a regra nova é equivalente para
    //    lançamento de uma linha — a prova é a de "sem rateio de natureza"). ─
    const rec = await detectarRecorrencias(o.id)
    t(Array.isArray(rec), `${o.nome}: recorrências (${rec.length})`)
  }

  // Asserção que dá sentido ao teste de uso: tem de haver natureza com uso > 0.
  const [algum] = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM transactions WHERE category_id IS NOT NULL`)
  t(Number(algum.n) > 0, 'a base tem lançamento classificado (senão o teste de uso passaria vazio)')

  console.log(`\n${ok + falhas} verificações — ${ok} OK, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
```

**Nota sobre recorrências:** a equivalência exata é mais forte que "roda": acrescentar ao script uma cópia verbatim de `detectarRecorrencias` antiga (commit `1dc9469`, `src/lib/recurrence-detect.ts`) como `recorrenciasAntigas` e comparar `igual(antigo, novo)`. O executor copia via `git show 1dc9469:src/lib/recurrence-detect.ts` e renomeia a função — é leitura pura.

**Nota sobre `semCat`/`inativas`:** idem — copiar do commit `1dc9469` as duas queries de `collectActuals` e comparar com `collectActuals(db, org.id, { versionId: <qualquer uuid>, sourceFrom: '2025-01', sourceTo: '2025-12', regime: 'competencia', shape: 'mensal', granularity: 'categoria', adjustmentPct: 0 })` (conferir os literais aceitos por `COPY_SHAPES`/`COPY_GRANULARITIES` em `budget-types.ts` antes de escrever), para cada regime.

- [ ] **Step 2: Rodar**

Run: `DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres npx tsx --env-file=.env.local scripts/verify-rateio-natureza-leituras.ts`
Expected: `N verificações — N OK, 0 falha(s)`.

- [ ] **Step 3: Rodar as suítes existentes que tocam leitura** (contra o local):

```bash
export DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres
npx tsx --env-file=.env.local scripts/verify-query-engine.ts
npx tsx --env-file=.env.local scripts/verify-dashboards.ts
npx tsx --env-file=.env.local scripts/verify-category-visibility.ts
```
Expected: os mesmos placares da última sessão (39/39, 117/117, 22/22) — ou, se um número mudar, a falha explicada.

- [ ] **Step 4: Build**

Run: `npx next build`
Expected: build limpo.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-rateio-natureza-leituras.ts
git commit -m "test(rateio): conciliacao das leituras migradas contra a versao antiga"
git push origin feat/rateio-natureza
```

---

# SESSÃO 2 — a migration e as escritas

## Tarefa 8: Migration 0033 e a reversa

**Files:**
- Create: `db/migrations/rls/0033_rateio_de_natureza.sql`
- Create: `db/migrations/rls/0033_down_rateio_de_natureza.sql`

- [ ] **Step 1: A ida**

```sql
-- 0033 — Rateio de natureza (29/set/2026).
--
-- Revoga em parte a Decisão 16 ("a natureza não se parte"). Um TED que paga
-- cinco fornecedores de naturezas diferentes é UM lançamento no extrato; a
-- parte do rateio passa a carregar a natureza, ao lado das quatro dimensões.
--
-- REGRA: com rateio, a natureza do lançamento fica VAZIA — a mesma das
-- dimensões desde a 0026. Leitura esquecida mostra "sem natureza" (lacuna
-- visível) em vez de atribuir o valor inteiro a uma natureza (erro silencioso).
--
-- ORDEM IMPORTA, e funciona com ou sem transação envolvendo o arquivo:
--   1. colunas novas
--   2. copia a natureza do lançamento para as partes (gatilho antigo ignora)
--   3. esvazia a natureza dos lançamentos rateados (gatilho antigo não olha)
--   4. só então troca função, gatilho e view — quando os dados já cumprem a regra.
--
-- Rodar no Supabase Studio > SQL Editor. Reversa: 0033_down_rateio_de_natureza.sql

-- 1. COLUNAS
ALTER TABLE transaction_allocations
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id) ON DELETE SET NULL;

-- No modelo, vazio significa "usar a natureza atual do lançamento" ao aplicar.
ALTER TABLE allocation_template_lines
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alloc_org_category
  ON transaction_allocations (organization_id, category_id)
  WHERE category_id IS NOT NULL;

-- 2. AS PARTES HERDAM A NATUREZA QUE O LANÇAMENTO TEM HOJE
UPDATE transaction_allocations a
   SET category_id = t.category_id
  FROM transactions t
 WHERE t.id = a.transaction_id
   AND a.category_id IS NULL
   AND t.category_id IS NOT NULL;

-- 3. O LANÇAMENTO RATEADO FICA SEM NATUREZA
UPDATE transactions t
   SET category_id = NULL
 WHERE t.category_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = t.id);

-- 4a. A INVARIANTE PASSA A COBRIR A NATUREZA
CREATE OR REPLACE FUNCTION assert_allocation_consistent(p_tx uuid)
RETURNS void AS $$
DECLARE
  v_amount  numeric(15,2);
  v_sum     numeric(15,2);
  v_count   integer;
  v_direct  boolean;
BEGIN
  SELECT amount,
         (category_id IS NOT NULL
          OR cost_center_id IS NOT NULL OR business_unit_id IS NOT NULL
          OR legal_entity_id IS NOT NULL OR contact_id IS NOT NULL)
    INTO v_amount, v_direct
    FROM transactions WHERE id = p_tx;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
    INTO v_count, v_sum
    FROM transaction_allocations WHERE transaction_id = p_tx;

  IF v_count = 0 THEN RETURN; END IF;

  IF v_count > 50 THEN
    RAISE EXCEPTION 'Rateio do lançamento % tem % partes, acima do limite de 50.',
      p_tx, v_count;
  END IF;

  IF v_sum <> v_amount THEN
    RAISE EXCEPTION 'O rateio do lançamento % soma % e o lançamento vale %. As partes têm de fechar o valor exato.',
      p_tx, v_sum, v_amount;
  END IF;

  IF v_direct THEN
    RAISE EXCEPTION 'O lançamento % tem rateio: a natureza e as dimensões dele têm de ficar vazias (a classificação vive nas partes).',
      p_tx;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 4b. O GATILHO DO LANÇAMENTO PASSA A OLHAR category_id
DROP TRIGGER IF EXISTS trg_transaction_allocation_guard ON transactions;
CREATE CONSTRAINT TRIGGER trg_transaction_allocation_guard
  AFTER UPDATE OF amount, category_id, cost_center_id, business_unit_id, legal_entity_id, contact_id
  ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_fn_transaction_allocation_guard();

-- 4c. A VIEW: no ramo com rateio, a natureza vem da PARTE
CREATE OR REPLACE VIEW transaction_lines
WITH (security_invoker = true) AS
  SELECT
    t.id AS transaction_id, NULL::uuid AS allocation_id, 1 AS sequence, false AS is_allocated,
    t.organization_id, t.data_source_id, t.document_id, t.invoice_id,
    t.date, t.effective_date, t.amount, t.currency, t.direction,
    t.description, t.cleaned_description, t.status,
    t.category_id,
    t.cost_center_id, t.business_unit_id, t.legal_entity_id, t.contact_id,
    t.categorization_confidence, t.categorization_method, t.needs_review,
    t.account_id, t.account_number, t.account_type, t.account_name,
    t.metadata, t.created_at, t.updated_at
  FROM transactions t
  WHERE NOT EXISTS (SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = t.id)

  UNION ALL

  SELECT
    t.id AS transaction_id, a.id AS allocation_id, a.sequence, true AS is_allocated,
    t.organization_id, t.data_source_id, t.document_id, t.invoice_id,
    t.date, t.effective_date, a.amount, t.currency, t.direction,
    t.description, t.cleaned_description, t.status,
    a.category_id,
    a.cost_center_id, a.business_unit_id, a.legal_entity_id, a.contact_id,
    t.categorization_confidence, t.categorization_method, t.needs_review,
    t.account_id, t.account_number, t.account_type, t.account_name,
    t.metadata, t.created_at, t.updated_at
  FROM transactions t
  JOIN transaction_allocations a ON a.transaction_id = t.id;

COMMENT ON VIEW transaction_lines IS
  'Uma linha por lançamento sem rateio, uma por parte quando há rateio. Amount, natureza e as quatro dimensões vêm da parte; data e conta vêm do lançamento. Natureza por parte desde a 0033.';
```

- [ ] **Step 2: A volta**

```sql
-- 0033_down — desfaz o rateio de natureza.
--
-- PERDA DECLARADA: um lançamento cujas partes têm naturezas DIFERENTES não cabe
-- no modelo antigo (uma natureza por lançamento). Ele volta com a natureza da
-- parte de MAIOR valor. Para ver quais serão achatados, rode ANTES, sozinho:
--
--   SELECT transaction_id, COUNT(DISTINCT category_id) AS naturezas
--     FROM transaction_allocations GROUP BY 1 HAVING COUNT(DISTINCT category_id) > 1;
--
-- Ordem: restaurar função e gatilho ANTES de repor a natureza no lançamento
-- (senão a função nova recusaria a natureza no lançamento rateado).

-- 1. FUNÇÃO E GATILHO COMO NA 0026
CREATE OR REPLACE FUNCTION assert_allocation_consistent(p_tx uuid)
RETURNS void AS $$
DECLARE
  v_amount  numeric(15,2);
  v_sum     numeric(15,2);
  v_count   integer;
  v_direct  boolean;
BEGIN
  SELECT amount,
         (cost_center_id IS NOT NULL OR business_unit_id IS NOT NULL
          OR legal_entity_id IS NOT NULL OR contact_id IS NOT NULL)
    INTO v_amount, v_direct
    FROM transactions WHERE id = p_tx;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
    INTO v_count, v_sum
    FROM transaction_allocations WHERE transaction_id = p_tx;

  IF v_count = 0 THEN RETURN; END IF;

  IF v_count > 50 THEN
    RAISE EXCEPTION 'Rateio do lançamento % tem % partes, acima do limite de 50.',
      p_tx, v_count;
  END IF;

  IF v_sum <> v_amount THEN
    RAISE EXCEPTION 'O rateio do lançamento % soma % e o lançamento vale %. As partes têm de fechar o valor exato.',
      p_tx, v_sum, v_amount;
  END IF;

  IF v_direct THEN
    RAISE EXCEPTION 'O lançamento % tem rateio: as dimensões dele têm de ficar vazias (a classificação vive nas partes).',
      p_tx;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transaction_allocation_guard ON transactions;
CREATE CONSTRAINT TRIGGER trg_transaction_allocation_guard
  AFTER UPDATE OF amount, cost_center_id, business_unit_id, legal_entity_id, contact_id
  ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_fn_transaction_allocation_guard();

-- 2. A NATUREZA VOLTA PARA O LANÇAMENTO (a da parte de maior valor)
UPDATE transactions t
   SET category_id = x.category_id
  FROM (
    SELECT DISTINCT ON (transaction_id) transaction_id, category_id
      FROM transaction_allocations
     WHERE category_id IS NOT NULL
     ORDER BY transaction_id, amount DESC, sequence
  ) x
 WHERE t.id = x.transaction_id
   AND t.category_id IS NULL;

-- 3. A VIEW COMO NA 0026 (natureza do lançamento nos dois ramos)
CREATE OR REPLACE VIEW transaction_lines
WITH (security_invoker = true) AS
  SELECT
    t.id AS transaction_id, NULL::uuid AS allocation_id, 1 AS sequence, false AS is_allocated,
    t.organization_id, t.data_source_id, t.document_id, t.invoice_id,
    t.date, t.effective_date, t.amount, t.currency, t.direction,
    t.description, t.cleaned_description, t.status,
    t.category_id,
    t.cost_center_id, t.business_unit_id, t.legal_entity_id, t.contact_id,
    t.categorization_confidence, t.categorization_method, t.needs_review,
    t.account_id, t.account_number, t.account_type, t.account_name,
    t.metadata, t.created_at, t.updated_at
  FROM transactions t
  WHERE NOT EXISTS (SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = t.id)

  UNION ALL

  SELECT
    t.id AS transaction_id, a.id AS allocation_id, a.sequence, true AS is_allocated,
    t.organization_id, t.data_source_id, t.document_id, t.invoice_id,
    t.date, t.effective_date, a.amount, t.currency, t.direction,
    t.description, t.cleaned_description, t.status,
    t.category_id,
    a.cost_center_id, a.business_unit_id, a.legal_entity_id, a.contact_id,
    t.categorization_confidence, t.categorization_method, t.needs_review,
    t.account_id, t.account_number, t.account_type, t.account_name,
    t.metadata, t.created_at, t.updated_at
  FROM transactions t
  JOIN transaction_allocations a ON a.transaction_id = t.id;

COMMENT ON VIEW transaction_lines IS
  'Uma linha por lançamento sem rateio, uma por parte quando há rateio. Amount e as quatro dimensões vêm da parte; natureza e data vêm do lançamento. Fonte das leituras analíticas a partir da Fase 10.3.';

-- 4. COLUNAS E ÍNDICE
DROP INDEX IF EXISTS idx_alloc_org_category;
ALTER TABLE allocation_template_lines DROP COLUMN IF EXISTS category_id;
ALTER TABLE transaction_allocations  DROP COLUMN IF EXISTS category_id;
```

Nota: na volta a view **não pode** ser `CREATE OR REPLACE` depois de dropar a coluna (a view depende de `a.category_id`) — por isso a view é restaurada no passo 3, antes do `DROP COLUMN`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/rls/0033_rateio_de_natureza.sql db/migrations/rls/0033_down_rateio_de_natureza.sql
git commit -m "feat(rateio): migration 0033 (natureza na parte) e a reversa"
git push origin feat/rateio-natureza
```

## Tarefa 9: Validar ida e volta com ROLLBACK

**Files:**
- Create: `scripts/verify-migration-0033.ts`

- [ ] **Step 1: Escrever o script**

```ts
/**
 * Valida a 0033 e a reversa ANTES de aplicar: tudo numa transação que termina
 * em ROLLBACK. Roda contra o banco LOCAL.
 *
 *   DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres \
 *     npx tsx --env-file=.env.local scripts/verify-migration-0033.ts
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'

let ok = 0, falhas = 0
const t = (c: boolean, l: string) => { if (c) { ok++; console.log(`  OK    ${l}`) } else { falhas++; console.log(`  FALHA ${l}`) } }
class Reverter extends Error {}

const IDA  = readFileSync('db/migrations/rls/0033_rateio_de_natureza.sql', 'utf8')
const VOLTA = readFileSync('db/migrations/rls/0033_down_rateio_de_natureza.sql', 'utf8')

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Recusa esperada: roda num savepoint e devolve a mensagem, ou null se passou. */
async function recusa(tx: Tx, corpo: () => Promise<unknown>): Promise<string | null> {
  await tx.execute(sql`SAVEPOINT sp`)
  try {
    await corpo()
    await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)   // força o gatilho deferido
    await tx.execute(sql`ROLLBACK TO SAVEPOINT sp`)         // também no sucesso (memória)
    return null
  } catch (e) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT sp`)
    const pg = e as { message?: string; cause?: { message?: string } }
    return pg.cause?.message ?? pg.message ?? 'erro'
  } finally {
    await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`)
  }
}

async function main() {
  const [antes] = await db.execute<{ partes: number; rateados: number; com_nat: number; soma: string }>(sql`
    SELECT (SELECT COUNT(*)::int FROM transaction_allocations) AS partes,
           (SELECT COUNT(DISTINCT transaction_id)::int FROM transaction_allocations) AS rateados,
           (SELECT COUNT(DISTINCT a.transaction_id)::int FROM transaction_allocations a
              JOIN transactions t ON t.id = a.transaction_id WHERE t.category_id IS NOT NULL) AS com_nat,
           (SELECT SUM(amount)::text FROM transaction_lines) AS soma
  `)
  const linhasPorNat = async (tx: Tx) => tx.execute<{ c: string | null; v: string }>(sql`
    SELECT category_id::text AS c, SUM(amount)::text AS v FROM transaction_lines GROUP BY 1 ORDER BY 1 NULLS FIRST
  `)

  try {
    await db.transaction(async (tx) => {
      const somaPorNatAntes = JSON.stringify(await linhasPorNat(tx))

      console.log('\n── ida ──')
      await tx.execute(sql.raw(IDA))

      const cols = await tx.execute<{ table_name: string }>(sql`
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'category_id' AND table_name IN ('transaction_allocations','allocation_template_lines')
      `)
      t(cols.length === 2, 'coluna category_id nas duas tabelas')
      const [idx] = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = 'idx_alloc_org_category'`)
      t(Number(idx.n) === 1, 'índice idx_alloc_org_category')
      const [trg] = await tx.execute<{ def: string }>(sql`
        SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'trg_transaction_allocation_guard'`)
      t(/category_id/.test(trg.def), 'gatilho do lançamento olha category_id')
      const [inv] = await tx.execute<{ v: boolean }>(sql`
        SELECT (reloptions @> ARRAY['security_invoker=true']) AS v FROM pg_class WHERE relname = 'transaction_lines'`)
      t(inv.v === true, 'view segue com security_invoker')

      const [dep] = await tx.execute<{ partes_sem: number; pai_com: number }>(sql`
        SELECT (SELECT COUNT(*)::int FROM transaction_allocations a JOIN transactions t ON t.id=a.transaction_id
                 WHERE a.category_id IS NULL AND t.category_id IS NULL
                   AND EXISTS (SELECT 1 FROM transaction_allocations b WHERE b.transaction_id=a.transaction_id AND b.category_id IS NOT NULL)) AS partes_sem,
               (SELECT COUNT(*)::int FROM transactions t WHERE t.category_id IS NOT NULL
                 AND EXISTS (SELECT 1 FROM transaction_allocations a WHERE a.transaction_id=t.id)) AS pai_com
      `)
      t(Number(dep.pai_com) === 0, `nenhum lançamento rateado ficou com natureza (${dep.pai_com})`)
      t(Number(dep.partes_sem) === 0, 'nenhuma parte ficou sem natureza por engano')
      const [comNatParte] = await tx.execute<{ n: number }>(sql`
        SELECT COUNT(DISTINCT transaction_id)::int AS n FROM transaction_allocations WHERE category_id IS NOT NULL`)
      t(Number(comNatParte.n) === Number(antes.com_nat),
        `rateados com natureza: ${antes.com_nat} antes, ${comNatParte.n} nas partes depois`)

      // O NÚMERO que importa: a soma por natureza da view não mudou.
      t(JSON.stringify(await linhasPorNat(tx)) === somaPorNatAntes, 'soma por natureza da view IDÊNTICA antes e depois')

      // ── as regras, exercitadas ─────────────────────────────────────────────
      const [alvo] = await tx.execute<{ tx: string; cat: string }>(sql`
        SELECT a.transaction_id::text AS tx, a.category_id::text AS cat
          FROM transaction_allocations a WHERE a.category_id IS NOT NULL LIMIT 1`)
      const r1 = await recusa(tx, () => tx.execute(sql`UPDATE transactions SET category_id = ${alvo.cat}::uuid WHERE id = ${alvo.tx}::uuid`))
      t(r1 !== null && /natureza/.test(r1), `natureza no lançamento rateado é recusada (${r1?.slice(0, 60)})`)

      const [outra] = await tx.execute<{ id: string }>(sql`
        SELECT c.id::text AS id FROM categories c JOIN transactions t ON t.organization_id = c.organization_id
         WHERE t.id = ${alvo.tx}::uuid AND c.id <> ${alvo.cat}::uuid AND c.parent_id IS NOT NULL LIMIT 1`)
      const r2 = await recusa(tx, () => tx.execute(sql`
        UPDATE transaction_allocations SET category_id = ${outra.id}::uuid
         WHERE id = (SELECT id FROM transaction_allocations WHERE transaction_id = ${alvo.tx}::uuid ORDER BY sequence LIMIT 1)`))
      t(r2 === null, 'trocar a natureza de UMA parte é aceito')

      const [semRateio] = await tx.execute<{ id: string }>(sql`
        SELECT t.id::text AS id FROM transactions t
         WHERE NOT EXISTS (SELECT 1 FROM transaction_allocations a WHERE a.transaction_id = t.id) LIMIT 1`)
      const r3 = await recusa(tx, () => tx.execute(sql`UPDATE transactions SET category_id = NULL WHERE id = ${semRateio.id}::uuid`))
      t(r3 === null, 'lançamento SEM rateio continua editável como antes')

      // ── a volta ────────────────────────────────────────────────────────────
      console.log('\n── volta ──')
      await tx.execute(sql.raw(VOLTA))
      const colsDepois = await tx.execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE column_name = 'category_id' AND table_name IN ('transaction_allocations','allocation_template_lines')`)
      t(colsDepois.length === 0, 'colunas removidas')
      const [depois] = await tx.execute<{ com_nat: number }>(sql`
        SELECT COUNT(DISTINCT a.transaction_id)::int AS com_nat FROM transaction_allocations a
          JOIN transactions t ON t.id = a.transaction_id WHERE t.category_id IS NOT NULL`)
      t(Number(depois.com_nat) === Number(antes.com_nat), `natureza voltou aos ${antes.com_nat} rateados`)
      t(JSON.stringify(await linhasPorNat(tx)) === somaPorNatAntes, 'soma por natureza IDÊNTICA ao estado original')
      const [trg2] = await tx.execute<{ def: string }>(sql`
        SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'trg_transaction_allocation_guard'`)
      t(!/category_id/.test(trg2.def), 'gatilho restaurado')

      // ── idempotência da ida ────────────────────────────────────────────────
      await tx.execute(sql.raw(IDA))
      await tx.execute(sql.raw(IDA))
      t(true, 'ida roda duas vezes seguidas sem erro')

      throw new Reverter()
    })
  } catch (e) {
    if (!(e instanceof Reverter)) throw e
  }

  const [fim] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
    WHERE column_name = 'category_id' AND table_name = 'transaction_allocations'`)
  t(Number(fim.n) === 0, 'ROLLBACK: nada persistiu')

  console.log(`\n${ok + falhas} verificações — ${ok} OK, ${falhas} falha(s)`)
  process.exit(falhas > 0 ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Rodar**

Run: `DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres npx tsx --env-file=.env.local scripts/verify-migration-0033.ts`
Expected: `N verificações — N OK, 0 falha(s)`.

**Não aplicar a 0033 no banco local ainda.** A Tarefa 13 tira o retrato ANTES e aplica em seguida — a ordem é o que torna a conciliação possível.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-migration-0033.ts
git commit -m "test(rateio): 0033 e reversa validadas com ROLLBACK"
git push origin feat/rateio-natureza
```

## Tarefa 10: Schema Drizzle e a escrita do rateio

**Files:**
- Modify: `db/schema/transaction-allocations.ts`
- Modify: `db/schema/allocation-templates.ts`
- Modify: `src/lib/allocations-write.ts`

**Interfaces:**
- Produces:
  - `parteSchema.categoryId: string | null | undefined` — `undefined` = "herdar a natureza padrão"
  - `pesoSchema.categoryId: string | null | undefined` — idem, por lançamento no lote
  - `AllocationRow.categoryId: string | null`
  - `validarNaturezas(organizationId: string, documentId: string | null, ids: string[]): Promise<string | null>`
  - `naturezaPadrao(organizationId: string, transactionId: string, categoriaDoLancamento: string | null): Promise<string | null>`

- [ ] **Step 1: Schema** — em `transaction-allocations.ts`, trocar a linha do JSDoc `Sem \`categoryId\` de propósito: a natureza não se parte (ver Decisão 16).` por `Com \`categoryId\` desde a 0033 (29/set): a parte carrega a natureza, e o lançamento rateado fica sem (Decisão 16 revista).`, importar `categories` de `./categories`, e acrescentar depois de `amount`:

```ts
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
```

e no bloco de índices:

```ts
    orgCategoryIdx: index('idx_alloc_org_category').on(t.organizationId, t.categoryId),
```

Em `allocation-templates.ts`, na tabela `allocationTemplateLines`, depois de `weight`:

```ts
    // Vazio = usar a natureza atual do lançamento ao aplicar o modelo (0033).
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
```

(importar `categories`).

- [ ] **Step 2: Zod e leitura** — em `allocations-write.ts`:

```ts
export const parteSchema = z.object({
  amount:         z.number().positive('Cada parte precisa de valor maior que zero'),
  /** Ausente = herda a natureza padrão do lançamento (ver `naturezaPadrao`). */
  categoryId:     uuidOrNull.optional(),
  costCenterId:   uuidOrNull,
  businessUnitId: uuidOrNull,
  legalEntityId:  uuidOrNull,
  contactId:      uuidOrNull,
  notes:          z.string().max(500).nullable().optional(),
})
```

`pesoSchema` ganha a mesma linha `categoryId: uuidOrNull.optional(),`. `AllocationRow` passa a declarar `categoryId: string | null` (sobrescrevendo o opcional do schema):

```ts
export interface AllocationRow extends Omit<AllocationPart, 'categoryId'> {
  id:       string
  sequence: number
  categoryId: string | null
  allocationTemplateId: string | null
}
```

e `listarAllocations` seleciona `categoryId: transactionAllocations.categoryId`.

- [ ] **Step 3: `validarNaturezas` e `naturezaPadrao`** — acrescentar depois de `validarDimensoes`:

```ts
/**
 * A natureza de uma parte segue a regra da natureza de um lançamento: da
 * organização, Natureza Filho, ativa, e do mesmo domínio do documento (balanço
 * só recebe natureza de Balanço; o resto, só de DRE — a regra do categorizador).
 */
export async function validarNaturezas(
  organizationId: string,
  documentId: string | null,
  ids: (string | null | undefined)[],
): Promise<string | null> {
  const unicos = Array.from(new Set(ids.filter((v): v is string => !!v)))
  if (unicos.length === 0) return null

  const rows = await db.execute<{ id: string; name: string; type: string; is_active: boolean; tem_filho: boolean }>(sql`
    SELECT c.id::text AS id, c.name, c.type, c.is_active,
           EXISTS (SELECT 1 FROM categories f WHERE f.parent_id = c.id) AS tem_filho
      FROM categories c
     WHERE c.organization_id = ${organizationId}::uuid
       AND c.id IN (${sql.join(unicos.map(id => sql`${id}::uuid`), sql`, `)})
  `)
  if (rows.length !== unicos.length) return 'Natureza não pertence à sua organização.'

  const pai = rows.find(r => r.tem_filho)
  if (pai) return `"${pai.name}" é Natureza Pai — escolha uma Natureza Filho para a parte.`
  const inativa = rows.find(r => !r.is_active)
  if (inativa) return `A natureza "${inativa.name}" está arquivada.`

  let reportType: string | null = null
  if (documentId) {
    const [doc] = await db.select({ r: documents.reportType }).from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId))).limit(1)
    reportType = doc?.r ?? null
  }
  const ehBalanco = domainFromReportType(reportType) === 'bp'
  const errada = rows.find(r => (BP_TYPES as readonly string[]).includes(r.type) !== ehBalanco)
  if (errada) {
    return ehBalanco
      ? `"${errada.name}" não é natureza de Balanço, e este lançamento veio de um balanço.`
      : `"${errada.name}" é natureza de Balanço e não pode receber lançamento de movimento.`
  }
  return null
}

/**
 * A natureza que uma parte recebe quando o chamador não diz qual: a do
 * lançamento; se ele já é rateado (e por isso não tem), a única comum às partes
 * atuais. É o que preserva o comportamento de quem só divide centro de custo —
 * inclusive tela e MCP enquanto não mandam natureza.
 */
export async function naturezaPadrao(
  organizationId: string,
  transactionId: string,
  categoriaDoLancamento: string | null,
): Promise<string | null> {
  if (categoriaDoLancamento) return categoriaDoLancamento
  const rows = await db
    .selectDistinct({ c: transactionAllocations.categoryId })
    .from(transactionAllocations)
    .where(and(
      eq(transactionAllocations.organizationId, organizationId),
      eq(transactionAllocations.transactionId, transactionId),
    ))
  return rows.length === 1 ? rows[0].c : null
}
```

Imports novos: `documents` de `@/db/schema`, `BP_TYPES` de `@/lib/bp-types`, `domainFromReportType` de `@/lib/categorizer` (conferir que importar o categorizador não traz dependência de `src/server/**` — se trouxer, copiar a função de uma linha é aceitável e declarado em comentário).

- [ ] **Step 4: `gravarAllocations`** — mudanças:

a) o select do lançamento passa a trazer `categoryId: transactions.categoryId, documentId: transactions.documentId`;

b) depois do `parsed`, resolver o padrão e validar:

```ts
  const padrao = await naturezaPadrao(organizationId, transactionId, tx.categoryId)
  const partes = parsed.data.map(p => ({
    ...p,
    categoryId: p.categoryId === undefined ? padrao : p.categoryId,
  }))
```

e usar `partes` (não `parsed.data`) daqui em diante; dentro do `if (partes.length > 0)` acrescentar, depois de `validarDimensoes`:

```ts
    const natErro = await validarNaturezas(organizationId, tx.documentId, partes.map(p => p.categoryId))
    if (natErro) return { error: natErro }
```

c) dentro da transação, ANTES do `t.delete`, ler as naturezas atuais (para a remoção):

```ts
      const naturezasAtuais = await t
        .selectDistinct({ c: transactionAllocations.categoryId })
        .from(transactionAllocations)
        .where(eq(transactionAllocations.transactionId, transactionId))
```

d) o `t.update(transactions).set({...})` do ramo com partes passa a ser:

```ts
          .set({
            categoryId: null,
            costCenterId: null, businessUnitId: null,
            legalEntityId: null, contactId: null,
            // Rateio é classificação manual: sai da fila de revisão.
            needsReview: false,
            updatedAt: new Date(),
          })
```

e o insert grava `categoryId: p.categoryId ?? null`.

e) ramo de REMOÇÃO (lista vazia), depois do `t.delete`:

```ts
      if (partes.length === 0) {
        // Remover o rateio devolve a natureza ao lançamento quando as partes
        // concordavam; se divergiam, ele fica sem e volta a pedir classificação —
        // lacuna visível, nunca uma escolha feita por nós.
        const unica = naturezasAtuais.length === 1 ? naturezasAtuais[0].c : null
        if (unica && !tx.categoryId) {
          await t.update(transactions)
            .set({ categoryId: unica, updatedAt: new Date() })
            .where(and(eq(transactions.id, transactionId), eq(transactions.organizationId, organizationId)))
        }
      }
```

- [ ] **Step 5: Lote** — em `preverLoteDeRateio`, depois de `validarDimensoes`, validar as naturezas dos pesos contra CADA domínio presente:

```ts
  if (parsedPesos.data.some(p => p.categoryId)) {
    const docs = await db
      .selectDistinct({ d: transactions.documentId })
      .from(transactions)
      .where(and(eq(transactions.organizationId, organizationId), inArray(transactions.id, ids)))
    for (const { d } of docs) {
      const natErro = await validarNaturezas(organizationId, d, parsedPesos.data.map(p => p.categoryId))
      if (natErro) return { error: natErro }
    }
  }
```

e em `aplicarLoteDeRateio`, na montagem de `partes`, acrescentar `categoryId: pesos[i].categoryId,` (undefined preservado → padrão por lançamento).

- [ ] **Step 6: Tipos e lint**

Run: `npx tsc --noEmit -p . && npx next lint`
Expected: sem erros. Se algum componente de `components/transacoes-shared/` reclamar do `categoryId` novo em `AllocationRow`, é só leitura de tipo — não mexer em tela nesta sessão; ajustar o tipo local do componente para ignorar o campo.

- [ ] **Step 7: Commit**

```bash
git add db/schema/transaction-allocations.ts db/schema/allocation-templates.ts src/lib/allocations-write.ts
git commit -m "feat(rateio): a parte grava natureza, com padrao herdado e validacao de dominio"
git push origin feat/rateio-natureza
```

## Tarefa 11: Classificação recusa lançamento rateado

**Files:**
- Modify: `src/lib/transactions-write.ts:26-31`, `:364-385`
- Modify: `src/server/transactions.ts` (`classifyTransaction`, `batchClassifyTransactions`)

- [ ] **Step 1: Natureza vira rateável**

```ts
/**
 * As cinco que o rateio reparte — natureza incluída desde a 0033 (29/set).
 * Classificar qualquer uma delas num lançamento rateado seria recusado pelo
 * gatilho: a classificação dele vive nas partes.
 */
const DIMENSOES_RATEAVEIS = ['categoryId', 'costCenterId', 'businessUnitId', 'legalEntityId', 'contactId'] as const
```

Exportar o filtro, que o job também vai usar: `export const semRateio = sql\`NOT EXISTS (...)\`` (só acrescentar `export`).

- [ ] **Step 2: `classificarPorIds` exclui rateados**

```ts
export async function classificarPorIds(
  organizationId: string,
  ids: string[],
  data: DimensionData,
): Promise<{ atualizados: number; rateadosExcluidos: number }> {
  const base = [eq(transactions.organizationId, organizationId), inArray(transactions.id, ids)]
  const cond = mexeEmDimensaoRateavel(data) ? [...base, semRateio] : base

  const linhas = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      cleanedDescription: transactions.cleanedDescription,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(and(...cond))

  if (linhas.length > 0) {
    await db
      .update(transactions)
      .set(montarUpdates(data))
      .where(and(eq(transactions.organizationId, organizationId), inArray(transactions.id, linhas.map(l => l.id))))
    await ensinarRegras(organizationId, linhas, data)
  }

  const [total] = await db.select({ n: sql<number>`COUNT(*)::int` }).from(transactions).where(and(...base))
  return { atualizados: linhas.length, rateadosExcluidos: Number(total?.n ?? 0) - linhas.length }
}
```

- [ ] **Step 3: As duas server actions**

`classifyTransaction`:

```ts
  const r = await classificarPorIds(organizationId, [id], parsed.data)
  if (r.atualizados === 0 && r.rateadosExcluidos > 0) {
    return { error: 'Este lançamento está rateado: a natureza e as dimensões vivem nas partes. Abra o rateio para mudar.' }
  }
```

`batchClassifyTransactions`:

```ts
  const r = await classificarPorIds(organizationId, ids, parsed.data)
  ...
  return { success: true, updated: r.atualizados, rateadosExcluidos: r.rateadosExcluidos }
```

Procurar outros chamadores: `grep -rn "classificarPorIds" src` — ajustar cada um ao novo retorno (MCP usa `classificarPorFiltro`, que já tem o `semRateio` via `mexeEmDimensaoRateavel`).

- [ ] **Step 4: Tipos e lint**, depois commit:

```bash
git add src/lib/transactions-write.ts src/server/transactions.ts
git commit -m "feat(rateio): classificar natureza em lancamento rateado e recusado"
git push origin feat/rateio-natureza
```

## Tarefa 12: Categorizador ignora rateado

**Files:**
- Modify: `src/jobs/categorize-transaction.ts:45-48`
- Modify: `src/server/transactions.ts` (`idsNaoCategorizados`)

- [ ] **Step 1: O job** — no `where` do `processChunk`, acrescentar `semRateio` (importado de `@/lib/transactions-write`):

```ts
    .where(and(
      eq(transactions.organizationId, organizationId),
      inArray(transactions.id, ids),
      // Rateado é classificação manual que vive nas partes. Escrever natureza ou
      // dimensão nele seria recusado pelo gatilho no commit — e derrubaria o
      // bloco inteiro de 50. Este defeito já existia para dimensões desde a 10.4.
      semRateio,
    ))
```

- [ ] **Step 2: "Categorizar agora"** — `idsNaoCategorizados` ganha `semRateio` no `and(...)`.

Nota: a camada de recorrência do categorizador (`checkRecurrence`) **não precisa mudar** — ela filtra `inArray(transactions.categoryId, validCategoryIds)`, e lançamento rateado tem natureza nula, então nunca é escolhido como predecessor.

- [ ] **Step 3: Commit**

```bash
git add src/jobs/categorize-transaction.ts src/server/transactions.ts
git commit -m "feat(rateio): categorizador e Categorizar agora ignoram lancamento rateado"
git push origin feat/rateio-natureza
```

## Tarefa 13: Verificação das escritas e conciliação antes/depois da 0033

**Files:**
- Create: `scripts/verify-rateio-natureza-escrita.ts`

- [ ] **Step 1: Escrever o script** — dois modos.

`--retrato <arquivo>` (roda ANTES da 0033 no local): para cada organização com dado grava em JSON
- `runQuery(scopeFromJob(org), { fonte: 'realizado', medidas: ['valor_liquido','contagem'], agruparPor: ['categoria','mes'], periodo: { tipo: 'intervalo', de: '2000-01-01', ate: '2100-12-31', regime }, filtros: { excluirBalanco: true, visibilidade: regime === 'caixa' ? 'caixa' : 'dre' }, limite: 5000 })` para `regime` ∈ competência, caixa (DRE e fluxo);
- `calcularKpisDoMes` e `calcularIndicadores` de cada mês com dado;
- `lerLinhasDoBalanco` de cada documento de balanço;
- contagem "sem natureza" por `semNaturezaFilter`.

Modo padrão (roda DEPOIS da 0033): recalcula o mesmo retrato e exige igualdade com o arquivo (`JSON.stringify` com as linhas ordenadas), depois exercita as escritas numa organização descartável `ZZ Teste Rateio Natureza` (criada e apagada no fim, como `verify-category-visibility.ts`):

```ts
  // cenário: 2 naturezas filho DRE (A, B), 1 BP (P), um lançamento de 1.000 (saída) em A
  // 1. gravarAllocations sem categoryId (chamador antigo) → as 2 partes herdam A; lançamento fica sem natureza
  // 2. gravarAllocations com [600 A, 400 B] → view: A=600, B=400; lançamento sem natureza; needs_review=false
  // 3. parte com natureza P (Balanço) em lançamento de movimento → erro nomeando P
  // 4. parte com Natureza Pai → erro "Natureza Pai"
  // 5. classifyTransaction/classificarPorIds com categoryId no rateado → atualizados 0, rateadosExcluidos 1
  // 6. remover rateio (lista vazia) de [600 A, 400 B] → lançamento sem natureza
  // 7. ratear [500 A, 500 A] e remover → lançamento volta com A
  // 8. idsNaoCategorizados-equivalente (SELECT com semRateio + category_id IS NULL) não traz o rateado
  // 9. contarUsoDaNatureza(B) conta o lançamento rateado (parte em B) → 1
  // 10. semNaturezaFilter: rateado com uma parte sem natureza conta como sem natureza
  // 11. calcularKpisDoMes do mês: despesas = 1000 com rateio A/B (valor não duplica nem some)
```

Cada item é uma asserção `t(...)` com o valor lido do banco. Os itens 1, 6 e 7 são os da Review Focus 2–4; o 8 é o 5; o item "rateado sem natureza na origem" (Review Focus 1) é coberto pelo retrato: o 1 lançamento real nessa condição continua contando em "sem natureza" antes e depois.

- [ ] **Step 2: Rodar o retrato ANTES** (banco local restaurado de novo, sem a 0033):

```bash
bash scripts/local-db.sh up
export DATABASE_URL=postgresql://postgres:local@localhost:55432/postgres
npx tsx --env-file=.env.local scripts/verify-rateio-natureza-escrita.ts --retrato /c/Users/Julio/backups/lure-expert/retrato-antes-0033.json
MSYS_NO_PATHCONV=1 docker exec -i lure-local psql -U postgres -v ON_ERROR_STOP=1 < db/migrations/rls/0033_rateio_de_natureza.sql
npx tsx --env-file=.env.local scripts/verify-rateio-natureza-escrita.ts --comparar /c/Users/Julio/backups/lure-expert/retrato-antes-0033.json
```
Expected: `N verificações — N OK, 0 falha(s)`. (O retrato fica fora do repo: contém números de cliente.)

- [ ] **Step 3: Suítes existentes com a 0033 aplicada no local**

```bash
npx tsx --env-file=.env.local scripts/verify-query-engine.ts
npx tsx --env-file=.env.local scripts/verify-dashboards.ts
npx tsx --env-file=.env.local scripts/verify-category-visibility.ts
npx tsx --env-file=.env.local scripts/verify-rateio-natureza-leituras.ts
```
Expected: verdes. `verify-rateio-natureza-leituras` **deve falhar** nas comparações antigo×novo que envolvem rateados (o antigo lê `transactions`, cuja natureza agora é vazia) — isso é a prova de que a migração da Sessão 1 era necessária. Registrar quais falharam e confirmar que são exatamente as que tocam os 54 rateados; não "consertar" o script.

- [ ] **Step 4: Build e commit**

```bash
npx next build
git add scripts/verify-rateio-natureza-escrita.ts
git commit -m "test(rateio): escritas e conciliacao antes/depois da 0033 no banco local"
git push origin feat/rateio-natureza
```

## Tarefa 14: Fechamento

- [ ] Atualizar `docs/SCHEMA_DECISIONS.md` com a **Decisão 27 — rateio de natureza** (o porquê de "origem vazia", "mesmo sentido", o padrão herdado, a remoção que devolve a natureza, a perda declarada da reversa) e marcar a Decisão 16 como revista.
- [ ] Atualizar `CLAUDE.md`: frente em andamento, branch, "não subiu — aguarda horário combinado", e a sessão no histórico.
- [ ] `docs/SESSION_LOG.md`: arquivos, placares, o defeito da Decisão 18 achado em `getCategories`.
- [ ] Commit + `git push origin feat/rateio-natureza`.

---

## O dia de subir (combinado com o Julio — não executar antes)

A Sessão 1 é inofensiva sozinha (mesmos números) e pode subir **antes**, em outro momento — isso encolhe a janela do dia.

1. Rodar `verify-migration-0033.ts` contra a **produção** (é ROLLBACK, não grava) — a base pode ter mudado desde o dump de 29/set.
2. Novo dump de segurança da produção + `--retrato` da produção.
3. **Aplicar a 0033 primeiro**, no SQL Editor. Com a Sessão 1 já no ar, o código antigo lê a view e nenhum número muda; o único risco da janela é alguém gravar um rateio ou classificar um rateado pela tela antiga — o gatilho novo **recusa** com mensagem (o código antigo não esvazia a natureza da origem), então é erro visível, nunca dado errado. **Um risco não visível na janela** (achado da revisão final): o "Categorizar agora" do código antigo mandaria os 53 rateados (agora sem natureza na origem) ao job, o gatilho recusaria no commit e o bloco de 50 falharia inteiro, só visível no Inngest. Por isso a janela é à noite e curta; se alguém clicar, basta clicar de novo depois do deploy.
4. Merge da branch em `main` e push → deploy (~2 min).
5. `--comparar` contra o retrato do passo 2; conferir `/dashboard`, `/dre`, `/balanco`.
6. Se algo divergir: `0033_down` + revert do merge.

Horário fora do expediente.
