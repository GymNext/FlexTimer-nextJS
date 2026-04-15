import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { deleteSharedWorkoutBookmark, upsertActiveSharedWorkoutBookmark } from '@/lib/bookmarks'
import { getWorkoutById } from '@/lib/firestore'
import { getWorkoutDisplayDescription, getWorkoutDisplayName } from '@/lib/json-workout-format'
import { viewerCanAccessSharedLibraryItem } from '@/lib/shared-resource-access'

/**
 * POST /api/app/bookmarks/workouts
 * Body: { ownerUserId, remoteWorkoutId, groupId?: string }
 * Saves an active `workoutSubscriptions` row when the viewer can already read that shared workout.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  let body: Record<string, unknown>
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const ownerUserId = typeof body.ownerUserId === 'string' ? body.ownerUserId.trim() : ''
  const remoteWorkoutId = typeof body.remoteWorkoutId === 'string' ? body.remoteWorkoutId.trim() : ''
  const groupId =
    typeof body.groupId === 'string' && body.groupId.trim() !== '' ? body.groupId.trim() : null

  if (!ownerUserId || !remoteWorkoutId) {
    return NextResponse.json({ error: 'ownerUserId and remoteWorkoutId required' }, { status: 400 })
  }
  if (ownerUserId === uid) {
    return NextResponse.json({ error: 'Cannot bookmark your own workout' }, { status: 400 })
  }

  const allowed = await viewerCanAccessSharedLibraryItem(uid, ownerUserId, 'workout', remoteWorkoutId, groupId)
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const w = await getWorkoutById(ownerUserId, remoteWorkoutId)
    if (!w || w.deletedAt) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }
    const workoutNameSnapshot = getWorkoutDisplayName(w).trim() || null
    const workoutDescriptionSnapshot = getWorkoutDisplayDescription(w).trim() || null
    const { subscriptionDocumentId } = await upsertActiveSharedWorkoutBookmark({
      viewerUid: uid,
      ownerUserId,
      remoteWorkoutId,
      mirrorGroupId: groupId,
      workoutNameSnapshot,
      workoutDescriptionSnapshot,
    })
    return NextResponse.json({ subscriptionDocumentId })
  } catch (err) {
    console.error('[app bookmarks/workouts POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save bookmark' },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/app/bookmarks/workouts
 * Body: { ownerUserId, remoteWorkoutId }
 * Removes the viewer's `workoutSubscriptions` row (composite doc id).
 */
export async function DELETE(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  let body: Record<string, unknown>
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const ownerUserId = typeof body.ownerUserId === 'string' ? body.ownerUserId.trim() : ''
  const remoteWorkoutId = typeof body.remoteWorkoutId === 'string' ? body.remoteWorkoutId.trim() : ''

  if (!ownerUserId || !remoteWorkoutId) {
    return NextResponse.json({ error: 'ownerUserId and remoteWorkoutId required' }, { status: 400 })
  }

  try {
    await deleteSharedWorkoutBookmark(uid, ownerUserId, remoteWorkoutId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to remove bookmark'
    if (msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    console.error('[app bookmarks/workouts DELETE]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
