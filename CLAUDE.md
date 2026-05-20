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

---

## Fase atual

**Status:** Fase 6 — Balanço Patrimonial gerencial **em andamento**. Sessão 6.0 redesenhada (BP via upload + migration 0016) **concluída**. Sessões de melhorias UX de categorias, fixes de classificação, redesign do `/balanco` multi-coluna, isolamento de domínio BP/DRE, persistência de filtros no localStorage e fix do bug de fuso horário no DRE **concluídas**.

Fase 5 — DRE interativo com filtros por dimensão **100% concluída** (5.0, 5.A, fixes pós-5.A, 5.B, 5.D, 5.E e 5.F concluídas; 5.C entregue como parte dos fixes pós-5.A; 5.G movida para Fase 9).

Fase 4 — Open Finance via **Pluggy** **100% concluída** (4.0, 4.A, 4.B, 4.C, 4.D, 4.E e 4.F concluídas).

Fase 3 — Dimensões Analíticas + Categorização com IA **100% concluída** (3.0, 3A, 3B, 3C, 3D, 3E, 3F + parser LLM + migrations 0009/0010/0011/0012 todas aplicadas no Supabase). Plano de contas com 15 tipos (10 DRE + 5 BP), estrutura 3 níveis (Tipo → Pai → Filho), import CSV das 4 dimensões, categorização IA em 4 camadas, gestão completa em `/configuracoes`.

**Próximas sessões:**
- **Fase 6 continuação** — Drill-down por tipo/pai/filho no `/balanco`; indicador BP/DRE na coluna de `/transacoes`

**Fase futura — Ampliação de contexto do expert:**
Atualmente o system prompt do expert inclui apenas os 4 KPIs do dashboard. Numa fase posterior, enriquecer com:
- DRE completo do mês atual (e comparativo com mês anterior): receita bruta, deduções, CPV, lucro bruto, SGA, EBITDA, resultado financeiro, LAIR, lucro líquido — via `getDreData` já existente
- BP (ativo/passivo circulante) quando a org tiver lançamentos classificados nesses tipos
- Histórico de N meses para permitir análise de tendência ("você perguntou sobre a queda de margem em março...")
- `organization_facts` curados como memória de longo prazo do expert

---

### ✅ Sessão Fase 6 — Persistência de filtros + fixes DRE/BP *(concluída)*

**O que mudou:**

- **Persistência de filtros no localStorage — `/dre`** — `src/app/(authenticated)/dre/dre-client.tsx`:
  - `fetchData()` salva na chave `lure:dre:filters` os campos `{ fromMonth, toMonth, selCc, selBu, selLe }`.
  - `useEffect` no mount lê o storage, valida os IDs de dimensão contra as opções disponíveis da org (cross-org safety), restaura estado e dispara `fetchData` se os filtros diferem dos defaults do servidor.

- **Persistência de filtros no localStorage — `/balanco`** — `src/app/(authenticated)/balanco/balanco-client.tsx` + `page.tsx`:
  - `handleFilter()` salva na chave `lure:balanco:filters` os campos `{ from, to }` antes do `router.push`.
  - `useEffect` no mount redireciona para a URL salva se não há `?from=`/`?to=` na URL atual (`hasUrlParams` flag passado do `page.tsx`).
  - Evita sobrescrever URLs compartilhadas/explícitas sem abrir mão da restauração automática.

- **Fix: coluna "Dez/25" aparecia em filtro "Jan/26–Dez/26"** — `src/server/dre.ts`:
  - `generateMonthRange` usava `new Date('2026-01-01')`, que JavaScript interpreta como UTC midnight.
  - Em UTC-3 (Brasil), isso vira `2025-12-31T21:00` local → `getFullYear()` retorna 2025 → primeira coluna "Dez/25".
  - Fix: parsear `y/m` direto da string (`from.slice(0, 7).split('-').map(Number)`) sem passar pelo construtor `Date`, igual ao padrão já usado em `balance-sheet.ts`.

- **Redesign `/balanco` — tabela multi-coluna estilo DRE** *(implementado na sessão anterior)*:
  - `getBpAllDates(from, to)` em `src/server/balance-sheet.ts` — retorna todas as categorias BP, documentos deduplicados por mês (mais recente por mês) e somas por `(yearMonth, categoryId)`.
  - Todos os meses do intervalo De/Até aparecem como colunas, mesmo sem dados (zeros).
  - Patrimônio Líquido calculado client-side como `ATIVO[i] − PASSIVO[i]` por coluna; valor negativo em `text-rose-400`.
  - Filtro De/Até com `<input type="month">`, igual ao DRE.

- **Isolamento de domínio BP/DRE na categorização IA** *(implementado na sessão anterior)*:
  - `src/lib/categorizer.ts`: `loadOrgContext` carrega **todas** as categorias ativas (leaf nodes); `categorizeTransaction(tx, ctx, documentDomain)` filtra para o domínio do documento antes de executar as 4 camadas.
  - Regras de categorização com `targetCategoryId` fora do domínio são ignoradas.
  - Recorrência só encontra precedentes no mesmo domínio (`inArray(categoryId, domainCategoryIds)`).
  - Prompt do Claude Haiku recebe nota de domínio (`CONTEXTO: BP` ou `DRE`).
  - `src/jobs/categorize-transaction.ts`: busca `reportType` do documento e passa `documentDomain` ao categorizador.

TypeScript: 0 erros.

---

### ✅ Sessão UX categorias + fixes de classificação *(concluída)*

**O que mudou:**

- **Criação inline de categorias** — `src/components/settings/category-manager.tsx`: botão "+" no cabeçalho de cada bloco de Tipo abre `InlineCreateRow` para criar Natureza Pai; botão "+" na linha de cada Pai abre `InlineCreateRow` indentada para criar Natureza Filho. Auto-focus ao montar, Enter salva, Escape cancela. Seção do tipo é auto-expandida ao clicar "+".

- **Todos os blocos de Tipo sempre visíveis** — mesmo sem nenhum Pai cadastrado, o bloco do Tipo aparece na tela. Remove a necessidade de saber de antemão que o Tipo existe para criar o primeiro Pai.

- **"Recolher/Expandir tipos"** — botão global na toolbar controla `collapsedTypes: Set<string>` (independente de `collapsedPais`). Label alterna entre "Recolher tipos" e "Expandir tipos" conforme estado. Posicionado à esquerda do botão de Pais existente.

- **Fix: regra de folha (leaf node) para categorias BP** — `assertLeafCategory` em `src/server/transactions.ts` reescrita: em vez de bloquear categorias sem `parentId`, agora bloqueia categorias que TÊM filhos. Isso permite atribuir Naturezas Pai de BP (ex: "Banco 9999" sob Ativo Circulante) que não possuem subcategorias — caso de uso principal do BP gerencial.

- **Fix: categorias BP no dialog de classificação em lote** — `src/app/(authenticated)/transacoes/transacoes-client.tsx`: os 4 pontos que filtravam `parentId !== null` (somente FILHOs) foram substituídos por cálculo de `parentIds = new Set(categories.map(c => c.parentId).filter(Boolean))` e filtro `!parentIds.has(c.id)` (nós folha). Resultado: categorias BP Pai sem filhos agora aparecem nos dropdowns de categoria.

- **Fix: ordenação numérica de categorias nos dropdowns** — `src/server/categories.ts`: `numericCodeSort()` ordena por (1) posição do tipo em `CATEGORY_TYPES` e (2) segmentos do código como inteiros (`"10".split('.').map(parseInt)` → `[10]`). Corrige o bug de ordenação textual onde "10" e "11" apareciam logo após "1", antes de "2", "3" etc. Aplicado em `getCategories()` e `getCategoriesWithTxCount()`.

TypeScript: 0 erros.

---

### ✅ Sessão 6.0 redesenhada — BP via importação de relatórios *(concluída)*

**Decisão de arquitetura:** abordamos o BP gerencial via upload de relatório com data de referência, em vez de tabelas de apoio separadas (imobilizado, empréstimos, PL, estoque). Justificativa: as tabelas de apoio requerem entrada manual volumosa; o BP snapshottado por upload é o fluxo real de PMEs que já têm o relatório no Excel/sistema.

**O que mudou:**

- **Migration `db/migrations/rls/0016_document_report_type.sql`** — dois novos campos em `documents`:
  - `report_type text NOT NULL DEFAULT 'other'` — distingue relatórios de BP (`'balance_sheet'`) dos demais uploads
  - `reference_date text` — data de referência do snapshot de BP (ex: `'2026-01-31'`)

