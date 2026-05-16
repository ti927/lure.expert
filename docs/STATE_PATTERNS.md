# Padrões de Estado — lure.expert

Este documento define os **5 estados canônicos** que toda tela com dados
deve implementar. Nenhuma tela carrega em branco.

**Regra central:** qualquer tela que faz fetch de dado tem obrigatoriamente
5 estados. Não existe tela com só "success".

---

## Os 5 Estados

### 1. loading
**Quando:** dado está sendo buscado (request em andamento).

**Componente:** `LoadingState`

Variantes:
- `skeleton` — linhas pulsantes no lugar do conteúdo (padrão para listas e tabelas)
- `spinner` — centralizado (padrão para seções pequenas ou modais)
- `thinking` — spinner + "expert está analisando..." (exclusivo para operações do expert)

**Regra:** sempre mostrar skeleton no shape do conteúdo esperado.
Não mostrar spinner no lugar de uma tabela de 10 linhas.

```tsx
// Lista de transações carregando
<LoadingState variant="skeleton" rows={8} />

// Expert analisando uma pergunta
<LoadingState variant="thinking" />

// Modal aguardando confirmação
<LoadingState variant="spinner" />
```

---

### 2. empty
**Quando:** request completou com sucesso, mas não há dados no período/filtro.

**Componente:** `EmptyState`

Regras:
- Sempre explicar POR QUÊ está vazio (sem transações no período vs. nenhuma conta conectada)
- Sempre oferecer ação quando o vazio for recuperável
- Nunca mostrar tabela vazia com cabeçalho — substituir pelo EmptyState

```tsx
// Sem contas conectadas (vazio estrutural — ação necessária)
<EmptyState
  icon={Landmark}
  title="Nenhuma conta conectada"
  description="Conecte seu banco para ver as movimentações automaticamente."
  action={{ label: "Conectar Banco", onClick: handleConnect }}
/>

// Sem dados no filtro (vazio de filtro — ação opcional)
<EmptyState
  title="Sem transações no período"
  description="Nenhuma movimentação encontrada para o filtro selecionado."
/>
```

---

### 3. error
**Quando:** request falhou (rede, servidor, timeout, permissão).

**Componente:** `ErrorState`

Regras:
- Título descreve O QUE falhou, não o código HTTP
- Descrição sugere próximo passo
- `onRetry` obrigatório se a operação for re-tentável
- `technical` (colapsado) para erros que o suporte precisaria ver
- Nunca mostrar stack trace ou mensagem técnica diretamente ao usuário

```tsx
<ErrorState
  title="Não conseguimos atualizar o saldo do Itaú"
  description="Tente novamente ou verifique a conexão com Open Finance."
  onRetry={refetch}
  technical={`HTTP 503 — GET /api/accounts/sync — ${timestamp}`}
/>
```

---

### 4. partial
**Quando:** dado carregou, mas com ressalvas: período incompleto,
fonte desatualizada, sincronização parcial, transações não categorizadas.

**Componente:** `PartialDataBanner`

Posição: topo da seção com dado parcial, antes do conteúdo.

Regras:
- Não bloquear o conteúdo — mostrar o que existe com o aviso
- Informar exatamente o que está faltando e por quê
- Indicar quando o dado será completado (se souber)
- Usar `variant="warning"` para dado desatualizado, `variant="info"` para dado em processamento

```tsx
// Sincronização atrasada
<PartialDataBanner
  variant="warning"
  message="Saldo do Bradesco desatualizado — última sincronização há 4 horas."
  action={{ label: "Sincronizar agora", onClick: handleSync }}
/>

// Processamento em andamento
<PartialDataBanner
  variant="info"
  message="expert está categorizando 47 transações novas. Os totais serão atualizados em instantes."
/>
```

---

### 5. success
**Quando:** dado carregou completo e sem ressalvas.

**Componente:** nenhum — é o estado do conteúdo em si.

Regras:
- Não mostrar nenhuma mensagem de "sucesso" — o dado em si é a confirmação
- Exceção: confirmação de mutação (categorização aplicada, transação editada) — use toast efêmero (Sonner), não banner permanente

---

## Regras gerais

**Transições:**
- `loading → success`: fade-in suave (Tailwind `animate-in fade-in`)
- `loading → empty` / `loading → error`: idem
- `partial → success`: banner desaparece silenciosamente ao completar

**Composição:**
- Uma tela pode ter múltiplas seções, cada uma no próprio estado
- Ex: sidebar com saldo em `success` + tabela em `loading` + banner de partial no topo

**Nunca:**
- Tela em branco enquanto carrega
- Spinner global que trava a UI toda
- Mensagem de erro sem ação ou contato
- "Sucesso!" permanente após mutação

---

## Uso em código

Todo componente que faz fetch implementa os estados nesta ordem:

```tsx
function TransactionList() {
  const { data, isLoading, isError, isSuccess } = useTransactions();

  if (isLoading) return <LoadingState variant="skeleton" rows={8} />;
  if (isError)   return <ErrorState title="..." onRetry={refetch} />;
  if (isSuccess && data.length === 0) return <EmptyState title="..." />;

  const hasPartialData = data.some(t => !t.category);
  return (
    <>
      {hasPartialData && (
        <PartialDataBanner
          variant="info"
          message={`${uncategorized} transações aguardam categorização.`}
        />
      )}
      <DataTable columns={columns} data={data} />
    </>
  );
}
```

---

## Referências de componentes

| Estado  | Componente                              | Arquivo                                    |
|---------|-----------------------------------------|--------------------------------------------|
| loading | `LoadingState`                          | `src/components/states/loading-state.tsx`  |
| empty   | `EmptyState`                            | `src/components/states/empty-state.tsx`    |
| error   | `ErrorState`                            | `src/components/states/error-state.tsx`    |
| partial | `PartialDataBanner`                     | `src/components/states/partial-data-banner.tsx` |
| success | — (conteúdo em si)                      | —                                          |
