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
3. **Haiku para tudo.** O chat Sonnet morreu na Fase 0; sobraram tres
   consumidores, todos Haiku: categorizador e os dois parsers.
4. **Ative prompt caching em system prompts longos.**
5. **Operações pesadas vão pra Inngest, nunca síncronas.**
6. **Tudo em português** (interface, dados, comentários de código).
7. **Antes de gerar texto pelo expert, leia `docs/AI_VOICE.md`.** Tom é
   "especialista calmo, direto, sem firulas".
8. **Antes de criar componente novo, verifique se já existe** em `/components/ui`,
   `/components/financial`, `/components/states`,
   `/components/transacoes-shared` e `/components/budget`. Quando duas telas
   precisarem do mesmo componente, **mova** o existente para `/components/` e
   atualize os imports **no mesmo commit** — nunca duplique "por enquanto".
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
14. **REVOGADO na Fase 0 (23/ago/2026).** Dizia: *"Custo de IA é interno (Lure
    paga). NÃO expor 'tokens' ao cliente."* Passou a valer o contrário — chave
    de IA **própria por organização, obrigatória**, e a visibilidade do consumo
    **depende de quem paga**: organização com chave própria vê tokens e R$;
    organização na chave da plataforma (exceção explícita, `aiKeySource`) vê
    unidades de valor. **Motivo:** havia clientes usando o app sem supervisão e
    consumindo os créditos da Lure, sem teto, alerta nem atribuição. Toda
    medição vive em `agent_events`, escrita só por `registrarUsoDeIa`.
15. **REVOGADO na Fase 0.** Dizia que a memória do expert era híbrida
    (`conversations`+`messages` + `organization_facts` curada). O chat morreu e
    as três tabelas ficaram sem escritor. O papel de memória passa ao Project do
    claude.ai, com `docs/AI_VOICE.md` como instrução e o MCP como ferramentas.

## Stack
- Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
- Supabase (Postgres + Auth + Storage + pgvector)
- Drizzle ORM
- Inngest pra jobs em background
- Anthropic SDK (Claude Haiku 4.5 apenas — o Sonnet saiu com o chat na Fase 0)
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
- `/components/financial` — CurrencyDisplay, PercentageDelta, KPICard, DataTable, `Num` (célula das matrizes de 12 meses)
- `/components/states` — EmptyState, LoadingState, ErrorState, PartialDataBanner
- `/components/layout` — AppShell, Sidebar (criados na Fase 0.5)
- `/components/transacoes-shared` — o que /transacoes, /dre, /fluxo e /balanco compartilham:
  `DrillDownDialog`, `ColHeader`, filtros (`MultiSelectFilter`, `DescFilter`, `AmountFilter`,
  `DirectionFilter`), `DimFilter`, `CellCombobox`, `CategoryCellCombobox`, `BatchClassifyDialog`,
  e o rateio: `AllocationDialog`, `BatchAllocationDialog`, `WeightRowsEditor` (a tabela peso +
  4 dimensões, do lote e do editor de modelos), `AllocationTemplateBar`
- `/components/budget` — o que /orcamento e /dre compartilham: `SeriesDialog` (criar/editar
  lançamento, com os 3 escopos), `ScopeConfirmDialog`, `BudgetDrillDownDialog`
- `/lib` — utilitários, clientes (supabase, anthropic, inngest)
- `/lib/parsers` — parsers via LLM: `excel-csv.ts` (Excel/CSV/TXT → Claude Haiku), `pdf.ts` (PDF → Claude Haiku document API)

**Lógica que vive em `/lib` e NÃO em `/server`.** A diretiva `'use server'` só deixa exportar função
async, e — mais importante — o que está fora dela pode ser exercitado direto contra o banco num
script, sem sessão HTTP. É como o miolo de cada feature acaba testado:

| Arquivo | O que concentra |
|---|---|
| `dre-calc.ts` | `computeSubtotals` (cascata do P&L), `generateMonthRange`, `verticalShare` (AV%) |
| `dre-layout.ts` | `LAYOUT`, `buildBlocks` genérico (árvore Tipo → Pai → Filho) |
| `sql-dimensions.ts` | `dimensionFilters(alias, filtros)` — o único trecho que entra via `sql.raw` |
| `format.ts` | `fmtNum`/`fmtMoney`/`fmtBRL`/`fmtPct`/`fmtPctSigned`, `monthLabel`, `parseAmount` |
| `budget-types.ts` | constantes, Zod e tipos do orçamento (importável pelo cliente) |
| `budget-recurrence.ts` | `expandSeries` — expansão pura, o que permite o preview ao vivo no diálogo |
| `budget-scope.ts` | `planSeriesUpdate` (decisão pura) + `applySeriesUpdate`/`Delete` (recebem o `tx`) |
| `budget-copy.ts` | `buildCopyDrafts`, `shapeMonthly`, `collectActuals`, `applyDraftsToBudget`, `applyDuplicateVersion` |
| `budget-import.ts` | `parseBudgetCsv`, `buildRecurrenceCandidates`, `timesPerMonth` |
| `budget-read.ts` | `fetchBudgetRows` — a leitura do orçado que `/dre` e `/orcamento` compartilham |
| `allocation-math.ts` | aritmética do rateio em centavos inteiros: `toCents`, `splitEqually`, `applyProportion` (maior resto), `reduceWeights` (MDC), `normalizeWeights`/`formatProportion` |
| `ai-pricing.ts` | tabela de preço por modelo, `calcCostUsd`, conversão USD→BRL, `estimarCustoCategorizacao` |
| `oauth/tokens.ts` | geração e hash (SHA-256) dos tokens, TTLs, `tokenVivo` — **revogação vence validade** |
| `oauth/pkce.ts` | PKCE só com `S256`; `plain` é recusado porque anularia a proteção |
| `oauth/clients.ts` | registro dinâmico (RFC 7591), validação de redirect por igualdade **exata**, catálogo de escopos |
| `crypto.ts` | AES-256-GCM para segredos que precisam **voltar** ao texto claro (a chave da Anthropic do cliente). Nada a ver com `encryptApiKey` de `sefaz.ts`, que é só base64 |
| `ai-key-test.ts` | `testarChaveAnthropic` — chamada de 1 token que valida a chave antes de gravá-la, com erro traduzido para algo acionável |
| `ai-access.ts` | `resolverAcessoIa(organizationId, exec?)` — o funil que responde "pode chamar a IA agora, e com qual chave?". Recusa é descritiva, não exceção |
| `ai-usage.ts` | `registrarUsoDeIa` — **único ponto de escrita de custo em `agent_events`** — e `tokensDaResposta` |
| `query/scope.ts` | `QueryScope` (tipo marcado) + `scopeFromSession`/`scopeFromMcpGrant`/`scopeFromJob`. Nenhum construtor emite sem confirmar membership aceita |
| `query/spec.ts` | `querySpecSchema` — **um Zod, três consumidores**: motor, ferramenta MCP `consultar` e bloco de dashboard |
| `query/engine.ts` | `runQuery` — a **única** função de `lib/query/**` que chama o banco — e `explicarQuery` |
| `query/sources/` | um descritor por fonte. **A fonte não escreve a cláusula de organização**; o motor a emite a partir de `orgColumn` |
| `query/derive.ts` | `withSubtotals` — a cascata do P&L sobre o resultado do motor, envolvendo `computeSubtotals` |
| `dashboard/block-spec.ts` | `blockSpecSchema` — a spec de bloco, que **embute `querySpecSchema`**. Validada na escrita E na leitura |

