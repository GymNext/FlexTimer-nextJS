import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { getOwnedGroupOrNull } from '@/lib/group-invite'
import { searchAppUsersForInvite } from '@/lib/user-directory-search'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * GET /api/app/users/search?query=&restrictToParentOfGroupId=
 * Signed-in user: search by handle or display name prefix.
 * Optional `restrictToParentOfGroupId`: caller must own that group; results limited to members of it.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const query = (request.nextUrl.searchParams.get('query') ?? '').trim()
  const restrictRaw = request.nextUrl.searchParams.get('restrictToParentOfGroupId')?.trim() ?? ''

  let restrictToMemberOfGroupId: string | null = null
  if (restrictRaw) {
    const parentOwned = await getOwnedGroupOrNull(uid, restrictRaw)
    if (!parentOwned) return bad('Invalid parent hub for search filter', 403)
    restrictToMemberOfGroupId = restrictRaw
  }

  try {
    const users = await searchAppUsersForInvite(query, {
      restrictToMemberOfGroupId,
    })
    return NextResponse.json({ users })
  } catch (err) {
    console.error('[app users search]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Search failed' },
      { status: 500 },
    )
  }
}
