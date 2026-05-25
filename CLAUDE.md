# Contexto Persistente do Projeto lure.expert

## O que estamos construindo
**lure.expert** (domínio lure.expert) — SaaS financeiro AI native pra PME brasileira.
Cliente conecta as fontes (banco, ERP, cartões, adquirentes) e o expert — o
consultor virtual dentro do app — organiza, categoriza, reconcilia, monta
DRE/BP/DFC, calcula indicadores e conversa com o cliente sobre tudo em
linguagem natural. Substitui o controller que a empresa não tem.

Marca: derivada da consultoria Lure (controladoria, processos, estratégia).
**Tese central:** substitui a controladoria, não a operação financeira do cliente.
O time financeiro do cliente continua existindo; o expert substitui a camada
acima — análise, estruturação, recomendação.

## Documentos de referência (na pasta `docs/` deste projeto)
- `docs/PLANO_DE_CONSTRUCAO.md` — mapa do MVP, fases, deliverables, definition of done
- `docs/SCHEMA_INICIAL.md` — fonte da verdade do schema (18 tabelas)
- `docs/GUIA_OPERACIONAL.md` — protocolo de execução com Claude Code (ritual de fase, template de sessão, subdivisão em sessões)
- `docs/AI_VOICE.md` — voz do expert (criado na Fase 0.5)
- `docs/STATE_PATTERNS.md` — 5 estados canônicos (criado na Fase 0.5)
- `docs/SCHEMA_DECISIONS.md` — decisões de implementação que saíram do schema original (criado conforme necessário)
- `docs/DATA_TABLE_PATTERN.md` — padrão obrigatório para toda tabela de dados do app (viewport-fill, filtro-no-header, rodapé unificado)
- `docs/SESSION_LOG.md` — histórico detalhado de sessões anteriores (arquivos alterados, bugs, código) — consultar sob demanda

**IMPORTANTE: antes de criar qualquer tabela de dados, LER `docs/DATA_TABLE_PATTERN.md`.**

Antes de qualquer mudança estrutural (schema, fase, decisão de produto),
LER o documento correspondente. Se houver conflito entre o que peço e
o que está documentado, PARAR e me consultar.

## Nomenclatura crítica
- Os agentes/IA dentro do app são SEMPRE chamados de **expert** (minúsculo,
  sem aspas, sem itálico). Nunca "IA", "assistente", "Lure", "AI" ou similares.
- Cliente "chama expert", "consulta expert", "pede análise ao expert",
  "conversa com expert".
- Microcopy em todos os componentes segue isso: "expert está analisando...",
  "expert recomenda", "expert detectou".

## Princípios não-negociáveis
1. **Multi-tenancy via RLS sempre.** Toda query DEVE respeitar `organization_id`.
2. **LLM é última opção.** Sempre tente código → regras → recorrência →
   embeddings antes de chamar IA.
3. **Use Haiku pra bulk, Sonnet pro miolo, Opus quase nunca.**
4. **Ative prompt caching em system prompts longos.**
5. **Operações pesadas vão pra Inngest, nunca síncronas.**
6. **Tudo em português** (interface, dados, comentários de código).
7. **Antes de gerar texto pelo expert, leia `docs/AI_VOICE.md`.** Tom é
   "especialista calmo, direto, sem firulas".
8. **Antes de criar componente novo, verifique se já existe** em
   `/components/ui`, `/components/financial`, `/components/states`,
   `/components/expert`.
9. **Toda tela que carrega dado implementa os 5 estados**
   (loading/empty/error/partial/success). Nunca tela em branco carregando.
10. **Mutações via expert (Tipo B) seguem o pattern preview+confirm:**
    expert propõe → cliente confirma → expert executa → tudo em `agent_events`
    com `proposed_change`, `confirmed_at`, `applied_at`.
11. **Reconciliação entre fontes é automática + fila de revisão pra ambíguos.**
    Match >85% → automático; 50-85% → revisão; <50% → órfã sinalizada.
12. **Transferências entre contas próprias são detectadas automaticamente**
    e categorizadas como `transfer` (não impactam DRE).