**A regra que separa leitura analítica de operacional** (Fase 1):

> **Analítica** (agrega, agrupa, soma) → passa pelo motor → lê `transaction_lines`, conta com
> `COUNT(DISTINCT transaction_id)`.
> **Operacional** (uma linha por lançamento) → lê `transactions` → filtra dimensão com
> `dimensionExistsFilter`.

Sem rateio a view degenera na linha de hoje, então nenhum número muda; com rateio o número
conserta. `getTransactions` e a fila de revisão já estão do lado certo.
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
- NÃO chamar LLM em código síncrono (sempre via Inngest)
- NÃO commitar `.env`
- NÃO usar emoji em texto gerado pelo expert (ver AI_VOICE.md)
- NÃO referir-se aos agentes como "IA", "assistente" ou "Lure" — sempre
  "expert"
- NÃO chamar a Anthropic sem passar por `registrarUsoDeIa` — o que não é
  medido não entra em teto
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

**Status:** Fase 10 — Dimensões (cliente/fornecedor + rateio) **concluída** (10.0 a 10.5 ✅).
Fase 9 — Orçamento e Previsão **concluída** (9.0 a 9.8 ✅). Fases 0–7 **100% concluídas**.
Fase 8 (Adquirentes) pausada em 8.1.

**Renumeração:** a Fase 10 passou a ser Dimensões; Agente Proativo vira **11** e
Onboarding/Billing vira **12**.

**Sessões — orçado na DRE:**
- ✅ 9.6: Terceira coluna por mês + análise vertical (AV% sobre a Receita Líquida). Cabeçalho de duas linhas, `verticalShare` em `lib/dre-calc.ts`, `tone="muted"` no `Num`
- ✅ 9.7: Orçado lado a lado — botão Orçamento + seletor de versão na barra; a terceira coluna vira Var%. `lib/budget-read.ts` (`fetchBudgetRows`) é a MESMA query que a aba Orçado × Realizado usa
- ✅ 9.8: Drill-down do orçado na DRE + edição do lançamento pelo `SeriesDialog`. `components/budget/` reúne `series-dialog`, `scope-confirm-dialog` e o novo `budget-drilldown-dialog` (extraído da aba de comparação)

**A regra da terceira coluna:** ela existe sempre e troca de significado. Orçamento **oculto** → `Valor`
+ `AV%` (variação vertical, participação na Receita Líquida). Orçamento **visível** → `Real` + `Orç` +
`Var%` (variação horizontal, desvio sobre o orçado). A coluna Total segue a mesma regra. As duas leituras
nunca aparecem juntas. Ver `docs/SCHEMA_DECISIONS.md` 13.14 e 13.15.

## Próximo passo

**Em andamento: o plano de motor de consulta + MCP + dashboard configurável**, aprovado em
23/ago/2026. Plano completo em `C:\Users\Julio\.claude\plans\glimmering-discovering-wirth.md`.

| Fase | Entrega | Status |
|---|---|---|
| 0 | Corte do chat + medição de IA + tela de consumo + fix do `forceRun` | ✅ (aguardando confirmação na tela) |
| 1.0 | Motor de consulta: escopo, spec Zod, fonte `realizado`, `runQuery` | ✅ (aguardando confirmação na tela) |
| 1.1 | ~~Organização ativa (cookie + seletor)~~ **adiada** — cada usuário tem exatamente 1 organização hoje, e Julio não tem vínculo nas dos clientes. Volta com os convites, na Fase 4. Só o `orderBy` latente foi corrigido | ⏸️ |
| 1.2 | Fontes `orcado` e `nfe`. `balanco` **não entrou**: é snapshot por documento e não há um único documento de balanço no banco para conferir contra | ✅ (aguardando confirmação na tela) |
| 1.3 | `getTopExpenseCategories` e `getCashFlowChart` migradas para o motor + `derive.ts` (cascata do P&L) + agrupamento por `dia` | ✅ (aguardando confirmação na tela) |
| 1.4 | Tabelas de dashboard (migration 0028) + `block-spec.ts` antecipados da Fase 5 | ✅ |
| 2.0 | Chave de IA por organização (AES-256-GCM), teto, alerta e degradação — **backend** | ✅ |
| 2.1 | Tela de cadastro da chave e do teto | ✅ (aguardando confirmação na tela) |
| 3.0 | Miolo do OAuth: tabelas `mcp_oauth_*` (migration 0030), tokens com hash, PKCE, validação de cliente | ✅ migration aplicada e conferida |
| 3.1 | Endpoints OAuth: descoberta, registro dinâmico, `/authorize` com consentimento, `/token`, `/revoke` + tela de conexões | ✅ (aguardando confirmação na tela) |
| 3.2 | Servidor MCP + ferramentas de leitura | ✅ 6 ferramentas: `listar_organizacoes`, `descrever_organizacao`, `listar_categorias`, `listar_dimensoes`, `consultar`, `explicar_consulta`. Falta `detalhar_lancamentos` e o grupo de dashboard (Fase 5) |
| 3.3 | Ferramentas de escrita com preview→confirm | ◐ máquina pronta (`lib/mcp/preview.ts`) + o primeiro par: `prever_`/`aplicar_classificacao_em_lote`. Faltam rateio, regras, orçamento e importação |
| 4 | Convites e papéis | 🔲 |
| 5 | Dashboard configurável | 🔲 |

**A regra de roteamento que a 3.1 estabeleceu** — vale para tudo que vier no MCP:

> **`/oauth/*`** é HUMANO: autentica por cookie, passa pelo middleware, pode usar `redirect()`.
> A tela de consentimento e a rota de decisão moram aí.
> **`/api/oauth/*`** e **`/api/mcp`** são MÁQUINA: a credencial vai no corpo, não veem cookie,
> e ficam **fora do matcher do middleware** — `updateSession` faria uma ida ao Supabase por
> requisição sem nenhum cookie para renovar, e penduraria `Set-Cookie` numa resposta JSON.

