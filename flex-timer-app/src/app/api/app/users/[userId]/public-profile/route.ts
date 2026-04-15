import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { loadViewerConnectionState } from '@/lib/connection-requests'
import { loadPublicUserProfileView } from '@/lib/public-profile-view'
import type { PublicUserProfileView } from '@/types/public-profile'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * GET /api/app/users/[userId]/public-profile
 * Signed-in user: read another user's public profile mirror (`publicUserProfiles/{userId}`).
 * When `userId` is not the caller, includes `viewerConnection` (connected / pending request state).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { userId: raw } = await context.params
  const target = typeof raw === 'string' ? raw.trim() : ''
  if (!target) return bad('Invalid user id')

  try {
    const { uid } = authResult
    const profile = await loadPublicUserProfileView(target)
    const payload: PublicUserProfileView =
      uid !== target
        ? { ...profile, viewerConnection: await loadViewerConnectionState(uid, target) }
        : profile
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[app users public-profile GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load profile' },
      { status: 500 },
    )
  }
}
