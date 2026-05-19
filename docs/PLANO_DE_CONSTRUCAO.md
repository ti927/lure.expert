# Plano de Construção: SaaS Financeiro AI Native
**Documento mestre do projeto. Leia antes de iniciar qualquer sessão com Claude Code.**

---

## Como usar este documento

Este é o seu **mapa**. Antes de qualquer sessão de desenvolvimento, abra este arquivo. Ele responde:

1. *O que estamos construindo agora?* → Parte 3 (Fases)
2. *Como dizer pra IA o que fazer?* → Parte 4 (Operando com Claude Code)
3. *Por que escolhemos X em vez de Y?* → Parte 2 (Stack Técnico)
4. *O que esse termo significa?* → Parte 6 (Glossário)
5. *Como dar contexto persistente pra IA?* → Parte 5 (Template CLAUDE.md)

À medida que evoluir, atualize a seção "Status atual" no início de cada fase. Esse é o documento vivo do projeto.

---

## Parte 1 — O Produto em Uma Página

**Nome do produto:** **Lure** — domínio: **lure.expert**

**Pitch de 30 segundos:** Um time financeiro virtual pra PME brasileira. O dono conecta o banco via Open Finance, sobe os relatórios do ERP, e o sistema entrega: categorização automática de tudo, fluxo de caixa projetado, indicadores de balanço em tempo real, fechamento mensal narrado em prosa, e responde qualquer pergunta financeira em linguagem natural. Substitui as planilhas e o controller manual de hoje.

**Cliente alvo (ICP):**
- PME brasileira formalizada
- Faturamento entre R$ 2M e R$ 50M/ano
- Serviços B2B, distribuição, e-commerce formal, clínicas, escolas, indústrias pequenas
- Emite NF, usa banco PJ, separa pessoal de empresa
- Dono ou diretor financeiro frustrado com Excel e relatórios atrasados

**Não-cliente (não tente vender pra esses):**
- Comércio de balcão informal, MEI puro
- Empresas com 40%+ de receita não-rastreada

**Preço alvo:** R$ 300 a R$ 700/mês por empresa, conforme porte e módulos

**Promessa central:** *"Você vai saber, todo dia, exatamente como sua empresa está — sem precisar pedir nada pro contador."*

---

## Parte 2 — Stack Técnico (com razões para cada escolha)

> **Por que justificar tudo?** Porque você vai ser tentado, em algum momento, a "trocar X por Y porque vi um vídeo no YouTube". Antes de trocar, leia o "por que" daqui. Geralmente a escolha resiste.

### Decisões fundamentais

**Frontend e Backend: Next.js 14+ com App Router**
- Por quê: framework dominante, Claude Code conhece profundamente, full-stack (você não gerencia backend separado)
- Linguagem: TypeScript (detecta erros antes de você rodar; Claude Code prefere)

**Banco de dados: PostgreSQL via Supabase**
- Por quê: relacional clássico + pgvector embutido + auth + storage + realtime, tudo numa única plataforma
- Free tier robusto, escala muito antes de você precisar trocar
- Multi-tenancy via Row Level Security (RLS): cada cliente só vê seus dados, garantido no nível do banco

**Autenticação: Supabase Auth**
- Já vem com Supabase. Suporta e-mail+senha, magic link, OAuth (Google, etc.)

**Storage de arquivos: Supabase Storage**
- Integrado. Guarda PDFs, Excels, fotos no mesmo ecossistema.

**Jobs em background: Inngest**
- Feito pra workflows com IA. Lida com retry, scheduling, observabilidade
- Você não vai querer gerenciar fila de mensagens (RabbitMQ/SQS) à mão

**LLM: Claude (Anthropic) como padrão**
- Modelos: Haiku 4.5 pra operações em volume, Sonnet 4.6 pro miolo (chat, narrativa, raciocínio)
- Opus 4.7 só em casos especiais (raro)
- Tem fallback pro GPT-4o-mini ou Gemini Flash se quiser economizar em extração em massa

**Deploy: Vercel**
- Zero-config pra Next.js, deploy a cada push no GitHub, preview deployments
- Free tier dá pra começar

**Monitoramento: Sentry (erros) + PostHog (comportamento)**

**Pagamento: Stripe** — padrão de mercado

### Custos mensais estimados (primeiros 12 meses)

| Serviço | Mês 1 | Mês 12 com 100 clientes |
|---|---|---|
| Supabase | $0 (free) | $25 (Pro) |
| Vercel | $0 (free) | $20 (Pro) |
| Inngest | $0 (free) | $20 |
| Anthropic API | $5 | $300 |
| Stripe | taxa por transação | taxa por transação |
| Sentry / PostHog | $0 (free) | $0 (free) |
| Domínio + Google Workspace | $20 | $20 |
| **Total** | **~$25** | **~$385** |

Em real: R$ 125/mês no início, R$ 1.900/mês com 100 clientes ativos. Margem bruta acima de 95%.

---

## Parte 3 — Antes de Escrever Uma Linha de Código

### Contas a criar (1 dia inteiro, faça nessa ordem)

1. **Cursor** (cursor.com) ou **VS Code com extensão Claude Code** — seu editor
2. **GitHub** — onde mora o código (repositório privado)
3. **Supabase** — crie projeto chamado `lure-dev`
4. **Vercel** — conecte ao GitHub
5. **Anthropic Console** (console.anthropic.com) — gere API key, ative billing com limite mensal de US$ 50 pra começar
6. **Inngest** — crie conta
7. **Stripe** — em modo teste por enquanto
8. **Domínio** — Registro.br ou Cloudflare
9. **Google Workspace** — pra e-mails do produto (suporte@, oi@)

### Verificação antes de começar

Antes de pedir qualquer coisa pro Claude Code, você precisa ter respondido pra você mesmo:

- [ ] Tenho conta nos serviços acima
- [ ] Estou disposto a manter sessões focadas (1-2h, um tema só)
- [ ] Vou usar o arquivo CLAUDE.md como contexto persistente
- [ ] Vou seguir as fases na ordem — sem pular pra "a parte legal"

---

## Parte 4 — As 10 Fases do Projeto

> **Como ler cada fase:** cada uma tem **objetivo** (o que vai ficar pronto), **deliverables** (peças concretas), **prompt template** (como pedir ao Claude Code), **definition of done** (como saber que terminou), e **tempo estimado** (assumindo ~10h/semana de trabalho dedicado).

> **Princípio inviolável:** **NÃO PULE FASE**. Mesmo que pareça "essa parte não é importante". As fases iniciais constroem as fundações que as últimas dependem. Fundação ruim = retrabalho dolorido depois.

---

### FASE 0 — Scaffolding (Semana 1)

**Objetivo:** projeto rodando localmente e em produção, login funcionando.

**Deliverables:**
- Projeto Next.js inicializado com TypeScript, Tailwind, shadcn/ui
- Conexão com Supabase configurada
- Página `/login` com e-mail + senha
- Página `/dashboard` protegida que mostra "Olá, [seu e-mail]"
- Deploy no Vercel funcionando (URL pública acessível)
- README.md explicando como rodar localmente

**Prompt template para Claude Code:**
> *"Inicialize um projeto Next.js 14 com App Router, TypeScript, Tailwind CSS e shadcn/ui. Configure Supabase como provedor de autenticação e banco de dados — vou colar minhas credenciais. Crie uma página /login simples (e-mail + senha) usando shadcn/ui components, e uma página /dashboard protegida que redireciona pra /login se não autenticado e mostra o e-mail do usuário logado. Configure variáveis de ambiente em .env.local. Adicione README.md com instruções claras de setup. Não adicione nenhuma outra feature além disso — quero a base mínima funcionando."*

**Definition of Done:**
- Você acessa `https://lure-dev.vercel.app/login`, cria conta, faz login, vê seu e-mail no dashboard
- O código está no GitHub
- O README explica como você (ou outra pessoa) rodaria o projeto do zero

**Tempo:** 3-5 dias, sessões de 1-2h

---

### FASE 0.5 — Fundações de Design e Voz da IA (Semana 2)

**Por que essa fase existe:** sem definir antes os "padrões fundacionais" — cores, tipografia, componentes-base, voz da IA, padrões de estado, navegação — cada fase seguinte vai gerar variações ligeiramente diferentes. Aos 3 meses, o produto parece feito por 5 times sem conversar. Essa fase trava as decisões que propagam, em 3-5 dias.

**Objetivo:** estabelecer os "tokens" visuais, a biblioteca de componentes reutilizáveis, o tom de comunicação da IA, os padrões de estados (loading, vazio, erro), e o mapa de navegação geral. Cada fase futura referencia o que foi travado aqui em vez de reinventar.

**Deliverables organizados em 5 sub-entregas:**

---

#### 0.5.1 — Design Tokens (1 dia)

**O que travar:**
- **Paleta de cores:** uma cor primária (recomendo um azul-petróleo ou verde-floresta — algo sério, financeiro), escala neutra completa (slate ou zinc do Tailwind), e cores semânticas (verde para positivo, vermelho para negativo, âmbar para alerta, azul para info).
- **Tipografia:** uma família única (Inter é a escolha mais segura para produto financeiro; Geist é uma alternativa moderna). Escala de tamanhos do `xs` ao `4xl`. Pesos: 400 (regular), 500 (médio), 600 (semibold). **Ative o feature `tabular-nums`** para que números em tabelas alinhem certo nas colunas — crítico em produto financeiro.
- **Espaçamento:** escala de 4px (0, 1, 2, 3, 4, 6, 8, 12, 16, 24).
- **Bordas:** três raios — pequeno (4px) para botões/inputs, médio (8px) para cards, grande (12-16px) para modais.
- **Sombras:** três níveis — `sm` (cards), `md` (popovers), `lg` (modais).

