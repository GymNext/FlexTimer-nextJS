import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Toaster } from 'react-hot-toast'

import {
  PREVIEW_ACCESS_COOKIE,
  PREVIEW_PATH_HEADER,
  isLocalhostHost,
  previewAccessToken,
} from '@/lib/preview-access'
import './globals.css'

export const metadata: Metadata = {
  title: 'FlexTimer',
  description: 'FlexTimer admin and app',
}

function hostFromRequest(h: Headers): string {
  const raw = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  return raw.split(',')[0]?.trim()?.split(':')[0] ?? ''
}

let cachedCode: string | null = null
let cachedToken: string | null = null

async function expectedPreviewToken(code: string): Promise<string> {
  if (cachedCode === code && cachedToken !== null) {
    return cachedToken
  }
  cachedToken = await previewAccessToken(code)
  cachedCode = code
  return cachedToken
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const h = await headers()
  const host = hostFromRequest(h)

  if (!isLocalhostHost(host)) {
    const previewCode = process.env.PREVIEW_ACCESS_CODE
    if (previewCode) {
      const pathInfo = h.get(PREVIEW_PATH_HEADER) ?? ''
      const onGate =
        pathInfo === '/preview-gate' || pathInfo.startsWith('/preview-gate?')
      if (!onGate) {
        const cookie = (await cookies()).get(PREVIEW_ACCESS_COOKIE)?.value
        const expected = await expectedPreviewToken(previewCode)
        if (cookie !== expected) {
          const from = pathInfo || '/'
          redirect(`/preview-gate?from=${encodeURIComponent(from)}`)
        }
      }
    }
  }

  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-gray-50">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  )
}
