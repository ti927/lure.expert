# Histórico Completo de Sessões — lure.expert

Arquivo de arquivo. Contém os detalhes completos (arquivos alterados, bugs corrigidos, decisões de implementação) de todas as sessões de desenvolvimento. Usado para consulta pontual — não é carregado automaticamente no contexto.

Decisões arquiteturais não-óbvias estão em  (sempre carregado).

---

### ✅ Sessão 7.4 — Painel /nfe + Sidebar + Categorização Camada 0.5 *(concluída)*

**Contexto:** entrega final da Fase 7. Cria a tela de visibilidade das NF-es, expõe o link na sidebar com badge de revisão pendente e enriquece o motor de categorização com dados da NF quando a transação já está reconciliada.

**O que mudou:**

- **`src/app/(authenticated)/nfe/page.tsx`** (criado) — server component: `Promise.all` paralelo de `listInvoices()`, `getInvoiceStats()` e `getLegalEntities()`; passa ao `NfeClient`.

- **`src/app/(authenticated)/nfe/nfe-client.tsx`** (criado) — painel NF-e seguindo `DATA_TABLE_PATTERN.md`:
  - **Cards de resumo (Zona 2):** A Receber (NFs saída não casadas, verde), A Pagar (NFs entrada não casadas, vermelho), Pendentes de revisão (âmbar), Sem correspondência (muted).
  - **Filtros de data (Zona 2):** De/Até em `data_emissao` (date inputs nativos).
  - **Tabela (Zona 4):** colunas Data emissão · Tipo (badge Saída/Entrada) · Número/Série · Contraparte (destinatário para saída, emitente para entrada) · Entidade jurídica · Valor · Status · Score · Transação (link externo quando casada).
  - **Filtros no cabeçalho de cada coluna:** Tipo (enum radio), Status (multi-select), Entidade (multi-select), Valor (popover min/max).
  - **Paginação (Zona 5):** Anterior/Próxima quando totalPages > 1.
  - **Persistência:** filtros salvos em `localStorage` com chave `lure:nfe:filters`.
  - **Empty state:** mensagem distinta quando há filtros ativos vs. sem NFs cadastradas.
  - Badges de status: `nova` (slate), `manifestada` (sky), `pendente_revisao` (âmbar), `casada` (emerald), `cancelada`/`denegada` (rose).

- **`src/server/invoices.ts`** — `getInvoicePendingCount()` adicionado: conta NFs com `status='pendente_revisao'` para o badge da sidebar; `try/catch` para não quebrar o layout se a migration 0022 ainda não foi aplicada.

- **`src/app/(authenticated)/layout.tsx`** — chama `getInvoicePendingCount()` em paralelo e passa `nfePendingCount` ao `AppShell`.

- **`src/components/layout/app-shell.tsx`** — aceita e propaga `nfePendingCount?: number` ao `Sidebar`.

- **`src/components/layout/sidebar.tsx`** — link `/nfe` com ícone `FileText` adicionado ao array `NAV` (entre Transações e DRE); `NavLink` aceita prop `badge?: number`; badge âmbar renderizado ao lado do label quando `badge > 0` e sidebar expandida.

- **`src/lib/categorizer.ts`** — Camada 0.5 de categorização com NF-e:
  - Novo tipo exportado `NfContext` (`nfEmitente`, `nfEmitenteCnpj`, `nfDestinatario`, `nfDestinatarioCnpj`, `nfTipo`).
  - `buildNfContextBlock(nf?)` — constrói bloco de texto com a contraparte da NF (destinatário para NF saída, emitente para NF entrada) e CNPJ do emitente para entradas.
  - `categorizeTransaction` aceita `nfContext?: NfContext | null` na definição do `tx`; bloco é injetado no user message antes de enviar ao Haiku.
  - Não altera a lógica das camadas 1, 2, 3 e 4 — apenas enriquece o contexto disponível ao LLM.

- **`src/jobs/categorize-transaction.ts`** — Camada 0.5 no pipeline de jobs:
  - `invoiceId` adicionado ao SELECT de transações.
  - Pré-fetch de dados de NF para transações com `invoiceId` (uma query por lote via `inArray`).
  - `invoiceMap` indexado por `invoice.id`; loop monta `nfContext` e passa a `categorizeTransaction`.
  - Quando `invoiceId` é null (maioria dos casos no insert inicial), `nfContext` é null e o comportamento é idêntico ao anterior.

TypeScript: 0 erros.

---

### ✅ Sessão 7.3 — Reconciliação NF-e + Server Actions de Invoices *(concluída)*

**Contexto:** após o sync inserir NFs em `invoices`, um job de reconciliação as cruza com as transações bancárias usando score composto pg_trgm. Server actions expõem os dados para o painel `/nfe` (Sessão 7.4).

**O que mudou:**

- **`src/jobs/reconcile-invoices.ts`** — job Inngest `reconcile-invoices`, acionado pelo evento `sefaz/invoices.batch-inserted`:
  - Concurrency: `limit: 1` por `organizationId`
  - Para cada invoice com `status='nova'`, busca a melhor transação candidata via SQL com score composto:
    - **40%** `pg_trgm similarity(tx.description, nome_contraparte)` — nome do destinatário (NF saída) ou emitente (NF entrada)
    - **40%** match de valor binário (amount dentro de ±0.5% do `total_nf`)
    - **20%** proximidade de data linear (`0 dias → 1.0`, `7 dias → 0.0`)
  - Candidatas: mesma org, direção coerente (saída→inflow, entrada→outflow), amount ±0.5%, data ±7 dias, `status='confirmed'`, `invoice_id IS NULL`
  - ≥ 0.85 → casa automático: `invoice.status='casada'`, `invoice.transactionId=tx.id`, `transactions.date=invoice.dataEmissao` (competência real para o DRE), `transactions.invoiceId=invoice.id`
  - 0.50–0.84 → `invoice.status='pendente_revisao'` (fila manual no painel /nfe)
  - < 0.50 → invoice fica `'nova'` (A/R ou A/P em aberto)
  - Processamento em lotes de 50 por `step.run` (respeita limite de 1000 steps/run do Inngest)

- **`src/server/invoices.ts`** — três server actions:
  - `listInvoices(filters)` — paginado 100/pág com filtros: tipo, status, legalEntityId, dateFrom, dateTo, amountMin, amountMax; JOIN com `legalEntities` para nome da entidade; ordena por `dataEmissao DESC`
  - `getInvoiceStats()` — query única retorna: totalAReceber (NFs saída não casadas/canceladas), totalAPagar (NFs entrada idem), countPendenteRevisao, countNova — para os cards de resumo do painel /nfe
  - `manualReconcile(invoiceId, transactionId)` — reconciliação manual com validação de ownership; seta `transactions.date = invoice.dataEmissao`; revalida /nfe, /dre, /transacoes

- **`src/app/api/inngest/route.ts`** — `reconcileInvoices` registrado no `serve()`.

**Impacto no DRE:** quando uma NF é reconciliada (auto ou manual), `transactions.date` passa a ser a data de emissão da NF (competência) em vez da data do extrato bancário. O `effectiveDate` permanece inalterado — cash flow não é afetado. Resultado: DRE reflete a competência real do faturamento.

TypeScript: 0 erros.

---

### ✅ Sessão 7.2 — Provedor Abstrato + Jobs de Sync *(concluída)*

