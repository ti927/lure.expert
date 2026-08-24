# Guia Operacional — lure.expert

**Documento de protocolo de execução do MVP com Claude Code.**
**Versão:** 1.1
**Última atualização:** 19/05/2026

---

## Como usar este documento

Este é o "como" da construção. O trio operacional é:

- **`PLANO_DE_CONSTRUCAO.md`** — o quê construir, em que ordem, definition of done de cada fase
- **`SCHEMA_INICIAL.md`** — como modelar os dados
- **`GUIA_OPERACIONAL.md`** (este) — como conduzir o trabalho com Claude Code, sessão a sessão

Leia antes de iniciar cada fase nova e consulte sempre que tiver dúvida de protocolo.

---

## Parte 1 — Princípios operacionais

### Fase ≠ sessão

Uma sessão com Claude Code é 1-2h focada em um objetivo recortado. Uma fase do plano leva 1-3 semanas e contém várias sessões. Não tente fechar uma fase numa sessão só — não cabe e quebra.

### Conversa nova a cada fase

Cada fase começa em conversa nova com Claude Code (no Cursor ou VS Code com extensão). Isso mantém contexto limpo. Dentro da mesma fase, mantenha conversa única o quanto possível para Claude Code reter contexto recente. Se a conversa ficar pesada (15+ trocas, lentidão), abra nova e cite o CLAUDE.md.

### CLAUDE.md é seu memorando persistente

Claude Code lê o CLAUDE.md automaticamente em toda sessão. Atualize antes de cada fase nova e quando alguma decisão estrutural mudar dentro da fase. É o cérebro persistente do projeto.

### Você é o gerente, Claude Code é o engenheiro

Você decide o quê. Ele propõe o como. Você aprova ou questiona. Nunca aceite mudança grande sem entender por quê. Quando ele propuser solução grande, peça pra fatiar.

### Sempre teste o que ele entregou

Antes de fechar uma sessão, teste manualmente o critério da sessão. Se quebrou, conserte agora — nunca empurre defeito pra próxima sessão.

---

## Parte 2 — Ritual de início de fase

Antes da primeira sessão da fase, faça nessa ordem:

1. Abrir o `CLAUDE.md` e atualizar a seção "Fase atual" (texto sugerido para cada fase na Parte 4)
2. Commitar o CLAUDE.md atualizado
3. Reler a seção da fase no `PLANO_DE_CONSTRUCAO.md` (deliverables + definition of done)
4. Reler a subdivisão da fase na Parte 4 deste guia
5. Abrir conversa nova com Claude Code

Esse ritual leva 10-15 minutos. Pular ele custa horas depois.

---

## Parte 3 — Template de sessão

### Abertura — primeira mensagem da sessão

```
Lendo CLAUDE.md pra contexto. Estamos na Fase X — [tema da fase].

Hoje vou trabalhar em [sub-objetivo da sessão].

Definition of done desta sessão: [critério testável, em uma frase].

Antes de implementar, me proponha o plano de ataque em até 5 passos numerados.
Depois que eu aprovar, vamos passo a passo, testando entre eles.
```

### Durante a sessão

- Após receber o plano, aprove ou questione cada passo
- Implementação em pequenos passos com teste entre eles
- Se Claude Code "trava" (tenta a mesma coisa duas vezes sem sucesso), pare e reformule do zero
- Se erro aparecer, copie o erro completo e cole — descreva o sintoma, não o que você acha que é a causa
- Se ele propuser três mudanças juntas, peça pra fazer uma de cada vez

### Fechamento — última mensagem da sessão

1. Teste manual do critério da sessão (abrir navegador, conferir banco, rodar fluxo)
2. Pedir commit com mensagem clara: "Sessão X.Y — [descrição curta]"
3. Atualizar CLAUDE.md se mudou alguma decisão estrutural
4. Anotar em nota separada (Notion, Apple Notes, papel): "terminei X / pendente Y / dúvidas pra próxima Z"

---

## Parte 4 — Subdivisão das fases em sessões

Estimativa total: 43-65 sessões em 17-18 semanas. Equivale a 3-4 sessões por semana.

As subdivisões abaixo são sugestão, não lei. Algumas sessões podem ser combinadas se você estiver fluindo; outras podem precisar virar duas se travarem.

---

### FASE 0 — Scaffolding (3-5 sessões)

**Texto pro CLAUDE.md ("Fase atual"):**
> Iniciando Fase 0 — Scaffolding. Objetivo: Next.js 14 + Supabase + login + dashboard básico no ar em Vercel.