13. **Cartão de crédito corporativo é passivo intermediário:** compras
    impactam DRE na data da compra; pagamento da fatura é `transfer`,
    não despesa nova.
14. **Custo de IA é interno (Lure paga).** NÃO expor "tokens" ao cliente.
    Métricas de uso exibidas são em unidades de valor (operações, atividades,
    valor entregue). Medição interna em `agent_events`.
15. **Memória do expert é híbrida:** conversacional (`conversations`+`messages`)
    + memória curada (`organization_facts`) que cresce só com confirmação
    humana.

## Stack
- Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
- Supabase (Postgres + Auth + Storage + pgvector)
- Drizzle ORM
- Inngest pra jobs em background
- Anthropic SDK (Claude Haiku 4.5 + Sonnet 4.6)
- Vercel deploy

## Identidade visual (ver `docs/DESIGN_TOKENS.md`)
- Cor primária: emerald-700 (verde-floresta)
- Tipografia: Inter (com tabular-nums em números)
- Paleta neutra: slate
- Semânticas: emerald-600 (+), rose-600 (−), amber-500 (alerta), sky-600 (info)
- CSS: variáveis HSL bare channels (ex: `161 96% 24%`) — NÃO usar oklch com hsl(var())

## Convenções de código
- Tabelas em snake_case plural (`transactions`, `contacts`,
  `organization_facts`)
- Funções em camelCase (`categorizeTransaction`, `proposeRecategorization`)
- Componentes React em PascalCase (`TransactionList`, `ExpertDrawer`)
- Sempre validar input com Zod
- Sempre logar operações importantes em `agent_events` (incluindo o que
  expert propõe, confirma e executa)
- NUNCA expor `service_role` key pro client

## Estrutura de pastas
- `/app/(authenticated)` — rotas protegidas (dashboard, transacoes, dre, fluxo, contas, configuracoes, upload)
- `/app/(public)` — rotas públicas (login — ainda em `/app/login` por ora)
- `/components/ui` — base shadcn/ui (Button, Card, Input, etc.)
- `/components/financial` — CurrencyDisplay, PercentageDelta, KPICard, DataTable
- `/components/states` — EmptyState, LoadingState, ErrorState, PartialDataBanner
- `/components/layout` — AppShell, Sidebar (criados na Fase 0.5)
- `/components/expert` — ExpertTrigger (criado); futuros: ReportCanvas, InlineChart, DiffPreview
- `/lib` — utilitários, clientes (supabase, anthropic, inngest)
- `/lib/parsers` — parsers via LLM: `excel-csv.ts` (Excel/CSV/TXT → Claude Haiku), `pdf.ts` (PDF → Claude Haiku document API)
- `/server` — server actions, lógica de backend
- `/jobs` — definições Inngest
- `/db` — schema Drizzle, migrations
- `/prompts` — prompts pro expert (system prompts, tools), separados em arquivos
- `/docs` — todos os documentos de planejamento e referência

## Regra de backup obrigatória

**Sempre executar `git push origin main` após qualquer commit ou atualização de status do projeto.**
Nunca encerrar uma sessão de trabalho sem confirmar que o GitHub está atualizado com os commits locais.

## O que NÃO fazer
- NÃO criar features fora do escopo da fase atual
- NÃO criar componente novo sem checar se já existe na biblioteca
- NÃO mudar stack sem discutir
- NÃO usar localStorage pra dados sensíveis
- NÃO fazer query sem RLS
- NÃO chamar LLM em código síncrono (sempre via Inngest, exceto chat
  interativo)
- NÃO commitar `.env`
- NÃO usar emoji em texto gerado pelo expert (ver AI_VOICE.md)
- NÃO referir-se aos agentes como "IA", "assistente" ou "Lure" — sempre
  "expert"
- NÃO expor "tokens" ao cliente
- NÃO executar mutação via expert sem preview+confirm humano
- NÃO implementar Tipo C (mutações autônomas — pagar, enviar mensagem
  pra terceiro) — fora do escopo

