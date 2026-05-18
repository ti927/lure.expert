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

**Migration `db/migrations/rls/0011_emprestimos_e_investimentos.sql` (aplicar manualmente no Supabase Studio):**
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
- Open Finance via: [Belvo ou Pluggy — definir antes da Fase 4 amplificadora]
- SEFAZ via: [provedor — definir antes da Fase 7 amplificadora]
- Custo de IA: interno (Lure paga, embutido no pricing). Sem BYO API key.
- Provedor de IA: Anthropic apenas. Multi-LLM diferido.
- Tipo C de mutações (autônomas): fora do escopo no MVP e MVP+1.
- Pricing final: decisão na Fase 10. Recomendação atual: tier por porte
  com uso justo implícito.
- Limites por plano: [definir antes da Fase 10]