**Sessão 0.1 — Inicialização do projeto**
- Objetivo: projeto Next.js 14 criado, dependências instaladas, Supabase conectado, `.env.local` configurado
- DoD: rodar `npm run dev` localmente, abrir `localhost:3000`, ver tela inicial
- Prompt de abertura: usar o template oficial da Fase 0 do plano (Parte 4 do `PLANO_DE_CONSTRUCAO.md`)

**Sessão 0.2 — Login + dashboard protegido**
- Objetivo: rota `/login` (e-mail + senha), criação de conta, rota `/dashboard` que redireciona se não autenticado e mostra e-mail do usuário
- DoD: criar conta de teste, logar, ver e-mail no dashboard

**Sessão 0.3 — Deploy Vercel + README**
- Objetivo: site público no Vercel; README com instruções de como rodar localmente
- DoD: acessar URL pública, fazer login, dashboard funciona; clonar repo em outro lugar e seguir README com sucesso

**Sessão 0.4 (se necessário) — Polimento**
- Cleanup de warnings TypeScript, ajustes de erro, garantia de que `npm run build` passa limpo

---

### FASE 0.5 — Fundações de design e voz (3-5 sessões)

**Texto pro CLAUDE.md:**
> Iniciando Fase 0.5 — Fundações de design e voz. Travar paleta, tipografia, biblioteca de componentes base, voz do expert, padrões de estado e arquitetura de informação ANTES de começar features de produto. Decisões aqui propagam.

**Sessão 0.5.1 — Design tokens**
- Tailwind config completo: emerald-700 primário, paleta neutra slate, semânticas, Inter com tabular-nums
- Página `/style-guide` renderizando paleta, tipografia, espaçamentos, sombras, raios
- DoD: `/style-guide` mostra todos os tokens visualmente

**Sessão 0.5.2 — Componentes base + financeiros**
- shadcn/ui ajustado aos tokens: Button, Input, Select/Combobox, Card, Modal, Toast, Tabs, Tooltip, Avatar, Badge, DateRangePicker
- Componentes financeiros do zero: CurrencyDisplay (R$ pt-BR), PercentageDelta, KPICard, DataTable (TanStack Table)
- Página `/style-guide/components`
- DoD: todos os componentes listados renderizados em todas as variantes

**Sessão 0.5.3 — Componentes de estado + componentes do expert**
- Estados: EmptyState, LoadingState, ErrorState, PartialDataBanner
- Expert: ReportCanvas (estrutura), InlineChart (Recharts), DiffPreview (estrutura, sem lógica)
- DoD: tudo aparece em `/style-guide/components` com exemplos

**Sessão 0.5.4 — Voz e padrões**
- Criar `docs/AI_VOICE.md` e `docs/STATE_PATTERNS.md` conforme definição da Fase 0.5 do plano
- DoD: documentos commitados; CLAUDE.md aponta pra eles como referência obrigatória ao gerar texto do expert

**Sessão 0.5.5 — Arquitetura de informação (layout principal)**
- Sidebar esquerda colapsável (estado persistido em localStorage), seletor de organização no topo, navegação plana
- Ícone do expert flutuante canto inferior direito + drawer lateral 480px (vazio por enquanto)
- Em mobile, sidebar vira drawer aberto por hamburger
- DoD: navegar entre rotas vazias funciona, sidebar colapsa, ícone do expert abre drawer

---

### FASE 1 — Schema e multi-tenancy (5-8 sessões)

**Texto pro CLAUDE.md:**
> Iniciando Fase 1 — Schema. Vamos criar as 18 tabelas centrais conforme SCHEMA_INICIAL.md v2.0, configurar RLS em todas com organization_id, criar telas admin de organização, seedar plano de contas padrão. NÃO desviar do schema sem me consultar.

**Sessão 1.1 — Setup Drizzle + extensões + tabelas de identidade**
- Drizzle ORM configurado com Postgres do Supabase
- Migrations em `/db/migrations/` numeradas
- Extensões: `pgcrypto`, `vector`, `pg_trgm`
- Tabelas 1-3: `organizations`, `memberships`, `data_sources` + RLS
- DoD: tabelas existem no Supabase Studio, RLS ativa, migrations commitadas

**Sessão 1.2 — Cadastros operacionais**
- Tabelas 4-6: `contacts`, `categories`, `categorization_rules` + RLS
- DoD: idem

**Sessão 1.3 — Cadastros de apoio pro BP**
- Tabelas 7-10: `fixed_assets`, `loans`, `equity_movements`, `inventory_snapshots` + RLS
- DoD: idem

**Sessão 1.4 — Operação financeira**
- Tabelas 11-13: `transactions`, `documents`, `credit_card_invoices` + RLS
- Especial atenção aos índices (HNSW pro embedding, partial pra `needs_review`, GIN trigram em `contacts.name`)
- DoD: idem