- **`src/server/balance-sheet.ts`** (criado) — server actions:
  - `getBpData(referenceDate)` — busca o documento BP mais recente com `referenceDate ≤ referenceDate` solicitado, depois agrega `transactions` daquele documento por categoria (JOIN com `categories` e alias `parent`), filtrado pelos tipos BP (`BP_TYPES`). Retorna `BpData` com `rows: BpRow[]`.
  - `getAvailableBpDates()` — lista todas as `reference_date` de documentos `report_type='balance_sheet'` da org, ordenadas desc.

- **`src/lib/bp-types.ts`** (criado) — constantes e tipos públicos do BP: `BP_TYPES`, `BpType`. Extraído como módulo separado (sem `'use server'`) para ser importável por client e server components.

**Fluxo de uso:**
1. Usuário faz upload em `/upload` de arquivo de BP → tipo de origem "Balanço Patrimonial"
2. Transações do arquivo são classificadas com categorias de tipo BP
3. Tela `/balanco` (a implementar) consulta `getBpData(data)` e exibe o BP estruturado

TypeScript: 0 erros.

---

### ✅ Sessão pré-Fase 6 — Correções e melhorias UX *(concluída)*

**O que mudou:**

- **Títulos dinâmicos de aba** — `src/app/layout.tsx` com `title.template: '%s | lure.expert'`; todas as `page.tsx` autenticadas receberam `export const metadata: Metadata = { title: '...' }`.

- **Persistência de filtros de `/transações` no localStorage** — `src/app/(authenticated)/transacoes/transacoes-client.tsx`: chave `lure:transacoes:filters`; ao montar, restaura do storage se URL não tem parâmetros; `updateFilters` salva automaticamente; "Limpar tudo" remove a chave.

- **Opção "Classificado" nos multi-selects de dimensão** — sentinel `__classified__` adicionado em todos os `MultiSelectFilter` e `CategoryMultiSelectFilter` de `/transações`. `buildMultiFilterCondition` em `src/server/transactions.ts` traduz `__classified__` → `isNotNull(column)`.

- **Fix: scroll com mouse wheel no dialog "Classificar em lote"** — `<PopoverContent onWheel={(e) => e.stopPropagation()}>` nos comboboxes do dialog. Bug causado por Radix UI interceptando o evento de scroll.

- **Expert chat → janela flutuante arrastável** — `src/components/expert/expert-trigger.tsx` reescrito: janela fixa `384×560px`, arrastar pela barra de título via `onMouseDown` + listeners em `document`. Posição persistida em `lure:expert:pos` no localStorage. `clampPos` impede sair do viewport. Renderiza via `createPortal` para escapar do contexto `transform` da sidebar.

- **Fix: altura da janela do expert** — `min-h-0` adicionado ao container de mensagens em `expert-chat.tsx` e à div de conteúdo em `expert-trigger.tsx`. Sem `min-h-0`, flex children não encolhem abaixo do tamanho natural do conteúdo, fazendo a janela crescer verticalmente sem limite.

- **Alterar tipo de Natureza Pai com cascata** — `changeParentType(parentId, newType)` em `src/server/categories.ts`: atualiza o Pai e todos os filhos em duas queries; retorna `{ updated: n }`. UI: botão com label do tipo atual na linha do Pai abre `ChangeTypeDialog` com select agrupado DRE/BP e aviso de quantos filhos serão afetados.

- **Expand/collapse individual por Natureza Pai** — `src/components/settings/category-manager.tsx`: estado `collapsedPais: Set<string>`; chevron `ChevronDown`/`ChevronRight` no início de cada linha Pai (invisível se sem filhos). Botão global "Recolher tudo / Expandir tudo" na toolbar com ícone `ChevronsUpDown`.

- **Fix: `getLinkedCount` para CC/UN/Entidade** — `src/server/dimensions.ts`: os três `getLinkedCount` agora contam `transactions` **e** `categorization_rules` em paralelo (`Promise.all`) e retornam a soma. O aviso no dialog de exclusão passa a incluir regras de categorização vinculadas.

TypeScript: 0 erros. ESLint: 0 warnings.

---

### ✅ Sessão 5.F — Fluxo de Caixa Projetado em `/fluxo` *(concluída)*

**O que mudou:**

- **`src/server/fluxo.ts`** (criado) — server action `getFluxoData()`:
  - 3 queries paralelas: (1) saldo acumulado (todas as transações confirmadas); (2) histórico diário dos últimos 60 dias; (3) detecção de recorrências via SQL.
  - Detecção de recorrências: CTE em 3 passos — `deduped` (DISTINCT ON description+direction+date para evitar dupla contagem), `grouped` (agrupa por descrição+direção, calcula avg_amount, last/first_date, contagem), `intervals` (calcula avg_days = (last_date - first_date) / (occurrences - 1)). Filtros: 2+ ocorrências, intervalo entre 7 e 40 dias, last_date nos últimos 90 dias. Limite: 20 recorrências por ordem de valor médio.
  - Para cada recorrência detectada: avança a `next_date` até o primeiro dia futuro (cálculo com `Math.ceil` em vez de loop ingênuo). Gera ocorrências futuras para os próximos 90 dias em `projMap`.
  - Agrega em semanas (ISO, segunda = início da semana) com 4 séries: `inflowReal`, `outflowReal`, `inflowProjetado`, `outflowProjetado`.
  - Calcula `saldoProjetado30d`, `60d`, `90d` = `saldoAtual` + projeção de entradas − saídas no período.
  - Tipos exportados: `RecorrenciaDetectada`, `FluxoSemana`, `FluxoData`.

- **`src/app/(authenticated)/fluxo/fluxo-client.tsx`** (criado) — client component:
  - 4 KPICards: Saldo Atual, Saldo Projetado 30d, 60d, 90d.
  - `BarChart` com 4 séries empilhadas em pares (`stackId="in"` e `stackId="out"`): histórico escuro (emerald-600 / rose-600) + projeção clara (emerald-300 / rose-200). Para qualquer semana, apenas 2 dos 4 valores são não-zero, resultando em 2 barras por semana com cor diferente histórico vs. projeção.
  - Nota de legenda abaixo do gráfico: "Cores escuras = histórico real · cores claras = projeção".
  - Tabela de recorrências: descrição, badge entrada/saída, valor médio, próxima data, intervalo em dias. EmptyState quando nenhuma recorrência detectada.

- **`src/app/(authenticated)/fluxo/page.tsx`** (reescrito) — server component que chama `getFluxoData()` e renderiza `FluxoClient`.

**Algoritmo de detecção de recorrências:**
- Janela de análise: 180 dias
- Frequências detectadas: semanal (7d) a mensal (40d)
- Threshold de atividade: última ocorrência nos últimos 90 dias
- `next_date` calculado como `last_date + avg_days`; avança até o futuro se necessário

TypeScript: 0 erros.

---

### ✅ Sessão 5.E — Expert drawer com chat real *(concluída)*

**O que mudou:**

- **`src/server/expert.ts`** (criado) — 3 server actions:
  - `getOrCreateConversation()` — busca conversa mais recente não arquivada da org+usuário; cria se não existir. Retorna `{ conversationId, history: ChatMessage[] }` (últimas 50 mensagens).
  - `sendExpertMessage(conversationId, userContent)` — persiste mensagem do usuário, carrega histórico (40 msgs), constrói system prompt com KPIs do mês (receita, despesas, lucro, saldo + variações percentuais vs. mês anterior) e nome da org, chama `claude-sonnet-4-6`, persiste resposta com `tokensInput`/`tokensOutput`, atualiza `conversations.updatedAt`. Retorna string da resposta.
  - `startNewConversation()` — insere novo registro em `conversations`, retorna `{ conversationId }`.
  - Multi-tenancy garantida: `sendExpertMessage` valida que `conversationId` pertence à org do usuário antes de processar.

- **`src/components/expert/expert-chat.tsx`** (criado) — client component:
  - Estado: `conversationId`, `msgs` (array local), `input`, `initializing`, `sending`.
  - On mount: chama `getOrCreateConversation()`, popula histórico.
  - `handleSend`: adiciona mensagem do usuário otimisticamente → chama `sendExpertMessage` → adiciona resposta. Erro de rede exibe mensagem de fallback.
  - Bubble "expert está analisando..." animada enquanto `sending = true`.
  - Auto-scroll para o fim a cada nova mensagem.
  - Botão "Nova conversa" (aparece quando há histórico) chama `startNewConversation()` e limpa o estado local.
  - Enter envia, Shift+Enter nova linha.

- **`src/components/expert/expert-trigger.tsx`** — placeholder substituído por `<ExpertChat />`. Import de `LoadingState` removido.

**System prompt inclui:**
- Nome da org, tom e proibições (AI_VOICE.md)
- Receita, Despesas, Lucro Líquido e Saldo em Caixa do mês com variação percentual vs. mês anterior
- Instrução para citar a origem dos dados e apontar tela relevante quando dados faltam

**Modelo:** `claude-sonnet-4-6`. Custo interno (cliente não vê tokens).

