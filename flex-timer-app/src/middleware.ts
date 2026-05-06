import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isLocalhostHost, PREVIEW_PATH_HEADER } from '@/lib/preview-access'

function skipPathHeader(pathname: string): boolean {
  if (pathname.startsWith('/_next/')) return true
  if (pathname.startsWith('/icons/')) return true
  if (pathname === '/favicon.ico') return true
  if (pathname === '/icon.png' || pathname === '/apple-icon.png') return true
  return false
}

/**
 * Middleware runs on the Edge and only sees env vars that were present when the bundle was built.
 * Preview gating uses PREVIEW_ACCESS_CODE at runtime in the root layout (Node); here we only attach
 * a path header for that layout and drop any client-supplied value with the same name.
 */
export function middleware(request: NextRequest) {
  const host = request.nextUrl.hostname
  if (isLocalhostHost(host)) {
    return NextResponse.next()
  }

  const pathname = request.nextUrl.pathname
  if (skipPathHeader(pathname)) {
    return NextResponse.next()
  }

  const headers = new Headers(request.headers)
  headers.delete(PREVIEW_PATH_HEADER)
  headers.set(PREVIEW_PATH_HEADER, `${pathname}${request.nextUrl.search}`)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|icon.png|apple-icon.png).*)',
  ],
}
