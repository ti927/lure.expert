'use client'

/**
 * Redimensionar coluna arrastando a borda do cabeçalho.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESCREVE NO DOM DURANTE O ARRASTO
 *
 * `/transacoes` mostra até 1.000 linhas por página. Um `setState` por
 * `pointermove` re-renderizaria as mil a cada pixel e o arrasto travaria na mão
 * do usuário. Então o arrasto escreve `style.width` direto no `<col>` (e a soma
 * na `<table>`), e o estado só é gravado ao SOLTAR — que é também quando o
 * `localStorage` é tocado. Com `table-fixed`, mudar um `<col>` é um reflow
 * barato: a largura não depende do conteúdo de nenhuma célula.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DELTA VEM DE `clientX`, NUNCA DE `offsetX`
 *
 * A tabela vive dentro de um contêiner com rolagem horizontal. `offsetX` é
 * relativo ao elemento e muda quando o contêiner rola durante o arrasto — a
 * coluna daria pulos. A diferença entre dois `clientX` é imune a isso.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  chaveDeLarguras, clampLargura, larguraParaSalvar, larguraTotal, lerLarguras,
  temCustomizacao, type ColunaRedimensionavel,
} from '@/lib/column-widths'

export function useColumnWidths(rota: string, colunas: readonly ColunaRedimensionavel[]) {
  // Começa SEMPRE no padrão: `localStorage` não existe no servidor, e ler no
  // primeiro render quebraria a hidratação. O restauro vem no efeito de montagem,
  // como já acontece com os filtros desta mesma tela.
  const [larguras, setLarguras] = useState<Record<string, number>>(() => lerLarguras(null, colunas))

  // Espelho síncrono: o `pointermove` precisa da largura corrente sem esperar o
  // ciclo de render, e o `setState` de dentro do arrasto não existe (ver topo).
  const larguraRef = useRef(larguras)
  useEffect(() => { larguraRef.current = larguras }, [larguras])

  const colRefs = useRef<Record<string, HTMLTableColElement | null>>({})
  const tableRef = useRef<HTMLTableElement | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(chaveDeLarguras(rota))
      if (!raw) return
      setLarguras(lerLarguras(JSON.parse(raw), colunas))
    } catch { /* storage indisponível: fica no padrão */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const gravar = useCallback((novas: Record<string, number>) => {
    setLarguras(novas)
    larguraRef.current = novas
    try {
      const chave = chaveDeLarguras(rota)
      const diff = larguraParaSalvar(colunas, novas)
      if (Object.keys(diff).length === 0) localStorage.removeItem(chave)
      else localStorage.setItem(chave, JSON.stringify(diff))
    } catch { /* */ }
  }, [colunas, rota])

  const aplicarNoDom = useCallback((id: string, largura: number) => {
    const col = colRefs.current[id]
    if (col) col.style.width = `${largura}px`
    const table = tableRef.current
    if (!table) return
    let total = 0
    for (const c of colunas) total += c.id === id ? largura : (larguraRef.current[c.id] ?? c.largura)
    table.style.width = `${total}px`
  }, [colunas])

  const iniciarArrasto = useCallback((id: string, e: React.PointerEvent<HTMLElement>) => {
    // Sem isto o gesto cai no botão de ordenar ou abre o popover de filtro — o
    // cabeçalho já tem três zonas clicáveis embaixo da alça.
    e.preventDefault()
    e.stopPropagation()

    const alvo = e.currentTarget
    const xInicial = e.clientX
    const inicial = larguraRef.current[id]
    let atual = inicial

    alvo.setPointerCapture(e.pointerId)
    const corpo = document.body.style
    const cursorAntes = corpo.cursor
    const selecaoAntes = corpo.userSelect
    corpo.cursor = 'col-resize'
    corpo.userSelect = 'none' // senão o arrasto seleciona o texto da tabela inteira

    function mover(ev: PointerEvent) {
      atual = clampLargura(inicial + (ev.clientX - xInicial))
      aplicarNoDom(id, atual)
    }
    function soltar() {
      alvo.removeEventListener('pointermove', mover)
      alvo.removeEventListener('pointerup', soltar)
      alvo.removeEventListener('pointercancel', soltar)
      corpo.cursor = cursorAntes
      corpo.userSelect = selecaoAntes
      if (atual !== inicial) gravar({ ...larguraRef.current, [id]: atual })
    }

    alvo.addEventListener('pointermove', mover)
    alvo.addEventListener('pointerup', soltar)
    alvo.addEventListener('pointercancel', soltar)
  }, [aplicarNoDom, gravar])

  /** Duplo-clique na alça: só esta coluna volta ao padrão. */
  const restaurarColuna = useCallback((id: string) => {
    const padrao = colunas.find(c => c.id === id)?.largura
    if (padrao === undefined) return
    gravar({ ...larguraRef.current, [id]: padrao })
  }, [colunas, gravar])

  /** O botão da barra: a rede de segurança de quem arrastou até perder a coluna. */
  const restaurarTudo = useCallback(() => {
    gravar(lerLarguras(null, colunas))
  }, [colunas, gravar])

  return {
    larguras,
    total: larguraTotal(colunas, larguras),
    customizado: temCustomizacao(colunas, larguras),
    tableRef,
    /** Passar em cada `<col>`: `<col {...propsDaColuna(id)} />` */
    propsDaColuna: (id: string) => ({
      ref: (el: HTMLTableColElement | null) => { colRefs.current[id] = el },
      style: { width: larguras[id] },
    }),
    iniciarArrasto,
    restaurarColuna,
    restaurarTudo,
  }
}

/**
 * A alça. Mora no `<th>` (que precisa ser `relative`) e cavalga a borda direita
 * dele — a borda que a pessoa enxerga como o limite da coluna.
 */
export function ResizeHandle({
  onPointerDown, onDoubleClick, className,
}: {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onDoubleClick: () => void
  className?: string
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar coluna"
      title="Arraste para redimensionar · duplo-clique volta ao padrão"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        // `touch-none` impede o navegador de tratar o gesto como rolagem.
        'absolute right-0 top-0 z-20 flex h-full w-2 translate-x-1/2 cursor-col-resize touch-none select-none items-center justify-center',
        'opacity-0 transition-opacity hover:opacity-100 group-hover/col:opacity-60',
        className,
      )}
    >
      <span className="h-4 w-0.5 rounded-full bg-primary" />
    </span>
  )
}
