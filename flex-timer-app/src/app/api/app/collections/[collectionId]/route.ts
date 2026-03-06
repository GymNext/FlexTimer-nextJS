import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  clearCollectionDeletedAt,
  deleteCollection,
  getCollectionById,
  getWorkoutsByIds,
  setCollectionDeletedAt,
  updateCollectionMetadata,
  updateCollectionWorkoutIds,
} from '@/lib/firestore'

type RouteParams = Promise<{ collectionId: string }>

/**
 * GET /api/app/collections/[collectionId]
 * Returns a single workout collection (for the signed-in user) and its workouts.
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
  const { collectionId } = await params
  if (!collectionId) {
    return NextResponse.json({ error: 'collectionId required' }, { status: 400 })
  }

  try {
    const collection = await getCollectionById(uid, collectionId)
    if (!collection || collection.deletedAt) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }
    const workouts = await getWorkoutsByIds(uid, collection.workoutIds)
    return NextResponse.json({ collection, workouts })
  } catch (err) {
    console.error('[app collection GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch collection' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/app/collections/[collectionId]
 * - Soft delete / recover collection: body { recover: true } to recover.
 * - Reorder workouts within a collection: body { workoutIds: string[] }.
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
  const { collectionId } = await params
  if (!collectionId) {
    return NextResponse.json({ error: 'collectionId required' }, { status: 400 })
  }

  let body: { recover?: boolean; workoutIds?: unknown; workoutCollectionName?: string; workoutCollectionDescription?: string | null }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  try {
    const collection = await getCollectionById(uid, collectionId)
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    // Update name/description when provided.
    if (typeof body.workoutCollectionName === 'string') {
      const name = body.workoutCollectionName.trim()
      if (!name) {
        return NextResponse.json({ error: 'Collection name is required' }, { status: 400 })
      }
      await updateCollectionMetadata(uid, collectionId, {
        name,
        description: body.workoutCollectionDescription,
      })
      const updated = await getCollectionById(uid, collectionId)
      const workouts = updated ? await getWorkoutsByIds(uid, updated.workoutIds) : []
      return NextResponse.json({ collection: updated, workouts })
    }

    // Reorder workouts when workoutIds is provided.
    if (Array.isArray(body.workoutIds)) {
      const workoutIds = body.workoutIds.filter(
        (id): id is string => typeof id === 'string' && id.trim() !== ''
      )
      await updateCollectionWorkoutIds(uid, collectionId, workoutIds)
      const updated = await getCollectionById(uid, collectionId)
      const workouts = updated ? await getWorkoutsByIds(uid, updated.workoutIds) : []
      return NextResponse.json({ collection: updated, workouts })
    }

    // Soft delete / recover.
    if (body.recover === true) {
      if (!collection.deletedAt) {
        return NextResponse.json({ error: 'Collection is not deleted' }, { status: 400 })
      }
      await clearCollectionDeletedAt(uid, collectionId)
      return NextResponse.json({ ok: true })
    }

    if (collection.deletedAt) {
      return NextResponse.json({ error: 'Collection is already deleted' }, { status: 400 })
    }
    await setCollectionDeletedAt(uid, collectionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[app collection PATCH]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update collection' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/app/collections/[collectionId]
 * Permanently deletes a soft-deleted collection.
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
  const { collectionId } = await params
  if (!collectionId) {
    return NextResponse.json({ error: 'collectionId required' }, { status: 400 })
  }

  try {
    const collection = await getCollectionById(uid, collectionId)
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }
    if (!collection.deletedAt) {
      return NextResponse.json(
        { error: 'Collection must be soft-deleted before permanent deletion' },
        { status: 400 }
      )
    }
    await deleteCollection(uid, collectionId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[app collection DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete collection' },
      { status: 500 }
    )
  }
}