**Onde mora:** tudo configurado no `tailwind.config.ts` como CSS variables. Tema escuro pode ser preparado mas não precisa funcionar agora — deixa estrutura pronta.

**Como pedir ao Claude Code:**
> *"Configure os design tokens do projeto no tailwind.config.ts. Use paleta neutra slate como base. Cor primária: emerald-700 (verde-floresta). Cores semânticas: emerald-600 (positivo), rose-600 (negativo), amber-500 (alerta), sky-600 (info). Tipografia Inter (importar via next/font/google). Configure feature tabular-nums para números. Escala de espaçamento padrão Tailwind. Três níveis de border-radius e box-shadow. Documente as escolhas em docs/DESIGN_TOKENS.md em português. Crie uma página interna /style-guide que renderiza todos esses tokens visualmente pra eu conferir."*

> **Nota sobre a escolha da cor primária:** emerald-700 (verde-floresta) carrega associação direta com dinheiro/crescimento sem ser cliché (não é o "verde dólar"), tem boa legibilidade em fundo branco e contraste com vermelho semântico de queda. Combina com identidade já existente da consultoria Lure.

**Definition of Done:** existe uma página `/style-guide` no projeto que mostra todas as cores, tamanhos de fonte, espaçamentos, raios e sombras renderizados visualmente. Você olha e fala "ok, essa é a cara do produto".

---

#### 0.5.2 — Biblioteca de Componentes Base (1-2 dias)

**O que travar:** uma lista fixa de componentes que vão aparecer em todo lugar. Cada um é construído UMA vez, virou padrão, ninguém recria.

**Componentes padrão (use shadcn/ui como base, ajuste pros seus tokens):**
1. `Button` (variantes: primary, secondary, ghost, destructive; tamanhos: sm, md, lg)
2. `Input` (texto, número)
3. `Select` / `Combobox`
4. `Card` (o container padrão)
5. `Modal` / `Dialog`
6. `Toast` (notificações temporárias — Sonner é a melhor lib)
7. `Tabs`
8. `Tooltip`
9. `Avatar`
10. `Badge` / `Pill`
11. `DateRangePicker` (essencial — produto é todo baseado em períodos)

**Componentes financeiros específicos (construir do zero):**
12. `CurrencyDisplay` — formata número como R$ X.XXX,XX, com sinal opcional, cor opcional pra valores negativos
13. `PercentageDelta` — mostra "+4,2%" ou "-1,8%" com cor verde/vermelho e seta
14. `KPICard` — número grande + label + comparativo opcional (ex: vs. mês anterior)
15. `DataTable` — tabela com sort, filter, paginação. Será usada em transações, AR, AP, plano de contas, etc.

**Componentes de estado:**
16. `EmptyState` — ilustração leve + título + texto + CTA
17. `LoadingState` — variantes: skeleton (pra conteúdo estruturado), spinner (pra ação curta), "thinking" (pra resposta de IA)
18. `ErrorState` — mensagem clara + ação de recuperação

**Como pedir ao Claude Code:**
> *"Vamos construir nossa biblioteca de componentes em /components/ui. Use shadcn/ui como base para os componentes padrão (Button, Input, Select, Card, Modal, Toast com sonner, Tabs, Tooltip, Avatar, Badge, DateRangePicker). Aplique os design tokens já configurados. Depois construa do zero estes componentes específicos financeiros em /components/financial: CurrencyDisplay (recebe number, formata R$ em pt-BR, prop optional 'colorize' que aplica verde/vermelho com base no sinal), PercentageDelta (recebe number, mostra com sinal e cor, sufixo customizável %/pp/x), KPICard (label, value, optional comparison value+label, optional trend direction), DataTable (genérica com sort/filter/pagination, integra com TanStack Table). E os componentes de estado em /components/states: EmptyState (illustration prop, title, description, optional cta), LoadingState (variant: 'skeleton' | 'spinner' | 'thinking'), ErrorState (title, description, retry action). Crie uma página /style-guide/components que renderiza todos esses componentes em todas as variantes pra eu validar visualmente."*

**Definition of Done:** a página `/style-guide/components` mostra todos os 18 componentes em todas as variantes. Quando você for construir a Fase 6 (dashboards) ou Fase 5 (chat), eles já existem e você não pede pro Claude Code "fazer um KPICard" — você pede "use o KPICard pra mostrar X".

---

#### 0.5.3 — Voz e Tom da IA (meio dia)

**O que travar:** um documento curto que define como a IA escreve. Vai pro CLAUDE.md como referência permanente, é citado em todos os prompts que envolvem geração de texto pela IA (chat, narrativa de fechamento, alertas, explicações de drill-down).

**Conteúdo do documento (`docs/AI_VOICE.md`):**

**Princípios:**
- **Pessoa:** segunda pessoa singular ("você"). Evita "o senhor"/"a senhora" (formal demais), evita "a gente" (informal demais).
- **Formalidade:** profissional mas não engessada. Entre o tom do LinkedIn e o tom de um WhatsApp de trabalho com um colega.
- **Estrutura:** **número primeiro, contexto depois**. Cliente quer saber "o quê" antes de "porquê".
- **Concisão:** prefere duas frases curtas a uma longa. Limite mental: nenhuma resposta passa de 4 frases sem ter uma quebra estrutural (lista, números, parágrafo).
- **Atribuição:** sempre que cita um número, indica de onde veio ("considerando suas últimas 12 semanas", "baseado nas transações categorizadas").

**Proibições:**
- Sem emojis
- Sem gírias
- Sem hedge gratuito ("talvez", "possivelmente", "acho que") — se a IA não tem certeza, ela explicita ("com 87% de confiança baseado em X")
- Sem exclamações exageradas
- Sem auto-referências ("eu sou uma IA", "deixa eu te explicar")

**Inclui sempre que relevante:**
- Sugestão de ação concreta
- Link/atalho pra a tela que aprofunda
- Comparativo histórico ("é o maior valor dos últimos 6 meses")

**Pares de exemplo (bom × ruim) — coloque 6-10 no doc:**

❌ *"Ei! Dei uma olhada e parece que sua margem caiu um pouquinho esse mês 😬"*
✅ *"Sua margem operacional caiu 4 pontos em maio, de 22% para 18%. O principal driver foi o aumento de CMV (+7%). Quer ver os fornecedores que mais variaram?"*

❌ *"Hmm, talvez você queira verificar o fluxo de caixa, está meio apertado..."*
✅ *"Seu caixa fica negativo em 38 dias mantendo o ritmo atual de saídas. Três contas a pagar acima de R$ 50k vencem na próxima quinzena."*

❌ *"Olha, eu acho que essa transação é despesa administrativa, mas não tenho 100% de certeza..."*
✅ *"Categorizei como Despesa Administrativa com 78% de confiança (fornecedor recorrente, padrão de valor). Confirma ou ajusta?"*

**Como pedir ao Claude Code:**
> *"Crie o documento docs/AI_VOICE.md com [colar conteúdo acima estruturado]. Esse documento será referenciado em todos os system prompts que envolvem geração de texto pela IA. Adicione referência a ele no CLAUDE.md na seção 'Princípios não-negociáveis'."*

**Definition of Done:** o arquivo existe, está no git, é referenciado no CLAUDE.md, e qualquer prompt futuro que envolva chat ou narrativa instrui Claude Code a ler `docs/AI_VOICE.md` antes de gerar o system prompt.

---

#### 0.5.4 — Padrões de Estado (meio dia)

**O que travar:** como o produto se comporta em situações que não são "tudo deu certo". Em produto AI native isso é MUITO frequente: dados sincronizando, IA pensando, conexão perdida, dados parciais.

**Os cinco estados canônicos:**

**Loading:**
- `skeleton` — pra carregar conteúdo estruturado (tabela, card de KPI, lista). Mostra a "casca" do componente em cinza pulsante. Nunca mostra spinner em cima de conteúdo que terá estrutura definida.
- `spinner` — pra ações curtas (botão "Salvar", aguardando 1-3s)
- `thinking` — específico pra resposta de IA. Mostra "Lure está analisando..." (ou nome do agente específico em uso) com indicador animado. Usa streaming sempre que possível — texto aparecendo conforme a IA gera.

**Empty (sem dados ainda):**
- Sempre ilustração suave + título curto + explicação de 1 frase + CTA primário
- Exemplo: ícone de banco + "Nenhuma conta conectada" + "Conecte seu banco pra começar a ver suas movimentações automaticamente" + botão "Conectar Banco"

**Error:**
- Mensagem em português claro do **sintoma**, não da causa técnica
- Ação de recuperação visível
- "Detalhes técnicos" colapsado por padrão (importante: o cliente leigo não quer ver stack trace, mas o suporte sim quando ele copia o erro)
- Exemplo: "Não conseguimos atualizar o saldo do Itaú agora" + botão "Tentar de novo" + "▸ Detalhes técnicos"

**Partial data (dados desatualizados ou incompletos):**
- Banner ou badge explícito mostrando quando foi a última atualização e o que está em sincronia
- Exemplo: "Dados sincronizados até hoje 14h32. Banco do Brasil está com atualização pendente."
- **Nunca esconder essa info** — controller experiente fica nervoso quando "não sabe se o número está fresco"

**Success:**
- Toast discreto, posição inferior, desaparece em 3-4s
- Não bloqueia ação seguinte
- Reservado pra ações com feedback útil (não usar pra "deu certo carregar a página")

