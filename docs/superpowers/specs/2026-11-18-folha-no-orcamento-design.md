# Folha de pagamento no orçamento — desenho

**Data:** 18/nov/2026 · **Pedido de:** Julio · **Fase:** extensão da Fase 9 (Orçamento)

## 1. Intenção

Hoje o orçamento de pessoal é digitado como valor total ("Salários: R$ 80.000/mês"). O valor não
diz de onde vem, não acompanha contratação, desligamento ou dissídio, e os encargos são estimados
à mão — errados com frequência, porque dependem do regime tributário de cada empresa do grupo.

O pedido: **cadastrar as pessoas (e as vagas) com seus custos, e o app gerar a folha do período**
com encargos calculados pelo regime da unidade jurídica onde cada pessoa está, distribuindo os
valores nas naturezas configuradas.

**Sucesso:** o controller cadastra o quadro uma vez, clica em "Gerar folha", e a DRE orçada, o
Orçado × Realizado e o Fluxo projetado passam a ter pessoal correto por natureza, por centro de
custo e por unidade jurídica — e um cenário "com 3 contratações a menos" é apagar 3 linhas e gerar
de novo.

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos (v1)**
- Quadro de pessoal **por versão de orçamento**, com 5 vínculos: CLT, PJ, pró-labore, estagiário,
  e **vaga a contratar** (qualquer um dos 4, sem nome, com mês previsto de entrada).
- Encargos de CLT e pró-labore calculados pelo **regime da unidade jurídica** (Lucro Real,
  Lucro Presumido, Simples — com distinção do Anexo IV).
- 13º e férias com tratamento **escolhido pelo usuário, por versão**: provisão mensal (padrão) ou
  no mês do pagamento.
- Benefícios por pessoa, em todos os vínculos.
- Mapa de naturezas da organização por componente, com **exceção por pessoa**.
- Geração em prévia + confirmação, gravando lançamentos orçados **por pessoa e componente**.
- Duplicar versão leva o quadro junto; versão nova pode copiar o quadro de outra.

**Não-objetivos (v1)** — declarados, ficam para depois
- Rescisão (aviso prévio, multa de 40% do FGTS, férias/13º proporcionais na saída). O mês de
  desligamento apenas encerra os lançamentos.
- INSS e IRRF **do empregado** — são descontos do bruto, não custo da empresa. O custo é o bruto.
- Horas extras variáveis, PLR, comissões. Existe um campo de "outros proventos fixos" (adicional
  de periculosidade, insalubridade, gratificação) que sofre encargos.
- CPRB (desoneração sobre receita). A empresa desonerada ajusta a alíquota patronal na unidade
  jurídica e orça a CPRB como lançamento comum.
- Folha **realizada** / integração com sistema de folha. Isto é só orçamento.
- Ferramentas MCP específicas do quadro. O expert já enxerga o resultado pelo `consultar`
  (fonte `orcado`); criar/editar pessoas pelo claude.ai é v1.1.
- Importar o quadro por planilha — v1.1.

**Anti-objetivos** — o que tornaria isto um fracasso mesmo funcionando
- **Quadro e orçamento divergirem em silêncio.** Se o quadro mudou depois da última geração, a
  tela diz isso.
- **Gerar a folha apagar lançamento que não veio dela.** A substituição é só da origem `folha`.
- Percentual de encargo cravado no código sem passar pela unidade jurídica.
- Dupla contagem do mês de férias (ver 5.3).

## 3. Restrições do projeto

- `budget_entries` é a **única fonte da verdade** de número orçado (Decisão 13). A folha
  **grava lançamentos**; nada a calcula na leitura.
- Natureza obrigatória e **folha** (Natureza Filho) em toda série (`category_id NOT NULL`).
- RLS por `organization_id` em toda tabela nova, com o script de teste de RLS atualizado.
- Migration validada com ROLLBACK antes de entregar; Julio (ou eu, com o roteiro de subida
  autônoma) aplica. Próximo número livre é **0036** (a 0035 está no branch `feat/pluggy-hardening`).
- Escrita do orçamento: **member+** (como o resto do orçamento). Leitura: todo papel —
  **decisão do Julio: todos que veem o orçamento veem os salários**.
- Lógica em `/lib` (cálculo puro + escrita recebendo `tx`), `server/` como casca.
- Toda tabela nova na tela segue `docs/DATA_TABLE_PATTERN.md`; os 5 estados.

## 4. Abordagens consideradas

