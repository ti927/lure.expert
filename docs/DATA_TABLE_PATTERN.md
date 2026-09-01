# Padrão: Data Table Pro

> Toda tabela de dados do lure.expert segue este padrão sem exceção.
> Referência canônica implementada em `/transacoes`. Antes de criar qualquer tabela, leia este documento.

---

## 1. Estrutura vertical (viewport-fill)

A página captura 100% da altura do navegador — nunca cresce verticalmente além do viewport.
A barra de rolagem fica **dentro da tabela**, não na página.

```tsx
// page.tsx — wrapper externo
<div className="h-full flex flex-col overflow-hidden">
  <TableClient ... />
</div>

// client component — layout interno
<div className="flex flex-col h-full overflow-hidden">
  <div className="shrink-0 ...">/* zona 1: cabeçalho */</div>
  <div className="shrink-0 ...">/* zona 2: totalizador + filtros de data */</div>
  {selected > 0 && <div className="shrink-0 ...">/* zona 3: toolbar de lote */</div>}
  <div className="flex-1 min-h-0 overflow-hidden px-6">
    <div className="h-full overflow-auto border rounded-lg">
      <table>...</table>
    </div>
  </div>
  {(selected > 0 || pages > 1) && <div className="shrink-0 ...">/* zona 4: rodapé */</div>}
</div>
```

**Dependência:** AppShell deve ter `<main className="flex-1 overflow-y-auto min-h-0">`.
Outras páginas continuam rolando via `overflow-y-auto` do `<main>`.

---

## 2. As 5 zonas fixas + 1 elástica

| Zona | Classe | Conteúdo |
|---|---|---|
| 1 — Cabeçalho | `shrink-0` | Título, contador de registros, ações globais (ex: badge de revisão) |
| 2 — Totalizador | `shrink-0` | Entradas / Saídas / Líquido do conjunto filtrado + filtros De/Até |
| 3 — Toolbar de lote | `shrink-0` (condicional) | Aparece só quando há seleção: N selecionadas, Classificar em lote, Apagar, Cancelar |
| 4 — **Tabela** | `flex-1 min-h-0` | Scroll interno. Nunca `overflow-y-auto` no `<main>` para esta zona |
| 5 — Rodapé | `shrink-0` (condicional) | Uma linha: totais selecionados (esquerda) + paginação (direita) |

O rodapé só aparece quando `selectedIds.size > 0 || data.pages > 1`. Nunca duas barras empilhadas.

---

## 3. Cabeçalho de coluna: 3 zonas

```
[ ↑↓ sort ]  [ filtro / título ]  [ × limpar ]
```

- O filtro **é** o título — não há barra de filtros separada acima da tabela
- Sort: ciclo nenhum → desc → asc → nenhum (data: desc → asc → desc por padrão)
- Botão `×` só fica visível (`opacity-100`) quando o filtro tem valor; caso contrário `opacity-0 pointer-events-none`
- **Exceção obrigatória:** filtros que usam **dois campos de data** (De/Até) ficam na zona 2, nunca no header

```tsx
function ColHeader({ children, hasValue, onClear, sortKey, currentSort, onSort, className }) {
  return (
    <div className={cn('flex items-center h-8 gap-0.5', className)}>
      {onSort && <button onClick={onSort}>/* ícone ↑↓ */</button>}
      <div className="flex-1 min-w-0 h-full flex items-center overflow-hidden">{children}</div>
      <button onClick={onClear} className={cn(..., hasValue ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}
```

---

## 4. Tipos de filtro por tipo de dado

| Tipo de dado | Componente de filtro |
|---|---|
| Texto livre | Input inline com `placeholder="Nome da coluna"`, debounce 400ms |
| Valor numérico | Popover com dois inputs mín/máx |
| Enum curto (2–4 opções) | Popover com lista simples (radio-style) |
| Dimensão longa (categorias, CC, UN, entidade) | Popover multi-select com busca (`cmdk`), agrupado por tipo quando necessário |
| Booleano / presença | Popover com opções: Todos / Com valor / Sem valor |

---

## 5. Separadores e opacidade

```tsx
// Divisores verticais sutis entre colunas — aplicar na tag <table>
className="... [&_td]:border-r [&_th]:border-r [&_td]:border-border/20 [&_th]:border-border/20 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0"

// Header sticky — SEMPRE bg sólido, nunca bg-muted/60 ou bg-muted/80
<thead className="sticky top-0 z-10">
  <tr className="bg-muted border-b">
```

---

## 6. Totalizadores

**Topo (zona 2):** totais do conjunto filtrado completo — calculados no servidor (query SUM paralela).

**Rodapé (zona 5, lado esquerdo):** totais das linhas selecionadas — calculados no cliente via `useMemo`.

