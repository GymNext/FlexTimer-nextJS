import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { clearCollectionDeletedAt, deleteCollection, getCollectionById, getWorkoutsByIds, setCollectionDeletedAt } from '@/lib/firestore'

/**
 * GET /api/admin/users/[userId]/collections/[collectionId]
 * Returns a single workout collection and its workouts.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; collectionId: string }> }
) {
  const authResult = await requireAdminAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { userId, collectionId } = await params
  if (!userId || !collectionId) {
    return NextResponse.json({ error: 'userId and collectionId required' }, { status: 400 })
  }

  try {
    const collection = await getCollectionById(userId, collectionId)
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }
    const workouts = await getWorkoutsByIds(userId, collection.workoutIds)
    return NextResponse.json({ collection, workouts })
  } catch (err) {
    console.error('[admin collection]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch collection' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/admin/users/[userId]/collections/[collectionId]
 * Soft-deletes the collection (sets deletedAt) or recovers (clears deletedAt). Body: { recover: true } to recover.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; collectionId: string }> }
) {
  const authResult = await requireAdminAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { userId, collectionId } = await params
  if (!userId || !collectionId) {
    return NextResponse.json({ error: 'userId and collectionId required' }, { status: 400 })
  }

  try {
    const collection = await getCollectionById(userId, collectionId)
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }
    const body = await request.json().catch(() => ({}))
    if (body.recover === true) {
      if (!collection.deletedAt) {
        return NextResponse.json({ error: 'Collection is not deleted' }, { status: 400 })
      }
      await clearCollectionDeletedAt(userId, collectionId)
      return NextResponse.json({ ok: true })
    }
    if (collection.deletedAt) {
      return NextResponse.json({ error: 'Collection is already deleted' }, { status: 400 })
    }
    await setCollectionDeletedAt(userId, collectionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin collection patch]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update collection' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/users/[userId]/collections/[collectionId]
 * Permanently deletes the collection document. Only allowed when collection is soft-deleted (deletedAt set).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; collectionId: string }> }
) {
  const authResult = await requireAdminAuth(_request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { userId, collectionId } = await params
  if (!userId || !collectionId) {
    return NextResponse.json({ error: 'userId and collectionId required' }, { status: 400 })
  }

  try {
    const collection = await getCollectionById(userId, collectionId)
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }
    if (!collection.deletedAt) {
      return NextResponse.json(
        { error: 'Collection must be soft-deleted before permanent deletion' },
        { status: 400 }
      )
    }
    await deleteCollection(userId, collectionId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[admin collection delete]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete collection' },
      { status: 500 }
    )
  }
}
