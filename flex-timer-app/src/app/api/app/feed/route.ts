import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { loadAppFeedPage } from '@/lib/group-feed'
import type { AppFeedPageResponse } from '@/types/feed'

const PAGE_SIZE = 50

/**
 * GET /api/app/feed?cursor=<optional base64url cursor>
 * Paginated combined feed: hub activity (`groups/{groupId}/feed`) plus personal activity
 * (`users/{uid}/feed`: direct shares, connection events), merged newest-first (see `loadAppFeedPage`).
 */
export async function GET(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const cursor = request.nextUrl.searchParams.get('cursor')

  try {
    const page = await loadAppFeedPage({
      userId: uid,
      cursor,
      pageSize: PAGE_SIZE,
    })
    const body: AppFeedPageResponse = {
      items: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      truncatedGroups: page.truncatedGroups,
      eligibleGroupCount: page.eligibleGroupCount,
      queriedGroupCount: page.queriedGroupCount,
    }
    return NextResponse.json(body)
  } catch (err) {
    console.error('[app feed GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load feed' },
      { status: 500 }
    )
  }
}
