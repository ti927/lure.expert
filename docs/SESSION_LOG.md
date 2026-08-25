# Histórico Completo de Sessões — lure.expert

Arquivo de arquivo. Contém os detalhes completos (arquivos alterados, bugs corrigidos, decisões de implementação) de todas as sessões de desenvolvimento. Usado para consulta pontual — não é carregado automaticamente no contexto.

Decisões arquiteturais não-óbvias estão em `docs/SCHEMA_DECISIONS.md` (sempre carregado).

> **Lacuna conhecida:** as sessões do plano de 23/ago/2026 (motor de consulta, chave de IA
> por organização, OAuth e MCP — Fases 0, 1.0–1.4, 2.0–2.1, 3.0–3.2) **não têm entrada aqui**.
> O que existe delas são as linhas da tabela de histórico do `CLAUDE.md`, que nessas sessões
> foram escritas com detalhe incomum e carregam a substância. Escrever entradas completas
> agora seria reconstruir, não registrar. A partir da 3.3 o log volta a ser escrito na hora.

---

### ✅ Sessão 4.A — Convites e aceite (Fase 4 do plano de 23/ago)

**Verificado: 41/41 contra o banco (organizações descartáveis, CASCADE na limpeza), `tsc` e
`next build` limpos — 3 rotas novas (`/auth/confirm`, `/configuracoes/membros`,
`/convite/definir-senha`).**

**Não verificado automaticamente, e declarado:** o envio real do e-mail
(`inviteUserByEmail` exige a service role e mandaria e-mail de verdade) e o `verifyOtp` do link.
Os dois dependem das 4 configurações de painel listadas no `CLAUDE.md` (service role key na
Vercel, SMTP próprio, Site URL, template com `{{ .TokenHash }}`).

> **CONFIRMADO NA TELA em 25/ago, ainda na sessão:** Julio fez as 4 configurações (SMTP via
> Resend com o domínio `lureconsultoria.com.br`; detalhes na seção de infraestrutura do
> `CLAUDE.md`) e o convite rodou de ponta a ponta — convidar em `/configuracoes/membros`,
> e-mail chegando, senha definida pelo link, queda no dashboard.
>
> **Incidente no meio do teste, com lição:** "SUPABASE_SERVICE_ROLE_KEY não está configurada"
> em produção com a chave VISÍVEL no painel da Vercel. Causa: a chave tinha 13 minutos e o
> deployment no ar, 7 horas — variável só vale em deployment novo. Diagnóstico em dois
> comandos (`vercel env ls` × `vercel ls`, comparando idades), correção com
> `vercel redeploy <url>`. O reflexo ficou registrado na seção de infraestrutura.

**Arquivos novos:** `lib/members-types.ts` (matriz + Zod + guardas puras, client-safe),
`lib/members.ts` (o miolo: listar, vínculo, convite pendente, aceite/recusa, último owner,
auditoria — todas recebendo o executor), `server/members.ts` (casca `'use server'`),
`lib/supabase/admin.ts` (service role, com `sanitizeKey`), `lib/redirect-seguro.ts`
(`destinoSeguro` extraído do login), `app/auth/confirm/route.ts`,
`app/convite/definir-senha/{page,definir-senha-form}.tsx`,
`app/(authenticated)/configuracoes/membros/page.tsx`,
`components/settings/{members-manager,pending-invites}.tsx`, `scripts/verify-members.ts`.
**Alterados:** `app/onboarding/{page,onboarding-form,actions}` (page virou server component e
mostra convites pendentes; o form mudou de arquivo), `app/login/actions.ts` (importa o
`destinoSeguro` compartilhado), `configuracoes/page.tsx` (card Membros + card Convites
pendentes), `.env.example`.

#### Sem migration — e o porquê de `user_id` seguir `NOT NULL`

O schema da Fase 1 antecipava o convite inteiro (`role` default `'viewer'`, `invited_email`,
`invited_by_user_id`, `accepted_at`). O único obstáculo era `user_id NOT NULL` para convidado sem
conta — e a decisão do e-mail automático o dissolveu: `inviteUserByEmail` cria a conta no Auth
**antes** da membership e devolve o id. Convite pendente = membership com `accepted_at` nulo; o
aceite é um UPDATE. A migration 0032 que o plano da sessão cogitava deixou de existir.

#### Dois caminhos de convite, porque o Supabase recusa reconvidar

- **E-mail novo:** `inviteUserByEmail` → e-mail → `/auth/confirm?token_hash=...&type=invite`
  (verifyOtp **server-side**, cookies pela mesma via do login) → `/convite/definir-senha`
  (`updateUser({ password })` no browser client) → `concluirConvite()` aceita **todos** os
  pendentes de uma vez — foi o clique naquele e-mail que os comprovou.
- **E-mail já cadastrado:** o Supabase recusa (`email address has already been registered`) e não
  é preciso — vira convite pendente **in-app**: quem não tem organização o vê no `/onboarding`
  (que virou server component), quem já tem o vê num card em `/configuracoes`. Aceitar a 2ª
  organização já funciona; ela só fica visível com o seletor da 4.B (o `getAuthContext` devolve a
  mais antiga, com `orderBy` determinístico desde a 1.1).

**O template do e-mail é pré-requisito, não preferência:** o padrão usa `{{ .ConfirmationURL }}`,
que redireciona com os tokens no **fragmento** da URL — e fragmento nunca chega ao servidor, então
nenhum route handler consegue criar a sessão. Com `{{ .TokenHash }}` o `verifyOtp` roda no
servidor. `/auth/confirm` aceita os demais tipos (`recovery`, `email_change`...) — vira o destino
único de link de e-mail quando a recuperação de senha existir.

#### As guardas, e onde cada uma mora

Matriz pura (`recusaDeGestao`, em `members-types.ts`): admin/owner gerenciam; admin não mexe em
owner nem concede owner. **Último owner** é regra de CONTAGEM, não de matriz (`recusaDeMudanca`,
em `members.ts`): rebaixar ou remover o único owner **ativo** é recusado; owner **pendente** não
conta na proteção nem é protegido (cancelar o convite dele é livre). Ninguém altera o próprio
papel nem se remove. Aceite e recusa autorizam pelo próprio WHERE (`id + user_id + accepted_at IS
NULL`) — convite alheio devolve o mesmo "não encontrado" de id inexistente, sem virar oráculo.
Recusas são descritivas (`{ erro }`), nunca exceção. Auditoria em `agent_events`: `member_invited`,
`member_role_changed`, `member_removed`, `invite_accepted`, `invite_declined`.

#### Defeito achado pelo teste, fora do escopo, corrigido no mesmo commit

O caso "convidar quem já é membro estoura o unique" falhou com `código: nenhum` — o Drizzle 0.45
embrulha o erro do driver em `DrizzleQueryError` e o `23505` do Postgres mora em **`err.cause`**.
Consequência que já estava em produção: o `createOrganization` do onboarding checava `err.code`
direto, então **CNPJ duplicado caía na mensagem genérica** desde o upgrade do Drizzle. Os três
catches (convite, onboarding, e o do script) aceitam os dois formatos (`code ?? cause.code`, e
`constraint ?? cause.constraint_name`).

#### O que ficou de fora, de propósito

Reenviar convite (o Supabase não reenvia para conta existente; cancelar e convidar de novo cobre);
"sair da organização" por conta própria; e todo o enforcement fora da gestão de membros — funil,
escritas destrutivas, chave de IA e o escopo de escrita do consentimento MCP para viewer são a
**4.B**, junto com a organização ativa (cookie `lure_org` + seletor no AppShell + consolidação das
~21 cópias do `getAuthContext`).

---

### ✅ Sessão 4.5.C — o asfalto do MCP, e a Fase 4.5 fecha

**Verificado: 132/132 escrita do MCP, 70/70 tela, 36/36 leitura.**

**Arquivos:** `parsers/excel-csv.ts`, `import-write.ts`, `mcp/tools.ts`, `staging-import.ts`,
`server/staging.ts`, `jobs/process-document.ts`, e os dois scripts de verificação.

#### O caminho rápido do parser — o princípio nº 2 saindo do papel

O parser era **LLM-first**: chamava Haiku em todo upload, de todo formato, porque nunca houve um
formato para esperar. Agora há. `canonicalMapping` testa o cabeçalho contra
`docs/FORMATO_DE_IMPORTACAO.md` **antes** de `tryLlmMapping`; casou, lê direto.

Coluna extra desconhecida **não** desqualifica — export de ERP sempre traz colunas a mais, e
recusar por causa delas anularia o ganho justamente nos arquivos reais. E cabeçalho que não casa
cai no caminho de hoje, **inalterado**: a promessa da Fase 2 ao dono de PME continua de pé.

`extraction_method` passou a gravar `'template'` para arquivo canônico. O valor existia desde a
Fase 2 (do sistema de fingerprint, descartado) e estava sem escritor; agora significa "lido sem IA",
e `verify-import-contract.ts` conta quantos documentos entraram assim.

#### O defeito que a planilha modelo expôs: o parser não lia "Saída"

`deriveDirection` comparava com `/^(d|debito|saida|...)/` sobre o texto **cru**, só em minúsculas.
`"Saída".toLowerCase()` é `"saída"`, com acento — e o regex tem `saida`. **Nunca casava.** Toda
linha de saída de um CSV que escrevesse a palavra corretamente saía com `direction: null`.

Sobreviveu porque três fallbacks mascaravam: sinal negativo no valor, `DEFAULT_OUTFLOW_SOURCES` do
cartão, e o botão "Marcar todas como Saída" na revisão. Apareceu no instante em que a planilha
modelo — que escreve "Saída", porque é o certo — foi lida pelo próprio parser. **É o argumento a
favor de fechar o laço no teste:** o arquivo que oferecemos ao usuário tem de ser legível pelo nosso
próprio código, e ninguém tinha verificado isso.

#### BP pelo MCP, impossível até aqui

`aplicarImportacao` cravava `reportType: 'other'`. Duas consequências, ambas silenciosas:
`getBpData` filtra `report_type='balance_sheet'` e nunca veria o documento; e
`domainFromReportType('other')` devolve `'dre'`, então uma linha patrimonial só via naturezas de DRE
para casar. Não havia onde informar a data de referência.

A entrada da ferramenta ganhou o **nível de arquivo** — `tipoDeRelatorio`, `dataDeReferencia`,
`conta`/`tipoDeConta`/`numeroDaConta` — que é o mesmo cabeçalho do contrato, revalidado no apply
(a prévia mora em `agent_events`, que é jsonb).

`resolverNaturezas` ganhou **filtro de domínio** e passou a delegar a `findCategoryByText`, a mesma
regra da tela. Tinha a própria cópia — duas cópias significam que o mesmo arquivo pode entrar
diferente conforme a porta.

`accountId` recebia o **texto cru** do modelo; agora é `contaCanonica`, o mesmo identificador
derivado que a tela produz.

#### `data`, `descricao` e `sentido` viraram opcionais — e isso precisava de guarda

Uma linha de balanço não tem nenhuma das três. Publicar duas variantes num `oneOf` faria o modelo
escolher errado com frequência, então o schema as declara opcionais e **quem exige é o tipo de
relatório**, validado por `normalizarLancamento`. O teste cobre os dois sentidos: movimento sem data
e sem sentido continuam recusados, com o motivo.

#### Um defeito que o próprio teste criou a chance de achar

Quando **todas** as linhas eram recusadas, `novas` era 0 e a resposta dizia apenas *"Nenhuma linha
para importar"* — sem o motivo. O modelo ficaria sem saber o que corrigir e tenderia a repetir a
chamada igual. Os motivos passaram a ser montados antes do caso zero.

#### Duas armadilhas de ambiente, para a próxima vez

`pkill -f "next start"` **não mata o processo no Windows** — o processo é `node`, e o padrão não
casa. O servidor velho seguia na porta 3100, o novo falhava em subir, e o teste rodava contra build
antigo passando/falhando por motivo errado. O jeito certo é `netstat -ano | grep :3100` e
`taskkill //PID <pid> //F`.

E um `return` no meio de `main()` pula o `process.exit()` final: a conexão do postgres segura o event
loop e o script "trava" sem erro. Foi o que pareceu travamento.

#### Verificado

**132/132** escrita do MCP contra `next start` de verdade (incluindo o balanço inteiro: recusa sem
data de referência, filtro de domínio recusando natureza de DRE, `report_type` e `reference_date`
gravados, toda linha herdando a data do arquivo, nenhuma com chave de dedup, e o balanço corrigido
entrando de novo). **70/70** na tela, incluindo a planilha modelo lida pelo próprio parser e
atravessando até o plano de gravação. **36/36** leitura. `tsc`, `next lint` e `next build` limpos.

**Não verificado na tela:** subir um arquivo no formato canônico por `/upload` e ver que ele não
consome IA.

**Continua aberto, e é decisão de produto:** `seed_categories_for_org` não cria nenhuma natureza de
Balanço, então organização nova importa o BP e `/balanco` continua vazio. A tela avisa; o plano
patrimonial padrão não foi escolhido.

---

### ✅ Sessão 4.5.B — a tela cumpre o contrato

**O critério era o DoD literal da Sessão 2.8 do `GUIA_OPERACIONAL.md`**, escrito em 2026 e nunca
construído: *"reuploadar mesmo arquivo, ver 0 inserções"*. Verificado: **54/54**.

**Arquivos:** `src/lib/staging-import.ts` (novo), `src/lib/accounts.ts` (novo),
`scripts/verify-staging-import.ts` (novo), `db/migrations/rls/0031_dedup_prefix_arq.sql` (novo),
`account-header.tsx` e `manual-accounts.tsx` (novos), mais `process-document.ts`, `staging.ts`,
`connections.ts`, `categorizer.ts`, `review-client.tsx`, `contas-client.tsx` e as duas `page.tsx`.

#### A linha que explicava tudo

`src/jobs/process-document.ts` montava o insert do staging com `date`, `amount`, `direction`,
`description` e **nada mais**. Os **dois** parsers já produziam `effectiveDate` no `StagingRow` — o
Excel/CSV desde o redesenho e o PDF desde a Fase 2.5 — e a coluna existia desde a migration 0021.
`approveAndInsert` fazia `r.effectiveDate ?? r.date` e caía no `date` em 100% das linhas porque o
valor era descartado antes de chegar. **É a explicação mecânica de "caixa nunca difere da
competência em toda a base": 0 em 10.365.**

#### Sem migration para o que importa

Levantado antes de escrever qualquer SQL: `transactions_staging.effective_date` (0021), as quatro
colunas de conta (0018), `documents.reference_date` (Fase 6) e o índice único `idx_tx_dedup`
(Fase 1) **já existiam**. A migration 0031 faz uma coisa só — trocar o prefixo `mcp:` por `arq:`,
hoje 0 linhas — e existe para que "a chave é a mesma nas duas portas" seja verdade sobre a base
inteira, não só sobre o que vier a partir de agora. Validada com `ROLLBACK`: 5/5.

#### O balanço, e o terceiro defeito que o teste achou

`approveAndInsert` filtrava `r.date && r.amount && r.direction`. Uma linha de balanço **não tem
data nem sentido próprios** — tem a data do arquivo, e o lado vem da natureza. Toda linha caía em
`skipped`, e é por isso que nunca existiu um BP no banco.

Escrevendo o teste apareceu um terceiro motivo, que nenhuma leitura de código teria dado:
**`seed_categories_for_org` não cria uma única natureza de BP.** Conferido no banco — a função não
menciona nenhum dos cinco tipos patrimoniais, e das 6 organizações só "Empresa Testes 1" tem
naturezas de BP, criadas à mão. Uma organização nova importaria o balanço e `/balanco` continuaria
vazio, porque `getBpData` soma por tipo de categoria. É decisão de produto (qual plano patrimonial
padrão), então a sessão **avisa na tela** em vez de decidir sozinha.

Camada 0 nova para o balanço: `findCategoryByText` (código exato → nome exato → prefixo de código).
Sem ela a linha entra sem natureza e o BP importado seria inútil.

#### O defeito da Decisão 18, escrito por mim de novo

`listarContasManuais` tinha `WHERE tx.data_source_id = ${dataSources.id}` dentro de subconsulta sem
join. O Drizzle emite `"id"` sem qualificar, o escopo interno vence, e a correlação vira
`tx.data_source_id = tx.id` — constante falsa, sem erro. A contagem de uso dava **0 para toda
conta**, e `apagarContaManual` passaria a autorizar apagar conta em uso (o teste bateu na FK).
Correção: `${dataSources}.id`. **Terceira vez que esta armadilha morde.**

O teste pegou porque a asserção era *"a contagem SOBE"*, e não *"a contagem existe"*.

