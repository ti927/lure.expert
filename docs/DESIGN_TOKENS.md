# Design Tokens — lure.expert

Criado na Fase 0.5.1. Este documento é a fonte da verdade dos tokens visuais do produto.
Antes de criar qualquer componente novo, consulte aqui.

---

## Cor Primária

**emerald-700** — `#047857`

**Por que:** verde-floresta carrega associação direta com dinheiro/crescimento sem ser cliché.
Boa legibilidade em fundo branco e contraste claro com rose-600 (negativo).
Combina com a identidade da consultoria Lure.

CSS variable: `--primary: oklch(0.508 0.118 163)`

---

## Paleta de Cores

### Marca (brand / emerald)

| Token | Hex | Uso |
|---|---|---|
| brand-50 | #ecfdf5 | fundos sutis |
| brand-100 | #d1fae5 | highlights leves |
| brand-200 | #a7f3d0 | — |
| brand-300 | #6ee7b7 | — |
| brand-400 | #34d399 | — |
| brand-500 | #10b981 | hover do primário |
| **brand-700** | **#047857** | **primária — botões, links, foco** |
| brand-800 | #065f46 | pressed do primário |
| brand-900 | #064e3b | texto sobre fundo primário |

### Neutra (slate)

| Token | Hex | Uso |
|---|---|---|
| slate-50 | #f8fafc | fundo da sidebar |
| slate-100 | #f1f5f9 | muted, secondary, accent |
| slate-200 | #e2e8f0 | border, input |
| slate-300 | #cbd5e1 | divisores internos |
| slate-400 | #94a3b8 | ícones inativos |
| slate-500 | #64748b | muted-foreground |
| slate-600 | #475569 | texto secundário |
| slate-700 | #334155 | secondary-foreground |
| slate-800 | #1e293b | — |
| slate-900 | #0f172a | foreground (texto principal) |

### Semânticas

| Token CSS | Tailwind ref | Hex | Uso |
|---|---|---|---|
| `--color-positive` | emerald-600 | #059669 | valores positivos, crescimento |
| `--color-negative` | rose-600 | #e11d48 | valores negativos, queda |
| `--color-alert` | amber-500 | #f59e0b | alertas, caixa apertado |
| `--color-info` | sky-600 | #0284c7 | informativo, sincronizando |

**Como usar no código:**
```tsx
// Classe Tailwind direto
<span className="text-positive">+4,2%</span>
<span className="text-negative">-1,8%</span>

// CSS variable
style={{ color: "var(--color-positive)" }}
```

---

## Tipografia

**Família:** Inter (importada via `next/font/google`)

**Variable CSS:** `--font-inter`

**Subsets:** latin

**Pesos:** 400 (regular), 500 (medium), 600 (semibold), 700 (bold)

### Escala de tamanhos

| Classe | Tamanho | Line height | Uso |
|---|---|---|---|
| text-xs | 12px | 16px | labels, timestamps, notas |
| text-sm | 14px | 20px | texto secundário, helper |
| text-base | 16px | 24px | corpo de texto principal |
| text-lg | 18px | 28px | subtítulos de seção |
| text-xl | 20px | 28px | títulos de card |
| text-2xl | 24px | 32px | títulos de página |
| text-3xl | 30px | 36px | KPIs grandes |
| text-4xl | 36px | 40px | número hero do dashboard |

### Tabular nums — CRÍTICO para produto financeiro

Sempre use a classe `.tabular` em:
- Colunas de valores em tabelas
- KPIs e números grandes no dashboard
- Comparativos (delta %, variação)
- Qualquer sequência de números que precisam alinhar

```tsx
<span className="tabular">R$ 1.234.567,89</span>
```

A classe aplica `font-variant-numeric: tabular-nums` + `font-feature-settings: "tnum"`.

---

## Border Radius

| Token | Valor | Uso |
|---|---|---|
| `rounded-sm` | 4px | botões, inputs, badges |
| `rounded-md` | 8px | cards (padrão geral) |
| `rounded-lg` | 12px | modais, painéis laterais |
| `rounded-xl` | 16px | uso esporádico |
| `rounded-full` | 9999px | pills, avatares |

---

## Sombras

| Token | Uso |
|---|---|
| `shadow-sm` | cards, itens de lista hover |
| `shadow-md` | popovers, dropdowns, tooltips |
| `shadow-lg` | modais, drawers, painéis sobrepostos |

---

## Espaçamento

Escala Tailwind padrão (base 4px). Valores mais usados no produto:

| Classe | px | Uso típico |
|---|---|---|
| p-1 / gap-1 | 4px | espaço interno mínimo |
| p-2 / gap-2 | 8px | padding interno de badge, chip |
| p-3 / gap-3 | 12px | padding de input |
| p-4 / gap-4 | 16px | padding de card (padrão) |
| p-6 / gap-6 | 24px | padding de seção |
| p-8 / gap-8 | 32px | padding de página |
| gap-12 | 48px | separação entre seções |

---

## Tokens de Interface (shadcn/ui)

Mapeados em `globals.css`. Usados pelos componentes shadcn/ui automaticamente.

| Variable | Valor (light) |
|---|---|
| `--background` | branco |
| `--foreground` | slate-900 |
| `--primary` | emerald-700 |
| `--primary-foreground` | branco |
| `--secondary` | slate-100 |
| `--muted` | slate-100 |
| `--muted-foreground` | slate-500 |
| `--border` | slate-200 |
| `--input` | slate-200 |
| `--ring` | emerald-700 |
| `--destructive` | rose-600 |
| `--sidebar` | slate-50 |

---

## Modo Escuro

Estrutura preparada em `globals.css` (bloco `.dark`). Não ativado por padrão no MVP.
Quando ativar, o toggle deve persistir em `localStorage` com chave `lure-theme`.

---

## Referência visual

Acesse `/style-guide` em ambiente de desenvolvimento para visualizar todos os tokens renderizados.
