/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse'],
  },

  // Descoberta do OAuth (RFC 8414 e RFC 9728).
  //
  // Por `rewrites` e não por pasta `app/.well-known/`: nome de diretório começado
  // com ponto é tratado como oculto por boa parte da cadeia de build, e o
  // caminho é MUST do spec — não é lugar para depender de sorte.
  //
  // As variantes com sufixo existem porque o RFC 8414 permite ao cliente inserir
  // o caminho do recurso depois do `.well-known`: quem procura o servidor de
  // `/api/mcp` pode pedir `/.well-known/oauth-authorization-server/api/mcp`. Os
  // dois formatos levam ao mesmo documento.
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/oauth/metadata/authorization-server',
      },
      {
        source: '/.well-known/oauth-authorization-server/:path*',
        destination: '/api/oauth/metadata/authorization-server',
      },
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/oauth/metadata/protected-resource',
      },
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        destination: '/api/oauth/metadata/protected-resource',
      },
    ];
  },
};

export default nextConfig;