## Histórico de fases concluídas

**Fase 0 — Scaffolding (CONCLUÍDA)**
- 0.1: Next.js 14 + TypeScript + Tailwind + shadcn/ui
- 0.2: `/login` (e-mail + senha) + middleware Supabase SSR
- 0.3: deploy Vercel → https://lure-expert.vercel.app
- Repositório: https://github.com/ti927/lure.expert.git (branch `main`)

**Fase 0.5 — Fundações de Design e Voz (CONCLUÍDA)**
- 0.5.1: Design tokens — `tailwind.config.ts` + `globals.css` (HSL bare channels) + `/style-guide`
- 0.5.2: Biblioteca de 19 componentes — `/style-guide/components`
- 0.5.3: Voz do expert — `docs/AI_VOICE.md`
- 0.5.4: Padrões de estado — `docs/STATE_PATTERNS.md` + `PartialDataBanner`
- 0.5.5: Arquitetura de informação — `AppShell`, `Sidebar` colapsável (localStorage),
  `ExpertTrigger` (FAB + drawer placeholder), route group `(authenticated)`,
  6 rotas placeholder: `/dashboard`, `/transacoes`, `/dre`, `/fluxo`, `/contas`, `/configuracoes`

**Fase 1 — Schema de Dados e Multi-tenancy (CONCLUÍDA)**
- 1.1: Drizzle ORM + extensões (pgcrypto, vector, pg_trgm) + `organizations`, `memberships`, `data_sources` + RLS
- 1.2: `contacts`, `categories`, `categorization_rules` + RLS + índice GIN trigram
- 1.3: `fixed_assets`, `loans`, `equity_movements`, `inventory_snapshots` + RLS
- 1.4: `credit_card_invoices`, `documents`, `transactions` + RLS + HNSW + FKs circulares
- 1.5: `templates`, `conversations`, `messages`, `organization_facts`, `agent_events` + RLS
- 1.6: Seed plano de contas (52 categorias DRE padrão) + trigger automático no INSERT de organizations
- 1.7: Onboarding (`/onboarding`): cria org + membership (transação atômica); AppShell/Sidebar com
  prop `user`; avatar + dropdown; `/configuracoes` real com OrgForm editável.
- 1.8: Teste de isolamento RLS 18/18 tabelas. Fix de recursão infinita na policy SELECT de
  `memberships`. Migrations em `db/migrations/rls/0005_rls_*.sql`.

Schema original: 18 tabelas (Fase 1), RLS ativa e testada. Fonte da verdade: `docs/SCHEMA_INICIAL.md` v2.0.
Tabelas adicionadas em fases posteriores: `transactions_staging` (Fase 2.3) — ver `docs/SCHEMA_DECISIONS.md`.
Colunas adicionadas em fases posteriores: `transactions_staging.effective_date` (migration 0021, Fase 6) — ver `docs/SCHEMA_DECISIONS.md` Decisão 7.

---

## Fase atual

**Status:** Fase 8 — Connectors de Cartão e Adquirentes **em andamento** (8.0 ✅, 8.1 ✅). Fases 0–7 **100% concluídas**.

**Sessões Fase 8:**
- ✅ 8.0: Schema `acquirer_connections`, migration 0023, `acquirer-provider.ts` (Abstract + Stone/Cielo/Rede stubs), server actions CRUD, aba Adquirentes em `/contas`
- ✅ 8.1: Stone connector real (`stone-client.ts` OAuth2, `StoneProvider` implementado, job `sync-acquirer-item`, cron `sync-all-acquirer-items`)
- 🔲 8.2: Upload de extratos de adquirentes (CSV/PDF fallback)
- 🔲 8.3: Cielo connector
- 🔲 8.4: Reconciliação lote bancário × vendas individuais
- 🔲 8.5: UX polish + MDR calculado