**Contexto:** implementa a camada de integração SEFAZ — abstração de provedor pluggável, job de sync por conexão e cron diário.

**O que mudou:**

- **`src/lib/sefaz-provider.ts`** (criado) — abstração completa do provedor SEFAZ:
  - `NFeItem` — tipo unificado para NF de saída e entrada
  - `SefazProvider` — interface com `fetchNFeSaida`, `fetchNFeEntrada`, `manifestar`
  - `AbstractSefazProvider` — stub de desenvolvimento (retorna arrays vazios; permite testar o pipeline sem credenciais reais)
  - `FocusNFeProvider` — integração HTTP com Focus NF-e (Basic Auth, URLs por ambiente, mapeamento de campos, filtro de itens inválidos)
  - `createSefazProvider(conn)` — factory que aceita `Pick<SefazConnection, 'provider' | 'apiKeyEncrypted' | 'environment'>` (Pick necessário para compatibilidade com `JsonifyObject` do Inngest, que serializa timestamps como strings)

- **`src/jobs/sync-sefaz-item.ts`** (criado) — job Inngest `sync-sefaz-item`, acionado por `sefaz/item.sync-requested`:
  - Concurrency: `limit: 1` por `connectionId`
  - Padrão `awaitingFirstSync`: aborta se metadata tem flag e sem `forceFirstSync` no payload
  - Busca NFs de saída e entrada conforme flags `pullSaida`/`pullEntrada` da conexão
  - Erros de API marcam conexão como `status='error'`
  - `insertInvoices` — helper com lotes de 100, `onConflictDoNothing` por chave de acesso
  - Manifestação automática ("Ciência da Operação") para NFs de entrada novas quando `autoManifest=true`
  - Após sync: limpa `awaitingFirstSync` do metadata, atualiza `lastSyncAt/Status`
  - Dispara `sefaz/invoices.batch-inserted` para o job de reconciliação

- **`src/jobs/sync-all-sefaz-items.ts`** (criado) — cron Inngest `0 5 * * *` (02:00 BRT):
  - Busca conexões `status='active'`; conexões com `awaitingFirstSync=true` são puladas
  - `fromDate` = lastSyncAt − 1 dia (incremental) ou `daysAgoISO(7)` se nunca sincronizado

- **`src/app/api/webhooks/sefaz/route.ts`** (criado) — webhook genérico para provedores SEFAZ:
  - Resolve conexão por `connectionId` ou `cnpj` no body
  - Eventos de sucesso → dispara sync incremental; eventos de erro → atualiza status da conexão

- **`src/app/api/inngest/route.ts`** — `syncSefazItem` e `syncAllSefazItems` registrados.

TypeScript: 0 erros.

---

### ✅ Sessão 7.1 — Schema + Tela de Configuração SEFAZ *(concluída)*

**Contexto:** fundação da Fase 7 — schema das duas novas tabelas, server actions de CRUD e tela de configuração para conectar entidades jurídicas ao SEFAZ.

**O que mudou:**

- **`db/migrations/rls/0022_sefaz_invoices.sql`** (✅ aplicada) — cria tabelas `sefaz_connections` e `invoices` com RLS isolado por org; adiciona coluna `invoice_id uuid` em `transactions`.

- **`db/schema/sefaz-connections.ts`** (criado) — conexão por CNPJ/entidade jurídica; campos: provider, providerCompanyId, apiKeyEncrypted, certificateExpiry, environment, pullSaida, pullEntrada, autoManifest, status, lastSyncAt, metadata; UNIQUE(organizationId, cnpj).

- **`db/schema/invoices.ts`** (criado) — documento fiscal; campos: chaveAcesso, numeroNf, serie, tipo (saída/entrada), emitente/destinatário, dataEmissao (competência), totalNf, status (nova/manifestada/casada/pendente_revisao/cancelada/denegada), transactionId, reconciliationScore, xmlContent; UNIQUE(organizationId, chaveAcesso).

- **`db/schema/transactions.ts`** — campo `invoiceId uuid` adicionado (FK criada via SQL na migration, não via Drizzle — referência circular).

- **`db/schema/index.ts`** — exports de `sefaz-connections` e `invoices` adicionados.

- **`src/server/sefaz.ts`** (criado) — 6 server actions:
  - `listSefazConnections` — lista conexões ativas com nome da entidade jurídica
  - `createSefazConnection` — valida CNPJ, verifica duplicata, cria conexão com `status='pending'` + `metadata.awaitingFirstSync=true`; atualiza CNPJ da entidade se estava vazio
  - `updateSefazConnection` — patch parcial de provider/apiKey/environment/toggles
  - `deleteSefazConnection` — soft delete via `status='inactive'`
  - `triggerSefazSync(connectionId, fromDate)` — dispara `sefaz/item.sync-requested` com `forceFirstSync: true`
  - `getLegalEntitiesForSefaz` — lista entidades com flag `alreadyConnected` para o dialog de criação
  - `decryptApiKey` exportado para uso no sefaz-provider

- **`src/app/(authenticated)/configuracoes/sefaz/page.tsx`** + **`sefaz-client.tsx`** (criados) — tela de configuração: lista conexões por entidade jurídica, dialog de nova conexão (provedor, API key, ambiente, toggles), card de status com última sync, botão "Sincronizar" que abre date picker para data de corte.

TypeScript: 0 erros.

---

### ✅ Sessão — Separação date/effective_date (competência vs caixa) *(concluída)*

**Contexto:** a tabela `transactions` sempre teve `date` (competência) e `effective_date` (caixa), mas `effective_date` nunca era populado — todos os pipelines gravavam apenas `date`, e todas as queries de fluxo de caixa também liam apenas `date`. Esta sessão implementa o uso real da distinção: `date` alimenta DRE e BP; `effective_date` alimenta FC, saldo de caixa e gráfico de fluxo.

**O que mudou:**

- **`db/migrations/rls/0021_staging_effective_date.sql`** — `ALTER TABLE transactions_staging ADD COLUMN IF NOT EXISTS effective_date text` (aplicado no Supabase Studio).

- **`db/schema/transactions-staging.ts`** — campo `effectiveDate: text('effective_date')` adicionado.

- **`src/lib/parsers/excel-csv.ts` e `src/lib/parsers/pdf.ts`** — tipo `LlmRow` e `StagingRow` ganham `effectiveDate`; SYSTEM_PROMPT atualizado com instruções separadas para as duas datas (`date` = competência, `effectiveDate` = quando o dinheiro se moveu); `parseLlmResponse` e `toStagingRows` propagam o campo com fallback para `date` quando o LLM não retorna.

- **`src/jobs/sync-pluggy-item.ts`** — `effectiveDate: tx.date.toISOString().split('T')[0]` gravado no insert (posting date = cash date para extratos bancários; os dois campos ficam iguais).

- **`src/server/staging.ts`** — `approveAndInsert` propaga `effectiveDate: r.effectiveDate ?? r.date` ao inserir em `transactions`.

- **Queries de caixa — 6 pontos de mudança** — substituição de `t.date` por `COALESCE(t.effective_date, t.date)` em SELECT, WHERE e GROUP BY:

  | Arquivo | Função |
  |---|---|
  | `src/server/dashboard.ts` | `getDashboardKPIs` (saldoCaixa) |
  | `src/server/dashboard.ts` | `getTopExpenseCategories` |
  | `src/server/dashboard.ts` | `getDashboardCategoryDrillDown` |
  | `src/server/dashboard.ts` | `getCashFlowChart` |
  | `src/server/fluxo.ts` | histórico diário + CTE de recorrências |
  | `src/server/fluxo-mensal.ts` | agregação mensal |

