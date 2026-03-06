import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  createWorkoutCollection,
  getUserWorkoutCollections,
  updateCollectionOrdinals,
} from '@/lib/firestore'
import { getSubscriptionLimits } from '@/lib/subscription-limits'

/**
 * GET /api/app/collections
 * Returns all of the signed-in user's workout collections (excluding soft-deleted).
 */
export async function GET(request: NextRequest) {
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

  try {
    const allCollections = await getUserWorkoutCollections(uid)
    const workoutCollections = allCollections.filter((c) => !c.deletedAt)
    return NextResponse.json({ workoutCollections })
  } catch (err) {
    console.error('[app collections GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load collections' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/app/collections
 * Reorder collections. Body: { collectionIds: string[] } (collection IDs in desired order, including 'favorite' if present).
 */
export async function PATCH(request: NextRequest) {
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

  let body: { collectionIds?: unknown }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const collectionIdsRaw = body.collectionIds
  if (!Array.isArray(collectionIdsRaw) || collectionIdsRaw.length === 0) {
    return NextResponse.json(
      { error: 'collectionIds (array of collection IDs) required' },
      { status: 400 }
    )
  }
  const collectionIds = collectionIdsRaw.filter(
    (id): id is string => typeof id === 'string' && id.trim() !== ''
  )

  try {
    const allCollections = await getUserWorkoutCollections(uid)
    const activeCollectionIds = new Set(
      allCollections.filter((c) => !c.deletedAt).map((c) => c.id)
    )
    const validIds = collectionIds.filter((id) => activeCollectionIds.has(id))
    if (validIds.length !== collectionIds.length) {
      return NextResponse.json(
        {
          error:
            'All collectionIds must belong to the user and not be deleted',
        },
        { status: 400 }
      )
    }
    await updateCollectionOrdinals(uid, validIds)
    const updated = await getUserWorkoutCollections(uid)
    const workoutCollections = updated.filter((c) => !c.deletedAt)
    return NextResponse.json({ workoutCollections })
  } catch (err) {
    console.error('[app collections PATCH]', err)
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to reorder collections',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/app/collections
 * Create a new workout collection for the signed-in user.
 * Body: { name: string, description?: string }
 */
export async function POST(request: NextRequest) {
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

  let body: { name?: string; description?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name : ''
  if (!name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const description = typeof body.description === 'string' ? body.description : null

  try {
    const [allCollections, limits] = await Promise.all([
      getUserWorkoutCollections(uid),
      getSubscriptionLimits(uid),
    ])
    const collectionsExcludingFavorites = allCollections.filter((c) => !c.deletedAt && c.id !== 'favorite')
    if (collectionsExcludingFavorites.length >= limits.maxCollections) {
      return NextResponse.json(
        {
          error:
            limits.maxCollections === 1
              ? 'Your plan allows 1 collection. Upgrade to add more.'
              : `Your plan allows up to ${limits.maxCollections} collections. Upgrade to add more.`,
          code: 'SUBSCRIPTION_LIMIT_COLLECTIONS',
        },
        { status: 403 }
      )
    }

    const collection = await createWorkoutCollection(uid, {
      name: name.trim(),
      description,
    })
    return NextResponse.json(collection, { status: 201 })
  } catch (err) {
    console.error('[app collections POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create collection' },
      { status: 500 }
    )
  }
}

