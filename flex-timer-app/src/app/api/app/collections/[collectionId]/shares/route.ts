import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { getCollectionById } from '@/lib/firestore'
import { loadPublicUserProfileView } from '@/lib/public-profile-view'
import { MAX_PLAN_SHARE_DESTINATIONS } from '@/lib/plan-share'
import {
  countResourceShareDestinations,
  listResourceGroupShares,
  listResourceUserShares,
  shareResourceWithGroup,
  shareResourceWithUser,
  stopSharingResourceWithGroup,
  stopSharingResourceWithUser,
} from '@/lib/workout-collection-share'

type RouteParams = Promise<{ collectionId: string }>

async function groupDisplayName(groupId: string): Promise<string> {
  if (!adminDb) return groupId
  const pub = await adminDb.collection('publicGroupProfiles').doc(groupId).get()
  if (!pub.exists) return groupId
  const n = String((pub.data() as Record<string, unknown>)?.name ?? '').trim()
  return n || groupId
}

export async function GET(_request: NextRequest, { params }: { params: RouteParams }) {
  const authResult = await requireUserAuth(_request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { collectionId } = await params
  if (!collectionId) {
    return NextResponse.json({ error: 'collectionId required' }, { status: 400 })
  }

  try {
    const c = await getCollectionById(uid, collectionId)
    if (!c || c.deletedAt) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    const [groupRows, userRows] = await Promise.all([
      listResourceGroupShares(uid, 'collection', collectionId),
      listResourceUserShares(uid, 'collection', collectionId),
    ])

    const groupShares = await Promise.all(
      groupRows.map(async (r) => ({
        ...r,
        groupName: await groupDisplayName(r.groupId),
      }))
    )

    const userShares = await Promise.all(
      userRows.map(async (r) => {
        const prof = await loadPublicUserProfileView(r.peerUserId)
        return {
          ...r,
          displayName: prof.displayName,
          handle: prof.handle,
        }
      })
    )

    const destinationCount = await countResourceShareDestinations(uid, 'collection', collectionId)

    return NextResponse.json({
      groupShares,
      userShares,
      destinationCount,
      maxDestinations: MAX_PLAN_SHARE_DESTINATIONS,
    })
  } catch (err) {
    console.error('[collection shares GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load shares' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest, { params }: { params: RouteParams }) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { collectionId } = await params
  if (!collectionId) {
    return NextResponse.json({ error: 'collectionId required' }, { status: 400 })
  }

  let body: { target?: string; groupId?: string; peerUserId?: string; comment?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const target = body.target === 'group' || body.target === 'user' ? body.target : null
  if (!target) {
    return NextResponse.json({ error: 'target must be "group" or "user"' }, { status: 400 })
  }

  try {
    const c = await getCollectionById(uid, collectionId)
    if (!c || c.deletedAt) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    if (target === 'group') {
      const gid = typeof body.groupId === 'string' ? body.groupId.trim() : ''
      if (!gid) {
        return NextResponse.json({ error: 'groupId is required' }, { status: 400 })
      }
      await shareResourceWithGroup(uid, 'collection', collectionId, gid, body.comment ?? null)
      return NextResponse.json({ ok: true })
    }

    const peer = typeof body.peerUserId === 'string' ? body.peerUserId.trim() : ''
    if (!peer) {
      return NextResponse.json({ error: 'peerUserId is required' }, { status: 400 })
    }
    await shareResourceWithUser(uid, 'collection', collectionId, peer, body.comment ?? null)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const e = err as Error & { status?: number }
    const status = typeof e.status === 'number' ? e.status : 500
    if (status >= 400 && status < 500) {
      return NextResponse.json({ error: e.message || 'Request failed' }, { status })
    }
    console.error('[collection shares POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to share collection' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: RouteParams }) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { collectionId } = await params
  if (!collectionId) {
    return NextResponse.json({ error: 'collectionId required' }, { status: 400 })
  }

  const url = new URL(request.url)
  const target = url.searchParams.get('target')
  if (target !== 'group' && target !== 'user') {
    return NextResponse.json({ error: 'target must be group or user' }, { status: 400 })
  }

  try {
    const c = await getCollectionById(uid, collectionId)
    if (!c || c.deletedAt) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    if (target === 'group') {
      const groupId = url.searchParams.get('groupId')?.trim() ?? ''
      if (!groupId) {
        return NextResponse.json({ error: 'groupId required' }, { status: 400 })
      }
      const feedHint = url.searchParams.get('groupFeedItemId')
      await stopSharingResourceWithGroup(uid, 'collection', collectionId, groupId, feedHint)
      return new NextResponse(null, { status: 204 })
    }

    const peerUserId = url.searchParams.get('peerUserId')?.trim() ?? ''
    if (!peerUserId) {
      return NextResponse.json({ error: 'peerUserId required' }, { status: 400 })
    }
    const feedHint = url.searchParams.get('recipientFeedItemId')
    await stopSharingResourceWithUser(uid, 'collection', collectionId, peerUserId, feedHint)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    const e = err as Error & { status?: number }
    const status = typeof e.status === 'number' ? e.status : 500
    if (status >= 400 && status < 500) {
      return NextResponse.json({ error: e.message || 'Request failed' }, { status })
    }
    console.error('[collection shares DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to remove share' },
      { status: 500 }
    )
  }
}
