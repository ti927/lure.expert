# Schema Inicial — Lure

**Documento de especificação técnica do banco de dados.**
**Versão:** 2.0 — corresponde à Fase 1 do plano de construção (18 tabelas).
**Última atualização:** [data]

---

## Como usar este documento

Este documento descreve as **tabelas centrais** que serão criadas na Fase 1 do projeto. Não inclui tabelas de fases posteriores (ex: `invoices` da Fase 7 NF-e, `fixed_assets` da Fase 6, `forecasts` e `budgets` que evoluem com o uso) — essas serão especificadas quando suas fases chegarem.

**Princípio:** o que está aqui é definitivo. Mudança nessas tabelas é migração de banco (custosa). O que NÃO está aqui é evolutivo. Adicionar tabela nova depois é barato; mudar coluna de tabela existente é caro.

**Para o Claude Code:** este documento é a fonte da verdade. Quando construir a Fase 1, criar EXATAMENTE essas tabelas, com esses nomes, tipos, índices e políticas. Não inventar variações. Se houver dúvida ou conflito, parar e perguntar.

---

## Visão geral das relações

```
auth.users (Supabase Auth)
    ↓
memberships ──→ organizations
                    │
        ┌───────────┼──────────────────────────────────────────┐
        ↓           ↓              ↓              ↓             ↓
   data_sources  contacts     categories    documents     conversations
        ↓           ↓              ↓              │              ↓
   transactions  [categorization_rules]    [credit_card_invoices]  messages
        │                                                          ↓
        └─→ contact_id (fk)                                organization_facts
        └─→ category_id (fk)
        └─→ document_id (fk)
        └─→ credit_card_invoice_id (fk, nullable)

── BP (balanço patrimonial) ──────────────────────────────────────
   fixed_assets        (imobilizado)
   loans               (empréstimos e financiamentos)
   equity_movements    (movimentos de PL)
   inventory_snapshots (snapshots de estoque)

── Auditoria ─────────────────────────────────────────────────────
   agent_events   (log auditável de tudo que o expert faz)
   templates      (parsers aprendidos, podem ser globais ou por org)
```

---

## Tabela 1: `organizations`

A empresa do cliente. Unidade central de multi-tenancy — tudo é particionado por `organization_id`.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identificador único |
| `name` | text | NOT NULL | Nome de exibição da empresa |
| `cnpj` | text | UNIQUE, nullable | CNPJ formatado (XX.XXX.XXX/XXXX-XX) |
| `slug` | text | UNIQUE, NOT NULL | URL-friendly version do nome |
| `settings` | jsonb | NOT NULL, default '{}' | Configurações da empresa |
| `subscription_status` | text | NOT NULL, default 'trial' | trial, active, past_due, canceled |
| `trial_ends_at` | timestamptz | nullable | Data fim do trial |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `unique(cnpj)` — quando preenchido
- `unique(slug)`
- `idx_organizations_subscription_status` em `subscription_status`

**RLS:** usuário só vê organizations onde tem `membership` ativa.

---

## Tabela 2: `memberships`

