import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // `api/oauth` e `api/mcp` ficam de fora: são rotas de MÁQUINA, autenticadas
    // por segredo ou token no corpo, e `updateSession` faria duas coisas ruins
    // ali — uma ida ao Supabase por requisição sem nenhum cookie para renovar,
    // e um `Set-Cookie` pendurado numa resposta JSON que o cliente MCP não tem o
    // que fazer com ele.
    //
    // `/oauth/*` (sem `api`) CONTINUA no matcher, e é proposital: a tela de
    // consentimento e a rota de decisão autenticam por sessão, e é o middleware
    // que renova o token antes de a página ler o usuário.
    "/((?!_next/static|_next/image|favicon.ico|api/oauth|api/mcp|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