- **Queries que NÃO foram alteradas** (competência): `dre.ts`, `balance-sheet.ts`, KPIs de resultado e indicadores financeiros em `dashboard.ts`.

**Princípio de compatibilidade:** `COALESCE(effective_date, date)` garante que dados históricos com `effective_date = NULL` continuem aparecendo normalmente. Para extratos bancários (Pluggy + uploads), `effective_date = date` — comportamento visível idêntico ao anterior. A diferença aparece apenas em uploads de NF/ERP com datas distintas de competência e caixa.

TypeScript: 0 erros. ESLint: 0 warnings.

---

### ✅ Sessão — Alertas no dashboard *(concluída)*

**Contexto:** último deliverable da Fase 6. O dashboard já calculava KPIs e indicadores financeiros, mas não alertava proativamente sobre situações de risco.

**O que mudou:**

- **`src/app/(authenticated)/dashboard/dashboard-client.tsx`** — `AlertsSection` component:
  - Tipo `DashboardAlert` com `id`, `type` (`'critical' | 'warning'`), `title`, `description`, `href?`
  - `useMemo` `alerts` deriva alertas dos dados já carregados nos props — sem query adicional
  - Condições monitoradas (por ordem de prioridade):
    - Saldo negativo → critical
    - Lucro negativo → warning
    - Despesas +30% vs mês anterior → warning; +50% → critical
    - Receita −20% vs mês anterior → warning; −40% → critical
    - EBITDA < 5% → warning; < 0% → critical
    - Cobertura do serviço da dívida < 1× → critical
    - Liquidez corrente < 1× → critical
    - Endividamento > 70% → warning
  - Máximo 6 alertas exibidos, critical primeiro
  - Dismissível por alerta: `×` remove do estado local e persiste em `localStorage` com chave `lure:dashboard:dismissed-alerts:${selectedMonth}` (ao trocar de mês, alertas voltam)
  - Posição: entre os 4 KPI cards e o gráfico de fluxo de caixa

**Não-objetivos:** sem tela `/alertas` separada (alertas são informação contextual do dashboard, não uma fila de tarefas); sem persistência no banco (derivados em tempo real dos dados já carregados).

TypeScript: 0 erros. ESLint: 0 warnings.

---

### ✅ Sessão — Seletor de mês no dashboard + Top 5 por categoria-filho + fix sort text *(concluída)*

**Contexto:** o `/dashboard` calculava todos os cards com base em `new Date()` (mês corrente do servidor). Esta sessão adiciona seletor de mês no cabeçalho, refina o Top 5 para agregar por categoria-filho (não pai), e resolve bug crítico de ordenação textual no SQL.

**O que mudou:**

- **`src/server/dashboard.ts`** —
  - Helper `resolveMonthRange(referenceMonth?)` centraliza cálculo de `curFrom/curTo/prevFrom/prevTo/from12m` a partir de `'YYYY-MM'` ou `new Date()`. Parse sem `new Date(string)` (bug de fuso horário como na 0017).
  - As 4 funções exportadas (`getDashboardKPIs`, `getFinancialIndicators`, `getTopExpenseCategories`, `getCashFlowChart`) recebem `referenceMonth?: string` e delegam ao helper.
  - **Snapshot semantics:** `getDashboardKPIs` — `saldoCaixa` ganha `AND date::date <= ${curTo}`; `getFinancialIndicators` — query BP ganha `AND date::date <= ${curTo}`.
  - **Janela deslizante no gráfico:** `getCashFlowChart` — `toDate = curTo`, `fromDate = curTo − 89 dias` (`format(subDays(parseISO(curTo), 89), ...)`).
  - **`getTopExpenseCategories` refatorado:** agrega por categoria-folha (Filho) em vez de Pai; `cashOutflowTypes` (8 tipos: 6 DRE + `emprestimos_amortizacoes` + `investimentos_retiradas`); `WHERE direction = 'outflow'`; `SUM(amount)` puro (não neta com inflows); `SELECT p.id/name/code`; inclui `hide_in_cashflow = false`.
  - **Fix crítico de ORDER BY:** `SUM(t.amount::numeric)::text AS total` + `ORDER BY total DESC` causava sort lexicográfico ("915" > "7918" porque '9' > '7'). Corrigido para `ORDER BY SUM(t.amount::numeric) DESC`. Causa raiz: alias de texto em ORDER BY no PostgreSQL é resolvido como string, não como o valor numérico da expressão.

- **`src/app/(authenticated)/dashboard/page.tsx`** — aceita `searchParams.month`; helper `isValidMonth()` valida `YYYY-MM`; deriva `baseDate/selectedMonth/monthFrom/monthTo/mesAtual` do mês selecionado; passa tudo ao `DashboardClient`.

- **`src/app/(authenticated)/dashboard/dashboard-client.tsx`** —
  - Prop `selectedMonth: string` + `handleMonthChange` → `router.push('/dashboard?month=YYYY-MM')` em `useTransition`.
  - `MonthPicker` inline: `<input type="month">` + `<Loader2>` quando `isNavPending`.
  - Labels dinâmicos: "Fluxo de Caixa — 90 dias até [mês]" e "Indicadores Financeiros — [mês]".
  - Top 5 agora exibe Filho (com `parentName` como subtítulo abaixo do nome) — nível de granularidade mais útil para orgs com múltiplos filhos por Pai.

**Indicadores financeiros completos (Liquidez Seca, Endividamento Geral, ROE, Ciclo Financeiro) e popovers explicativos — entregues em sessões anteriores, consolidados neste commit junto com o seletor de mês.**

TypeScript: 0 erros. ESLint: 0 warnings.

---

### ✅ Sessão — Top 5 Categorias de Despesa no dashboard *(concluída — detalhes acima)*

Sessão substituída/consolidada na sessão "Seletor de mês" acima. O card foi entregue na mesma iteração.

---

### ✅ Sessão — Popovers explicativos em cada indicador do dashboard *(concluída)*

**Contexto:** o card "Indicadores Financeiros" do `/dashboard` mostrava 7 indicadores com `hint` discreto, mas isso é insuficiente para usuário não-financeiro entender como cada número é calculado e como interpretá-lo. Esta sessão adiciona um ícone "?" ao lado de cada label que abre um balão explicativo ao clicar.

**O que mudou:**

- **`src/app/(authenticated)/dashboard/dashboard-client.tsx`** —
  - `IndicatorExplanation` (tipo novo): `{ formula, description, interpretation }`.
  - `IndicatorItemProps` ganhou `explanation?: IndicatorExplanation`.
  - `IndicatorItem` renderiza um `<Popover>` ao lado do label quando `explanation` é fornecido. Trigger é `<button>` com `HelpCircle` (lucide, `h-3.5 w-3.5`), cor sutil `text-muted-foreground/60` com hover. `aria-label` descritivo para acessibilidade.
  - `PopoverContent` (`w-80`) mostra: título do indicador + 3 seções (Fórmula em fonte mono sobre `bg-muted/40`, O que é, Como interpretar).
  - Os 7 indicadores receberam textos em PT-BR seguindo `docs/AI_VOICE.md` (direto, sem firulas).