Junção entre `auth.users` (do Supabase Auth) e `organizations`. Define qual usuário tem acesso a qual empresa, com qual papel.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK | |
| `user_id` | uuid | FK auth.users(id), NOT NULL, ON DELETE CASCADE | |
| `organization_id` | uuid | FK organizations(id), NOT NULL, ON DELETE CASCADE | |
| `role` | text | NOT NULL, default 'viewer' | owner, admin, controller, viewer |
| `invited_email` | text | nullable | E-mail convidado (antes de aceitar) |
| `invited_by_user_id` | uuid | FK auth.users(id), nullable | Quem convidou |
| `accepted_at` | timestamptz | nullable | Quando aceitou o convite |
| `created_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `unique(user_id, organization_id)` — usuário só tem uma membership por org
- `idx_memberships_org` em `organization_id`
- `idx_memberships_user` em `user_id`

**RLS:** usuário vê suas próprias memberships e memberships das orgs onde é owner/admin.

**Roles e permissões:**
- `owner` — controle total, billing, deletar empresa
- `admin` — gerencia usuários, tudo exceto billing/deletar
- `controller` — todas operações financeiras
- `viewer` — só leitura

---

## Tabela 3: `data_sources`

Cada fonte de dados conectada à organização: banco via Open Finance, ERP via upload de relatório, adquirente via API, SEFAZ via certificado, etc.

> **Nota de nomenclatura:** no plano original chamei isso de `accounts`, mas troquei pra `data_sources` pra evitar confusão com "plano de contas" (`categories`) e com "contas a pagar/receber" (que são entidades distintas).

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK | |
| `organization_id` | uuid | FK organizations, NOT NULL, ON DELETE CASCADE | |
| `type` | text | NOT NULL | bank, credit_card, erp_report, acquirer, sefaz, manual_upload |
| `provider` | text | NOT NULL | itau, omie, stone, cielo, etc. |
| `name` | text | NOT NULL | Nome de exibição ("Itaú Conta PJ", "Omie - Matriz") |
| `credentials_encrypted` | bytea | nullable | Credenciais cifradas (tokens OAuth, API keys) |
| `last_sync_at` | timestamptz | nullable | Última sincronização bem-sucedida |
| `last_sync_status` | text | nullable | success, failed, partial |
| `last_sync_error` | text | nullable | Mensagem de erro se falhou |
| `status` | text | NOT NULL, default 'active' | active, paused, error, disconnected |
| `metadata` | jsonb | NOT NULL, default '{}' | Específico do provider (conta nº, agência, etc.) |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_data_sources_org` em `organization_id`
- `idx_data_sources_status` em `(organization_id, status)`

**RLS:** filtrar por `organization_id` via membership.

**Segurança crítica:** `credentials_encrypted` usa `pgcrypto` (extensão Postgres). NUNCA expor essa coluna pra cliente. Decriptografar só no backend, no momento da chamada.

---

## Tabela 4: `contacts`