**Sessão 1.5 — Templates + chat + auditoria**
- Tabelas 14-18: `templates`, `conversations`, `messages`, `organization_facts`, `agent_events` + RLS
- DoD: idem

**Sessão 1.6 — Seed do plano de contas + trigger updated_at**
- Função SQL ou TypeScript que cria ~50 categorias padrão DRE brasileiro ao criar nova org, incluindo categoria `type='transfer'` obrigatória
- Trigger pra atualizar `updated_at` em todas as tabelas que têm
- DoD: criar nova org via SQL, conferir que categorias aparecem corretamente

**Sessão 1.7 — Telas admin de organização**
- `/admin/organizations`: listar, criar
- `/admin/organizations/[id]/members`: convidar (cria membership com `accepted_at` nulo), listar, alterar role
- Seletor de organização no topo do layout principal
- DoD: criar duas orgs com usuários diferentes, alternar entre elas, confirmar isolamento de dados (criar contato em uma, não aparecer na outra)

**Sessão 1.8 (folga) — Teste de isolamento + polimento**
- Teste manual completo de RLS em todas as 18 tabelas
- Ajustes de bugs encontrados

---

### FASE 2 — Ingestão e parsing (8-12 sessões)

**Atenção: coluna vertebral do produto. Invista tempo. Se uma sessão estourar pra duas, está OK.**

> ### ⚠️ Conferido em 24/ago/2026: três destas doze sessões nunca foram construídas
>
> A fase está marcada ✅ no `PLANO_DE_CONSTRUCAO.md`. **2.1** (período do arquivo), **2.8**
> (deduplicação) e **2.10** (fila de pendências) não existem no código. Elas seguem escritas
> abaixo como foram especificadas — o texto não foi alterado — mas cada uma leva uma nota do que
> foi medido no banco.
>
> **A lição de método, que vale para toda fase futura:** o DoD da Fase 2 foi dado por cumprido com
> o item *"parser LLM lida com qualquer formato BR"*, que é verdade sobre **extrair colunas** e
> falso sobre **produzir um lançamento completo**. Nenhum arquivo dos testes trazia conta, id de
> origem ou data de caixa — então nada exigiu esses campos, e a ausência deles não apareceu como
> falha. **Fase só fecha contra a lista de sessões deste arquivo, uma por uma, não contra o
> resumo de deliverables do plano.**
>
> A quitação está na **Fase 4.5** do plano de 23/ago.

**Texto pro CLAUDE.md:**
> Iniciando Fase 2 — Ingestão e parsing. Pipeline completo de upload → parsing → staging → revisão → inserção em transactions. 5 áreas (ERP, banco, adquirente, cartão de crédito corporativo, SEFAZ-placeholder), formato livre (PDF/Excel/CSV), templates híbridos global/específico, deduplicação em duas camadas, reconciliação automática AP×banco.

**Sessão 2.1 — Upload + Storage**
- Página `/upload` com seletor de área (ERP/banco/adquirente/cartão/SEFAZ-placeholder) e drag-and-drop
- Campo pra cliente declarar período do arquivo (`period_start`, `period_end`)
- Upload pro Supabase Storage, registro em `documents`
- DoD: subir arquivo, ver registro em `documents`, baixar do Storage

> **🔲 Parcial (24/ago).** Upload, Storage e `documents` existem. O período **não**: os campos vão
> para `documents.metadata` e **nenhuma tela os lê**. Escrever sem ninguém ler é o mesmo que não
> coletar, com o custo extra de parecer coletado.

**Sessão 2.2 — Inngest setup + pipeline base**
- Conta Inngest criada, SDK configurado
- Primeira função: job dispara após upload, status do documento muda `pending → processing → completed`
- DoD: subir arquivo, ver status mudar; ver execução no dashboard Inngest

**Sessão 2.3 — Parser determinístico (Excel/CSV)**
- SheetJS pra Excel, papaparse pra CSV
- Detecção básica de estrutura (cabeçalhos)
- Insert em staging table (uma `extracted_data` em `documents` jsonb por enquanto, ou tabela temporária)
- DoD: upload Excel de exemplo do Omie, ver linhas estruturadas

**Sessão 2.4 — Parser LLM (Haiku 4.5) pra PDF estruturado**
- Tentativa de extração de tabela do PDF (pdf-parse ou similar)
- Fallback pra Haiku 4.5 quando texto extraído não é tabular
- DoD: upload PDF de extrato (sample), ver linhas extraídas

**Sessão 2.5 — Parser visão (Sonnet 4.6) pra PDF imagem**
- Quando texto não é extraível (PDF escaneado), enviar como imagem pro Sonnet com prompt de extração
- DoD: upload PDF escaneado, ver linhas extraídas