**Não-objetivos:** não criou componente `HelpPopover` em `/components/ui/` (uso restrito); não tocou no cálculo em `src/server/dashboard.ts`; não adicionou popovers aos 4 KPI cards do topo.

TypeScript: 0 erros. ESLint: 0 warnings.

---

### ✅ Sessão — Indicadores faltantes da Fase 6 (Liquidez Seca, Endividamento, ROE, Ciclo Financeiro) *(concluída)*

**Contexto:** o card "Indicadores Financeiros" do `/dashboard` tinha apenas 3 indicadores entregues na Sessão 5.D (Margem EBITDA, Liquidez Corrente, Cobertura do Serviço da Dívida). O plano original da Fase 6 listava outros 4 indicadores: Liquidez Seca, Endividamento Geral, Ciclo Financeiro e ROE. Esta sessão completa o deliverable de indicadores.

**O que mudou:**

- **`src/server/dashboard.ts`** — `FinancialIndicators` ganhou 4 campos novos (`liquidezSeca`, `endividamentoGeral`, `cicloFinanceiro`, `roe`) + `meses12mDisponiveis` (1..12). `getFinancialIndicators` foi reescrito:
  - **Liquidez Seca:** `(Ativo Circulante − Estoque) / Passivo Circulante`. Identificação de estoque via `ILIKE '%estoque%'` em `c.name OR p.name` dentro de `c.type = 'ativo_circulante'`. Se org não tem estoque cadastrado, fallback equivale à Liquidez Corrente.
  - **Endividamento Geral:** `(Passivo Circulante + Passivo Não-Circulante) / (Ativo Circulante + Ativo Não-Circulante)`. Retorna proporção 0..1; exibido como % no client. Direção invertida (menor é melhor).
  - **ROE:** `(Lucro Líquido 12m anualizado) / Patrimônio Líquido × 100`. Anualização proporcional quando há menos de 12 meses (`lucro × 12 / meses_disponíveis`). PL: prioriza valores em `c.type = 'patrimonio_liquido'`; se zero, usa identidade contábil `Ativo Total − Passivo Total`. Retorna null se PL ≤ 0.
  - **Ciclo Financeiro:** sempre `null` no MVP — requer estrutura de Contas a Receber/Pagar para calcular PMR + PME − PMP. Hint do indicador explicita "(Fase futura)".

- **`src/app/(authenticated)/dashboard/dashboard-client.tsx`** — 4 novos `IndicatorItem`:
  - Liquidez Seca (ícone `Activity`, thresholds 1.0/0.7, "higher is better")
  - Endividamento Geral (ícone `Scale`, thresholds 50%/70%, "lower is better" via novo helper `indicatorStatusInverse`)
  - ROE (ícone `Wallet`, thresholds 15%/8% a.a., hint dinâmico cita o número de meses quando < 12)
  - Ciclo Financeiro (ícone `Clock`, status sempre `neutral`, hint fixo)
  - `indicatorStatusInverse(value, goodMax, warnMax)` adicionado para indicadores onde "menor é melhor".
  - `allNull` estendido para incluir todos os 6 indicadores antes de mostrar o fallback "Sem dados suficientes".

**Convenções de threshold:**

| Indicador | Bom | Atenção | Direção |
|---|---|---|---|
| Margem EBITDA | ≥ 15% | ≥ 5% | Maior é melhor |
| Liquidez Corrente | ≥ 1,5x | ≥ 1,0x | Maior é melhor |
| Liquidez Seca | ≥ 1,0x | ≥ 0,7x | Maior é melhor |
| Cobertura Serviço Dívida | ≥ 1,5x | ≥ 1,0x | Maior é melhor |
| Endividamento Geral | ≤ 50% | ≤ 70% | Menor é melhor |
| ROE | ≥ 15% a.a. | ≥ 8% a.a. | Maior é melhor |

TypeScript: 0 erros. ESLint: 0 warnings.

---

### ✅ Sessão — Subtotais por grupo/natureza pai no drill-down compartilhado *(concluída)*

**Contexto:** o `DrillDownDialog` (usado por `/balanco` e `/dre`) listava transações sem nenhuma agregação intermediária. Quando o usuário abria o drill de uma seção inteira do BP (ATIVO/PASSIVO via clique no label do Grupo), aparecia uma lista plana com transações de múltiplas Naturezas Pai e múltiplos tipos BP, sem dar visão do peso de cada agrupamento. Esta sessão adiciona uma tira de subtotais entre o header e a tabela.

**O que mudou:**

- **`src/lib/dre-types.ts`** — `DrillDownTransaction` ganhou 3 campos: `parentCategoryId`, `parentCategoryName`, `parentCategoryType` (todos `string | null`).

- **`src/server/balance-sheet.ts`** — `getBalancoDrillDown`: SQL inclui `LEFT JOIN categories p ON c.parent_id = p.id` e seleciona `c.type`, `p.id`, `p.name`, `p.type`. Mapeamento aplica fallback: quando a transação está classificada diretamente numa Natureza Pai (sem filhos), `parent_*` vem nulo → usa a própria categoria como "Pai" para que subtotais funcionem corretamente.

- **`src/server/dre.ts`** — `getDreDrillDown`: mesma extensão de JOIN e mapeamento, para manter o tipo `DrillDownTransaction` consistente entre as duas chamadas.

- **`src/components/transacoes-shared/drill-down-dialog.tsx`** —
  - Helper `getTypeLabel(type)` unifica lookup em `DRE_TYPE_LABELS` e `BP_TYPE_LABELS`.
  - `useMemo` `subtotals` agrupa o conjunto **filtrado** (filter-aware, sort-agnostic) por `parentCategoryType` (Grupo) e por `parentCategoryId` (Pai), ordenado por label.
  - `showSubtotals = types ≥ 2 || pais ≥ 2` — a tira só aparece quando há variedade que justifique a agregação. Drill de Filho único ou Pai único não polui a UI.
  - Render: bloco compacto entre header e tabela; linha 1 "Por grupo (N)" + chips; linha 2 "Por natureza pai (N)" + chips. Cores semânticas (emerald-700 positivo / rose-600 negativo / muted zero), tabular-nums, sem decimais.
  - Subtotais reagem em tempo real aos filtros do dialog (categoria, CC, UN, entidade, banco, valor, etc.).

**Comportamento por cenário (a partir do `/balanco`):**

| Clique | Tira de subtotais |
|---|---|
| Filho (label ou célula) | Não aparece — 1 pai, 1 tipo |
| Pai com N filhos | Não aparece — 1 pai, 1 tipo |
| Pai sem filhos | Não aparece — 1 pai, 1 tipo (fallback usa a própria categoria como pai) |
| Grupo (Ativo Circulante, etc.) | Aparece "Por natureza pai" se ≥ 2 pais |
| Seção (ATIVO, PASSIVO) | Aparece "Por grupo" e "Por natureza pai" |

TypeScript: 0 erros.

---

### ✅ Sessão — Split OPEX/CAPEX nas Naturezas Pai *(concluída)*

**Contexto:** a tabela "Geração de Caixa por Categoria" em `/fluxo` exibia todas as naturezas numa única lista. Para alinhar com a visão gerencial de caixa (P&L operacional vs. financeiro/investimento), as naturezas pai passaram a ter um flag `opex_capex` que divide a tabela em duas seções com subtotais próprios.

