import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { countGroupMembers, getOwnedGroupOrNull } from '@/lib/group-invite'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * GET /api/app/groups/[groupId]/invite-context
 * Owner-only: how the invite UI should behave (root vs sub hub, browse vs search).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const authResult = await requireUserAuth(_request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { groupId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  if (!gid) return bad('Invalid hub id')

  const owned = await getOwnedGroupOrNull(uid, gid)
  if (!owned) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })

  const parentRaw = owned.data.parentGroupId
  const parentGroupId =
    typeof parentRaw === 'string' && parentRaw.trim() !== '' ? parentRaw.trim() : null
  const isSubHub = Boolean(parentGroupId)

  let dialogMode: 'search' | 'browseParent' = 'search'
  let browseParentGroupId: string | null = null
  let searchRestrictToParentGroupId: string | null = null
  let parentMemberCount: number | null = null

  if (isSubHub && parentGroupId) {
    parentMemberCount = await countGroupMembers(parentGroupId)
    if (parentMemberCount < 25) {
      dialogMode = 'browseParent'
      browseParentGroupId = parentGroupId
    } else {
      dialogMode = 'search'
      searchRestrictToParentGroupId = parentGroupId
    }
  }

  const name = typeof owned.data.name === 'string' ? owned.data.name.trim() : ''

  return NextResponse.json({
    groupId: gid,
    hubName: name || 'Hub',
    isSubHub,
    parentGroupId,
    parentMemberCount,
    dialogMode,
    browseParentGroupId,
    searchRestrictToParentGroupId,
  })
}
