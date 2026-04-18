import { randomBytes } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { parseFirestoreJoinPolicy, type AppGroupJoinPolicy } from '@/types/group'
import { stripAtPrefix } from '@/lib/group-handle'

const GROUPS = 'groups'

/**
 * Unambiguous uppercase alphanumeric alphabet (no 0/O/1/I/L) for codes that may be
 * read aloud or copy/pasted by end-users.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 10

function generateInstantJoinCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return out
}

function readInstantJoinCode(data: Record<string, unknown>): string | null {
  const raw = data.instantJoinCode
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

function readHandle(data: Record<string, unknown>): string | null {
  const raw = typeof data.handle === 'string' ? data.handle.trim() : ''
  if (raw === '') return null
  return stripAtPrefix(raw.startsWith('@') ? raw : `@${raw}`)
}

function readName(data: Record<string, unknown>): string | null {
  const raw = typeof data.name === 'string' ? data.name.trim() : ''
  return raw === '' ? null : raw
}

function readParentGroupId(data: Record<string, unknown>): string | null {
  const raw = typeof data.parentGroupId === 'string' ? data.parentGroupId.trim() : ''
  return raw === '' ? null : raw
}

type PublicPayload = {
  instantJoinCode: string | null
  handle: string | null
  name: string | null
  joinPolicy: AppGroupJoinPolicy
  parentGroupId: string | null
}

function buildPayload(data: Record<string, unknown>): PublicPayload {
  return {
    instantJoinCode: readInstantJoinCode(data),
    handle: readHandle(data),
    name: readName(data),
    joinPolicy: parseFirestoreJoinPolicy(data.joinPolicy) ?? 'private',
    parentGroupId: readParentGroupId(data),
  }
}

/**
 * GET /api/app/groups/[groupId]/instant-join-code
 * Owner-only: returns the hub's current instant join code plus lightweight fields
 * needed to build a shareable invite link (handle, name, join policy, parent).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { groupId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  if (!gid) return NextResponse.json({ error: 'Invalid hub id' }, { status: 400 })

  try {
    const snap = await adminDb.collection(GROUPS).doc(gid).get()
    if (!snap.exists) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
    const d = snap.data() as Record<string, unknown>
    if (d.deletedAt != null) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
    if (d.ownerUserId !== authResult.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(buildPayload(d))
  } catch (err) {
    console.error('[groups/:id/instant-join-code GET]', err)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

/**
 * POST /api/app/groups/[groupId]/instant-join-code
 * Owner-only: generates and stores a new instantJoinCode on the hub. Public hubs do not
 * use instant join codes — the server rejects generation in that case.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { groupId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  if (!gid) return NextResponse.json({ error: 'Invalid hub id' }, { status: 400 })

  try {
    const ref = adminDb.collection(GROUPS).doc(gid)
    const snap = await ref.get()
    if (!snap.exists) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
    const d = snap.data() as Record<string, unknown>
    if (d.deletedAt != null) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
    if (d.ownerUserId !== authResult.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const joinPolicy = parseFirestoreJoinPolicy(d.joinPolicy) ?? 'private'
    if (joinPolicy === 'public') {
      return NextResponse.json(
        { error: 'Public hubs do not use instant join codes.' },
        { status: 400 },
      )
    }

    const code = generateInstantJoinCode()
    await ref.set({ instantJoinCode: code }, { merge: true })
    const updated = await ref.get()
    const ud = updated.exists ? (updated.data() as Record<string, unknown>) : { ...d, instantJoinCode: code }
    return NextResponse.json(buildPayload(ud))
  } catch (err) {
    console.error('[groups/:id/instant-join-code POST]', err)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

/**
 * DELETE /api/app/groups/[groupId]/instant-join-code
 * Owner-only: clears the hub's instantJoinCode so existing instant-join links stop working.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { groupId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  if (!gid) return NextResponse.json({ error: 'Invalid hub id' }, { status: 400 })

  try {
    const ref = adminDb.collection(GROUPS).doc(gid)
    const snap = await ref.get()
    if (!snap.exists) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
    const d = snap.data() as Record<string, unknown>
    if (d.deletedAt != null) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
    if (d.ownerUserId !== authResult.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await ref.update({ instantJoinCode: FieldValue.delete() })
    const updated = await ref.get()
    const ud = updated.exists ? (updated.data() as Record<string, unknown>) : d
    return NextResponse.json(buildPayload(ud))
  } catch (err) {
    console.error('[groups/:id/instant-join-code DELETE]', err)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
