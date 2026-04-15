import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import {
  listActiveSharedCollectionBookmarksForUser,
  listActiveSharedWorkoutBookmarksForUser,
} from '@/lib/bookmarks'

export async function GET(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { uid } = authResult

  try {
    const [collections, workouts] = await Promise.all([
      listActiveSharedCollectionBookmarksForUser(uid),
      listActiveSharedWorkoutBookmarksForUser(uid),
    ])
    return NextResponse.json({ collections, workouts })
  } catch (err) {
    console.error('[app bookmarks GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load bookmarks' },
      { status: 500 },
    )
  }
}