```tsx
const selTotals = useMemo(() => {
  let selInflow = 0, selOutflow = 0
  for (const row of localRows) {
    if (!selectedIds.has(row.id)) continue
    const amt = Number(row.amount)
    if (row.direction === 'inflow') selInflow += amt
    else selOutflow += amt
  }
  return { inflow: selInflow, outflow: selOutflow, net: selInflow - selOutflow }
}, [localRows, selectedIds])
```

---

## 7. Paginação

- `PAGE_SIZE = 100` (padrão do projeto)
- Rodapé unificado: `Anterior | Página X de Y | Próxima`
- Número da página fica **entre** os botões, não separado à esquerda

---

## 8. Persistência de filtros

Filtros ativos são salvos em `localStorage` com a chave `lure:<rota>:filters`.
Ao montar, restaura do storage **somente se a URL não tiver parâmetros** (respeita URLs compartilhadas/explícitas).
"Limpar tudo" remove a chave do storage além de resetar a URL.

---

## 9. Largura de coluna redimensionável (opt-in)

Implementado em `/transacoes` (1/set/2026). **É opt-in, não obrigatório** — as matrizes de 12 meses
(`/dre`, `/fluxo`, `/orcamento`, `/balanco`) têm colunas de largura homogênea, onde arrastar resolve
pouco e a alça atrapalha o clique no cabeçalho.

```tsx
// 1. A lista de colunas vive em src/lib/column-widths.ts, NÃO na tela — é o que
//    permite o teste afirmar sobre a lista real.
const COLUNAS = [
  { id: 'sel',  largura: 36, fixa: true },   // utilidade: sem alça
  { id: 'desc', largura: 200 },
  ...
]

// 2. No client component
const cols = useColumnWidths('transacoes', COLUNAS)

<table ref={cols.tableRef} style={{ width: cols.total }} className="min-w-full table-fixed ...">
  <colgroup>{COLUNAS.map(c => <col key={c.id} {...cols.propsDaColuna(c.id)} />)}</colgroup>
  <thead><tr>
    <th className="group/col relative px-2 py-1">
      <ColHeader …/>
      <ResizeHandle onPointerDown={e => cols.iniciarArrasto(id, e)} onDoubleClick={() => cols.restaurarColuna(id)} />
    </th>
  </tr></thead>
```

Três regras que não são estéticas:

- **`table-fixed` é pré-requisito.** Com layout automático a largura depende do conteúdo de todas as
  linhas, e arrastar deixa de ser previsível.
- **A largura da tabela é a soma das colunas**, e `min-w-full` cobre o caso de a soma caber no
  contêiner. `w-full` com `min-w-[N]` — o que `/transacoes` tinha — transforma as larguras
  declaradas em **proporções**: o navegador distribui a diferença, e arrastar uma coluna encolhe as
  outras sozinhas.
- **O arrasto escreve no DOM, não no estado.** Com `pageSize` de até 1.000 linhas, `setState` por
  `pointermove` trava o gesto. O estado e o `localStorage` só são tocados ao soltar.

Restaurar tem dois caminhos, de propósito: **duplo-clique na alça** devolve aquela coluna; o botão
**Larguras** (aparece só quando algo saiu do padrão, ao lado de "Limpar") devolve todas — é a rede
de segurança de quem arrastou até não achar mais a coluna.

**Persistência:** `localStorage`, chave `lure:<rota>:colwidths` — **separada da de filtros**, senão
"Limpar filtros" levaria o layout junto. É por **navegador**, não por usuário: a mesma pessoa em duas
máquinas vê duas larguras. Per-usuário exigiria tabela de preferência e migration, e ficou declarado
como v2 em `src/lib/column-widths.ts`.

---

## 10. Checklist antes de criar uma nova tabela

- [ ] `page.tsx` tem wrapper `h-full flex flex-col overflow-hidden`
- [ ] Client component tem `flex flex-col h-full overflow-hidden`
- [ ] Zona da tabela usa `flex-1 min-h-0 overflow-hidden`
- [ ] `<thead>` usa `sticky top-0 z-10 bg-muted` (sólido)
- [ ] Cada coluna tem `ColHeader` com sort + filtro + clear
- [ ] Filtros De/Até ficam na zona 2, não no header
- [ ] Divisores verticais aplicados via `[&_td]:border-r` na `<table>`
- [ ] Rodapé unifica totais selecionados + paginação em uma linha
- [ ] Filtros persistidos em `localStorage` com chave `lure:<rota>:filters`
- [ ] `PAGE_SIZE = 100` (ou justificativa documentada para valor diferente)
- [ ] Largura redimensionável: decidido se entra (seção 9) — e, se entrar, a lista de colunas mora
      em `src/lib/column-widths.ts`, nunca na tela
