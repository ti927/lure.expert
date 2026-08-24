# Formato de importação — lure.expert

Este documento é a especificação do arquivo de importação de lançamentos. Ele tem **três
leitores**, e é de propósito que sejam os três:

1. **A pessoa** que baixa a planilha modelo em `/upload` e tabula o extrato à mão.
2. **A IA conectada pelo MCP**, que recebe um extrato em qualquer formato e converte *para
   este*. Sem um alvo publicado, ela inventa a estrutura a cada conversa.
3. **O parser do app**, que ganha um caminho determinístico quando o cabeçalho casa.

A implementação vive em `src/lib/import-contract.ts`. Se este documento e aquele arquivo
divergirem, o arquivo está certo e este documento está desatualizado — mas isso é um defeito,
não uma hierarquia: os dois mudam no mesmo commit.

---

## A regra que não pode ser esquecida

> **O formato canônico é um caminho rápido, nunca um requisito.**

A promessa da Fase 2 é *"cliente sobe relatório (qualquer formato), sistema extrai e
estrutura"*, e ela é a promessa ao dono de PME que arrasta o CSV do banco sem ler nada. Um
arquivo com cabeçalho desconhecido **continua caindo no parser LLM**, exatamente como antes.

O que o formato canônico compra:

| | Cabeçalho reconhecido | Cabeçalho qualquer |
|---|---|---|
| Como é lido | determinístico, no código | Claude Haiku detecta as colunas |
| Custo de IA | **zero** | uma chamada por upload |
| O que pode vir | tudo que a planilha declara | data, valor, descrição, direção, plano de contas |

É o princípio nº 2 do projeto sendo cumprido: *"LLM é última opção. Sempre tente código →
regras → recorrência → embeddings antes de chamar IA."*

---

## Vocabulário — três pares que se confundem

**Competência × Caixa.** Competência é quando o fato econômico aconteceu. Caixa é quando o
dinheiro se moveu. São duas colunas e alimentam relatórios diferentes.

**Sentido × Sinal.** O valor é **sempre positivo**. Quem diz se entra ou sai é a coluna
Sentido. Um `-50` numa linha de saída seria uma entrada disfarçada.

**Natureza × Categoria.** São a mesma coisa: a conta do plano de contas. O app usa "natureza"
na tela e "categoria" no banco. Só **natureza folha** (a que não tem filhas) pode receber
lançamento.

---

## Os dois layouts

### Movimentos — alimenta **DRE e Fluxo de Caixa ao mesmo tempo**

É o mesmo lançamento lido por duas datas diferentes. A DRE soma pela competência; o fluxo
soma pelo caixa.

> **Não existe "importar uma DFC".** O fluxo de caixa não é um arquivo que se importa: é uma
> leitura dos mesmos lançamentos por outra data. Se alguém entregar só o relatório de fluxo
> do ERP, o que falta não é um terceiro layout — é o extrato.

### Saldos — alimenta o **Balanço Patrimonial**

O BP é **fotografia por documento**, não acumulação de movimentos. Cada arquivo de balanço é
um retrato numa data, e a tela `/balanco` mostra o retrato mais recente de cada mês.

Por isso uma linha de balanço **não tem** descrição, não tem sentido, não tem data de caixa e
não tem data própria: ela tem conta e saldo. A data é do **arquivo inteiro**.

---

## O que é do arquivo e o que é da linha

Esta é a distinção que resolve a maior parte da confusão.

| Nível | Campos | Onde se informa |
|---|---|---|
| **Arquivo** | tipo de relatório · **data de referência** (obrigatória no balanço) · conta · tipo e número da conta · moeda | no formulário de `/upload`, e no cabeçalho da tela de conferência |
| **Linha** | as colunas da planilha | na planilha |

**A conta é do arquivo.** Um extrato é de uma conta só, e o tipo e o número nunca mudam entre
as linhas dele. Preencher isso linha a linha em 7.762 linhas seria trabalho inventado. As
colunas de conta existem na planilha para o caso raro do extrato consolidado — quando vêm
preenchidas, vencem o cabeçalho.

---

## As duas datas

| Coluna | Alimenta | Regra |
|---|---|---|
| **Data de competência** | DRE e Balanço | Obrigatória |
| **Data de caixa** | Fluxo de Caixa | Opcional |

> **Data de caixa em branco significa "igual à competência". Não repita a competência na
> coluna.**
>
> Repetir e deixar em branco produzem o mesmo número hoje, mas dizem coisas diferentes: em
> branco é *"este arquivo não informa"*, e repetido é *"eu conferi e é o mesmo dia"*. A
> segunda afirmação é forte, e quase nunca é verdade num extrato de cartão.

Como preencher, por tipo de fonte:

| Fonte | Competência | Caixa |
|---|---|---|
| Extrato bancário | data do lançamento | em branco (é o mesmo dia) |
| **Fatura de cartão** | **data da compra** | **vencimento da fatura** |
| Nota fiscal / relatório de ERP | emissão | data do pagamento ou recebimento |
| Venda em adquirente | data da venda | data da liquidação |
| Boleto | emissão | data do pagamento |

O cartão é o caso que mais importa e o mais errado hoje: a compra impacta a DRE no dia da
compra, mas o dinheiro só sai quando a fatura é paga. Com uma data só, a compra sai do fluxo
de caixa no dia errado.

---

## Colunas — layout Movimentos

**Obrigatórias:** Data de competência, Descrição, Valor, Sentido. Todo o resto é opcional.