TypeScript: 0 erros.

---

### ✅ Sessão 5.D — Indicadores Financeiros no Dashboard *(concluída)*

**O que mudou:**

- **`src/server/dashboard.ts`** — `FinancialIndicators` type + `getFinancialIndicators()` server action:
  - Duas queries paralelas para o mês atual: (1) DRE — Receita Bruta, EBITDA (receita + deduções + CPV + SGA aditivos), serviço da dívida (outflows de `emprestimos_amortizacoes`); (2) BP — `ativo_circulante` e `passivo_circulante` acumulados (sem filtro de data — posição de balanço).
  - Três indicadores calculados: `margemEbitda = ebitda / receitaBruta × 100`, `liquidezCorrente = ativoCirc / passivoCirc`, `coberturaServicoDivida = ebitda / servicoDivida`. Retornam `null` quando denominador é zero.

- **`src/app/(authenticated)/dashboard/dashboard-client.tsx`** — Card "Indicadores Financeiros — mês atual" adicionado após o gráfico de fluxo de caixa:
  - Três linhas: Margem EBITDA (%), Liquidez Corrente (x), Cobertura do Serviço da Dívida (x).
  - Semáforo por indicador: verde (≥ threshold bom), âmbar (≥ threshold aviso), vermelho (abaixo). Thresholds: EBITDA ≥ 15%/5%; Liquidez/DCSR ≥ 1,5x/1,0x.
  - `null` exibe "—" em cinza neutro, com hint explicando a ausência (ex: "Sem amortizações no mês", "Requer lançamentos de Balanço Patrimonial").
  - Quando todos os três são `null`, exibe mensagem sugerindo classificação de transações em vez de card vazio.

- **`src/app/(authenticated)/dashboard/page.tsx`** — `getFinancialIndicators()` adicionado ao `Promise.all` e passado como prop `indicators` ao `DashboardClient`.

**Nota sobre Liquidez Corrente:** depende de transações categorizadas como `ativo_circulante`/`passivo_circulante` (tipos BP). A maioria das PMEs em early adoption só terá dados DRE — o indicador ficará `null` até o cliente categorizar movimentos de balanço.

TypeScript: 0 erros.

---

### ✅ Sessão 5.B — Dashboard com KPI cards e gráfico de fluxo de caixa *(concluída)*

**O que mudou:**

- **`src/server/dashboard.ts`** (criado) — server actions: `getDashboardKPIs()` (3 queries paralelas: mês atual, mês anterior, saldo acumulado) e `getCashFlowChart()` (90 dias diários). Tipos exportados: `KPIValue`, `DashboardKPIs`, `CashFlowDay`.
- **`src/app/(authenticated)/dashboard/dashboard-client.tsx`** (criado) — grid 4 KPI cards + gráfico de barras semanal (Recharts). `groupByWeek()` agrega dados diários esparsos em semanas ISO (seg–dom). Cores: `#059669` entradas, `#e11d48` saídas. Delta de despesas negado para que aumento de custo apareça em vermelho.
- **`src/app/(authenticated)/dashboard/page.tsx`** (reescrito) — `Promise.all` paralelo, label de mês localizado, banner "sem dados" condicional.
- **`recharts@3.8.1`** instalado.

---

### ✅ Fixes pós-5.A — DRE drill-down aprimorado + classificação em lote corrigida *(concluídos)*

**O que mudou:**

- **`src/app/layout.tsx`** — `<Toaster />` (Sonner) adicionado ao layout raiz. Estava faltando desde o início — nenhum toast era visível em lugar nenhum do app.

- **`src/server/dre.ts`** — `getDreDrillDown` aceita `dateRange?: { from: string; to: string }` opcional. Quando fornecido, usa esse range em vez de derivar o mês. Permite drill-down do Total (todos os meses exibidos).

- **`src/app/(authenticated)/dre/dre-client.tsx`** — Refatoração significativa do `DrillDownDialog` e do `DreClient`:
  - **Coluna Unidade de Negócio** não aparecia quando a org não tinha UNs cadastradas — removidos todos os condicionais `{dimension.length > 0 && ...}` na tabela do drill-down; todas as 4 colunas sempre renderizam.
  - **Filtros de dimensão no drill-down** — segunda linha de filtros com selects de CC, UN e Entidade Jurídica (filtragem client-side via `useMemo`).
  - **Filtros de data no drill-down** — inputs De/Até dentro do dialog (filtragem client-side).
  - **Coluna Total clicável** — célula Total de cada Natureza Filho abre drill-down com todas as transações do período exibido (`openDrillDownTotal`). Interfaces `BlockProps`, `TypeBlockProps`, `ParentBlockProps` estendidas com `openDrillDownTotal`.
  - **Título do dialog** diferencia modo mês vs. modo Total: `"Total — jan/25 a dez/25"`.
  - `currentFrom`/`currentTo` derivados de `fromMonth`/`toMonth` via `useMemo`.

- **`src/app/(authenticated)/transacoes/transacoes-client.tsx`** — Múltiplas correções no dialog de classificação em lote:
  - **Typo corrigido**: `"transaçãoões"` → `"transações"` no título.
  - **try/catch/finally** em `handleBatchClassify` — erros de rede/servidor agora exibem toast de erro; `setIsBatching(false)` garantido no `finally`.
  - **"Limpar seleção"** no `BatchCombobox` (volta para "Não alterar") — implementado na sessão anterior.
  - **"— Remover (gravar em branco)"** no `BatchCombobox` — sentinel `'__null__'`; `resolveField()` converte `'__null__'` → `null` no payload, gravando NULL no banco. Permite limpar CC/UN/Entidade de lançamentos classificados erroneamente.
  - **Bug: categorias Pai apareciam no batch** — `categoriesByType` e `allCategoryOptions` agora filtram `c.parentId !== null` (mesmo comportamento do `CategoryCellCombobox` inline). Eliminava o erro "Apenas Naturezas Filho podem ser atribuídas".

**Convenção `__null__` no batch:**
- `''` (vazio) = "Não alterar" — campo ignorado no UPDATE
- `'uuid'` = setar esse valor
- `'__null__'` = gravar NULL (remover classificação) — o único jeito de limpar uma dimensão em lote

---

### ✅ Sessão 5.A — Página `/dre` com tabela 12 meses e filtros por dimensão *(concluída)*

**O que mudou:**
- **`src/lib/dre-types.ts`** (criado na 5.0) — tipos e constantes públicos do DRE: `DreType`, `DRE_TYPES`, `DRE_TYPE_LABELS`, `BP_TYPES`, interfaces `DreFilters`, `DreCategoryRow`, `DreMonthSubtotals`, `DreData`, `DrillDownTransaction`. Sem `'use server'` — importável por client e server components.
- **`src/server/dre.ts`** (criado na 5.0) — server actions: `getDreData(filters)` (aggregation principal com JOIN categorias/pais, agrupamento mensal, filtros de dimensão) e `getDreDrillDown(categoryId, month, filters)` (transações individuais para drill-down).
- **`src/app/(authenticated)/dre/dre-client.tsx`** (novo) — client component com:
  - Filtros de período: dois `<input type="month">` + botão "Filtrar"
  - 3 multi-selects de dimensão (Centro de Custo, Unidade de Negócio, Entidade Jurídica) — aparecem apenas se a org tiver itens cadastrados; aplicam imediatamente via `useTransition`
  - Tabela DRE hierárquica: Tipo da Natureza → Pai → Filho, 12 colunas mensais
  - Subtotais em destaque: Receita Bruta, Receita Líquida, Lucro Bruto, EBITDA, LAIR, Lucro Líquido (fundo escuro `slate-800`), Variação de Caixa
  - Separador tracejado entre P&L e abaixo-da-linha
  - Sticky header (meses) e primeira coluna sticky (nome da conta)
  - Cores semânticas: `emerald-700` (positivo), `rose-600` (negativo), `—` (zero)
  - EmptyState quando não há dados para o período/filtros selecionados
- **`src/app/(authenticated)/dre/page.tsx`** (reescrito) — server component: busca paralela de data DRE + 3 listas de dimensão; janela padrão de 12 meses completos (1º do mês 11 meses atrás → último dia do mês atual); filtra apenas dimensões ativas para o filter bar.

**Convenção de sinal (net_amount):**
- `net_amount = SUM(inflow) − SUM(outflow)` — sinal positivo = mais entradas (bom para receitas)
- Subtotais são puramente aditivos (sem inversão de sinal na camada de exibição)
- Drill-down retorna `netAmount = direction === 'inflow' ? amount : -amount`

---

### ✅ Sessão 5.0 — Queries de aggregação DRE *(concluída)*

Criação da infra de dados para o DRE: `src/lib/dre-types.ts` + `src/server/dre.ts` + placeholder diagnóstico em `page.tsx`.