| | Abordagem | Veredito |
|---|---|---|
| **A** | **Quadro pertence à versão.** Cada versão tem suas pessoas; duplicar copia o quadro | **Escolhida por Julio.** Cenários são naturais; regenerar versão antiga não reescreve o passado. Custo: a mesma pessoa existe em várias versões, e mudar o salário numa não muda nas outras |
| B | Quadro único da organização; versão só gera a partir dele | Cenário exigiria exceções por versão (A com mais complexidade); regenerar versão antiga com o cadastro de hoje reescreveria o passado |
| C | Folha calculada na leitura, sem gravar | Descartada: cria uma segunda fonte de número orçado e quebra a conciliação DRE × Orçado × Realizado × MCP |

## 5. O cálculo

### 5.1 Parâmetros da unidade jurídica (migration nova em `legal_entities`)

| Campo | Padrão | Observação |
|---|---|---|
| `regime_tributario` | — (obrigatório para gerar CLT/pró-labore) | `lucro_real` \| `lucro_presumido` \| `simples` |
| `simples_anexo_iv` | `false` | Só faz sentido no Simples |
| `aliquota_inss_patronal` | 20% | Empresa desonerada informa a alíquota da transição da Lei 14.973/2024 para o exercício (10% em 2026, 15% em 2027, 20% em 2028) — a dica na tela cita a lei e o exercício da versão |
| `aliquota_rat_fap` | 2% | RAT (1/2/3%) × FAP (0,5–2,0), já multiplicados |
| `aliquota_terceiros` | 5,8% | Sistema S + salário-educação + INCRA; varia pelo FPAS |
| `aliquota_fgts` | 8% | |

Quando o regime não está informado, **a geração recusa** nomeando as unidades jurídicas sem
regime e as pessoas afetadas — não assume um padrão.

### 5.2 O que incide, por regime

| Encargo | Real / Presumido | Simples (Anexos I, II, III, V) | Simples Anexo IV |
|---|---|---|---|
| INSS patronal | ✓ | — (no DAS) | ✓ |
| RAT × FAP | ✓ | — (no DAS) | ✓ |
| Terceiros | ✓ | — | — |
| FGTS (só CLT) | ✓ | ✓ | ✓ |

Base de incidência (CLT): salário + outros proventos fixos, 13º e férias + 1/3.
Pró-labore: só INSS patronal (onde incide), sem FGTS, sem RAT, sem terceiros, sem 13º/férias.
Estagiário: bolsa + benefícios, **sem encargos e sem 13º/férias** (o recesso é remunerado dentro da
bolsa, não é custo adicional). Seguro de estágio entra como benefício.
PJ: honorário + benefícios, sem encargos.

### 5.3 13º e férias (CLT)

**Custo anual = 12 salários + 13º + 1/3 de férias** (+ encargos sobre tudo). O mês em que a pessoa
está de férias **já está** entre os 12 salários; provisionar "férias + 1/3" inteiro por cima
contaria o salário desse mês duas vezes. Por isso o componente de férias é **só o terço**.
*(Decisão minha, para Julio conferir.)*

| Modo (por versão) | 13º | 1/3 de férias |
|---|---|---|
| **Provisão mensal** (padrão) | 1/12 do salário por mês ativo, na competência do mês | 1/12 do terço por mês ativo |
| **No mês do pagamento** | 13º proporcional aos meses ativos no ano, na competência de dezembro | O terço no mês de férias informado, se ativo |

Os encargos de 13º e de férias seguem o mesmo modo.

**Complemento em dezembro (decisão do Julio):** o 13º devido é o salário de dezembro × avos, e o
terço é sobre o salário do mês de férias. Com dissídio ou reajuste no meio do ano, o 1/12 mensal
fica abaixo do devido. No modo provisão, a provisão de **dezembro** (13º) e a do **mês de férias**
(terço) recebem o complemento que fecha com o valor devido. Invariante testada: **o custo anual de
uma pessoa é o mesmo nos dois modos**; só a distribuição por mês muda.

### 5.4 Reajuste e período

- **Dissídio por versão:** mês + percentual, aplicado a CLT a partir daquele mês. A pessoa pode
  ser marcada "não aplicar dissídio". PJ, pró-labore e estágio têm reajuste próprio opcional
  (mês + %), na pessoa.
- **Meses ativos:** de `mês de entrada` (padrão: janeiro do exercício) a `mês de saída`
  (padrão: dezembro). PJ tem, em vez disso, a **lista dos meses** em que é lançado (pedido do
  Julio). Vaga usa o mês previsto de entrada.

