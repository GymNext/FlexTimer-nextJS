import { randomBytes } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'

const USERS = 'users'

/**
 * Unambiguous uppercase alphanumeric alphabet (no 0/O/1/I/L) for codes that may be
 * read aloud or copy/pasted by end-users.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 10

function generateInstantConnectCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return out
}

function readInstantConnectCode(data: Record<string, unknown>): string | null {
  const raw = data.instantConnectCode
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

function readHandle(data: Record<string, unknown>): string | null {
  const handle = typeof data.handle === 'string' ? data.handle.trim() : ''
  if (handle !== '') return handle
  const legacy = typeof data.publicHandle === 'string' ? data.publicHandle.trim() : ''
  return legacy !== '' ? legacy : null
}

/**
 * GET /api/app/profile/instant-connect-code
 * Returns the caller's current instantConnectCode (nullable) and handle.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  try {
    const snap = await adminDb.collection(USERS).doc(authResult.uid).get()
    if (!snap.exists) {
      return NextResponse.json({ instantConnectCode: null, handle: null })
    }
    const d = snap.data() as Record<string, unknown>
    return NextResponse.json({
      instantConnectCode: readInstantConnectCode(d),
      handle: readHandle(d),
    })
  } catch (err) {
    console.error('[instant-connect-code GET]', err)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

/**
 * POST /api/app/profile/instant-connect-code
 * Generates and stores a new instantConnectCode for the caller and returns it.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  try {
    const code = generateInstantConnectCode()
    const ref = adminDb.collection(USERS).doc(authResult.uid)
    await ref.set({ instantConnectCode: code }, { merge: true })
    const snap = await ref.get()
    const d = snap.exists ? (snap.data() as Record<string, unknown>) : {}
    return NextResponse.json({
      instantConnectCode: code,
      handle: readHandle(d),
    })
  } catch (err) {
    console.error('[instant-connect-code POST]', err)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

/**
 * DELETE /api/app/profile/instant-connect-code
 * Clears the caller's instantConnectCode so existing instant-connect links stop working.
 */
export async function DELETE(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  try {
    const ref = adminDb.collection(USERS).doc(authResult.uid)
    const snap = await ref.get()
    if (snap.exists) {
      await ref.update({ instantConnectCode: FieldValue.delete() })
    }
    const after = await ref.get()
    const d = after.exists ? (after.data() as Record<string, unknown>) : {}
    return NextResponse.json({
      instantConnectCode: null,
      handle: readHandle(d),
    })
  } catch (err) {
    console.error('[instant-connect-code DELETE]', err)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