#### E um defeito meu no casamento por código

`findCategoryByText` usava `normalizeForMatch` para tudo. Ela colapsa não-alfanumérico em espaço —
certo para nome, desastroso para código: `"1.1.01 Caixa"` viraria `"1 1 01 caixa"` e o prefixo seria
`"1"`. Agora código usa `norm` (preserva pontuação) e nome usa `normalizeForMatch`. O teste só
pegaria isso com códigos que tivessem ponto, então os códigos do teste têm ponto de propósito.

#### Conta manual — a resposta à pergunta do Julio

*"onde está puxando essa lista de contas na página /contas?"* De `data_sources` com
`provider='pluggy'`. Ou seja: existe cadastro de **conexão**, não de conta, e as contas de cada
conexão são um array JSON que só o sync do Pluggy escreve. Detalhe e o porquê da escolha em
`SCHEMA_DECISIONS.md` Decisão 22.

#### Verificado

**54/54** no banco de verdade, numa organização criada só para o teste e apagada no fim — incluindo
o mesmo arquivo duas vezes dando 0 na segunda, lote sobreposto inserindo só a linha nova, três cafés
idênticos gerando três chaves distintas, o balanço herdando a data do arquivo e **não** deduplicando
(reenviar o balanço corrigido precisa entrar, senão o documento novo ficaria vazio e `/balanco`
mostraria o vazio), e apagar conta em uso sendo recusado com o número na mensagem.

Também: migration 5/5 com ROLLBACK, `verify-mcp-write` **116/116**, `verify-mcp` **36/36**, `tsc`,
`next lint` e `next build` limpos.

**Não verificado na tela** (nada bloqueia, mas nenhum olho humano viu): a coluna Data de caixa, o
modo de balanço, o bloco de conta na revisão, a seção "Contas manuais" em `/contas`, e o aviso de
duplicadas.

**Continua pendente, declarado:** a dedup **não alcança o passado**. Os 7.762 lançamentos já
importados não têm `external_id`, então reimportar aquele arquivo específico ainda duplica.

---

### ✅ Sessão 4.5.A — o contrato de importação, sem tocar em nenhum insert

**O critério da sessão era literal, e foi conferido literalmente:**
`git diff --stat src/server/staging.ts src/jobs/sync-pluggy-item.ts src/jobs/sync-acquirer-item.ts src/jobs/process-document.ts`
devolveu **vazio**. Nenhuma gravação mudou de comportamento.

**Arquivos:** `docs/FORMATO_DE_IMPORTACAO.md` (novo), `src/lib/import-contract.ts` (novo),
`src/lib/import-dedup.ts` (novo), `scripts/verify-import-contract.ts` (novo),
`src/lib/csv-templates.ts`, `src/lib/format.ts`, `src/lib/parsers/excel-csv.ts`,
`src/lib/budget-import.ts`, `src/lib/import-write.ts`, `upload-form.tsx`.

#### A correção de enquadramento que veio antes do código

Escrevi esta fase **duas vezes errado**. Primeiro centrada nos campos de conta bancária; depois no
formato de colunas como se fosse ideia nova. A correção do Julio foi dura e certa — *"parece que vc
pegou o bonde andando, nao leu o que se trata o lure.expert"* — e era verdade: eu não tinha lido
`PLANO_DE_CONSTRUCAO.md`, `GUIA_OPERACIONAL.md` nem `SCHEMA_INICIAL.md`, e tinha **inventado e
numerado uma fase sozinho**, contra a regra que o próprio guia escreve: *"Você é o gerente, Claude
Code é o engenheiro. Você decide o quê. Ele propõe o como."*

Lidos os documentos, o enquadramento certo apareceu: **isto não é fase nova, é dívida declarada da
Fase 2** — sessões 2.1, 2.8 e 2.10, com o DoD da 2.8 dizendo literalmente *"reuploadar mesmo
arquivo, ver 0 inserções"*.

#### Dois níveis, não dois layouts

Eu havia proposto um segundo layout de planilha, "Saldos", para o BP. **Desnecessário e contra o
desenho existente:** a migration 0015 diz no próprio comentário que o BP viria *"via importação de
relatórios classificados como transações com categorias de tipo BP, **igual ao fluxo do DRE**"*. O
que o balanço precisa não é outro conjunto de colunas — é que o **arquivo** declare duas coisas que
a linha não carrega: que é um balanço, e a data de referência.

| Nível | O que carrega |
|---|---|
| **Arquivo** | origem, `tipoDeRelatorio` (movimentos \| balanço), `dataDeReferencia`, conta |
| **Linha** | as 17 colunas canônicas |

#### A chave de dedup mudou de casa e de prefixo (`mcp:` → `arq:`)

Não é cosmético. A chave precisa ser **a mesma nas duas portas de arquivo** — senão subir pela tela
o que a IA importou duplicaria, e a dedup ficaria cega justamente entre os dois caminhos que ela
existe para unir. O hash **não inclui o prefixo**, então migrar o passado é um `UPDATE` de string.
Hoje é grátis: 0 linhas com `mcp:`.

#### A separação por empacotamento, que o `tsc` não pegaria

`src/lib/csv-templates.ts` roda **no cliente**, e importa o contrato para gerar a planilha modelo.
O contrato tinha `node:crypto` dentro. **O type-check passa limpo; o `next build` quebra.** Daí
`import-dedup.ts` existir como arquivo separado — a divisão é por onde o código roda, não por
assunto.

#### O que mudou de casa (movido, não copiado)

`parseDate` saiu de `parsers/excel-csv.ts` (era o `normalizeDate` privado) e `norm` saiu de
`budget-import.ts`, ambos para `format.ts` — eram a 3ª e a 4ª cópias da mesma coisa.
**`normalizeForMatch` do categorizador ficou quieta de propósito**, com o motivo escrito no arquivo:
ela decide **classificação**, e unificá-la faria uma mudança de formatação alterar em que natureza um
lançamento cai.

#### A planilha modelo é gerada, nunca redigitada

`buildImportTemplateCsv(tipo)` monta o cabeçalho a partir de `colunasDe(tipo)`. Redigitar faria
nascer **dois formatos canônicos no primeiro dia**, e a diferença só apareceria quando alguém usasse
o modelo.

#### O script de conformidade já achou coisa

`scripts/verify-import-contract.ts` é somente leitura e mede as portas contra o contrato:

```
porta   | lançamentos | dedup | conta id | caixa ≠ compet. | caixa nulo
upload  | 7762        | 0%    | 0%       | 0               | 0
pluggy  | 2603        | 100%  | 100%     | 0               | 1361
```

**`caixa ≠ competência = 0` em toda a base** — a prova mecânica de que o campo é descartado no
insert do staging (`process-document.ts:90`). Minha primeira versão do script usava
`IS DISTINCT FROM`, que conta nulo como "diferente" e teria devolvido 1.361; corrigido para
`IS NOT NULL AND <> date`, com os nulos em coluna própria.

Também reportou os **cabeçalhos reais do único ERP já importado** (`NUM NF`, `DATA VENDA`,
`NUM PEDIDO`, `Natureza pai`, `Nome Produto`, `Natureza filho`), que renderam **3 aliases novos** —
não suposição minha, saíram do arquivo do cliente. E confirmou que aquele arquivo **não casaria** com
o caminho rápido, por não ter coluna de sentido, o que é o comportamento correto.

**Resultado:** 11 ok, 6 pendências — e as 6 são o mapa das Sessões B e C.

**Verificado:** 116/116 escrita do MCP, 36/36 leitura, `tsc --noEmit` limpo, `next lint` limpo,
`next build` compilando. **Não verificado na tela:** o link da planilha modelo em `/upload`.

---

### ✅ Sessão 3.3 (importação) — o sexto par, e a fase fecha

**A pergunta do Julio que corrigiu o desenho:** *"qual é a dificuldade de eu subir um arquivo pro
claude.ai, ele faz a tabulação, e depois importar pro expert?"* Nenhuma. Eu havia montado uma
pergunta de escopo com três opções, todas girando em torno de como fazer o arquivo chegar ao
servidor — quando o arquivo não precisa chegar.

**Arquivos:** `src/lib/import-write.ts` (novo), duas ferramentas em `mcp/tools.ts`, e um guarda em
`deleteDocument`.

#### O que não existe neste caminho

Storage, `transactions_staging`, job `process-document`, tela de revisão, e **nenhuma chamada à
Anthropic**. O parser Haiku e a revisão em grade existem porque o app não sabe ler arquivo
arbitrário. O claude.ai sabe.

#### O que existe, e por quê

Registro em `documents` (origem rastreável, filtro "importação" em `/transacoes`), `data_sources` por
origem (rótulo da conta), camada 0 (`categoria` da linha casada contra as folhas do plano de contas,
por código exato → nome normalizado → prefixo de código, com ambíguo não casando), e o disparo da
categorização do que sobrou sem natureza.

#### A deduplicação — o que o app nunca teve

Levantado no banco durante a sessão: **não existe deduplicação nenhuma no caminho de upload da
tela.** Subir o mesmo extrato duas vezes dobra a contabilidade. Aguentou porque gente não reenvia sem
perceber; um modelo reenvia, e justamente quando a chamada pareceu falhar e tinha dado certo.

Sem migration — `idx_tx_dedup` já é único em `(data_source_id, external_id)`. Cada linha ganha
`external_id = mcp:sha256(data|valor|sentido|descrição normalizada|conta|ocorrência)`.

**A `ocorrência` é o miolo:** dois cafés de R$ 15 no mesmo dia são dois lançamentos legítimos e
precisam de duas chaves. Numerando as repetições na ordem, o mesmo arquivo reimportado gera as mesmas
N chaves e um arquivo com 3 linhas iguais gera 3 chaves. Sem isso, ou a dedup mataria lançamento de
verdade, ou não existiria.

`ON CONFLICT DO NOTHING` é a segunda barreira, e o relatado é o que **entrou**. Consequência prática:
arquivo grande entra em lotes com a mesma origem, e sobreposição entre lotes não duplica — o teto de
500 linhas vira detalhe de transporte.

#### Detalhes menores

`documents.storage_path` é NOT NULL e não há arquivo: `mcp://<org>/<ts>` é a fachada, e
`deleteDocument` passou a pular a remoção no Storage quando vê esse prefixo — senão cada exclusão
logaria um aviso sobre um arquivo que nunca existiu.

#### Verificação — 116/116, e duas asserções que passavam à toa

Duas falhas eram aritmética minha (esqueci um dos dois cafés de R$ 15 na soma esperada). A terceira
foi mais útil: os testes de recusa usavam `origem: 'x'`, abaixo do mínimo de 2 caracteres — então a
primeira queixa do Zod era sobre a origem, e *"valor negativo é recusado"* passava sem nunca ter
exercitado a regra do valor. Corrigido com uma origem válida, e ganhou um terceiro caso (sentido fora
do enum).

O teste mais importante importa o mesmo arquivo duas vezes (0 novas, 5 já existentes) e depois um
lote de 3 linhas em que 2 se sobrepõem (insere 1, total 6 e não 11).

---

### ✅ Sessão 3.3 (regras) — correções que o próprio MCP encontrou em uso — *commit `a67956c`*

**Como apareceram:** Julio pediu ao claude.ai *"liste as regras da empresa e me diga quais nunca
foram aplicadas"*. O modelo respondeu com três ressalvas, duas certas e uma que ele não tinha como
enxergar.

#### 1. `match_count` nunca teve escritor — o pior dos três

A coluna nasceu na Fase 1 (`db/schema/categorization-rules.ts`) com `DEFAULT 0 NOT NULL` e **nada,
em lugar nenhum do código, jamais a incrementou**. Conferido no banco:

| | |
|---|---|
| Regras no banco inteiro | **518** |
| Com `match_count > 0` | **0** |
| "Empresa Testes 1" | 510 regras, 3 auto-geradas, primeira em 21/mai |

Consequências que estavam no ar: `rules-manager.tsx` mostra `aplicada N×` desde a Fase 6 num badge
que nunca apareceu para ninguém; e `listar_regras`, criada horas antes, publicava o contador como
se fosse dado. O modelo concluiu *"das 500, todas as 500 nunca foram aplicadas"* — aritmeticamente
correto e **vazio**: sairia idêntico se cada regra pegasse mil lançamentos por dia.

**Correção.** `CategorizationResult` ganhou `ruleId`, preenchido só pela camada 1 (`applyRules`
devolve `rule.id`). O job acumula num `Map` durante o bloco e chama `somarMatchCount` uma vez:

```sql
UPDATE categorization_rules AS r
   SET match_count = r.match_count + v.n
  FROM (VALUES (uuid, n), ...) AS v(id, n)
 WHERE r.id = v.id AND r.organization_id = $org
```

Um UPDATE por lançamento seriam 50 idas ao banco por bloco e 7.762 numa importação grande.
`updated_at` fica **de fora**: a tela e o MCP ordenam a lista por ele, e tocá-lo faria toda
importação embaralhar a ordem que a pessoa usa para achar o que editou por último.

`somarMatchCount` mora em `src/lib/rules-write.ts`, não no job — é lógica de regra, e em `/lib` é
exercitável direto contra o banco.

**O passado não volta.** Uma regra da Fase 6 que pegou mil lançamentos continua marcando zero. Daí
`CONTADOR_VIVO_DESDE = '2026-08-24'` (borda conservadora: regra criada mais cedo no mesmo dia ainda
é anterior ao deploy) e o campo `contadorConfiavel` por linha. A ferramenta diz, em letras, para não
concluir que a regra é inútil a partir desse zero. Some sozinho conforme as regras antigas forem
tocadas.

#### 2. `total` mentia

Devolvia `regras.length` — o tamanho da página. O modelo testou com `limite: 1` e recebeu
`total: 1`. Isso é **pior que não ter total**: quem lê conclui que viu tudo, e o número parece
confirmar. Virou `COUNT(*)` de verdade, com `exibidas` separado.

#### 3. Faltava paginação, e o teto mordeu

Teto de 500 sem `offset`. "Empresa Testes 1" tem **510** regras: 10 invisíveis, sem nenhum sinal.
Ganhou `offset`, `temMais` e `avisoPaginacao` dizendo qual offset usar. O `orderBy` ganhou
**desempate por `id`** — um lote de regras nasce no mesmo instante, e `updated_at` empatado faria
páginas repetirem e pularem linhas.

#### Verificação — 98/98

O teste mais valioso prova a cadeia inteira num vão só: regra gravada pelo MCP →
`categorizeTransaction` decidindo por ela na camada 1 (`llmCost` nulo, sem chamar IA) e dizendo
**qual** → `somarMatchCount` subindo o contador. Mais a soma recusada com o id certo e a organização
errada.

**Defeito meu, achado ao escrever isso:** o `sed` de renomeação da sessão anterior deixou uma linha
para trás, e o teste *"a mesma prévia não aplica duas vezes"* estava conferindo a prévia do
**rateio**, não a de regras. Passava pelo motivo errado.

---

### ✅ Sessão 3.3 (regras) — quinto par de escrita + `listar_regras` — *commit `212a370`*

**Arquivo novo:** `src/lib/rules-write.ts`. `src/server/categorization-rules.ts` perdeu ~175 linhas;
`createRule`/`updateRule` viraram casca de três linhas. `validateTargetsBelongToOrg` (55 linhas
escritas por extenso) foi substituída por `validarDimensoes` de `allocations-write.ts` + a checagem
de folha — unificando com o caminho do rateio.

**Ferramentas:** `listar_regras` (leitura), `prever_regras`, `aplicar_regras`.

#### O defeito que o teste achou, e a regra que faltava saber

Uma asserção de "só natureza folha" falhou. Causa: a mesma armadilha do `jaRateado` da sessão do
rateio, agora **medida com `toSQL()`**:

| Onde o `${tabela.coluna}` aparece | O que o Drizzle emite |
|---|---|
| lista do SELECT, consulta **sem** join | `"id"` — **sem qualificar** |
| lista do SELECT, consulta **com** join | `"categories"."id"` |
| cláusula WHERE, **sempre** | `"categories"."id"` |

Dentro de `EXISTS (SELECT 1 FROM categories f WHERE f.parent_id = "id")`, o `"id"` puro é capturado
pelo alias `f` — a correlação vira `f.parent_id = f.id`, nunca verdadeira. Sem erro: só um booleano
constante.

**Estava no ar desde a 3.2:** o campo `atribuivel` de `listar_categorias` vivia `true` para tudo. É
o campo pelo qual o modelo decide o que pode receber lançamento, então o MCP anunciava natureza
**pai** como destino válido. Medido em produção: **152 de 180** naturezas são folha, e a ferramenta
dizia 180.