| Coluna | Obrig. | O que é |
|---|:--:|---|
| Data de competência | ✅ | Quando o fato aconteceu |
| Data de caixa | | Quando o dinheiro se moveu. Em branco = igual à competência |
| Descrição | ✅ | Como aparece no extrato |
| Valor | ✅ | Sempre positivo |
| Sentido | ✅ | `Entrada` ou `Saída` |
| Moeda | | Em branco = BRL |
| Conta | | Nome da conta ou cartão |
| Tipo de conta | | `C. Corrente`, `Poupança`, `Cartão`, `Adquirente`, `Outra` |
| Número da conta | | Agência/conta, ou final do cartão |
| Natureza | | Código ou nome do plano de contas |
| Centro de custo | | *(reservada)* |
| Unidade de negócio | | *(reservada)* |
| Entidade | | *(reservada)* |
| Contato | | *(reservada)* |
| Documento | | *(reservada)* |
| ID de origem | | Id do ERP, quando existe |
| Observação | | *(reservada)* |

**Coluna em branco é legítima.** Vazio significa "não sei", e o pipeline segue: sem natureza o
lançamento vai para a fila de classificação; sem conta, a regra que o app aprender nasce
global; sem data de caixa, o fluxo usa a competência.

**Sobre as colunas marcadas *(reservada)*:** elas existem na planilha e no contrato, mas ainda
não são lidas na importação — resolver "Comercial" contra o cadastro de centros de custo é
trabalho que `previewFlatImport` sabe fazer e o caminho de importação ainda não. Estão
declaradas para o formato não mudar quando o leitor chegar, e o script de conformidade as
reporta como pendência em vez de escondê-las.

### Formato dos campos

- **Datas:** `AAAA-MM-DD` é o formato canônico. O leitor também aceita `DD/MM/AAAA`,
  `DD-MM-AAAA`, `DD.MM.AAAA`, `DD/MM/AA` e o serial do Excel.
- **Valores:** `1.234,56` (BR) e `1,234.56` (US) são aceitos. `R$`, espaços e sinal de mais
  são ignorados.
- **Sentido:** `Entrada`/`Saída` são o canônico; também aceita `crédito`/`débito`, `C`/`D`,
  `receita`/`despesa`, `+`/`-`, `inflow`/`outflow`.
- **Arquivo:** CSV com `;`, UTF-8. BOM é tolerado. Excel (`.xls`/`.xlsx`) também.

---

## Colunas — layout Saldos

**Obrigatórias:** Natureza e Saldo. E a **data de referência**, que é do arquivo.

| Coluna | Obrig. | O que é |
|---|:--:|---|
| Natureza | ✅ | A conta patrimonial. Precisa ser de um tipo de BP |
| Saldo | ✅ | Sempre positivo — a natureza dá o lado |
| Observação | | *(reservada)* |

Os cinco tipos de BP: Ativo Circulante, Ativo Não Circulante, Passivo Circulante, Passivo Não
Circulante, Patrimônio Líquido.

---

## Casos que confundem

**Compra no cartão parcelada.** Uma linha por parcela, com a competência da parcela e o caixa
no vencimento da fatura correspondente. Não some as parcelas numa linha só: a DRE precisa de
cada mês.

**Pagamento da fatura do cartão.** É uma linha no extrato **da conta corrente**, com natureza
de transferência. Não é despesa nova — a despesa já entrou quando a compra aconteceu.
Lançá-la como despesa conta o mesmo gasto duas vezes.

**Transferência entre contas próprias.** Duas linhas, uma em cada extrato, com natureza de
transferência. Elas se anulam e não impactam a DRE.

**Estorno.** Uma linha com o sentido **invertido** em relação ao original, valor positivo.
Estorno de uma saída é uma entrada.

**Linha de balanço.** Só natureza e saldo. A data de referência vai no formulário, não na
planilha.

---

## Deduplicação

O app calcula uma chave de conteúdo por linha — competência, valor, sentido, descrição e
conta, mais a **ordem de ocorrência** dentro do arquivo. Subir o mesmo arquivo duas vezes
insere zero na segunda.

A ordem de ocorrência é o que permite dois cafés idênticos de R$ 15 no mesmo dia serem dois
lançamentos legítimos: eles recebem chaves diferentes, mas o mesmo arquivo reimportado gera
exatamente as mesmas duas chaves.

Quando o arquivo traz **ID de origem**, ele vence o cálculo — é o id do ERP, e ele é melhor
que qualquer hash.

> **Balanço não deduplica.** Reenviar o balanço de janeiro corrigido precisa **substituir** o
> anterior, não ser ignorado. Snapshot se substitui; não se acumula.

E uma ressalva honesta: os lançamentos importados **antes** desta mudança não têm chave. A
deduplicação não os alcança — reimportar um arquivo antigo ainda duplica.

---

## Sobre o `status` — o que o contrato **não** uniformiza

Um lançamento nasce `confirmed` quando houve **aceite humano explícito** (a pessoa aprovou na
tela de conferência, ou confirmou a prévia no MCP), e `pending` quando não houve — que é o
caso do Open Finance, onde ninguém olhou as linhas ainda.

Isso parece divergência entre as portas e não é: uniformizar faria lançamento de banco entrar
na DRE sem ninguém ver. A DRE, o fluxo e o motor de consulta filtram `status NOT IN ('pending',
'duplicate')` justamente por isso.

---

## Onde cada coisa mora

| | |
|---|---|
| A especificação em código | `src/lib/import-contract.ts` |
| A chave de deduplicação | `src/lib/import-dedup.ts` (separado por causa do `node:crypto`) |
| A planilha modelo | `src/lib/csv-templates.ts` — **gerada a partir do contrato**, nunca redigitada |
| O relatório de conformidade | `scripts/verify-import-contract.ts` |
| Datas e valores | `src/lib/format.ts` — `parseDate`, `parseAmount`, `norm` |