---

### ✅ Sessão pós-4 — UX polish geral *(concluída)*

**O que mudou:**

- **`src/components/expert/expert-trigger.tsx`** — ExpertTrigger movido de FAB flutuante (`fixed bottom-6 right-6`) para item de navegação na sidebar. Usa `createPortal` para renderizar o drawer em `document.body`, escapando o contexto de `transform` da sidebar (bug: `position: fixed` dentro de `transform` fica relativo ao ancestral, não ao viewport).

- **`src/components/layout/sidebar.tsx`** — `<ExpertTrigger collapsed={collapsed} />` adicionado na seção de navegação inferior (abaixo de Configurações).

- **`src/components/layout/app-shell.tsx`** — ExpertTrigger removido (era o FAB antigo).

- **`src/app/(authenticated)/transacoes/revisao/`** — filtros completos adicionados (mesma barra da `/transacoes`): busca, De/Até, direção, categoria multi-select agrupada, centro de custo, unidade de negócio, entidade jurídica. Paginação dupla (topo + rodapé). Estado vazio diferencia sem dados de sem resultados com filtro.

- **`src/server/review.ts`** — `ReviewFilters` (interface exportada), `getReviewQueue` refatorado para aceitar filtros completos com `buildWhere()`.

- **`src/app/(authenticated)/transacoes/transacoes-client.tsx`** — larguras das colunas da tabela rebalanceadas: Descrição `w-[220px]` (antes sem limite), Categoria `w-52` (antes `w-44`), C. custo `w-44` (antes `w-36`). `min-w` da tabela `1150px` (antes `900px`).

- **`src/jobs/sync-pluggy-item.ts`** — **bug fix:** `lastTransactionFetchedAt` estava sendo gravado com `new Date().toISOString()` (data/hora do sync) em vez de `dateFrom` (data de corte escolhida pelo usuário). Corrigido para `dateFrom`.

- **`src/server/connections.ts`** — `PendingTransaction` inclui `pluggyCategory: string | null`; extraído de `metadata.pluggyCategory` no `getPendingTransactionsBySource`.

- **`src/app/(authenticated)/contas/contas-client.tsx`**:
  - Extrato pendente exibe `pluggyCategory` abaixo da descrição (texto `text-xs text-muted-foreground/60`), mesmo padrão de `/transacoes`.
  - Paginação duplicada no topo da tabela (aparece quando `totalPages > 1`).
  - Botão "Confirmar todos" movido da área da paginação para a linha de filtros (evita clique acidental ao navegar páginas). Quando há selecionados, "Confirmar todos" é substituído por "Confirmar X selecionados" — nunca aparecem juntos.

---

### ✅ Sessão 4.0 — Scaffolding Pluggy *(concluída)*

**Decisão travada:** provedor de Open Finance = **Pluggy** (cobertura BR, docs/suporte PT). Belvo descartado para o MVP.

**O que mudou:**
- **SDK:** `pluggy-sdk` instalado (`^x.y.z`, ver `package.json`). Singleton em `src/lib/pluggy.ts` com `getPluggyClient()` (lazy, falha se faltar env) e `createConnectToken(itemId?, options?)` para o widget no browser.
- **Schema:** `data_sources.external_item_id` (text, nullable) adicionado — chave do `itemId` do Pluggy. Índice único parcial por `(provider, external_item_id)` + lookup por `(organization_id, provider)`. Migration `db/migrations/rls/0013_pluggy_data_sources.sql` ✅ aplicada.
- **Drizzle schema** `db/schema/data-sources.ts` atualizado com `externalItemId`.
- **`.env.example`** reescrito com bloco Pluggy. `.env.local` configurado com `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` (sandbox).
- **`/contas`:** banner âmbar removido (Sessão 4.A entregou a tela real).

**Convenções estabelecidas para a Fase 4:**
- `data_sources.provider = 'pluggy'` (constante)
- `data_sources.type` espelha `connector.type` do Pluggy: `bank` | `credit_card` | `investment`
- `metadata` jsonb guarda o que não justifica coluna: `connectorId`, `institutionName`, `institutionImageUrl`, `products`, `executionStatus`, `nextAutoSyncAt`, `lastTransactionFetchedAt`
- `credentialsEncrypted` continua sendo o canal único para qualquer token de longo prazo (cifrado, nunca exposto ao cliente)

**Próximo passo (Sessão 4.B):** job Inngest `pluggy/item.connected` disparado pelo `registerPluggyItem` — busca accounts do item, busca transações dos últimos 90d via `fetchTransactions`, insere em `transactions_staging` e dispara categorização automática.

---

### ✅ Sessão 4.A — Widget Pluggy Connect + persistência de item *(concluída)*

**O que mudou:**
- `react-pluggy-connect@2.12.0` instalado. Carregado com `ssr: false` via `next/dynamic` (usa iframe/zoid — incompatível com SSR).
- **`src/server/connections.ts`** (novo) — 3 server actions:
  - `generateConnectToken(itemId?)` — gera `accessToken` server-side com `clientUserId` para rastreabilidade. `itemId` opcional: quando passado, abre widget em modo "atualizar item" (reautenticação).
  - `registerPluggyItem(itemId)` — `client.fetchItem(itemId)` → mapeia `connector.type` → upsert em `data_sources` (verifica `external_item_id` antes de inserir para suportar reconexão). Salva `institutionName`, `imageUrl`, `products`, `executionStatus` em `metadata`.
  - `getOrgConnections()` — lista `data_sources` onde `provider='pluggy'` da org, ordenado por `created_at`.
- **`/contas` refatorado:**
  - `page.tsx` virou server component: busca conexões + deriva `includeSandbox` do env, passa como props.
  - `contas-client.tsx` (novo): botão "Conectar banco" com loading, widget `<PluggyConnect>` montado só com token ativo, lista de conexões com logo/nome/syncedAt, badge "Atenção" + botão "Reautenticar" para itens com `status='error'`.
- Migration 0013 aplicada no Supabase ✅. `.env.local` com credenciais sandbox ✅.

**Mapeamento de tipo do conector:**
- `PERSONAL_BANK` / `BUSINESS_BANK` → `data_sources.type = 'bank'`
- `CREDIT_CARD` → `'credit_card'`
- `INVESTMENT` → `'investment'`

---

### ✅ Sessão 4.C — Webhooks Pluggy + cron diário de sync *(concluída)*

**O que mudou:**
- **`src/app/api/webhooks/pluggy/route.ts`** (novo) — endpoint `POST /api/webhooks/pluggy`:
  - Eventos suportados: `item/updated` → despacha `pluggy/item.connected` com `fromDate` incremental (1 dia antes do `lastTransactionFetchedAt`, ou 7 dias se nunca sincronizado); `item/error` → atualiza `data_sources.status = 'error'` + `lastSyncError`.
  - Segurança sem HMAC: lookup do `itemId` em `data_sources.external_item_id` — ignora eventos de itens não cadastrados na plataforma.
  - Falha do Inngest não bloqueia resposta ao Pluggy (try/catch silencioso).
- **`src/jobs/sync-all-pluggy-items.ts`** (novo) — cron Inngest `syncAllPluggyItems`:
  - Schedule: `0 6 * * *` (03h BRT, Brasil sem horário de verão).
  - Busca todos os `data_sources` com `provider='pluggy'`, `status='active'` e `external_item_id IS NOT NULL`.
  - Despacha `pluggy/item.connected` para cada um com `fromDate = daysAgoISO(7)` (janela de segurança).
- **`src/jobs/sync-pluggy-item.ts`** — `fromDate` agora é parâmetro opcional no evento (retrocompatível).
- **`src/app/api/inngest/route.ts`** — `syncAllPluggyItems` registrado no `serve()`.

---

### ✅ Sessão 4.B — Job Inngest sync inicial Pluggy *(concluída)*

**O que mudou:**
- **`src/jobs/sync-pluggy-item.ts`** (novo) — função Inngest `syncPluggyItem` acionada pelo evento `pluggy/item.connected`:
  - Concurrency: `limit: 1` por `dataSourceId` (evita sobreposição de syncs do mesmo item).
  - Busca todas as contas do item via `client.fetchAccounts(itemId)`.
  - Paginação cursor manual via `fetchTransactionsCursor` — **um `step.run` por página** (evita timeout em step único e permite memoização do cursor). `DAYS_BACK = 365`.
  - Insere em `transactions` em lotes de 100 com `onConflictDoNothing` (dedup por `UNIQUE(dataSourceId, externalId)`).
  - Atualiza `data_sources.lastSyncAt`, `lastSyncStatus = 'SUCCESS'` e `metadata.lastTransactionFetchedAt`.
  - Dispara `transaction/batch-inserted` para categorização automática e `pluggy/reconcile.requested` para reconciliação.
