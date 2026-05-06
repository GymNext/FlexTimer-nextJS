import { NextResponse } from 'next/server'

import {
  PREVIEW_ACCESS_COOKIE,
  PREVIEW_ACCESS_COOKIE_MAX_AGE,
  previewAccessToken,
} from '@/lib/preview-access'

export async function POST(request: Request) {
  const configured = process.env.PREVIEW_ACCESS_CODE
  if (!configured) {
    return NextResponse.json({ error: 'Preview access is not enabled' }, { status: 503 })
  }

  let body: { code?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const submitted = typeof body.code === 'string' ? body.code : ''
  if (!submitted || submitted !== configured) {
    return NextResponse.json({ error: 'Invalid access code' }, { status: 401 })
  }

  const token = await previewAccessToken(configured)
  const res = NextResponse.json({ ok: true })
  const secure = process.env.NODE_ENV === 'production'

  res.cookies.set(PREVIEW_ACCESS_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: PREVIEW_ACCESS_COOKIE_MAX_AGE,
    path: '/',
  })

  return res
}
