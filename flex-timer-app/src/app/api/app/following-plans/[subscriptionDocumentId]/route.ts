import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { adminDb } from '@/lib/firebase-admin'

type RouteParams = Promise<{ subscriptionDocumentId: string }>

export async function DELETE(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { subscriptionDocumentId } = await params
  if (!subscriptionDocumentId) {
    return NextResponse.json({ error: 'subscriptionDocumentId required' }, { status: 400 })
  }

  try {
    const ref = adminDb
      .collection('users')
      .doc(uid)
      .collection('workoutPlanSubscriptions')
      .doc(subscriptionDocumentId)
    const snap = await ref.get()
    if (!snap.exists) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }
    await ref.delete()
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[app following-plans DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to stop following' },
      { status: 500 }
    )
  }
}