Correção: `${categories}.id`. A regra completa foi escrita em `src/lib/sql-dimensions.ts`, que já
era onde o projeto documentava essa armadilha. Auditados os outros três sites: `isAllocated` de
`getTransactions` (SELECT com join → seguro), `semRateio` de `transactions-write` (WHERE → seguro),
`dimensionExistsFilter` (WHERE → seguro, e por acidente também porque a view não tem `id`).

#### Decisões do par

- **A prévia conta o ALCANCE.** Regra casa por *trecho*, não por igualdade: `"UBER"` alcança 5
  lançamentos onde `"UBER *TRIP 001"` alcança 1. Sem esse número ninguém enxerga que pediu largo
  demais. Acima de 200, vem aviso. Contado numa consulta só, com `position(lower(v.descricao) in
  lower(t.description))` — literalmente o que `applyRules` faz em JS, e sem tratar `%` da descrição
  como curinga.
- **Piso de 3 caracteres.** A tela aceita 1, inofensivo num formulário; em lote, `"a"` mandaria a
  base inteira para uma natureza só.
- **A assinatura, não só a contagem.** Se alguém criar a mesma regra entre prever e aplicar, um
  `criar` vira `atualizar`: quantidade idêntica, efeito passa a ser **sobrescrever** algo que o
  humano nunca viu. `assinaturaDoPlano` compara `indice:acao:regraExistenteId`. `lancamentosQueCasam`
  fica **fora** da assinatura — muda a cada importação e não altera o que será gravado.
- **Regra não reclassifica o passado**, dito na descrição e no resultado.
- **Linha inválida não derruba o lote** (princípio da 9.5). Das 5 do teste, 4 saíram com motivo:
  natureza pai, sem alvo, duplicata apontando a posição da primeira, dimensão de outra empresa.
- **Só natureza folha agora vale no servidor.** A tela nunca ofereceu outra coisa (`CellCombobox`
  filtra), mas o servidor não conferia — buraco fechado de graça pela unificação.

**Verificação:** 88/88 escrita, 36/36 leitura, 56/56 OAuth.

---

### ✅ Sessão de infraestrutura — a função rodava nos EUA e o banco no Brasil — *deployada*

**Sintoma relatado:** "o app está respondendo muito lento".

**Diagnóstico, em um cabeçalho.** `curl -D -` na produção devolvia:

```
X-Vercel-Id: gru1::iad1::bzztb-...
```

O formato é `<edge>::<função>::<id>`. A requisição **entrava em São Paulo** e era despachada para
**Washington (`iad1`, a região padrão da Vercel)** para renderizar — e a função então conversava com
o Supabase, de volta em São Paulo. Cada consulta atravessava o Atlântico duas vezes.

**O multiplicador:** toda página autenticada faz no mínimo **3 idas sequenciais** ao Brasil antes de
mostrar qualquer coisa — `auth.getUser()` (HTTPS ao Supabase), depois o membership (Postgres), e só
então as consultas de dados. De `iad1` para `sa-east-1` cada ida custa ~110–125ms; três sequenciais
são ~360ms de rede pura por página, morna. Fria, o handshake TLS é mais 3 idas e voltas por conexão.

**Medido antes:** TTFB de `/login` 400–427ms morno, 850ms frio — e `/login` quase não toca o banco.
Ida e volta daqui ao pooler 47ms; abrir conexão do zero ~300ms; trabalho real das consultas
`/transacoes` pág. 1 ≈ 97ms, DRE 12 meses ≈ 52ms, plano de contas ≈ 55ms.

**Correção:** Vercel → Settings → Functions → Function Region → **São Paulo (`gru1`)** + redeploy.

**Medido depois:** `X-Vercel-Id: gru1::gru1::...`, TTFB **258–269ms morno** e **457ms frio**.

**Por que não teve contrapartida:** trocar região normalmente aproxima uns usuários e afasta outros.
Aqui não — o produto é PT-BR, BRL, PME brasileira, e o banco está em São Paulo. Usuário, função e
banco passaram a ficar na mesma cidade. Os jobs Inngest e os crons rodam na mesma região da função,
então o sync do Pluggy, a categorização e a reconciliação ganharam junto.

**Pendência conhecida:** a região foi configurada **no painel da Vercel, não no repositório**. Um
`vercel.json` com `{ "regions": ["gru1"] }` deixaria a escolha versionada — sem ele, um projeto
Vercel recriado do zero volta silenciosamente para `iad1`.

**O que a mudança não conserta:** as três idas sequenciais continuam existindo, só ficaram baratas.
O trabalho das consultas também continua.

---

### ✅ Sessão 10.5 — Modelos de rateio reutilizáveis — *commit `c4616c7`*

**Entregue:**
- [db/migrations/rls/0027_allocation_templates.sql](db/migrations/rls/0027_allocation_templates.sql) — `allocation_templates` + `allocation_template_lines` + `transaction_allocations.allocation_template_id` + 5 índices + RLS (8 policies) + 2 triggers `updated_at`.
- [db/schema/allocation-templates.ts](db/schema/allocation-templates.ts), [src/server/allocation-templates.ts](src/server/allocation-templates.ts) (5 actions).
- [src/components/transacoes-shared/weight-rows-editor.tsx](src/components/transacoes-shared/weight-rows-editor.tsx) — **extraído** do diálogo de lote e reusado pelo editor de modelos.
- [src/components/transacoes-shared/allocation-template-bar.tsx](src/components/transacoes-shared/allocation-template-bar.tsx) — `Aplicar modelo ▾ | Salvar como modelo`, nos dois diálogos de rateio.
- [src/app/(authenticated)/configuracoes/modelos-de-rateio/page.tsx](src/app/(authenticated)/configuracoes/modelos-de-rateio/page.tsx) + [src/components/settings/allocation-template-manager.tsx](src/components/settings/allocation-template-manager.tsx).
- `reduceWeights`, `normalizeWeights`, `formatProportion` em [src/lib/allocation-math.ts](src/lib/allocation-math.ts).

**Defeito encontrado escrevendo o teste, antes de aplicar a migration.** Eu tinha posto
`weight numeric(12,4)`, que comporta 8 dígitos inteiros. Como o diálogo individual salva os
**centavos** do rateio como peso, um lançamento acima de R$ 1 milhão viraria peso 100.000.000 e
estouraria a coluna. Virou `(18,6)`. O mesmo teste motivou `reduceWeights`: sem redução pelo MDC,
quem abrisse o modelo no editor veria campos de peso com "720000" e "480000".

**Verificado:** migration 19/19 com ROLLBACK antes de aplicar, 22/22 conferida contra o banco
depois. Aritmética 19/19, incluindo **2.500 aplicações sobre 500 valores reais** fechando o centavo
exato e o ciclo rateio → modelo → rateio devolvendo as mesmas partes nos 500.

Decisões de desenho em `docs/SCHEMA_DECISIONS.md` Decisão 17.

---

### ✅ Sessão 10.4 — UI do rateio

Diálogo por lançamento (dois campos por parte, valor **e** %, com o valor canônico), linha
expansível em `/transacoes` mostrando as partes, e rateio em lote por proporção com prévia por
lançamento. Atalhos: "Dividir igualmente" e duplo clique no valor para receber o resto.

**Bug de produção, e o mais instrutivo da fase.** Gravar um rateio dava
`Application error: a server-side exception has occurred`. Causa: `toCents` apagava **todos** os
pontos, tratando qualquer texto como formato brasileiro. `transactions.amount` chega do Postgres
como `"467.62"` — ponto DECIMAL — e virava 46.762 centavos. O diálogo passou a exigir partes
somando R$ 46.762,00 num lançamento de R$ 467,62; a validação do servidor concordava (mesma
função, mesmo erro) e só o gatilho do banco percebia, no commit — sem `try/catch`, a exceção subia
crua. Fix: a vírgula desempata (existe → brasileiro; não existe → o ponto é decimal), mais catch
loud em `saveAllocations` repassando a mensagem do `RAISE`. Verificado 13/13, incluindo 300 valores
reais da tabela.

**A falha por trás da falha:** os 19 testes anteriores da aritmética cobriam `'1.234,56'` e números,
e **nenhum** cobria uma string vinda do banco. O caminho banco → diálogo era justamente o não coberto.

---

### ✅ Sessão 10.3 — As leituras passam a respeitar o rateio

Eram **nove** leituras, não sete, e de duas naturezas.

**Analíticas** (DRE, drill-down da DRE, fluxo mensal, drill-down do balanço, drill-down do
dashboard, realizado do Orçado × Realizado, `collectActuals`) trocaram `FROM transactions` por
`FROM transaction_lines`.

**Operacionais** (`/transacoes`, fila de revisão) **não podem** ler a view — listam um lançamento
por linha e a view as multiplicaria. Nelas o filtro virou `dimensionExistsFilter`, um `EXISTS` sobre
a view. Isso conserta dois defeitos que a coluna direta criaria: filtrar "Comercial" **esconderia**
o lançamento rateado para Comercial (com rateio a coluna do pai é nula), e "Sem centro de custo"
pegaria **todo** rateado, inclusive os 100% classificados. A cobertura de dimensão do orçamento
também passou pela view, senão acusaria como "sem CC" justamente quem rateou.

Contagem virou `COUNT(DISTINCT transaction_id)` — o campo promete lançamentos.

**Verificado:** 297 células da DRE idênticas entre a query velha e a nova; com rateio 600/400 o
total da categoria não muda. Custo medido: DRE 0%, filtro de dimensão +8%.

---

### ✅ Sessão 10.2 — Schema do rateio, e a mudança de modelo

O CLAUDE.md registrava rateio como "percentual independente por dimensão", cruzado por uma view.
Ao explicar o desenho para decidir o schema, **o Julio propôs sub-lançamentos** — e dois defeitos do
desenho antigo ficaram visíveis: cruzar 60/40 de centro de custo com 70/30 de contato **inventa** a
célula "Admin + Cliente B", que ninguém afirmou, e a multiplicação das proporções reintroduz fração
de centavo mesmo com cada dimensão fechando exata. O modelo dele foi adotado.

**Soma exata é regra do banco**, num `CONSTRAINT TRIGGER` **deferido até o commit** — `CHECK` enxerga
uma linha por vez e a soma é propriedade do conjunto; deferido, dá para inserir as três partes de
333 uma a uma. O mesmo gatilho cobre apagar parte, editar parte e editar o valor do pai. Com rateio
as dimensões do pai ficam **vazias**, e o gatilho recusa o contrário: preenchidas, toda leitura
ainda não migrada atribuiria o valor **integral** a uma das partes.

**Verificado:** 15/15 rodando a migration dentro de uma transação com ROLLBACK antes de aplicar,
22/22 conferida contra o banco depois. Decisão 16 em SCHEMA_DECISIONS.

---

### ✅ Sessão 10.1 — Contato vira a 4ª dimensão da classificação

**Backend:** lista de contatos no system prompt do Haiku com nome fantasia, documento e papel — o
extrato traz o fantasia muito mais que a razão social; teto de 400 com o corte declarado ao modelo.
Piso de confiança de 70 **só** no contato, a única dimensão que casa contra a descrição do extrato.

**Papel desempata, não veta.** A primeira versão mandava recusar papel divergente; o Haiku ignorou,
e com razão — estorno e devolução a cliente são saídas.

**Dois defeitos que tornavam o resto inerte:** `catConf === 0` **descartava o resultado inteiro**,
jogando fora contato de 95% de confiança; e o `set` fixo do job **apagava com null** toda dimensão
não reconhecida na passada — inclusive classificação manual, porque "Categorizar agora" reprocessa.

**Telas:** coluna, filtro e ordenação em `/transacoes`; quinto campo no batch; filtro + coluna em
`/transacoes/revisao`; alvo de contato nas regras.

**Verificado:** 7/7 casos de classificação contra o banco com Haiku real.

---

### ✅ Sessão 10.0 — Contatos viram cadastro (4a dimensão), parte 1

Primeira sessão da Fase 10. `contacts` existia desde a Fase 1 e **nunca teve uma linha escrita por
código algum** fora do orçamento. A tarefa era fechar a lacuna, não criar a dimensão.

**Entregue:**
- [db/migrations/rls/0025_contacts_dimension.sql](db/migrations/rls/0025_contacts_dimension.sql) — `is_active`, `code`, `is_customer`, `is_supplier`; backfill do papel a partir de `type`; `DEFAULT 'other'` em `type`; índice `idx_contacts_org_active`; **policy de DELETE** (não existia); `ON DELETE SET NULL` nas FKs de `transactions.contact_id` e `categorization_rules.target_contact_id` (eram `no action`).
- [src/server/dimensions.ts](src/server/dimensions.ts) — CRUD completo de contatos no mesmo formato das outras três, `getContactLinkedCount`, e `getContactOptions` agora filtra `is_active` e usa `code` com fallback para `document`.
- [src/lib/sql-dimensions.ts](src/lib/sql-dimensions.ts) — quarta dimensão + conserto do sentinela `__null__` (ver Decisão 15).
- [src/app/(authenticated)/configuracoes/contatos/page.tsx](src/app/(authenticated)/configuracoes/contatos/page.tsx) — rota nova + entrada em `NAV_SECTIONS`.
- [src/components/settings/dimension-manager.tsx](src/components/settings/dimension-manager.tsx) — ganhou `extraFields` e `roleFields`. **Estendido, não duplicado**: contato precisa de documento, e-mail, telefone e o par de papeis, e um segundo gerenciador seria a quinta cópia do mesmo formulário.
- [src/server/imports.ts](src/server/imports.ts) — `previewContactImport` / `commitContactImport` + template `contatos` em `csv-templates.ts`.

**Decisões de desenho:**

**O import de contatos NÃO passa por `previewFlatImport`.** Aquela função é uma especialização de
dois casos (com e sem CNPJ) e já carrega um ramo `withCnpj ? … : …` em cada consulta. Contato tem
três colunas a mais e um par de booleanos; um terceiro ramo tornaria as duas dimensões existentes
ilegiveis por conveniência da terceira. O que é genuinamente comum — `parseCsv`, `assertHeaders`,
`emptyPreview`, os tipos de resultado — continua compartilhado. Efeito colateral bom: a versão de
contatos carrega os existentes em mapas **uma vez**, em vez das três consultas por linha que a flat faz.

**Documento duplicado é barrado na prévia, não na gravação.** O índice único `(organization_id,
document)` rejeitaria a linha no meio do loop de commit, deixando metade do arquivo dentro e metade
fora. A prévia detecta duplicata **dentro do próprio arquivo** e o CRUD traduz a violação 23505 em
mensagem legível.

**`get*LinkedCount` contava dois destinos e devia contar quatro.** Ignorava `budget_series` e
`budget_entries` — subestimava o estrago exatamente na tela que existe para avisar sobre ele.
Unificado em `countLinked`, e o texto do diálogo deixou de dizer "transação(ões)" para dizer
"registro(s) entre lançamentos, regras de categorização e orçamento".

**Verificado contra o banco real** (10.329 lançamentos, 3 organizações): "Sem centro de custo"
executa em vez de lançar; bate com `IS NULL` cru; `com CC + sem CC = total` em contagem e em valor;
`"sem CC" + todos os CCs` devolve o conjunto inteiro (prova de que é disjunção e não conjunção);
filtro vazio não muda nada (sem regressão); a quarta dimensão entra na query sem quebrar.

**Verificado após a migration ser aplicada** (transações revertidas, nada ficou no banco):
as 4 colunas com seus defaults, o índice, as **4 policies** de RLS e `confdeltype = 'n'` nas duas
FKs. E o comportamento que a migration promete: apagar um contato em uso **não é mais bloqueado** —
o lançamento de R$ 1.000 sobrevive com `contact_id` nulo e a regra sobrevive com o alvo zerado.
CNPJ repetido na mesma org viola o índice único com código 23505 (que é o que a action traduz em
mensagem legível), e dois contatos **sem** documento convivem, porque o índice é parcial. O modelo
de CSV baixado passa no próprio `assertHeaders` e todos os papéis do exemplo existem em
`CONTACT_ROLES` — um modelo que falhasse no próprio import seria constrangedor.

**NÃO verificado automaticamente:** o caminho de UI completo (formulário → server action → toast),
porque `getAuthContext` exige sessão de navegador. O que foi exercitado é a camada de banco que
essas actions atravessam.

---

### ✅ Sessão 9.8 — Drill-down do orçado e edição pela DRE

Fecha o ciclo: quem vê o desvio na DRE corrige a previsão ali mesmo, sem trocar de tela.

