import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'

type RouteParams = Promise<{ subscriptionDocumentId: string; plannedWorkoutId: string }>

/**
 * PATCH / DELETE — mutating a followed coach plan from the subscriber account is not supported.
 */
export async function PATCH(request: NextRequest, { params }: { params: RouteParams }) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { subscriptionDocumentId, plannedWorkoutId } = await params
  if (!subscriptionDocumentId || !plannedWorkoutId) {
    return NextResponse.json({ error: 'subscriptionDocumentId and plannedWorkoutId required' }, { status: 400 })
  }

  return NextResponse.json(
    { error: 'You cannot edit scheduled workouts on a plan you follow.' },
    { status: 403 }
  )
}

export async function DELETE(request: NextRequest, { params }: { params: RouteParams }) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { subscriptionDocumentId, plannedWorkoutId } = await params
  if (!subscriptionDocumentId || !plannedWorkoutId) {
    return NextResponse.json({ error: 'subscriptionDocumentId and plannedWorkoutId required' }, { status: 400 })
  }

  return NextResponse.json(
    { error: 'You cannot delete scheduled workouts on a plan you follow.' },
    { status: 403 }
  )
}
