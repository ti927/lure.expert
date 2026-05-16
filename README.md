# lure.expert

Base mínima: Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui + Supabase Auth.

Inclui:

- `/login` — formulário de e-mail + senha (shadcn/ui)
- `/dashboard` — rota protegida que mostra o e-mail do usuário; redireciona para `/login` se não autenticado
- `/` — redireciona para `/login`
- Middleware que mantém a sessão do Supabase atualizada a cada request

## Pré-requisitos

- Node.js 18.17+ (recomendado 20+)
- Uma conta no [Supabase](https://supabase.com) com um projeto criado

## Setup

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

Copie o arquivo `.env.example` para `.env.local`:

```bash
cp .env.example .env.local
```

Edite `.env.local` e preencha com as credenciais do seu projeto Supabase
(disponíveis em **Project Settings → API**):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<seu-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<sua-anon-key>
```

### 3. Criar um usuário de teste no Supabase

Como esta base mínima não inclui tela de cadastro, crie um usuário manualmente
no painel do Supabase:

1. Vá em **Authentication → Users → Add user → Create new user**
2. Defina e-mail e senha
3. Marque **Auto Confirm User** (para pular a verificação por e-mail)

### 4. Rodar em desenvolvimento

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000) — você será redirecionado
para `/login`. Após autenticar, irá para `/dashboard`.

## Scripts

| Comando         | Descrição                          |
| --------------- | ---------------------------------- |
| `npm run dev`   | Servidor de desenvolvimento        |
| `npm run build` | Build de produção                  |
| `npm start`     | Servir o build de produção         |
| `npm run lint`  | ESLint                             |

## Estrutura

```
src/
├── app/
│   ├── login/
│   │   ├── actions.ts      # server action: signIn
│   │   └── page.tsx        # formulário de login
│   ├── dashboard/
│   │   ├── actions.ts      # server action: signOut
│   │   └── page.tsx        # rota protegida
│   ├── layout.tsx
│   └── page.tsx            # redireciona para /login
├── components/ui/          # shadcn/ui: button, input, label, card
├── lib/
│   ├── supabase/
│   │   ├── client.ts       # client de browser
│   │   ├── server.ts       # client de Server Components
│   │   └── middleware.ts   # refresh de sessão
│   └── utils.ts            # helper do shadcn (cn)
└── middleware.ts           # entry point do middleware do Next
```

## Stack

- [Next.js 14](https://nextjs.org/) (App Router)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Supabase](https://supabase.com/) (`@supabase/ssr` + `@supabase/supabase-js`)
