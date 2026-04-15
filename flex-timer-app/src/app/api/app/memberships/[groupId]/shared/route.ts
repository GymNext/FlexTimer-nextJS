import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { diagnoseHubSharedLibrary, loadHubSharedLibrary } from '@/lib/group-feed'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * GET /api/app/memberships/[groupId]/shared
 * Shared workouts, collections, and plans for this hub (from `groups/{id}/feed`), for active non-owning members.
 *
 * Query: `?diagnose=1` — includes `diagnosis` with subcollection counts and sample `feed` doc keys / resolver flags (debugging).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { groupId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  if (!gid) return bad('Invalid hub id')

  try {
    if (!adminDb) {
      return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
    }
    const mSnap = await adminDb.collection('groups').doc(gid).collection('members').doc(uid).get()
    if (!mSnap.exists) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const mData = mSnap.data() as Record<string, unknown>
    const st = mData.status
    if (typeof st === 'string' && st !== 'active') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const gSnap = await adminDb.collection('groups').doc(gid).get()
    if (!gSnap.exists) {
      return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
    }
    const gd = gSnap.data() as Record<string, unknown>
    if (gd.deletedAt != null) {
      return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
    }
    const owner = typeof gd.ownerUserId === 'string' ? gd.ownerUserId.trim() : ''
    if (owner === uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const library = await loadHubSharedLibrary(gid, { omitFeedDocsWhereActorUserId: uid })
    if (request.nextUrl.searchParams.get('diagnose') === '1') {
      const diagnosis = await diagnoseHubSharedLibrary(gid)
      return NextResponse.json({ ...library, diagnosis })
    }
    return NextResponse.json(library)
  } catch (err) {
    console.error('[app memberships groupId shared GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load shared library' },
      { status: 500 },
    )
  }
}