**Entregue:**
- [src/components/budget/budget-drilldown-dialog.tsx](src/components/budget/budget-drilldown-dialog.tsx) — extraído de `comparacao-tab.tsx`, onde estava embutido. Ganhou um botão de edição por ocorrência.
- [src/components/budget/](src/components/budget/) — `series-dialog.tsx` e `scope-confirm-dialog.tsx` **movidos** de `app/(authenticated)/orcamento/`. A DRE precisa do primeiro, e importar de dentro da pasta de outra rota acoplaria as duas telas — mesmo motivo que criou `components/transacoes-shared/`.
- [src/server/budget.ts](src/server/budget.ts) — `getBudgetSeries(seriesId)`, uma linha só, para abrir a edição a partir de um `seriesId` solto. Delega para `listBudgetSeries` com filtro, para as duas telas mostrarem exatamente os mesmos campos.
- [dre-client.tsx](src/app/(authenticated)/dre/dre-client.tsx) — clique na subcoluna `Orç` (por mês e no Total) abre o diálogo; salvar recarrega a malha.
- [comparacao-tab.tsx](src/app/(authenticated)/orcamento/comparacao-tab.tsx) — migrada para o componente extraído no mesmo commit, e ganhou a edição de brinde.

**Decisões de desenho:**
- **A edição é opcional no componente.** Sem a prop `edit`, o diálogo é somente leitura e a coluna de ação nem aparece — quem embutir isso em outra tela decide.
- **Versão arquivada mostra o motivo em vez de um botão morto.** A action recusaria de qualquer jeito; dizer antes evita o usuário digitar para depois levar erro.
- **`versionId` vem de quem abriu.** `BudgetSeriesListItem` não carrega a versão, e a alternativa — mudar o tipo e a query de listagem — seria mexer em duas telas por um dado que o chamador já tem em mãos.

**Verificação — 6 asserções, todas contra o banco real:**
- **282 células conferidas uma a uma**, somando as **470 ocorrências** que as compõem: a soma do diálogo bate com o valor da célula em todas, sem nenhuma divergente e sem célula sem ocorrência. É a propriedade que sustenta a tela — se a lista somasse diferente do número clicado, o usuário confere uma vez, vê divergir, e não confia em mais nenhum número.
- Integridade do que o botão de edição carrega: nenhuma ocorrência aponta para série inexistente, para série de outra organização, ou para série de outra versão.

`tsc` limpo e `npm run build` verde (`/dre` 7,87 → 8,69 kB; `/orcamento` 29,4 → 21,3 kB com a extração). **Não verificado automaticamente:** o clique na UI — abrir o diálogo, editar e ver a malha atualizar exige sessão autenticada.

---

### ✅ Sessão 9.7 — Orçado lado a lado na DRE

A terceira coluna criada na 9.6 troca de significado: com o orçamento ligado, cada mês vira `Real` · `Orç` · `Var%`, e a AV% dá lugar ao desvio sobre o orçado.

**Entregue:**
- [src/lib/budget-read.ts](src/lib/budget-read.ts) — `fetchBudgetRows` e `fetchForaDoHorizonte`, extraídas de `getBudgetVsActual`. O motivo não é economia de linhas: a conciliação verificada na 9.2 (o orçado da aba bate célula a célula com a DRE) só continua valendo se as duas telas lerem pela **mesma** query.
- [src/server/budget.ts](src/server/budget.ts) — `getBudgetForPeriod(versionId, range, filtros)`, regime fixo em competência, uma query agregada em vez das cinco de `getBudgetVsActual`; `getBudgetVsActual` migrada para a extração no mesmo commit.
- [dre-client.tsx](src/app/(authenticated)/dre/dre-client.tsx) — botão **Orçamento** + seletor de versão na barra de filtros, união realizado ∪ orçado, cascata do orçado no cliente, `MonthCells`/`ThirdCell` cobrindo os dois estados num caminho de código só.
- [dre/page.tsx](src/app/(authenticated)/dre/page.tsx) — carrega `listBudgetVersions()`.

**Decisões de desenho:**
- **Um caminho de código, não dois.** A malha sempre trabalha com um par `{realizado, orcado}`; sem orçamento, `orcado` é 0 e a terceira coluna renderiza AV%. Duas árvores de renderização divergiriam no primeiro ajuste.
- **Filtros idênticos nos dois lados.** As dimensões vão para `getDreData` e `getBudgetForPeriod` no mesmo objeto. Filtrar só o orçado é o que faz a variação parecer melhor do que é.
- **Versão default:** a vigente do exercício do mês inicial; senão a do mês final; senão a mais recente. Versão salva no `localStorage` que foi excluída em `/orcamento` cai de volta no default em vez de quebrar.
- **Aviso de cobertura:** quando o período extrapola o exercício da versão, uma linha em âmbar diz quais meses ficam sem orçado — colunas vazias sem explicação parecem defeito.
- **"Média/mês" some com o orçamento ligado** e volta ao desligar: é diagnóstico do realizado e a tabela já vai a ~3.000px.

**Achado durante a verificação:** havia 12 células "só orçadas" cujo valor era exatamente zero. Vêm por construção do módulo — `shapeMonthly` preenche com zero os meses de buraco de uma série sazonal, e isso vira ocorrência de R$ 0,00 no banco. Sem guarda, elas trariam para a DRE categorias inteiras que não têm nada a mostrar. A união passou a ignorar célula zerada dos dois lados. Célula zerada vinda do **realizado** continua aparecendo: já era o comportamento de hoje (categoria com estorno que zera o mês) e mexer nisso mudaria a tela sem ninguém pedir.

**Verificação — 28 asserções:**
- **Fidelidade da extração:** a query **antiga**, recuperada de `git show 71ff721:src/server/budget.ts`, rodada lado a lado com a nova sobre a versão real — **282 células idênticas**, mesma cauda fora do horizonte, e um recorte parcial (mar–jun) com as mesmas 139 células e nenhum mês vazando. Os dois textos de SQL vêm de fontes diferentes; não é o mesmo texto comparado consigo mesmo.
- **Sinal da variação**, o erro mais provável do módulo: receita acima do previsto positiva, abaixo negativa; **despesa menor que a prevista positiva** (gastei menos = favorável) e maior negativa; orçado zero devolve travessão em vez de `Infinity`. Uma asserção minha estava errada e o código certo: despesa prevista e não realizada dá **+100%**, não −100%.
- **União contra os dados reais:** soma do realizado idêntica antes e depois, nenhuma célula perdida, soma do orçado íntegra, nenhuma célula acrescentada além das que têm valor, e a cascata do orçado batendo com a soma direta por tipo.

`tsc` limpo e `npm run build` verde (`/dre` 6,78 → 7,87 kB; `/orcamento` caiu de 49,3 → 29,4 kB com a extração). **Não verificado automaticamente:** o clique na UI.

---

### ✅ Sessão 9.6 — Terceira coluna da DRE e análise vertical

Primeira das três sessões que põem o orçado dentro da `/dre`. Faz a reestruturação de colunas uma vez, com uma feature clássica de DRE, antes de empilhar o orçado em cima — e por isso é entregável sozinha, sem nenhuma dependência do módulo de orçamento.

**A regra que vale para as três sessões:** cada mês passa a ter uma coluna a mais, que **existe sempre** e troca de significado. Orçamento oculto → `Valor` + `AV%`. Orçamento visível (9.7) → `Real` + `Orç` + `Var%`. A coluna Total segue a mesma regra, e as duas leituras nunca aparecem juntas.

**Entregue:**
- [src/lib/dre-calc.ts](src/lib/dre-calc.ts) — `verticalShare(value, base, signed?)`. Base zero devolve 0, que a célula já renderiza como travessão: nunca `Infinity`, nunca `NaN`.
- [src/components/financial/num-cell.tsx](src/components/financial/num-cell.tsx) — prop opcional `tone: 'sign' | 'muted'`. Aditiva; `/fluxo` e a aba Orçado × Realizado não mudam.
- [src/lib/format.ts](src/lib/format.ts) — `fmtPct` ('30,3%') e `fmtPctSigned` ('+28,8%'), com vírgula decimal PT-BR.
- [dre-client.tsx](src/app/(authenticated)/dre/dre-client.tsx) — `colgroup` e cabeçalho de duas linhas (mês em cima com `colSpan`, `Valor`/`AV%` embaixo), coluna de AV% em linhas de detalhe, de pai e de subtotal.

**Decisões de desenho:**
- **AV% é cinza, não colorida por sinal.** Proporção não é julgamento: pintar "Aluguel = 10,4% da receita" de verde inventaria um sinal que a coluna do valor, ao lado, já diz. Daí o `tone="muted"` no `Num`.
- **Base = Receita Líquida do mês**, que `computeSubtotals` já entrega — a DRE não precisou de nenhum dado novo do servidor. Na coluna Total a base é a soma das Receitas Líquidas do período, não a média das AV%.
- **A coluna de AV% não é clicável.** `Valor` abre as transações; um segundo destino para uma proporção seria adivinhação.

**Achado durante a verificação, e a correção que ele forçou:** rodando contra os dados reais, "Empresa Testes 1" em mai/2026 aparecia com **SGA em 111,6% da receita líquida e EBITDA em 11,6%** — só que esse EBITDA é **negativo**. Em magnitude, uma margem de −11,6% fica idêntica a uma de +11,6%, e a leitura se inverte no exato mês em que o número mais importa.

A correção separa as duas leituras que a AV% tem, que não são a mesma coisa:
- **Linha de conta** é *consumo* — magnitude, do jeito da DRE clássica ("Habitação consome 30,3%").
- **Linha de subtotal** é *margem* — vai com sinal, porque ali o sinal é o recado.

`verticalShare` ganhou o parâmetro `signed`, usado só nas linhas de subtotal.

**Verificação — 25 asserções**, as puras em memória e o resto contra as três organizações reais:
- Bordas: base zero, valor zero, base igual ao valor (100%), despesa negativa saindo positiva sem `signed` e negativa com ele, base negativa, terços sem erro de ponto flutuante, nunca `Infinity` nem `NaN`.
- Nas três orgs: **Receita Líquida = 100,0% em todos os 30 meses com receita**; os 9 meses sem receita mostram travessão em vez de erro; a AV% do Total é finita.
- O caso que motivou o `signed`, testado nos dois sentidos: o mês de EBITDA negativo mostra margem negativa **e** apareceria positivo sem o parâmetro.
- **Aditividade medida, não presumida:** 213 grupos pai→filho batem, 6 não — são os que têm filhos de sinais opostos dentro do mesmo pai (um estorno junto de despesas). É inerente a ler magnitude e está registrado como limitação conhecida, não como bug.

`tsc` limpo e `npm run build` verde (`/dre` de 8,08 → 6,78 kB, porque `fmtPct` saiu para o módulo compartilhado). **Não verificado automaticamente:** o clique na UI.

---

### ✅ Sessão 9.5 — Aceleradores B: planilha e recorrências detectadas

Fecha a Fase 9. Os dois caminhos que faltavam para preencher um orçamento sem digitar lançamento a lançamento.

**Entregue:**
- [src/lib/budget-import.ts](src/lib/budget-import.ts) — puro. `parseBudgetCsv(texto, mapas, exercício)` devolve prévia e lançamentos; `buildRecurrenceCandidates` e `recurrenceToDraft` convertem a detecção do `/fluxo`; `timesPerMonth` faz a conversão dias → mês.
- [src/server/budget.ts](src/server/budget.ts) — `previewBudgetCsv`, `importBudgetCsv`, `getRecurrenceCandidates`, `acceptDetectedRecurrences`.
- [src/lib/csv-templates.ts](src/lib/csv-templates.ts) — `BUDGET_CSV` (obrigatórias × opcionais), `buildBudgetTemplateCsv`, e `downloadCsv` genérico com `downloadTemplate` passando a usá-lo.
- [import-csv-dialog.tsx](src/app/(authenticated)/orcamento/import-csv-dialog.tsx) e [recurrences-dialog.tsx](src/app/(authenticated)/orcamento/recurrences-dialog.tsx).
- [orcamento-client.tsx](src/app/(authenticated)/orcamento/orcamento-client.tsx) — os três aceleradores passaram para um menu **Preencher**, cada item com uma linha dizendo o que faz. Guarda comum (`openFiller`): exige versão e recusa versão arquivada.

**Decisões de desenho:**
- **Planilha em grade de 12 meses** (categorias nas linhas, meses nas colunas), não uma linha por ocorrência. É o formato que já existe na mesa do cliente, e uma linha por ocorrência explodiria 12× o que o módulo trata como um lançamento só.
- **`categoria` casa por código ou por nome.** Homônimo não escolhe sozinho: recusa a linha listando os códigos disputantes. Categoria desativada também é recusada — o lançamento nasceria impossível de editar depois.
- **Linha inválida não derruba o arquivo.** Ela aparece na prévia com o motivo e o número da linha da planilha, e é a única de fora. Importar 48 de 50 é mais útil do que recusar as 50 por causa de duas. Cabeçalho errado, sim, invalida tudo — não há como adivinhar de que mês é uma coluna sem nome.
- **Pontas aparadas, buracos preservados** — mesma regra da cópia, via a `shapeMonthly` extraída da 9.4. Quem só tem valor em nov e dez gera duas ocorrências, não doze; quem tem jan e mar gera três, com fevereiro zerado.
- **Mensalização das recorrências.** A detecção do `/fluxo` trabalha em dias (aceita 7 a 40) e o orçamento em meses. Copiar o valor médio direto seria caro: uma recorrência semanal de R$ 100 viraria R$ 100/mês em vez de R$ 400. `timesPerMonth` usa inteiro (`round(30/dias)`) de propósito — "a cada 7 dias, 4× por mês" o usuário confere de cabeça, 4,35 não.
- **Categoria obrigatória nas recorrências**, porque a detecção agrupa por descrição e não conhece plano de contas. O botão fica travado enquanto houver selecionada sem categoria, e o rodapé diz quantas são.
- **Recorrência fora do exercício aparece bloqueada, não some** — sumir faria o usuário procurar por que a lista está menor do que a do `/fluxo`. Já aceita idem, marcada.
- **`applyCopyToBudget` virou `applyDraftsToBudget(source)`** e a substituição passou a apagar só o que veio da mesma origem: reimportar a planilha não pode levar junto o que foi copiado do realizado nem o que foi digitado à mão.
- **`normalizeAmount` movido**, não copiado, de `parsers/excel-csv.ts` para `format.ts` como `parseAmount` — seria a segunda cópia, e o arquivo de origem carrega o SDK da Anthropic.

**Verificação — 64 asserções**, as puras em memória e a gravação contra o banco real em transações revertidas:
- Planilha: grade de 12 vira lançamento único; pontas aparadas (nov+dez → 2 ocorrências); buraco no meio vira zero e não corta a série; `1.234,56`, `1,234.56` e `R$ 1.234,56` leem o mesmo número; direção deduzida do tipo da categoria quando falta a coluna; as três dimensões resolvidas por nome.
- Erros: linha ruim não derruba o arquivo (2 válidas + 1 inválida, com o número da linha certo); homônimo recusado listando os dois códigos; desativada recusada; negativo recusado explicando que o sinal vem da coluna `tipo`; linha vazia; dimensão inexistente nomeada; três formas de cabeçalho inválido.
- Recorrências: conversão dias→mês nos sete casos de borda; candidata mensal; **semanal mensalizada (100 → 400)**; bloqueio para fora do exercício e ancoragem em janeiro para antes dele; já aceita marcada com chave insensível a acento e caixa; dia 31 limitado a 28 para fevereiro não sumir.
- Gravação: import grava com `source = 'csv'` e expande as ocorrências certas, nenhuma nascendo ajustada; **substituir apaga só a origem igual** (manual e cópia sobrevivem, sem ocorrência órfã); recorrência semanal de R$ 100 aceita em maio vira R$ 3.200 no ano (400 × 8 meses).
- **Regressão:** a suíte inteira da 9.4 (66 asserções) rodada de novo depois da extração de `shapeMonthly` e da renomeação da gravação — verde.

`tsc` limpo e `npm run build` verde (`/orcamento` de 46,1 → 51,3 kB). **Não verificado automaticamente:** o clique na UI.

---

### ✅ Sessão 9.4 — Aceleradores A: copiar do realizado e duplicar versão

Os dois caminhos que tiram o usuário da folha em branco. Montar um orçamento anual lançamento a lançamento é o que faz o módulo ser abandonado na primeira semana.