**Hardening intercalado (sessão de incidente, fora de fase):**
- ✅ Pipeline de upload — chunking do parser Haiku (120 linhas/call), catch loud em `documents.ts` (falha de `inngest.send` agora deleta doc e retorna erro visível), watchdog cron `*/10 * * * *` que marca docs travados em `pending` >15min ou `processing` >30min como `failed`, `maxDuration=300` na rota `/api/inngest`. Commit `178c0f8`. Detalhes em `docs/SESSION_LOG.md`.
- ✅ Parser CSV redesenhado — substitui chunking + LLM-por-linha por `csv-parse` determinístico. LLM agora chamado **uma vez** por upload, só pra detectar índice das colunas semânticas (date/amount/description/direction). Fallback heurístico por keyword em PT-BR se LLM falhar. Tempo: 1.3s vs 3-5min anteriores. Commit `46b43cc`. Detalhes em `docs/SESSION_LOG.md`.

**Migrations aplicadas no Supabase Studio:**
- ✅ `db/migrations/rls/0017_category_visibility_flags.sql` — `hide_in_dre` e `hide_in_cashflow` em `categories`
- ✅ `db/migrations/rls/0018_transactions_account_fields.sql` — `account_id`, `account_number`, `account_type`, `account_name` em `transactions`
- ✅ `db/migrations/rls/0019_reset_categorization_rules.sql` — `DELETE FROM categorization_rules` (reset para introduzir escopo por accountId)
- ✅ `db/migrations/rls/0020_category_opex_capex.sql` — `opex_capex text NOT NULL DEFAULT 'opex'` em `categories`; seed defaults CAPEX para tipos 8/9/10
- ✅ `db/migrations/rls/0021_staging_effective_date.sql` — `effective_date text` em `transactions_staging`
- ✅ `db/migrations/rls/0022_sefaz_invoices.sql` — tabelas `sefaz_connections` e `invoices` + coluna `invoice_id` em `transactions` + RLS em ambas
- ✅ `db/migrations/rls/0023_acquirer_connections.sql` — tabela `acquirer_connections` + RLS

**Convenção crítica — date vs effective_date em `transactions`:**
- `date` (competência) → alimenta **DRE** e **BP** (quando o fato econômico ocorreu)
- `effective_date` (caixa) → alimenta **FC, saldo de caixa e gráfico de fluxo** (quando o dinheiro se moveu)
- Queries de caixa usam `COALESCE(t.effective_date, t.date)` — compatibilidade retroativa para dados históricos onde `effective_date` é `NULL`
- Queries de competência (`dre.ts`, `balance-sheet.ts`, KPIs de resultado em `dashboard.ts`) usam `t.date` diretamente — não alterar

**Plano de contas:** 15 tipos (10 DRE + 5 BP), estrutura 3 níveis (Tipo → Pai → Filho). Apenas Natureza Filho pode ser atribuída a transações. Ver `docs/SCHEMA_DECISIONS.md` para decisões arquiteturais não-óbvias.

**Fase futura — Ampliação de contexto do expert:**
Atualmente o system prompt do expert inclui apenas os 4 KPIs do dashboard. Numa fase posterior, enriquecer com:
- DRE completo do mês atual (e comparativo com mês anterior): receita bruta, deduções, CPV, lucro bruto, SGA, EBITDA, resultado financeiro, LAIR, lucro líquido — via `getDreData` já existente
- BP (ativo/passivo circulante) quando a org tiver lançamentos classificados nesses tipos
- Histórico de N meses para permitir análise de tendência ("você perguntou sobre a queda de margem em março...")
- `organization_facts` curados como memória de longo prazo do expert

---

## Histórico de sessões

Detalhes completos (arquivos alterados, bugs corrigidos, código implementado) em `docs/SESSION_LOG.md`.
Decisões arquiteturais não-óbvias e WHYs em `docs/SCHEMA_DECISIONS.md`.