**Sessão 2.6 — Sistema de templates híbrido**
- Lógica de detecção de formato pelo fingerprint do documento (estrutura de colunas + cabeçalho)
- Aplicação: template específico da org > template global > fallback LLM
- Salvar template após primeira ingestão confirmada
- DoD: segundo upload do mesmo formato não chama LLM (logado em `agent_events`)

**Sessão 2.7 — Tela de revisão de primeira ingestão**
- Tela mostrando mapeamento proposto de colunas + amostra de 10-20 linhas extraídas
- Cliente confirma ou ajusta → sistema processa arquivo inteiro e salva template
- DoD: primeira ingestão Excel passa pela tela; segunda do mesmo formato pula direto

**Sessão 2.8 — Deduplicação em duas camadas**
- Camada 1: `external_id` quando ERP/API fornece ID nativo
- Camada 2: fingerprint hash `(data + valor + descrição normalizada + posição no arquivo)` quando não fornece
- Diff inteligente: nova insere, existente atualiza, sumida marca como cancelada/removida
- DoD: reuploadar mesmo arquivo, ver 0 inserções; alterar 1 linha no arquivo e reuploadar, ver 1 update

> **🔲 Não construída na tela (24/ago).** `external_id`: Pluggy 2.592 de 2.592, upload **0** de
> 7.762. Subir o mesmo extrato duas vezes **dobra a contabilidade**, e sempre dobrou. Sobreviveu
> porque gente não reenvia sem perceber — modelo, sim, justamente quando a chamada pareceu falhar
> e deu certo. A camada 2 (hash de conteúdo) foi construída em 23/ago, mas **só no caminho do
> MCP**; levá-la à tela é a Sessão B da Fase 4.5, com este DoD literal.
>
> **Risco que o DoD não previa:** os 7.762 lançamentos já importados não têm `external_id`, então
> ligar a dedup **não alcança o passado**.

**Sessão 2.9 — Reconciliação automática AP×banco**
- Heurística: valor exato + janela de data ±5 dias + similaridade de descrição/fornecedor
- Match >85% casa automaticamente, preenche `effective_date` da transação do ERP
- Match 50-85% vai pra fila de revisão
- <50% fica órfã sinalizada
- DoD: simular AP do ERP + saída do banco com mesmo valor/data → ambas reconciliadas via `reconciled_with_transaction_id`

**Sessão 2.10 — Fila de revisão de pendências**
- Tela com linhas problemáticas (campo ausente, data inválida) + casos ambíguos de reconciliação
- Cliente aprova ou edita
- DoD: ter pelo menos 5 casos diferentes, revisar manualmente

> **🔲 Não construída (24/ago).** Linha sem data, valor ou direção é **silenciosamente pulada** em
> `approveAndInsert`, com um toast de contagem. O caso ambíguo de reconciliação ganhou fila
> (`/transacoes/revisao`, Fase 7); o caso de **campo ausente** não. O efeito mais caro disso é o
> balanço: uma linha de BP não tem data própria, cai no filtro, e **por isso nunca existiu um BP
> no banco** — 0 documentos `balance_sheet` em toda a base.

**Sessão 2.11 — Histórico de uploads por organização**
- Tela `/uploads/history` listando documentos por data, mostrando status e quantas linhas geraram
- Permite baixar arquivo original, ver transações vinculadas
- DoD: ver lista, abrir um upload, ver transações geradas

**Sessão 2.12 (folga) — Cenários end-to-end + polimento**
- Testes completos: Omie Excel + Itaú PDF + reconciliação automática

---

### FASE 3 — Categorização com IA (5-7 sessões)

**Texto pro CLAUDE.md:**
> Iniciando Fase 3 — Categorização com IA. Cascata: regra explícita → recorrência → embedding similarity → Haiku 4.5 → Sonnet 4.6 (raro). Thresholds: ≥0,90 auto / 0,50-0,90 needs_review / <0,50 pending. Casos especiais: transferências entre contas próprias (categorizar como transfer) e cartão de crédito como passivo intermediário.

**Sessão 3.1 — Estrutura da cascata + camadas 1 e 2**
- Função coordenadora que tenta cada camada em ordem
- Camada 1: regras explícitas (`categorization_rules`)
- Camada 2: recorrência (mesmo fornecedor + categoria histórica + valor compatível)
- DoD: importar 100 transações sintéticas, ver X% categorizadas só nas camadas 1+2

**Sessão 3.2 — Embedding similarity (camada 3)**
- Gerar embedding via OpenAI ou Voyage AI no insert (job Inngest assíncrono)
- Buscar N similares via pgvector na categorização
- Predomina categoria → aplica com confidence proporcional
- DoD: transação nova categorizada por similaridade com histórico