### 5.5 Datas de caixa

| Componente | Competência | Caixa |
|---|---|---|
| Salário, pró-labore, bolsa, benefícios | mês | dia 5 do mês seguinte |
| INSS/RAT/terceiros e FGTS do mês | mês | dia 20 do mês seguinte |
| Honorário PJ | mês | dia de pagamento da pessoa (padrão: dia 10 do mês seguinte) |
| 13º | conforme o modo | 50% em 30/nov, 50% em 20/dez |
| INSS/RAT/terceiros do 13º | conforme o modo | 20/dez |
| FGTS do 13º | conforme o modo | metade em 20/dez (1ª parcela), metade em 20/jan do ano seguinte (2ª) |
| Salário do mês de férias + 1/3 | conforme o modo | dia 1 do mês de férias (CLT art. 145: pago até 2 dias antes do início) |
| Encargos das férias | conforme o modo | dia 20 do mês seguinte às férias |

No modo provisão, a provisão de 13º de março tem competência em março e caixa em novembro/dezembro
— que é o motivo de o orçamento ter as duas datas. **Caixa pode cair no exercício seguinte** (FGTS
da 2ª parcela, provisão de férias que só se paga no ano seguinte): o orçamento já permite isso
desde a 9.0 (exercício validado só na competência) e o comparativo já avisa a cauda de caixa.

**Casos que a tabela não cobre — decisões minhas:**
- Provisão de férias **sem mês de férias informado**: o mês de férias padrão é o aniversário do mês
  de entrada; sem mês de entrada no exercício, dezembro.
- Provisão de férias **acumulada depois das férias do ano**: caixa no mês de férias do ano
  seguinte (mesmo mês).
- Pessoa que **sai antes do pagamento**: as provisões acumuladas (13º e terço) têm caixa no dia 10
  do mês seguinte à saída — o prazo de pagamento da rescisão (CLT art. 477). A rescisão em si (aviso, multa de 40%) segue fora da v1.
- Salário no **dia 5** = 5º dia útil simplificado; VT e VR saem com o salário (na prática são
  pagos antes do mês). Declarado na tela.

### 5.6 Exemplo conferível (vai para o teste)

CLT, R$ 5.000, Lucro Presumido, RAT×FAP 2%, terceiros 5,8%, FGTS 8%, modo provisão, ano inteiro:

| Componente | Mês |
|---|---:|
| Salário | 5.000,00 |
| INSS + RAT + terceiros (27,8%) | 1.390,00 |
| FGTS (8%) | 400,00 |
| Provisão 13º (1/12) | 416,67 |
| Encargos s/ 13º (35,8%) | 149,16 (115,83 + 33,33, arredondados por parte) |
| Provisão 1/3 férias (5.000/3/12) | 138,89 |
| Encargos s/ férias (35,8%) | 49,72 |

Custo anual: 12 × 6.790,00 + 6.790,00 (13º com encargos) + 2.263,33 (terço com encargos) =
**90.533,33**, igual nos dois modos. Com dissídio de 5% em maio, o caso de teste confere também o
complemento de dezembro.

A mesma pessoa no Simples (Anexo III): só FGTS — 400,00; 33,33; 11,11.
Arredondamento: centavo por lançamento; a soma do ano do componente fecha com o cálculo anual
pelo maior resto (mesma técnica de `allocation-math.ts`).

### 5.7 Benefícios — decisões minhas

- Seguem os **meses ativos** da pessoa; no PJ, a lista de meses.
- O valor informado é o **custo líquido para a empresa** (VT já descontados os 6%).
- Não param no mês de férias (simplificação declarada).
- Sem encargos (VR/VA pelo PAT, plano de saúde, VT).

## 6. Mapa de naturezas

**Componentes:** salário · outros proventos · INSS patronal (+RAT+terceiros) · FGTS · 13º ·
1/3 de férias · encargos sobre 13º e férias · pró-labore · INSS sobre pró-labore · bolsa de
estágio · honorário PJ · benefícios.

- **Mapa da organização**, um destino (Natureza Filho) por componente. Pré-preenchido casando
  com o plano padrão (5.1.1 Salários, 5.1.2 Encargos, 5.1.3 Benefícios, 5.1.4 13º e Férias,
  5.1.5 Pró-labore); o que não casar fica vazio e **a geração recusa** nomeando o componente.
- **Exceção por pessoa:** a pessoa pode sobrepor qualquer componente (ex.: equipe de produção em
  CPV).