**Entregue:**
- [src/lib/budget-copy.ts](src/lib/budget-copy.ts) — o miolo, fora de `'use server'` pelo mesmo motivo da 9.3. `buildCopyDrafts` é puro (agrupa o realizado e escolhe o formato da série); `collectActuals` e `countCopiedSeries` recebem o executor (`db` ou `tx`); `applyCopyToBudget` e `applyDuplicateVersion` recebem o `tx`.
- [src/server/budget.ts](src/server/budget.ts) — `previewCopyActuals`, `copyActualsToBudget` e `duplicateBudgetVersion`, todas invólucros finos (auth → validação → miolo → revalidate).
- [src/lib/budget-types.ts](src/lib/budget-types.ts) — `COPY_SHAPES` / `COPY_GRANULARITIES` com rótulos e explicações, `copyActualsInputSchema`, `duplicateVersionInputSchema`, `CopyActualsPreview`.
- [copy-actuals-dialog.tsx](src/app/(authenticated)/orcamento/copy-actuals-dialog.tsx) — prévia+commit: período, regime, formato, detalhamento e percentual; "Ver prévia" lista os lançamentos com realizado → orçado lado a lado; qualquer mudança de parâmetro invalida a prévia.
- [versoes-tab.tsx](src/app/(authenticated)/orcamento/versoes-tab.tsx) — botão Duplicar por versão, com aviso do deslocamento de datas quando o exercício muda.
- [planejamento-tab.tsx](src/app/(authenticated)/orcamento/planejamento-tab.tsx) — badge de origem (`BUDGET_SOURCE_LABELS`) nas séries não-manuais; `EmptyState` passa a oferecer "Copiar do realizado" como ação.

**Decisões de desenho:**
- **Dois eixos, não um.** O plano falava em `granularity`; virou **formato** (mês a mês × média mensal) e **detalhamento** (categoria × categoria+dimensões). Um parâmetro só misturaria tempo com dimensão e viraria adivinhação na hora de usar.
- **Mapeamento por número do mês**, não por posição: março de origem vira março do exercício, mesmo que o período comece em julho. É daí que sai o teto de 12 meses — com 13, dois janeiros disputariam o mesmo alvo e o valor dobraria em silêncio.
- **Direção entra na chave de agrupamento.** Compensar entrada com saída na mesma categoria produziria meses de sinal trocado, e uma série tem uma direção só com valor sempre positivo. Categoria com estorno gera dois lançamentos — que é a verdade do histórico.
- **Mês a mês apara as pontas** (começa no primeiro mês com movimento) e preenche buracos internos com zero. **Valores todos iguais viram `fixo`**, não `sazonal` com N campos repetindo o mesmo número.
- **`adjustmentPct` não vira `adjustment_rate`.** Um é aplicação única sobre o valor copiado; o outro é o reajuste que se acumula ao longo do ano. Documentado nos dois arquivos porque é a confusão mais provável.
- **Exclusões declaradas, não silenciosas.** Sem categoria e categoria inativa saem da cópia (a segunda porque a tela de edição recusaria salvar um lançamento nelas depois) e voltam como número na prévia. Ocultas, BP e `pending` seguem as mesmas regras da `getBudgetVsActual`.
- **Teto de 300 lançamentos** falha com o número na mensagem em vez de cortar em silêncio.
- **`mapped AS MATERIALIZED`** na duplicação: sem isso o `gen_random_uuid()` seria reavaliado na segunda referência do CTE e as ocorrências apontariam para séries inexistentes. `make_interval(years => delta)` desloca e já apara 29/02. O **prazo de caixa é preservado em dias**, não deslocado por ano — o lag é a regra de negócio, a data é consequência.
- **Duplicar nunca destrona** a versão vigente do exercício de destino, e nasce como rascunho.

**Verificação — 66 asserções**, as puras em memória e as demais contra o banco real em transações revertidas, chamando as mesmas funções da action:
- Moldagem: sazonalidade preservada com zero no meio, pontas aparadas, valores iguais virando `fixo`, +8% aplicado uma vez, média achatando em 12, entrada/saída não se compensando, os dois detalhamentos.
- Leitura: sem categoria, oculta, inativa, BP e `pending` fora da soma — as duas primeiras declaradas em números próprios; competência e caixa lendo datas diferentes.
- **DoD:** copiar 12 meses de 2026 → orçado 2027 com +8% grava no banco exatamente `realizado × 1,08` nas duas direções, com `source = 'copia_realizado'`, começando em jan/2027, e **nenhuma ocorrência nascendo ajustada**.
- Substituir cópia anterior remove só o que veio de cópia — o lançamento manual da mesma versão continua lá, sem ocorrência órfã.
- **Duplicação preserva `adjusted_fields` e `sequence`** (inclusive o buraco de uma exclusão pontual), o valor ajustado à mão, o array sazonal, as dimensões e a observação; desloca competência por ano e caixa por dias; 29/02/2028 → 28/02/2029; delta 0 não move nada e a origem fica intacta; nenhuma ocorrência cai na série errada (o cruzamento que pegaria um mapa old→new embaralhado).

`tsc` limpo e `npm run build` verde (`/orcamento` de 42,2 → 46,1 kB). **Não verificado automaticamente:** o clique na UI.

---

### ✅ Sessão 9.3 — Escopos de edição e exclusão

Remove a limitação da 9.1, em que editar uma série regenerava tudo e descartava os ajustes manuais.

**Entregue:**
- [src/lib/budget-scope.ts](src/lib/budget-scope.ts) — o miolo da sessão. `planSeriesUpdate` (pura) decide o que aconteceria; `applySeriesUpdate` e `applySeriesDelete` executam recebendo o `tx`. Vive fora de `'use server'` deliberadamente: a diretiva não deixa exportar função síncrona, e — mais importante — assim o núcleo pode ser exercitado direto contra o banco num teste, sem sessão HTTP.
- [src/server/budget.ts](src/server/budget.ts) — `updateBudgetSeries(seriesId, input, { scope, fromSequence, overwriteAdjusted })`, `previewSeriesUpdate`, `previewSeriesDelete` e `deleteBudgetSeries(seriesId, { scope, fromSequence })`. As actions ficaram invólucros finos: auth → validação → plano → porta de confirmação → transação.
- [scope-confirm-dialog.tsx](src/app/(authenticated)/orcamento/scope-confirm-dialog.tsx) — two-phase sem action extra: a própria action de salvar devolve `{ needsConfirm: preview }` em vez de executar, o cliente abre o diálogo e re-submete com `overwriteAdjusted`.
- [series-dialog.tsx](src/app/(authenticated)/orcamento/series-dialog.tsx) — seletor dos três escopos (com a explicação de cada um) e seletor da ocorrência âncora, carregada sob demanda.
- [planejamento-tab.tsx](src/app/(authenticated)/orcamento/planejamento-tab.tsx) — excluir uma ocorrência agora pergunta o alcance: só ela, ou dela em diante.

**Semântica implementada:**
- **'esta'** — só a ocorrência âncora; a regra nunca é tocada; os campos alterados passam a divergir dela e viram `adjusted_fields`.
- **'daqui'** — ocorrências de `sequence >= âncora`; a regra também não é tocada. **Não faz split da série** (o padrão de agenda): split mostraria duas linhas onde o usuário criou uma. Preço aceito: uma edição posterior de "toda a série" precisa de `overwriteAdjusted` para retomar. A partir da primeira ocorrência, 'daqui' equivale a 'todas'.
- **'todas'** — regra + ocorrências, com truncar (`DELETE sequence > N`, nunca regenerar), anexar (expoente do reajuste pela sequência absoluta) e deslocar datas preservando identidade.
- **Mudança estrutural promove o escopo sozinha.** Não existe "mudar a periodicidade só deste mês"; o preview avisa que o escopo foi ajustado.
- **Exclusão:** 'esta' não mexe na regra (a sequência fica com buraco, por design); 'daqui' trunca `occurrences` para `âncora − 1`.
- **Confirmação lista os meses**, não só a contagem, e o checkbox de sobrescrita nasce desmarcado a cada abertura.

**Bug encontrado ao desenhar o teste, antes de rodar:** em escopo parcial, o valor gravado nas ocorrências vinha da expansão da regra **antiga**, não do que o usuário tinha digitado — trocar o valor "só deste mês" não mudaria nada. A correção separa duas expansões com papéis distintos: `writeDrafts` (o que o usuário pediu, é o que se grava) e `ruleDrafts` (o que a regra vigente geraria, é o baseline do `adjusted_fields`). Em escopo 'todas' as duas coincidem; em escopo parcial é justamente a diferença entre elas que faz o valor gravado constar como ajuste manual.

**Verificação — 52 asserções contra o banco real**, cada caso numa transação revertida, chamando as mesmas funções que a action chama e conferindo o resultado **lendo o banco**:
- `'esta'` alterando valor: a regra não muda, só a ocorrência 3 recebe 15.000 e fica marcada, as vizinhas ficam intocadas e o ajuste prévio da 7 sobrevive.
- `'daqui'` trocando centro de custo a partir da 5: a regra mantém o CC antigo, 1–4 intocadas, 5–12 com o CC novo e marcadas.
- `'daqui'` a partir da 1: promovido a 'todas', regra atualizada, nenhuma ocorrência marcada.
- Truncar 12→6: preview lista as 6 que somem e avisa que Jul/27 tinha ajuste; sobram as sequências 1–6 com valores intocados.
- Estender 6→12: anexa 6, sequências contínuas, ajuste da 3 preservado, nova ocorrência 12 em dez/27.
- **Deslocar jan→mar: nada é recriado, as datas andam e o `adjusted_fields` da ocorrência 3 NÃO é zerado** — o caso que a Decisão 13 chama de "o modo que apaga trabalho em silêncio".
- `overwriteAdjusted`: a ocorrência 7 recebe o valor da regra e a **auto-cura** limpa a marca; sem a flag, ela mantém 13.500 e as outras 11 recebem 15.000.
- Exclusões: `'esta'` deixa buraco na sequência e não mexe em `occurrences`; `'daqui'` trunca para 4; `'daqui'` da primeira apaga a série e o CASCADE leva as ocorrências.

`tsc` limpo e `npm run build` verde (`/orcamento` em 42,2 kB). **Não verificado automaticamente:** o clique na UI.

---

### ✅ Sessão 9.2 — Aba Orçado × Realizado (primeiro uso real do módulo)

**Entregue:**
- [src/server/budget.ts](src/server/budget.ts) — `getBudgetVsActual` (5 queries em `Promise.all`) e `getBudgetDrillDown`.
- [src/server/dre.ts](src/server/dre.ts) — `getDreDrillDown` ganhou 5º parâmetro opcional `regime` (aditivo, retrocompatível): sem ele filtra por `t.date` como sempre; com `'caixa'` filtra por `COALESCE(effective_date, date)`, necessário para o drill-down da comparação em regime de caixa.
- [comparacao-tab.tsx](src/app/(authenticated)/orcamento/comparacao-tab.tsx) — matriz 12 meses Tipo→Pai→Filho no molde da DRE, toggle Competência/Caixa, seletor de modo de célula (Orçado / Realizado / Variação R$ / Variação %), colunas fixas Orçado ano · Realizado YTD · Projeção ano · Var. proj., e drill-down duplo.

**Extrações (movidas, não duplicadas), com `/dre` e `/fluxo` migrados no mesmo commit:**
- [src/lib/dre-layout.ts](src/lib/dre-layout.ts) — `LAYOUT`, `BELOW_LAYOUT` e `buildBlocks` agora **genérico no valor da célula**: a DRE passa `r => r.netAmount`, a comparação passa `r => ({ orcado, realizado })`. Sem isso a árvore teria que ser reimplementada.
- [src/components/financial/num-cell.tsx](src/components/financial/num-cell.tsx) — o `Num` estava duplicado com uma diferença sutil: a DRE apaga o zero em `/25` ou `/40` (prop `light`), o fluxo usa `/30` fixo. O componente compartilhado ganhou `zeroClassName`, e o `/fluxo` mantém um wrapper local de 3 linhas que fixa o tom — assim nenhuma das duas telas mudou de aparência.
- [src/components/transacoes-shared/dim-filter.tsx](src/components/transacoes-shared/dim-filter.tsx) — com a opção nova `allowNone` (sentinela `__null__`), usada só na comparação.

**Decisões de implementação:**
- **União, não interseção.** A matriz é a união das chaves dos dois lados. Categoria orçada sem realizado ("não gastei") e realizada sem orçado ("gasto não previsto") são as duas descobertas mais valiosas da tela; a interseção esconderia exatamente as duas.
- **Sinal.** Com `netAmount`, `realizado − orcado` já é "favorável quando positivo" para receita **e** para despesa — gastar 8 mil de um orçamento de 10 mil dá `(−8000) − (−10000) = +2000`. Documentado no topo de `budget.ts` e do tab, porque o erro clássico é inverter o sinal por tipo de conta.
- **Variação % nunca é `Infinity`.** Com `orcado = 0` a célula mostra travessão.
- **Corte da projeção.** "Mês fechado" = mês estritamente anterior à data de corte, exposta como `<input type="month">` "Fechado até" (default: mês anterior ao corrente). Não é "mês com dado" — um lançamento retardatário em novembro marcaria novembro como fechado e truncaria a projeção. O mês corrente nunca é dividido: está inteiro de um lado ou do outro, que é a única forma de eliminar dupla contagem. A projeção é calculada **no cliente**, então arrastar o corte recalcula sem refetch.
- **Subtotais rodam `computeSubtotals` três vezes** — sobre projeções orçado, realizado e mista — o que mantém a cascata (EBITDA, LAIR, Lucro Líquido) consistente com as linhas de detalhe por construção.
- **Três avisos de honestidade.** (1) O INNER JOIN em `categories` é mantido para o número bater com a `/dre`, e o realizado sem categoria vem numa query escalar à parte, exibido em banner. (2) A cobertura de dimensão é medida **sem** os filtros de dimensão — com eles daria 100% por construção, que é justamente a ilusão que o número existe para furar; abaixo de 90% aparece `PartialDataBanner`. (3) O orçado cuja data cai fora do exercício (cauda de caixa) vira o escalar `foraDoHorizonte` no rodapé.
- **Drill-down duplo.** A célula abre o drill-down daquilo que está exibindo: modo Orçado abre as ocorrências orçadas; os demais abrem o `DrillDownDialog` de transações com o regime correto.

**Verificação:**
- `tsc` limpo; `npm run build` verde (30 rotas, `/orcamento` em 37,8 kB).
- **Conciliação contra os dados reais dos 3 clientes do banco** (somente leitura). Primeira tentativa foi descartada por ser tautológica — eu havia escrito o mesmo texto SQL dos dois lados. Refeita com o texto **verbatim de arquivos diferentes**: `getDreData` vs o lado realizado de `getBudgetVsActual` (competência), e `getFluxoMensalData` vs o mesmo em caixa. Os textos diferem em SELECT, GROUP BY e colunas, então a igualdade é verificação de verdade. Resultado: soma igual, **quantidade de células igual** e **cada célula batendo uma a uma** (440, 235 e 74 células), nos dois regimes, mais a checagem de que SG&A sai negativo.
- Observação sobre os dados: em "Vieira Pisos" o regime de caixa devolve 1 célula contra 440 de competência — quase todo o plano de contas dessa org está com `hide_in_cashflow = true`. É configuração pré-existente e o `/fluxo` já se comportava assim; não veio desta sessão.
- **Não verificado automaticamente:** o comportamento de clique da UI (exige sessão autenticada).

---

### ✅ Sessão 9.1 — CRUD de versão e série + aba Planejamento

**Entregue:**
- [src/server/budget.ts](src/server/budget.ts) — 13 server actions. Versões: `listBudgetVersions` (com contagens e totais por subquery), `createBudgetVersion`, `setActiveBudgetVersion`, `updateBudgetVersionStatus`, `deleteBudgetVersion`. Séries: `listBudgetSeries`, `getBudgetSeriesEntries`, `createBudgetSeries`, `updateBudgetSeries`, `deleteBudgetSeries`. Ocorrências: `updateBudgetEntry`, `deleteBudgetEntry`.
- [src/server/dimensions.ts](src/server/dimensions.ts) — `getContactOptions()` (não existia nenhuma listagem de contatos no projeto).
- Rota `/orcamento`: [page.tsx](src/app/(authenticated)/orcamento/page.tsx), [orcamento-client.tsx](src/app/(authenticated)/orcamento/orcamento-client.tsx) (shell de abas + seletor de versão), [planejamento-tab.tsx](src/app/(authenticated)/orcamento/planejamento-tab.tsx), [series-dialog.tsx](src/app/(authenticated)/orcamento/series-dialog.tsx), [versoes-tab.tsx](src/app/(authenticated)/orcamento/versoes-tab.tsx). Item `Orçamento` (ícone `Target`) no `NAV` da sidebar, depois de Fluxo de Caixa.
- [src/lib/format.ts](src/lib/format.ts) — antecipado da 9.2 porque `budget-recurrence.ts` já precisava de `monthLabel` e criar uma segunda cópia contrariaria o objetivo da extração. `budget-recurrence` passou a importar de lá.