Fornecedores, clientes, funcionários, sócios. Pessoas e empresas com quem a organização tem relação financeira.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK | |
| `organization_id` | uuid | FK, NOT NULL, ON DELETE CASCADE | |
| `type` | text | NOT NULL | supplier, customer, employee, partner, other |
| `name` | text | NOT NULL | Nome ou razão social |
| `trade_name` | text | nullable | Nome fantasia |
| `document` | text | nullable | CNPJ ou CPF (apenas dígitos) |
| `document_type` | text | nullable | cnpj, cpf |
| `email` | text | nullable | |
| `phone` | text | nullable | |
| `cnae_code` | text | nullable | Código CNAE quando aplicável (enriquecido via Receita) |
| `cnae_description` | text | nullable | |
| `metadata` | jsonb | NOT NULL, default '{}' | Dados extras (endereço, observações) |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_contacts_org` em `organization_id`
- `unique(organization_id, document)` — quando document não-null
- `idx_contacts_name_search` GIN trigram em `name` (busca rápida por nome)

**RLS:** filtrar por `organization_id` via membership.

**Nota de enriquecimento:** quando uma transação chega com CNPJ novo, job assíncrono busca dados na Receita (via consulta CNPJ) e popula `name`, `trade_name`, `cnae_code`, `cnae_description` automaticamente.

---

## Tabela 5: `categories`

Plano de contas gerencial. Hierárquico (categorias podem ter pai).

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK | |
| `organization_id` | uuid | FK, NOT NULL, ON DELETE CASCADE | |
| `code` | text | NOT NULL | Código no plano ("3.1.01") |
| `name` | text | NOT NULL | Nome da categoria |
| `type` | text | NOT NULL | revenue, cost, expense, asset, liability, equity, transfer |
| `parent_id` | uuid | FK categories(id), nullable, ON DELETE RESTRICT | Categoria pai |
| `is_active` | boolean | NOT NULL, default true | |
| `metadata` | jsonb | NOT NULL, default '{}' | Cores, descrições adicionais |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `unique(organization_id, code)` — código único dentro da org
- `idx_categories_parent` em `parent_id`
- `idx_categories_org_type` em `(organization_id, type)`

**RLS:** filtrar por `organization_id` via membership.

**Seed inicial:** ao criar uma `organization`, criar plano de contas padrão brasileiro (~50 categorias DRE básicas). Cliente pode customizar depois.

**Tipos canônicos:**
- `revenue` — Receita
- `cost` — Custo (CMV, CSP)
- `expense` — Despesa operacional/administrativa
- `asset` — Ativo (uso futuro pra balanço)
- `liability` — Passivo
- `equity` — PL
- `transfer` — Transferência entre contas (não impacta DRE)

---

## Tabela 6: `transactions`

A tabela mais importante. Cada movimento financeiro vira uma linha aqui — vindo de extrato bancário, NF-e, fatura de cartão, upload de relatório, lançamento manual.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK | |
| `organization_id` | uuid | FK, NOT NULL, ON DELETE CASCADE | |
| `data_source_id` | uuid | FK data_sources, NOT NULL | De onde veio |
| `external_id` | text | nullable | ID da origem (pra deduplicação) |
| `date` | date | NOT NULL | Data de competência (quando aconteceu economicamente) |
| `effective_date` | date | nullable | Data caixa (quando entrou/saiu de fato) |
| `amount` | numeric(15,2) | NOT NULL | Valor sempre positivo |
| `currency` | text | NOT NULL, default 'BRL' | |
| `direction` | text | NOT NULL | inflow (entrada), outflow (saída) |
| `description` | text | NOT NULL | Descrição original da fonte |
| `cleaned_description` | text | nullable | Versão limpa/normalizada |
| `contact_id` | uuid | FK contacts, nullable | Fornecedor/cliente |
| `category_id` | uuid | FK categories, nullable | Categoria atribuída |
| `categorization_confidence` | numeric(3,2) | nullable | 0.00 a 1.00 |
| `categorization_method` | text | nullable | rule, recurrence, embedding, llm, manual |
| `needs_review` | boolean | NOT NULL, default false | Marca pra revisão humana |
| `status` | text | NOT NULL, default 'confirmed' | confirmed, pending, ignored, duplicate |
| `document_id` | uuid | FK documents, nullable | Documento que originou (se aplicável) |
| `raw_data` | jsonb | NOT NULL, default '{}' | Dados originais da fonte |
| `embedding` | vector(1536) | nullable | pgvector pra busca semântica |
| `metadata` | jsonb | NOT NULL, default '{}' | Tags, anotações |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_tx_org_date` em `(organization_id, date DESC)` — query principal por período
- `idx_tx_org_category` em `(organization_id, category_id)` — pra DRE
- `idx_tx_org_contact` em `(organization_id, contact_id)` — pra ver tudo de um fornecedor
- `idx_tx_org_needs_review` em `(organization_id, needs_review) WHERE needs_review = true` — partial index pra fila de revisão
- `unique(data_source_id, external_id) WHERE external_id IS NOT NULL` — deduplicação
- `idx_tx_embedding` HNSW em `embedding` — busca por similaridade

**RLS:** filtrar por `organization_id` via membership.

**Notas críticas de design:**
- `amount` é SEMPRE positivo. O sinal vem de `direction`. Isso evita bugs de "esqueci de inverter".
- `external_id` + `data_source_id` previne importar a mesma transação duas vezes
- `embedding` populado assincronamente após inserção, não bloqueia o insert

---

## Tabela 7: `documents`

