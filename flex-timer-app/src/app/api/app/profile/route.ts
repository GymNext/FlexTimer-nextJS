import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getUserDocument, updateUserProfileFields, updateUserPublicHandle } from '@/lib/firestore'

/**
 * PATCH /api/app/profile
 * Updates editable user profile fields on users/<uid>.
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

  let body: {
    publicHandle?: string | null
    basicBio?: string | null
  }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const hasProfileUpdate = 'publicHandle' in body || 'basicBio' in body
  if (!hasProfileUpdate) {
    return NextResponse.json(
      { error: 'No updatable profile fields provided' },
      { status: 400 }
    )
  }

  try {
    const { uid } = authResult
    if ('publicHandle' in body) {
      await updateUserPublicHandle(uid, body.publicHandle ?? null)
    }
    if ('basicBio' in body) {
      await updateUserProfileFields(uid, {
        basicBio: body.basicBio,
      })
    }
    const userDoc = await getUserDocument(uid)
    return NextResponse.json({
      publicHandle: userDoc?.publicHandle ?? null,
      basicBio: userDoc?.basicBio ?? null,
    })
  } catch (err) {
    console.error('[app profile PATCH]', err)
    const message = err instanceof Error ? err.message : 'Failed to update profile'
    const status =
      message === 'That handle is already taken'
        ? 409
        : message.startsWith('Handle must be')
          ? 400
          : 500
    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}