**Sessão 3.3 — Camadas LLM (Haiku 4.5 + Sonnet 4.6)**
- Prompt template com sinais + plano de contas + top-3 candidatos com justificativa
- Haiku 4.5 padrão; escalada pra Sonnet 4.6 só em casos extremos
- DoD: transação difícil categorizada com confidence; custo médio abaixo do alvo

**Sessão 3.4 — Caso especial: transferências entre contas próprias**
- Detector: mesmo valor + datas próximas (±2 dias úteis) + duas `data_sources` da mesma org
- Marcação de ambas como `transfer` (categoria do plano de contas)
- Casos ambíguos vão pra revisão
- DoD: TED entre Itaú e Bradesco da mesma org → ambas marcadas como `transfer`, não impactam DRE

**Sessão 3.5 — Cartão de crédito — parte 1: criação da fatura**
- Ao parser detectar fatura: cria registro em `credit_card_invoices` + transações com `credit_card_invoice_id`
- Cada compra individual fica em `transactions` com `date` = data da compra
- DoD: upload de fatura → ver fatura criada com compras vinculadas + status `open`

**Sessão 3.6 — Cartão de crédito — parte 2: pagamento e baixa**
- Match automático: saída no banco com descrição contendo "PAGTO CARTAO", "FATURA", "VISA", "MASTER" + valor coincidente → vincula via `paid_by_transaction_id`
- Pagamento categorizado como `transfer`
- Preenche `effective_date` das compras filhas
- Fatura muda pra `paid`
- DoD: pagamento da fatura no banco → fatura status paid; compras com `effective_date` preenchido

**Sessão 3.7 — Tela de revisão + regras automáticas**
- Tela `/transactions/review` com fila de pendências (needs_review + pending)
- Aprendizado: após N correções no mesmo padrão (mesmo fornecedor recategorizado pra mesma categoria) → propõe regra (`auto_generated=true`)
- DoD: corrigir 3x o mesmo fornecedor, ver sugestão de regra; aceitar → próximas categorizam automaticamente

---

### FASE 5 — Analytics + Expert Chat (sessões concluídas)

> **Nota de execução:** esta fase foi recortada diferente do plano original. O que foi entregue cobre analytics financeiro + expert drawer com chat Sonnet simples. Tool use agentivo fica para fase futura.

**Texto pro CLAUDE.md:**
> Fase 5 concluída (5.0 a 5.F). Analytics entregues: Dashboard KPIs, DRE 12 meses, Indicadores Financeiros, Fluxo de Caixa projetado. Expert: drawer com Sonnet, contexto KPIs do mês, histórico persistente. Pendente: 5.G (relatório fechamento mensal).

**✅ Sessão 5.0 — Queries DRE** — `dre-types.ts` + `server/dre.ts` (aggregação + drill-down)

**✅ Sessão 5.A — Página DRE** — tabela 12 meses, filtros de dimensão, drill-down por célula e por Total

**✅ Sessão 5.B — Dashboard** — KPI cards (Receita, Despesas, Lucro, Saldo) + gráfico de barras semanal Recharts

**✅ Sessão 5.D — Indicadores Financeiros** — Margem EBITDA, Liquidez Corrente, DCSR com semáforo verde/âmbar/vermelho

**✅ Sessão 5.E — Expert drawer** — chat Sonnet 4.6 com contexto KPI, histórico persistente, "Nova conversa"

**✅ Sessão 5.F — Fluxo de Caixa Projetado** — detecção de recorrências via SQL, projeção 90d, KPIs 30/60/90d

**Fase futura — Expert agentivo com tool use:**
- Tools: `search_transactions`, `aggregate_by_period`, `compare_periods`, `get_balance`
- Responde perguntas via SQL dinâmico; prompt caching no system prompt
- DoD: "quanto gastei com X em junho?" → valor correto; custo < US$ 0,03/conversa

---

### FASE 6 — Dashboard, demonstrações, indicadores (7-10 sessões)

**Texto pro CLAUDE.md:**
> Iniciando Fase 6 — Dashboard + DRE + BP + DFC + indicadores. 4 sub-entregas. Cadastros de apoio pro BP (imobilizado, empréstimos, PL, estoque) com telas próprias de CRUD. Painel de valor do expert no dashboard inicial com bases de cálculo rastreáveis e conservadoras.

**Sessão 6.1 — Dashboard inicial (KPIs principais)**
- Rota `/` (autenticada): saldo de caixa consolidado, AR aberto, AP aberto, lucro do mês corrente
- Gráfico de fluxo dos últimos 90 dias
- Top 5 categorias do mês
- Alertas críticos básicos
- DoD: abrir `/` mostra estado real da empresa com dados das fases anteriores