- **`src/server/connections.ts`** — `registerPluggyItem` passou a disparar o evento `pluggy/item.connected` após o upsert em `data_sources`.
- **`src/app/api/inngest/route.ts`** — `syncPluggyItem` registrado no `serve()`.

**Campos mapeados do Pluggy para `transactions`:**
- `externalId` ← `tx.id` (chave de dedup)
- `date` ← `tx.date` (ISO date)
- `amount` ← `Math.abs(tx.amount)` (sempre positivo)
- `direction` ← `tx.type === 'CREDIT' ? 'inflow' : 'outflow'`
- `description` ← `tx.description`
- `rawData` ← objeto `tx` completo
- `metadata` ← `{ accountId, accountName, accountType, accountSubtype, accountNumber, pluggyDate, pluggyCategory, pluggyCategoryId, merchantName, merchantCategory }`
- `status = 'pending'` (aguarda confirmação no extrato pendente)

---

### ✅ Sessão 4.F — Categoria Pluggy como hint IA + exibição *(concluída)*

**O que mudou:**
- **`src/jobs/sync-pluggy-item.ts`** — `metadata` passa a incluir campos do Pluggy: `pluggyCategory`, `pluggyCategoryId`, `merchantName`, `merchantCategory` (extraídos de `tx.category`, `tx.categoryId`, `tx.merchant`).
- **`src/jobs/categorize-transaction.ts`** — `metadata` incluído no select para repassar ao categorizador.
- **`src/lib/categorizer.ts`** — `classifyWithLLM` aceita `pluggyCategory?: string | null`; quando presente, injeta `\nCategoria do banco (Pluggy): {value}` no user message → melhora precisão sem mapeamento manual.
- **`src/app/(authenticated)/transacoes/transacoes-client.tsx`** — célula de descrição exibe a categoria Pluggy como texto secundário cinza (`text-xs text-muted-foreground/60`) quando disponível.

**Limitação:** transações já sincronizadas antes desta sessão não têm `pluggyCategory` em metadata. O campo é populado apenas em syncs novos.

---

### ✅ Sessão 4.E — UX /contas: número de conta, filtros e sync com data de corte *(concluída)*

**O que mudou:**
- **`src/server/connections.ts`**:
  - `PendingTransaction` inclui `accountNumber: string | null` (extraído de `metadata.accountNumber`).
  - `getPendingTransactionsBySource` — removido `.limit(500)` (limitava o extrato a 500 lançamentos independente do volume real).
  - `triggerManualSync(dataSourceId, fromDate?)` — aceita `fromDate` opcional e repassa ao job Inngest.
- **`src/app/(authenticated)/contas/contas-client.tsx`**:
  - Cards de conexão: accountSummary exibe número junto ao tipo — "C. Corrente • 00025546-7 · Cartão • 7634".
  - Extrato pendente: filtro por conta (account subtype + number), filtro de data (de/até), coluna "Conta" exibe número.
  - Filtro de banco no dropdown diferencia conexões do mesmo banco pelos tipos de conta.
  - Filtro de conta se atualiza automaticamente ao mudar o banco selecionado.
  - Botão de sync abre dialog pedindo data de corte (default: 90 dias atrás); a data escolhida é passada ao job como `fromDate`.

---

### ✅ Sessão 4.D — Reconciliação Pluggy *(concluída)*

**O que mudou:**
- **`src/jobs/reconcile-pluggy-transactions.ts`** (novo) — função Inngest `reconcilePluggyTransactions` acionada por `pluggy/reconcile.requested`:
  - Busca as transações Pluggy recém-inseridas por ID.
  - Para cada uma: query SQL com `pg_trgm similarity()` buscando correspondências em transações de outras fontes (`provider != 'pluggy'`), mesma direção, mesmo valor, data ±2 dias.
  - Score ≥ 0,85 → marca como `status = 'duplicate'` + `duplicateOf = pluggyTxId` (automático).
  - Score 0,50–0,84 → marca `needsReview = true` + `metadata.reconciliationPending = true` + candidato e score (fila de revisão).
  - Processamento em lotes de 50 transações por `step.run` (respeita limite de 1000 steps/run do Inngest).
  - Concurrency: `limit: 1` por `organizationId`.
- Tela `/transacoes/reconciliacao` (já existia) exibe os pares para revisão manual.

---

### ✅ Sessão 3F — UX Plano de Contas: filtros + drag-and-drop *(concluída)*

**O que mudou:**
- `/configuracoes/categorias`: 3 filtros pesquisáveis multi-select na toolbar — **Tipo da Natureza**, **Natureza Pai**, **Natureza Filho**. Filtragem client-side; filtros combinam entre si; Pai aparece automaticamente quando Filho filtrado e vice-versa.
- Drag-and-drop com `@dnd-kit/core`: ícone grip (⠿) aparece ao hover em cada Natureza Filho. Arrastando o Filho sobre outro Pai, a seção destaca com anel azul. Soltar move o Filho (cross-type permitido — Tipo atualiza para o do novo Pai).
- Atualização otimista com rollback em caso de erro de servidor.
- Nova server action `moveCategory` em `src/server/categories.ts`.
- Componentes refatorados: `PaiSection` (useDroppable), `PaiRow`, `DraggableFilhoRow` (useDraggable), `RowActions`, `MultiFilter`.

### ✅ Fixes pós-3F *(concluídos)*

**Renomeação de tipo:**
- Label `'Transferências'` → `'Transitórios'` no `TYPE_LABELS` de `category-manager.tsx` e `transacoes-client.tsx`. Valor no banco (`transfer`) não muda.

**Fix: deleteCategory com FK violations:**
- `deleteCategory` em `src/server/categories.ts` verificava apenas filhos e transações. Outras 4 tabelas têm FK `ON DELETE NO ACTION` para `categories.id` e bloqueavam o DELETE silenciosamente.
- Estratégia por tabela: `fixed_assets`, `loans`, `equity_movements` → bloqueia com mensagem; `categorization_rules` → deleta em cascata (metadados automáticos).
- Novos imports: `categorizationRules`, `fixedAssets`, `loans`, `equityMovements`.

**Fix: build Vercel com erros de ESLint:**
- Todos os deploys estavam falhando por 5 erros de ESLint tratados como fatais no build de produção.
- `transacoes-client.tsx`: ternário como statement (`a ? b() : c()`) → `if/else` (3 ocorrências)
- `category-manager.tsx`: variável `parentOptions` declarada mas nunca usada → removida
- `excel-csv.ts`: `let cleaned` → `const cleaned` (variável não reatribuída)
- `documents.ts`: import `transactionsStaging` não utilizado → removido

**Fix: parent_id de orgs existentes:**
- Migration `0010_fix_category_parent_ids.sql` criada — seta `parent_id` para categorias com código X.Y.Z em orgs criadas antes da migration 0009.
- Aplicar manualmente no Supabase Studio (SQL Editor).

---

### ✅ Sessão 3D — Import CSV de dimensões *(concluída)*

**Arquivos principais:**
- `src/lib/csv-parser.ts` — parser CSV genérico (delim `;`, BOM UTF-8 tolerado, quoting padrão CSV com `""` como escape, validação de cabeçalho com mensagem amigável)
- `src/lib/csv-templates.ts` — templates dos 4 CSVs com cabeçalho fixo + samples; `downloadTemplate()` dispara download via Blob no cliente
- `src/server/imports.ts` — 8 server actions (preview + commit × 4 dimensões); preview valida linha a linha sem escrever no banco e calcula `willInsert` / `willUpdate` por diff com o estado atual
- `src/components/settings/csv-import-dialog.tsx` — dialog reutilizável: upload, download de modelo, preview com badges de status (criar/atualizar/erro), tabela rolável com linhas inválidas destacadas em rosa
- `src/components/settings/csv-import-button.tsx` — botão cliente (header das 4 páginas)

**Formato dos CSVs (cabeçalhos fixos — parser depende dos nomes exatos):**
- `categorias`: `codigo;tipo natureza;natureza pai;natureza filho` — **Leitura A:** cada linha define um Filho; o Pai é inferido pelo nome único em `natureza pai`. Código do Pai derivado do prefixo do primeiro Filho (`3.1.01` → `3.1`), ou slug com prefixo `pai-` quando não há padrão `X.Y.Z`.
- `centros-de-custo`: `codigo;nome`
- `unidades-de-negocio`: `codigo;nome`
- `entidades-juridicas`: `codigo;nome;cnpj` (CNPJ aceita com ou sem máscara; normaliza para 14 dígitos)

