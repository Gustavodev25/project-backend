/** @type {import('next').NextConfig} */
const nextConfig = {
  // Configuração para API-only backend
  output: 'standalone',

  // Desabilita validações durante build
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Configurações para prevenir geração estática
  generateBuildId: async () => {
    return 'build-' + Date.now();
  },

  // Headers para forçar respostas dinâmicas
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, must-revalidate',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
