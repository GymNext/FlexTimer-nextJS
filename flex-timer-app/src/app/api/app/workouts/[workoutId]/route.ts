import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  clearWorkoutDeletedAt,
  deleteWorkout,
  getWorkoutById,
  getUserWorkoutCollections,
  setWorkoutDeletedAt,
  updateCollectionWorkoutIds,
  updateWorkoutMetadata,
  updateWorkoutSingleSegment,
  updateWorkoutMultiSegment,
} from '@/lib/firestore'
import type { WorkoutSegment } from '@/types/user'

type RouteParams = Promise<{ workoutId: string }>

/**
 * GET /api/app/workouts/[workoutId]
 * Returns a single workout belonging to the signed-in user.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { uid } = authResult
  const { workoutId } = await params
  if (!workoutId) {
    return NextResponse.json({ error: 'workoutId required' }, { status: 400 })
  }

  try {
    const workout = await getWorkoutById(uid, workoutId)
    if (!workout) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }
    return NextResponse.json(workout)
  } catch (err) {
    console.error('[app workout GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch workout' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/app/workouts/[workoutId]
 * - Soft delete / recover: body { recover: true } to recover, otherwise soft-delete.
 * - Update metadata: body { workoutName?: string | null, workoutDescription?: string | null }.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { uid } = authResult
  const { workoutId } = await params
  if (!workoutId) {
    return NextResponse.json({ error: 'workoutId required' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  try {
    const workout = await getWorkoutById(uid, workoutId)
    if (!workout) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }

    const hasMetadataUpdate =
      'workoutName' in body || 'workoutDescription' in body

    if (body.recover === true) {
      if (!workout.deletedAt) {
        return NextResponse.json({ error: 'Workout is not deleted' }, { status: 400 })
      }
      await clearWorkoutDeletedAt(uid, workoutId)
      return NextResponse.json({ ok: true })
    }

    if (workout.deletedAt) {
      return NextResponse.json({ error: 'Workout is already deleted' }, { status: 400 })
    }

    const isMetadataOnly =
      hasMetadataUpdate &&
      !('timerMode' in body) &&
      !('workoutSchedule' in body) &&
      !('direction' in body) &&
      !('prelude' in body) &&
      !('segue' in body) &&
      !('warnings' in body) &&
      !('metronome' in body) &&
      !('restDirection' in body) &&
      !('warningStrategy' in body) &&
      !('continuity' in body) &&
      !('segments' in body) &&
      !('autoProgress' in body) &&
      !('timerModes' in body)

    if (isMetadataOnly) {
      await updateWorkoutMetadata(uid, workoutId, {
        workoutName: typeof body.workoutName === 'string' || body.workoutName === null ? (body.workoutName as string | null) : undefined,
        workoutDescription: typeof body.workoutDescription === 'string' || body.workoutDescription === null ? (body.workoutDescription as string | null) : undefined,
      })
      const updated = await getWorkoutById(uid, workoutId)
      return NextResponse.json(updated ?? workout)
    }

    const hasSingleSegmentUpdate =
      workout.type === 'SingleSegmentWorkout' &&
      ('timerMode' in body || 'workoutSchedule' in body || 'direction' in body ||
       'prelude' in body || 'segue' in body || 'warnings' in body || 'metronome' in body ||
       'restDirection' in body || 'warningStrategy' in body || 'continuity' in body || hasMetadataUpdate)

    if (hasSingleSegmentUpdate) {
      await updateWorkoutSingleSegment(uid, workoutId, {
        workoutName: typeof body.workoutName === 'string' || body.workoutName === null ? (body.workoutName as string | null) : undefined,
        workoutDescription: typeof body.workoutDescription === 'string' || body.workoutDescription === null ? (body.workoutDescription as string | null) : undefined,
        timerMode: typeof body.timerMode === 'number' ? body.timerMode : undefined,
        workoutSchedule: typeof body.workoutSchedule === 'string' || body.workoutSchedule === null ? (body.workoutSchedule as string | null) : undefined,
        direction: typeof body.direction === 'boolean' ? body.direction : undefined,
        prelude: typeof body.prelude === 'number' ? body.prelude : undefined,
        segue: typeof body.segue === 'boolean' ? body.segue : undefined,
        warnings: Array.isArray(body.warnings) ? (body.warnings as number[]) : undefined,
        metronome: typeof body.metronome === 'number' ? body.metronome : undefined,
        restDirection: typeof body.restDirection === 'number' ? body.restDirection : undefined,
        warningStrategy: typeof body.warningStrategy === 'number' ? body.warningStrategy : undefined,
        continuity: typeof body.continuity === 'boolean' ? body.continuity : undefined,
      })
      const updated = await getWorkoutById(uid, workoutId)
      return NextResponse.json(updated ?? workout)
    }

    const hasMultiSegmentUpdate =
      workout.type === 'MultiSegmentWorkout' &&
      ('segments' in body || 'autoProgress' in body || 'timerModes' in body || hasMetadataUpdate)

    if (hasMultiSegmentUpdate) {
      const segments = Array.isArray(body.segments) ? (body.segments as WorkoutSegment[]) : undefined
      await updateWorkoutMultiSegment(uid, workoutId, {
        workoutName: typeof body.workoutName === 'string' || body.workoutName === null ? (body.workoutName as string | null) : undefined,
        workoutDescription: typeof body.workoutDescription === 'string' || body.workoutDescription === null ? (body.workoutDescription as string | null) : undefined,
        segments,
        autoProgress: typeof body.autoProgress === 'boolean' ? body.autoProgress : undefined,
        timerModes: Array.isArray(body.timerModes) ? (body.timerModes as number[]) : undefined,
      })
      const updated = await getWorkoutById(uid, workoutId)
      return NextResponse.json(updated ?? workout)
    }

    if (hasMetadataUpdate) {
      await updateWorkoutMetadata(uid, workoutId, {
        workoutName: typeof body.workoutName === 'string' || body.workoutName === null ? (body.workoutName as string | null) : undefined,
        workoutDescription: typeof body.workoutDescription === 'string' || body.workoutDescription === null ? (body.workoutDescription as string | null) : undefined,
      })
      const updated = await getWorkoutById(uid, workoutId)
      return NextResponse.json(updated ?? workout)
    }

    await setWorkoutDeletedAt(uid, workoutId)
    const collections = await getUserWorkoutCollections(uid)
    for (const c of collections) {
      if (c.deletedAt) continue
      if (!(c.workoutIds ?? []).includes(workoutId)) continue
      const cleaned = (c.workoutIds ?? []).filter((id) => id !== workoutId)
      await updateCollectionWorkoutIds(uid, c.id, cleaned)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[app workout PATCH]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update workout' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/app/workouts/[workoutId]
 * Permanently deletes a soft-deleted workout.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { uid } = authResult
  const { workoutId } = await params
  if (!workoutId) {
    return NextResponse.json({ error: 'workoutId required' }, { status: 400 })
  }

  try {
    const workout = await getWorkoutById(uid, workoutId)
    if (!workout) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }
    if (!workout.deletedAt) {
      return NextResponse.json(
        { error: 'Workout must be soft-deleted before permanent deletion' },
        { status: 400 }
      )
    }
    await deleteWorkout(uid, workoutId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[app workout DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete workout' },
      { status: 500 }
    )
  }
}