**Comportamento:**
- **All-or-nothing:** "Confirmar e importar" só habilita com zero erros. Cliente corrige o CSV e tenta de novo.
- **Upsert:** categorias por `code` (atualiza nome+tipo, mas **não move** entre Pais via CSV — proteção contra acidente); flat por `code → cnpj → name` (na ordem).
- **Pai já existente:** reusa o id (case-insensitive em `name` + igualdade em `type`); não cria duplicado.
- **Validação:** tipo deve ser um dos 15 (ver 0011 abaixo); campos obrigatórios não vazios; CNPJ 14 dígitos quando preenchido; código duplicado dentro do mesmo arquivo é erro.

TypeScript: 0 erros. ESLint: 0 warnings.

---

### ✅ Split do tipo `investimento` em dois — migration 0011 *(concluída)*

**O que mudou:**
- O tipo `investimento` (label "Investimentos & Amortizações") misturava CAPEX e empréstimos no mesmo agrupador. Foi separado em dois tipos novos:
  - `emprestimos_amortizacoes` — **"Empréstimos & Amortizações"** — empréstimos tomados, pagamento de principal, juros
  - `investimentos_retiradas` — **"Investimentos & Retiradas"** — CAPEX, intangíveis, depreciação (recebeu os 3 filhos antigos)
- Total: **15 tipos** (10 DRE + 5 BP), antes 14.
- **Transferências renumeradas: código 9 → 10** (Pai + filho `9.1` → `10.1`) para liberar o `9` ao novo tipo `investimentos_retiradas`.

**Migration `db/migrations/rls/0011_emprestimos_e_investimentos.sql` (✅ aplicada no Supabase Studio):**
1. UPDATE Transferências: code `9` → `10`, `9.1` → `10.1`
2. UPDATE Pai investimento (code `8` → `9`, nome → "Investimentos e Retiradas", type → `investimentos_retiradas`)
3. UPDATE filhos `8.x` → `9.x` + type → `investimentos_retiradas`
4. Salvaguarda: qualquer outra categoria com `type='investimento'` (custom do cliente) também muda — mantém código original
5. INSERT idempotente: Pai novo "Empréstimos e Amortizações" (code `8`, type `emprestimos_amortizacoes`, sem filhos) em orgs existentes
6. DROP e RECREATE da função `seed_default_categories()` com novos códigos 8/9/10 + filhos default

**Estrutura final do plano de contas (após migration):**
- `8 Empréstimos e Amortizações` + filhos `8.1 Empréstimos Tomados`, `8.2 Pagamento de Principal`, `8.3 Juros e Encargos de Empréstimo` (criados só no seed para orgs novas; vazio em orgs existentes)
- `9 Investimentos e Retiradas` + filhos `9.1 Compra de Imobilizado`, `9.2 Depreciação e Amortização`, `9.3 Investimentos em Intangíveis`
- `10 Transferências` + filho `10.1 Transferências entre Contas`

**Arquivos de código atualizados (slugs novos + label novo):**
- `db/schema/categories.ts` (comentário)
- `src/server/categories.ts` (CATEGORY_TYPES)
- `src/server/imports.ts` (CATEGORY_TYPES set)
- `src/components/settings/category-manager.tsx` (TYPE_LABELS + DRE_TYPES)
- `src/app/(authenticated)/transacoes/transacoes-client.tsx` (CATEGORY_TYPE_LABELS)

CSV import rejeita o slug antigo `investimento` no preview (status "erro"); cliente deve usar `emprestimos_amortizacoes` ou `investimentos_retiradas`.

TypeScript: 0 erros. ESLint: 0 warnings.

---

### ✅ Reset total das categorias + reseed — migration 0012 *(concluída)*

**O que mudou:**
- Após a 0011, 2 orgs criadas antes da 0009 permaneceram com plano de contas incompleto (faltavam Pais que o seed deveria ter criado em sua origem). A 0009 só remapeou tipos; não inseriu categorias novas em orgs preexistentes.
- Em vez de backfill cirúrgico, **wipe total + reseed** em todas as orgs. Autorização explícita do usuário: dados eram todos de teste.
- **Refactor permanente:** extraído o corpo do seed numa função reusável `seed_categories_for_org(uuid)`. A trigger function `seed_default_categories()` virou um delegate. Dali em diante, qualquer reseed manual vira `SELECT seed_categories_for_org('<org_uuid>');` no SQL Editor.

**Migration `db/migrations/rls/0012_reset_categorias_total.sql` (✅ aplicada no Supabase Studio):**
1. `CREATE OR REPLACE FUNCTION seed_categories_for_org(uuid)` com o corpo idêntico ao seed da 0011 (~140 linhas — 1 a 10 com filhos default)
2. `CREATE OR REPLACE FUNCTION seed_default_categories()` reescrita só com `PERFORM seed_categories_for_org(NEW.id)`
3. `DELETE FROM categorization_rules / transactions / fixed_assets / loans / equity_movements / categories` (sem WHERE — limpa tudo)
4. `SELECT seed_categories_for_org(id) FROM organizations` — reseed em todas as orgs

**Validação pós-aplicação:**
```sql
-- Todas as orgs devem ter o mesmo número de Pais raiz
SELECT organization_id, count(*) FROM categories
 WHERE parent_id IS NULL GROUP BY organization_id;

-- Função utilitária disponível
SELECT 1 FROM pg_proc WHERE proname = 'seed_categories_for_org';
```

Sem mudanças em `src/` — só SQL.

---

**Próxima fase: Fase 4 — Open Finance** (decisão pendente: Belvo vs Pluggy).

### ✅ Sessão 3E — Hierarquia 3 níveis em categorias *(concluída)*

**O que mudou:**
- 7 tipos genéricos (`revenue`, `cost`, `expense`…) substituídos por 15 tipos específicos (10 DRE + 5 BP — ver `0011_emprestimos_e_investimentos.sql` para o split de `investimento`):
  - **DRE (10):** `receita_operacional`, `deducoes_tributarias`, `deducoes_operacionais`, `cpv`, `sga`, `resultado_financeiro`, `ir`, `emprestimos_amortizacoes`, `investimentos_retiradas`, `transfer`
  - **BP (5):** `ativo_circulante`, `ativo_nao_circulante`, `passivo_circulante`, `passivo_nao_circulante`, `patrimonio_liquido`
- Hierarquia explícita: **Tipo da Natureza → Natureza Pai → Natureza Filho**
- Apenas Natureza Filho (com `parent_id`) pode ser atribuída a transações
- Migration `0009_category_types.sql` aplicada no Supabase: remapeou tipos + recriou trigger de seed (53 categorias DRE padrão com estrutura Pai/Filho)
- UI `/configuracoes/categorias`: seções DRE e BP separadas, dialog "Nova natureza" com seleção explícita Pai/Filho
- Comboboxes em `/transacoes` filtrados para mostrar apenas Natureza Filho
- Categorizer (`loadOrgContext`): só busca Naturezas Filho para o prompt do LLM
- Validação server-side em `classifyTransaction` e `batchClassifyTransactions`

---

## Histórico — Fase 2 (CONCLUÍDA ✅)

**Fase 2 — Pipeline de Ingestão de Arquivos**

> Pipeline completo de upload → parsing → staging → revisão → inserção em transactions.
> Suporta Excel/CSV/TXT e PDF via Claude Haiku (LLM-first — zero heurística, zero templates).
> Tela de revisão com edição inline, lote, totalizador e read-only lock pós-importação.

Sessões concluídas:
- ✅ **2.1** — Upload + Storage: página `/upload`, drag-and-drop, seletor de 6 origens
  (banco/ERP/adquirente/cartão/SEFAZ/outro), período opcional, upload direto ao Supabase Storage
  (bucket `documents`, privado, 50 MB, RLS por org via path `{org_id}/{uuid}-{filename}`),
  server action `createDocumentRecord` com validação Zod + assert de path, registro em `documents`
  com `extraction_status: 'pending'` e metadata `{ source_type, period_start?, period_end? }`.
  Migration: `db/migrations/rls/0006_storage_documents.sql`.

- ✅ **2.2** — Inngest setup + pipeline base: SDK instalado, `src/lib/inngest.ts`, `src/app/api/inngest/route.ts`,
  `src/jobs/process-document.ts` (função `processDocument` com 3 steps: mark-processing → sleep 3s → mark-completed).
  `INNGEST_DEV=1` no `.env.local` para dev local. Chaves de produção comentadas no `.env.local` (adicionar no Vercel).
  Dev Server: `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`

- ✅ **2.3** — Parser Excel/CSV: tabela `transactions_staging` criada (Drizzle + migration `0007_transactions_staging.sql` + RLS).
  Parser determinístico em `src/lib/parsers/excel-csv.ts` (SheetJS/xlsx) com heurística de mapeamento de colunas
  (date/amount/credit/debit/description). URL assinada gerada no server action e passada no evento Inngest.
  `processDocument` atualizado: baixa arquivo via signed URL, parseia, insere em staging em lotes de 100.
  PDFs são processados pelo step `parse-pdf-llm` (implementado na Sessão 2.5). Testado: 160 linhas extraídas, 0 warnings.
  **Regra de direção por source_type:** `credit_card` → força todas as linhas como `outflow`. Extensível via
  `FORCE_OUTFLOW_SOURCES` em `src/jobs/process-document.ts`. `sourceType` agora é passado no evento Inngest.