**Como pedir ao Claude Code:**
> *"Crie docs/STATE_PATTERNS.md documentando os 5 estados canônicos do produto (loading, empty, error, partial, success) com regras de uso e exemplos. Implemente os componentes `LoadingState`, `EmptyState`, `ErrorState`, `PartialDataBanner` em /components/states cobrindo todas as variantes. Adicione esses padrões ao CLAUDE.md na seção 'Convenções de código' como regra: 'toda página/componente que carrega dado precisa lidar explicitamente com os 5 estados — nunca mostrar tela em branco enquanto carrega'."*

**Definition of Done:** documento existe, componentes existem na biblioteca, regra está no CLAUDE.md. A partir daqui, em qualquer fase, quando Claude Code construir uma tela que carrega dados, ele DEVE implementar os 5 estados, não só o happy path.

---

#### 0.5.5 — Arquitetura de Informação (meio dia)

**O que travar:** o esqueleto de navegação do produto. Quais são as áreas de primeiro nível, onde fica o quê, como o chat se integra. Isso afeta TODA tela construída daqui em diante.

**Estrutura recomendada (sidebar esquerda fixa em desktop, drawer em mobile):**

```
Lure (logo)

── Início                  [dashboard com KPIs principais]
── Operação
   ├── Transações          [a tabela mestra]
   ├── Contas a Receber
   └── Contas a Pagar
── Análises
   ├── DRE
   ├── Balanço
   ├── Fluxo de Caixa
   └── Indicadores
── Relatórios              [fechamentos mensais, exportáveis]
── Conexões                [bancos, ERPs, adquirentes]
── Configurações           [plano de contas, usuários, billing]

[Chat: ícone flutuante no canto inferior direito,
 expande pra painel lateral sobreposto, persiste contexto]
```

**Decisões importantes a tomar agora (e travar):**

- **Sidebar fixa vs colapsável?** Recomendo colapsável, com estado salvo (usuário escolhe e fica).
- **Chat persistente lateral OU flutuante?** Recomendo **flutuante** (ícone canto inferior direito, expande pra drawer lateral à direita). Por quê: sidebar lateral persistente compete com conteúdo em telas menores; flutuante é "convidado, não residente".
- **Seletor de empresa (multi-tenant) onde?** No topo da sidebar, acima de "Início". Cliente que tem múltiplas empresas troca por ali.
- **Avatar/conta do usuário?** No rodapé da sidebar com menu dropdown (perfil, billing, sair).
- **Breadcrumbs?** Não usar — manter navegação plana, página tem título grande no topo.

**Como pedir ao Claude Code:**
> *"Crie a estrutura de layout principal em /app/(authenticated)/layout.tsx com sidebar à esquerda, área de conteúdo central, e o componente flutuante de chat no canto inferior direito. Sidebar tem: seletor de organização no topo, lista de navegação principal (Início, Operação > Transações/AR/AP, Análises > DRE/Balanço/Fluxo/Indicadores, Relatórios, Conexões, Configurações), e dropdown de usuário no rodapé. Sidebar é colapsável com estado persistido em localStorage. Em mobile (< 768px) vira drawer aberto por hamburger. Chat flutuante: ícone fixo bottom-right, ao clicar expande drawer lateral direito que cobre 480px de largura no desktop, full-width no mobile. Por enquanto as páginas das rotas podem ser placeholders ('Em construção'), só queremos a estrutura de navegação funcionando."*

**Definition of Done:** você consegue navegar entre todas as áreas pela sidebar, o chat flutuante abre e fecha (mesmo sem funcionalidade ainda), o seletor de empresa troca entre empresas, mobile funciona em drawer.

---

#### Resumo da Fase 0.5

| Sub-entrega | Tempo | Entregável principal |
|---|---|---|
| 0.5.1 Design Tokens | 1 dia | tailwind.config + página /style-guide |
| 0.5.2 Componentes Base | 1-2 dias | 18 componentes + /style-guide/components |
| 0.5.3 Voz da IA | 0.5 dia | docs/AI_VOICE.md + referência no CLAUDE.md |
| 0.5.4 Padrões de Estado | 0.5 dia | docs/STATE_PATTERNS.md + componentes de estado |
| 0.5.5 Arquitetura de Informação | 0.5 dia | Layout principal + navegação + chat flutuante |

**Tempo total da fase:** 3-5 dias

**Por que essa fase paga o investimento:** cada fase futura economiza horas porque os "blocos de Lego" já existem. Quando você for construir a Fase 6 (dashboards), você não pede "faz um card com a margem do mês" — você pede "monta o dashboard usando KPICard, DataTable e PercentageDelta com os padrões já estabelecidos". Claude Code não vai inventar, vai compor. Resultado: consistência visual, velocidade maior, retrabalho menor.

> **Regra que vai pro CLAUDE.md:** *"Antes de criar qualquer componente novo, verifique se já existe em /components/ui, /components/financial ou /components/states. Antes de gerar texto pela IA, leia docs/AI_VOICE.md. Antes de criar uma página que carrega dado, planeje os 5 estados (loading/empty/error/partial/success)."*

---

### FASE 1 — Schema de Dados e Multi-tenancy (Semanas 2-3)

**Objetivo:** estrutura de dados central do produto, com isolamento por empresa.

**Deliverables:**
- 11 tabelas centrais no Supabase, conforme **especificação detalhada em `docs/SCHEMA_INICIAL.md`**
- Row Level Security (RLS) configurado em todas as tabelas com `organization_id`
- Migrations versionadas em `/db/migrations/`
- Telas administrativas: criar empresa, convidar usuário, alternar entre empresas
- Plano de contas brasileiro padrão criado automaticamente em toda nova organização (seed)

**⚠️ IMPORTANTE — fonte da verdade do schema:**

O schema NÃO está descrito em detalhe neste plano principal. Está num documento separado: **`docs/SCHEMA_INICIAL.md`** (ou na pasta do projeto antes do Claude Code começar a construir).

Esse documento especifica, pra cada uma das 11 tabelas:
- Todas as colunas, tipos e constraints
- Índices recomendados
- Políticas RLS em SQL
- Justificativa das decisões de design
- Convenções (nomenclatura, valores monetários, soft delete, etc.)

**Antes de pedir pro Claude Code construir essa fase, garanta que ele leu o SCHEMA_INICIAL.md.**

**Tabelas a criar (lista resumida — detalhes no SCHEMA_INICIAL.md):**

| # | Tabela | Função |
|---|---|---|
| 1 | `organizations` | A empresa do cliente |
| 2 | `memberships` | Junção users ↔ organizations com papéis |
| 3 | `data_sources` | Fontes conectadas (bancos, ERPs, adquirentes) |
| 4 | `contacts` | Fornecedores, clientes, funcionários |
| 5 | `categories` | Plano de contas hierárquico |
| 6 | `transactions` | A tabela mais importante — movimentos financeiros |
| 7 | `documents` | PDFs, Excels, NFs (referências ao Storage) |
| 8 | `templates` | Parsers aprendidos pra relatórios |
| 9 | `conversations` | Conversas com a IA |
| 10 | `messages` | Mensagens dentro de uma conversa |
| 11 | `agent_events` | Log auditável das ações da IA (incluindo custo) |

**Prompt template:**
> *"Vamos construir a Fase 1 do projeto Lure. Primeiro, leia integralmente o arquivo `docs/SCHEMA_INICIAL.md` — ele é a fonte da verdade pro schema do banco. Em seguida: (1) Ative as extensões Postgres necessárias (pgcrypto, vector, pg_trgm) no Supabase. (2) Crie as 11 tabelas EXATAMENTE conforme especificado: nomes, colunas, tipos, constraints, índices. Use Drizzle ORM como camada tipada. Gere migrations versionadas em /db/migrations/. (3) Configure RLS em todas as tabelas com organization_id seguindo o padrão documentado. (4) Crie um seed que popula um plano de contas brasileiro padrão (~50 categorias DRE básicas: Receita Bruta, Deduções, CMV, Despesas Administrativas, Despesas Comerciais, etc.) sempre que uma nova organization é criada. (5) Construa as telas admin em /admin/organizations: criar empresa, convidar usuário, trocar entre empresas. (6) Documente decisões de implementação que SAÍRAM do SCHEMA_INICIAL.md (se houver) em docs/SCHEMA_DECISIONS.md. NÃO desvie do schema sem me consultar. Se houver dúvida ou conflito, pare e pergunte."*

**Definition of Done:**
- As 11 tabelas existem no Supabase exatamente como especificado
- Você consegue criar duas empresas diferentes e dados de uma não vazam pra outra (teste essa segurança manualmente)
- Convidar usuário por e-mail cria membership pendente
- Plano de contas padrão aparece automaticamente em nova empresa
- Migrations estão versionadas em arquivos numerados
- `docs/SCHEMA_INICIAL.md` continua sendo a fonte da verdade — qualquer mudança vai pra lá primeiro

**Tempo:** 1-2 semanas

> **Por que tanto cuidado aqui?** Multi-tenancy errada é a falha de segurança mais comum em SaaS. Cliente A vendo dados do cliente B é fim de negócio. **Faça testes manuais de isolamento:** crie duas orgs com usuários diferentes, insira dados em uma, faça login na outra e confirme que você não vê nada. Repita o teste em cada tabela.

---

### FASE 2 — Pipeline de Ingestão de Arquivos (Semanas 4-6)

**Objetivo:** cliente sobe relatório (qualquer formato), sistema extrai e estrutura.