**O que mudou:**

- **`db/migrations/rls/0020_category_opex_capex.sql`** (criado + aplicado no Supabase Studio) — `ALTER TABLE categories ADD COLUMN IF NOT EXISTS opex_capex text NOT NULL DEFAULT 'opex'`; UPDATE seed defaults: tipos `emprestimos_amortizacoes` (8), `investimentos_retiradas` (9), `transfer` (10) → CAPEX; `CREATE OR REPLACE FUNCTION seed_categories_for_org` atualizada com os valores corretos de `opex_capex` para novas orgs.

- **`db/schema/categories.ts`** — campo `opexCapex: text('opex_capex').notNull().default('opex')` adicionado.

- **`src/server/categories.ts`** — `getCategoriesWithTxCount` inclui `opexCapex: categories.opexCapex` no SELECT; nova server action `setParentOpexCapex(categoryId, value)` com validação de ownership e `parentId IS NULL`; revalida `/configuracoes/categorias` + `/fluxo`.

- **`src/server/fluxo-mensal.ts`** — `FluxoMensalCategoryRow` inclui `parentOpexCapex: string`; SQL SELECT inclui `p.opex_capex AS parent_opex_capex`; **GROUP BY inclui `p.opex_capex`** (fix crítico — coluna não-agregada deve estar no GROUP BY); `.map()` propaga o campo.

- **`src/components/settings/category-manager.tsx`** — `CategoryItem` inclui `opexCapex: string`; novo componente `OpexCapexBadge` (badge clicável emerald/amber); `PaiRow` exibe o badge ao lado dos toggles de visibilidade (apenas aba DRE); atualização otimista com rollback via `handleSetOpexCapex`.

- **`src/app/(authenticated)/configuracoes/categorias/page.tsx`** — importa e passa `onSetOpexCapex={setParentOpexCapex}` ao `<CategoryManager>`.

- **`src/app/(authenticated)/fluxo/fluxo-client.tsx`** — `ParentNode` inclui `opexCapex`; novos useMemos `opexParents`, `capexParents`, `totalOpexByMonth`, `totalCapexByMonth`, `opexTotal`, `capexTotal`; tabela reestruturada: seção OPEX → Total OPEX (bg-emerald-900/30) → separador tracejado → seção CAPEX → Total CAPEX (bg-amber-900/20) → separador → Total líquido (bg-slate-800); `Fragment` com key para multi-row maps.

**Bug crítico resolvido:** `p.opex_capex` estava no SELECT mas não no GROUP BY — PostgreSQL rejeitava a query com "column must appear in GROUP BY clause". Fix: adicionado à cláusula GROUP BY em `fluxo-mensal.ts`.

**Ajustes de UX pós-entrega:**
- Botão "Recolher/Expandir todos" adicionado ao cabeçalho do card (usa `parentNodes` já computado; alterna entre colapsar e expandir todos os pais de uma vez).
- Linhas "Total OPEX" e "Total CAPEX" tiveram cor alterada de `bg-emerald-900/30` (verde sobre verde, difícil leitura) para `bg-slate-100 border-slate-300` — valores emerald/rose sobre fundo claro, mesma legibilidade das células normais.

TypeScript: 0 erros.

---

### ✅ Sessão — Tabela "Geração de Caixa por Categoria" em `/fluxo` *(concluída)*

**Contexto:** o `/fluxo` exibia apenas projeção semanal e recorrências. Esta sessão adiciona uma tabela mensal no topo — estilo DRE — onde cada linha é uma Natureza (pai → filho) e cada coluna é um mês. O valor é o líquido (entradas − saídas) de caixa da categoria no mês, com drill-down para transações.

**O que mudou:**

- **`src/server/fluxo-mensal.ts`** (criado) — server action `getFluxoMensalData(filters: DreFilters)`: query SQL com JOIN em categories (filho + pai), filtros de org/status/data/BP_TYPES/hideInCashflow + filtros condicionais de CC/BU/LE; `SUM(CASE WHEN direction='inflow' THEN amount ELSE -amount END)` → `net_amount`; GROUP BY filho+pai+mês; helper `generateMonthRange` (parse numérico sem `new Date(string)`). Tipos exportados: `FluxoMensalCategoryRow`, `FluxoMensalData`.

- **`src/app/(authenticated)/fluxo/page.tsx`** — `Promise.all` estendido com `getFluxoMensalData`, `getCostCenters`, `getBusinessUnits`, `getLegalEntities`, `getLeafCategories`; helper `defaultMensalRange()` (12 meses, parse numérico).

- **`src/app/(authenticated)/fluxo/fluxo-client.tsx`** — sub-componente `FluxoCaixaCategoria` (~300 linhas): filtros De/Até + CC/UN/LE + botão Filtrar; tabela hierárquica (pai bold, filho indentado clicável); drill-down via `getDreDrillDown` + `DrillDownDialog` compartilhado; `collapsedParents` por chevron; `isPending` com `opacity-50`; persistência em `localStorage` (`lure:fluxo:mensal:filters`); "Total líquido" em `bg-slate-800`; cores emerald/rose/muted por valor.

TypeScript: 0 erros.

---

### ✅ Sessão — Drill-down no `/balanco` (células e labels clicáveis → dialog compartilhado) *(concluída)*

**Contexto:** o `/balanco` exibia uma tabela multi-coluna por mês sem nenhuma navegação para as transações subjacentes. O `/dre` já tinha essa UX desde a sessão "Drill-down do DRE". Esta sessão traz a mesma UX para o BP, reusando o mesmo dialog extraído para `transacoes-shared/`.

**O que mudou:**

- **`src/components/transacoes-shared/drill-down-dialog.tsx`** (criado) — `DrillDownDialog` extraído do `dre-client.tsx` (era inline, ~480 linhas). Componente genérico com props: `open`, `onOpenChange`, `title`, `subtitle?`, `data`, `loading`, `onDataChange`, `leafCategories`, `costCenters`, `businessUnits`, `legalEntities`. Toda a lógica de filtros client-side, sort, select-all, batch classify e delete por linha foi preservada. Reseta filtros/seleção ao fechar (`useEffect` em `open`). Tamanho: `w-[98vw] max-w-none max-h-[92vh]`.

- **`src/app/(authenticated)/dre/dre-client.tsx`** (refatorado) — removido o `DrillDownDialog` inline (~480 linhas). Importa o componente compartilhado. Sem regressão funcional. Imports mortos (`Dialog*`, `AlertDialog*`, `classifyTransaction`, `deleteTransactions`, `AmountFilter`, `DirectionFilter`, `CellCombobox`, `CategoryCellCombobox`, `BatchClassifyDialog`, `ACCT_LABELS`, `Trash2`, `fmtDate`) removidos.

- **`src/server/balance-sheet.ts`** — adicionado `getBalancoDrillDown(categoryIds: string[], yearMonths: string[])`:
  - Resolve os `docId` de BP para o intervalo [minMonth, maxMonth], deduplicando por YYYY-MM (mais recente por mês), mantendo apenas meses presentes em `yearMonths`.
  - Query SQL com LEFT JOINs (categories, cost_centers, business_units, legal_entities, data_sources).
  - Filtro: `document_id IN (...)` AND `category_id IN (...)` AND `status NOT IN ('pending', 'duplicate')`.
  - Signed URLs em batch para `customLogoPath` (igual ao DRE).
  - Retorna `{ transactions: DrillDownTransaction[] }`.