- ✅ **2.4** — Tela de revisão do staging: `src/server/staging.ts` com 4 server actions
  (`getDocumentStagingRows`, `updateStagingRow`, `batchUpdateStaging`, `approveAndInsert`).
  Página `/upload/[id]/review`: polling a cada 3s enquanto processa, tabela paginada (50 linhas/página),
  edição inline por campo (data/valor/descrição), badge de direção clicável (inflow↔outflow individual),
  seleção por checkbox + toolbar de ações em lote (aprovar/rejeitar/inverter direção em lote).
  Botão "Confirmar e importar": aprova pendentes + insere em `transactions` em lotes de 100, com upsert
  automático de `data_source` (provider=`upload`, type=sourceType) por org. Toast em todos os cenários.
  Página `/upload` lista os 10 uploads mais recentes com status, contagem de pendentes/importadas e link
  direto para revisão. **Testado e validado:** linhas importadas constam na tabela `transactions`.
  **Integridade pós-importação (Opção A):** após importação bem-sucedida, a página torna-se
  read-only — checkboxes, edição inline, badge de direção, toolbar em lote e botão de importação
  são ocultados. Banner emerald exibe contagem de transações importadas e CTA "Ver Transações"
  (link para `/transacoes`). Estado controlado por `isImported` (inicializado via `importedCount > 0`
  retornado pelo server action). TypeScript check: 0 erros.

- ✅ **2.5** — Parser PDF via Claude document API: `src/lib/parsers/pdf.ts` + `src/lib/anthropic.ts`.
  Arquitetura: `pdf-parse` usado APENAS para detectar senha (não para extração de texto — fontes
  customizadas de PDFs bancários brasileiros corrompem o texto extraído, ex: `$` → `5` no Itaú).
  Extração sempre via `extractViaDocument()`: PDF enviado como `DocumentBlockParam` (base64) ao
  Claude Haiku, que renderiza com motor próprio e retorna JSON estruturado.
  `processDocument` atualizado com step `parse-pdf-llm` (try/catch — falha marca `extractionStatus: 'failed'`
  com mensagem amigável). `inngest.send()` envolto em try/catch (upload não falha se Inngest offline).
  **Tela de revisão melhorias (feitas nesta sessão):**
  - Polling timeout de 2 minutos com banner de aviso e botão "Verificar novamente"
  - Estado `failed` exibe a mensagem de erro do `extractedData.error`
  - **Totalizador financeiro:** barra acima da tabela com Entradas / Saídas / Líquido
    (soma das linhas não-rejeitadas, reatualiza ao mudar direção ou rejeitar)
  - **Correção FORCE_OUTFLOW:** `credit_card` agora respeita `inflow` detectado pelo LLM
    (estornos/reembolsos com valor negativo na fatura). Antes forçava ALL para `outflow`.
    Nova lógica: `row.direction ?? 'outflow'` (só usa default se LLM retornou null).
  **Problema em aberto:** PDFs de fatura com colunas multi-moeda (ex: Fatura Itaú com moeda
  estrangeira + cotação + valor BRL) ainda extraem valores incorretos em alguns casos
  (o campo "cotação" influencia o campo "valor" na resposta do LLM). Não bloqueador para 2.6.
  Testado: PDF Fatura Itaú sem senha → 13 linhas extraídas, direção = outflow, importação OK.
  `next.config.mjs`: `experimental.serverComponentsExternalPackages: ['pdf-parse']` (Next.js 14.2.x).

- ✅ **2.6** — Sistema de templates para Excel/CSV *(depois substituído pela migração LLM)*:
  Fingerprint SHA-256 dos headers, lookup de template salvo por org, `columnMap` reutilizado sem detecção.
  **⚠️ Removido na migração LLM (Fase 3):** todo esse bloco foi descartado — o `excel-csv.ts` foi reescrito
  e a tabela `templates` não é mais alimentada. Detalhe histórico, não mais relevante para o código atual.

- ✅ **Remoção de uploads**: botão de lixeira em cada linha de "Uploads recentes" em `/upload`.
  Server action `deleteDocument` em `src/server/documents.ts`: anula `document_id` em `transactions`
  já importadas (FK sem cascade), remove arquivo do Storage, deleta registro em `documents`
  (staging em cascade pelo banco). Componente `DeleteDocumentButton` com AlertDialog + toast.

**Próxima fase: Fase 3 — Dimensões Analíticas + Categorização com IA**

> A Fase 3 expande o conceito de "categorização" para um sistema de **4 dimensões analíticas**
> independentes, todas configuráveis pela org. A categoria financeira (plano de contas) é apenas
> uma das dimensões. As outras 3 têm estrutura CRUD simples e o motor de IA sugere todas elas.
>
> Plano de contas padrão (52 categorias) já semeado em toda nova org (Fase 1.6).

### Decisões de design das dimensões

- **Uma classificação por lançamento** — sem rateio entre dimensões (ex: 60% CC-A, 40% CC-B).
  Rateio é feature futura.
- **Entidades jurídicas são mera classificação** — CNPJs (matrizes/filiais) são tratados como
  um centro de custo adicional, sem hierarquia e sem impacto no isolamento entre orgs.
- **Todas as dimensões sempre visíveis na UI** — campos aparecem mesmo se a org ainda não
  cadastrou itens. Ficam vazios até o cliente configurar em `/configuracoes`.
- **Motor de IA sugere todas as 4 dimensões** — confidence score por dimensão; threshold
  >90 → auto; 50–90 → `needs_review`; <50 → sem sugestão.
- **Classificação pós-import como caso de uso principal** — dimensões são atribuídas em
  `/transacoes` após importação. DRE filtrado por dimensão vem na Fase 6.

### Tabelas novas (Sessão 3.0 — schema)

| Tabela | Dimensão | Estrutura |
|---|---|---|
| `cost_centers` | Centros de custo | `id, organization_id, name, code?, is_active, created_at` |
| `business_units` | Unidades de negócio | `id, organization_id, name, code?, is_active, created_at` |
| `legal_entities` | Entidades jurídicas (matrizes/filiais) | `id, organization_id, name, cnpj?, is_active, created_at` |

RLS por `organization_id` em todas. Soft delete via `is_active`.

### Alterações em tabelas existentes (Sessão 3.0)

**`transactions`** — 3 colunas FK novas, todas nullable, `ON DELETE SET NULL`:
- `cost_center_id` → `cost_centers.id`
- `business_unit_id` → `business_units.id`
- `legal_entity_id` → `legal_entities.id`

**`categorization_rules`** — mesmos 3 FKs nullable:
- Uma regra pode definir categoria + centro de custo + unidade de negócio + entidade simultaneamente.

### ✅ Sessão 3.0 — Schema das dimensões *(concluída)*
- 3 novas tabelas: `cost_centers`, `business_units`, `legal_entities` + RLS
- `transactions`: colunas `cost_center_id`, `business_unit_id`, `legal_entity_id` (FK nullable, SET NULL)
- `categorization_rules`: mesmas 3 FKs + `target_category_id` tornou-se nullable
- Schemas Drizzle: `db/schema/cost-centers.ts`, `business-units.ts`, `legal-entities.ts`
- Migration aplicada: `db/migrations/rls/0008_dimensions.sql`
- TypeScript: 0 erros

### ✅ Sessão 3A — Gestão de categorias e dimensões *(concluída)*

**Páginas criadas:**
- `/configuracoes/categorias` — árvore hierárquica por tipo (revenue/cost/expense/...), inline rename, create dialog, archive/reactivate, delete com verificação de filhos e transações vinculadas
- `/configuracoes/centros-de-custo` — CRUD flat via `DimensionManager`
- `/configuracoes/unidades-de-negocio` — CRUD flat via `DimensionManager`
- `/configuracoes/entidades-juridicas` — CRUD flat via `DimensionManager` (campo CNPJ extra)
- `/configuracoes` atualizado com cards de navegação para as 4 seções analíticas

**Componentes criados:**
- `src/components/settings/dimension-manager.tsx` — CRUD genérico para as 3 dimensões flat
- `src/components/settings/category-manager.tsx` — árvore recursiva com grupos por tipo

**Server actions:**
- `src/server/dimensions.ts` — getCostCenters/create/update/toggleActive/delete/getLinkedCount × 3 dimensões
- `src/server/categories.ts` — getCategoriesWithTxCount, createCategory, updateCategory, toggleCategoryActive, deleteCategory

