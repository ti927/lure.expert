/**
 * A agenda de sincronização dos bancos, por organização.
 *
 *   DATABASE_URL="<pooler>" npx tsx scripts/verify-sync-schedule.ts
 *
 * A regra é aritmética que **não levanta exceção quando erra**: um engano aqui
 * faz uma organização parar de sincronizar em silêncio, ou sincronizar 24×/dia
 * sem ninguém pedir. Por isso o teste exercita as 24 horas do dia contra cada
 * frequência publicada, em vez de um caso feliz.
 *
 * A parte final é uma SIMULAÇÃO contra o banco real: quantas organizações o
 * cron despacharia em cada hora, hoje. Não escreve nada.
 */
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import {
  AGENDA_PADRAO, CHAVE_DE_AGENDA, FREQUENCIAS_DE_SYNC,
  agendaDeSyncSchema, lerAgenda, deveRodarAgora, horariosDoDia,
  horaEmBrasilia, descreverAgenda, formatarHora, rotuloDeFrequencia,
  type AgendaDeSync,
} from '@/lib/sync-schedule'

let ok = 0, falhas = 0
const t = (bom: boolean, msg: string) => { bom ? ok++ : falhas++; console.log(`${bom ? 'OK  ' : 'FALHA'} | ${msg}`) }

const HORAS = Array.from({ length: 24 }, (_, h) => h)

