import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  /** `next build` runs ESLint; this project’s eslint-config-next + ESLint 10 combo fails with invalid options. */
  eslint: {
    ignoreDuringBuilds: true,
  },
  /** iOS instant-links client calls `/instant-links/...` on the apex host (no `/api` prefix). */
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/instant-links/:path*', destination: '/api/instant-links/:path*' },
      ],
    }
  },
}

export default nextConfig