PDFs, Excels, imagens enviados ou recebidos pelo sistema. Notas fiscais, extratos, contratos, comprovantes.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK | |
| `organization_id` | uuid | FK, NOT NULL, ON DELETE CASCADE | |
| `data_source_id` | uuid | FK data_sources, nullable | Se veio de fonte conectada |
| `type` | text | NOT NULL | invoice, statement, report, receipt, contract, other |
| `filename` | text | NOT NULL | Nome original do arquivo |
| `storage_path` | text | NOT NULL | Caminho no Supabase Storage |
| `mime_type` | text | NOT NULL | application/pdf, image/jpeg, etc. |
| `size_bytes` | bigint | NOT NULL | |
| `extraction_status` | text | NOT NULL, default 'pending' | pending, processing, completed, failed |
| `extraction_method` | text | nullable | template, llm, manual |
| `extracted_data` | jsonb | nullable | Dados estruturados extraídos |
| `template_id` | uuid | FK templates, nullable | Template usado na extração |
| `uploaded_by_user_id` | uuid | FK auth.users, nullable | Quem fez upload |
| `metadata` | jsonb | NOT NULL, default '{}' | |
| `created_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_documents_org` em `organization_id`
- `idx_documents_status` em `(organization_id, extraction_status)`

**RLS:** filtrar por `organization_id`.

**Notas:**
- O arquivo físico mora no Supabase Storage; aqui só guardamos referência
- `extracted_data` é a saída estruturada do parsing (linhas de tabela extraídas, dados de NF, etc.)

---

## Tabela 8: `templates`

