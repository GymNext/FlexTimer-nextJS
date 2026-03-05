import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase-admin'

/**
 * POST /api/admin/users/[userId]/basic
 * Sets classicEligibleOverride = false (fallback subscription tier).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const authResult = await requireAdminAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { userId } = await params
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  await adminDb.collection('users').doc(userId).set(
    { classicEligibleOverride: false },
    { merge: true }
  )

  return NextResponse.json({ ok: true })
}