| Sessão | O que foi entregue |
|---|---|
| **Hardening intercalado** | |
| Parser CSV redesenho (`46b43cc`) | Substitui LLM-por-linha (65 chamadas Haiku) por `csv-parse` determinístico + LLM **uma vez** só pra mapping de colunas. Fallback heurístico por nome de coluna em PT-BR. Funções determinísticas: `normalizeDate` (DD/MM/YYYY, "02 jan.", serial Excel), `normalizeAmount` (BR vs US, R$, sinal por parênteses). Resultado: 1.3s vs 3-5min, 2k tokens vs 70k, sem warnings de ByteString |
| Upload pipeline (`178c0f8`) | Chunking do parser Haiku (120 linhas/call) + catch loud em `documents.ts` (apaga doc e devolve erro) + watchdog cron `*/10 * * * *` (marca pending>15min e processing>30min como failed) + `maxDuration=300` na rota `/api/inngest`. Diagnóstico: doc CSV 7k linhas travado por dessincronia do app Inngest Cloud — resolvido via resync manual + 3 defeitos de código que mantinham o problema invisível |
| **Fase 8 — Adquirentes (em andamento)** | |
| 8.1 | `stone-client.ts` (OAuth2 client_credentials, token cache, `fetchSales` paginado) + `StoneProvider` implementado + job `sync-acquirer-item` (ensure-data-source, insert em transactions, trigger categorização) + cron `sync-all-acquirer-items` |
| 8.0 | Schema `acquirer_connections` + migration 0023 + `acquirer-provider.ts` (stubs Stone/Cielo/Rede/PagBank) + server actions CRUD + aba Adquirentes em `/contas` |
| **Fase 7 — SEFAZ / NF-e (concluída)** | |
| 7.4 | Painel `/nfe` com cards AR/AP, tabela DATA_TABLE_PATTERN, sidebar badge pendentes, categorização camada 0.5 com `NfContext` |
| 7.3 | Job `reconcile-invoices` (score pg_trgm+valor+data, thresholds 0.85/0.50), server actions `listInvoices`/`getInvoiceStats`/`manualReconcile` |
| 7.2 | `sefaz-provider.ts` (AbstractSefazProvider + FocusNFeProvider), jobs `sync-sefaz-item` e `sync-all-sefaz-items`, webhook SEFAZ |
| 7.1 | Schema `sefaz_connections` e `invoices`, migration 0022, 6 server actions CRUD SEFAZ, tela `/configuracoes/sefaz` |
| **Fase 6 — Dashboard e Balanço (concluída)** | |
| date/effective_date | Separação competência vs caixa em todo o pipeline; `COALESCE(effective_date, date)` em 6 queries de FC; migration 0021 |
| Alertas dashboard | `AlertsSection` com 8 condições de risco, dismiss por mês em localStorage |
| Seletor de mês | `resolveMonthRange()`, `?month=YYYY-MM` na URL, Top 5 por categoria-filho, fix ORDER BY numérico no PostgreSQL |
| Popovers indicadores | `HelpCircle` + `Popover` com fórmula e interpretação em cada indicador financeiro |
| Indicadores financeiros | Liquidez Seca, Endividamento Geral, ROE anualizado, Ciclo Financeiro (null/fase futura) |
| Subtotais drill-down | Tira de subtotais por grupo e natureza pai no `DrillDownDialog` compartilhado |
| OPEX/CAPEX | Campo `opex_capex` em `categories`, migration 0020, seções separadas em `/fluxo` |
| Tabela fluxo mensal | `getFluxoMensalData`, tabela estilo DRE em `/fluxo` com drill-down e persistência |
| Drill-down /balanco | `getBalancoDrillDown` (filtra por document_id), `DrillDownDialog` extraído para `transacoes-shared/` |
| Regras /configuracoes/regras | `categorization-rules.ts` (5 server actions), `RulesManager`, `RuleEditDialog` |
| Fix 3 bugs motor de regras | `accountId` ausente no SELECT do job, formato antigo de conditions no review, `accountId` ausente no review SELECT |
| Drill-down DRE | Extração `transacoes-shared/` (ColHeader, filtros, CellCombobox, BatchClassifyDialog), DrillDownDialog completo |
| Regras description+accountId | Escopo composto, `applyRules` reescrita, migration 0019 reset, `upsertRule` unificado |
| Categorizador com conta | `AccountContext`, `buildAccountContextBlock`, connectionLabel/connectionBadge via data_sources |
| 6.0 BP imports | `balance-sheet.ts` (getBpData, getAvailableBpDates), `bp-types.ts`, campos `report_type`/`reference_date` em documents |
| Correções pré-Fase 6 | Janela expert arrastável via createPortal, títulos de aba, ChangeTypeDialog, expand/collapse categorias |
| **Fase 5 — DRE (concluída)** | |
| 5.F Fluxo projetado | `getFluxoData()`, projeção 90d, detecção de recorrências via CTE SQL, BarChart 4 séries |
| 5.E Expert chat | `expert.ts` (3 server actions), `expert-chat.tsx` com histórico, system prompt com KPIs do mês |
| 5.D Indicadores | `getFinancialIndicators()`: Margem EBITDA, Liquidez Corrente, Cobertura Serviço Dívida |
| 5.B Dashboard | `getDashboardKPIs()`, `getCashFlowChart()`, 4 KPI cards + gráfico semanal Recharts |
| Fixes pós-5.A | `<Toaster />` no layout, drill-down de Total, sentinels `__null__` e `__classified__` |
| 5.A DRE | Tabela 12 meses hierárquica, filtros por dimensão via `useTransition`, sticky header |
| 5.0 | `dre-types.ts` + `dre.ts` (getDreData, getDreDrillDown) |
| DATA_TABLE_PATTERN | `docs/DATA_TABLE_PATTERN.md` criado; redesign /transacoes e /upload/review para viewport-fill |
| Persistência+fixes | localStorage em /dre e /balanco, fix `generateMonthRange` UTC-3, redesign /balanco multi-coluna, isolamento bp/dre no categorizer |
| UX categorias+fixes | Criação inline de categorias, leaf node para BP Pai, ordenação numérica nos dropdowns |
| **Fase 4 — Pluggy (concluída)** | |
| UX Pluggy sync+edição | `awaitingFirstSync`, `EditConnectionDialog` (logo/nome/badge), customLogoUrl em `/contas` |
| UX tabelas diversas | Logo+badge em /transacoes, toggle autoCategorize, PAGE_SIZE 500 em /contas, botão "Categorizar agora" |
| Pós-4 UX polish | ExpertTrigger na sidebar via createPortal, filtros completos em /revisao, fix `lastTransactionFetchedAt` |
| 4.F hint IA | pluggyCategory no metadata Pluggy injetado no prompt Haiku |
| 4.E contas UX | Número de conta, filtros extrato pendente, sync com data de corte (date picker) |
| 4.D Reconciliação Pluggy | `reconcile-pluggy-transactions.ts` com pg_trgm similarity, lotes de 50 |
| 4.C Webhooks+cron | `/api/webhooks/pluggy`, `sync-all-pluggy-items` (cron `0 6 * * *`) |
| 4.B Job sync | `sync-pluggy-item.ts` (paginação cursor, lotes 100, dedup por externalId) |
| 4.A Widget Connect | `react-pluggy-connect`, `registerPluggyItem`, `getOrgConnections`, `/contas` refatorado |
| 4.0 Scaffolding | pluggy-sdk, `data_sources.externalItemId`, migration 0013 |
| **Fase 3 — Categorização + Dimensões (concluída)** | |
| 3F drag-and-drop | `@dnd-kit/core`, `moveCategory`, filtros multi-select no plano de contas |
| Fixes pós-3F | Label "Transitórios", deleteCategory com FK violations, fix ESLint build Vercel |
| 3D import CSV | csv-parser, 4 templates, 8 server actions preview+commit, `CsvImportDialog` |
| Split investimento | Migration 0011: `emprestimos_amortizacoes` + `investimentos_retiradas`, 15 tipos no total |
| Reset categorias | Migration 0012: wipe total + reseed via `seed_categories_for_org(uuid)` |
| 3E hierarquia | 15 tipos (10 DRE + 5 BP), migration 0009, Tipo→Pai→Filho |
| 3C classificação | Tabela /transacoes com CellCombobox, filtros multi-select, `upsertRule` |
| Melhorias /transacoes | Delete de lançamentos, fix label filtro por importação |
| 3B motor IA | Categorizer 4 camadas (regra→recorrência→stub→Haiku), job `categorize-transactions` |
| 3A gestão | `CategoryManager`, `DimensionManager`, server actions CRUD para 4 dimensões |
| Parser LLM | `excel-csv.ts` migrado para Haiku — elimina todas as heurísticas de detecção de colunas |
| 3.0 schema | `cost_centers`, `business_units`, `legal_entities` + FKs em transactions e categorization_rules |
| **Fase 2 — Pipeline Upload (concluída)** | |
| 2.5+2.6 | Parser PDF via Claude Haiku document API, totalizador financeiro na revisão |
| 2.4 | Tela `/upload/[id]/review`, edição inline, confirmação e import, lock pós-import |
| 2.1–2.3 | Página /upload, Inngest setup, `transactions_staging`, parser Excel/CSV |
| Delete uploads | `deleteDocument` com Storage cleanup e cascade staging |
| **Fases 0–1 (concluídas)** | |
| 1.8 RLS | Isolamento 18/18 tabelas, fix recursão infinita na policy SELECT de memberships |
| 1.7 Onboarding | `/onboarding`, org+membership atômico via `db.transaction()`, AppShell/Sidebar |
| 1.1–1.6 | Schema 18 tabelas, Drizzle ORM, extensões pg_trgm/pgcrypto/vector, seed 52 categorias DRE |
| 0.5 design | Design tokens HSL, 19 componentes, voz expert, padrões de estado, AppShell/Sidebar colapsável |
| 0 scaffolding | Next.js 14 + TypeScript + Tailwind + shadcn/ui, login, deploy Vercel |