Parsers aprendidos pra formatos recorrentes. Quando o usuário sobe um relatório de AP do Omie pela primeira vez, criamos template; próximos uploads do mesmo formato usam o template sem chamar LLM.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK | |
| `organization_id` | uuid | FK, nullable, ON DELETE CASCADE | NULL = template global compartilhado |
| `source_type` | text | NOT NULL | "erp_omie_ap", "bank_itau_statement", etc. |
| `name` | text | NOT NULL | Nome de exibição |
| `structure` | jsonb | NOT NULL | Definição do parser (colunas, regex, formato) |
| `sample_document_id` | uuid | FK documents, nullable | Doc que treinou o template |
| `created_by_user_id` | uuid | FK auth.users, nullable | |
| `success_count` | integer | NOT NULL, default 0 | Quantas vezes funcionou |
| `failure_count` | integer | NOT NULL, default 0 | Quantas vezes falhou |
| `confidence` | numeric(3,2) | NOT NULL, default 1.00 | Confiança calculada (sucesso / total) |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_templates_source_type` em `source_type`
- `idx_templates_org` em `organization_id` WHERE NOT NULL

**RLS:** templates da própria org + templates globais (organization_id IS NULL).

**Notas:**
- Templates globais são curados — só seu time/admin pode criar/atualizar
- Templates específicos da org são criados automaticamente quando um novo formato aparece naquela empresa
- A `structure` JSON descreve: posição de cabeçalhos, mapeamento de colunas, formato de data, separador decimal, etc.

---

## Tabela 9: `conversations`

Conversas do usuário com a IA (chat).

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK | |
| `organization_id` | uuid | FK, NOT NULL, ON DELETE CASCADE | |
| `user_id` | uuid | FK auth.users, NOT NULL | |
| `title` | text | nullable | Auto-gerado a partir da primeira pergunta |
| `archived_at` | timestamptz | nullable | Soft delete |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | Atualiza a cada mensagem |

**Índices:**
- `idx_conversations_org_user` em `(organization_id, user_id, updated_at DESC)`

**RLS:** usuário só vê suas próprias conversas dentro de sua org.

---

## Tabela 10: `messages`

Mensagens dentro de uma conversa.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK | |
| `conversation_id` | uuid | FK conversations, NOT NULL, ON DELETE CASCADE | |
| `role` | text | NOT NULL | user, assistant, tool |
| `content` | text | NOT NULL | Texto da mensagem |
| `tool_calls` | jsonb | nullable | Tools chamadas pela IA |
| `tool_results` | jsonb | nullable | Resultados das tools |
| `model_used` | text | nullable | claude-sonnet-4-6, claude-haiku-4-5 |
| `tokens_input` | integer | nullable | |
| `tokens_output` | integer | nullable | |
| `created_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_messages_conversation` em `(conversation_id, created_at)`

**RLS:** acesso via conversation (cascata).

---

## Tabela 11: `agent_events`

Log auditável de tudo que a IA faz. Categorização automática, anomalia detectada, narrativa gerada, decisão de Digital Worker. Importante pra debugging, custo e prestação de contas.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK | |
| `organization_id` | uuid | FK, NOT NULL, ON DELETE CASCADE | |
| `type` | text | NOT NULL | categorization, anomaly_detection, narrative_generation, etc. |
| `entity_type` | text | nullable | transaction, document, etc. |
| `entity_id` | uuid | nullable | ID da entidade afetada |
| `payload` | jsonb | NOT NULL | Detalhes do evento |
| `model_used` | text | nullable | |
| `tokens_input` | integer | nullable | |
| `tokens_output` | integer | nullable | |
| `cost_usd` | numeric(10,6) | nullable | Custo computado |
| `duration_ms` | integer | nullable | Latência |
| `success` | boolean | NOT NULL, default true | |
| `error_message` | text | nullable | |
| `created_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_agent_events_org_time` em `(organization_id, created_at DESC)`
- `idx_agent_events_entity` em `(entity_type, entity_id)`
- `idx_agent_events_type` em `(organization_id, type, created_at DESC)`

**RLS:** filtrar por `organization_id`.

**Importância:** essa tabela vai te dizer quanto cada cliente custa em IA. Sem ela, você está cego.

---

## Tabela 12: `categorization_rules`

Regras de categorização criadas pelo usuário (manualmente) ou sugeridas pelo expert (auto-geradas após padrão repetido). São aplicadas como primeira camada da cascata.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `organization_id` | uuid | FK organizations, NOT NULL, ON DELETE CASCADE | |
| `name` | text | NOT NULL | Nome legível da regra |
| `conditions` | jsonb | NOT NULL | Critérios de ativação (descrição contém X, CNPJ = Y, valor entre A e B) |
| `target_category_id` | uuid | FK categories, NOT NULL | Categoria a aplicar |
| `target_contact_id` | uuid | FK contacts, nullable | Vincular contato quando aplicar |
| `priority` | integer | NOT NULL, default 0 | Maior número = checado primeiro |
| `auto_generated` | boolean | NOT NULL, default false | true = sugestão do expert, false = criada pelo usuário |
| `confirmed_at` | timestamptz | nullable | Quando usuário confirmou regra auto-gerada |
| `is_active` | boolean | NOT NULL, default true | |
| `match_count` | integer | NOT NULL, default 0 | Quantas transações esta regra já categorizou |
| `created_by_user_id` | uuid | FK auth.users, nullable | |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_rules_org_active` em `(organization_id, is_active) WHERE is_active = true`
- `idx_rules_priority` em `(organization_id, priority DESC)`

**RLS:** filtrar por `organization_id` via membership.

**Nota de design:** regras auto-geradas com `confirmed_at IS NULL` são "propostas" — o expert sugere, o usuário confirma. Regras confirmadas ou criadas manualmente são aplicadas imediatamente.

---

## Tabela 13: `fixed_assets`