**Comportamento de delete:**
- Dimensões flat: ON DELETE SET NULL — avisa contagem de transações, permite delete
- Categorias: bloqueia se há filhos (RESTRICT no banco); bloqueia se há transações vinculadas

**Pendente para sessões futuras:** CSV import de categorias, templates pré-definidos (DRE Padrão/Serviços/etc.)
TypeScript: 0 erros

### ✅ Sessão 3B — Motor de categorização com IA *(concluída)*

**Arquivos principais:**
- `src/lib/categorizer.ts` — motor em 4 camadas: regra → recorrência → embeddings (stub) → Claude Haiku
- `src/jobs/categorize-transaction.ts` — job Inngest `transaction/batch-inserted`, concurrency 1 por org
- `src/server/staging.ts` — `approveAndInsert` dispara evento Inngest após inserção (retorna IDs via `.returning()`)
- `src/server/review.ts` — `getReviewQueue`, `getReviewCount`, `confirmSuggestions`, `skipSuggestions`
- `src/app/(authenticated)/transacoes/revisao/` — página de fila de revisão com aprovação/descarte em lote
- `src/app/(authenticated)/transacoes/page.tsx` — badge âmbar com contagem de sugestões pendentes

**Camadas implementadas:**
1. Regra explícita (`categorization_rules`, `op: contains`) → confidence 1.0, auto
2. Recorrência (ilike na descrição + classificação prévia na org) → confidence 0.93, auto
3. Embeddings → stub (requer API externa, não implementado)
4. Claude Haiku com prompt caching → confidence do modelo /100; ≥90% auto, 50–90% `needsReview=true`

**Comportamento pós-confirmação:** aceitar sugestão em `/transacoes/revisao` cria `categorization_rule` automática (camada 1 nas próximas importações).

**Fix complementar:** página `/upload` com polling `force-dynamic` + `router.refresh()` a cada 3s enquanto há documento processando.

### ✅ Sessão 3C — Classificação pós-importação em `/transacoes` *(concluída)*

**Arquivos principais:**
- `src/app/(authenticated)/transacoes/page.tsx` — server component com filtros via searchParams
- `src/app/(authenticated)/transacoes/transacoes-client.tsx` — client component com tabela + comboboxes
- `src/server/transactions.ts` — `getTransactions` (com filtros), `classifyTransaction`, `batchClassifyTransactions`, `upsertRule`
- `src/server/documents.ts` — `getDocumentsWithTransactions` (lista documentos com contagem de transações)
- `src/components/ui/command.tsx` — componente Command (cmdk) criado nesta sessão

**O que foi implementado (entrega inicial):**
- Tabela com as 4 dimensões sempre visíveis como **comboboxes pesquisáveis** em cada linha (sem expandir)
  - `CellCombobox` (CC, UN, Entidade) e `CategoryCellCombobox` (agrupada por tipo) — baseados em Popover + Command (cmdk)
  - Trigger com borda transparente que revela ao hover/focus
  - Busca por código ou nome dentro de cada dropdown
- FilterBar em 2 linhas com filtragem server-side via URL searchParams
  - Debounce de 400ms no campo de busca
- Classificação manual → cria ou atualiza `categorization_rule` automaticamente (`upsertRule`)
- Seleção em lote com dialog de classificação em massa (comboboxes pesquisáveis)
- Atualização otimista (revert em caso de erro) + `router.refresh()` para re-fetch server
- Paginação (25 transações/página) com estado "N encontradas" vs "N no total"
- Dependência adicionada: `cmdk`

**Melhorias de UX/funcionalidade (sessão seguinte):**
- **Filtro por importação (origem):** multi-select pesquisável como **linha 0** da FilterBar — lista cada arquivo importado com label `Tipo · mês/aa (N lançamentos)`. Multi-select permite filtrar 2 documentos simultaneamente (ex: 2 extratos para identificar transferências entre contas, ou extrato + fatura para ver pagamento de cartão). Implementado via `getDocumentsWithTransactions` em `documents.ts` + `documentId` param em `getTransactions`.
- **Filtros de dimensão viram multi-select pesquisáveis:** os 4 Selects simples (categoria, CC, UN, entidade) substituídos por `MultiSelectFilter` e `CategoryMultiSelectFilter` (Popover + Command com checkbox). URL: `?category=id1,id2`. Server action usa `inArray` + `or(isNull, inArray)` para combinar `__none__` com IDs reais.
- **X por filtro individual:** cada campo tem botão X próprio; data inputs via `DateInput` com estado local; direção com X sobreposto; multi-selects com X dentro do trigger. Botão "Limpar tudo" continua disponível.
- **Totalizador:** barra acima da tabela com Entradas / Saídas / Líquido calculados sobre **todos** os resultados filtrados (query SUM paralela no server action). Mostra contagem de lançamentos.
- **Coluna "Dt Lançamento":** header renomeado (era "Data"); formato `DD/MM/AA` com ano. Campo é `transactions.date` = data de competência do extrato/fatura. Data do período de importação (`documents.period_start/end`) é metadata do documento, não do lançamento — não exibida na tabela.
- **Ordenação:** headers "Dt Lançamento" e "Valor" clicáveis com ícones ↑ ↓ ↕. Parâmetro `?sort=date_asc|date_desc|amount_asc|amount_desc`.
- **Fix: campo de data não capturava o ano ao digitar.** Causa: input controlado disparava `onChange` com ano parcial (ex: `0002-01-15`), `router.push()` causava re-render e resetava o campo. Solução: componente `DateInput` com estado local — URL só atualiza quando ano ≥ 2000.
- TypeScript: 0 erros

### ✅ Melhorias em `/transacoes` (sessão pré-3B)

- **Fix label filtro por importação** (`transacoes-client.tsx`): label agora sempre exibe o nome do arquivo (`Tipo · nome-do-arquivo (N)`), nunca o período. Resolve o bug onde dois documentos do mesmo mês e tipo geravam labels idênticos e pareciam ser um só.
- **Delete de lançamentos**: ícone de lixeira por linha (hover) + botão "Apagar selecionados" na toolbar de seleção em lote. AlertDialog de confirmação em ambos os casos. Server action `deleteTransactions(ids[])` em `src/server/transactions.ts` — deleta só dentro da `organization_id` do usuário, limite 500 por operação.
- TypeScript: 0 erros.

### ✅ Parser Excel/CSV/TXT — Migrado para Claude Haiku *(concluído)*

O parser determinístico (`excel-csv.ts`) foi **substituído por parsing via LLM**, mesmo padrão já usado para PDF.

**Problema que motivou a mudança:** heurísticas de detecção de colunas falhavam sistematicamente em formatos reais BR:
- CSVs sem cabeçalho (ex: Bradesco/BB/Itaú extrato): `02/12/2024;PIX TRANSF;-410,00` → tudo null
- Cabeçalho com BOM + texto de acessibilidade (Nubank/Azul Itaucard) → header não reconhecido
- Excel com 20+ linhas de metadata antes dos dados (Itaú fatura XLS) → `findHeaderRow` limitado a 10 linhas
- Datas `"31 jul."` e valores com câmbio inline → parser não suportava

**Implementação:**
- `src/lib/parsers/excel-csv.ts` reescrito: ~350 linhas → ~107 linhas
  - `fileToText(buffer, mimeType)`: CSV/TXT → `buffer.toString('utf-8')` direto; Excel → SheetJS lê binário + `sheet_to_csv()` → texto puro
  - `parseExcelOrCsv(buffer, mimeType)` agora async: envia texto ao Claude Haiku como `content: [{ type: 'text', text }]`
  - Mesmo system prompt e funções de parsing JSON do `pdf.ts`
- `src/jobs/process-document.ts` simplificado: ~228 linhas → ~112 linhas
  - Template system removido (fingerprint, lookup, save, increment)
  - `INVERT_DIRECTION_SOURCES` removido — unificado em `DEFAULT_OUTFLOW_SOURCES` para ambos os formatos
  - Step `parse-excel-csv` e `parse-pdf-llm` unificados em lógica idêntica
- Tabela `templates` mantida no schema mas não mais alimentada pelo pipeline de upload

**Custo:** US$ 0,001–0,012 por upload (dentro do target de US$ 0,50/1.000 transações).
TypeScript: 0 erros. Testado: CSV sem cabeçalho + CSV com BOM/acessibilidade + XLS com metadata → extração correta.

### Ordem de implementação

```
✅ 3.0 (schema) → ✅ 3A (configurar dimensões) → ✅ 3C (classificar pós-import) → ✅ parser LLM → ✅ 3B (automatizar)
```

> **Impacto futuro no DRE (Fase 6):** as dimensões viram filtros e agrupadores nativos
> do DRE — "DRE do Restaurante", "DRE do Centro de Custo Comercial". A estrutura definida
> aqui suporta isso sem retrabalho.

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