**Decisões de implementação:**
- **Preview ao vivo no dialog.** `expandSeries` roda no cliente a cada tecla e renderiza a tabela de ocorrências (competência, caixa, valor) com o total do ano ao lado do formulário. É o que torna os 4 modos compreensíveis: o usuário vê os 4 patamares do reajuste e os centavos da última parcela antes de salvar, em vez de descobrir depois.
- **Direção deduzida da categoria.** Escolher uma folha de `receita_operacional` marca Entrada; qualquer outra marca Saída. Só até o usuário tocar no seletor — a partir daí a escolha dele manda.
- **Cauda de caixa visível.** Datas de caixa que caem fora do exercício aparecem em âmbar no preview e na lista de ocorrências, com uma linha explicando que é esperado quando há prazo. Sem isso, pareceria bug.
- **`entryCount` vs `occurrences`.** A tabela mostra sempre o count real de entries; quando diverge da regra (após exclusão pontual), aparece um `≠12` discreto com tooltip. É a materialização da divergência aceita na Decisão 13.2.
- **`updateBudgetSeries` regenera tudo** — apaga as ocorrências e recria. Limitação temporária documentada no próprio arquivo; o dialog avisa quantos ajustes manuais serão perdidos. A 9.3 substitui pelos três escopos.
- **Versão arquivada é somente-leitura** na action (`loadEditableVersion`) e na UI (botões desabilitados + aviso na zona 2).
- **Chave de storage.** O shell usa `lure:orcamento:filters` (versão + aba) e a tabela usa `lure:orcamento:planejamento:filters` (filtros de coluna), para um não sobrescrever o outro.

**Verificação:**
- `npx tsc --noEmit` limpo; `npm run build` verde (30 rotas, `/orcamento` em 31,4 kB).
- **Teste de integração contra o banco real** (transação revertida no final): semeia org, plano de contas, versão e 3 séries (fixo 12×, reajuste 5% a cada 6 de 12×, parcelado 1000/3), ajusta uma ocorrência à mão e roda as 3 queries cruas verbatim. 20/20. Confirmou o que o type-check não vê: nenhum erro de coluna/join, `annual_total` = 145.500 (com o ajuste manual, não os 144.000 da regra — a invariante "entries são a verdade" vale de fato), parcelado somando exatamente 1000, lag de 30 dias levando dez/27 para 04/01/2028, e `adjusted_fields` voltando como array.
- **Não verificado automaticamente:** o fluxo de clique na UI, que exige sessão autenticada no browser. Roteiro manual entregue ao usuário.

---

### ✅ Sessão 9.0 — Fundação do módulo de Orçamento (schema + expansão de recorrência + extrações)

**Contexto:** o produto só olhava para trás. DRE, Balanço e Fluxo consolidam o que aconteceu; não havia como declarar o que deveria acontecer, logo não havia variação nem resposta para "vamos fechar o ano dentro do previsto". A projeção do `/fluxo` era puramente estatística (recorrências detectadas em 180 dias), sem intenção humana. A Fase 8 (adquirentes) foi pausada em 8.1 para abrir esta.

**Desenho fechado com o usuário antes de codar** (4 rodadas de perguntas + revisão adversarial do desenho): duas datas por lançamento (competência + caixa); unidade = lançamento com recorrência (não célula de planilha); versões nomeadas com uma vigente por exercício, duplicação servindo revisão e cenário; tabelas separadas de `transactions`; tudo é previsão (sem título firme — contas a pagar/receber fica para módulo futuro); horizonte = ano civil; 4 modos de valor e 4 formas de popular; rota `/orcamento` com abas, DRE e Fluxo intactos; 3 escopos de edição; coluna "Projeção do ano". Plano completo em `.claude/plans/`.

**Cinco correções estruturais adotadas na revisão do desenho inicial:**
- `interval_months int` no lugar de um enum de frequência (matava um valor "único" redundante com `occurrences = 1` e um mapa enum→meses).
- `adjusted_fields text[]` no lugar de `is_adjusted boolean` — granularidade por campo; sem isso, uma ocorrência ajustada só no valor bloquearia alteração em lote de centro de custo.
- `total_amount` separado de `base_amount` — depois de expandir, não haveria como saber se 1.200 era a parcela ou o total.
- `start_month date` no lugar de texto `'YYYY-MM'` — duplicação de versão e copiar-do-realizado fazem aritmética SQL de data.
- Ordem das sessões trocada: a tela de comparação (9.2) passou à frente dos escopos de edição, para não digitar orçamento por 3 sessões antes de validar o schema contra uma tela que consome.

**Entregue:**
- [db/migrations/rls/0024_budget.sql](db/migrations/rls/0024_budget.sql) — `budget_versions`, `budget_series`, `budget_entries`; índices (incluindo `UNIQUE (series_id, sequence)` como rede contra duplo clique, único parcial de versão vigente por exercício, e índice parcial das ocorrências ajustadas); CHECKs de coerência entre `amount_mode` e os campos que ele exige; 12 policies RLS no padrão nomeado; **3 triggers `update_updated_at()`** — corrigindo a lacuna que as migrations 0022 e 0023 deixaram.
- [db/schema/budget-versions.ts](db/schema/budget-versions.ts), [db/schema/budget-series.ts](db/schema/budget-series.ts), [db/schema/budget-entries.ts](db/schema/budget-entries.ts) + barrel.
- [src/lib/budget-types.ts](src/lib/budget-types.ts) — constantes com rótulos PT-BR, schemas Zod (com `superRefine` espelhando os CHECKs do banco), tipos de leitura.
- [src/lib/budget-recurrence.ts](src/lib/budget-recurrence.ts) — `expandSeries` **pura** (fora de `'use server'` de propósito: é o que permite o preview ao vivo das ocorrências dentro do dialog, sem o qual os 4 modos de valor são incompreensíveis no formulário).

**Extrações — movidas, não duplicadas** (o módulo seria a 4ª cópia): `computeSubtotals`/`sumByTypes`/`generateMonthRange` → [src/lib/dre-calc.ts](src/lib/dre-calc.ts); trio de filtros de dimensão → [src/lib/sql-dimensions.ts](src/lib/sql-dimensions.ts); `getAuthContext` → [src/lib/auth-context.ts](src/lib/auth-context.ts) (usado só por `budget.ts` — migrar as 8 cópias antigas seria refactor horizontal de risco). `dre.ts` e `fluxo-mensal.ts` migrados no mesmo commit. `computeSubtotals` ganhou o tipo mínimo `SubtotalRow` para que a 9.2 passe projeções (orçado/realizado/misto) sem fabricar campos que não usa.

**Verificação:**
- `npx tsc --noEmit` limpo; `npm run build` verde (29 rotas).
- 20/20 casos de `expandSeries` conferidos: os 4 modos; `1000/3` = `[333.33, 333.33, 333.34]` somando exatamente 1000,00; reajuste de 5% a cada 3 ocorrências gerando 4 patamares sempre a partir do valor base (não iterativo, evita drift); dia 31 clampado por mês (jan 31 / fev 28 / mar 31 / abr 30) e 29 em fevereiro bissexto; trimestral jan/abr/jul/out; lag de 30 dias atravessando o ano (competência 20/dez/27 → caixa 19/jan/28) sem invalidar a série.
- SQL de `dimensionFilters` renderizado via `PgDialect` e conferido idêntico ao inline anterior: `AND t.cost_center_id IN ($n::uuid, ...)`, ids parametrizados, array vazio equivalente a ausente, troca de alias `t`→`e` funcionando.

**Migration aplicada no Studio sem erro.**

**Descoberta ao validar:** rodar `test_rls_isolation.sql` (o harness da Fase 1.8) falhava com `relation "fixed_assets" does not exist` — nada a ver com a 0024. O script testa 18 tabelas, das quais 4 (`fixed_assets`, `loans`, `equity_movements`, `inventory_snapshots`) foram dropadas pela migration 0015 no redesign do BP. Ou seja, o único harness de regressão de RLS do projeto estava morto desde a 0015 e ninguém tinha notado. Também carregava valores de enum antigos: `categories.type = 'expense'` e `transactions.direction = 'out'`, ambos inválidos hoje.

**Corrigido nesta sessão:**
- [db/migrations/rls/test_rls_budget.sql](db/migrations/rls/test_rls_budget.sql) — novo, dedicado à 0024. Vai além do isolamento: confere as 3 tabelas com RLS habilitada, as 12 policies e os 3 triggers `updated_at`; prova que o trigger dispara (antedatando `updated_at`, já que `now()` é fixo dentro da transação); e testa que os CHECKs rejeitam o que devem — 2ª versão vigente no mesmo exercício, nome duplicado ignorando caixa/espaços, versão arquivada marcada como vigente, `start_month` fora do dia 1, sazonal com array de tamanho diferente de `occurrences`, parcelado sem `total_amount`, reajuste sem `adjustment_rate`, `amount` negativo, `sequence` duplicada na mesma série, e delete de categoria com orçado (RESTRICT). Testa também o caso que **deve passar**: `cash_date` fora do exercício (a cauda de caixa). Fecha com isolamento de leitura e de escrita cruzada.
- [db/migrations/rls/test_rls_isolation.sql](db/migrations/rls/test_rls_isolation.sql) — removidos os 4 blocos de tabelas inexistentes (18 → 14 tabelas) e corrigidos os dois valores de enum. Voltou a rodar.

---

### ✅ Sessão de fix do connect Pluggy — credenciais contaminadas por caractere invisível — *commit `602a6cd`, deployada*

**Contexto:** usuário reportou que em produção (Vercel) clicar em "Conectar conta" no Pluggy falhava com toast "Não foi possível iniciar a conexão. Verifique as configurações do Pluggy." Console do browser mostrava `POST /contas 500`. Local funcionava.

**Diagnóstico (via Vercel CLI):**
- `vercel env ls production` confirmou que `PLUGGY_CLIENT_ID`/`SECRET`/`ENVIRONMENT` **estão setadas** — não era variável faltando.
- `vercel env pull` retorna vazio pra vars marcadas como "Sensitive" (Anthropic, DB, Supabase URL também vieram vazias mas funcionam) — inconclusivo pra ler valor.
- `vercel logs <deployment>` capturou o erro real de runtime: `et [HTTPError]: Response code 400 (Bad Request)`, `code: 'ERR_NON_2XX_3XX_RESPONSE'` (erro do `got`, lib HTTP do `pluggy-sdk`) no `POST /contas`. **Não era BOM/ByteString** (que seria erro de header) — era um **400 da própria API da Pluggy**.
- Reprodução 1:1 com as credenciais **locais** (que são válidas) contra `https://api.pluggy.ai/auth`:
  - credencial limpa → **HTTP 200** `{apiKey:...}`
  - `clientId + "\n"` → **HTTP 400** `{"message":"clientId must be a UUID","code":400}`
  - `clientId + BOM` → **HTTP 400** idem
- **Causa raiz:** o `PLUGGY_CLIENT_ID` (e/ou `SECRET`) na Vercel tem um caractere invisível (newline/BOM/zero-width) colado junto. A Pluggy valida que o `clientId` é UUID e rejeita com 400 → `got` lança `HTTPError` → server action `generateConnectToken` propaga → 500. Mesma classe do incidente de BOM na `ANTHROPIC_API_KEY` (`2bd4cf1`), mas manifesta como 400 da API em vez de `TypeError: ByteString` porque a credencial vai no corpo JSON, não em header.

**Fix (`602a6cd`):**
- [src/lib/pluggy.ts](src/lib/pluggy.ts) — novo `sanitizeSecret()` apara das pontas: controle/whitespace (≤0x20), NBSP (0xA0), BOM (0xFEFF) e zero-width (0x200B–0x200D). Implementado com **code points** (sem caracteres invisíveis no fonte — tentativas anteriores com char class literal injetavam invisíveis no próprio regex). `getPluggyClient()` passa `PLUGGY_CLIENT_ID`/`SECRET` por ele antes de instanciar o `PluggyClient`. Mesmo padrão de `anthropic.ts` e `inngest.ts`, agora cobrindo o último consumidor de credencial que faltava.
- Testado contra 6 casos de contaminação (newline, BOM, ZWSP, espaços, tab+CR) — todos normalizam pro UUID limpo. ESLint limpo. Fonte verificado sem BOM/zero-width.

**Decisão de não mexer na env da Vercel:** o fix em código torna o app resiliente independente de como a env foi colada, então não foi necessário re-gravar `PLUGGY_CLIENT_ID`/`SECRET` na Vercel. Se reaparecer, vale limpar a origem também.

---

### ✅ Sessão de Layer 0 — categorização determinística via CSV — *commits `d587644` / `d72ec37` / `35400e6`, deployada*

**Contexto:** após a sessão de hardening do pipeline (ver entrada abaixo) o usuário levantou questão fundamental — se o CSV traz colunas explícitas `Natureza pai` / `Natureza filho` com nomes idênticos aos do plano de contas da org, **por que paga LLM pra fazer um lookup que poderia ser direto no DB?** Hints da planilha eram tratados como advisory (alimentavam o prompt do Haiku) em vez de autoritativos. Sem Layer 0, o LLM podia errar (especialmente quando o mesmo nome de filho aparece sob tipos diferentes, ex: `Porcelanato Acetinado` sob Receita Operacional E sob CPV — o usuário usa esse pattern pra calcular margem direta da categoria).

**Decisão arquitetural:** adicionar **Camada 0** antes das regras. Quando o parser detecta colunas autoritativas, valor da célula vira nome canônico de folha e é usado pra lookup determinístico contra o plano de contas da org. Detalhes em [docs/SCHEMA_DECISIONS.md](docs/SCHEMA_DECISIONS.md) Decisão 12.

**Implementação em 3 commits incrementais:**

1. **`d587644` — Layer 0 base + match por Categoria Filho/Pai**
   - Parser ganha `detectAuthoritativeColumns()` em [src/lib/parsers/excel-csv.ts](src/lib/parsers/excel-csv.ts) que reconhece por regex no header normalizado: `^(categoria|natureza) (pai|filho)$`, `^(conta contabil|plano de contas|plano contas|plano de conta)$`. Determinístico, sem LLM.
   - Cada row com valores nessas colunas grava `rawData.__categoryMapping = {categoriaFilho, categoriaPai}`.
   - `loadOrgContext` em [src/lib/categorizer.ts](src/lib/categorizer.ts) expõe agora `parentName` em cada folha (pra desambiguar match de nomes repetidos sob pais diferentes).
   - Novo helper exportado `findCategoryByCsvMapping(mapping, leaves)`: normaliza `categoriaFilho`, busca folhas com mesmo nome normalizado. Se 1 → retorna. Se múltiplas → desempata por `categoriaPai`.
   - `categorizeTransaction` ganha **Layer 0** antes das regras: lê `meta.categoryMapping`, tenta lookup, casa → retorna `method: 'csv_match', confidence: 1.0`.
   - `approveAndInsert` em [src/server/staging.ts](src/server/staging.ts) carrega contexto da org **uma vez** por import (folhas filtradas por domínio DRE vs BP via `domainFromReportType`). Pra cada row, tenta lookup. Casou → INSERT com `categoryId` + `categorizationMethod='csv_match'` + `categorizationConfidence='1.0'` já preenchidos. IDs casados **não** entram no evento Inngest — só os não-casados disparam o pipeline LLM.
   - Toast extra na review page: "X linhas foram classificadas automaticamente pelo Categoria Pai/Filho do CSV".
   - Tipo `CategorizationResult.method` aceita `'csv_match'`.

2. **`d72ec37` — robustez do normalizador (dash/slash/parênteses)**
   - CSV do usuário tinha leaf names tipo `AC3 – Porcelanato / Flex` (en-dash + barra + espaços). Plano de contas podia ter sido cadastrado com hyphen comum em vez de en-dash.
   - `normalizeForMatch` originalmente só baixava caixa + tirava acento + colapsava whitespace. Qualquer diferença de pontuação bloqueava o match.
   - Agora colapsa qualquer caractere não-alfanumérico (incluindo dash de qualquer tipo, barra, parênteses) em espaço, depois colapsa whitespace múltiplo. Resultado: `AC3 – Porcelanato / Flex` e `AC3 - Porcelanato / Flex` viram ambos `ac3 porcelanato flex`.