Imobilizado da empresa. Usado para construir o Ativo Não-Circulante do Balanço Patrimonial gerencial.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `organization_id` | uuid | FK organizations, NOT NULL, ON DELETE CASCADE | |
| `name` | text | NOT NULL | Descrição do bem ("Veículo Honda Civic", "Computador MacBook") |
| `description` | text | nullable | Detalhes adicionais |
| `category_id` | uuid | FK categories, nullable | Categoria no plano de contas (tipo asset) |
| `acquisition_date` | date | NOT NULL | Data de aquisição |
| `acquisition_value` | numeric(15,2) | NOT NULL | Valor pago na aquisição |
| `current_value` | numeric(15,2) | NOT NULL | Valor contábil atual (depreciado) |
| `depreciation_method` | text | nullable | linear, accelerated, none |
| `useful_life_months` | integer | nullable | Vida útil estimada em meses |
| `monthly_depreciation` | numeric(15,2) | nullable | Depreciação mensal calculada |
| `status` | text | NOT NULL, default 'active' | active, sold, written_off, disposed |
| `disposed_at` | date | nullable | Quando foi vendido/baixado |
| `disposal_value` | numeric(15,2) | nullable | Valor recebido na baixa |
| `transaction_id` | uuid | FK transactions, nullable | Transação de aquisição vinculada |
| `metadata` | jsonb | NOT NULL, default '{}' | Número de série, localização, etc. |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_fixed_assets_org` em `(organization_id, status)`

**RLS:** filtrar por `organization_id`.

---

## Tabela 14: `loans`

Empréstimos e financiamentos da empresa. Compõe o Passivo Circulante (parcelas curto prazo) e Passivo Não-Circulante do BP.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `organization_id` | uuid | FK organizations, NOT NULL, ON DELETE CASCADE | |
| `name` | text | NOT NULL | Nome ("Capital de giro Itaú — mar/2024") |
| `lender` | text | NOT NULL | Credor ("Itaú BBA", "BNDES", "Sócio João") |
| `type` | text | NOT NULL | working_capital, investment, payroll, partner_loan, other |
| `original_amount` | numeric(15,2) | NOT NULL | Valor original contratado |
| `current_balance` | numeric(15,2) | NOT NULL | Saldo devedor atual |
| `interest_rate_annual` | numeric(8,4) | nullable | Taxa anual (ex: 0.1850 = 18,50% a.a.) |
| `start_date` | date | NOT NULL | Data de contratação |
| `end_date` | date | nullable | Vencimento final |
| `installment_amount` | numeric(15,2) | nullable | Valor da parcela |
| `installment_count_total` | integer | nullable | Total de parcelas |
| `installment_count_paid` | integer | NOT NULL, default 0 | Parcelas já pagas |
| `status` | text | NOT NULL, default 'active' | active, paid_off, in_default, renegotiated |
| `category_id` | uuid | FK categories, nullable | Categoria no plano de contas (tipo liability) |
| `metadata` | jsonb | NOT NULL, default '{}' | Número do contrato, observações |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_loans_org_status` em `(organization_id, status)`

**RLS:** filtrar por `organization_id`.

---

## Tabela 15: `equity_movements`