**Sessão 6.2 — Painel de valor do expert**
- Card específico no dashboard com: atividade do expert no mês (conversas, fechamentos, recategorizações automáticas, anomalias detectadas) + valor entregue (horas economizadas, oportunidades em R$, AR a cobrar em R$)
- Bases de cálculo documentadas em código, conservadoras
- DoD: painel renderiza com métricas reais

**Sessão 6.3 — DRE gerencial mensal**
- Estrutura completa: Receita Bruta → Deduções → Receita Líquida → Custo → Lucro Bruto → Despesas Operacionais → EBITDA → D&A → EBIT → Resultado Financeiro → LAIR → IR/CSLL → Lucro Líquido
- 12 meses lado a lado + acumulado YTD
- Comparativos MoM e YoY
- Drill-down em cada linha até a lista de transações
- DoD: DRE bate com soma das transações categorizadas (com diferenças explicáveis de timing)

**Sessão 6.4 — Telas de apoio do BP (4 cadastros)**
- `/balanco/imobilizado` (CRUD `fixed_assets`)
- `/balanco/emprestimos` (CRUD `loans`)
- `/balanco/patrimonio` (CRUD `equity_movements`)
- `/balanco/estoque` (CRUD `inventory_snapshots`)
- DoD: cadastrar exemplo de cada, listar, editar, dar baixa quando aplicável

**Sessão 6.5 — Balanço Patrimonial gerencial**
- Estrutura: AC (Caixa + Bancos + AR + Estoque), ANC (Imobilizado + Investimentos), PC (AP + Cartão + Empréstimos curto prazo), PNC (Empréstimos longo prazo), PL (Capital + Reservas + Lucros Acumulados)
- Snapshot atual + comparativo com período anterior
- Drill-down nas composições
- DoD: BP renderizado com dados reais, ativo total = passivo + PL

**Sessão 6.6 — DFC método direto**
- Entradas - saídas por categoria
- Visualização mensal (últimos 12) + diária do mês atual
- DoD: DFC renderizado, saldo final do mês bate com saldo de caixa

**Sessão 6.7 — Indicadores**
- Liquidez Corrente e Seca, Endividamento Geral, Margens (Bruta, EBITDA, Líquida), Ciclo de Caixa (PMR + PME − PMP)
- Snapshot atual + série histórica 12 meses
- Drill-down em composição
- DoD: indicadores corretos, drill-down funciona

**Sessão 6.8 (folga) — Polimento + drill-down completo**
- Garantir que todo número no produto permite drill-down até a transação
- Ajustes de UX

---

### FASE 8 — Connectors de Cartão e Adquirentes (5-6 sessões)

**Texto pro CLAUDE.md:**
> Iniciando Fase 8 — Connectors de Adquirentes. Stone, Cielo, Rede, PagBank via API REST + fallback de upload CSV/PDF. Reconciliação lote bancário × vendas individuais. Tabela `acquirer_connections` (padrão sefaz_connections). Provider abstrato com stubs por provedor.

**✅ Sessão 8.0 — Scaffolding (concluída):**
- `db/schema/acquirer-connections.ts`: tabela `acquirer_connections` com provider, merchantId, apiKeyEncrypted, apiSecretEncrypted, environment, status, lastSyncAt, metadata
- `db/migrations/rls/0023_acquirer_connections.sql`: CREATE TABLE + índices + RLS 4 políticas
- `src/lib/acquirer-provider.ts`: interface `AcquirerProvider`, `AcquirerSale`, `AbstractAcquirerProvider` stub, stubs StoneProvider/CieloProvider/RedeProvider/PagBankProvider, factory `createAcquirerProvider()`
- `src/server/acquirer-connections.ts`: 6 server actions — `getAcquirerConnections`, `createAcquirerConnection`, `updateAcquirerConnection`, `deleteAcquirerConnection`, `triggerAcquirerSync`, `getAcquirerConnectionById`
- `/contas`: nova aba "Adquirentes" com card por conexão, dialog de criação, seletor de provedor
- DoD: UI renderiza aba, dialog abre com 4 provedores disponíveis, `npm run build` limpo

