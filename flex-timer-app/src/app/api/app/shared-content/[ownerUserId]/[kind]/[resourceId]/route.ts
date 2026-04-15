import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getCollectionById, getPlanById, getWorkoutById } from '@/lib/firestore'
import { viewerCanAccessSharedLibraryItem } from '@/lib/shared-resource-access'
import type { Workout } from '@/types/user'

type Kind = 'workout' | 'plan' | 'collection'

/** Cap embedded workouts in collection preview to keep responses bounded. */
const MAX_COLLECTION_WORKOUTS_PREVIEW = 80

function parseKind(raw: string): Kind | null {
  const t = raw.trim().toLowerCase()
  if (t === 'workout' || t === 'plan' || t === 'collection') return t
  return null
}

/**
 * GET /api/app/shared-content/[ownerUserId]/[kind]/[resourceId]?groupId=
 * Read-only fetch of another user's library item when the viewer has a share mirror or shares a hub feed with the item.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ownerUserId: string; kind: string; resourceId: string }> },
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { ownerUserId, kind: kindRaw, resourceId } = await context.params
  const owner = typeof ownerUserId === 'string' ? ownerUserId.trim() : ''
  const rid = typeof resourceId === 'string' ? resourceId.trim() : ''
  const kind = typeof kindRaw === 'string' ? parseKind(kindRaw) : null
  const groupId = request.nextUrl.searchParams.get('groupId')?.trim() || null

  if (!owner || !rid || !kind) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const allowed = await viewerCanAccessSharedLibraryItem(uid, owner, kind, rid, groupId)
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    if (kind === 'workout') {
      const w = await getWorkoutById(owner, rid)
      if (!w || w.deletedAt) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json({ kind: 'workout' as const, data: w })
    }
    if (kind === 'plan') {
      const p = await getPlanById(owner, rid)
      if (!p || p.deletedAt) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json({ kind: 'plan' as const, data: p })
    }
    const c = await getCollectionById(owner, rid)
    if (!c || c.deletedAt) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const rawIds = Array.isArray(c.workoutIds) ? c.workoutIds : []
    const ids = rawIds
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      .slice(0, MAX_COLLECTION_WORKOUTS_PREVIEW)
    const previews = await Promise.all(ids.map((wid) => getWorkoutById(owner, wid)))
    const workouts: Workout[] = []
    for (let i = 0; i < ids.length; i++) {
      const w = previews[i]
      if (w && !w.deletedAt) workouts.push(w)
    }
    return NextResponse.json({
      kind: 'collection' as const,
      data: c,
      workouts,
      workoutsTruncated: rawIds.filter((id) => typeof id === 'string' && id.trim() !== '').length >
        MAX_COLLECTION_WORKOUTS_PREVIEW,
    })
  } catch (err) {
    console.error('[app shared-content GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load resource' },
      { status: 500 },
    )
  }
}