Consequência prática: a rota de decisão do consentimento é `POST /oauth/authorize/decidir`
(route handler, não server action) porque o que ela faz de mais importante é um **303 para um
endereço externo** combinado com o cliente OAuth — um handler emite isso nativamente, e uma
server action dependeria de o roteador do cliente traduzir o redirecionamento. Como ela
autentica por cookie, é a única das rotas de OAuth que precisa de defesa de CSRF: confere
`Origin` (com `Referer` de mesma origem como segunda prova).

**Pendência da Fase 0:** o `DROP` de `organization_facts` → `messages` → `conversations`
espera Julio confirmar que não quer o histórico do chat. As três têm FK entre si, então saem
juntas ou não saem. Ao dropar, remover as três de
`db/migrations/rls/test_rls_isolation.sql` no mesmo commit — o script lista tabelas
nominalmente e já quebrou assim na migration 0015.

---

### Frentes anteriores, ainda abertas

| Frente | O que falta | Tamanho |
|---|---|---|
| **Fase 8 — Adquirentes** (pausada em 8.1) | 8.2 upload de extratos, 8.3 Cielo, 8.4 reconciliação lote × vendas, 8.5 UX + MDR | média |
| **Fase 11 — Agente Proativo** | job diário de insights, alertas WhatsApp/e-mail, fechamento mensal narrado | ~2 semanas |
| **Fase 12 — Onboarding, Billing, Lançamento** | onboarding guiado, Stripe, planos com limites, trial que expira, `/pricing` | 2–3 semanas |
| **Contato pela NF-e** (avulsa) | `invoices.contact_id` existe e nunca foi escrito; alimentaria sozinha a dimensão da Fase 10 | curta |
| **`vercel.json` com `regions`** | versionar a região `gru1`, hoje só no painel (ver Infraestrutura) | trivial |

Recomendação registrada: **contato pela NF-e** tem a melhor relação custo/benefício agora — é curta
e faz o cadastro de contatos crescer sozinho, que hoje depende de digitação. Se a prioridade for
vender, a **Fase 12** é a que destrava.

---

**Fase 10 — Dimensões: cliente/fornecedor e rateio. CONCLUÍDA.** Migrations 0025, 0026 e 0027
aplicadas e conferidas contra o banco; 10.4 e 10.5 confirmadas na tela.

| Sessão | Entrega | Status |
|---|---|---|
| 10.0 | Cadastro de contatos (migration 0025, CRUD, rota, CSV) + conserto do `__null__` | ✅ |
| 10.1 | Contato como 4ª dimensão nas telas: filtro, coluna, batch, regras, Haiku | ✅ |
| 10.2 | Schema do rateio: `transaction_allocations` + view `transaction_lines` | ✅ |
| 10.3 | As leituras que filtram/agrupam por dimensão passam a respeitar o rateio | ✅ |
| 10.4 | UI do rateio: diálogo por lançamento, linha expansível, rateio em lote | ✅ |
| 10.5 | Modelos de rateio reutilizáveis (migration 0027) | ✅ |

**Modelo do rateio (revisto na 10.2 — ver `docs/SCHEMA_DECISIONS.md` Decisão 16):** rateio é
**sub-lançamento**, não percentual por dimensão. Um lançamento de R$ 999 vira N partes com valor
próprio, e **cada parte carrega as quatro dimensões**. O desenho anterior (divisão independente por
dimensão, cruzada por uma view) foi descartado por inventar combinações que o cliente nunca afirmou
e por reintroduzir fração de centavo na multiplicação das proporções.

A **natureza NÃO é rateada** (um lançamento tem uma categoria só, então nenhuma linha da DRE se
parte); `/transacoes` mostra **uma linha por lançamento, expansível**; **só o realizado** — o
orçamento segue com uma dimensão por lançamento. Armazenamento: `transaction_allocations` (valor
por parte, Σ = `transactions.amount` **exato**) + view `transaction_lines` com
`security_invoker = true`. Sem rateio a view devolve exatamente a linha de hoje.

**As regras vivem no banco**, num `CONSTRAINT TRIGGER` deferido até o commit: ou zero partes, ou
soma exata; com rateio as dimensões do lançamento pai ficam vazias; teto de 50 partes. Editar o
valor de um lançamento rateado é recusado até as partes fecharem o novo total.

**Fase 8 — Connectors de Adquirentes**, pausada em 8.1 (Stone). Faltam 8.2 (upload de extratos),
8.3 (Cielo), 8.4 (reconciliação lote × vendas) e 8.5 (UX + MDR).

Candidatas avulsas, nunca comprometidas:
- Expert lendo o orçamento no system prompt ("você está 18% acima do orçado em SG&A")
- Orçado no `/fluxo`, por data de caixa — a mecânica da DRE serve, mudando o regime
- Contato preenchido automaticamente pela NF-e (`invoices.contact_id` existe e nunca foi escrito)

**Renumeração:** o módulo de Orçamento assumiu o número 9. As fases antes numeradas
9 (Agente Proativo) e 10 (Onboarding/Billing) passam a **10** e **11**.

**Sessões Fase 9 — Orçamento:**
- ✅ 9.0: Schema (`budget_versions`, `budget_series`, `budget_entries`), migration 0024, `budget-types.ts`, `budget-recurrence.ts` (expansão pura), extrações `dre-calc.ts` / `sql-dimensions.ts` / `auth-context.ts`
- ✅ 9.1: `src/server/budget.ts` (13 server actions), rota `/orcamento` com 3 abas, `series-dialog.tsx` com os 4 modos e preview ao vivo, tabela de séries com ocorrências expansíveis e edição inline, aba Versões, item na sidebar
- ✅ 9.2: Aba Orçado × Realizado — matriz 12 meses, toggle Competência/Caixa, 4 modos de célula, colunas Orçado ano / Realizado YTD / Projeção ano / Var. proj., drill-down duplo. Extrações `dre-layout.ts`, `num-cell.tsx`, `dim-filter.tsx`
- ✅ 9.3: Escopos de edição/exclusão (esta / daqui / todas) com preservação de ajustes manuais, confirmação two-phase e auto-cura. Lógica pura em `lib/budget-scope.ts`
- ✅ 9.4: Copiar do realizado (prévia + commit, 2 eixos: formato mensal/média × detalhamento categoria/dimensões) + duplicar versão (CTE único com mapa old→new de `series_id`, preserva `adjusted_fields` e `sequence`). Lógica em `lib/budget-copy.ts`
- ✅ 9.5: Importar planilha (grade de 12 meses, prévia+commit, linha inválida não derruba o arquivo) + aceitar recorrências detectadas (com mensalização e categoria obrigatória). Lógica em `lib/budget-import.ts`

