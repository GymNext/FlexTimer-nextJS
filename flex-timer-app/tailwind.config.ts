import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        gymnext: {
          DEFAULT: '#6B21A8',
          light: '#7C3AED',
          dark: '#581C87',
          muted: '#A78BFA',
          background: '#EDE9FE',
          /** Lighter tint for full-page background only */
          page: '#F5F3FF',
        },
      },
    },
  },
  plugins: [],
}
export default config
