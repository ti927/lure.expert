// O painel padrão — a tela de hoje, escrita como blocos.
//
// Ele é VIRTUAL por decisão de produto (25/ago): só admin+ cria painel, e o
// seed preguiçoso do plano criaria linhas em nome de um viewer que visitasse
// primeiro. Então quem não tem painel nenhum vê ESTES blocos renderizados sem
// nada ir ao banco, e admin+ ganha o botão que os materializa para
// personalizar (`materializarPainelPadrao`, no store).
//
// As listas de tipos vêm de `kpis.ts` — o mesmo lugar de onde o cálculo
// hardcoded sempre leu. Duas cópias divergiriam em silêncio.

import { blockSpecSchema, type BlockSpec, type BlockSpecInput } from './block-spec'
import { TIPOS_DESPESA, TIPOS_RESULTADO, TIPOS_SAIDA_CAIXA } from './kpis'

export const PAINEL_PADRAO_NOME = 'Visão geral'
export const PAINEL_PADRAO_SLUG = 'visao-geral'

/** Um mês, no regime dado — as datas são ignoradas no modo herdado; o que vale é o regime. */
const umMes = (regime: 'competencia' | 'caixa') =>
  ({ tipo: 'relativo', meses: 1, regime }) as const

export function blocosDoPainelPadrao(): BlockSpecInput[] {
  return [
    {
      versao: 1, tipo: 'kpi', titulo: 'Receita do Mês', largura: 3,
      query: {
        fonte: 'realizado', medidas: ['valor_liquido'], periodo: umMes('competencia'),
        filtros: { tiposDeCategoria: ['receita_operacional'] },
      },
      periodo: { modo: 'herda_do_painel', janela: 'mes' },
      comparar: true,
    },
    {
      versao: 1, tipo: 'kpi', titulo: 'Despesas', largura: 3,
      query: {
        fonte: 'realizado', medidas: ['valor_liquido'], periodo: umMes('competencia'),
        filtros: { tiposDeCategoria: [...TIPOS_DESPESA] },
      },
      periodo: { modo: 'herda_do_painel', janela: 'mes' },
      comparar: true,
      // Com tipos de despesa, valor_liquido sai negativo; o cartão mostra o
      // gasto positivo, e subir é ruim.
      inverterSinal: true,
      menorEhMelhor: true,
    },
    {
      versao: 1, tipo: 'kpi', titulo: 'Lucro Líquido', largura: 3,
      query: {
        fonte: 'realizado', medidas: ['valor_liquido'], periodo: umMes('competencia'),
        filtros: { tiposDeCategoria: [...TIPOS_RESULTADO] },
      },
      periodo: { modo: 'herda_do_painel', janela: 'mes' },
      comparar: true,
    },
    {
      versao: 1, tipo: 'kpi', titulo: 'Saldo em Caixa', largura: 3,
      query: {
        fonte: 'realizado', medidas: ['valor_liquido'], periodo: umMes('caixa'),
        // O saldo é o caixa como ele é: transferências e contas patrimoniais
        // entram, nada de ocultação — o mesmo contrato do cálculo de sempre.
        filtros: { excluirBalanco: false, visibilidade: 'todas' },
      },
      periodo: { modo: 'herda_do_painel', janela: 'acumulado' },
      comparar: false,
    },
    {
      versao: 1, tipo: 'alertas', largura: 12,
    },
    {
      versao: 1, tipo: 'serie', titulo: 'Fluxo de Caixa — 90 dias', largura: 12,
      query: {
        fonte: 'realizado', medidas: ['entradas', 'saidas'], agruparPor: ['semana'],
        periodo: umMes('caixa'),
        filtros: { excluirBalanco: false, visibilidade: 'todas' },
        limite: 500,
      },
      periodo: { modo: 'herda_do_painel', janela: 'ultimos_dias', tamanho: 90 },
      visual: 'barra',
    },
    {
      versao: 1, tipo: 'ranking', titulo: 'Top 5 Categorias de Despesa', largura: 12,
      query: {
        fonte: 'realizado', medidas: ['saidas'], agruparPor: ['categoria'],
        periodo: umMes('caixa'),
        filtros: {
          direcao: 'outflow',
          tiposDeCategoria: [...TIPOS_SAIDA_CAIXA],
          visibilidade: 'caixa',
          excluirBalanco: true,
        },
        ordenarPor: [{ por: 'saidas', direcao: 'desc' }],
        limite: 5,
      },
      periodo: { modo: 'herda_do_painel', janela: 'mes' },
      visual: 'lista',
      mostrarPercentual: true,
    },
    {
      versao: 1, tipo: 'indicador', titulo: 'Indicadores Financeiros', largura: 12,
      periodo: { modo: 'herda_do_painel', janela: 'mes' },
    },
  ]
}

/**
 * Os blocos padrão, já validados. Se um dia o schema mudar e o padrão ficar
 * para trás, isto LANÇA — melhor quebrar o build/teste que renderizar lixo na
 * primeira visita de todo mundo.
 */
export function blocosDoPainelPadraoValidados(): BlockSpec[] {
  return blocosDoPainelPadrao().map(b => blockSpecSchema.parse(b))
}