**✅ Sessão 8.1 — Stone connector (concluída):**
- `src/lib/stone-client.ts`: `StoneClient` — OAuth2 `client_credentials` (token cache, renovação automática 30s antes de expirar), `fetchSales(merchantId, fromDate, toDate, cursor?)` paginado
- `src/lib/acquirer-provider.ts`: `StoneProvider` implementado usando `StoneClient`; mapeia centavos → decimal, filtra `status='approved'`
- `src/jobs/sync-acquirer-item.ts`: job Inngest `acquirer/item.sync-requested` — `ensure-data-source` (cria `data_sources` vinculado para FK de `transactions`), paginação com steps nomeados, insert em `transactions` com `accountType='ACQUIRER'`, dispara `transaction/batch-inserted`
- `src/jobs/sync-all-acquirer-items.ts`: cron 04:00 BRT, pula conexões `awaitingFirstSync=true`, janela segura 1 dia antes do último sync
- `src/app/api/inngest/route.ts`: registra `syncAcquirerItem` e `syncAllAcquirerItems`
- DoD: build limpo; pipeline completo pronto para uso com credenciais Stone sandbox

**Sessão 8.2 — Upload de extratos de adquirentes (fallback CSV/PDF):**
- Parser específico para relatório de liquidação Stone CSV (`/lib/parsers/acquirer-stone.ts`)
- Parser genérico para extratos Cielo/Rede em CSV
- Integração com pipeline de upload existente: novo `sourceType='acquirer'`
- DoD: upload de relatório Stone CSV → staging → revisão → transactions

**Sessão 8.3 — Cielo connector:**
- `src/lib/cielo-client.ts`: cliente REST Cielo (API Key + sandbox)
- `CieloProvider` implementado, reutiliza job `sync-acquirer-item`
- DoD: idem Stone para Cielo sandbox

**Sessão 8.4 — Reconciliação lote × vendas individuais:**
- Job `reconcile-acquirer-transactions.ts`: match entre depósito líquido Pluggy (provider='pluggy', type='bank') e vendas individuais do adquirente (mesmo dia, valor total ≈ soma das vendas − MDR)
- Score por valor líquido + data + provider metadata; threshold 0.85 auto, 0.50 revisão
- DoD: lote de R$ X da Stone no banco casado com N vendas individuais do mesmo dia

**Sessão 8.5 — UX polish + MDR:**
- Cards de conexão em `/contas/adquirentes` com: provedor logo, merchantId, última sync, volume do mês, MDR médio calculado
- Botão "Reconciliar agora" manual
- DoD: tela mostra saúde de todas as conexões de adquirentes com métricas reais

---

### FASE 9 — Agente Proativo, Fechamento Mensal e Notificações (4-6 sessões)

**Texto pro CLAUDE.md:**
> Iniciando Fase 9 — Agente Proativo. Job diário de insights + fechamento mensal narrado pelo expert (movido da Fase 5) + notificações por WhatsApp/e-mail. Sistema age sem o cliente pedir.

**Sessão 9.1 — Fechamento mensal narrado (ex-5.G)**
- Job Inngest no dia 5 de cada mês: expert gera narrativa do mês anterior em 5 seções (abertura, resultado, posição, atenções, recomendações) com dados reais do DRE + KPIs
- Tela `/relatorios/[mes]` renderiza o relatório; CTA "Compartilhar" / "Exportar"
- DoD: acionar manualmente, relatório gerado com dados reais, disponível em tela

**Sessão 9.2 — Job diário de insights**
- Analisa estado da empresa: anomalias (valor incomum vs. histórico), riscos (projeção de caixa negativo), oportunidades (caixa parado há N dias), padrões (gasto crescente 3 meses seguidos)
- Insights salvos em `agent_events`; painel de insights em `/dashboard`
- DoD: ao menos 2 tipos de insight detectados com dados reais

**Sessão 9.3 — Notificações por e-mail**
- Integração Resend ou SendGrid: insights de alta prioridade + fechamento mensal enviados por e-mail
- Preferências de notificação em `/configuracoes`
- DoD: e-mail enviado com fechamento mensal renderizado em HTML

**Sessão 9.4 — Notificações por WhatsApp (opcional)**
- Twilio API: insights críticos (caixa < X dias) enviados via WhatsApp
- DoD: mensagem recebida no WhatsApp com valor e link pra tela

---

### FASE 10 — Onboarding, billing e lançamento (4-6 sessões)

**Texto pro CLAUDE.md:**
> Iniciando Fase 10 — Onboarding self-service + Stripe + lançamento beta. Decisão final de modelo de pricing (recomendação: tier por porte da empresa com uso justo implícito). Primeiros 10-20 clientes via onboarding assistido pela Lure.

**Sessão 10.1 — Decisão de pricing + Stripe setup**
- Bater martelo no modelo (A: limites por capacidade, B: créditos por operação, C: tier por porte — recomendação atual)
- Stripe products + prices criados
- Webhooks configurados
- DoD: produtos no dashboard Stripe, webhook recebendo eventos de teste

**Sessão 10.2 — Fluxo onboarding self-service**
- 5-8 telas: cadastro → criação de org → escolha de plano (com trial 14 dias) → conexão de primeira fonte → primeiro upload → configuração do plano de contas → dashboard
- DoD: novo usuário completa o fluxo do zero sem ajuda

