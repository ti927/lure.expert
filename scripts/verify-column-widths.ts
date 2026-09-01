/**
 * As larguras de coluna de `/transacoes`.
 *
 *   npx tsx scripts/verify-column-widths.ts
 *
 * Não toca o banco: a regra é aritmética e leitura de storage. Existe porque o
 * erro aqui **não levanta exceção** — uma largura fora de faixa não quebra a
 * tela, ela encolhe a coluna até o cursor não conseguir mais pegá-la, e o estado
 * ruim fica GRAVADO: recarregar a página não desfaz. É o caso que só um teste
 * alcança.
 *
 * Afirma sobre `COLUNAS_TRANSACOES`, a lista que a tela usa de verdade — uma
 * cópia local provaria a aritmética contra si mesma.
 */
import {
  COLUNAS_TRANSACOES, LARGURA_MINIMA, LARGURA_MAXIMA,
  chaveDeLarguras, clampLargura, larguraParaSalvar, larguraTotal, lerLarguras,
  temCustomizacao, type ColunaRedimensionavel,
} from '@/lib/column-widths'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

const COLS = COLUNAS_TRANSACOES
const PADRAO = lerLarguras(null, COLS)
/** A soma das larguras de fábrica — a largura mínima da tabela. */
const SOMA = 1462

// ═══ 1. A lista da tela ══════════════════════════════════════════════════════
console.log('\n── 1. as colunas ──')
{
  t(COLS.length === 13, `${COLS.length} colunas na ordem do <colgroup>`)

  const ids = new Set(COLS.map(c => c.id))
  t(ids.size === COLS.length, 'nenhum id repetido — id repetido faria duas colunas dividirem a mesma largura')

  const fixas = COLS.filter(c => c.fixa).map(c => c.id)
  t(fixas.join(',') === 'sel,acoes', `as fixas são as de utilidade: ${fixas.join(', ')}`)

  const total = larguraTotal(COLS, PADRAO)
  t(total === SOMA, `a soma padrão é ${total}px — a largura mínima da tabela (era o \`min-w-[1470px]\` solto)`)

  // Toda coluna arrastável precisa caber na faixa, senão nasce já clampada e o
  // "restaurar" mudaria a largura em vez de devolvê-la.
  const foraDaFaixa = COLS.filter(c => !c.fixa && (c.largura < LARGURA_MINIMA || c.largura > LARGURA_MAXIMA))
  t(foraDaFaixa.length === 0,
    `toda largura padrão está entre ${LARGURA_MINIMA} e ${LARGURA_MAXIMA} (restaurar devolve o mesmo número)`)
}

// ═══ 2. O clamp — a coluna que não pode sumir ════════════════════════════════
console.log('\n── 2. a faixa ──')
{
  const casos: [number, number][] = [
    [0, LARGURA_MINIMA],
    [-500, LARGURA_MINIMA],
    [10, LARGURA_MINIMA],
    [5000, LARGURA_MAXIMA],
    [200.4, 200],
    [200.6, 201],
  ]
  for (const [entrada, esperado] of casos) {
    t(clampLargura(entrada) === esperado, `clamp(${entrada}) = ${clampLargura(entrada)} (esperado ${esperado})`)
  }
  t(clampLargura(NaN) === LARGURA_MINIMA, 'clamp(NaN) cai no piso, não em NaN — largura NaN some da tela sem erro')
  t(clampLargura(Infinity) === LARGURA_MAXIMA, 'clamp(Infinity) cai no teto')
  t(lerLarguras({ desc: Infinity }, COLS).desc === 200,
    'mas infinito vindo do storage é corrupção, não intenção: volta ao padrão da coluna, não ao teto')
}

// ═══ 3. Tolerância: storage estranho não impede renderizar ═══════════════════
console.log('\n── 3. o que vem do storage ──')
{
  const lixo: unknown[] = [null, undefined, 'todas iguais', 42, [], { }, { desc: 'largo' }, { desc: null }]
  const todosNoPadrao = lixo.every(b => {
    const l = lerLarguras(b, COLS)
    return COLS.every(c => l[c.id] === c.largura)
  })
  t(todosNoPadrao, 'storage corrompido, vazio ou de outro formato cai no padrão — a tabela sempre renderiza')

  // Id que não existe mais: descartado. Se entrasse no mapa, somaria na largura
  // da tabela uma coluna que ninguém desenha, e sobraria espaço morto à direita.
  const comFantasma = lerLarguras({ desc: 300, coluna_que_nao_existe: 400 }, COLS)
  t(comFantasma.desc === 300, 'id conhecido é honrado')
  t(!('coluna_que_nao_existe' in comFantasma), 'id desconhecido é descartado')
  t(larguraTotal(COLS, comFantasma) === SOMA + 100, `e não entra na soma (${larguraTotal(COLS, comFantasma)}px)`)

  // Coluna fixa: o storage não a alcança nem se alguém editar o JSON à mão.
  const comFixa = lerLarguras({ sel: 400, acoes: 400 }, COLS)
  t(comFixa.sel === 36 && comFixa.acoes === 36, 'coluna fixa ignora o storage — nem editando o JSON à mão')

  // O caso que dá nome à sessão: alguém arrastou até o fim e gravou.
  const perdida = lerLarguras({ category: 0, contact: -80 }, COLS)
  t(perdida.category === LARGURA_MINIMA && perdida.contact === LARGURA_MINIMA,
    `largura gravada em 0 ou negativa volta em ${LARGURA_MINIMA}px — a coluna não se perde para sempre`)
}