**Deliverables:**
- ✅ Tela de upload de arquivo (drag-and-drop)
- ✅ Pipeline assíncrono (com Inngest): arquivo → storage → parsing → tabela transactions
- ✅ Suporte a Excel/CSV/TXT via LLM (Claude Haiku — mesmo padrão do PDF) — parser determinístico descartado
- ✅ Suporte a PDF via LLM (extrai estrutura) — **Sessão 2.5** _(com ressalva — ver abaixo)_
- ~~Sistema de "templates": quando o mesmo formato aparece de novo, reusa parser sem chamar LLM~~ — **substituído pela abordagem LLM-first**
- ✅ Tela de "revisão" das linhas extraídas antes de gravar — **com edição em lote**
- ✅ Histórico de uploads por organização
- ✅ Remoção de uploads com confirmação e limpeza de Storage + staging em cascade

**Decisões tomadas na implementação:**

**Parser Excel/CSV/TXT (LLM-first):**
- Biblioteca SheetJS (`xlsx`) usada APENAS para ler binários `.xls/.xlsx` → converte para texto via `sheet_to_csv()`
- CSV/TXT lidos diretamente como UTF-8
- Texto enviado ao Claude Haiku que extrai transações e retorna JSON (mesmo padrão do PDF)
- Direção: `credit_card` usa `DEFAULT_OUTFLOW_SOURCES` (null → outflow), mesmo comportamento do PDF
- Sistema de templates (fingerprint + columnMap) descartado — LLM lida com qualquer formato sem template

**Tela de revisão `/upload/[id]/review`:**
- Carrega todas as linhas do staging de uma vez (client-side pagination, 50/página)
- Polling a cada 3s enquanto `extractionStatus !== 'completed'`
- **Edição individual:** inline por campo (data input, number input, text input); direção via badge clicável
- **Edição em lote via checkbox:**
  - Selecionar por página
  - Aprovar / rejeitar / **inverter direção** dos selecionados
- "Confirmar e importar": aprova pendentes → insere `approved` em `transactions`
  - Upsert de `data_source` (provider=`upload`) por org+sourceType antes do INSERT
  - Insere em lotes de 100; retorna `{ inserted, skipped, total }`
- `/upload` lista 10 uploads recentes com status, contagem e link direto para revisão
- **Integridade pós-importação (Opção A — read-only lock):** após importação, todos os controles
  de edição são ocultados. Banner emerald exibe contagem importada + link para `/transacoes`.
  Reedição de linhas já importadas é vedada na UI; ajustes são feitos em `/transacoes`.

**Definition of Done:**
- ✅ Sobe um Excel/CSV/TXT e aparece como linhas pra revisão (parser LLM)
- ✅ Consegue inverter a direção em lote e aprovar tudo de uma vez
- ✅ Linhas aprovadas constam na tabela `transactions`
- ✅ Erros mostram mensagem amigável
- ✅ Após importação, tela bloqueia edição (read-only lock) com banner e link para `/transacoes`
- ✅ Sobe um PDF de extrato bancário e ele também aparece (Sessão 2.5)
- ✅ Uploads podem ser deletados com confirmação (remove Storage + staging + anula FK em transactions)
- ✅ Parser LLM lida com qualquer formato BR: CSV sem cabeçalho, XLS com metadata, cabeçalho com BOM, datas abreviadas, câmbio inline

**Tempo:** 2-3 semanas. **Essa fase é a coluna vertebral do produto.** Investe tempo.

---

#### Sessão 2.5 — Parser PDF via LLM ✅ CONCLUÍDA

**O que foi implementado:**
- `src/lib/anthropic.ts` — singleton do cliente Anthropic
- `src/lib/parsers/pdf.ts` — parser PDF com duas funções:
  - `checkPasswordProtection()` — usa `pdf-parse` APENAS para detectar senha (texto extraído descartado —
    fontes customizadas de bancos brasileiros corrompem o conteúdo, ex: `$` → `5` no Itaú)
  - `extractViaDocument()` — envia PDF como `DocumentBlockParam` (base64) ao Claude Haiku,
    que renderiza com motor próprio sem problemas de codificação de fonte
- `processDocument` atualizado: step `parse-pdf-llm` com try/catch (falha → `extractionStatus: 'failed'`)
- `next.config.mjs`: `experimental.serverComponentsExternalPackages: ['pdf-parse']`
- Tela de revisão: polling timeout 2min, exibe erro de extração, totalizador Entradas/Saídas/Líquido
- Correção `FORCE_OUTFLOW`: `credit_card` respeita `inflow` do LLM (estornos com valor negativo)

**Ressalva conhecida:** PDFs com colunas multi-moeda (ex: fatura Itaú com câmbio internacional)
extraem alguns valores com imprecisão (campo cotação interfere no campo valor na resposta do LLM).
Não bloqueador — usuário pode corrigir manualmente na tela de revisão.

---

#### ✅ Sessão 2.6 — Sistema de templates *(depois substituído pela migração LLM)*

**O que foi implementado:**
- `computeFingerprint(headers)` — SHA-256 dos nomes de coluna normalizados (primeiros 16 hex)
- `getFileFingerprint(buffer)` — leitura leve só dos headers para fingerprint sem parsear o arquivo todo
- `parseExcelOrCsv(buffer, knownColumnMap?)` — aceita mapeamento conhecido, retorna `{ fingerprint, usedTemplate }`
- `processDocument` step `parse-excel-csv`: lookup de template → apply `columnMap` ou detecta e salva novo
- `extractionMethod` gravado como `'template'` ou `'column_detection'`

**Definition of Done:** ✅ mesmo CSV enviado duas vezes → segunda execução retorna `usedTemplate: true`

**⚠️ Obsoleto:** todo o sistema de templates foi descartado na migração LLM (Sessão 3/parser). O `excel-csv.ts`
foi reescrito e `process-document.ts` simplificado — a tabela `templates` existe mas não é mais alimentada.
O parser atual envia o conteúdo diretamente ao Claude Haiku, sem fingerprint, sem template, sem heurística.

---

### FASE 3 — Dimensões Analíticas + Categorização com IA (Semanas 7-9)

**Objetivo:** cada transação ingerida é classificada em 4 dimensões analíticas (categoria financeira, centro de custo, unidade de negócio, entidade jurídica), com motor de categorização automática em 4 camadas.

**Por que 4 dimensões?** Toda empresa classifica lançamentos por mais de um critério simultaneamente. A categoria financeira (plano de contas) responde "o que foi gasto". O centro de custo responde "quem gastou". A unidade de negócio responde "qual área do negócio gerou o gasto". A entidade jurídica responde "qual CNPJ do grupo". Juntas, habilitam DRE multidimensional na Fase 6.

**Decisões de design:**
- Uma classificação por dimensão por lançamento — sem rateio (ex: 60%/40% entre centros). Feature futura.
- Entidades jurídicas (matrizes/filiais) são tratadas como centro de custo adicional — sem hierarquia, sem impacto no isolamento entre orgs.
- Todas as dimensões sempre visíveis na UI — campos aparecem vazios até o cliente configurar.
- Motor de IA sugere todas as 4 dimensões com confidence score por dimensão.
- Classificação pós-import é o caso de uso principal — dimensões atribuídas em `/transacoes`. DRE multidimensional vem na Fase 6.

**Deliverables por sessão:**

**✅ Sessão 3.0 — Schema (concluída):**
- 3 novas tabelas: `cost_centers`, `business_units`, `legal_entities` (estrutura flat) com RLS por `organization_id`
- `ALTER TABLE transactions`: `cost_center_id`, `business_unit_id`, `legal_entity_id` (FK nullable, `ON DELETE SET NULL`)
- `ALTER TABLE categorization_rules`: mesmos 3 FKs + `target_category_id` tornou-se nullable
- Drizzle schema: `db/schema/cost-centers.ts`, `business-units.ts`, `legal-entities.ts`
- Migration: `db/migrations/rls/0008_dimensions.sql` (aplicada no Supabase)

**✅ Sessão 3A — Gestão de categorias e dimensões (concluída):**
- `/configuracoes/categorias` — árvore hierárquica por tipo (revenue/cost/expense/...), inline rename, create dialog com tipo + código + pai opcional, archive/reactivate, delete com verificação de filhos e de transações vinculadas
- `/configuracoes/centros-de-custo`, `/configuracoes/unidades-de-negocio`, `/configuracoes/entidades-juridicas` — CRUD flat via `DimensionManager` reutilizável; entidades jurídicas incluem campo CNPJ
- `/configuracoes` atualizado com cards de navegação para as 4 seções analíticas
- `src/server/dimensions.ts` — 15 server actions (get/create/update/toggleActive/delete/linkedCount × 3)
- `src/server/categories.ts` — getCategoriesWithTxCount, create, update, toggleActive, delete
- `src/components/settings/dimension-manager.tsx` e `category-manager.tsx`
- **Pendente para sessões futuras:** CSV import de categorias, templates pré-definidos

**✅ Sessão 3B — Motor de categorização com IA (concluída):**
- Job Inngest `categorize-transaction` em 4 camadas (`src/lib/categorizer.ts` + `src/jobs/categorize-transaction.ts`)
  1. Regra explícita (`categorization_rules`, `op: contains`) — confidence 1.0, automático
  2. Recorrência (ilike na descrição + classificação prévia) — confidence 0.93, automático
  3. Embeddings — stub (não implementado)
  4. Claude Haiku com prompt caching — confidence do modelo; ≥90% auto, 50–90% `needsReview=true`
- `approveAndInsert` dispara evento Inngest após inserção (`.returning()` para capturar IDs)
- Página `/transacoes/revisao`: fila de revisão com aprovação/descarte em lote
- `src/server/review.ts`: `getReviewQueue`, `getReviewCount`, `confirmSuggestions`, `skipSuggestions`
- Confirmar sugestão → cria `categorization_rule` automática (camada 1 nas próximas importações)
- Badge âmbar em `/transacoes` com contagem de sugestões pendentes