3. **`35400e6` — coluna `Tipo Natureza` desempata Receita vs CMV**
   - Usuário usa o mesmo nome de folha sob Receita Operacional E sob CPV/CMV (ex: `Porcelanato Acetinado`) pra calcular margem direta. Sem desempatador, Layer 0 retornava null e caía pro Haiku que podia errar.
   - Parser detecta nova coluna autoritativa: `^tipo (de )?natureza$` ou `^grupo contabil$`. Valor vai pra `rawData.__categoryMapping.tipoNatureza`.
   - `CsvCategoryMapping` ganha `tipoNatureza?: string`.
   - Novo `TIPO_ALIASES` em [src/lib/categorizer.ts](src/lib/categorizer.ts) — mapa de alias humano → código interno (de [src/lib/dre-types.ts](src/lib/dre-types.ts)): `Receita` → `receita_operacional`, `CMV`/`CPV`/`Custo` → `cpv`, `SGA`/`Despesa` → `sga`, etc. Ordem importa: códigos específicos vêm primeiro pra evitar match prematuro (ex: `deducao tributaria` antes de `tributo`).
   - `findCategoryByCsvMapping` ganha filtro adicional **antes** do pai: depois de match por nome, se múltiplos candidatos e `tipoNatureza` foi fornecido, filtra por `c.type === inferTipoCode(tipoNatureza)`. Filtragem cumulativa.
   - Pipeline novo de match: nome → tipo → pai. Cada etapa reduz candidatos. Sai cedo se chegar a 1.

**Fluxo final pro usuário (caso ceramic-tile ERP):**
- CSV de vendas: `Natureza pai = "PISOS", Natureza filho = "Piso Cerâmico", Tipo Natureza = "Receita"` → match com folha `1.6.02 Piso Cerâmico` sob Receita Operacional → INSERT já classificado, zero Haiku
- CSV de CMV: mesma `Natureza filho = "Piso Cerâmico"` mas `Tipo Natureza = "CMV"` → match com folha homônima sob CPV → INSERT já classificado, zero Haiku

**Arquivos modificados (todos os 3 commits combinados):**
- [src/lib/parsers/excel-csv.ts](src/lib/parsers/excel-csv.ts) — detecção autoritativa, gravação em `__categoryMapping`
- [src/lib/categorizer.ts](src/lib/categorizer.ts) — `findCategoryByCsvMapping`, `inferTipoCode`, `TIPO_ALIASES`, Layer 0, `LeafCategory.parentName`, tipo `'csv_match'`
- [src/server/staging.ts](src/server/staging.ts) — pre-classificação no `approveAndInsert`, propagação de `metadata.categoryMapping`
- [src/app/(authenticated)/upload/[id]/review/review-client.tsx](src/app/(authenticated)/upload/[id]/review/review-client.tsx) — toast de split CSV-match × LLM

---

### ✅ Sessão de hardening do pipeline de categorização — *commits `b040a23` / `37026ef` / `cec830a` / `2bd4cf1`, deployada*

**Contexto:** após resolver upload + bulk-set de direção (sessão anterior — commit `895dd83`), o usuário fez upload de CSV de 7762 linhas, marcou todas como Entrada, clicou Importar. Toast verde "7762 importadas" apareceu, mas `/transacoes` mostrava tudo com categoria em branco. No dashboard da Inngest, **nenhum evento `transaction/batch-inserted` apareceu na aba Events** — o catch silencioso engoliu a falha do `inngest.send`.

**4 problemas em cascata, cada commit resolve um:**

1. **`b040a23` — catch loud + chunking interno + transparência de hints**
   - `approveAndInsert` em [src/server/staging.ts](src/server/staging.ts) trocou `try/catch {}` por `try/catch (err) { console.error; categorizationDispatched=false }`. Devolve flag pro frontend.
   - Toast persistente (15s) em [review-client.tsx](src/app/(authenticated)/upload/[id]/review/review-client.tsx) quando `categorizationDispatched === false`: "X transações importadas, mas a categorização não foi iniciada. Vá em /transações e clique em Categorizar agora."
   - Refator do `categorize-transactions` em [src/jobs/categorize-transaction.ts](src/jobs/categorize-transaction.ts): antes era loop inteiro dentro de UMA `step.run`, com ~1s por chamada Haiku × 7762 = ~130min wall time → Vercel matava em 5min (`maxDuration=300`) e nada completava. Agora chunkado: `CHUNK_SIZE=50`, cada chunk vira uma `step.run('chunk-N', ...)` independente. Inngest persiste estado entre steps; retry automático por step. `processChunk()` extraído como função pura.
   - Parser ganha `detectedHints` no retorno — lista de headers identificados como hint. `process-document.ts` grava em `documents.extractedData.detectedCategoryHints` pra debug futuro ("o parser pegou Grupo e Família, mas não Departamento — vou ajustar heurística").

2. **`37026ef` — diagnóstico: logar erro real do inngest.send**
   - `triggerCategorization` em [src/server/transactions.ts](src/server/transactions.ts) tinha catch genérico devolvendo mensagem amigável sem nenhum detalhe técnico. Trocado por `console.error('[triggerCategorization] inngest.send falhou:', err)` + propaga `err.message` no retorno pra toast em `/transacoes` mostrar exatamente o que o SDK reclamou. Pré-condição pra diagnosticar o erro 400 da próxima etapa.

3. **`cec830a` — chunkar evento batch-inserted (limite 256KB do Inngest)**
   - Erro real revelado pelo logging do `37026ef`: `Inngest API Error: 400 Event is over the max size: Max 262144 bytes / Size 302874 bytes`. Limite real do Inngest é **256KB por evento**, não 512KB como eu tinha calculado. 7762 UUIDs JSON-encoded batem ~296KB.
   - Solução: novo helper `sendCategorizationEvents(transactionIds, organizationId, forceRun?)` em [src/lib/inngest.ts](src/lib/inngest.ts) fatia IDs em batches de 3000 (~117KB cada) e dispara um evento por chunk. A função `categorize-transactions` tem `concurrency: { limit: 1, key: 'event.data.organizationId' }`, então os eventos são processados em fila — não disputam recursos.
   - `approveAndInsert` e `triggerCategorization` passam a usar o helper em vez de `inngest.send` direto.

4. **`2bd4cf1` — strip BOM/zero-width das chaves de env**
   - Após `cec830a` deploy, evento finalmente chegou no Inngest e função foi invocada. Mas `chunk-0` falhou com `TypeError: Cannot convert argument to a ByteString because the character at index 0 has a value of 65279` (U+FEFF / BOM). Stack: `fZ.apiKeyAuth → _Headers.append → webidl.converters.ByteString`. Esse é o caminho do SDK Anthropic construindo o header `x-api-key`.
   - Causa raiz: `ANTHROPIC_API_KEY` na Vercel veio com BOM no início do valor (copy/paste de editor Windows). Toda chamada Haiku falhava — mas o parser CSV tinha **fallback heurístico** silencioso (`tryLlmMapping` retorna null em erro → cai pra `heuristicMapping`), mascarando o problema durante `document/uploaded`. O categorizer não tem fallback, então o erro virou visível em escala.
   - Fix defensivo em [src/lib/anthropic.ts](src/lib/anthropic.ts) e [src/lib/inngest.ts](src/lib/inngest.ts): `sanitizeKey()` strippa BOM (U+FEFF), zero-width space (U+200B), control chars e whitespace nos dois extremos das envs sensíveis no startup. Sobrevive a env contaminada sem precisar o usuário re-colar a chave na Vercel.

**Lição arquitetural (anotada em SCHEMA_DECISIONS Decisão 12 implicitamente):** quando um pipeline tem fallback silencioso, falhas se acumulam invisíveis. O parser caía pra heurística silenciosa há quem sabe quantos uploads antes do problema virar visível. Fallback é bom UX, mas precisa logar a falha original — sem isso a degradação fica imperceptível até quebrar algo sem fallback.

---

### ✅ Sessão de UX /transacoes — page-size selector + delete limit — *commits `000ebc3` / `8948106` / `37b5c30`, deployada*

**Contexto:** com a categorização não funcionando (sessão acima, ainda não diagnosticada na época), usuário precisava limpar 7762 transações lixo do DB pra começar do zero. Tabela `/transacoes` tinha `PAGE_SIZE=100` hard-coded e "Apagar selecionados" só agia sobre a página corrente. Limpeza demandaria ~58 ciclos de seleção+delete. UX bloqueador.

**Implementação em 3 commits:**

1. **`000ebc3` — seletor 100/500/1000 no rodapé (DEPLOY FALHOU)**
   - Exportei `ALLOWED_PAGE_SIZES` de [src/server/transactions.ts](src/server/transactions.ts) (que tem `'use server'`) — Next.js proíbe arquivos `'use server'` de exportar constantes (só funções async). Build quebrou na Vercel com error 45s.

2. **`8948106` — fix do build (constante em arquivo neutro)**
   - Criado [src/lib/transactions-page-size.ts](src/lib/transactions-page-size.ts) sem diretiva, exportando `ALLOWED_PAGE_SIZES`, `AllowedPageSize`, `DEFAULT_PAGE_SIZE`, `sanitizePageSize`. Server e client importam de lá. Build passou.
   - URL ganha `?pageSize=500` etc, persistido em `localStorage` via `FILTER_KEYS` — preferência sobrevive a navegação e a aplicação de filtros. Rodapé exibe o `<select>` sempre que houver mais de 100 transações, mesmo sem paginação ativa (`data.total > 100 || data.pages > 1`).
   - `getTransactions` aceita `pageSize?: number`, sanitiza contra `ALLOWED_PAGE_SIZES` (default 100), aplica em `limit()` e `Math.ceil(total / size)`.

3. **`37b5c30` — aumentar limite de delete em lote de 500 pra 1000**
   - Após teste com `pageSize=1000`, usuário tentou "Apagar selecionados" e bateu no limite hard-coded `if (ids.length > 500) return { error: 'Máximo de 500 transações por operação.' }`. Limite era arbitrário — Postgres aguenta `IN (...)` com milhares de IDs sem problema. Subi pra 1000 pra acompanhar o novo `pageSize` máximo.

**Resultado:** limpeza de 5762 transações virou 6 ciclos em vez de 58.

**Arquivos modificados:**
- [src/lib/transactions-page-size.ts](src/lib/transactions-page-size.ts) — novo (10 linhas)
- [src/server/transactions.ts](src/server/transactions.ts) — `getTransactions` parametrizado, delete limit 1000
- [src/app/(authenticated)/transacoes/page.tsx](src/app/(authenticated)/transacoes/page.tsx) — parser de `?pageSize`
- [src/app/(authenticated)/transacoes/transacoes-client.tsx](src/app/(authenticated)/transacoes/transacoes-client.tsx) — `<select>` no rodapé, `pageSize` em `FILTER_KEYS`

---

### ✅ Sessão de UX upload review — bulk-set direção + hints da planilha — *commit `895dd83`, deployada*

**Contexto:** após o parser CSV redesenhado (`46b43cc`) o usuário subiu o `fatur syndata.csv` mas o parser não conseguiu inferir direção das 7762 linhas (não havia coluna explícita de tipo, era CSV de vendas só com valores positivos). Importar com `direction=null` era inviável — `approveAndInsert` filtrava por `r.date && r.amount && r.direction`, todas as linhas seriam descartadas.

**Entregue neste commit:**

1. **Bulk-set de direção em massa (review page)**
   - Nova server action `setAllPendingDirection(documentId, direction)` em [src/server/staging.ts](src/server/staging.ts) — UPDATE em todas as rows do documento com `direction IS NULL`, sem filtro de status. Retorna count atualizado.
   - Banner âmbar em [review-client.tsx](src/app/(authenticated)/upload/[id]/review/review-client.tsx) aparece quando `rows.some(r => !r.direction && r.status !== 'rejected')`. Mostra contagem + dois botões: "Marcar todas como Entrada" e "Marcar todas como Saída". Click dispara a server action + atualiza state local + toast de confirmação.
   - Não bloqueia o fluxo — usuário pode setar individualmente por linha também via click no badge da direção (já existia).

2. **Hints de categoria do CSV propagados pro categorizer (Camada 4 LLM)**
   - Parser ganha `categoryHints: number[]` no `ColumnMapping`, retornado pelo LLM E pela heurística. Heurística lista keywords PT-BR (`grupo`, `familia`, `subgrupo`, `categoria`, `classe`, `departamento`, `centro custo`, `plano de contas`, `rubrica`, `segmento`, `linha`, `natureza`).
   - Cada `StagingRow.rawData` ganha chave especial `__categoryHints = {<header>: <valor>}` quando há colunas hint detectadas (deduplicadas contra colunas semânticas que o LLM já mapeou).
   - `approveAndInsert` propaga `__categoryHints` pra `transaction.metadata.categoryHints` (somente se houver pelo menos 1 chave).
   - `classifyWithLLM` em [src/lib/categorizer.ts](src/lib/categorizer.ts) lê `tx.metadata.categoryHints` e adiciona bloco "Classificação na planilha de origem (forte sinal pra escolher a natureza)" na user message do Haiku. Pluggy continuava recebendo hint de `pluggyCategory` separadamente.

**Arquivos modificados:**
- [src/lib/parsers/excel-csv.ts](src/lib/parsers/excel-csv.ts) — `categoryHints` no mapping, regex e LLM prompt, gravação em `rawData.__categoryHints`
- [src/server/staging.ts](src/server/staging.ts) — `setAllPendingDirection`, propagação de `categoryHints` em `metadata`
- [src/lib/categorizer.ts](src/lib/categorizer.ts) — `buildCategoryHintsBlock`, parâmetro `categoryHints` em `classifyWithLLM`
- [src/app/(authenticated)/upload/[id]/review/review-client.tsx](src/app/(authenticated)/upload/[id]/review/review-client.tsx) — banner âmbar com botões de bulk-set

---

### ✅ Sessão de redesenho do parser CSV — *commit `46b43cc`, deployada*

**Contexto:** após a sessão de hardening (abaixo) restaurar o pipeline, o mesmo arquivo `fatur syndata.csv` (7k linhas) continuou falhando — desta vez com `Cannot convert argument to a ByteString because the character at index 0 has a value of 65279` em **todos os 65 chunks**. Duas tentativas de strip de BOM (`3c9dc57` via regex literal, `aca6048` via charCodeAt) **não resolveram em produção**, apesar de funcionarem localmente. Teste isolado contra o SDK Anthropic enviando BOM em `content` passou sem erro — descartando a hipótese de "BOM no body causa o erro". A causa raiz do `ByteString` permanece indeterminada (provavelmente um header indireto que captura algo do request), mas em vez de continuar tentando diagnosticar um pipeline frágil por design, o usuário pediu uma **solução definitiva**.

**Decisão arquitetural:** abandonar a abordagem LLM-por-linha. O Haiku estava sendo usado pra fazer parsing tabular — exatamente o que `csv-parse` faz determinístico em milissegundos sem chamada externa.

**Nova arquitetura ([src/lib/parsers/excel-csv.ts](src/lib/parsers/excel-csv.ts)):**

1. **Leitura tabular determinística:** `csv-parse` lê CSV com auto-detecção de delimitador (`,`, `;`, `\t`), strip de BOM nativo, suporte a aspas e quebras em campos. Excel continua via `XLSX.utils.sheet_to_json` com `header: 1`.
2. **LLM chamado UMA vez por upload** com header + 20 linhas de amostra. Retorna apenas os índices de coluna semânticas: `{ date, effectiveDate, amount, direction, description, amountSignIndicatesDirection }`. Validação de schema antes de aceitar (índices em range, pelo menos date ou amount não-null).
3. **Fallback heurístico** se LLM falhar (JSON inválido, índices fora de range, ou ambos date+amount null): casa nomes comuns em PT-BR (`data`, `valor`, `descricao`, `vencimento`, `pagamento`, etc.) por normalização (lowercase, sem acentos) e busca de keyword.
4. **Funções de normalização determinísticas:**
   - `normalizeDate`: aceita DD/MM/YYYY, YYYY-MM-DD, DD/MM/YY, "02 jan." (mês PT abreviado) e serial Excel
   - `normalizeAmount`: detecta formato BR (`1.234,56`) vs US (`1,234.56`), remove `R$`, sinal por parênteses `(120,00)` ou prefixo `-`
   - `deriveDirection`: usa coluna explícita (mapping de C/D, entrada/saída), ou sinal do amount, ou fallback do sourceType (DEFAULT_OUTFLOW_SOURCES / FORCE_INFLOW_SOURCES do [process-document.ts](src/jobs/process-document.ts))
5. **Hard-fail claro** se nem LLM nem heurística detectarem date ou amount: retorna `rows: []` com warning específico pedindo pro usuário verificar o cabeçalho.

**Benchmarks (teste local, 50 linhas + BOM + valores BR):**