**Decisões estruturais do orçamento** (ver `docs/SCHEMA_DECISIONS.md` Decisão 13): orçado em
tabelas separadas de `transactions`; ocorrências materializadas em `budget_entries` (fonte da
verdade) geradas por `budget_series` (regra); `adjusted_fields text[]` protege edições manuais
de alterações em lote; exercício = ano civil validado só na competência (caixa pode vazar);
duas datas por lançamento (`competence_date` → DRE Orçada, `cash_date` → Fluxo Projetado).

**Sessões Fase 8 (pausada):**
- ✅ 8.0: Schema `acquirer_connections`, migration 0023, `acquirer-provider.ts` (Abstract + Stone/Cielo/Rede stubs), server actions CRUD, aba Adquirentes em `/contas`
- ✅ 8.1: Stone connector real (`stone-client.ts` OAuth2, `StoneProvider` implementado, job `sync-acquirer-item`, cron `sync-all-acquirer-items`)
- 🔲 8.2: Upload de extratos de adquirentes (CSV/PDF fallback)
- 🔲 8.3: Cielo connector
- 🔲 8.4: Reconciliação lote bancário × vendas individuais
- 🔲 8.5: UX polish + MDR calculado

**Hardening intercalado (sessão de incidente, fora de fase):**
- ✅ Fix connect Pluggy em produção — clicar "Conectar conta" dava 500. Diagnóstico via `vercel logs`: `HTTPError 400` da API Pluggy (`clientId must be a UUID`), não BOM/ByteString. Causa raiz: caractere invisível (newline/BOM/zero-width) colado no `PLUGGY_CLIENT_ID`/`SECRET` na Vercel — reproduzido 1:1 (`clientId + "\n"` → 400). Fix: `sanitizeSecret()` em `getPluggyClient()` apara as pontas (code points, sem invisíveis no fonte), cobrindo o último consumidor de credencial que ainda não sanitizava. Commit `602a6cd`. Detalhes em `docs/SESSION_LOG.md`.
- ✅ Pipeline de upload — chunking do parser Haiku (120 linhas/call), catch loud em `documents.ts` (falha de `inngest.send` agora deleta doc e retorna erro visível), watchdog cron `*/10 * * * *` que marca docs travados em `pending` >15min ou `processing` >30min como `failed`, `maxDuration=300` na rota `/api/inngest`. Commit `178c0f8`. Detalhes em `docs/SESSION_LOG.md`.
- ✅ Parser CSV redesenhado — substitui chunking + LLM-por-linha por `csv-parse` determinístico. LLM agora chamado **uma vez** por upload, só pra detectar índice das colunas semânticas (date/amount/description/direction). Fallback heurístico por keyword em PT-BR se LLM falhar. Tempo: 1.3s vs 3-5min anteriores. Commit `46b43cc`. Detalhes em `docs/SESSION_LOG.md`.
- ✅ UX upload review + categoryHints — banner "Marcar todas como Entrada/Saída" pra CSVs sem coluna explícita de direção; `__categoryHints` em `rawData` propagado pra `metadata.categoryHints`, injetado no prompt do Haiku como sinal forte. Commit `895dd83`.
- ✅ UX /transacoes — seletor `?pageSize=100/500/1000` no rodapé, persistido em `localStorage` via `FILTER_KEYS`. Helper compartilhado em `src/lib/transactions-page-size.ts` (fora de arquivo `'use server'`, que rejeita exportar constantes). Limite de delete em lote subiu de 500 → 1000. Commits `000ebc3` / `8948106` / `37b5c30`.
- ✅ Hardening pipeline de categorização — 4 fixes encadeados: catch loud em `approveAndInsert` (com flag `categorizationDispatched` pro frontend), chunking interno do `categorize-transactions` em `step.run`s de 50 (sobrevive ao maxDuration=300 do Vercel), chunking de evento `transaction/batch-inserted` em 3000 IDs/event (limite real do Inngest é 256KB, não 512KB — `sendCategorizationEvents` helper em `lib/inngest.ts`), sanitização de BOM/zero-width nas envs Anthropic e Inngest no startup (causa do `TypeError: Cannot convert argument to a ByteString`). Commits `b040a23` / `37026ef` / `cec830a` / `2bd4cf1`. Detalhes em `docs/SESSION_LOG.md`.
- ✅ Layer 0 de categorização — match determinístico do CSV antes do LLM. Parser detecta colunas autoritativas (`Categoria/Natureza Pai/Filho`, `Conta Contábil`, `Plano de Contas`, `Tipo Natureza`) por regex no header. `findCategoryByCsvMapping` faz lookup normalizado (lowercase + sem acento + colapsa dash/barra/parênteses em espaço). Desempate cumulativo: nome → tipo (`TIPO_ALIASES`: `Receita`→`receita_operacional`, `CMV`/`CPV`→`cpv`, etc) → pai. `approveAndInsert` pré-classifica no INSERT (linhas casadas não entram no evento Inngest). Resultado: CSVs de ERP com plano alinhado importam zero-Haiku. Commits `d587644` / `d72ec37` / `35400e6`. Decisão arquitetural em `docs/SCHEMA_DECISIONS.md` Decisão 12.