- **Benefício** pode ter natureza própria; sem ela, usa a do componente "benefícios".
- Precedência: benefício > exceção da pessoa > mapa da organização.

## 7. Dados

Tabelas novas (todas com `organization_id` + RLS):

- **`budget_payroll_settings`** — uma por versão: modo de 13º/férias, mês e % do dissídio,
  `generated_at` (última geração).
- **`budget_people`** — por versão: nome (nulo em vaga), `is_vacancy`, vínculo
  (`clt`|`pj`|`pro_labore`|`estagio`), cargo (texto livre), unidade jurídica (obrigatória para
  CLT e pró-labore; **uma só**, porque define o regime), contato (útil no PJ), valor base, outros proventos,
  mês de entrada/saída, meses do PJ (`int[]`), mês de férias, dia de pagamento do PJ, reajuste
  próprio, `aplica_dissidio`, exceções de natureza (`jsonb` componente → categoria), observação,
  `updated_at`.
- **`budget_people_allocations`** — **alocação da pessoa (decisão do Julio: pode dividir em %)**:
  pessoa, centro de custo, UEN, percentual. Soma exata de 100% (recusada na escrita); uma linha só
  = pessoa inteira num CC/UEN; CC ou UEN vazios valem como "sem". Sem nenhuma linha, os lançamentos
  saem sem CC e sem UEN e a prévia avisa.
- **`budget_people_benefits`** — pessoa, nome, valor mensal, natureza opcional.
- **Mapa da organização** — tabela `payroll_category_map (organization_id, componente,
  category_id)` com FK `RESTRICT` para a categoria (escolha minha: `jsonb` em `settings` não
  protegeria contra apagar a natureza).
- `legal_entities` ganha as colunas de 5.1.
- `budget_series.source` ganha `'folha'` (CHECK + `BUDGET_SOURCES`). A série guarda em `metadata`
  o `person_id` e o componente.

**Como a folha vira lançamento:** uma série por pessoa × componente, origem `folha`. O motor
grava as **ocorrências diretamente** com a data de caixa de 5.5 — não passa por `expandSeries`,
porque o `cash_lag_days` fixo da série não expressa "dia 5 do mês seguinte" nem "20 de dezembro".
A série fica como agrupador e rótulo ("Folha · Maria Silva · FGTS").

**Dimensões** de cada lançamento vêm da pessoa: unidade jurídica e contato direto; centro de custo
e UEN pela **alocação**. Com N alocações, cada componente vira **N séries** (pessoa × componente ×
alocação), o valor partido pelo percentual em centavos com **maior resto** (`applyProportion` de
`allocation-math.ts`), de modo que a soma das partes fecha exata com o componente. Não usa o
rateio de `transaction_allocations` — aquilo é do realizado; o orçamento tem uma dimensão por
lançamento (Fase 10). Vaga sem nome aparece como "Vaga · <cargo>".

## 8. Comportamento

- **Gerar folha** (member+): prévia com total por componente × mês e por pessoa, recusas
  nomeadas (regime ausente, natureza não mapeada, natureza arquivada). Confirmar apaga as séries
  `folha` da versão e grava as novas, numa transação, registrando em `agent_events`.
- **Lançamentos da folha são só leitura** no `/orcamento`: editar ou excluir série/ocorrência de
  origem `folha` é recusado pela action com "editar no quadro de pessoal". O mesmo vale para as
  escritas do MCP sobre orçamento.
- **Aviso de desatualização:** se alguma pessoa, benefício, parâmetro da versão, mapa ou
  parâmetro de unidade jurídica mudou depois de `generated_at`, a aba e o Planejamento mostram
  "o quadro mudou desde a última geração".
- **Duplicar versão** copia `budget_payroll_settings`, `budget_people`, benefícios, e **preserva
  a origem `folha`** nas séries copiadas (hoje a duplicação grava `'duplicacao'`; mantida, a
  próxima geração não as substituiria e a folha dobraria).
- **Copiar quadro de outra versão** (de outro exercício também): substitui o quadro desta versão
  depois de confirmação; não gera.
- Versão arquivada: quadro só leitura, como o resto.
- **Aviso no Orçado × Realizado (decisão do Julio):** no modo provisão e no regime Competência,
  as naturezas que recebem 13º/férias mostram uma nota: "o orçado provisiona 1/12 por mês; o
  realizado só registra no pagamento — use o regime Caixa para comparar mês a mês".

## 9. Telas