**✅ Sessão 3C — Classificação pós-import em `/transacoes` (concluída):**
- Comboboxes pesquisáveis por dimensão em cada linha da tabela (sempre visíveis, sem expandir)
- FilterBar: busca por descrição, período, direção, filtro por cada dimensão (+ "Não classificado")
- Filtragem server-side via URL searchParams (funciona em todas as páginas)
- Seleção em lote → dialog de classificação em massa (comboboxes também pesquisáveis)
- Classificação manual → cria/atualiza `categorization_rule` automaticamente
- Atualização otimista com revert em caso de erro
- Dependência adicionada: `cmdk`; componente criado: `src/components/ui/command.tsx`
- **Melhorias de UX (sessão seguinte à entrega inicial):**
  - Filtros de dimensão viram **multi-select pesquisáveis** (Popover + Command com checkbox); URL comma-separated (`?category=id1,id2`); server action usa `inArray` + `or(isNull, inArray)` para combinar "Não classificado" com IDs
  - **Filtro por importação (origem):** multi-select no topo da FilterBar listando cada arquivo importado (`Fatura CC · jan/24 · 160 lançamentos`). Multi-select permite comparar 2 documentos simultaneamente (transferências entre contas, pagamento de fatura CC). Server action: `getDocumentsWithTransactions` em `documents.ts`; parâmetro `documentId` em `getTransactions`
  - **X por filtro individual** em todos os campos; botão "Limpar tudo" mantido
  - **Totalizador:** barra Entradas / Saídas / Líquido de todos os resultados filtrados (query `SUM` paralela)
  - **"Dt Lançamento":** header renomeado; formato `DD/MM/AA`; campo é `transactions.date` (data de competência do extrato — a data do período de importação fica em `documents` e não é exibida por lançamento)
  - **Ordenação** por data e valor (headers clicáveis, param `?sort=date_asc|...`)
  - **Fix:** input de data resetava o segmento do ano ao digitar — resolvido com componente `DateInput` de estado local (URL só atualiza quando ano ≥ 2000)

**✅ Parser Excel/CSV/TXT migrado para LLM (concluído — retroativo Fase 2):**
Parser determinístico descartado por falhar sistematicamente em formatos reais BR. `excel-csv.ts` reescrito (~350 → ~107 linhas): SheetJS apenas para leitura de binários, texto enviado ao Claude Haiku. `process-document.ts` simplificado (~228 → ~112 linhas): template system removido, lógica de direção unificada com PDF via `DEFAULT_OUTFLOW_SOURCES`.

**Sessões adicionais (inseridas antes da Fase 4):**

**✅ Sessão 3D — Import CSV de dimensões (concluída):**
- Parser CSV genérico (`src/lib/csv-parser.ts`): delim `;`, BOM UTF-8 tolerado, quoting padrão CSV, validação de cabeçalho
- Templates fixos (`src/lib/csv-templates.ts`): download via Blob client-side
- 8 server actions (`src/server/imports.ts`): preview (lê estado, valida linha a linha, calcula diff insert/update) + commit (atomic) × 4 dimensões
- `CsvImportDialog` reutilizável + `CsvImportButton` integrados nas 4 páginas `/configuracoes/*`
- Formatos:
  - `categorias`: `codigo;tipo natureza;natureza pai;natureza filho` (uma linha por Filho, Pai inferido)
  - `centros-de-custo`: `codigo;nome`
  - `unidades-de-negocio`: `codigo;nome`
  - `entidades-juridicas`: `codigo;nome;cnpj`
- All-or-nothing: confirmar só habilita com zero erros
- Upsert seguro: categorias não movem entre Pais via CSV (proteção); flat por `code → cnpj → name`

**✅ Sessão 3E — Hierarquia 3 níveis em categorias (concluída):**
- 14 tipos DRE + BP substituem os 7 genéricos: `receita_operacional`, `cpv`, `sga`, `resultado_financeiro`, `ir`, `investimento`, `transfer`, `deducoes_tributarias`, `deducoes_operacionais` + 5 tipos de BP
- **Atualização (migration 0011 — ✅ aplicada):** o tipo `investimento` foi separado em `emprestimos_amortizacoes` + `investimentos_retiradas` → total agora 15 tipos (10 DRE + 5 BP). Transferências renumeradas de código 9 para 10. Ver CLAUDE.md / migration `0011_emprestimos_e_investimentos.sql`.
- **Atualização (migration 0012 — ✅ aplicada):** wipe total + reseed em todas as orgs (corrigiu orgs antigas com plano de contas incompleto que a 0009 não populou). Bônus permanente: função `seed_categories_for_org(uuid)` extraída do trigger, reusável via `SELECT seed_categories_for_org('<uuid>')` no SQL Editor. Ver migration `0012_reset_categorias_total.sql`.
- Modelo explícito: **Tipo da Natureza → Natureza Pai (agrupador) → Natureza Filho (classifica transações)**
- Apenas Natureza Filho (`parent_id IS NOT NULL`) pode ser atribuído a transações
- Migration `0009_category_types.sql`: remapeia tipos + recria trigger de seed (53 categorias)
- UI `/configuracoes/categorias`: seções DRE / Balanço Patrimonial separadas, dialog Pai/Filho explícito
- Comboboxes em `/transacoes` filtrados para Natureza Filho; categorizer (`loadOrgContext`) idem

**Ordem de implementação:** ✅ 3.0 → ✅ 3A → ✅ 3C → ✅ parser LLM → ✅ 3B → ✅ 3E → ✅ 3F → ✅ 3D

**Definition of Done:**
- ✅ Cliente cadastra centros de custo, unidades de negócio e entidades jurídicas em `/configuracoes`
- ✅ Plano de contas gerenciável com árvore 3 níveis (Tipo → Pai → Filho), inline rename, archive, delete
- ✅ Transações importadas recebem as 4 dimensões — manualmente via comboboxes pesquisáveis em `/transacoes`
- ✅ Correções manuais viram regras automaticamente
- ✅ Parser: todos os formatos (CSV, TXT, XLS, XLSX) via Claude Haiku — sem heurística, sem templates
- ✅ Mais de 70% das transações são auto-classificadas via motor de 4 camadas após histórico suficiente
- ✅ Custo de LLM por 1.000 transações abaixo de US$ 0,50 (US$ 0,001–0,012 por upload medido)
- ✅ Import CSV em lote para popular dimensões rapidamente (Sessão 3D)

**Tempo:** 3 semanas

---

### FASE 4 — Integração Open Finance via Pluggy (Semanas 9-10)

**Objetivo:** cliente conecta banco/cartão pelo widget Pluggy e o extrato vem automático todo dia, passando pelo pipeline de categorização da Fase 3.

**Decisão travada (2026-05-18):** provedor = **Pluggy**. Motivos: cobertura ampla de bancos PJ brasileiros, documentação e suporte em PT, pricing por conexão (mais previsível pra MVP), widget React `@pluggy/connect` reduz superfície de UI a manter.

**Deliverables (alto nível):**
- Widget Pluggy embutido em `/contas` (botão "Conectar banco")
- Fluxo de autorização do cliente via `connect_token` server-side
- Persistência da conexão em `data_sources` (`provider='pluggy'`, `external_item_id` único)
- Sync inicial (primeira ingestão) + cron diário Inngest
- Webhooks Pluggy → atualização incremental
- Reconciliação contra transações importadas manualmente (upload)

**Sub-plano (sessões):**

**✅ 4.0 — Scaffolding (concluída):**
- SDK `pluggy-sdk` instalado; singleton em `src/lib/pluggy.ts`
- `data_sources.external_item_id` adicionado via migration `0013_pluggy_data_sources.sql` ✅ aplicada
- Drizzle schema atualizado; `.env.example` reescrito com Anthropic/Inngest/Pluggy; `.env.local` configurado com credenciais sandbox
- Convenções para `metadata` jsonb (connectorId, institutionName, products, executionStatus, etc.)

**✅ 4.A — Fluxo de Connect (widget) (concluída):**
- `react-pluggy-connect@2.12.0` instalado; carregado com `ssr: false` via `next/dynamic`
- `src/server/connections.ts`: `generateConnectToken(itemId?)`, `registerPluggyItem(itemId)`, `getOrgConnections()`
- `/contas` refatorado: server component (busca conexões + `includeSandbox`) + `contas-client.tsx` (botão, widget, lista com logo/status/syncedAt, reautenticação)
- Mapeamento: `PERSONAL_BANK|BUSINESS_BANK` → `bank`; `CREDIT_CARD` → `credit_card`; `INVESTMENT` → `investment`

**✅ 4.B — Sync inicial (concluída):**
- `src/jobs/sync-pluggy-item.ts` — função Inngest `syncPluggyItem`, evento `pluggy/item.connected`
- Concurrency `limit: 1` por `dataSourceId`; `client.fetchAccounts(itemId)` → para cada conta `client.fetchAllTransactions(accountId, { dateFrom })` (90d padrão ou `fromDate` do evento)
- Insert em `transactions` em lotes de 100 com `onConflictDoNothing` (dedup por `external_id`); `status='confirmed'`, `needsReview=false`
- Atualiza `data_sources.lastSyncAt`, `lastSyncStatus='SUCCESS'`, `metadata.lastTransactionFetchedAt`
- Dispara `transaction/batch-inserted` → categorização automática (Fase 3B)
- `registerPluggyItem` em `src/server/connections.ts` dispara evento após upsert

