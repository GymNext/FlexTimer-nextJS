import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { isUserMemberOfGroup } from '@/lib/group-invite'
import { searchDiscoverableHubs } from '@/lib/group-discover-search'

/**
 * GET /api/app/groups/handle-search?query=
 * Signed-in user: prefix search on hub handle or name (public, restricted, and private matches).
 */
export async function GET(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const query = (request.nextUrl.searchParams.get('query') ?? '').trim()
  const { uid } = authResult

  try {
    const hubs = await searchDiscoverableHubs(query, { viewerUserId: uid })
    const hubsWithMember = await Promise.all(
      hubs.map(async (h) => ({
        ...h,
        isMember: await isUserMemberOfGroup(h.groupId, uid),
      })),
    )
    return NextResponse.json({ hubs: hubsWithMember })
  } catch (err) {
    console.error('[app groups handle-search GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to search hubs' },
      { status: 500 },
    )
  }
}