async function main() {
  // ═══ 1. O padrão preserva o comportamento anterior ════════════════════════
  console.log('\n── 1. o padrão é o cron de antes ──')
  {
    t(AGENDA_PADRAO.horaInicial === 3 && AGENDA_PADRAO.aCada === 24,
      'padrão = 03:00, 1× por dia (o antigo `0 6 * * *` em UTC)')

    const rodou = HORAS.filter(h => deveRodarAgora(AGENDA_PADRAO, h))
    t(rodou.length === 1 && rodou[0] === 3,
      `com o padrão, das 24 horas do dia roda EXATAMENTE uma: ${rodou.map(formatarHora).join(', ')}`)

    t(lerAgenda(null).aCada === 24 && lerAgenda({}).horaInicial === 3,
      'settings vazio ou nulo cai no padrão — organização que nunca configurou não muda de comportamento')
  }

  // ═══ 2. A regra nas 24 horas × cada frequência ════════════════════════════
  console.log('\n── 2. a aritmética, hora a hora ──')
  {
    for (const aCada of FREQUENCIAS_DE_SYNC) {
      let todasBatem = true
      for (const horaInicial of HORAS) {
        const agenda: AgendaDeSync = { horaInicial, aCada }
        const horas = horariosDoDia(agenda)
        // Quantidade certa, começa na hora escolhida, e o passo é constante.
        const esperado = 24 / aCada
        const conjunto = new Set(horas)
        const previsto = new Set(
          Array.from({ length: esperado }, (_, i) => (horaInicial + i * aCada) % 24),
        )
        const igual = conjunto.size === previsto.size && horas.every(h => previsto.has(h))
        if (horas.length !== esperado || !conjunto.has(horaInicial) || !igual) {
          todasBatem = false
          console.log(`      ↳ falhou em horaInicial=${horaInicial}, aCada=${aCada}: [${horas.join(',')}]`)
        }
      }
      t(todasBatem, `a cada ${aCada}h → ${24 / aCada} execução(ões)/dia, para as 24 horas iniciais`)
    }

    // 24/aCada é inteiro para toda frequência publicada — senão a última janela
    // do dia seria mais curta que as outras e o horário "andaria" a cada dia.
    t(FREQUENCIAS_DE_SYNC.every(f => 24 % f === 0),
      'toda frequência publicada divide 24 — sem janela quebrada virando o dia')
  }

  // ═══ 3. A volta da meia-noite ═════════════════════════════════════════════
  console.log('\n── 3. a volta da meia-noite ──')
  {
    const agenda: AgendaDeSync = { horaInicial: 22, aCada: 6 }
    const horas = horariosDoDia(agenda)
    t(horas.join(',') === '4,10,16,22',
      `"a partir das 22:00, a cada 6h" inclui 04:00 e 10:00 do dia seguinte (${horas.map(formatarHora).join(', ')})`)
    t(deveRodarAgora(agenda, 0) === false, 'e NÃO roda à meia-noite, que não está na sequência')
  }

  // ═══ 4. O texto sai da mesma regra ════════════════════════════════════════
  console.log('\n── 4. a frase da tela ──')
  {
    t(descreverAgenda({ horaInicial: 3, aCada: 24 }) === 'todo dia às 03:00',
      `1×/dia → "${descreverAgenda({ horaInicial: 3, aCada: 24 })}"`)
    const frase = descreverAgenda({ horaInicial: 7, aCada: 6 })
    t(frase === 'a partir das 07:00, a cada 6 horas (07:00, 13:00, 19:00, 01:00)',
      `frequência → "${frase}"`)
    // Toda hora citada na frase é uma hora em que o cron de fato roda.
    const agenda: AgendaDeSync = { horaInicial: 7, aCada: 6 }
    const citadas = (frase.match(/\d{2}:00/g) ?? []).map(s => Number(s.slice(0, 2)))
    t(citadas.every(h => deveRodarAgora(agenda, h)),
      'e cada horário citado no texto é um horário em que a regra manda rodar')
    t(rotuloDeFrequencia(24) === '1× por dia' && rotuloDeFrequencia(6) === 'a cada 6 horas',
      'rótulos do seletor')
  }

  // ═══ 5. Entrada inválida não derruba o cron das outras ════════════════════
  console.log('\n── 5. tolerância ──')
  {
    const lixo = [
      { [CHAVE_DE_AGENDA]: { horaInicial: 25, aCada: 24 } },
      { [CHAVE_DE_AGENDA]: { horaInicial: 3, aCada: 5 } },   // não divide 24
      { [CHAVE_DE_AGENDA]: { horaInicial: '7', aCada: 6 } },  // texto
      { [CHAVE_DE_AGENDA]: 'todo dia' },
      { [CHAVE_DE_AGENDA]: null },
      { autoCategorize: true },
    ]
    const todosNoPadrao = lixo.every(s => {
      const a = lerAgenda(s)
      return a.horaInicial === AGENDA_PADRAO.horaInicial && a.aCada === AGENDA_PADRAO.aCada
    })
    t(todosNoPadrao, 'settings corrompido cai no padrão — o cron serve TODAS as organizações e não pode quebrar por uma')

    // A escrita, ao contrário da leitura, RECUSA: aqui há alguém para corrigir.
    t(!agendaDeSyncSchema.safeParse({ horaInicial: 24, aCada: 24 }).success, 'a escrita recusa hora 24')
    t(!agendaDeSyncSchema.safeParse({ horaInicial: 3, aCada: 5 }).success, 'a escrita recusa frequência fora do catálogo')
    t(agendaDeSyncSchema.safeParse({ horaInicial: 0, aCada: 2 }).success, 'e aceita 00:00 a cada 2 horas')
  }

  // ═══ 6. horaEmBrasilia contra o Intl, no verão e no inverno ═══════════════
  console.log('\n── 6. o fuso ──')
  {
    const casos = [
      { utc: '2026-01-15T06:00:00Z', esperado: 3 },
      { utc: '2026-07-15T06:00:00Z', esperado: 3 },
      { utc: '2026-07-15T02:30:00Z', esperado: 23 }, // vira o dia para trás
      { utc: '2026-07-15T03:00:00Z', esperado: 0 },  // meia-noite = 0, nunca 24
    ]
    for (const c of casos) {
      const h = horaEmBrasilia(new Date(c.utc))
      t(h === c.esperado, `${c.utc} → ${formatarHora(h)} em Brasília (esperado ${formatarHora(c.esperado)})`)
    }
    t(HORAS.every(h => {
      const d = new Date(Date.UTC(2026, 6, 15, h, 0, 0))
      const calc = horaEmBrasilia(d)
      return calc >= 0 && calc <= 23
    }), 'e nunca devolve 24 — o `hourCycle: h23` existe por isso')
  }

  // ═══ 7. Simulação do despacho contra o banco REAL ═════════════════════════
  console.log('\n── 7. o que o cron faria hoje ──')
  {
    const linhas = await db.execute<{ org: string; settings: unknown; itens: number }>(sql`
      SELECT o.name AS org, o.settings, COUNT(*)::int AS itens
        FROM data_sources ds JOIN organizations o ON o.id = ds.organization_id
       WHERE ds.provider = 'pluggy' AND ds.status = 'active' AND ds.external_item_id IS NOT NULL
       GROUP BY o.name, o.settings ORDER BY o.name`)

    t(linhas.length > 0, `${linhas.length} organização(ões) com conexão bancária ativa`)

    let despachosNoDia = 0
    for (const h of HORAS) {
      const naHora = linhas.filter(l => deveRodarAgora(lerAgenda(l.settings), h))
      const itens = naHora.reduce((s, l) => s + Number(l.itens), 0)
      despachosNoDia += itens
      if (naHora.length > 0) {
        console.log(`       ${formatarHora(h)} → ${naHora.length} org(s), ${itens} conexões: ${naHora.map(l => l.org).join(', ')}`)
      }
    }

    const itensTotais = linhas.reduce((s, l) => s + Number(l.itens), 0)
    t(despachosNoDia === itensTotais,
      `somando as 24 horas, cada conexão é despachada 1×/dia (${despachosNoDia} de ${itensTotais}) — idêntico ao cron antigo`)

    const todasNoPadrao = linhas.every(l => {
      const a = lerAgenda(l.settings)
      return a.horaInicial === 3 && a.aCada === 24
    })
    t(todasNoPadrao, 'e todas ainda estão no padrão 03:00 — nada mudou de horário sem alguém pedir')

    // O caso que o produto quer: uma organização escolhe 07:00 e só ela muda.
    const simulada = { ...(linhas[0].settings as Record<string, unknown>), [CHAVE_DE_AGENDA]: { horaInicial: 7, aCada: 6 } }
    const agenda = lerAgenda(simulada)
    t(descreverAgenda(agenda) === 'a partir das 07:00, a cada 6 horas (07:00, 13:00, 19:00, 01:00)',
      `"${linhas[0].org}" com 07:00 a cada 6h → ${descreverAgenda(agenda)}`)
    t(HORAS.filter(h => deveRodarAgora(agenda, h)).length === 4 &&
      HORAS.filter(h => deveRodarAgora(lerAgenda(linhas[0].settings), h)).length === 1,
      'a mudança vale só para ela: 4 execuções contra a 1 de quem ficou no padrão')
  }

  console.log(`\n${ok} ok · ${falhas} falhas`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