- **`src/app/(authenticated)/balanco/page.tsx`** — `Promise.all` estendido: busca paralela de `getCategories`, `getCostCenters`, `getBusinessUnits`, `getLegalEntities`. Computa `leafCategories` (categorias sem filhos). Passa tudo ao `BalancoClient`.

- **`src/app/(authenticated)/balanco/balanco-client.tsx`** — 4 novas props (`leafCategories`, `costCenters`, `businessUnits`, `legalEntities`). Estado `drill: DrillState | null` com `{ title, subtitle, categoryIds, yearMonths }`. Handlers `openDrill()`/`closeDrill()`. Labels e células de Group/Pai/Filho viram `<button>` clicáveis: label clica em todos os meses visíveis; célula clica no mês individual (só se valor ≠ 0). Seções ATIVO/PASSIVO e linha PL não são clicáveis (são calculadas, sem transações diretas). `<DrillDownDialog>` renderizado ao final, condicionado em `drill !== null`.

**Diferença de escopo vs. DRE:** o DRE filtra por `category_id + date range` diretamente em `transactions`. O BP filtra por `document_id` (snapshot do upload), pois cada mês de BP corresponde ao documento BP mais recente daquele mês — `getBalancoDrillDown` resolve esse mapeamento antes da query principal.

TypeScript: 0 erros. ESLint: 0 warnings.

---

### ✅ Sessão — Tela de gestão de regras em `/configuracoes/regras` *(concluída)*

**Contexto:** as regras de categorização (`categorization_rules`) só nasciam implicitamente via classificação em `/transacoes`, drill-down do DRE ou confirmações em `/transacoes/revisao`. Quando uma regra ficava errada (descrição com lixo dinâmico, alvo trocado por engano), só dava pra corrigir reclassificando outra transação no mesmo `(description, accountId)` — sem visibilidade nem deleção direta. Agora há tela própria.

**O que mudou:**

- **`src/server/categorization-rules.ts`** (criado) — 5 server actions:
  - `listRules(filters)` — joins com `categories`, `cost_centers`, `business_units`, `legal_entities` para enriquecer com nomes. Filtros: `q` (ILIKE em `conditions->>'description'`), `accounts` (multi-select com sentinel `__none__` = regras globais sem accountId), `categories` (multi-select com `__none__` = sem targetCategoryId). Pagina em 100/página. Lista **apenas** regras em formato novo via `conditions ? 'description'` — regras antigas em formato `{ field, op, value }` ficam invisíveis sem precisar migration.
  - `createRule(input)` — validação Zod: descrição obrigatória (max 200), pelo menos um alvo, accountId opcional. Bloqueia duplicação `(description, accountId)` na org.
  - `updateRule(id, input)` — mesma validação, detecta colisão com outra regra antes de salvar.
  - `deleteRule(id)` — hard delete.
  - `deleteRules(ids[])` — disponível para futuro batch delete.

- **`src/components/settings/rule-edit-dialog.tsx`** (criado) — Dialog reusado em create/edit. Campos: descrição (textarea max 200) + conta (`CellCombobox` com "Todas as contas" = null) + categoria-alvo (`CategoryCellCombobox` agrupado por tipo DRE/BP) + CC + UN + Entidade. Botão "Salvar" só habilita com descrição + pelo menos um alvo.

- **`src/components/settings/rules-manager.tsx`** (criado) — Tabela viewport-fill seguindo `docs/DATA_TABLE_PATTERN.md`:
  - Zona 1: header com título + "Limpar filtros" + "Nova regra"
  - Zona 2: totalizador "N regras"
  - Zona 4: tabela com 7 colunas (Descrição com busca no header + Conta com MultiSelectFilter + Categoria-alvo com MultiSelectFilter agrupado + CC/UN/Entidade read-only + ações)
  - Zona 5: paginação à direita
  - Linha sem `accountId` mostra badge cinza "Todas as contas". Linha com `matchCount > 0` mostra "aplicada N×".
  - Ações ✏ e 🗑 aparecem ao hover; delete via `AlertDialog` com warning sobre `matchCount`.

- **`src/app/(authenticated)/configuracoes/regras/page.tsx`** (criado) — server component: `Promise.all` paralelo de `listRules` + 4 listas de dimensão (categorias/CCs/BUs/LEs) + `getDataSourcesWithTransactions` para o dropdown de contas. Wrapper `h-full flex flex-col overflow-hidden` para o padrão viewport-fill funcionar dentro do `AppShell`.

- **`src/app/(authenticated)/configuracoes/page.tsx`** — card novo no bloco "Automação" (abaixo do toggle de Categorização automática), ícone `Zap`, link para `/configuracoes/regras`.

**Não-objetivos (fora do escopo desta sessão):** toggle ativar/desativar (delete é definitivo), bulk delete/edit, exibir `matchCount` como coluna sortável, editar `priority`.

TypeScript: 0 erros. ESLint: 0 warnings.

---

### ✅ Sessão — Fix dos 3 bugs do motor de regras *(concluída)*

**Contexto:** usuário reportou em `/transacoes` que regras "não estavam aprendendo" — todas as transações Pix outflow caíam em "Transferência entre Contas" mesmo após classificação manual de uma delas como "Compras". Investigação mostrou 3 bugs distintos que se compunham:

**Bug 1 — `src/jobs/categorize-transaction.ts`:** o SELECT da transação não incluía `accountId`. Resultado: dentro de `categorizeTransaction`, `tx.accountId ?? null` virava `null` e o matcher em `categorizer.ts` pulava toda regra com escopo de conta (`if (c.accountId) { if (!accountId || ...) continue }`). Manual classification criava a regra com accountId, mas ela nunca era aplicada em syncs subsequentes. **Fix:** adicionado `accountId: transactions.accountId` ao SELECT — propagado via `...tx` para `categorizeTransaction`.

**Bug 2 — `src/server/review.ts:upsertRuleFromConfirmation`:** gravava `conditions: { field: 'description', op: 'contains', value: description }`, formato anterior à migration 0019. O matcher novo só entende `{ description, accountId? }` — então rules criadas via confirmação em `/transacoes/revisao` eram silenciosamente ignoradas. **Fix:** reescrita pro formato novo, mirror exato de `upsertRule` em `transactions.ts`, com escopo composto `(description, accountId)`.

**Bug 3 — `src/server/review.ts:confirmSuggestions`:** SELECT não trazia `accountId`. Mesmo se Bug 2 fosse corrigido isoladamente, regras nasceriam globais. **Fix:** `accountId` incluído no SELECT e propagado para o upsert.

**Por que o sintoma aparentava "match por prefixo Pix":** as regras criadas manualmente em `/transacoes` (formato novo, com accountId) deveriam matchar, mas Bug 1 as silenciava. Caía-se sempre no LLM (camada 4), que recebia o hint `pluggyCategory: "Transferências PIX"` e devolvia "Transferência entre Contas" consistentemente. O comportamento parecia ser "regra ampla" mas era LLM determinístico em outflows Pix.

**Validação prática:** depois do fix, clicar "Categorizar agora" em `/transacoes` faz as regras manuais finalmente atuarem antes do LLM — pares `(description, accountId)` idênticos recebem a mesma categoria sem nova chamada Haiku.

TypeScript: 0 erros.