**Sessão 10.3 — Trial → bloqueio**
- Lógica de `subscription_status` (`trial`, `active`, `past_due`, `canceled`)
- Após 14 dias sem pagamento, modo leitura
- DoD: testar com `trial_ends_at` manipulado, ver bloqueio entrar

**Sessão 10.4 — Página /pricing pública + /landing**
- `/pricing` com tiers detalhados (em unidades de valor, nunca tokens)
- `/landing` com pitch curto + login/signup
- DoD: páginas no ar, fora da área autenticada

**Sessão 10.5 — Suporte humano embutido**
- Botão "falar com humano" em pontos estratégicos (onboarding, erros, dashboard) → e-mail pra suporte@ ou link de WhatsApp da Lure
- DoD: clicar e disparar canal

**Sessão 10.6 (folga) — Lançamento beta com 5 clientes**
- Convidar 5 primeiros clientes (PMEs da carteira da Lure)
- Onboarding assistido pessoal
- Captura de aprendizado em documento separado

---

## Parte 5 — Sinais de alerta (pare e reavalie)

- Sessão tem 2h e nada funciona → encerre, commit do que tem, retoma amanhã
- Claude Code tentando a mesma coisa duas vezes sem sucesso → reformule do zero ou consulte aqui
- Você não consegue mais explicar o que o código faz → pause, peça explicação em português, entenda antes de continuar
- Mais de 5 erros de TypeScript no console → resolva antes de continuar a feature
- Mexendo em fase anterior pra fazer a atual funcionar → fundação fraca, pare e refatore
- Custo de IA inflando → atalho com prompt caching, troca pra Haiku 4.5 em sub-tarefas, fatie chamadas

---

## Parte 6 — Checklists rápidos

### Antes de começar uma fase
- [ ] CLAUDE.md atualizado com o texto da fase (ver Parte 4)
- [ ] Seção da fase no `PLANO_DE_CONSTRUCAO.md` relida
- [ ] Subdivisão da fase na Parte 4 deste guia relida
- [ ] Conversa nova aberta com Claude Code

### Início de cada sessão
- [ ] Citei o CLAUDE.md na primeira mensagem
- [ ] Defini objetivo claro (1-2h)
- [ ] Defini critério testável de fim de sessão
- [ ] Pedi plano de ataque ANTES de implementar

### Fim de cada sessão
- [ ] Critério da sessão testado manualmente
- [ ] Commit feito com mensagem clara
- [ ] CLAUDE.md atualizado se alguma decisão mudou
- [ ] Anotei em nota separada: terminei / pendente / dúvidas

### Fim de cada fase
- [ ] Definition of Done completa da fase (no plano) testada item a item
- [ ] Commit final "Fase X completa"
- [ ] CLAUDE.md atualizado com texto da próxima fase
- [ ] Conversa nova pronta pra abrir na próxima sessão

---

## Parte 7 — Quando algo der errado

### Bug em produção (algo quebrou no Vercel)
1. Reproduza local primeiro
2. Abra sessão nova: "Lendo CLAUDE.md. Tenho um bug em produção: [descreve sintoma, não causa]. O que pode ser?"
3. Peça inspeção antes de consertar
4. Conserte localmente, teste, commite, deploy

### Travou em decisão estratégica
- Não decida sozinho dentro da sessão de código
- Encerre, abra conversa comigo (Claude no chat normal), traga o trade-off
- Volte pro Claude Code com decisão fechada

### Ficou caro demais (custo de IA)
- Audite `agent_events.cost_usd` por tipo
- Procure operações sem prompt caching ativo
- Troque Sonnet por Haiku em sub-tarefas onde dá
- Se chat ficou caro, audite system prompt — provavelmente está enviando coisa demais

### Schema precisa mudar
- Decisões de schema NÃO são localizadas, propagam pra todo o produto
- Saia do Claude Code, vá pro chat normal comigo
- Discuta a mudança proposta antes de aplicar
- Atualize `SCHEMA_INICIAL.md` ANTES de gerar migration

---

## Histórico de versões

- **v1.0** (16/05/2026) — Documento criado. Subdivisão das 8 fases do MVP em 43-65 sessões concretas, com ritual de início/fim, template de sessão, checklists e procedimento pra erros.
- **v1.1** (19/05/2026) — Fase 5 reescrita para refletir execução real: analytics financeiro (Dashboard, DRE, Indicadores, Fluxo de Caixa) + expert drawer com Sonnet. Sessões 5.0 a 5.F marcadas ✅. Chat agentivo com tool use diferido para fase futura. Próxima sessão: 5.G (relatório fechamento mensal).