**Migrations aplicadas no Supabase Studio:**
- ✅ `db/migrations/rls/0017_category_visibility_flags.sql` — `hide_in_dre` e `hide_in_cashflow` em `categories`
- ✅ `db/migrations/rls/0018_transactions_account_fields.sql` — `account_id`, `account_number`, `account_type`, `account_name` em `transactions`
- ✅ `db/migrations/rls/0019_reset_categorization_rules.sql` — `DELETE FROM categorization_rules` (reset para introduzir escopo por accountId)
- ✅ `db/migrations/rls/0020_category_opex_capex.sql` — `opex_capex text NOT NULL DEFAULT 'opex'` em `categories`; seed defaults CAPEX para tipos 8/9/10
- ✅ `db/migrations/rls/0021_staging_effective_date.sql` — `effective_date text` em `transactions_staging`
- ✅ `db/migrations/rls/0022_sefaz_invoices.sql` — tabelas `sefaz_connections` e `invoices` + coluna `invoice_id` em `transactions` + RLS em ambas
- ✅ `db/migrations/rls/0023_acquirer_connections.sql` — tabela `acquirer_connections` + RLS
- ✅ `db/migrations/rls/0024_budget.sql` — `budget_versions`, `budget_series`, `budget_entries` + índices + CHECKs + RLS (12 policies) + 3 triggers `updated_at`
- ✅ `db/migrations/rls/0026_transaction_allocations.sql` — `transaction_allocations` + view `transaction_lines` + RLS + os gatilhos da invariante do rateio. Aplicação conferida contra o banco (22/22): 12 colunas, 2 CHECKs, 6 índices, RLS com as 4 policies, os 2 gatilhos com `tgdeferrable` e `tginitdeferred` verdadeiros, `security_invoker=true` na view, e as regras exercitadas de verdade — soma que não fecha, dimensão no pai, edição do valor e 51 partes recusadas, tudo revertido ao fim
- ✅ `db/migrations/rls/0030_oauth_mcp.sql` — `mcp_oauth_clients`, `mcp_oauth_access_grants`, `mcp_oauth_authorization_codes`, `mcp_oauth_tokens` + 5 índices + 6 CHECKs + 4 FKs + RLS (2 policies, só em `access_grants`). **Prefixo `mcp_` obrigatório:** o Supabase já tem `auth.oauth_clients`, `auth.oauth_consents` e `auth.oauth_authorizations` — conferido no banco. Validada antes (45/45 com ROLLBACK) e conferida depois contra o banco (33/33): os **3 guardas de array vazio usando `cardinality`** e não `array_length`, `S256` preso no CHECK, os 2 índices parciais, `token_hash` UNIQUE, 3 FKs em CASCADE e `replaced_by` em SET NULL — e as regras exercitadas de verdade: PKCE `plain` recusado, consentimento sem organização e sem escopo recusados, hash duplicado recusado, apagar o token substituído deixando o novo vivo, e apagar o cliente levando consentimentos, códigos e tokens pela cadeia
- ✅ `db/migrations/rls/0029_organization_ai_settings.sql` — `organization_ai_settings` (chave cifrada, teto, alerta) + 5 CHECKs + RLS (4 policies) + trigger + **backfill das organizações existentes em `'platform'`**. Validada antes (22/22 com ROLLBACK) e conferida depois contra o banco: `numeric(10,2)` no teto, os 5 CHECKs, as 4 policies, e o backfill com 6/6 organizações em `platform` e nenhuma chave cadastrada
- ✅ `db/migrations/rls/0028_dashboards.sql` — `dashboards` + `dashboard_blocks` + `dashboard_shares` + 8 índices + RLS (12 policies) + 2 triggers `updated_at`. Validada antes (24/24 com ROLLBACK) e conferida depois contra o banco (27/27 no total das duas): índice parcial do painel padrão, índice único do alvo de compartilhamento, CASCADE do painel para blocos, e as regras de coerência recusando de verdade
- ✅ `db/migrations/rls/0027_allocation_templates.sql` — `allocation_templates` + `allocation_template_lines` + `transaction_allocations.allocation_template_id` + 5 índices + RLS (8 policies) + 2 triggers `updated_at`. Validada antes com ROLLBACK (19/19) e conferida depois contra o banco (22/22): `weight numeric(18,6)`, os 3 CHECKs, CASCADE da linha, SET NULL no carimbo e nas 4 dimensões, índice único e índice parcial, RLS com as 4 policies em cada tabela, e as regras exercitadas de verdade — nome duplicado por caixa/espaço recusado, peso de 9 dígitos e de 6 decimais gravados, CASCADE ao apagar o modelo, tudo revertido ao fim
- ✅ `db/migrations/rls/0025_contacts_dimension.sql` — `contacts` ganha `is_active`, `code`, `is_customer`, `is_supplier` + policy de DELETE (faltava desde a 0002) + `ON DELETE SET NULL` nas FKs de `transactions.contact_id` e `categorization_rules.target_contact_id` (eram `no action`). Aplicação conferida contra o banco: colunas, defaults, índice, 4 policies e `confdeltype = 'n'` nas duas FKs