---

### ✅ Sessão — Drill-down do DRE com UX igual a `/transacoes` + extração de componentes compartilhados *(concluída)*

**O que mudou:**

- **`src/components/transacoes-shared/`** (criada) — pasta nova com componentes compartilhados entre `/transacoes` e o drill-down do DRE. Antes, ~530 linhas de filtros, headers, células e batch dialog viviam inline em `transacoes-client.tsx`. Extraído para:
  - `types.ts` — `CATEGORY_TYPE_LABELS`, `ACCT_LABELS`, tipos `DimensionOption`, `CategoryItem`, `BatchFormState`
  - `col-header.tsx` — `ColHeader` (header com sort + filter slot + clear button)
  - `filters.tsx` — `MultiSelectFilter`, `AmountFilter`, `DescFilter`, `DirectionFilter`, `ReportTypeFilter`
  - `cell-combobox.tsx` — `CellCombobox`, `CategoryCellCombobox`, `BatchCombobox`
  - `batch-classify-dialog.tsx` — Dialog completo auto-contido (recebe `selectedIds`, dimensões e `onSuccess`)

- **`src/app/(authenticated)/transacoes/transacoes-client.tsx`** — removeu definições inline, importa do shared. Sem regressão visual ou funcional. `BatchClassifyDialog` substituiu o Dialog inline antigo.

- **`src/lib/dre-types.ts`** — `DrillDownTransaction` ganhou `accountId`, `accountName`, `accountType`, `accountNumber`, `connectionLogoUrl`, `connectionBadge`.

- **`src/server/dre.ts`** — `getDreDrillDown`: JOIN com `data_sources`, signed URLs de `customLogoPath` em batch (uma chamada por dataSourceId único), mapeamento dos campos novos no resultado.

- **`src/app/(authenticated)/dre/dre-client.tsx`** — `DimCellCombobox` deletado; `DrillDownDialog` reescrito do zero (de ~270 para ~450 linhas) com:
  - Mesma UX da tabela `/transacoes`: 11 colunas (checkbox + Data + Descrição + Valor + Banco/Conta + Tipo + Categoria + CC + UN + Entidade + trash)
  - `ColHeader` em cada coluna com sort + filter + clear
  - Banco/Conta com logo (5x5) + nome/número + badge custom da conexão
  - Checkbox por linha + select all
  - Botão "Alterar X em lote" → `BatchClassifyDialog` reutilizado
  - Trash por linha (hover) → `AlertDialog` de confirmação → `deleteTransactions`
  - Sort e filtros 100% client-side (state local, não polui URL)
  - Botão "Limpar filtros" global no header do dialog
  - Dialog ocupa `w-[98vw] max-w-none` (quase toda a tela); coluna Descrição flex sem largura fixa cresce com o espaço

- **`src/server/transactions.ts`** — `classifyTransaction`, `batchClassifyTransactions` e `deleteTransactions` agora chamam `revalidatePath('/dre')` além de `/transacoes` (e `/contas` no delete).

TypeScript: 0 erros em todas as etapas.

---

### ✅ Sessão — Regras de categorização com escopo `description + accountId` *(concluída)*

**Problema resolvido:** descrição "RENDIMENTOS PAGO APLIC" é genérica e aparece em todas as contas, mas CC/UN/LE são diferentes por conta. Regras antigas matchavam só por descrição → classificavam errado em contas diferentes.

**O que mudou:**

- **`db/migrations/rls/0019_reset_categorization_rules.sql`** (criada) — `DELETE FROM categorization_rules`. Aplicar manualmente no Supabase Studio. Regras antigas são apagadas; novas classificações criam regras com escopo correto desde o início.

- **`src/lib/categorizer.ts`** — `applyRules` reescrita:
  - Conditions agora é `{ description?: string, accountId?: string }` (formato flat, jsonb sem mudança de schema)
  - Match = AND implícito entre as chaves preenchidas (description: `contains` case-insensitive; accountId: `equals` exato)
  - Ordenação: regras com `accountId` vêm primeiro (mais específicas que regras globais)
  - Tipo de `tx` ganhou `accountId?: string | null`; `categorizeTransaction` passa `tx.accountId ?? null` ao `applyRules`

- **`src/server/transactions.ts`** — `upsertRule(orgId, description, accountId, data)`:
  - Chave de identidade composta: `(orgId, conditions.description, conditions.accountId)`
  - Busca regra existente; se accountId é null, busca regras sem accountId (fallback global pra uploads sem conta)
  - `classifyTransaction` e `batchClassifyTransactions` agora carregam `accountId` no SELECT e propagam para `upsertRule`
  - `batchClassifyTransactions` agrupa por `(descrição efetiva, accountId)` único — gera regras por par, não só por descrição

**Resultado prático:**

| description | accountId | category | CC | UN | LE |
|---|---|---|---|---|---|
| RENDIMENTOS PAGO APLIC | Julio (Itaú) | Receita Fin. | Kaoara | — | Julio |
| RENDIMENTOS PAGO APLIC | Wayne (Itaú) | Receita Fin. | Wayne | Serviços | Wayne |
| RENDIMENTOS PAGO APLIC | Liana (Nu) | Receita Fin. | Liana | — | Liana |

---

### ✅ Sessão — Categorizador LLM com contexto da conta *(concluída)*

**O que mudou:**

- **`src/jobs/categorize-transaction.ts`** — SELECT estendido pra trazer `accountId`, `accountName`, `accountType`, `accountNumber`, `dataSourceId`. Query nova em `data_sources` (uma só por lote via `inArray`) carrega `metadata` das conexões usadas. `dsMetaMap` indexa por `dataSourceId`; loop monta `connectionLabel` (`customLabel ?? institutionName`) e `connectionBadge` (`customBadge.text`) e propaga ao `categorizeTransaction`.

- **`src/lib/categorizer.ts`** — `categorizeTransaction` aceita 5 novos campos opcionais no `tx` (accountName/Type/Number, connectionLabel, connectionBadge). Tipo `AccountContext` exportado. Helper `buildAccountContextBlock` monta seção "Contexto da conta:" condicionalmente — só adiciona linhas para campos não-nulos. System prompt ganhou frase explícita: "priorize atribuir CC/UN/entidade quando os nomes coincidem; não force matches frágeis".

**Custo:** ~30-50 tokens extras por chamada Haiku, cache do system prompt continua ativo. Sem regressão para conexões sem `customLabel` (bloco fica vazio, prompt = atual).

---

### ✅ Sessão — UX Pluggy: sync inicial sob demanda + edição da conexão *(concluída)*

**Sync inicial sob demanda** (`metadata.awaitingFirstSync`):

- **`src/server/connections.ts`** — `registerPluggyItem` agora marca `metadata.awaitingFirstSync = true` em conexões novas; preserva o flag em reconexão; **não dispara mais o evento Inngest**. Reconexão também preserva customizações (`customLabel`, `customBadge`, `customLogoPath`) que antes eram sobrescritas — bônus. `triggerManualSync` envia `forceFirstSync: true` no payload do evento.

- **`src/jobs/sync-pluggy-item.ts`** — step novo `check-awaiting` lê `metadata.awaitingFirstSync` antes de qualquer trabalho. Se aguardando E sem `forceFirstSync`, aborta retornando `{ skipped: 'awaiting-first-sync' }`. Após sync bem-sucedido, `delete nextMeta.awaitingFirstSync` libera webhook/cron a sincronizarem incrementalmente.