Movimentos de Patrimônio Líquido que não passam pela DRE operacional: aportes de capital, retiradas de sócios, distribuição de lucros, reservas.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `organization_id` | uuid | FK organizations, NOT NULL, ON DELETE CASCADE | |
| `type` | text | NOT NULL | capital_contribution, capital_withdrawal, profit_distribution, reserve_transfer, other |
| `amount` | numeric(15,2) | NOT NULL | Valor sempre positivo |
| `direction` | text | NOT NULL | inflow (aumento de PL), outflow (redução de PL) |
| `date` | date | NOT NULL | Data de competência |
| `description` | text | NOT NULL | Descrição do movimento |
| `category_id` | uuid | FK categories, nullable | Categoria do plano de contas (tipo equity) |
| `transaction_id` | uuid | FK transactions, nullable | Transação bancária vinculada (se houver fluxo) |
| `metadata` | jsonb | NOT NULL, default '{}' | |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_equity_movements_org_date` em `(organization_id, date DESC)`

**RLS:** filtrar por `organization_id`.

**Nota:** aportes e retiradas de sócios são registrados aqui, não em `transactions`, para não distorcer a DRE operacional. O link via `transaction_id` (nullable) mantém rastreabilidade com o fluxo de caixa quando há movimentação bancária correspondente.

---

## Tabela 16: `inventory_snapshots`

Snapshots manuais ou importados do valor de estoque. Usado para compor o Ativo Circulante do BP. Não é gestão de estoque — é só o saldo financeiro do estoque em datas-chave.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `organization_id` | uuid | FK organizations, NOT NULL, ON DELETE CASCADE | |
| `snapshot_date` | date | NOT NULL | Data de referência do saldo |
| `total_value` | numeric(15,2) | NOT NULL | Valor total do estoque nessa data |
| `notes` | text | nullable | Observações ("conferência física de março") |
| `items` | jsonb | nullable | Lista de itens se fornecida (nome, qtd, valor unitário) |
| `created_by_user_id` | uuid | FK auth.users, nullable | |
| `metadata` | jsonb | NOT NULL, default '{}' | |
| `created_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_inventory_org_date` em `(organization_id, snapshot_date DESC)`

**RLS:** filtrar por `organization_id`.

**Nota de design:** só guarda snapshots — sem atualização nem DELETE. Para corrigir um valor, insere novo snapshot na mesma data com valor correto; o mais recente por data é o autoritativo.

---

## Tabela 17: `credit_card_invoices`

Faturas de cartão de crédito corporativo. Cada fatura agrupa as compras do período; as compras individuais ficam em `transactions` com FK pra cá.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `organization_id` | uuid | FK organizations, NOT NULL, ON DELETE CASCADE | |
| `data_source_id` | uuid | FK data_sources, NOT NULL | Fonte do cartão de crédito |
| `reference_month` | text | NOT NULL | Mês de referência no formato "YYYY-MM" |
| `closing_date` | date | nullable | Data de fechamento da fatura |
| `due_date` | date | nullable | Data de vencimento |
| `total_amount` | numeric(15,2) | NOT NULL | Valor total da fatura |
| `status` | text | NOT NULL, default 'open' | open, paid, overdue, disputed |
| `paid_by_transaction_id` | uuid | FK transactions, nullable | Transação bancária que pagou esta fatura |
| `paid_at` | date | nullable | Data do pagamento |
| `document_id` | uuid | FK documents, nullable | PDF da fatura |
| `metadata` | jsonb | NOT NULL, default '{}' | |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_cc_invoices_org` em `(organization_id, status)`
- `unique(data_source_id, reference_month)` — uma fatura por cartão por mês

**RLS:** filtrar por `organization_id`.

**Nota de design:** compras do cartão ficam em `transactions` com `credit_card_invoice_id` e `date` = data da compra. O pagamento da fatura no banco é uma transação com `category_id` = categoria `transfer` — não é despesa nova, evita dupla contagem na DRE.

---

## Tabela 18: `organization_facts`

Memória curada do expert sobre a organização. Cresce só com confirmação humana. Fatos ativos são incluídos no system prompt do expert para personalizar respostas.

| Coluna | Tipo | Constraint | Descrição |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `organization_id` | uuid | FK organizations, NOT NULL, ON DELETE CASCADE | |
| `type` | text | NOT NULL | person, process, preference, context, other |
| `key` | text | NOT NULL | Rótulo curto ("responsável pelo comercial", "faturamento típico mensal") |
| `value` | text | NOT NULL | Conteúdo do fato ("Pedro Silva cuida de toda a área comercial") |
| `source_conversation_id` | uuid | FK conversations, nullable | Conversa onde foi mencionado |
| `source_message_id` | uuid | FK messages, nullable | Mensagem específica |
| `suggested_by_expert` | boolean | NOT NULL, default true | false = inserido diretamente pelo usuário |
| `confirmed_by_user_id` | uuid | FK auth.users, nullable | Quem confirmou |
| `confirmed_at` | timestamptz | nullable | Quando foi confirmado |
| `archived_at` | timestamptz | nullable | Soft delete |
| `metadata` | jsonb | NOT NULL, default '{}' | |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | |

**Índices:**
- `idx_org_facts_active` em `(organization_id, archived_at) WHERE archived_at IS NULL`
- `idx_org_facts_type` em `(organization_id, type)`

**RLS:** filtrar por `organization_id`.