**Scripts de teste RLS (`db/migrations/rls/`):**
- `test_rls_budget.sql` — migration 0024: estrutura, CHECKs, triggers e isolamento das 3 tabelas de orçamento
- `test_rls_isolation.sql` — as 14 tabelas gerais. Era 18; a migration 0015 dropou `fixed_assets`, `loans`, `equity_movements` e `inventory_snapshots`, e o script ficou quebrado desde então (`relation "fixed_assets" does not exist`) até ser corrigido na sessão 9.0

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
| **Motor + MCP (plano de 23/ago)** | |
| 3.3 (primeiro par) | Escrita pelo MCP. **A prévia mora em `agent_events`, sem tabela nova** — é onde o princípio 10 já manda registrar proposta/confirmação/aplicação, e o id do evento É o `previaId`. Três dentes, porque sem eles preview+confirm é decoração quando quem confirma é o próprio modelo: (1) `aplicar_` exige a palavra literal `"aplicar"`, o que faz o texto da confirmação aparecer na conversa onde o humano lê; (2) o apply **recalcula e compara** com o resumo gravado — divergiu contagem ou total, recusa, porque aplicar sobre fotografia velha apaga o trabalho de outra pessoa; (3) a prévia é consumida **atomicamente** (`UPDATE … WHERE payload->>'consumidoEm' IS NULL RETURNING`, o mesmo truque do código OAuth). O filtro é **estreito de propósito** e o Zod recusa filtro vazio — sem isso ele casaria com a base inteira. **Lançamento rateado sai do lote** quando a classificação mexe em dimensão: o gatilho da 0026 recusaria, e um único rateado derrubaria o lote todo; a prévia conta quantos ficaram de fora. `dimensionSchema`, `assertLeafCategory`, `upsertRule` e o miolo **mudaram de casa** para `lib/transactions-write.ts` (não foram copiados) e `batchClassifyTransactions` virou casca. Verificado: **31/31 numa organização criada só para o teste** — escrever no dado de um cliente para testar seria reclassificar a contabilidade dele |
| 3.2 (fatia fina) | `/api/mcp` — servidor MCP **sem sessão**, e isso não é simplificação: numa função serverless instâncias diferentes atendem requisições seguidas e não compartilham memória, então um servidor com sessão em memória funcionaria no teste e falharia em produção. **Sem SDK**: o Streamable HTTP sem sessão é um POST com JSON entrando e saindo, e o que o spec exige de nós — audiência, `WWW-Authenticate` no 401, não vazar `redirect()` — não está em SDK nenhum. `resources/list` e `prompts/list` devolvem lista vazia em vez de erro: alguns clientes perguntam mesmo sem o servidor anunciar, e o erro aparece como conexão quebrada. Argumento inválido volta como `isError` no resultado, **não** como erro de protocolo — assim o modelo lê e corrige; erro de protocolo o cliente trata como falha de transporte. `z.toJSONSchema(…, { io: 'input' })`: no modo de saída todo campo com `.default()` viraria obrigatório e o modelo preencheria `filtros`, `limite` e `ordenarPor` à força em toda chamada. A barreira `src/lib/mcp/**` → `src/server/**` virou `no-restricted-imports` no ESLint, testada quebrando de propósito. Verificado: **31/31 contra `next start`**, com usuário e organização REAIS (usuário sintético devolveria lista vazia e o teste passaria sem provar nada) — a soma dos 14 meses fechando com o total, `top 5 unidades de negócio` respondendo, NF-e por centro de custo recusada com alternativas, e organização fora do consentimento devolvendo **erro**, nunca vazio |
| 3.1 | Endpoints OAuth. Descoberta por `rewrites` no `next.config`, **não** por pasta `app/.well-known/`: nome de diretório com ponto é tratado como oculto por boa parte da cadeia de build, e o caminho é MUST do spec. As **variantes com sufixo** (`/.well-known/oauth-authorization-server/api/mcp`) existem porque o RFC 8414 deixa o cliente inserir o caminho do recurso — só a forma curta faria metade dos clientes falhar. `lerPedido` concentra a regra contraintuitiva do `/authorize`: erro em `client_id` ou `redirect_uri` **não pode voltar por redirecionamento** — sem o par provado, redirecionar é o ataque, e o app viraria encaminhador aberto emprestando o domínio; provado o par, o erro volta pela URL com o `state`. O mesmo `lerPedido` roda na tela e na decisão, senão o formulário concederia o que a página teria recusado. **O formulário propõe organizações, a membership dispõe** — é a inversão do webhook SEFAZ. Código reusado e refresh reusado são tratados como **roubo**, não engano: o primeiro revoga os tokens nascidos dele, o segundo derruba o consentimento inteiro. Login ganhou `?next=` com validação contra `//` e `/\`, que seriam endereço absoluto para o navegador. Tela `/configuracoes/conexoes` — sem ela, desconectar dependeria da boa vontade de quem se quer desconectar. Verificado: **56/56 contra um `next start` de verdade**, por HTTP, incluindo o efeito no banco |
| **Fase 10 — Dimensões (concluída)** | |
| 10.5 | Modelos de rateio. Um modelo guarda **proporção**, nunca valor — o mesmo serve ao aluguel de R$ 12.000 e à luz de R$ 340. Os pesos **não somam 100** de propósito: `60:40`, `6:4` e `7200:4800` são a mesma divisão, e é isso que deixa **"Salvar como modelo" partir de um rateio já feito em reais** sem arredondar; quem normaliza é só a exibição. Ao salvar do diálogo individual os centavos passam por `reduceWeights` (MDC) — `[720000, 480000] → [3, 2]`, a única simplificação que preserva a proporção exata e a única que deixa o editor legível. **Defeito achado escrevendo o teste:** `weight numeric(12,4)` comporta 8 dígitos inteiros, e um lançamento de R$ 1 milhão vira peso 100.000.000 — estourava; virou `(18,6)`. **O carimbo de origem conta a menos de propósito:** `allocation_template_id` só é gravado quando o rateio veio do modelo E não foi editado depois, porque a tela existe para decidir se dá para apagar o modelo e um número inflado mentiria justamente aí; contagem é `COUNT(DISTINCT transaction_id)`. `ON DELETE SET NULL` — apagar modelo nunca desfaz rateio nem mexe em DRE. `WeightRowsEditor` **extraído** do diálogo de lote e reusado pelo editor de modelos. Nova rota `/configuracoes/modelos-de-rateio`. Verificado: migration 19/19 com ROLLBACK, aritmética 19/19 incluindo **2.500 aplicações sobre 500 valores reais fechando o centavo exato** e o ciclo rateio→modelo→rateio devolvendo as mesmas partes nos 500 |
| 10.3 | As leituras passam a respeitar o rateio. Eram **nove**, não sete, e de duas naturezas. **Analíticas** (DRE, drill-down da DRE, fluxo mensal, drill-down do balanço, drill-down do dashboard, realizado do Orçado × Realizado, `collectActuals`) trocam `transactions` por `transaction_lines`. **Operacionais** (`/transacoes`, fila de revisão) **não** podem ler a view — listam um lançamento por linha e a view as multiplicaria; nelas o filtro vira `dimensionExistsFilter`, um EXISTS sobre a view. Isso conserta dois defeitos que a coluna direta criaria: filtrar "Comercial" **esconderia** o lançamento rateado para Comercial (coluna do pai é nula com rateio), e "Sem centro de custo" pegaria **todo** rateado, inclusive os 100% classificados. A cobertura de dimensão do orçamento também passou pela view, senão passaria a acusar como "sem CC" justamente quem rateou. Contagem virou `COUNT(DISTINCT transaction_id)` — o campo promete lançamentos. UI: linha rateada não oferece edição direta de dimensão (o banco recusaria) e sai da seleção em lote; no drill-down a chave do React e a seleção passam a ser da parte. Verificado: **297 células da DRE idênticas** entre a query velha e a nova, e com rateio 600/400 o total da categoria não muda. Custo medido: DRE 0%, filtro +8% |
| 10.2 | Schema do rateio. **Mudança de modelo:** o CLAUDE.md registrava rateio "independente por dimensão", com uma view cruzando as divisões — ao explicar o desenho para decidir o schema, dois defeitos apareceram: cruzar 60/40 de centro de custo com 70/30 de contato **inventa** a célula "Admin + Cliente B", que ninguém afirmou, e a multiplicação das proporções reintroduz fração de centavo mesmo com cada dimensão fechando exata. Virou **sub-lançamento**: cada parte tem valor próprio e carrega as quatro dimensões. Soma exata é regra do banco, num `CONSTRAINT TRIGGER` **deferido até o commit** — `CHECK` enxerga uma linha por vez e a soma é propriedade do conjunto; deferido, dá para inserir as três partes de 333 uma a uma. O mesmo gatilho cobre apagar parte, editar parte e editar o valor do pai. Com rateio as dimensões do pai ficam **vazias**, e o gatilho recusa o contrário: preenchidas, toda leitura ainda não migrada atribuiria o valor **integral** a uma das partes. Validado antes de aplicar rodando a migration numa transação com ROLLBACK (15/15) e conferido depois contra o banco (22/22). Decisão 16 em SCHEMA_DECISIONS |
| 10.1 | Contato vira a 4ª dimensão da classificação. **Backend:** lista de contatos no system prompt do Haiku com nome fantasia, documento e papel — o extrato traz o fantasia muito mais que a razão social; teto de 400 com o corte declarado ao modelo. Piso de confiança de 70 **só** no contato, a única dimensão que casa contra a descrição do extrato. **Papel desempata, não veta** — a primeira versão mandava recusar papel divergente, o Haiku ignorou e com razão (estorno e devolução a cliente são saídas). Dois defeitos que tornavam o resto inerte: `catConf === 0` **descartava o resultado inteiro**, jogando fora contato de 95%, e o `set` fixo do job **apagava com null** toda dimensão não reconhecida na passada — inclusive classificação manual, porque "Categorizar agora" reprocessa. **Telas:** coluna, filtro e ordenação em `/transacoes`; quinto campo no batch; filtro + coluna em `/transacoes/revisao` (a coluna entra porque o expert agora sugere contato); alvo de contato nas regras; drill-down recebe `contacts` só para o batch — a coluna exigiria mudar as 5 queries de leitura. Verificado: 7/7 casos de classificação contra o banco com Haiku real, `next build` de 24 rotas |
| 10.0 | Contatos viram cadastro. `contacts` existia desde a Fase 1 com FK em 5 tabelas e **nunca teve uma linha escrita** fora do orçamento — a sessão fechou a lacuna, não criou a dimensão. Migration 0025: `is_active`, `code`, `is_customer`/`is_supplier` (papel duplo — o mesmo CNPJ é cliente e fornecedor com frequência), **policy de DELETE que faltava** desde a 0002, e `ON DELETE SET NULL` nas duas FKs que ainda eram `no action`. `DimensionManager` **estendido** com `extraFields`/`roleFields` em vez de um segundo gerenciador. Import de CSV próprio (o `previewFlatImport` já é um `withCnpj ? … : …` em cada consulta; um terceiro ramo prejudicaria as duas dimensões existentes). **Conserto do `'__null__'::uuid`**: "Sem centro de custo" lançava erro de sintaxe no Postgres — agora vira `IS NULL`, e combinado com valores concretos vira disjunção. Verificado sobre 10.329 lançamentos reais |
| **Orçado dentro da DRE (concluído)** | |
| 9.8 | Drill-down do orçado com edição. `components/budget/budget-drilldown-dialog.tsx` extraído da `comparacao-tab`, com botão de edição por ocorrência; `series-dialog` e `scope-confirm-dialog` **movidos** de `app/(authenticated)/orcamento/` para `components/budget/` — importar de dentro da pasta de outra rota acoplaria as duas telas. `getBudgetSeries(seriesId)` carrega uma linha só. Edição é opcional no componente (sem a prop `edit`, é somente leitura); versão arquivada mostra o motivo em vez de botão morto. Verificado: **282 células conferidas somando as 470 ocorrências que as compõem**, nenhuma divergente |
| 9.7 | Orçado lado a lado. `lib/budget-read.ts` (`fetchBudgetRows`) extraída de `getBudgetVsActual` — não por economia de linhas, mas porque a conciliação da 9.2 só vale se as duas telas lerem pela MESMA query. `getBudgetForPeriod` roda uma query em vez de cinco. Botão Orçamento + seletor de versão; união realizado ∪ orçado (categoria orçada e não realizada aparece); um caminho de código só para os dois estados. Fidelidade medida rodando a query antiga (via `git show`) contra a nova: 282 células idênticas |
| 9.6 | Terceira coluna por mês + análise vertical. `verticalShare` em `lib/dre-calc.ts`, `tone="muted"` no `Num`, cabeçalho de duas linhas. Achado nos dados reais: um EBITDA **negativo** de −11,6% aparecia como "11,6%" — numa linha de conta a AV% é consumo (magnitude), num subtotal é margem (com sinal). Daí o parâmetro `signed` |
| **Fase 9 — Orçamento (concluída)** | |
| 9.5 | Aceleradores B. `lib/budget-import.ts` puro: `parseBudgetCsv` recebe o texto e os mapas de busca já carregados; `buildRecurrenceCandidates` e `recurrenceToDraft` convertem a detecção do `/fluxo`. **Planilha em grade de 12 meses** (categorias nas linhas, meses nas colunas) porque é o formato que já existe no mundo — uma linha por ocorrência explodiria 12× o que é um lançamento só. `categoria` casa por código **ou** nome, com homônimo recusado pedindo o código. Linha inválida não derruba o arquivo: aparece na prévia com o motivo e é a única de fora. **Mensalização das recorrências:** a detecção trabalha em dias (7 a 40) e o orçamento em meses — semanal de R$ 100 vira R$ 400/mês, não R$ 100. Categoria é obrigatória porque a detecção agrupa por descrição e não conhece plano de contas. `applyCopyToBudget` virou `applyDraftsToBudget(source)` e a substituição passou a apagar só o que veio da **mesma origem**. `normalizeAmount` movido de `parsers/excel-csv.ts` para `format.ts` como `parseAmount` |
| 9.4 | Aceleradores A. `lib/budget-copy.ts` concentra o miolo fora de `'use server'` (mesmo motivo da 9.3): `buildCopyDrafts` puro, `collectActuals`/`countCopiedSeries` recebendo o executor, `applyCopyToBudget` e `applyDuplicateVersion` recebendo o `tx`. Copiar do realizado tem dois eixos separados de propósito — **formato** (mês a mês preservando sazonalidade × média mensal) e **detalhamento** (categoria × categoria+dimensões) — em vez de um "granularidade" ambíguo. Mapeamento por número do mês (jan de origem → jan do exercício), daí o teto de 12 meses: com 13, dois janeiros disputariam o mesmo alvo. Direção entra na chave de agrupamento — compensar entrada com saída produziria mês de sinal trocado, e série tem uma direção só. Valores iguais viram `fixo` em vez de `sazonal` com N campos repetidos. Prévia+commit, e a gravação recalcula do zero. Duplicação num CTE único com `mapped AS MATERIALIZED` (sem isso `gen_random_uuid()` seria reavaliado na segunda referência e as ocorrências apontariam para o nada); `make_interval(years => delta)` desloca e já apara 29/02; o prazo de caixa é preservado em DIAS, não deslocado por ano |
| 9.3 | Três escopos de edição e exclusão. `lib/budget-scope.ts` concentra a decisão (`planSeriesUpdate`, pura) e a execução (`applySeriesUpdate` / `applySeriesDelete`, recebem o `tx`) — fora de `'use server'` para serem exercitáveis direto contra o banco. Confirmação two-phase: a própria action devolve `{ needsConfirm: preview }` listando os **meses** afetados, e o checkbox de sobrescrita nasce desmarcado. Mudança estrutural promove o escopo para 'todas' sozinha; 'daqui' a partir da primeira ocorrência vira 'todas'. Bug encontrado ao desenhar o teste: em escopo parcial os valores gravados vinham da regra antiga — separado em `writeDrafts` (o que o usuário pediu) vs `ruleDrafts` (baseline do `adjusted_fields`) |
| 9.2 | `getBudgetVsActual` (união por `categoryId:month`, filtros simétricos nos dois lados, 5 queries em paralelo) + `getBudgetDrillDown` + parâmetro `regime` em `getDreDrillDown`. Aba `comparacao-tab.tsx`: matriz 12 meses Tipo→Pai→Filho, toggle Competência/Caixa, seletor de modo de célula, colunas Orçado ano / Realizado YTD / Projeção ano / Var. proj., corte "Fechado até" recalculando a projeção sem refetch, drill-down duplo (orçado → ocorrências, realizado → `DrillDownDialog`). Três avisos de honestidade: realizado sem categoria, cobertura de dimensão <90%, cauda de caixa fora do exercício. Extrações movidas: `lib/dre-layout.ts` (`LAYOUT`, `buildBlocks` genérico), `financial/num-cell.tsx`, `transacoes-shared/dim-filter.tsx` (com `/dre` e `/fluxo` migrados no mesmo commit) |
| 9.1 | `src/server/budget.ts` com 13 actions (versões, séries, ocorrências) + `getContactOptions` em `dimensions.ts`. Rota `/orcamento` com abas Planejamento / Orçado×Realizado (placeholder) / Versões. `series-dialog.tsx`: 4 modos de valor com **preview ao vivo** das ocorrências via `expandSeries`, direção deduzida do tipo da categoria, aviso de cauda de caixa em âmbar. Tabela de séries no DATA_TABLE_PATTERN com expansão sob demanda das ocorrências e edição inline de valor que popula `adjusted_fields` (com auto-cura). `updateBudgetSeries` regenera tudo — limitação temporária até a 9.3. Antecipado `src/lib/format.ts` da 9.2 para não duplicar `monthLabel` |
| 9.0 | Migration 0024 (3 tabelas + 12 policies + 3 triggers `updated_at` — corrige a lacuna das 0022/0023), schema Drizzle `budget-versions`/`budget-series`/`budget-entries`, `lib/budget-types.ts` (constantes + Zod), `lib/budget-recurrence.ts` (`expandSeries` pura: fixo/reajuste/sazonal/parcelado, clamp de dia, cauda de caixa, validação de exercício — 20/20 casos verificados). Extrações movidas, não duplicadas: `lib/dre-calc.ts` (`computeSubtotals`, `generateMonthRange`), `lib/sql-dimensions.ts` (`dimensionFilters`, SQL conferido idêntico ao anterior), `lib/auth-context.ts`. `/dre` e `/fluxo` migrados no mesmo commit |
| **Hardening intercalado** | |
| Fix connect Pluggy (`602a6cd`) | Conectar conta dava 500 em produção. Erro real via `vercel logs`: `HTTPError 400` da API Pluggy (`clientId must be a UUID`) — credencial com caractere invisível (newline/BOM/zero-width) na Vercel. Reproduzido 1:1 contra `api.pluggy.ai/auth`. Fix: `sanitizeSecret()` (code points) em `getPluggyClient()`, último consumidor de credencial sem sanitização. Mesma classe do incidente Anthropic |
| Layer 0 categorização (`d587644`+`d72ec37`+`35400e6`) | Match determinístico do CSV antes do LLM. Parser detecta colunas autoritativas (`Categoria/Natureza Pai/Filho`, `Conta Contábil`, `Plano de Contas`, `Tipo Natureza`) por regex no header normalizado. `findCategoryByCsvMapping` em `categorizer.ts` faz lookup normalizado (sem acento, colapsa dash/barra/parênteses em espaço) com desempate cumulativo nome→tipo→pai. `TIPO_ALIASES` mapeia humano→código (`Receita`→`receita_operacional`, `CMV`/`CPV`→`cpv`, etc). `approveAndInsert` pré-classifica no INSERT, IDs casados não entram no evento Inngest. CSVs de ERP com plano alinhado importam zero-Haiku. Decisão 12 em SCHEMA_DECISIONS |
| Hardening categorização (`b040a23`+`37026ef`+`cec830a`+`2bd4cf1`) | 4 fixes encadeados: catch loud em `approveAndInsert` com flag `categorizationDispatched`, chunking interno do job em `step.run`s de 50 (sobrevive maxDuration=300), chunking de evento `batch-inserted` em 3000 IDs/event (limite Inngest 256KB) via novo `sendCategorizationEvents` em `lib/inngest.ts`, sanitização de BOM/zero-width nas envs Anthropic+Inngest no startup. Causa raiz do `TypeError: ByteString`: BOM em `ANTHROPIC_API_KEY` na Vercel — fallback heurístico silencioso do parser mascarou |
| UX /transacoes (`000ebc3`+`8948106`+`37b5c30`) | Seletor `?pageSize=100/500/1000` no rodapé, persistido em `localStorage` via `FILTER_KEYS`. Helper compartilhado em `lib/transactions-page-size.ts` (fora de `'use server'`). Delete em lote sobe de 500 → 1000 |
| UX upload review + hints (`895dd83`) | Banner "Marcar todas como Entrada/Saída" pra CSVs sem direção explícita (`setAllPendingDirection`). `__categoryHints` em `rawData` propagado pra `metadata.categoryHints`, injetado no prompt do Haiku como sinal forte |
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

### Região da Vercel — `gru1` (São Paulo), nunca a padrão

A **Function Region** do projeto tem de ser **São Paulo (`gru1`)**. O padrão da Vercel é
`iad1` (Washington), e o banco está em `sa-east-1` (São Paulo) — com a função nos EUA, **toda
consulta atravessa o Atlântico duas vezes**.

**Como conferir em 5 segundos:**
```
curl -s -D - -o /dev/null https://lure-expert.vercel.app/login | grep -i x-vercel-id
```
O formato é `X-Vercel-Id: <edge>::<função>::<id>`. Tem de sair `gru1::gru1`. Se sair
`gru1::iad1`, a requisição entra em São Paulo e é despachada para Washington para renderizar.

**Por que dói tanto:** toda página autenticada faz no mínimo **3 idas sequenciais** ao banco antes
de mostrar qualquer coisa — `auth.getUser()` (HTTPS ao Supabase), o membership (Postgres) e só
então os dados. De `iad1` cada ida custa ~110–125ms; três sequenciais são ~360ms de rede pura por
página, e fria o handshake TLS acrescenta mais 3 idas e voltas por conexão. De `gru1` para
`sa-east-1` é a mesma cidade, ~1–5ms.

**Medido na produção, antes e depois** (TTFB de `/login`, que quase não toca o banco):
`400–427ms morno / 850ms frio` → **`258–269ms morno / 457ms frio`**.

**Onde trocar:** Vercel → Settings → Functions → Function Region → São Paulo (`gru1`), e
**redeploy** (deployments existentes ficam na região antiga). Os jobs Inngest e os crons rodam na
mesma região da função, então ganham junto.

⚠️ **A escolha vive no painel, não no repositório.** Um projeto Vercel recriado do zero volta
silenciosamente para `iad1`. Versionar isso é um `vercel.json` com `{ "regions": ["gru1"] }` —
ainda não feito.

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
- ~~Custo de IA: interno (Lure paga, embutido no pricing). Sem BYO API key.~~
  **REVOGADO na Fase 0 (23/ago/2026):** chave por organização, obrigatória.
  Ver princípio 14.
- Provedor de IA: Anthropic apenas. Multi-LLM diferido.
- Tipo C de mutações (autônomas): fora do escopo no MVP e MVP+1.
- Pricing final: decisão na Fase 10. Recomendação atual: tier por porte
  com uso justo implícito.
- Limites por plano: [definir antes da Fase 10]