| Métrica | Antes (chunking + LLM por linha) | Depois (csv-parse + LLM só pra mapping) |
|---|---|---|
| Tempo | 3–5 min (65 chamadas LLM) | **1.3s** (1 chamada LLM) |
| Tokens | ~70k | **~2k** |
| Falhas | 65 warnings de ByteString | **0 warnings** |
| Output truncado por `max_tokens` | Sim em arquivos grandes | **Impossível** (só 300 tokens de mapping) |

**Arquivos modificados:**
- [src/lib/parsers/excel-csv.ts](src/lib/parsers/excel-csv.ts) — reescrita completa (304+ linhas, -213)
- [package.json](package.json) — adicionada dep `csv-parse@^6.2.1`

**O que NÃO foi mudado e por quê:**
- Contract de `parseExcelOrCsv` (`Promise<{ rows: StagingRow[]; warnings: string[] }>`) preservado. [src/jobs/process-document.ts](src/jobs/process-document.ts) não precisou tocar.
- `maxDuration = 300` em `/api/inngest/route.ts` continua útil pra PDFs.
- Diagnóstico do ByteString abandonado por decisão consciente — o pipeline novo não passa por essa code path do SDK Anthropic em loop, então o bug fica isolado a um caminho de código não usado em produção.

**Lições aprendidas:**

- **Quando um pipeline acumula 3 fixes seguidos pro mesmo arquivo, a arquitetura está errada.** As 3 sessões (hardening de Inngest, chunking, BOM strip) foram todas necessárias mas o quarto erro (ByteString) finalmente expôs que a abordagem inteira era frágil. LLM-por-linha pra parsing tabular é overengineering — usa modelo caro pra fazer trabalho que biblioteca determinística faz.
- **Hipóteses devem ser falsificadas com teste isolado antes de gerar commits.** Antes da reescrita, fiz `scripts/test-bom-anthropic.mjs` testando BOM em content direto no SDK — passou sem erro. Esse teste deveria ter sido feito ANTES de commitar 3c9dc57. Teria evitado dois deploys inúteis.
- **`csv-parse` (npm package) já lida com BOM, multi-delimiter, quotes, encoding.** Não precisa parser custom em [src/lib/csv-parser.ts](src/lib/csv-parser.ts) (esse continua sendo usado pra imports de plano de contas, que tem schema fixo).

---

### ✅ Sessão de hardening do pipeline de upload — *commitada e deployada*

**Contexto:** usuário relatou que arquivo CSV de ~7.000 linhas enviado via `/upload` (em produção, `lure-expert.vercel.app`) ficava eternamente em "Processando…". Doc travado por >1h em `extraction_status = 'pending'`, zero linhas em `transactions_staging`.

**Diagnóstico em camadas:**

1. **Suspeita inicial (errada):** parser do Haiku travando em arquivo grande. Inspeção do código mostrou: parser nem foi chamado — o `step.run('mark-processing')` setaria `processing` em milissegundos, mas o doc estava em `pending` desde a criação. **O job Inngest nunca rodou.**
2. **Suspeita 2 (correta direção, errada conclusão):** config Inngest faltando na Vercel. Falso — `INNGEST_EVENT_KEY` e `INNGEST_SIGNING_KEY` estavam setados em produção há 9 dias (`npx vercel env ls`). Outro PDF foi processado com sucesso em `2026-05-21` pela mesma config.
3. **Causa raiz confirmada via Vercel logs:** múltiplas linhas `error  λ HEAD /api/inngest  401  Signature validation failed`. **App Inngest desincronizado** — funções não registradas no Inngest Cloud apontando pra essa URL, ou a `signing_key` em uso pelo Cloud divergiu do valor armazenado na Vercel.

**Resolução do incidente (manual, via dashboard Inngest):**
- App `lure-expert` foi removido da lista de Apps no Inngest Cloud em algum momento entre `2026-05-21` (último deploy que funcionou) e `2026-05-25` (incidente)
- Usuário fez `Apps → Sync new app → URL = https://lure-expert.vercel.app/api/inngest` (com `/api/inngest`, não a raiz). Sync retornou Success, 10 funções registradas
- Após sync, `inngest.send` da Vercel pro Cloud retornou HTTP 200 e o Cloud invocou `/api/inngest` com sucesso (HTTP 206, normal pra step.run)

**Fixes de código entregues neste commit (`178c0f8`):**

1. **Chunking do parser** ([src/lib/parsers/excel-csv.ts](src/lib/parsers/excel-csv.ts))
   - Antes: arquivo inteiro ia num único `anthropic.messages.create` com `max_tokens: 8192`. Pra 7k linhas, output esperado seria ~500k tokens → resposta truncada → `JSON.parse` falha → retorna `rows: []` com warning, marca doc como `completed` com 0 linhas. Falha silenciosa.
   - Depois: arquivo é convertido pra CSV uniforme via `fileToText`, dividido em chunks de 120 linhas preservando o header. Cada chunk vai num call separado, warnings por chunk são acumulados. Arquivos com ≤120 linhas mantêm o caminho antigo (um único call).
   - `CHUNK_SIZE = 120` foi escolhido com margem: ~40 tokens por objeto JSON × 120 = ~4800 tokens de saída, metade do budget de 8192.

2. **Catch loud no enfileiramento** ([src/server/documents.ts:137-160](src/server/documents.ts))
   - Antes: `try { await inngest.send(...) } catch (err) { console.warn(...) }` — silencia falha de enfileiramento, deixa doc preso em `pending`, front mostra "sucesso" pro usuário.
   - Depois: catch deleta o registro do doc (DB), faz `console.error`, devolve `{ error }` pro server action. Front em [upload-form.tsx:138](src/app/(authenticated)/upload/upload-form.tsx#L138) já trata erro de `createDocumentRecord` removendo o arquivo do Storage e exibindo mensagem. Comportamento limpo de retry pelo usuário.

3. **Watchdog de docs travados** ([src/jobs/watchdog-stuck-documents.ts](src/jobs/watchdog-stuck-documents.ts))
   - Cron Inngest `*/10 * * * *` (a cada 10 min)
   - Dois steps: `fail-stuck-pending` (status='pending' há >15min) e `fail-stuck-processing` (status='processing' há >30min)
   - Marca como `failed` com `extractedData = { error, stuckAt, timeoutMin }` — mensagem visível no /upload pro usuário saber que precisa reenviar
   - **Validado em produção real**: o doc `fatur syndata.csv` (criado 15:14 UTC, preso por 1h+) foi marcado como failed pelo watchdog em sua primeira execução pós-deploy. Mensagem registrada: *"Processamento não foi iniciado em tempo hábil. Pode ter sido um problema temporário na fila — reenvie o arquivo."*

4. **`maxDuration = 300`** ([src/app/api/inngest/route.ts](src/app/api/inngest/route.ts))
   - Necessário pra acomodar parsing chunked de arquivos grandes — 7k linhas em chunks de 120 = ~58 calls × ~3-5s = 2-4 min total. Vercel Hobby (10s) e Pro default (60s) cortariam.
   - Também registra a nova função `watchdogStuckDocuments`. Total agora: **11 funções** registradas em `serve()`.

**Validações em produção pós-deploy `178c0f8`:**

- `curl https://lure-expert.vercel.app/api/inngest` → 401 com header `X-Inngest-Sdk-Handled: true` (comportamento esperado do SDK pra GET sem assinatura)
- `Vercel logs --since=2m` → zero `Signature validation failed` desde o resync
- `inngest.send` manual pra `document/uploaded` (script descartável, deletado após uso) → HTTP 200 com event ID `01KSG1C3ZZV1MQZ3PA9XHTG266`
- POST /api/inngest invocado pelo Cloud → 206 Partial Content (normal pra Inngest step.run em andamento)
- DB: doc travado transicionou `pending → failed` via watchdog automaticamente

**Lições aprendidas (registradas pra próximas sessões):**

- **Inngest Cloud pode "perder" um app sem aviso.** Aconteceu entre dois deploys. Sem auto-sync no deploy, sem health check, sem alerta — só um cliente real perdendo upload pra descobrir. Mitigação proposta: configurar Deploy Hook do Inngest (Vercel → Settings → Git → Deploy Hooks) pra forçar re-sync a cada push em `main`. **Não implementado nesta sessão** — requer pegar URL do hook no dashboard Inngest.
- **Padrão `try { send } catch { console.warn }` é tóxico** em qualquer ponto do pipeline. Repetido em [src/server/](src/server/) em vários lugares? Auditoria pendente — pelo menos `documents.ts` corrigido aqui.
- **Vercel CLI funciona localmente sem login interativo** se `.vercel/` já tiver state — `npx vercel env ls` / `npx vercel env pull` / `npx vercel logs` foram essenciais pro diagnóstico. Bom de saber pra próximas investigações de produção.
- **Status 206 do Inngest é normal**, não é erro — significa "step.run executou, mais invocações virão pro próximo step". Não confundir com falha.

**Arquivos:**
- Novo: [src/jobs/watchdog-stuck-documents.ts](src/jobs/watchdog-stuck-documents.ts)
- Modificados: [src/lib/parsers/excel-csv.ts](src/lib/parsers/excel-csv.ts), [src/server/documents.ts](src/server/documents.ts), [src/app/api/inngest/route.ts](src/app/api/inngest/route.ts)

**Commit:** `178c0f8` — *fix(upload): chunking do parser + catch loud + watchdog de pendentes*

---

### ⏪ Sessão de UX import CSV de categorias — *revertida, nada commitado*

**Contexto:** tentativa de melhorar o fluxo de import de plano de contas em `/configuracoes` → Categorias.

**O que foi tentado e revertido:**

1. **Dialog mais largo** — `max-w-3xl` → `max-w-[90vw]` + `flex flex-col` com scroll interno. Funcionava, mas foi revertido junto com o resto.
2. **`LABEL_MAP` expandido em `normalizeTypeSlug`** ([src/server/imports.ts](src/server/imports.ts)) para aceitar rótulos da UI no CSV (ex: `"cpv / cmv / csp"` → `cpv`, `"receitas & despesas financeiras"` → `resultado_financeiro`, `"impostos sobre renda"` → `ir`). Funcionava — destravava 8 das 9 linhas falhando do CSV de teste do usuário.
3. **Feature "Substituir plano de contas"** — dois checkboxes ("Substituir DRE" / "Substituir BP"), banner amber de aviso, botão `variant="destructive"`, e bloco de wipe em `commitCategoryImport` (DELETE em `transactions.category_id`, `categorization_rules`, depois `categories`). Esse foi o motivo da reversão (ver abaixo).

**Por que foi revertido:**

A feature de substituir foi enxertada em cima do pipeline `preview → confirm` existente, que é desenhado pra import **incremental** (insert vs update sem conflito). Quando o usuário marca "Substituir DRE", o preview ainda compara linha-a-linha com o banco atual e marca **40 linhas como erro** ("código X já existe sob Natureza Pai Y, mover entre Pais não é permitido via CSV") — porque a tela não sabe que o wipe vai limpar tudo antes do commit. UX confusa, com o botão de confirmar desabilitado por conflitos que não existem semanticamente.

**Decisão:** reverter sessão inteira via `git restore .` e repensar a feature do zero numa próxima sessão. Working tree limpo, HEAD em `a11a6b7`.

**Ganhos de conhecimento desta sessão (registrados pra próxima):**

- **Bug real no `normalizeTypeSlug`**: o `LABEL_MAP` em [src/server/imports.ts:672-677](src/server/imports.ts) só cobre `sg&a`/`transitorios`/`transferencias`. Falta mapeamento pra `cpv / cmv / csp` → `cpv`, `receitas & despesas financeiras` → `resultado_financeiro`, e `impostos sobre renda` → `ir`. Sintoma: usuário copia o nome da UI pro CSV e leva erro "tipo X inválido". **Fix isolado** (sem misturar com substituir-plano) é trivial: adicionar 6 entries no `LABEL_MAP`.

- **Largura do dialog é limitante**: `max-w-3xl` (~768px) com 7 colunas + mensagens de erro longas é apertado. Mexer em `csv-import-dialog.tsx:104` resolve sem impacto em outro lugar.

- **Schemas TS órfãos** descobertos: `db/schema/{fixed-assets,loans,equity-movements}.ts` descrevem tabelas dropadas pela migration 0015. Tentar usá-los gera erro Postgres `relation does not exist` mascarado pelo overlay do Next como "Failed query". Documentado em `docs/SCHEMA_DECISIONS.md` Decisão 11.

- **Arquitetura: "substituir tudo" precisa de fluxo separado**, não convive no mesmo dialog que o import incremental. Opções pra próxima conversa:
  1. Dois dialogs distintos (`Importar` vs `Substituir`)
  2. Botão "Resetar plano" como ação independente, fora do fluxo de import
  3. Modo de preview diferente quando substituir está ativo (oculta diff com banco, só valida CSV estruturalmente)

**Arquivos restaurados ao estado de `a11a6b7`:**
- `src/server/imports.ts`
- `src/components/settings/csv-import-dialog.tsx`
- `db/schema/equity-movements.ts`
- `db/schema/fixed-assets.ts`
- `db/schema/loans.ts`

Nada commitado. Nada deployado.

---

### ✅ Sessão 8.1 — Stone connector real + job sync-acquirer-item *(concluída)*

**Contexto:** primeira sessão de implementação real da Fase 8. Transforma o `StoneProvider` de stub em integração funcional e cria toda a pipeline de sync — do evento Inngest ao insert em `transactions`.

**Decisão de design — `dataSourceId` em `transactions`:**
A tabela `transactions` tem FK `data_source_id NOT NULL` para `data_sources`. Adquirentes usam `acquirer_connections`, não `data_sources`. Solução: o job `sync-acquirer-item` cria um `data_sources` vinculado (`type='acquirer'`, `externalItemId=acquirerConnectionId`) no step `ensure-data-source` antes do primeiro insert, e salva o ID em `acquirer_connections.metadata.dataSourceId` para reuso nos syncs seguintes. Evitou migration adicional em `transactions`.

**O que mudou:**

- **`src/lib/stone-client.ts`** (criado) — `StoneClient`:
  - OAuth2 `client_credentials` com `client_id` + `client_secret` (Stone API)
  - Cache de token em memória — renova automaticamente 30s antes de expirar
  - `fetchSales(merchantId, fromDate, toDate, cursor?)` → `StoneSalesPage`
  - Parâmetros: `merchant_id`, `begin_date`, `end_date`, `page_size=100`, `cursor`
  - Endpoints separados por ambiente: `sandbox-api.openbank.stone.com.br` vs `api.openbank.stone.com.br`

- **`src/lib/acquirer-provider.ts`** (modificado) — `StoneProvider` implementado:
  - Construtor muda de `(apiKey, env)` para `(clientId, clientSecret, env)` — usa `StoneClient`
  - `fetchSales()` chama `client.fetchSales()`, filtra `status === 'approved'`, converte centavos → decimal com `.toFixed(2)`, mapeia para `AcquirerSale`
  - Factory atualizada: `case 'stone': return new StoneProvider(apiKey, apiSecret, env)`

- **`src/jobs/sync-acquirer-item.ts`** (criado) — job `acquirer/item.sync-requested`:
  - Concurrency: `limit: 1` por `acquirerConnectionId`
  - Step `check-connection`: carrega `acquirer_connection` completa
  - Guarda de `awaitingFirstSync`: retorna `{ skipped: 'awaiting-first-sync' }` se nenhum `fromDate` explícito
  - Step `ensure-data-source`: query → cria `data_sources` se não existe → salva `dataSourceId` em `metadata`
  - Paginação: loop `while(true)` com steps nomeados `fetch-page-0`, `fetch-page-1`, … — memoização Inngest funciona
  - Insert em `transactions` com `accountType='ACQUIRER'`, `accountId=merchantId`, `direction='inflow'`, `onConflictDoNothing()` para dedup
  - Step `update-status`: lê metadata atual do DB (inclui `dataSourceId` do ensure-step), remove `awaitingFirstSync`, seta `status='active'`
  - Step `trigger-categorization`: `transaction/batch-inserted` → pipeline de categorização automática
  - Exporta `daysAgoISO(days)` — reutilizado pelo cron

- **`src/jobs/sync-all-acquirer-items.ts`** (criado) — cron `0 7 * * *` (04:00 BRT):
  - Lista conexões não-inativas; filtra clientes em `awaitingFirstSync` antes de disparar
  - Janela: `lastSyncAt - 1 dia` ou `7 dias atrás` se nunca sincronizado
  - Dispara lote de eventos `acquirer/item.sync-requested`

- **`src/app/api/inngest/route.ts`** (modificado) — registra `syncAcquirerItem` e `syncAllAcquirerItems`

TypeScript: 0 erros. `npm run build` limpo.

---

### ✅ Sessão 8.0 — Scaffolding adquirentes *(concluída)*

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