// ═══ 4. O que é gravado: só a diferença ══════════════════════════════════════
console.log('\n── 4. a gravação ──')
{
  t(Object.keys(larguraParaSalvar(COLS, PADRAO)).length === 0,
    'no padrão, nada é gravado — a chave é removida em vez de guardar 13 números iguais aos de fábrica')
  t(!temCustomizacao(COLS, PADRAO), 'e o botão "Larguras" não aparece')

  const mexido = { ...PADRAO, desc: 320 }
  const diff = larguraParaSalvar(COLS, mexido)
  t(Object.keys(diff).length === 1 && diff.desc === 320, `mexer numa grava uma: ${JSON.stringify(diff)}`)
  t(temCustomizacao(COLS, mexido), 'e o botão aparece')

  // Por que só a diferença: um padrão novo num deploy futuro TEM de alcançar
  // quem nunca tocou naquela coluna.
  const COLS_FUTURAS: ColunaRedimensionavel[] = COLS.map(c =>
    c.id === 'account' ? { ...c, largura: 220 } : { ...c })
  const depoisDoDeploy = lerLarguras(diff, COLS_FUTURAS)
  t(depoisDoDeploy.account === 220, 'coluna que a pessoa nunca arrastou segue o padrão NOVO do deploy')
  t(depoisDoDeploy.desc === 320, 'e a que ela arrastou continua onde ela deixou')

  // Coluna nova numa versão futura aparece com o padrão dela, sem quebrar nada.
  const COLS_COM_NOVA: ColunaRedimensionavel[] = [...COLS, { id: 'observacao', largura: 160 }]
  const comNova = lerLarguras(diff, COLS_COM_NOVA)
  t(comNova.observacao === 160, 'coluna nova entra com o padrão dela')
}

// ═══ 5. O arrasto, em números ════════════════════════════════════════════════
console.log('\n── 5. o arrasto ──')
{
  // O que o `pointermove` faz: largura inicial + (clientX atual − clientX inicial).
  const arrastar = (largura: Record<string, number>, id: string, delta: number) =>
    ({ ...largura, [id]: clampLargura(largura[id] + delta) })

  const alargado = arrastar(PADRAO, 'desc', 150)
  t(alargado.desc === 350, 'arrastar +150px na Descrição → 350px')
  t(larguraTotal(COLS, alargado) === SOMA + 150,
    `e a tabela cresce o mesmo tanto (${larguraTotal(COLS, alargado)}px) — é isso que rola lateralmente`)

  const outras = COLS.filter(c => c.id !== 'desc').every(c => alargado[c.id] === PADRAO[c.id])
  t(outras, 'nenhuma outra coluna se mexe — era o efeito do `w-full` com soma menor que o mínimo')

  const encolhido = arrastar(PADRAO, 'date', -400)
  t(encolhido.date === LARGURA_MINIMA, `arrastar −400px na Data para no piso (${encolhido.date}px)`)

  // Duplo-clique restaura só aquela.
  const restaurada = { ...alargado, desc: COLS.find(c => c.id === 'desc')!.largura }
  t(larguraTotal(COLS, restaurada) === SOMA, `duplo-clique na alça devolve a coluna e a soma volta a ${SOMA}px`)

  // E o botão da barra devolve tudo de uma vez.
  const tudoMexido = arrastar(arrastar(alargado, 'category', -60), 'contact', 200)
  t(temCustomizacao(COLS, tudoMexido), 'com três colunas mexidas o botão está lá')
  t(!temCustomizacao(COLS, lerLarguras(null, COLS)), 'e "Larguras" devolve as 13 ao padrão, sumindo em seguida')
}

// ═══ 6. A chave não colide com a dos filtros ═════════════════════════════════
console.log('\n── 6. o storage ──')
{
  const chave = chaveDeLarguras('transacoes')
  t(chave === 'lure:transacoes:colwidths', `chave: ${chave}`)
  t(chave !== 'lure:transacoes:filters',
    'diferente da chave de filtros — "Limpar" apaga filtro e não pode levar o layout junto')
  t(chaveDeLarguras('dre') !== chave, 'e cada tabela tem a sua')
}

console.log(`\n${ok} ok · ${falhas} falhas`)
process.exit(falhas > 0 ? 1 : 0)