- **`/orcamento` → aba nova "Quadro de pessoal"**: barra com versão, modo de 13º/férias,
  dissídio, "Naturezas da folha", "Copiar quadro de…", "Gerar folha"; tabela (DATA_TABLE_PATTERN)
  com nome/vaga, vínculo, cargo, unidade jurídica, CC, UEN, contato, valor base, meses, custo
  total anual calculado; filtros no cabeçalho pelas dimensões.
- **Diálogo da pessoa**: campos por vínculo (PJ mostra os 12 meses como seleção; CLT mostra mês
  de férias e dissídio), benefícios em lista editável, exceções de natureza recolhidas, e
  **prévia ao vivo do custo mensal por componente** (o cálculo é puro, roda no navegador — mesmo
  padrão do `series-dialog`).
- **Unidade jurídica** em `/configuracoes`: os campos de 5.1 no gerenciador de dimensões
  (`extraFields`), com os padrões preenchidos.

```
 Quadro de pessoal · Orçamento 2027 (vigente)          [Naturezas] [Copiar de…] [Gerar folha]
 13º/férias: (•) provisão mensal ( ) no pagamento    Dissídio: maio  5,0%
 ⚠ O quadro mudou desde a última geração (12/nov 14:20).
 ┌───────────────┬─────────┬──────────┬───────────┬────────────┬───────────┬──────────────┐
 │ Nome          │ Vínculo │ Cargo    │ Und. jur. │ C. custo   │ Base/mês  │ Custo ano    │
 ├───────────────┼─────────┼──────────┼───────────┼────────────┼───────────┼──────────────┤
 │ Maria Silva   │ CLT     │ Analista │ Lure LP   │ Fin 60/Op 40│  5.000,00 │   90.533,33  │
 │ Vaga          │ CLT     │ Vendedor │ Lure SN   │ Comercial  │  3.000,00 │   (a partir mar)│
 │ João Souza    │ PJ      │ Dev      │ Lure LP   │ TI         │ 12.000,00 │   96.000,00  │
 └───────────────┴─────────┴──────────┴───────────┴────────────┴───────────┴──────────────┘
```

## 10. Sessões propostas

| # | Entrega |
|---|---|
| 1 | Migration 0036 (+ reversa) e schema Drizzle; `lib/payroll-calc.ts` puro com os exemplos de 5.6 como teste, nos 4 regimes e 5 vínculos |
| 2 | `lib/payroll-write.ts`: CRUD do quadro, mapa, prévia e geração; substituição por origem; duplicação preservando `folha`; bloqueio de edição das séries `folha` (tela e MCP). Verificação contra o banco local |
| 3 | Telas: aba Quadro de pessoal, diálogo com prévia ao vivo, mapa de naturezas, campos da unidade jurídica, aviso de desatualização |
| 4 | Documentação (Decisão nova em `SCHEMA_DECISIONS.md`, `CLAUDE.md`), subida |

## 11. Decisões do Julio

- Quadro pertence à versão (abordagem A).
- 13º/férias: escolhido pelo usuário (proposto: por versão, padrão provisão mensal).
- Lançamentos por pessoa; todos que veem o orçamento veem salários.
- Mapa de naturezas da organização + exceção por pessoa.
- v1 com CLT, PJ, pró-labore, estagiário e vagas.
- Pessoa alocada em centros de custo e unidades de negócio, **podendo dividir em %**.
- Complemento em dezembro / no mês de férias, para os dois modos fecharem o mesmo custo anual.
- Aviso no Orçado × Realizado em vez de mudar o padrão.

## 12. Decisões minhas, para conferir

- O componente de férias é só o 1/3 (evita contar o mês de férias duas vezes).
- O modo de 13º/férias é por versão (não por pessoa nem por organização).
- Dissídio por versão, com exceção por pessoa.
- Datas de caixa da tabela 5.5 fixas na v1 (não configuráveis), exceto o dia de pagamento do PJ.
- Geração recusa em vez de assumir padrão quando falta regime ou natureza.
- Lançamentos da folha só leitura no `/orcamento`.
- Mapa da organização em tabela com FK, não em `settings`.
- Casos de caixa de 5.5 (mês de férias padrão, provisão pós-férias, saída antes do pagamento).
- Benefícios (5.7): seguem meses ativos, valor líquido, não param nas férias.
- `simples_anexo_iv` como booleano por unidade jurídica: empresa do Simples com atividades em
  Anexo IV **e** outro anexo não é coberta na v1.