**Nota de design:** fatos com `confirmed_at IS NULL` são "pendentes de confirmação" — o expert detectou algo digno de lembrar e propôs ao usuário, mas ainda não foi confirmado. Só fatos confirmados entram no system prompt. Isso é o princípio 15 do CLAUDE.md: memória híbrida com confirmação humana obrigatória.

---

## Políticas de Row Level Security (RLS) — Padrão

Toda tabela com `organization_id` segue o mesmo padrão de RLS:

```sql
-- Habilitar RLS
ALTER TABLE [tabela] ENABLE ROW LEVEL SECURITY;

-- Política de SELECT
CREATE POLICY "Membros veem dados da própria organização"
  ON [tabela]
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM memberships 
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- Política de INSERT
CREATE POLICY "Membros inserem dados da própria organização"
  ON [tabela]
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM memberships 
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

-- UPDATE e DELETE seguem o mesmo padrão
```

**Crítico:** essas políticas são a **única coisa** que impede vazamento entre clientes. Toda tabela com dados financeiros DEVE ter RLS ativada. Sem exceção.

---

## Extensões Postgres necessárias

Ativar antes de criar as tabelas (na ordem):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- pra gen_random_uuid() e cifragem
CREATE EXTENSION IF NOT EXISTS vector;    -- pgvector pra embeddings
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- pra busca de texto (índices GIN trigram)
```

---

## Convenções gerais

1. **Toda tabela tem `id` (uuid), `created_at` e `updated_at`** (com trigger pra atualizar)
2. **Toda tabela com dados de cliente tem `organization_id`** (multi-tenancy)
3. **Nomes de tabela em snake_case plural** (`transactions`, não `Transaction`)
4. **Nomes de coluna em snake_case**
5. **FK com `_id` no nome** (`contact_id`, `organization_id`)
6. **Valores monetários SEMPRE em `numeric(15,2)`**, nunca `float` ou `real`
7. **Datas como `date` quando só interessa o dia; `timestamptz` quando interessa hora**
8. **Soft delete via coluna `archived_at` ou `deleted_at` em vez de DELETE físico** (especialmente pra transactions, conversations)
9. **JSON em colunas `jsonb`, nunca `json`** (jsonb é indexável e mais rápido)

---

## Migrations

Cada alteração de schema vira uma migration versionada via Drizzle ORM em `/db/migrations/`. Nunca alterar tabela direto no Supabase Studio em produção — sempre via migration commitada.

Naming: `0001_create_organizations.sql`, `0002_create_memberships.sql`, etc.

---

## Tabelas DIFERIDAS para fases posteriores

Estas tabelas existem no roadmap mas serão especificadas quando suas fases chegarem (porque os requisitos podem mudar com base no aprendizado):

| Tabela | Fase | Descrição |
|---|---|---|
| `invoices` | Fase 7 | NF-e estruturadas (entradas e saídas via SEFAZ) |
| `acquirer_sales` | Fase 8 | Vendas detalhadas das adquirentes (Stone, Cielo, etc.) antes de virar transaction |
| `forecasts` | Fase 6 | Projeções de fluxo de caixa |
| `budgets` | Posterior | Orçamentos anuais |
| `scenarios` | Posterior | Cenários de simulação |
| `insights` | Fase 9 | Findings proativos do agente |
| `subscription_plans` | Fase 10 | Planos e billing |
| `usage_metrics` | Fase 10 | Métricas de uso pra billing |

Quando uma dessas fases chegar, atualizamos este documento.

---

## Histórico de versões

- **v1.0** — schema inicial das 11 tabelas centrais
- **v2.0** — expandido para 18 tabelas: adicionadas `categorization_rules`, `fixed_assets`, `loans`, `equity_movements`, `inventory_snapshots`, `credit_card_invoices`, `organization_facts`. Diagrama de relações atualizado. Motivação: consolidar todas as tabelas necessárias para as Fases 1–6 num schema único antes de iniciar a implementação.