**✅ 4.C — Webhooks + cron diário (concluída):**
- `src/app/api/webhooks/pluggy/route.ts` — `POST /api/webhooks/pluggy`; eventos `item/updated` (despacha sync incremental com `fromDate = lastTransactionFetchedAt - 1d`) e `item/error` (atualiza `status='error'`); segurança por lookup de `external_item_id` (sem HMAC)
- `src/jobs/sync-all-pluggy-items.ts` — cron `0 6 * * *` (03h BRT); busca todos `data_sources` com `provider='pluggy'`, `status='active'`, `external_item_id IS NOT NULL`; despacha `pluggy/item.connected` com `fromDate = daysAgoISO(7)` para cada um

**✅ 4.D — Reconciliação (concluída):**
- `src/jobs/reconcile-pluggy-transactions.ts` — função Inngest acionada por `pluggy/reconcile.requested`
- Para cada transação Pluggy recém-inserida: query SQL com `pg_trgm similarity()` buscando matches em outras fontes (mesma org, direção, valor, data ±2 dias)
- Score ≥ 0,85 → `status='duplicate'` + `duplicateOf` automático; 0,50–0,84 → `needsReview=true` + candidato no metadata; <50% → mantém ambas
- Processamento em lotes de 50 por `step.run`; concurrency `limit: 1` por org

**✅ 4.E — UX /contas: número de conta, filtros e sync com data de corte (concluída):**
- `PendingTransaction` inclui `accountNumber` extraído de `metadata.accountNumber`
- Extrato pendente: filtro por conta (subtype + number), filtro De/Até, coluna "Conta" com número
- Cards de conexão: exibem número de conta junto ao tipo
- Botão de sync abre dialog pedindo data de corte (default: 90 dias atrás); `triggerManualSync(dataSourceId, fromDate?)` repassa ao job

**✅ 4.F — Categoria Pluggy como hint IA (concluída):**
- `metadata` da transação passa a incluir `pluggyCategory`, `pluggyCategoryId`, `merchantName`, `merchantCategory`
- `classifyWithLLM` em `src/lib/categorizer.ts` aceita `pluggyCategory?: string | null`; quando presente, injeta no user message como dica ao Haiku
- `/transacoes`: célula de descrição exibe `pluggyCategory` como texto secundário cinza (`text-xs text-muted-foreground/60`)

