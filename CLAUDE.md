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
- `/lib/parsers` — parsers determinísticos por formato (excel-csv.ts; futuros: pdf.ts, ofx.ts)
- `/server` — server actions, lógica de backend
- `/jobs` — definições Inngest
- `/db` — schema Drizzle, migrations
- `/prompts` — prompts pro expert (system prompts, tools), separados em arquivos
- `/docs` — todos os documentos de planejamento e referência

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

**Fase 2 — Pipeline de Ingestão de Arquivos (EM ANDAMENTO)**

> Pipeline completo de upload → parsing → staging → revisão → inserção em transactions.
> 5 áreas (ERP, banco, adquirente, cartão de crédito corporativo, SEFAZ-placeholder),
> formato livre (PDF/Excel/CSV), templates híbridos global/específico, deduplicação em
> duas camadas, reconciliação automática AP×banco.

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
  PDFs/imagens redirecionados para `pending_llm` (Fase 2.5). Testado: 160 linhas extraídas, 0 warnings.
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

Próxima sessão: **2.5 — Parser PDF via LLM**
- PDFs enviados ficam em `extractionStatus: 'pending'` com `extractionMethod: 'llm'` — nunca avançam
- Implementar step no `processDocument` que, para PDFs: extrai texto, chama Claude Haiku com prompt
  estruturado, recebe JSON de linhas, insere em `transactions_staging` igual ao fluxo Excel/CSV
- DoD: subir um PDF de extrato bancário e ver as linhas aparecerem na tela de revisão (pode ser mais lento)

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