---

## Infraestrutura de Produção (Vercel + Supabase)

### DATABASE_URL — usar Transaction Pooler, nunca conexão direta

A variável `DATABASE_URL` no Vercel **deve** usar a URL do **Transaction Pooler** do Supabase:
```
postgresql://postgres.qwouuvgndiggoglfrmvr:[SENHA]@aws-1-sa-east-1.pooler.supabase.com:6543/postgres
```

**NÃO usar** a conexão direta:
```
postgresql://postgres:[SENHA]@db.qwouuvgndiggoglfrmvr.supabase.co:5432/postgres
```

O hostname `db.qwouuvgndiggoglfrmvr.supabase.co` falha com `ENOTFOUND` no ambiente serverless do Vercel (Node.js). O pooler (`aws-1-sa-east-1.pooler.supabase.com:6543`) é IPv4-compatível e funciona corretamente.

**Como obter a URL correta:** Supabase Dashboard → botão "Connect" (topo da página) → aba "Connection string" → "Transaction pooler".

**Após atualizar a variável no Vercel, é necessário fazer redeploy** — deployments existentes usam os valores da época em que foram criados.

---

## Decisões já tomadas que não revisitamos
- Produto: lure.expert / domínio lure.expert
- Agentes chamados: **expert**
- Cor primária: emerald-700
- Tipografia: Inter
- Voz do expert: especialista calmo, direto, sem firulas — definido em `docs/AI_VOICE.md`
- Layout: sidebar esquerda colapsável + expert flutuante canto inferior
  direito (drawer)
- Idioma: PT-BR only
- Moeda: BRL only
- Plano gratuito: não — só trial de 14 dias
- Open Finance via: **Pluggy** (travado em 2026-05-18 — cobertura BR, docs e suporte em PT)
- SEFAZ via: [provedor — definir antes da Fase 7 amplificadora]
- Custo de IA: interno (Lure paga, embutido no pricing). Sem BYO API key.
- Provedor de IA: Anthropic apenas. Multi-LLM diferido.
- Tipo C de mutações (autônomas): fora do escopo no MVP e MVP+1.
- Pricing final: decisão na Fase 10. Recomendação atual: tier por porte
  com uso justo implícito.
- Limites por plano: [definir antes da Fase 10]