**Pré-requisitos de conta (cliente):**
- Conta no [dashboard.pluggy.ai](https://dashboard.pluggy.ai) (sandbox)
- Credenciais `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` no `.env.local`
- Para produção: contratar plano, gerar credenciais de produção e migrar `PLUGGY_ENVIRONMENT=production`

**Definition of Done — ✅ FASE 4 COMPLETA:**
- ✅ Cliente conecta uma conta PJ real (sandbox) pelo widget
- ✅ Transações aparecem em `/transacoes` já com categorização IA aplicada
- ✅ Próximo dia (via webhook ou cron), novas movimentações entram sozinhas
- ✅ Reconciliação com upload manual evita duplicatas (tela `/transacoes/reconciliacao`)
- ✅ Status de erro do item é visível em `/contas` com fluxo de reautenticação
- ✅ Extrato pendente filtrado por conta, data, com número de conta exibido
- ✅ Categoria do banco (Pluggy) usada como hint na categorização IA

**Tempo:** concluída em ~3 semanas

---

### FASE 5 — Analytics + Expert Chat (Semanas 11-13)

> **Nota de execução:** esta fase foi recortada diferente do plano original. O que foi chamado de "Fase 5" no desenvolvimento cobre as funcionalidades de analytics financeiro (Dashboard, DRE, Indicadores, Fluxo de Caixa) e um chat expert com contexto KPI. A interface conversacional com tool use (consultas via SQL dinâmico) fica para fase futura.

**Objetivo:** entregar as telas analíticas centrais do produto + expert com contexto financeiro básico.

**Deliverables — ✅ TODOS ENTREGUES:**

**✅ 5.0 — Queries de aggregação DRE**
- `src/lib/dre-types.ts`: tipos e constantes públicos (`DreType`, `DRE_TYPES`, interfaces `DreFilters`, `DreCategoryRow`, `DreData`, `DrillDownTransaction`)
- `src/server/dre.ts`: `getDreData(filters)` (aggregação com JOIN categorias/pais, agrupamento mensal, filtros de dimensão) + `getDreDrillDown` (transações individuais)

**✅ 5.A — Página DRE 12 meses**
- Tabela DRE hierárquica com 12 colunas mensais: Tipo → Pai → Filho
- Filtros: período (2 inputs `type="month"`), 3 multi-selects de dimensão (CC, UN, Entidade)
- Sticky header + sticky primeira coluna; subtotais em destaque; drill-down por célula
- Coluna Total clicável (abre drill-down do período inteiro)
- Fixes pós-5.A: Toaster adicionado ao layout raiz; drill-down aceitando `dateRange?`; classificação em lote corrigida (`__null__` como sentinel para remover dimensão)

**✅ 5.B — Dashboard com KPI cards e gráfico de fluxo**
- `src/server/dashboard.ts`: `getDashboardKPIs()`, `getCashFlowChart()`, tipos exportados
- `DashboardClient`: grid 4 KPI cards + gráfico de barras semanal Recharts (entradas verde / saídas vermelho)
- `recharts@3.8.1` adicionado

**✅ 5.D — Indicadores Financeiros**
- `getFinancialIndicators()`: Margem EBITDA, Liquidez Corrente, Cobertura do Serviço da Dívida
- Card no dashboard com semáforo por indicador (verde/âmbar/vermelho); `null` exibe "—" com hint contextual
- Thresholds: EBITDA ≥15%/5%; Liquidez/DCSR ≥1,5x/1,0x

**✅ 5.E — Expert drawer com chat real**
- `src/server/expert.ts`: `getOrCreateConversation()`, `sendExpertMessage()`, `startNewConversation()`
- System prompt: nome da org, AI_VOICE.md, KPIs do mês com variação % vs. mês anterior
- `ExpertChat` client component: histórico, otimismo, auto-scroll, "Nova conversa"
- Modelo: `claude-sonnet-4-6`; custo interno (não exposto ao cliente)

**✅ 5.F — Fluxo de Caixa Projetado em `/fluxo`**
- `src/server/fluxo.ts`: `getFluxoData()` detecta recorrências via SQL (CTE em 3 passos: deduplicação por dia, agrupamento, intervalo médio)
- Filtra: 2+ ocorrências, intervalo 7–40 dias, last_date nos últimos 90 dias
- Projeta próximos 90 dias; KPI cards com Saldo Atual + Projetado 30d/60d/90d
- Gráfico de barras: histórico (60d, cores escuras) + projeção (90d, cores claras), empilhados por `stackId`
- Tabela de recorrências: descrição, tipo, valor médio, próxima data, intervalo

**Pendente:**
- **5.G** — Relatório de fechamento mensal gerado pelo expert
- **Fase futura** — Expert com tool use real (queries dinâmicas ao banco via Anthropic tool use): `search_transactions`, `aggregate_by_period`, `forecast_cashflow`, etc. — funcionalidade prevista no plano original, diferida por complexidade

**Definition of Done — ✅ FASE 5 EM ANDAMENTO (5.G pendente):**
- ✅ Dashboard com KPIs, gráfico de fluxo e indicadores financeiros em tempo real
- ✅ DRE 12 meses com filtros por dimensão, drill-down e coluna Total
- ✅ Expert no drawer com contexto financeiro da org, histórico persistente
- ✅ Fluxo de Caixa projetado 30/60/90 dias baseado em recorrências detectadas
- ⬜ Relatório de fechamento mensal narrado pelo expert (5.G)

**Tempo:** ~3 semanas (5.0 a 5.F concluídas)

---

### FASE 6 — Dashboard e Balanço Gerencial (Semanas 14-15)

**Objetivo:** painel inicial mostra a empresa em uma tela, BP gerencial atualizado em tempo real.

**Deliverables:**
- Dashboard principal com: caixa atual, AR aberto, AP aberto, lucro do mês, top 5 categorias do mês, alertas
- Página de DRE gerencial mensal (últimos 12 meses)
- Página de Balanço Patrimonial gerencial (construído a partir das transações + cadastros)
- Indicadores: liquidez corrente/seca, endividamento, ciclo financeiro, ROE, margem EBITDA
- Tudo com drill-down (clica no número, vê detalhe)

**Prompt template:**
> *"Vamos construir o dashboard e os relatórios financeiros. Página /dashboard: cards com Saldo de Caixa (somatório de bank balances atuais), AR em Aberto, AP em Aberto, Lucro do Mês Corrente, e gráfico de fluxo de caixa últimos 90 dias. Página /dre: tabela DRE gerencial com colunas dos últimos 12 meses, agrupada por categoria do plano de contas. Página /balanco: monta o BP gerencial assim — Ativo Circulante = caixa + aplicações + AR + estoque (se tiver); Ativo Não-Circulante = imobilizado (tabela fixed_assets que precisamos criar); Passivo Circulante = AP + empréstimos curto prazo; Passivo Não-Circulante = empréstimos longo prazo; PL = derivado. Página /indicadores: calcula e mostra os principais indicadores. TUDO com drill-down: clica no número, abre uma view com as transações que compõem aquele saldo."*

**Definition of Done:**
- Você abre /dashboard e vê instantaneamente como sua empresa está
- DRE bate com o que o contador entrega (com possíveis diferenças explicáveis de timing)
- BP gerencial está coerente

**Tempo:** 2-3 semanas

---

### FASE 7 — Integração SEFAZ / NF-e (Semanas 16-17)

**Objetivo:** todas as NFs entrantes e saintes do CNPJ vêm automaticamente.

**Deliverables:**
- Cliente sobe certificado digital A1 (ou conecta via API SEFAZ)
- Job diário puxa XMLs novos
- NFs viram registros estruturados, casam com transactions já existentes
- Painel de NFs

> **Aviso:** essa fase é tecnicamente delicada (certificado digital, comunicação com SEFAZ). Considere integrar com um provedor (Tecnospeed, NFE.io, Migrate) em vez de fazer do zero.

**Prompt template:**
> *"Vamos integrar com SEFAZ pra puxar NFs. Pesquise as opções: (a) cliente faz upload do certificado A1, fazemos comunicação direta com SEFAZ, ou (b) usamos provedor tipo Tecnospeed/NFE.io/Migrate que abstrai a complexidade. Recomende a opção mais simples pro escopo. Depois implemente: armazenamento seguro do certificado (criptografado), job diário que puxa NFs entrantes e saintes desde a última sincronização, parseamento do XML em registros estruturados na tabela invoices, e reconciliação com transactions existentes (match por valor + data + CNPJ)."*

**Tempo:** 2-3 semanas

---

### FASE 8 — Connectors de Cartão e Adquirentes (Semanas 18-21)

**Objetivo:** vendas em cartão (Stone, Cielo, Rede, PagBank) e faturas de cartão de crédito entram detalhadas.

**Deliverables:**
- Connector pra Stone
- Connector pra Cielo
- Suporte a upload de fatura de cartão em PDF (extraída por LLM)
- Reconciliação automática entre lote bancário e vendas detalhadas

**Prompt template (por adquirente):**
> *"Implemente o connector pra [Stone/Cielo]. Cliente entra em /connections, escolhe o provedor, fornece credenciais (API key ou OAuth). Salvamos como account. Job diário puxa vendas detalhadas via API do provedor. Casa vendas com transactions bancárias correspondentes ao lote (mesmo valor agregado, mesma data). Cada venda vira um registro em transactions com origem='stone' ou 'cielo', linkando ao lote pai."*

**Tempo:** 1 semana por connector. Total ~3-4 semanas.

---

### FASE 9 — Agente Proativo e Notificações (Semanas 22-23)

**Objetivo:** o sistema não espera o cliente perguntar — proativamente envia alertas e insights.

**Deliverables:**
- Job diário que analisa o estado da empresa e gera "insights"
- Tipos de insight: anomalia (valor incomum), oportunidade (caixa parado), risco (projeção de estouro), padrão (gasto crescente)
- Envio por WhatsApp (via Twilio API ou similar) e e-mail
- Fechamento mensal automático: no dia 5 de cada mês, sistema gera narrativa do mês anterior

**Prompt template:**
> *"Vamos construir o agente proativo. Job diário às 7h: pra cada organização ativa, roda uma análise. Análise é uma cadeia de tools que Claude Sonnet executa: detect_anomalies(últimos 7 dias), check_idle_cash(saldo > X por mais de N dias), forecast_cashflow_risks(próximos 90 dias), detect_spending_patterns(comparação trimestral). Cada finding vira um registro em insights. Insights com prioridade alta disparam notificação por WhatsApp (Twilio) e e-mail (Resend ou SendGrid). No dia 5 de cada mês, dispara job de fechamento: Claude gera uma narrativa do mês anterior usando os dados — formato 'Olá [nome], aqui está o fechamento de [mês]: [análise em prosa]'. Envia por e-mail e disponibiliza em /reports."*

**Tempo:** 2 semanas

---

### FASE 10 — Onboarding, Billing e Lançamento (Semanas 24-26)

**Objetivo:** produto vendável, cliente novo se cadastra e configura sozinho.

**Deliverables:**
- Fluxo de onboarding guiado (5-8 telas)
- Integração Stripe pra cobrança recorrente
- Planos: Starter, Pro, Enterprise com limites
- Página de marketing simples
- Sistema de billing: trials, upgrades, cancelamentos, cobrança falha

**Prompt template:**
> *"Vamos construir o onboarding e billing. Fluxo de onboarding: (1) cadastro, (2) cria primeira organização, (3) escolhe plano com 14 dias de trial, (4) conecta primeiro banco (Open Finance), (5) sobe primeiro relatório de AP, (6) configura plano de contas (escolhe template ou customiza), (7) dashboard! Integra Stripe pra cobrança recorrente com 3 planos (Starter R$ 297, Pro R$ 497, Enterprise R$ 997 — definir limites de cada). Trial expira → bloqueia acesso (exceto leitura). Página /pricing pública. Página simples /landing com pitch + login."*

**Tempo:** 2-3 semanas

---

## Parte 5 — Template do CLAUDE.md (CRÍTICO)

Crie um arquivo `CLAUDE.md` na raiz do projeto. Esse arquivo é lido pelo Claude Code em **toda sessão**. É a memória persistente da IA. Mantenha sempre atualizado.

```markdown
# Contexto Persistente do Projeto Lure

## O que estamos construindo
**Lure** (domínio lure.expert) — SaaS financeiro AI native pra PME brasileira.
Cliente conecta banco (Open Finance), sobe relatórios do ERP, e recebe
categorização automática, fluxo de caixa, indicadores em tempo real,
fechamento narrado, e chat conversacional.

Marca: derivada da consultoria Lure (controladoria, processos, estratégia).
O produto é "o controller virtual" pra empresa que ainda não tem um.

## Princípios não-negociáveis
1. **Multi-tenancy via RLS sempre.** Toda query DEVE respeitar organization_id.
2. **LLM é última opção.** Sempre tente código → regras → embeddings antes de chamar IA.
3. **Use Haiku pra bulk, Sonnet pro raciocínio.** Opus nunca em produção.
4. **Ative prompt caching em system prompts longos.**
5. **Operações pesadas vão pra Inngest, nunca síncronas.**
6. **Tudo em português** (interface, dados, comentários de código).
7. **Antes de gerar texto pela IA, leia docs/AI_VOICE.md.** Tom é "especialista calmo, direto, sem firulas".
8. **Antes de criar componente novo, verifique se já existe** em /components/ui, /components/financial ou /components/states.
9. **Toda tela que carrega dado implementa os 5 estados** (loading/empty/error/partial/success). Nunca tela em branco carregando.

## Stack
- Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
- Supabase (Postgres + Auth + Storage + pgvector)
- Drizzle ORM
- Inngest pra jobs em background
- Anthropic SDK (Claude Haiku 4.5 + Sonnet 4.6)
- Vercel deploy

## Identidade visual (ver docs/DESIGN_TOKENS.md)
- Cor primária: emerald-700 (verde-floresta)
- Tipografia: Inter (com tabular-nums em números)
- Paleta neutra: slate
- Semânticas: emerald-600 (+), rose-600 (−), amber-500 (alerta), sky-600 (info)

## Convenções de código
- Tabelas em snake_case plural (transactions, contacts)
- Funções em camelCase (categorizeTransaction)
- Componentes React em PascalCase (TransactionList)
- Sempre validar input com Zod
- Sempre logar operações importantes em agent_events
- NUNCA expor service_role key pro client

## Estrutura de pastas
- /app — rotas Next.js (com group (authenticated) e (public))
- /components/ui — componentes base (Button, Card, Input, etc.)
- /components/financial — componentes específicos (CurrencyDisplay, KPICard, etc.)
- /components/states — EmptyState, LoadingState, ErrorState, PartialDataBanner
- /lib — utilitários, clientes (supabase, anthropic, inngest)
- /server — server actions, lógica de backend
- /jobs — definições Inngest
- /db — schema Drizzle, migrations
- /prompts — prompts pra LLM, separados em arquivos
- /docs — DESIGN_TOKENS.md, AI_VOICE.md, STATE_PATTERNS.md, SCHEMA.md

## O que NÃO fazer
- NÃO criar features fora do escopo da fase atual
- NÃO criar componente novo sem checar se já existe na biblioteca
- NÃO mudar stack sem discutir
- NÃO usar localStorage pra dados sensíveis
- NÃO fazer query sem RLS
- NÃO chamar LLM em código síncrono (sempre via Inngest)
- NÃO commitar .env
- NÃO usar emoji em texto gerado pela IA (ver AI_VOICE.md)

## Fase atual
[ATUALIZE AQUI A CADA FASE — ex: "Estamos na Fase 3, categorização. 
A Fase 2 está completa e testada. Próximo objetivo: implementar fila de revisão."]

## Decisões já tomadas que não revisitamos
- Produto: Lure / lure.expert
- Cor primária: emerald-700
- Tipografia: Inter
- Voz da IA: especialista calmo, direto, sem firulas (docs/AI_VOICE.md)
- Layout: sidebar esquerda colapsável + chat flutuante canto inferior direito
- Idioma: PT-BR only
- Moeda: BRL only
- Plano gratuito: não — só trial de 14 dias
- Open Finance via: [Belvo/Pluggy — definir antes da Fase 4]
- SEFAZ via: [provedor — definir antes da Fase 7]
- Limites por plano: [definir antes da Fase 10]
```

---

## Parte 6 — Operando com Claude Code (a parte mais importante)

### Os 7 mandamentos do não-programador usando Claude Code

**1. Uma sessão = um objetivo.** Não diga "implementa o login, depois faz o dashboard, depois...". Diga "implementa SÓ o login". Quando terminar, abra nova sessão pro próximo.

**2. Sempre cite o CLAUDE.md.** Comece a sessão com algo como: *"Lendo CLAUDE.md pra contexto. Hoje vamos trabalhar na Fase X."*

**3. Sempre teste o que ele entregou antes de seguir.** Não confie no "está pronto". Rode, clique, verifique no banco. Se quebrou algo, **AGORA é hora de consertar**, não depois.

**4. Quando algo dá errado, descreva o sintoma, não a causa.** Errado: *"o Supabase não tá funcionando"*. Certo: *"cliquei em login, apareceu erro 'invalid credentials', mas a senha está certa. O que pode ser? Olha o código e me explica."*

**5. Sempre peça o "porquê" das mudanças.** *"Por que você escolheu fazer assim? Tem alternativa? O que essa decisão amarra pra frente?"* Isso te ensina e força a IA a justificar.

**6. Faça commits frequentes.** Toda vez que algo funciona, peça pra ele dar commit. *"Faz commit do que está funcionando agora antes da gente continuar."* Se quebrar, você volta.

**7. Não confie em explicações sem evidência.** Se a IA diz "isso deve funcionar", peça *"prova: roda esse fluxo e me mostra a saída"*. Tudo precisa ser verificável.

### Anatomia de uma sessão ideal (1h)

1. **0-5min** — Abrir CLAUDE.md, identificar o objetivo do dia, escrever uma frase ("hoje vou fazer X, considerado pronto quando Y")
2. **5-15min** — Pedir ao Claude Code pra ler o estado atual (`git status`, ler arquivos relevantes) e propor um plano
3. **15-50min** — Implementar em pequenos passos, testando a cada passo
4. **50-55min** — Commit + atualizar CLAUDE.md se algo mudou de decisão
5. **55-60min** — Anotar no seu caderno: "o que terminei", "o que ficou pendente", "dúvidas pra próxima sessão"

### Sinais de alerta (PARE e reagrupe)

🚨 **A sessão já tem 2h e nada funciona** → você perdeu o contexto. Encerre, commit do que tem, comece amanhã.

🚨 **Claude Code está "tentando coisas" sem sucesso** → ele perdeu o problema. Reformule do zero: descreva o sintoma com mais detalhe.

🚨 **Você não consegue mais explicar pra outra pessoa o que o código faz** → você está delegando demais. Pause, peça pra IA explicar tudo em português, entenda antes de continuar.

🚨 **Tem mais de 5 erros de TypeScript no console** → não acumule. Resolve antes de prosseguir.

🚨 **Você está mexendo em coisas de "fases anteriores" pra continuar** → suas fundações estão fracas. Pode ser hora de parar e refatorar.

### Como debugar quando você não sabe programar

1. **Copie o erro completo** (não só "deu erro")
2. **Cole no Claude Code:** *"Apareceu esse erro: [colar]. Vou rodar [ação que causou]. O que pode ser e como descobrimos?"*
3. **Sempre peça pra IA inspecionar antes de "consertar":** *"Antes de tentar arrumar, olhe os arquivos X, Y e Z e me explica o que está acontecendo."*
4. **Se a IA propõe 3 mudanças, faça uma de cada vez** e teste depois de cada uma

---

## Parte 7 — Glossário (em ordem alfabética)

**API** — Forma de um software falar com outro. "Conectar via API" = um sistema consulta o outro programaticamente.

**Backend** — A parte do software que roda no servidor, lida com banco de dados, lógica. Não visível pro usuário.

**Batch API** — Modo de chamar LLM em massa com desconto (50% off Anthropic) mas com latência maior (até algumas horas).

**Connector** — Pedaço de código que sabe falar com uma fonte externa específica (Omie, Stone, etc.).

**Drizzle** — Biblioteca que te deixa falar com Postgres usando código TypeScript em vez de SQL puro.

**Embedding** — Representação numérica de um texto que captura significado. Permite "buscar por similaridade".

**Frontend** — A parte visual do software, o que o usuário vê e clica no navegador.

**Inngest** — Plataforma pra rodar tarefas em background (não pode fazer o usuário esperar).

**LLM** — Large Language Model. Claude, GPT, Gemini. "A IA".

**Migration** — Arquivo que descreve uma mudança no schema do banco (ex: criar uma tabela nova).

**Next.js** — Framework que junta frontend + backend num único projeto.

**OCR** — "Optical Character Recognition". Ler texto de imagens/PDFs scaneados.

**Open Finance** — Sistema regulamentado pelo BC que permite acesso autorizado aos dados bancários do cliente.

**ORM** — "Object-Relational Mapping". Camada que traduz código em consultas SQL.

**pgvector** — Extensão do Postgres pra armazenar e buscar embeddings.

**Prompt caching** — Anthropic guarda partes longas e estáveis do prompt em cache, cobrando 10% na próxima chamada.

**RLS (Row Level Security)** — Mecanismo do Postgres que filtra automaticamente quais linhas cada usuário pode ver.

**SEFAZ** — Sistema da Receita onde todas as NFs ficam.

**Schema** — A estrutura do banco: quais tabelas existem, quais colunas, como se relacionam.

**Supabase** — Plataforma all-in-one: Postgres + auth + storage + APIs prontas.

**Token** — Unidade de medida pra LLM. Aproximadamente uma palavra. Você paga por token de entrada e saída.

**Tool use** — Capacidade do LLM de chamar funções do seu código pra buscar/operar com dados reais durante a resposta.

**Webhook** — Quando um serviço externo te avisa de um evento ("nova nota fiscal entrou"), em vez de você ficar perguntando.

---

## Parte 8 — O que NÃO construir (lista de proibições saudáveis)

Coisas que vão te tentar e que **NÃO devem entrar nas primeiras versões**:

- Mobile app nativo. Web responsivo basta.
- App para o contador da empresa. Foco no dono/diretor.
- Integração com TOTVS, SAP, Senior. Espera a primeira venda demandar.
- Plano gratuito (free tier). Trial de 14 dias resolve.
- Recursos colaborativos avançados (comentários, menções). Foco em dados primeiro.
- Inteligência fiscal/tributária. Não é o foco — você não é o contador.
- Conciliação contábil completa (débito × crédito por conta T). Você é gerencial, não contábil.
- Integrações com outros SaaS de gestão. Vem depois.
- Multi-idioma. Português Brasil only.
- Multi-moeda. Real only.
- "Marketplace" de connectors da comunidade. Mantém fechado.

Manter foco é mais difícil do que escrever código. Esta lista te protege.

---

## Apêndice — Roadmap visual de 6 meses

```
Mês 1: Scaffolding + Fundações de Design/Voz + Schema + Multi-tenancy
Mês 2: Ingestão de arquivos + Categorização IA
Mês 3: Open Finance + Conversa
Mês 4: Dashboard + BP gerencial + SEFAZ
Mês 5: Cartões/Adquirentes + Agente Proativo
Mês 6: Onboarding + Billing + Beta com 5 clientes pagantes
```

Aos 6 meses você tem um produto vendável com base instalada inicial. Daí em diante é refinamento, novos connectors, e expansão de ICP.

---

## Apêndice — Histórico de versões

- **v1.0** — versão inicial do plano com 10 fases (0 a 10)
- **v1.1** — adicionada **Fase 0.5 (Fundações de Design e Voz da IA)** com 5 sub-entregas: design tokens, biblioteca de componentes, voz/tom da IA, padrões de estado, arquitetura de informação. Motivo: prevenir drift visual e inconsistência de comunicação entre fases.
- **v1.2** — decisões fundacionais travadas: nome **Lure** (domínio lure.expert), cor primária **emerald-700** (verde-floresta), voz da IA **"especialista calmo, direto, sem firulas"**. Template do CLAUDE.md reescrito incorporando essas decisões e as referências aos docs criados na Fase 0.5.
- **v1.3** — criado documento separado **`SCHEMA_INICIAL.md`** especificando em detalhe as 11 tabelas centrais da Fase 1 (colunas, tipos, índices, RLS, justificativas). Fase 1 reescrita pra apontar pro novo documento como fonte da verdade. Motivo: schema é o que mais propaga no projeto — não pode ser inventado pelo Claude Code sessão a sessão.
- **v1.4** — Fase 3 atualizada: sessões 3B (motor de categorização com IA), 3D (import CSV — pendente) e 3E (hierarquia 3 níveis, 14 tipos DRE+BP) adicionadas. Definition of Done da Fase 3 revisado com checkmarks atualizados. Fase 2 já totalmente concluída (parser LLM-first para todos os formatos).
- **v1.5** — Fase 3 fechada (3D/3E/3F + migrations 0009–0012 + fixes pós-3F). Fase 4 reescrita com **Pluggy** travado como provedor de Open Finance (decisão de 2026-05-18). Sub-plano detalhado em sessões 4.0 (scaffolding — ✅ concluída), 4.A (widget), 4.B (sync inicial), 4.C (webhooks + cron), 4.D (reconciliação). Belvo removido como alternativa.
- **v1.6** — Sessão 4.A concluída: `react-pluggy-connect` integrado em `/contas`, fluxo de connect token → widget → `onSuccess` → upsert em `data_sources` funcionando em sandbox. Lista de conexões com reautenticação.
- **v1.7** — Sessões 4.B e 4.C concluídas: sync inicial via Inngest (`syncPluggyItem`) e webhook `POST /api/webhooks/pluggy` + cron diário `syncAllPluggyItems` (03h BRT). Próxima: 4.D (reconciliação Pluggy × upload manual).
- **v1.8** — Fase 4 fechada (4.D reconciliação + 4.E UX /contas + 4.F hint Pluggy IA). Fase 5 reescrita para refletir execução real: analytics financeiro (Dashboard KPIs, DRE 12 meses, Indicadores, Fluxo de Caixa projetado) + Expert drawer com chat Sonnet. Sessões 5.B, 5.D, 5.E, 5.F todas marcadas ✅. Pendente: 5.G (relatório fechamento mensal). Nota sobre divergência entre plano original (tool use) e execução atual (chat simples com KPI context) — tool use diferido para fase futura documentada.

---

*Documento mantido por: Lure TI*
*Última atualização: 2026-05-19*
*Versão: 1.8*
