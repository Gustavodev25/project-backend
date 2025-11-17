/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ignorar erros de ESLint e TypeScript durante o build
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Configuração para output standalone (melhor para deploy)
  output: 'standalone',
};

export default nextConfig;