- **UI (`contas-client.tsx`)** — toast pós-conexão: "Conta conectada. Clique no ícone de sincronizar para escolher a data inicial dos extratos." Subtítulo do card em **âmbar** quando aguardando.

- **Webhook e cron sem mudanças** — a salvaguarda fica no job, então qualquer disparador respeita a flag automaticamente.

**Edição de nome, badge e logo da conexão:**

- **`src/server/connections.ts`** — server actions novas:
  - `updateConnectionCustomization(dataSourceId, { customLabel, customBadge })` — salva/limpa `metadata.customLabel` e `metadata.customBadge.text`
  - `setConnectionLogoPath(dataSourceId, storagePath)` — valida path com prefix `orgId/`, atualiza metadata, apaga arquivo antigo (best-effort)
  - `removeConnectionLogo(dataSourceId)` — limpa metadata e apaga arquivo do bucket
  - `getCurrentOrgId()` — exposto para o client poder montar paths de upload
  - Tipo `OrgConnection = DataSource & { customLogoUrl: string | null }`; `getOrgConnections` gera signed URL (1h) para `metadata.customLogoPath` quando existe
  - `getDataSourcesWithTransactions` (SQL) usa `coalesce(metadata->>'customLabel', metadata->>'institutionName')` — filtro Banco em `/transacoes` mostra o nome custom
  - `getPendingTransactionsBySource` lê `customLabel` do metadata e usa como `dataSourceName` no extrato pendente

- **UI (`contas-client.tsx`)** — `EditConnectionDialog` com 3 seções:
  - **Logo**: preview 12x12 + input file (PNG/JPG/WebP, max 500KB) + botão "Remover" se há custom. Upload via cliente pro bucket `documents` (path `{orgId}/connection-logos/{dataSourceId}-{uuid}.{ext}`), server action salva o path.
  - **Nome do banco**: input texto; placeholder mostra o auto-derivado
  - **Badge (opcional)**: input texto, cinza neutro (substitui o "sandbox" automático quando definido)
  - Botão "Restaurar padrão" limpa nome+badge
- `ConnectionCard` exibe `connection.customLogoUrl ?? meta.institutionImageUrl` no `<img>`; `displayLabel = customLabel ?? bankName` (bankName derivado de `accounts[0].marketingName ?? name ?? institutionName`); badge custom em cinza neutro substitui o sandbox.

---

### ✅ Sessão — UX de tabelas e ajustes diversos *(concluída)*

- **`/transacoes` — logo + badge na coluna Banco/Conta**: `getTransactions` faz JOIN com `data_sources`, gera signed URLs em batch para `customLogoPath`, retorna `connectionLogoUrl` e `connectionBadge` por linha. Célula da coluna mostra logo 5x5 + nome/número da conta + badge custom em 2 linhas verticais.

- **Uniformização de fontes em `/transacoes`**: tudo `text-xs` (12px, mesmo dos comboboxes de classificação). Badges `text-[10px]`. Remove o salto visual antigo entre Descrição/Valor (text-sm) e demais colunas (text-xs).

- **`/contas` aba "Extrato pendente"**: `PAGE_SIZE` de 25 → **500**. Botão "Apagar X selecionados" ao lado do "Confirmar X selecionados" (com `AlertDialog` de confirmação). `deleteTransactions` agora também revalida `/contas`.

- **Toggle de categorização automática**: `Switch` em `/configuracoes` → "Automação" → "Categorização automática". `organizations.settings.autoCategorize: boolean` (default true via ausência). `categorize-transactions` job aborta cedo se `autoCategorize === false` e não há `forceRun`. Botão **"Categorizar agora"** em `/transacoes` chama `triggerCategorization()` (envia evento com `forceRun: true`).

- **EmptyState em `/transacoes` mantém filtros visíveis**: removido o branch que escondia a tabela inteira quando `localRows.length === 0`. Agora o `<thead>` + filtros sempre renderizam; EmptyState aparece abaixo da tabela. Usuário pode ajustar coluna por coluna em vez de só "Limpar tudo".

- **Voz da UX Pluggy**: limitação do plano **trial** documentada na memória do projeto (`project_pluggy_trial_limitation.md`): em sandbox só "MeuPluggy" funciona; bancos sandbox reais retornam `TRIAL_CLIENT_ITEM_CREATE_NOT_ALLOWED`. Solução adotada: usar `account.marketingName`/`account.name` para nome do banco no card, forçar `isSandbox` para conectores genéricos via `isGenericPluggyConnector` em `src/lib/pluggy.ts`.

---

### ✅ Sessão — Padrão Data Table Pro + redesign `/transacoes` e `/upload/review` *(concluída)*

**O que mudou:**

- **`docs/DATA_TABLE_PATTERN.md`** (criado) — documento canônico do padrão de tabela do projeto. Referenciado no CLAUDE.md com instrução de leitura obrigatória antes de criar qualquer tabela. Define: viewport-fill, 5 zonas (cabeçalho / totalizador / toolbar de lote / tabela / rodapé), cabeçalho de coluna em 3 zonas (sort + filtro/título + clear), tipos de filtro por dado, divisores verticais, header opaco, rodapé unificado, persistência de filtros e `PAGE_SIZE = 100`.

- **Redesign `/transacoes`** — `src/app/(authenticated)/transacoes/transacoes-client.tsx` e `page.tsx`:
  - Viewport-fill: `h-full flex flex-col overflow-hidden`; tabela com scroll interno (`flex-1 min-h-0`)
  - Filtros migrados para dentro do header de cada coluna — o filtro **é** o título
  - `ColHeader` component: `[sort] [filtro/título] [×]` por coluna
  - Novas colunas: Banco/Conta (separada da descrição) e Tipo Movimento (Entrada/Saída)
  - Filtro de valor: popover range mín/máx (`amountMin`, `amountMax`)
  - Sort em todas as colunas (16 novos casos no switch de `getTransactions`)
  - Divisores verticais sutis: `[&_td]:border-r [&_td]:border-border/20` na `<table>`
  - `bg-muted` sólido no `<thead>` (era `bg-muted/60` — causava sangramento de linhas ao rolar)
  - Rodapé unificado: totais selecionados (esquerda) + paginação (direita) em uma linha
  - Totais selecionados calculados via `useMemo` sobre `localRows` filtradas por `selectedIds`
  - `PAGE_SIZE`: 25 → 100

- **`src/server/transactions.ts`** — `amountMin`/`amountMax` adicionados; `orderBy` switch estendido com 16 casos; `leftJoin` com `categories`, `costCenters`, `businessUnits`, `legalEntities` no `baseQuery` para suportar sort por dimensão.

- **Redesign `/upload/[id]/review`** — `review-client.tsx` e `page.tsx`:
  - Mesmo padrão viewport-fill aplicado
  - Botão "Confirmar e importar" movido para zona 1 (cabeçalho, topo direito) — sempre visível
  - Filtros no header: coluna Direção (`<select>` nativo) e coluna Status (`<select>` nativo) com botão `×` individual e "Limpar filtros" na zona 2
  - `filteredRows` via `useMemo`; reset de página automático ao filtrar
  - Rodapé unificado com totais selecionados + paginação
  - `PAGE_SIZE`: 50 → 100

TypeScript: 0 erros.

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

