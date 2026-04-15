import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  /** `next build` runs ESLint; this project’s eslint-config-next + ESLint 10 combo fails with invalid options. */
  eslint: {
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
